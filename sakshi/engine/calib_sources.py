"""Where a calibration's ground coordinates come from.

A user rarely knows the road in metres. Besides typed ground points ("manual"),
the ground can come from a rectangle of known road markings ("preset") or from
matching points on a satellite map ("satellite"). The request names its method;
nothing is inferred, and points are never dropped or replaced silently.

Preset sizes are assumptions, so one draw of the Monte Carlo varies the whole
rectangle at once: a lane that is really 3.0 m rescales every distance the same way.
"""

from __future__ import annotations

import math

import numpy as np

from . import homography as hg

CORNER_SIGMA_M = 0.05  # how far a painted corner sits from the ideal rectangle
SAT_MIN_SIGMA_M = 0.4  # imagery rarely places a road mark better than this
SAT_UNKNOWN_SIGMA_M = 0.75  # pasted coordinates: the zoom they were read at is unknown
SAT_CLICK_MAP_PX = 1.5  # how many map pixels a careful click may be off
MAX_SAT_SPAN_M = 1000.0

# Typical road geometry, not a measurement of this road. Sigma is what we allow
# for the real road differing; scripts/calibration_coverage.py tests these values.
PRESETS = {
    "lane_zebra": {"label": "Lane width + zebra crossing width", "width_m": 3.5, "length_m": 3.0,
                   "sigma_width_m": 0.25, "sigma_length_m": 0.5},
    "lane_stop_line": {"label": "Lane width + stop-line distance", "width_m": 3.5, "length_m": 6.0,
                       "sigma_width_m": 0.25, "sigma_length_m": 1.0},
    # A longer base narrows the interval far more than a better guess at a small one.
    "two_lanes_long": {"label": "Two-lane road + 12 m stretch", "width_m": 7.0, "length_m": 12.0,
                       "sigma_width_m": 0.5, "sigma_length_m": 1.5},
}


def geo_to_local_m(geo_pts) -> np.ndarray:
    """(lat, lng) degrees to metres east and north of the points' centroid.
    Same formula as ui/src/utils/geo.ts; tests/fixtures/geo_local.json holds both to it."""
    g = np.asarray(geo_pts, dtype=float).reshape(-1, 2)
    if not np.isfinite(g).all() or (np.abs(g[:, 0]) > 90).any() or (np.abs(g[:, 1]) > 180).any():
        raise ValueError("Map points need a valid latitude and longitude.")
    lat0, lng0 = g.mean(0)
    s2 = math.sin(math.radians(lat0)) ** 2
    a, e2 = 6378137.0, 0.00669437999014  # WGS84
    north = a * (1 - e2) / (1 - e2 * s2) ** 1.5
    east = a / math.sqrt(1 - e2 * s2) * math.cos(math.radians(lat0))
    return np.c_[np.radians(g[:, 1] - lng0) * east, np.radians(g[:, 0] - lat0) * north]


def _check_not_mirrored(cal: hg.Calibration) -> None:
    """Pixels have y down and these ground frames have y up, seen from above, so
    a correct mapping flips orientation on the whole road. Otherwise the points
    are in the wrong order, or the road would have to pass behind the camera."""
    u, v = cal.image_pts.T
    denom = cal.H[2, 0] * u + cal.H[2, 1] * v + cal.H[2, 2]
    if denom.min() * denom.max() <= 0:
        raise ValueError("These points cannot all lie on one flat road; check the order you clicked them in.")
    for p in cal.image_pts:
        J = np.array([(hg.img_to_ground(cal.H, p + d) - hg.img_to_ground(cal.H, p - d))[0] / 2
                      for d in (np.array([1.0, 0.0]), np.array([0.0, 1.0]))])
        if np.linalg.det(J) >= 0:
            raise ValueError("The points on the frame and the road are mirrored; check the order you clicked them in.")


def _check_convex_quad(ip: np.ndarray) -> None:
    """Corner order: around the rectangle, anticlockwise as seen from above."""
    a, b = ip, np.roll(ip, -1, axis=0)
    c = np.roll(ip, -2, axis=0)
    cross = (b[:, 0] - a[:, 0]) * (c[:, 1] - b[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - b[:, 0])
    if (cross >= 0).any():
        raise ValueError("Corners are out of order or crossed; click them in the order shown.")


def _preset(body: dict) -> hg.Calibration:
    spec = body.get("preset") or {}
    base = PRESETS.get(spec.get("id"))
    if base is None and spec.get("id") != "custom":
        raise ValueError(f"Unknown preset: {spec.get('id')}")
    merged = {**(base or {"label": "Custom rectangle"}),
              **{k: spec[k] for k in ("width_m", "length_m", "sigma_width_m", "sigma_length_m")
                 if spec.get(k) is not None}}
    try:
        w, l = float(merged["width_m"]), float(merged["length_m"])
        sw, sl = float(merged["sigma_width_m"]), float(merged["sigma_length_m"])
    except KeyError as exc:
        raise ValueError(f"A custom rectangle needs {exc.args[0]}.") from exc
    if not (0.5 <= w <= 200 and 0.5 <= l <= 200):
        raise ValueError("Rectangle sides must be between 0.5 m and 200 m.")
    if not (0 <= sw <= w / 2 and 0 <= sl <= l / 2):
        raise ValueError("Rectangle uncertainty must be between 0 and half the side.")
    ip = np.asarray(body["image_pts"], dtype=float).reshape(-1, 2)
    if len(ip) != 4:
        raise ValueError(f"A rectangle needs exactly 4 corners; got {len(ip)}.")
    _check_convex_quad(ip)
    cal = hg.fit(ip, [[0, 0], [w, 0], [w, l], [0, l]])
    _check_not_mirrored(cal)
    cal.method = "preset"
    cal.ground_model = {"kind": "rect", "width_m": w, "length_m": l, "sigma_width_m": sw,
                        "sigma_length_m": sl, "sigma_corner_m": CORNER_SIGMA_M}
    cal.source = {"preset_id": spec.get("id"), "label": merged["label"]}
    return cal


def _satellite(body: dict) -> hg.Calibration:
    geo = body.get("geo_pts") or []
    ip = np.asarray(body["image_pts"], dtype=float).reshape(-1, 2)
    if len(geo) != len(ip):
        raise ValueError(f"Every frame point needs a map point: {len(ip)} on the frame, {len(geo)} on the map.")
    gp = geo_to_local_m(geo)
    span = float(np.ptp(gp, axis=0).max()) if len(gp) else 0.0
    if span > MAX_SAT_SPAN_M:
        raise ValueError("The map points are more than 1 km apart; they should all be on this stretch of road.")
    cal = hg.fit(ip, gp)
    _check_not_mirrored(cal)
    zoom = body.get("map_zoom")
    if zoom is None:
        sigma = SAT_UNKNOWN_SIGMA_M
    else:
        lat = float(np.mean(np.asarray(geo, dtype=float)[:, 0]))
        m_per_px = 156543.03392 * math.cos(math.radians(lat)) / 2 ** float(zoom)
        sigma = max(SAT_MIN_SIGMA_M, SAT_CLICK_MAP_PX * m_per_px)
    if len(ip) > 4:  # spare points show how well the map and the frame really agree
        sigma = max(sigma, cal.rms_err_m)
    cal.method = "satellite"
    cal.ground_model = {"kind": "points", "sigma_m": round(sigma, 3)}
    cal.source = {"geo_pts": [list(map(float, p)) for p in geo], "map_zoom": zoom,
                  "label": "Satellite map points"}
    return cal


def resolve(body: dict) -> hg.Calibration:
    """The calibration a request describes. Raises ValueError with a message for the user."""
    method = body.get("method", "manual")
    if method == "manual":
        return hg.fit(body["image_pts"], body["ground_pts_m"])
    if method == "preset":
        return _preset(body)
    if method == "satellite":
        return _satellite(body)
    raise ValueError(f"Unknown calibration method: {method}")


def basis_text(cal: hg.Calibration) -> str | None:
    """How the ground was established, in words for the report. None for typed points."""
    m = cal.ground_model
    if cal.method == "preset":
        return (f"road size assumed, not measured: {cal.source['label']}, {m['width_m']} m by {m['length_m']} m "
                f"(allowed for: {m['sigma_width_m']} m and {m['sigma_length_m']} m, 1 sigma)")
    if cal.method == "satellite":
        return f"road positions read from satellite imagery (allowed for: {m['sigma_m']} m per point, 1 sigma)"
    return None


def warnings(cal: hg.Calibration, width: int, height: int) -> list[str]:
    """Things a user should look at before trusting this calibration."""
    out = []
    if len(cal.image_pts) == 4:
        out.append("Exactly 4 points always fit perfectly, so the fit error cannot catch a wrong click. "
                   "Check the overlay against the road.")
    pose = hg.camera_pose(cal.H, width, height)
    if cal.method != "manual":
        z = abs(pose["position_m"][2]) if pose else None
        if z is None:
            out.append("A camera position could not be recovered from these points; check them.")
        elif not 2 <= z <= 30:
            out.append(f"These points put the camera {z:.1f} m above the road, which is unusual; "
                       "check the corners and the sizes.")
    return out
