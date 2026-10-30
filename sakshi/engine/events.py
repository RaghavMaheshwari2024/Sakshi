"""Impact, braking onset, stop-line crossings and the momentum check."""

from __future__ import annotations

import itertools

import numpy as np

from .uncertainty import KMH, TrackResult

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


def _boxes_by_frame(track: dict) -> dict[int, list[float]]:
    return {f["i"]: f["box"] for f in track["frames"]}


def _intersect(a, b) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def detect_impacts(results: dict[str, TrackResult], tracks: list[dict],
                   max_gap_m: float = 4.5) -> list[dict]:
    """First frame where two road users' boxes touch in the image AND their
    ground positions are within `max_gap_m`. Both conditions are needed: boxes
    overlap all the time in perspective without any contact."""
    by_id = {t["id"]: t for t in tracks}
    impacts = []
    ids = [i for i in results if by_id[i]["concept"] in MOVERS]
    for a, b in itertools.combinations(ids, 2):
        ra, rb = results[a], results[b]
        ba, bb = _boxes_by_frame(by_id[a]), _boxes_by_frame(by_id[b])
        common = np.intersect1d(ra.frames, rb.frames)
        for i in common:
            if i not in ba or i not in bb or not _intersect(ba[i], bb[i]):
                continue
            ka = int(np.searchsorted(ra.frames, i))
            kb = int(np.searchsorted(rb.frames, i))
            gap = float(np.linalg.norm(ra.nominal.pos[ka] - rb.nominal.pos[kb]))
            if gap <= max_gap_m:
                t = float(ra.nominal.t[ka])
                dt = float(np.median(np.diff(ra.nominal.t))) if len(ra.nominal.t) > 1 else 0.04
                impacts.append(
                    {"type": "impact", "tracks": [a, b], "i": int(i), "t": round(t, 3),
                     "t_sigma": round(dt, 3), "ground_gap_m": round(gap, 2),
                     "xy": np.round((ra.nominal.pos[ka] + rb.nominal.pos[kb]) / 2, 2).tolist()}
                )
                break
    return sorted(impacts, key=lambda e: e["t"])


def window_speed(res: TrackResult, t0: float, t1: float) -> dict | None:
    """Mean speed over [t0, t1] per Monte Carlo sample -> median and 90% interval."""
    m = (res.nominal.t >= t0) & (res.nominal.t <= t1)
    if not m.any():
        return None
    per_sample = res.speed_samples[:, m].mean(1)
    lo, med, hi = np.percentile(per_sample, [5, 50, 95])
    return {"t0": round(t0, 3), "t1": round(t1, 3), "kmh": round(float(med), 1),
            "lo90": round(float(lo), 1), "hi90": round(float(hi), 1)}


def braking_onset(res: TrackResult, t_impact: float, min_duration_s: float = 0.25) -> dict:
    """Latest sustained run of deceleration beyond BRAKE_DECEL before impact."""
    a = res.nominal.long_acc
    t = res.nominal.t
    before = t < t_impact
    braking = before & (np.nan_to_num(a, nan=0.0) < BRAKE_DECEL)
    onset = None
    k = int(np.flatnonzero(before)[-1]) if before.any() else -1
    while k >= 0 and braking[k]:
        onset = k
        k -= 1
    if onset is None or t[np.flatnonzero(before)[-1]] - t[onset] < min_duration_s:
        return {"detected": False}
    return {"detected": True, "t": round(float(t[onset]), 3),
            "seconds_before_impact": round(float(t_impact - t[onset]), 2),
            "peak_decel_ms2": round(float(np.nanmin(a[onset:before.sum()])), 2)}


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
