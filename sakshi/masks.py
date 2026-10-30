"""COCO run-length masks (the `rle` field in tracks and case.json) back to pixels.

SAM 3.1 masks are local to their box: `size` is the mask's own height and
width, and the mask is placed with its top-left corner at the box's top-left.
"""

from __future__ import annotations

import cv2
import numpy as np


def _counts_from_string(s: str) -> list[int]:
    """COCO's compressed counts string -> run lengths (pycocotools' algorithm)."""
    counts: list[int] = []
    p = 0
    while p < len(s):
        x, k, more = 0, 0, True
        while more:
            c = ord(s[p]) - 48
            x |= (c & 0x1F) << (5 * k)
            more = bool(c & 0x20)
            p += 1
            k += 1
            if not more and (c & 0x10):
                x |= -1 << (5 * k)
        if len(counts) > 2:
            x += counts[-2]
        counts.append(x)
    return counts


def rle_to_mask(rle: dict) -> np.ndarray:
    """{"size": [h, w], "counts": str | list[int]} -> uint8 array (h, w) of 0/1."""
    h, w = rle["size"]
    counts = rle["counts"]
    if isinstance(counts, str):
        counts = _counts_from_string(counts)
    flat = np.zeros(h * w, np.uint8)
    pos, val = 0, 0
    for n in counts:
        flat[pos:pos + n] = val
        pos += n
        val ^= 1
    return flat.reshape(w, h).T  # COCO stores masks column by column


def paste_mask(frame_shape: tuple[int, int], box: list[float], rle: dict) -> np.ndarray:
    """Full-frame boolean mask from a box-local RLE mask."""
    H, W = frame_shape[:2]
    local = rle_to_mask(rle)
    x0, y0, x1, y1 = box
    bw, bh = max(1, int(round(x1 - x0))), max(1, int(round(y1 - y0)))
    if local.shape != (bh, bw):
        local = cv2.resize(local, (bw, bh), interpolation=cv2.INTER_NEAREST)
    out = np.zeros((H, W), bool)
    xa, ya = int(round(x0)), int(round(y0))
    # Clip to the frame.
    fx0, fy0 = max(0, xa), max(0, ya)
    fx1, fy1 = min(W, xa + bw), min(H, ya + bh)
    if fx0 >= fx1 or fy0 >= fy1:
        return out
    out[fy0:fy1, fx0:fx1] = local[fy0 - ya:fy1 - ya, fx0 - xa:fx1 - xa].astype(bool)
    return out