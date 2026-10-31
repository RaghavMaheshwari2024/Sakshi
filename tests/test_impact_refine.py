"""Impact timing: move the first-close frame to where the motion breaks."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import events  # noqa: E402
from sakshi.engine import homography as hg  # noqa: E402

# 20 px per metre
H = hg.fit([[0, 0], [400, 0], [0, 400], [400, 400]], [[0, 0], [20, 0], [0, 20], [20, 20]]).H
FPS = 25
T = np.arange(150) / FPS


def _tracks(hit_frame: int | None, noise_px=1.0, seed=0):
    """A drives +x at 14 m/s, B drives -y at 8 m/s. At `hit_frame` they lock
    together and carry on at the momentum-weighted velocity, skidding to a stop."""
    rng = np.random.default_rng(seed)
    va, vb = np.array([14.0, 0]), np.array([0, -8.0])
    pa, pb = np.array([0.0, 20.0]), np.array([40.0, 40.0])
    out = {"car-A": [], "car-B": []}
    v_c = (1500 * va + 1200 * vb) / 2700
    for i, t in enumerate(T):
        if hit_frame is None or i <= hit_frame:
            a, b = pa + va * t, pb + vb * t
        else:
            th = T[hit_frame]
            dt = t - th
            sp = np.linalg.norm(v_c)
            ts = min(dt, sp / 6.0)
            s = sp * ts - 3.0 * ts * ts
            u = v_c / sp
            a, b = pa + va * th + u * s, pb + vb * th + u * s
        for tid, p in (("car-A", a), ("car-B", b)):
            px = p * 20 + rng.normal(0, noise_px, 2)
            out[tid].append({"i": i, "box": [px[0] - 40, px[1] - 30, px[0] + 40, px[1]], "contact_px": px.tolist()})
    return [{"id": k, "concept": "car", "frames": v} for k, v in out.items()]


def _first_close(i):
    return {"type": "impact", "tracks": ["car-A", "car-B"], "i": i, "t": float(T[i]), "t_sigma": 0.04,
            "ground_gap_m": 4.0, "xy": [0, 0]}


def test_refine_moves_early_detection_to_the_break():
    for seed in range(3):
        tracks = _tracks(hit_frame=75, seed=seed)
        out = events.refine_impact(_first_close(69), tracks, H, T)  # fired 6 frames (0.24 s) early
        assert out["method"] == "motion_break"
        assert abs(out["i"] - 75) <= 1, out
        assert out["first_close_t"] == T[69]


def test_refine_keeps_frame_when_motion_is_smooth():
    tracks = _tracks(hit_frame=None)
    out = events.refine_impact(_first_close(69), tracks, H, T)
    assert out["method"] == "first_close"
    assert out["i"] == 69


def test_check_party_fills_the_other_vehicle():
    from sakshi.pipeline import check_party

    # Wonder matched only s1 (seen in the CARLA base run): s2 is the other vehicle.
    party, notes = check_party({"s1": "car-0"}, ["s1", "s2"], ["car-0", "car-1"])
    assert party == {"s1": "car-0", "s2": "car-1"} and notes
    # Both on one vehicle: the second is moved to the free one.
    party, _ = check_party({"s1": "car-0", "s2": "car-0"}, ["s1", "s2"], ["car-0", "car-1"])
    assert party == {"s1": "car-0", "s2": "car-1"}
    # A bystander suggested: replaced by the involved vehicle nobody claimed.
    party, _ = check_party({"s1": "car-5", "s2": "car-1"}, ["s1", "s2"], ["car-0", "car-1"])
    assert party == {"s1": "car-0", "s2": "car-1"}
    # Nothing matched: no guessing which is which.
    party, _ = check_party({}, ["s1", "s2"], ["car-0", "car-1"])
    assert party == {}
    # Correct suggestions are left alone.
    party, notes = check_party({"s1": "car-1", "s2": "car-0"}, ["s1", "s2"], ["car-0", "car-1"])
    assert party == {"s1": "car-1", "s2": "car-0"} and not notes


def test_labelled_keyframes_returns_closeup_images(monkeypatch):
    from sakshi import pipeline

    monkeypatch.setattr(pipeline, "read_frames",
                        lambda _video, idx: {i: np.zeros((200, 300, 3), np.uint8) for i in idx})
    track = {"id": "car-0", "frames": [{"i": 5, "box": [10, 10, 50, 40]}]}
    images, closeups = pipeline.labelled_keyframes(Path("x.mp4"), [track], 20, 5, k=4, focus=["car-0"])
    # Close-ups are images (they go to Wonder), and are the last ones in the list.
    assert len(closeups) == 1 and isinstance(closeups[0], np.ndarray)
    assert images[-1] is closeups[0]
