"""True time of every frame.

CCTV recorders drop and duplicate frames, so "frame index / nominal fps" can be
badly wrong and would corrupt every speed. Order of preference:

1. Clock ticks + motion ("drop-aware"): frames where the burned-in seconds
   digit changes (read by Muse Spark) fix how many sensor frames each second
   held; the vehicles' own motion then shows WHERE inside the second frames
   were lost (a car that jumps three steps at once skipped two frames).
2. Clock ticks alone: linear interpolation between ticks.
3. Container timestamps (PTS), when the file has trustworthy ones.
4. Nominal frame rate, flagged as the weakest option.

Every clock can draw correlated random variants of itself (`sample`) for the
Monte Carlo intervals: tick positions are only known to within a frame, so the
error is shared by neighbouring frames rather than independent per frame.

Duplicate frames (identical to the previous frame) carry no new position and
are excluded from measurement.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np


@dataclass
class FrameClock:
    t: np.ndarray  # seconds, one per frame
    sigma: np.ndarray  # approx. 1-sigma timing uncertainty per frame, seconds
    method: str
    duplicate: np.ndarray  # bool per frame
    sampler: Callable[[np.random.Generator], np.ndarray] | None = field(default=None, repr=False)
    gaps: np.ndarray | None = None  # sensor frames between frame i-1 and i (drop-aware only)

    def sample(self, rng: np.random.Generator) -> np.ndarray:
        if self.sampler is not None:
            t = self.sampler(rng)
        else:
            t = self.t + rng.normal(0, 1, self.t.shape) * self.sigma
        return np.maximum.accumulate(t + np.arange(len(t)) * 1e-7)

    def to_json(self) -> dict:
        out = {
            "method": self.method,
            "frames": [
                {"i": i, "t": round(float(t), 4), "dup": bool(d)}
                for i, (t, d) in enumerate(zip(self.t, self.duplicate))
            ],
            "median_sigma_s": float(np.median(self.sigma)),
        }
        if self.gaps is not None:
            out["dropped_frames_inferred"] = int((self.gaps - 1).clip(0).sum())
            out["gaps"] = self.gaps.astype(int).tolist()
        return out


def detect_duplicates(gray_frames: list[np.ndarray], pixel_thresh: int = 30,
                      frac_thresh: float = 1e-4) -> np.ndarray:
    """A frame is a duplicate if almost no pixel changed from the previous one.

    A mean difference is not enough: a small moving car changes few pixels, so
    we count pixels that changed by more than `pixel_thresh` grey levels (above
    compression noise) and call the frame a duplicate if that count is below
    `frac_thresh` of the image. Use frames at least ~640 px wide.
    """
    dup = np.zeros(len(gray_frames), dtype=bool)
    for i in range(1, len(gray_frames)):
        dup[i] = is_duplicate(gray_frames[i - 1], gray_frames[i], pixel_thresh, frac_thresh)
    return dup


def is_duplicate(prev: np.ndarray, cur: np.ndarray, pixel_thresh: int = 30,
                 frac_thresh: float = 1e-4) -> bool:
    """One step of `detect_duplicates`, for streaming through long clips.
    Thresholds measured on a CRF-32 clip: a re-encoded duplicate changes at most
    0.002% of pixels by more than 30 grey levels, a real frame at least 0.04%."""
    diff = np.abs(cur.astype(np.int16) - prev)
    return bool((diff > pixel_thresh).mean() < frac_thresh)


def overlay_changed(prev: np.ndarray, cur: np.ndarray, level: int = 60,
                    min_frac: float = 0.0015, min_px: int = 15) -> bool:
    """Did the clock text change? Count pixels that changed strongly: when one
    digit changes only ~1% of the clock area changes, so an average change is
    far too small to see it (it is ~2 grey levels on a compressed clip), while
    the count of strongly changed pixels jumps from <20 to 50+."""
    d = np.abs(cur.astype(np.int16) - prev.astype(np.int16))
    return int((d > level).sum()) >= max(min_px, min_frac * d.size)


def detect_ticks(overlay_crops: list[np.ndarray], min_gap: int = 3) -> list[int]:
    """Frames where the clock overlay changed: candidates to read with Muse Spark.
    A change spread over consecutive frames (codec noise) counts once, at its
    first frame: the first frame showing the new second."""
    out: list[int] = []
    for i in range(1, len(overlay_crops)):
        if overlay_changed(overlay_crops[i - 1], overlay_crops[i]) and (not out or i - out[-1] >= min_gap):
            out.append(i)
    return out


def _check_ticks(ticks):
    ticks = sorted(ticks)
    if len(ticks) < 2:
        raise ValueError("Need at least two clock ticks.")
    if np.any(np.diff([i for i, _ in ticks]) <= 0):
        raise ValueError("Two clock ticks share a frame; each tick must be on its own frame.")
    if np.any(np.diff([s for _, s in ticks]) <= 0):
        raise ValueError("Clock readings are not increasing; check the overlay reads.")
    return ticks


def _interp_ticks(n: int, idx: np.ndarray, sec: np.ndarray) -> np.ndarray:
    frames = np.arange(n, dtype=float)
    t = np.interp(frames, idx, sec)
    r0 = (sec[1] - sec[0]) / (idx[1] - idx[0])
    r1 = (sec[-1] - sec[-2]) / (idx[-1] - idx[-2])
    t[frames < idx[0]] = sec[0] + (frames[frames < idx[0]] - idx[0]) * r0
    t[frames > idx[-1]] = sec[-1] + (frames[frames > idx[-1]] - idx[-1]) * r1
    return t


def from_ticks(n: int, ticks: list[tuple[int, float]], nominal_fps: float,
               duplicate: np.ndarray | None = None) -> FrameClock:
    """`ticks`: (frame index, clock seconds) where frame i is the FIRST frame
    showing that second. The true tick lies somewhere between frames i-1 and i."""
    duplicate = np.zeros(n, bool) if duplicate is None else duplicate
    ticks = _check_ticks(ticks)
    i_arr = np.array([i for i, _ in ticks], float)
    sec = np.array([s for _, s in ticks], float)
    t = _interp_ticks(n, i_arr - 0.5, sec)
    t0 = t[0]

    def sampler(rng):
        return _interp_ticks(n, i_arr - rng.uniform(0, 1, len(i_arr)), sec) - t0

    sigma = np.full(n, 0.29 / nominal_fps)  # uniform over one frame
    return FrameClock(t - t0, sigma, "clock_ticks", duplicate, sampler)


def _segment_gaps(d: np.ndarray, M: int) -> tuple[np.ndarray, float, np.ndarray]:
    """Integer gaps g_j >= 1 summing to M that best explain step displacements
    d_j, allowing the per-sensor-frame displacement to vary linearly (braking).
    Returns (gaps, cost, real-valued ratios)."""
    P = len(d)
    g = np.ones(P)
    if M < P:
        return g, np.inf, g
    coef = np.zeros(2)
    for _ in range(6):
        s_mid = np.cumsum(g) - g / 2
        A = np.c_[np.ones(P), s_mid]
        coef, *_ = np.linalg.lstsq(A * g[:, None], d, rcond=None)  # d ~= g * (a + b*s)
        u = np.maximum(A @ coef, 1e-3)
        r = d / u
        g = np.maximum(1, np.round(r))
        while g.sum() > M:
            cand = np.where(g > 1, g - r, -np.inf)
            g[np.argmax(cand)] -= 1
        while g.sum() < M:
            g[np.argmax(r - g)] += 1
    s_mid = np.cumsum(g) - g / 2
    u = np.maximum(np.c_[np.ones(P), s_mid] @ coef, 1e-3)
    return g, float((((d - g * u) / u) ** 2).mean()), d / u


def refine_with_motion(n: int, ticks: list[tuple[int, float]], nominal_fps: float,
                       step_disp: dict[str, np.ndarray], duplicate: np.ndarray | None = None,
                       min_total_m: float = 1.0, slack: int = 2,
                       step_sigma: dict[str, np.ndarray] | None = None) -> FrameClock:
    """Drop-aware clock. `step_disp[track][j]` = ground distance (m) moved
    between frames j-1 and j, NaN if not observed in both frames.
    `step_sigma` (same shape) is the noise of each distance; a track is only
    used where its per-frame step clearly exceeds that noise."""
    step_sigma = step_sigma or {k: np.zeros_like(v) for k, v in step_disp.items()}
    duplicate = np.zeros(n, bool) if duplicate is None else duplicate
    base = from_ticks(n, ticks, nominal_fps, duplicate)
    ticks = _check_ticks(ticks)
    g = np.ones(n)  # g[j]: sensor frames between frame j-1 and j; g[0] unused
    ratio = np.full(n, np.nan)  # real-valued motion ratio behind each gap
    refined_segments = 0
    unknown: list[tuple[np.ndarray, int]] = []  # seconds whose drops could not be located
    for (ia, sa), (ib, sb) in zip(ticks[:-1], ticks[1:]):
        js = np.arange(ia + 1, ib + 1)
        best = None
        for tid, d_all in step_disp.items():
            d = d_all[js]
            if np.isnan(d).any() or d.sum() < min_total_m:
                continue
            e = step_sigma[tid][js]
            # Usable if the second's total motion is well above its accumulated
            # noise; the per-second frame count then resolves single steps.
            snr = d.sum() / (np.sqrt((e**2).sum()) + 1e-6)
            if snr < 8 or np.median(d) < 1.5 * np.median(e):
                continue
            if best is None or snr > best[2]:
                best = (tid, d, snr)
        M0 = int(round(nominal_fps * (sb - sa)))
        if best is None or M0 < len(js):
            g[js] = M0 / len(js) if M0 >= len(js) else 1.0  # no usable motion: even spacing
            if M0 > len(js):
                unknown.append((js, M0 - len(js)))  # drops in this second, place unknown
            continue
        options = []
        for M in range(max(len(js), M0 - slack), M0 + slack + 1):
            gg, cost, rr = _segment_gaps(best[1], M)
            options.append((cost + 0.02 * abs(M - M0), gg, rr))
        _, g[js], ratio[js] = min(options, key=lambda o: o[0])
        refined_segments += 1
    # Outside the first and last ticks there is no frame-count constraint: use
    # the drop rate seen between the ticks (so times there are not biased), and
    # motion where it shows a clear jump.
    (ia, _), (ib, _) = ticks[0], ticks[-1]
    inside = np.arange(ia + 1, ib + 1)
    rate = float(g[inside].sum() / max(len(inside), 1)) if len(inside) else 1.0
    rate = max(rate, 1.0)
    outside = np.r_[np.arange(1, ia + 1), np.arange(ib + 1, n)].astype(int)
    g[outside] = rate
    for js, ref in ((np.arange(1, ia + 1), np.arange(ia + 1, ticks[1][0] + 1)),
                    (np.arange(ib + 1, n), np.arange(ticks[-2][0] + 1, ib + 1))):
        if len(js) == 0:
            continue
        for tid, d_all in step_disp.items():
            d_ref, d, e = d_all[ref], d_all[js], step_sigma[tid][js]
            if np.isnan(d_ref).any() or np.nanmean(d_ref / g[ref]) * len(ref) < min_total_m / 2:
                continue
            u = np.nanmedian(d_ref / g[ref])
            ok = ~np.isnan(d)
            r_out = d[ok] / u
            # Only act on clear jumps (well beyond one step plus 3 sigma of
            # noise); without a count constraint, noise could otherwise turn a
            # normal step into a fake "dropped frame".
            clear = (r_out >= 1.6) & (d[ok] - u > 3 * e[ok])
            # A step close to one frame's motion, with that motion well above the
            # noise, is a normal step; anything else stays at the average rate.
            single = (r_out < 1.3) & (u > 4 * e[ok])
            g[js[ok]] = np.where(clear, np.round(r_out), np.where(single, 1.0, rate))
            break
    i0, s0 = ticks[0]

    def times(gaps):
        cum = np.concatenate([[0.0], np.cumsum(gaps[1:])])  # sensor-frame count from frame 0
        return (cum - cum[i0]) / nominal_fps + s0 + 0.5 / nominal_fps

    t = times(g)
    t0 = t[0]
    # Gaps whose motion ratio sat near a half-integer are ambiguous: in each
    # Monte Carlo sample, move one sensor frame to a neighbour with probability
    # equal to that ambiguity, keeping each second's total unchanged.
    amb = np.nan_to_num(np.abs(ratio - g), nan=0.0).clip(0, 0.5) * 2 * 0.5

    def sampler(rng):
        gs = g.copy()
        # Seconds where motion could not place the drops: place them at random
        # (the second's total stays fixed by its two clock ticks).
        for js, extra in unknown:
            gs[js] = 1 + rng.multinomial(extra, np.full(len(js), 1 / len(js)))
        # Before the first and after the last tick: random drops at the seen rate.
        if rate > 1 and len(outside):
            gs[outside] = np.where(np.isclose(g[outside], rate), 1 + rng.poisson(rate - 1, len(outside)), g[outside])
        for j in np.flatnonzero(rng.random(n) < amb):
            k = j + (1 if ratio[j] > g[j] else -1)
            if 1 <= k < n:
                if ratio[j] > g[j] and gs[k] > 1:
                    gs[j] += 1
                    gs[k] -= 1
                elif ratio[j] < g[j] and gs[j] > 1:
                    gs[j] -= 1
                    gs[k] += 1
        return times(gs) - t0 + rng.uniform(-0.5, 0.5) / nominal_fps + rng.normal(0, 0.002, n)

    sigma = np.full(n, 0.29 / nominal_fps)
    method = "clock_ticks+motion" if refined_segments else "clock_ticks"
    return FrameClock(t - t0, sigma, method, duplicate, sampler, gaps=g)


# Without a burned-in clock, frames a recorder dropped are invisible: real time
# can only be LONGER than the file says. Each Monte Carlo sample stretches time
# by a random factor, so the 90% intervals admit up to ~20% dropped frames.
UNKNOWN_DROP_STRETCH = (0.98, 1.20)


def _stretch_sampler(t: np.ndarray):
    def sampler(rng):
        return t * rng.uniform(*UNKNOWN_DROP_STRETCH)
    return sampler


def from_pts(pts_s: np.ndarray, duplicate: np.ndarray | None = None) -> FrameClock:
    """Container timestamps. A file whose frames are evenly spaced (most CCTV
    exports, anything re-encoded) says nothing about dropped frames, so its
    times are treated as a lower bound; a file with uneven spacing (variable
    frame rate, e.g. phones) records real capture times and is trusted."""
    pts_s = np.asarray(pts_s, float)
    n = len(pts_s)
    duplicate = np.zeros(n, bool) if duplicate is None else duplicate
    if n > 1 and np.any(np.diff(pts_s) <= 0):
        raise ValueError("Container timestamps are not increasing.")
    t = pts_s - pts_s[0]
    steps = np.diff(t)
    if n > 2 and steps.std() / steps.mean() > 0.02:  # variable frame rate: real capture times
        return FrameClock(t, np.full(n, 0.002), "container_pts", duplicate)
    sampler = _stretch_sampler(t)
    return FrameClock(t, 0.1 * t + 0.002, "container_pts_even", duplicate, sampler)


def from_fps(n: int, fps: float, duplicate: np.ndarray | None = None) -> FrameClock:
    duplicate = np.zeros(n, bool) if duplicate is None else duplicate
    t = np.arange(n) / fps
    return FrameClock(t, 0.1 * t + 0.5 / fps, "nominal_fps", duplicate, _stretch_sampler(t))
