"""Traffic-light state per frame from the lit lamp's colour.

A deterministic colour rule handles clear frames; ambiguous frames are sent to
Muse Spark (see pipeline). A state change is only accepted after it holds for
`min_hold` frames, so a single noisy frame cannot create a fake change.
"""

from __future__ import annotations

import cv2
import numpy as np

# OpenCV hue is 0..179.
HUE = {"red": [(0, 10), (165, 179)], "amber": [(11, 32)], "green": [(40, 95)]}


def classify_lamp(crop_bgr: np.ndarray) -> tuple[str, float]:
    """Return (state, confidence 0..1) for a traffic-light crop."""
    if crop_bgr.size == 0:
        return "unclear", 0.0
    hsv = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    lit = (s > 90) & (v > 160)
    total = int(lit.sum())
    if total < max(4, 0.01 * crop_bgr.shape[0] * crop_bgr.shape[1]):
        return "off", 0.5
    counts: dict[str, int] = {}
    for name, ranges in HUE.items():
        m = np.zeros_like(lit)
        for lo, hi in ranges:
            m |= (h >= lo) & (h <= hi)
        counts[name] = int((lit & m).sum())
    best = max(counts, key=lambda k: counts[k])
    conf = counts[best] / max(total, 1)
    return (best, conf) if conf >= 0.6 else ("unclear", conf)


def timeline(states: list[tuple[float, str]], min_hold: int = 3) -> list[dict]:
    """[(t, state)] per frame -> debounced list of changes [{"t", "state"}]."""
    out: list[dict] = []
    current = None
    run_state, run_start, run_len = None, 0.0, 0
    for t, st in states:
        if st in ("unclear",):
            continue
        if st == run_state:
            run_len += 1
        else:
            run_state, run_start, run_len = st, t, 1
        if run_len == min_hold and run_state != current:
            current = run_state
            out.append({"t": round(run_start, 3), "state": current})
    return out


def state_at(changes: list[dict], t: float) -> str | None:
    s = None
    for c in changes:
        if c["t"] <= t:
            s = c["state"]
    return s
