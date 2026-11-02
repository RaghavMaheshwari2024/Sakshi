"""Suggest a road calibration from how vehicles move, with no clicks.

A camera's tilt and lens are fixed by a simple fact: seen from above, vehicles
drive in fairly straight lines at fairly steady speeds, and do not change size.
So the tilt and focal length that best fit those are taken as true.
One camera cannot see scale, so that comes from an assumption: typical vehicle
size.

Measured against true calibrations on the CARLA suite, this reads speeds about
1.4 times too high on the median scenario, and over 6 times in the worst. So it is
only a rough first look: calibration method "estimated" never gives a verdict.
"""

from __future__ import annotations

import numpy as np

CAR_LENGTH_M, CAR_WIDTH_M = 4.5, 1.8
MIN_PATH_PX = 40.0  # shorter paths say little about the road
MIN_TRACKS = 2
EDGE_PX = 3.0
STEP_S = 0.4
FOCALS = np.linspace(0.45, 0.8, 8)  # times the frame's width: wide CCTV lenses, as measured on real traffic cameras
TILTS_DEG = np.linspace(4.0, 65.0, 62)


def _to_ground(px: np.ndarray, f: float, tilt: float, cx: float, cy: float) -> np.ndarray | None:
    """Pixels to the road, for a camera 1 unit above it. None if any is above the horizon."""
    dx, dy = (px[:, 0] - cx) / f, (px[:, 1] - cy) / f
    s, c = np.sin(tilt), np.cos(tilt)
    down = dy * c + s
    if (down <= 1e-3).any():
        return None
    t = 1.0 / down
    return np.c_[t * dx, t * (c - dy * s)]


def _usable_paths(tracks: list[dict], concepts: set[str], width: int, height: int, fps: float) -> list[dict]:
    paths = []
    step = max(1, round(STEP_S * fps))
    for tr in tracks:
        if tr["concept"] not in concepts:
            continue
        rows = [f for f in sorted(tr["frames"], key=lambda f: f["i"]) if f.get("contact_px")
                and f["box"][0] > EDGE_PX and f["box"][2] < width - EDGE_PX
                and f["box"][1] > EDGE_PX and f["box"][3] < height - EDGE_PX]
        if len(rows) < 3 * step:
            continue
        px = np.array([f["contact_px"] for f in rows], float)
        if np.linalg.norm(px[-1] - px[0]) < MIN_PATH_PX:
            continue
        keep = range(0, len(rows), step)
        paths.append({"px": px[list(keep)], "i": np.array([rows[k]["i"] for k in keep]),
                      "boxes": np.array([rows[k]["box"] for k in keep], float)})
    return paths


def _path_cost(g: np.ndarray) -> float:
    """How far a path is from a straight line at a steady speed; 0 is perfect."""
    steps = np.diff(g, axis=0)
    lengths = np.linalg.norm(steps, axis=1)
    total = lengths.sum()
    if total < 1e-6:
        return 9.0
    centred = g - g.mean(0)
    _, sv, _ = np.linalg.svd(centred, full_matrices=False)
    bend = sv[1] / max(sv[0], 1e-9)
    unsteady = lengths.std() / max(lengths.mean(), 1e-9)
    return float(bend + unsteady)


def _size_cost(p: dict, g: np.ndarray, f: float, tilt: float, cx: float, cy: float) -> float:
    """How much a vehicle's size on the road changes along its path; 0 is constant."""
    b = p["boxes"]
    left = _to_ground(np.c_[b[:, 0], b[:, 3]], f, tilt, cx, cy)
    right = _to_ground(np.c_[b[:, 2], b[:, 3]], f, tilt, cx, cy)
    if left is None or right is None:
        return 9.0
    across = np.linalg.norm(right - left, axis=1)
    heading = np.gradient(g, axis=0)
    n = np.linalg.norm(heading, axis=1)
    moving = (n > 1e-6) & (across > 1e-6)  # a stopped vehicle has no heading to compare with
    if moving.sum() < 3:
        return 9.0
    h = np.abs(heading[moving]) / n[moving, None]
    expected = CAR_LENGTH_M * h[:, 0] + CAR_WIDTH_M * h[:, 1]
    return float(np.log(across[moving] / expected).std())


def _scale_from_vehicles(paths: list[dict], f: float, tilt: float, cx: float, cy: float) -> tuple[float, float] | None:
    """Metres per ground unit: each box's width on the road against a typical vehicle
    at its heading. Returns (scale, relative spread)."""
    samples = []
    for p in paths:
        for k in range(1, len(p["px"]) - 1):
            b = p["boxes"][k]
            ends = _to_ground(np.array([[b[0], b[3]], [b[2], b[3]]]), f, tilt, cx, cy)
            near = _to_ground(p["px"][k - 1:k + 2], f, tilt, cx, cy)
            if ends is None or near is None:
                continue
            across = float(abs(ends[1, 0] - ends[0, 0]))
            heading = near[2] - near[0]
            n = np.linalg.norm(heading)
            if n < 1e-6 or across < 1e-6:
                continue
            ux, uy = np.abs(heading / n)
            samples.append((CAR_LENGTH_M * ux + CAR_WIDTH_M * uy) / across)
    if len(samples) < 3:
        return None
    return float(np.median(samples)), float(np.std(np.log(samples)))


def suggest(tracks: list[dict], concepts: set[str], width: int, height: int, fps: float) -> dict | None:
    """The best camera for these tracks, or None if they cannot support a suggestion."""
    paths = _usable_paths(tracks, concepts, width, height, fps)
    if len(paths) < MIN_TRACKS:
        return None
    cx, cy = width / 2.0, height / 2.0
    best = None
    for mult in FOCALS:
        f = mult * width
        for tilt in np.radians(TILTS_DEG):
            costs = []
            for p in paths:
                g = _to_ground(p["px"], f, tilt, cx, cy)
                if g is None:
                    costs = None
                    break
                costs.append(_path_cost(g) + _size_cost(p, g, f, tilt, cx, cy))
            if costs and (best is None or np.median(costs) < best[0]):
                best = (float(np.median(costs)), f, float(tilt))
    if best is None:
        return None
    cost, f, tilt = best
    scaled = _scale_from_vehicles(paths, f, tilt, cx, cy)
    if scaled is None:
        return None
    scale, spread = scaled
    if not (np.isfinite(cost) and np.isfinite(scale) and np.isfinite(spread) and scale > 0):
        return None
    # A patch of road around where the vehicles were, as the calibration's points.
    all_px = np.vstack([p["px"] for p in paths])
    lo, hi = np.percentile(all_px, [10, 90], axis=0)
    image_pts = np.array([[lo[0], hi[1]], [hi[0], hi[1]], [hi[0], lo[1]], [lo[0], lo[1]]])
    ground = _to_ground(image_pts, f, tilt, cx, cy)
    if ground is None:
        return None
    return {"image_pts": image_pts.round(1).tolist(), "ground_pts_m": (ground * scale).round(3).tolist(),
            "focal_px": round(f, 1), "tilt_deg": round(float(np.degrees(tilt)), 1),
            "camera_height_m": round(scale, 2), "scale_spread": round(spread, 3), "cost": round(cost, 3),
            "tracks_used": len(paths)}
