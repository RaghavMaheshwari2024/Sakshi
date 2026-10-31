"""Ground contact from the wheels.

The lowest pixel of a vehicle's mask is not a fixed point on the vehicle: far
away it is near the front tyres, up close it is the bumper (about 0.4 m above
the road), so it slides along the car and makes speeds read several percent
fast. The lowest point of a WHEEL is always where the tyre touches the road.

SAM 3.1 also tracks the concept "wheel". For each vehicle we follow ONE
physical wheel through the clip: in each frame we take the wheel (inside the
lower part of the vehicle's box) whose ground offset from the vehicle's lowest
point is closest to the offset seen before. A different wheel (another axle or
side) sits 1.5-3 m away and is rejected, so the reference point never jumps.
Where that wheel is hidden, its last known offset is applied to the vehicle's
lowest point, and before the wheel is first seen the first offset is used.
"""

from __future__ import annotations

import numpy as np

from . import homography as hg

SAME_WHEEL_M = 0.7  # a different wheel of the same vehicle is >= ~1.5 m away


def _candidates(box, wheels):
    x0, y0, x1, y1 = box
    h = y1 - y0
    out = []
    for w in wheels:
        wx0, wy0, wx1, wy1 = w["box"]
        cx, cy = (wx0 + wx1) / 2, (wy0 + wy1) / 2
        if x0 <= cx <= x1 and y0 + 0.4 * h <= cy <= y1 + 0.1 * h and (wy1 - wy0) < 0.7 * h:
            out.append(w)
    return out


def wheel_contacts(tracks: list[dict], H: np.ndarray, vehicle_concepts=("car", "motorcycle", "bus", "truck",
                                                                        "auto rickshaw")) -> tuple[list[dict], dict]:
    """Return (tracks with wheel-based `contact_px` on vehicles, per-vehicle report)."""
    wheels_by_i: dict[int, list[dict]] = {}
    for t in tracks:
        if t["concept"] == "wheel":
            t["role"] = "part"
            for f in t["frames"]:
                if f.get("contact_px"):
                    wheels_by_i.setdefault(f["i"], []).append(f)
    report: dict[str, dict] = {}
    if not wheels_by_i:
        return tracks, report

    out = []
    for t in tracks:
        if t["concept"] not in vehicle_concepts:
            out.append(t)
            continue
        frames = [dict(f) for f in t["frames"]]
        o_ref = None
        seen: dict[int, np.ndarray] = {}  # frame position -> offset of the followed wheel
        lowest: dict[int, np.ndarray] = {}  # frame position -> ground point of the lowest pixel
        for k, f in enumerate(frames):
            if not f.get("contact_px"):
                continue
            gv = hg.img_to_ground(H, np.array([f["contact_px"]]))[0]
            lowest[k] = gv
            cands = _candidates(f["box"], wheels_by_i.get(f["i"], []))
            offs = [(hg.img_to_ground(H, np.array([w["contact_px"]]))[0] - gv, w) for w in cands]
            if o_ref is None:
                if not offs:
                    continue
                best = max(offs, key=lambda ow: ow[1]["contact_px"][1])  # nearest the camera: clearest view
            else:
                best = min(offs, key=lambda ow: np.linalg.norm(ow[0] - o_ref)) if offs else None
                if best is not None and np.linalg.norm(best[0] - o_ref) >= SAME_WHEEL_M:
                    best = None  # a different wheel: never switch
            if best is not None:
                o_ref = best[0]
                seen[k] = o_ref
                f["contact_px"] = list(best[1]["contact_px"])
        if not seen:  # the wheels were never seen: keep the lowest mask pixel
            out.append(t)
            continue
        # Frames where the followed wheel is hidden: the lowest pixel plus the
        # wheel's offset, blended between the sightings either side of the gap.
        ks_seen = np.array(sorted(seen))
        g_new: dict[int, np.ndarray] = {}
        src: dict[int, str] = {k: "wheel" for k in seen}
        for k, gv in lowest.items():
            if k in seen:
                continue
            j = int(np.searchsorted(ks_seen, k))
            kp = ks_seen[j - 1] if j > 0 else None
            kn = ks_seen[j] if j < len(ks_seen) else None
            if kp is not None and kn is not None:
                o = seen[kp] + (seen[kn] - seen[kp]) * (k - kp) / (kn - kp)
            else:
                o = seen[kp] if kp is not None else seen[kn]
            g_new[k], src[k] = gv + o, "offset"
        first_k = int(ks_seen[0])
        if g_new:
            ks = sorted(g_new)
            px = hg.ground_to_img(H, np.array([g_new[k] for k in ks]))
            for k, p in zip(ks, px):
                frames[k]["contact_px"] = [float(p[0]), float(p[1])]
        for k, s_ in src.items():
            frames[k]["contact_src"] = s_
        n_w = sum(1 for s_ in src.values() if s_ == "wheel")
        report[t["id"]] = {"wheel_frames": n_w, "offset_frames": len(src) - n_w,
                           "first_wheel_frame": frames[first_k]["i"]}
        out.append({**t, "frames": frames})
    return out, report
