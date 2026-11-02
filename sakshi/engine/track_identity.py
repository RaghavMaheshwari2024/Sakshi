"""One track id, one vehicle.

A tracker can give a new vehicle the id of one that left, and smoothing across the
gap would then invent a path between them, with speeds nobody measured. A track
is split at a gap when what comes after cannot be the same vehicle continuing.
A vehicle briefly hidden, which reappears where it was or further along its way,
stays one track.
"""

from __future__ import annotations

import numpy as np

from . import homography as hg

MIN_GAP_S = 0.5  # shorter gaps are ordinary tracking dropouts
MIN_JUMP_M = 5.0  # less than this is a vehicle hidden in about the same place
HEADING_FRAMES = 12
EDGE_PX = 3.0


def _ground(H: np.ndarray, frame: dict) -> np.ndarray:
    box = frame["box"]
    px = frame.get("contact_px") or [(box[0] + box[2]) / 2, box[3]]
    return hg.img_to_ground(H, np.asarray([px], float))[0]


def _edges(box, width: int, height: int) -> set[str]:
    found = set()
    if box[0] <= EDGE_PX:
        found.add("left")
    if box[2] >= width - EDGE_PX:
        found.add("right")
    if box[1] <= EDGE_PX:
        found.add("top")
    if box[3] >= height - EDGE_PX:
        found.add("bottom")
    return found


def is_different_vehicle(before: list[dict], after: dict, H: np.ndarray, width: int, height: int) -> bool:
    """`before`: frames up to the gap, oldest first. `after`: the first frame past it."""
    last = before[-1]
    a, b = _ground(H, last), _ground(H, after)
    jump = b - a
    if np.linalg.norm(jump) < MIN_JUMP_M:
        return False
    left_by, back_by = _edges(last["box"], width, height), _edges(after["box"], width, height)
    if left_by and back_by and not left_by & back_by:
        return True  # left by one side of the picture, back from another
    start = _ground(H, before[max(0, len(before) - HEADING_FRAMES)])
    heading = a - start
    return bool(np.linalg.norm(heading) > 0.5 and heading @ jump < 0)  # back the way it came


def split_reused_tracks(tracks: list[dict], H: np.ndarray, fps: float, width: int, height: int,
                        movers: set[str]) -> tuple[list[dict], list[dict]]:
    """Returns (tracks, splits). Later parts get ids car-4b, car-4c, and so on."""
    min_gap = max(2, round(MIN_GAP_S * fps))
    out, splits = [], []
    for track in tracks:
        if track["concept"] not in movers or len(track["frames"]) < 2:
            out.append(track)
            continue
        frames = sorted(track["frames"], key=lambda f: f["i"])
        parts, current = [], [frames[0]]
        for f in frames[1:]:
            if f["i"] - current[-1]["i"] >= min_gap and is_different_vehicle(current, f, H, width, height):
                parts.append(current)
                current = []
            current.append(f)
        parts.append(current)
        for n, part in enumerate(parts):
            suffix = "" if n == 0 else chr(ord("a") + n)
            part_id = f"{track['id']}{suffix}"
            out.append({**track, "id": part_id, "frames": part})
            if n:
                splits.append({"track": track["id"], "new_track": part_id, "at_frame": part[0]["i"]})
    return out, splits
