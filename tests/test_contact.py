"""Wheel-based ground contact (sakshi/engine/contact.py)."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import homography as hg  # noqa: E402
from sakshi.engine.contact import wheel_contacts  # noqa: E402

# 20 px per metre, ground x = px / 20, ground y = py / 20
H = hg.fit([[0, 0], [400, 0], [0, 400], [400, 400]], [[0, 0], [20, 0], [0, 20], [20, 20]]).H


def _scene(n=30, drift=True, other_wheel_from=None, hide=()):
    """A car moving +x at 1 m/frame. Its lowest mask pixel drifts forward by
    up to 1 m over the clip (like a bumper taking over from the tyres); the
    rear wheel's contact is exact, 1 m behind the car's true reference."""
    car, wheel_a, wheel_b = [], [], []
    for i in range(n):
        x = 2.0 + i * 1.0
        lowest = x + (i / (n - 1) if drift else 0.0)
        car.append({"i": i, "box": [(x - 1) * 20, 160, (x + 3) * 20, 220], "contact_px": [lowest * 20, 220.0]})
        if i not in hide:
            wheel_a.append({"i": i, "box": [(x - 1.3) * 20, 200, (x - 0.7) * 20, 220], "contact_px": [(x - 1) * 20, 220.0]})
        if other_wheel_from is not None and i >= other_wheel_from:
            wheel_b.append({"i": i, "box": [(x + 1.2) * 20, 200, (x + 1.8) * 20, 220], "contact_px": [(x + 1.5) * 20, 222.0]})
    tracks = [{"id": "car-0", "concept": "car", "frames": car}, {"id": "wheel-0", "concept": "wheel", "frames": wheel_a}]
    if wheel_b:
        tracks.append({"id": "wheel-1", "concept": "wheel", "frames": wheel_b})
    return tracks


def _xs(tracks):
    car = next(t for t in tracks if t["id"] == "car-0")
    return np.array([f["contact_px"][0] / 20 for f in car["frames"]])


def test_wheel_removes_the_sliding_contact_point():
    before = _xs(_scene())
    out, rep = wheel_contacts(_scene(), H)
    after = _xs(out)
    assert abs(np.diff(before).mean() - 1.0) > 0.02          # lowest pixel: speed reads fast
    assert np.allclose(np.diff(after), 1.0, atol=1e-6)       # wheel: exactly 1 m per frame
    assert rep["car-0"]["wheel_frames"] == 30
    assert next(t for t in out if t["id"] == "wheel-0")["role"] == "part"


def test_hidden_wheel_keeps_its_offset_and_other_wheel_is_rejected():
    out, rep = wheel_contacts(_scene(hide=range(10, 16), other_wheel_from=5), H)
    after = _xs(out)
    assert np.all(np.abs(np.diff(after) - 1.0) < 0.1)        # no jump to the other wheel
    assert rep["car-0"]["offset_frames"] >= 6


def test_no_wheels_leaves_tracks_unchanged():
    tracks = [t for t in _scene() if t["concept"] == "car"]
    out, rep = wheel_contacts(tracks, H)
    assert out == tracks and rep == {}
