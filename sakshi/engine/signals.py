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


SEEN = ("red", "amber", "green")


def timeline(states: list[tuple[float, str]], min_hold: int = 3,
             max_unseen_s: float = 0.5) -> list[dict]:
    """[(t, state)] per frame -> debounced list of changes [{"t", "state"}].

    "unclear" and "off" (lamp hidden, e.g. by a passing bus) are not states of
    the signal. If the lamp goes unseen for longer than `max_unseen_s` (hidden,
    or not tracked), the timeline records "unknown" from just after the last
    clear frame, so a claim about that moment is answered "can't tell" instead
    of assuming nothing changed. The same applies after the last clear frame.
    """
    out: list[dict] = []
    current = None
    run_state, run_start, run_len = None, 0.0, 0
    last_seen = None

    def mark_unknown(seen_t: float):
        nonlocal current, run_state, run_len
        current, run_state, run_len = "unknown", None, 0
        out.append({"t": round(seen_t + 1e-3, 3), "state": "unknown"})

    for t, st in sorted(states):
        if last_seen is not None and t - last_seen > max_unseen_s:
            if current not in (None, "unknown"):
                mark_unknown(last_seen)
            run_state, run_len = None, 0  # never join frames across a long gap
        if st not in SEEN:
            continue
        last_seen = t
        if st == run_state:
            run_len += 1
        else:
            run_state, run_start, run_len = st, t, 1
        if run_len == min_hold and run_state != current:
            current = run_state
            out.append({"t": round(run_start, 3), "state": current})
    if last_seen is not None and current not in (None, "unknown"):
        mark_unknown(last_seen)
    return out


def state_at(changes: list[dict], t: float) -> str | None:
    """Signal state at time t; None if never seen by then, or not visible then."""
    s = None
    for c in changes:
        if c["t"] <= t:
            s = c["state"]
    return None if s == "unknown" else s
