"""Impact, braking onset, stop-line crossings and the momentum check."""

from __future__ import annotations

import itertools

import numpy as np

from .uncertainty import KMH, TrackResult, metres_per_px

MOVERS = {"car", "motorcycle", "person", "auto rickshaw", "bus", "truck", "bicycle"}

# Plausible mass ranges (kg), including occupants/rider. Wide on purpose: the
# momentum check only needs SOME physically plausible masses to balance.
MASS_RANGES = {
    "car": (900, 2300),
    "motorcycle": (150, 350),
    "auto rickshaw": (400, 800),
    "bus": (8000, 16000),
    "truck": (4000, 20000),
    "bicycle": (60, 120),
    "person": (40, 110),
}

BRAKE_DECEL = -2.5  # m/s^2: firmer than coasting, softer than an emergency stop

# Beyond this ground distance per image pixel, a car is only a few pixels long and
# boxes overlap through perspective alone, so contact cannot be judged from the image.
MAX_CONTACT_M_PER_PX = 0.3
NEAR_MISS_MAX_GAP_M = 10.0  # about two car lengths, measured between tyre-line points
PARALLEL_COS = float(np.cos(np.radians(30.0)))


def _boxes_by_frame(track: dict) -> dict[int, list[float]]:
    return {f["i"]: f["box"] for f in track["frames"]}


def _intersect(a, b) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _resolved(H: np.ndarray | None, *boxes) -> bool:
    """Is the image sharp enough on the road at these boxes to judge contact?"""
    if H is None:
        return True
    return all(float(metres_per_px(H, np.array([[(b[0] + b[2]) / 2, b[3]]], float))[0]) <= MAX_CONTACT_M_PER_PX
               for b in boxes)


def _clipped(box, frame_size: tuple[int, int], margin_px: float = 2.0) -> bool:
    """A box cut by the frame edge: its bottom centre is not the vehicle's."""
    w, h = frame_size
    return box[0] <= margin_px or box[1] <= margin_px or box[2] >= w - margin_px or box[3] >= h - margin_px


def _closing_speed(ra: TrackResult, ka: int, rb: TrackResult, kb: int) -> float:
    """How fast the two road users approach each other (m/s, > 0 = closing)."""
    d = ra.nominal.pos[ka] - rb.nominal.pos[kb]
    n = np.linalg.norm(d)
    if n < 1e-6:
        return 0.0
    return float(-(d @ (ra.nominal.vel[ka] - rb.nominal.vel[kb])) / n)


def _mean_vel(r: TrackResult, t0: float, t1: float) -> np.ndarray | None:
    m = (r.nominal.t >= t0) & (r.nominal.t <= t1)
    return r.nominal.vel[m].mean(0) if m.sum() >= 3 else None


def motion_changed(ra: TrackResult, rb: TrackResult, t: float, before=(0.6, 0.15), after=(0.25, 0.8),
                   min_ms: float = 1.5, share: float = 0.3) -> bool | None:
    """Did contact at t change how the two move? A collision always does: the
    struck vehicle is pushed, the striking one slows, their relative velocity
    collapses. Two vehicles that only pass close (oncoming cars in adjacent
    lanes) carry on exactly as before. True if either velocity, or the relative
    velocity, changes by at least `share` of the closing speed before contact
    (and at least `min_ms`). None if there is too little footage after t to tell."""
    va0, vb0 = _mean_vel(ra, t - before[0], t - before[1]), _mean_vel(rb, t - before[0], t - before[1])
    va1, vb1 = _mean_vel(ra, t + after[0], t + after[1]), _mean_vel(rb, t + after[0], t + after[1])
    if va0 is None or vb0 is None or va1 is None or vb1 is None:
        return None
    rel0 = float(np.linalg.norm(va0 - vb0))
    change = max(float(np.linalg.norm(va1 - va0)), float(np.linalg.norm(vb1 - vb0)),
                 float(np.linalg.norm((va1 - vb1) - (va0 - vb0))))
    return change >= max(min_ms, share * rel0)


def detect_impacts(results: dict[str, TrackResult], tracks: list[dict],
                   max_gap_m: float = 4.5, min_closing_ms: float = 1.0,
                   lookback_s: float = 0.6, H: np.ndarray | None = None) -> list[dict]:
    """First frame where two road users' boxes touch in the image, their ground
    positions are within `max_gap_m`, AND they were closing on each other at
    `min_closing_ms` or more in the `lookback_s` before. The closing test rejects
    vehicles that only look close: side by side in adjacent lanes, or one
    following another at the same speed, never close the gap.

    A candidate is then confirmed by `motion_changed`: oncoming vehicles passing
    in adjacent lanes DO close the gap fast, but neither is pushed or slowed,
    so they are not an impact (the search goes on for a later, real one). With
    too little footage after the candidate to tell, it is kept and marked
    `confirmed: null`."""
    by_id = {t["id"]: t for t in tracks}
    impacts = []
    ids = [i for i in results if by_id[i]["concept"] in MOVERS]
    for a, b in itertools.combinations(ids, 2):
        ra, rb = results[a], results[b]
        ba, bb = _boxes_by_frame(by_id[a]), _boxes_by_frame(by_id[b])
        common = np.intersect1d(ra.frames, rb.frames)
        closing = {}
        for i in common:
            ka = int(np.searchsorted(ra.frames, i))
            kb = int(np.searchsorted(rb.frames, i))
            closing[int(i)] = (_closing_speed(ra, ka, rb, kb), float(ra.nominal.t[ka]))
        for i in common:
            if i not in ba or i not in bb or not _intersect(ba[i], bb[i]) or not _resolved(H, ba[i], bb[i]):
                continue
            ka = int(np.searchsorted(ra.frames, i))
            kb = int(np.searchsorted(rb.frames, i))
            gap = float(np.linalg.norm(ra.nominal.pos[ka] - rb.nominal.pos[kb]))
            t_i = float(ra.nominal.t[ka])
            recent = [c for c, tc in closing.values() if t_i - lookback_s <= tc <= t_i]
            if gap <= max_gap_m and recent and max(recent) >= min_closing_ms:
                t = float(ra.nominal.t[ka])
                confirmed = motion_changed(ra, rb, t)
                if confirmed is False:
                    continue  # they only passed close
                dt = float(np.median(np.diff(ra.nominal.t))) if len(ra.nominal.t) > 1 else 0.04
                impacts.append(
                    {"type": "impact", "tracks": [a, b], "i": int(i), "t": round(t, 3),
                     "t_sigma": round(dt, 3), "ground_gap_m": round(gap, 2), "confirmed": confirmed,
                     "xy": np.round((ra.nominal.pos[ka] + rb.nominal.pos[kb]) / 2, 2).tolist()}
                )
                break
    return sorted(impacts, key=lambda e: e["t"])


def _paths_cross(va: np.ndarray, vb: np.ndarray) -> bool:
    """Both moving, on directions at least 30 degrees from parallel. Lanes running
    side by side bring vehicles close all day; that alone is not a near miss."""
    na, nb = float(np.linalg.norm(va)), float(np.linalg.norm(vb))
    return na >= 1.0 and nb >= 1.0 and abs(float(va @ vb)) / (na * nb) <= PARALLEL_COS


def closest_approach(results: dict[str, TrackResult], tracks: list[dict],
                     H: np.ndarray | None = None, frame_size: tuple[int, int] | None = None) -> dict | None:
    """When no impact is found (a near miss): the moment two road users on crossing
    paths came closest on the ground, where the image can show it. Speed claims are
    then checked around that moment. None if nothing qualifies: most footage holds
    no near miss. Head-on and rear-end near misses are parallel, so not found here."""
    by_id = {t["id"]: t for t in tracks}
    ids = [i for i in results if by_id[i]["concept"] in MOVERS]
    best = None
    for a, b in itertools.combinations(ids, 2):
        ra, rb = results[a], results[b]
        ba, bb = _boxes_by_frame(by_id[a]), _boxes_by_frame(by_id[b])
        common = np.intersect1d(ra.frames, rb.frames)
        for i in common:
            ka, kb = int(np.searchsorted(ra.frames, i)), int(np.searchsorted(rb.frames, i))
            gap = float(np.linalg.norm(ra.nominal.pos[ka] - rb.nominal.pos[kb]))
            if gap > NEAR_MISS_MAX_GAP_M or (best is not None and gap >= best["gap_m"]):
                continue
            if H is not None and (i not in ba or i not in bb or not _resolved(H, ba[i], bb[i])):
                continue
            if frame_size and (i not in ba or i not in bb or _clipped(ba[i], frame_size) or _clipped(bb[i], frame_size)):
                continue
            if H is not None and not _paths_cross(ra.nominal.vel[ka], rb.nominal.vel[kb]):
                continue
            best = {"type": "closest_approach", "tracks": [a, b], "i": int(i),
                    "t": round(float(ra.nominal.t[ka]), 3), "gap_m": round(gap, 2)}
    return best


def window_speed(res: TrackResult, t0: float, t1: float) -> dict | None:
    """Mean speed over [t0, t1] per Monte Carlo sample -> median and 90% interval."""
    m = (res.nominal.t >= t0) & (res.nominal.t <= t1)
    if not m.any():
        return None
    per_sample = res.speed_samples[:, m].mean(1)
    lo, med, hi = np.percentile(per_sample, [5, 50, 95])
    t = res.nominal.t[m]  # the time actually measured, which a clip's start or end may cut short
    return {"t0": round(float(t[0]), 3), "t1": round(float(t[-1]), 3), "kmh": round(float(med), 1),
            "lo90": round(float(lo), 1), "hi90": round(float(hi), 1)}


def clearest_second(res: TrackResult, length_s: float = 1.0) -> dict | None:
    """The stretch of a track measured most tightly: the fair window for a speed
    claim tied to no event in the clip ("when I crossed")."""
    t = res.nominal.t
    best = None
    for t0 in t[t <= t[-1] - length_s + 1e-6]:
        w = window_speed(res, float(t0), float(t0) + length_s)
        if w and (best is None or w["hi90"] - w["lo90"] < best["hi90"] - best["lo90"]):
            best = w
    return best


MIN_BRAKE_DROP_KMH = 3.0  # braking must leave the vehicle at least this much slower


def _lasting_drop(res: TrackResult, t_s: float, t_e: float, t_impact: float) -> np.ndarray | None:
    """Per Monte Carlo sample: speed before the run (median over the 1.5 s
    before it) minus speed after it (until 0.5 s later or just before impact;
    if the run lasts until contact, its last 0.2 s)."""
    t = res.nominal.t
    ref = (t >= t_s - 1.5) & (t <= t_s - 0.1)
    post = (t >= t_e) & (t <= min(t_e + 0.5, t_impact - 0.05))
    if post.sum() < 2:  # braking lasted until contact: its last 0.2 s
        post = (t >= max(t_s, t_e - 0.2)) & (t <= t_e)
    if ref.sum() < 3 or post.sum() < 1:
        return None
    return np.median(res.speed_samples[:, ref], 1) - res.speed_samples[:, post].mean(1)


def braking_onset(res: TrackResult, t_impact: float, min_duration_s: float = 0.25,
                  lookback_s: float = 3.0, min_share: float = 0.9) -> dict:
    """Latest sustained run of deceleration beyond BRAKE_DECEL in the
    `lookback_s` before impact. The run need not last until contact: a driver
    may brake hard and release (or the wheels lock) just before the hit.

    A run only counts if it left the vehicle LASTINGLY slower: in at least
    `min_share` of the Monte Carlo samples, the speed after the run is
    MIN_BRAKE_DROP_KMH below the speed before it. A frame the recorder dropped
    without trace (or a short tracking wobble) makes the speed jump up and come
    back down; the way back down looks like braking but leaves the speed where
    it was, and every vehicle in view shows it at the same moment."""
    a = np.nan_to_num(res.nominal.long_acc, nan=0.0)
    t = res.nominal.t
    idx = np.flatnonzero((t < t_impact) & (t >= t_impact - lookback_s))
    runs, start = [], None
    for k in idx:
        if a[k] < BRAKE_DECEL:
            start = k if start is None else start
        elif start is not None:
            runs.append((start, k - 1))
            start = None
    if start is not None:
        runs.append((start, int(idx[-1])))
    runs = [(s, e) for s, e in runs if t[e] - t[s] >= min_duration_s]
    rejected = 0
    for s, e in reversed(runs):
        drop = _lasting_drop(res, float(t[s]), float(t[e]), t_impact)
        if drop is None or np.mean(drop >= MIN_BRAKE_DROP_KMH) < min_share:
            rejected += 1
            continue
        return {"detected": True, "t": round(float(t[s]), 3),
                "seconds_before_impact": round(float(t_impact - t[s]), 2),
                "ended_before_impact_s": round(float(t_impact - t[e]), 2),
                "peak_decel_ms2": round(float(a[s:e + 1].min()), 2),
                "speed_drop_kmh": round(float(np.median(drop)), 1)}
    return {"detected": False, **({"rejected_runs": rejected} if rejected else {})}


def momentum_check(impact: dict, results: dict[str, TrackResult], tracks: list[dict],
                   before=(0.6, 0.15), after=(0.25, 0.7), tol: float = 0.3) -> dict:
    """Is there ANY plausible pair of masses for which momentum before ~= after?

    A failure points to a tracking error (swapped ids, a lost track) and the
    case is flagged instead of reported with confidence.
    """
    by_id = {t["id"]: t for t in tracks}
    t_imp = impact["t"]
    v_b, v_a, ranges = [], [], []
    for tid in impact["tracks"]:
        r = results[tid]
        mb = (r.nominal.t >= t_imp - before[0]) & (r.nominal.t <= t_imp - before[1])
        ma = (r.nominal.t >= t_imp + after[0]) & (r.nominal.t <= t_imp + after[1])
        if mb.sum() < 3 or ma.sum() < 3:
            return {"status": "insufficient_data"}

        # Braking before and friction after change velocity over each window,
        # so fit a straight line to each and evaluate it AT the impact time.
        def at_impact(mask):
            tt = r.nominal.t[mask] - t_imp
            A = np.c_[np.ones(len(tt)), tt]
            coef, *_ = np.linalg.lstsq(A, r.nominal.vel[mask], rcond=None)
            return coef[0]

        v_b.append(at_impact(mb))
        v_a.append(at_impact(ma))
        ranges.append(MASS_RANGES.get(by_id[tid]["concept"], (50, 20000)))
    grid = [np.linspace(lo, hi, 15) for lo, hi in ranges]
    best = np.inf
    for m1 in grid[0]:
        for m2 in grid[1]:
            pb = m1 * v_b[0] + m2 * v_b[1]
            pa = m1 * v_a[0] + m2 * v_a[1]
            scale = m1 * np.linalg.norm(v_b[0]) + m2 * np.linalg.norm(v_b[1]) + 1e-6
            best = min(best, float(np.linalg.norm(pb - pa) / scale))
    return {"status": "consistent" if best <= tol else "inconsistent",
            "best_relative_residual": round(best, 3)}


def stop_line_crossing(res: TrackResult, line: list[list[float]]) -> float | None:
    """Time the track's ground point first crosses the stop-line segment."""
    (x1, y1), (x2, y2) = line
    d = np.array([x2 - x1, y2 - y1])
    n = np.array([-d[1], d[0]])
    side = (res.nominal.pos - np.array([x1, y1])) @ n
    s = np.sign(side)
    for k in range(1, len(s)):
        if s[k - 1] != 0 and s[k] != s[k - 1]:
            # Check the crossing lies within the segment, not its extension.
            f = side[k - 1] / (side[k - 1] - side[k])
            p = res.nominal.pos[k - 1] + f * (res.nominal.pos[k] - res.nominal.pos[k - 1])
            u = (p - np.array([x1, y1])) @ d / (d @ d)
            if -0.2 <= u <= 1.2:
                return float(res.nominal.t[k - 1] + f * (res.nominal.t[k] - res.nominal.t[k - 1]))
    return None


def speed_kmh_at(res: TrackResult, t: float) -> float:
    return float(np.interp(t, res.nominal.t, res.nominal.speed) * KMH)
