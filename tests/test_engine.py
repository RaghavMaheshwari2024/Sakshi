"""Engine tests on exact synthetic geometry. Run: pytest -q"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import claims, clock, homography as hg, signals  # noqa: E402
from sakshi.engine.kalman import smooth  # noqa: E402
from sakshi.engine.uncertainty import TrackResult  # noqa: E402
from sakshi.meta.wonder import unsupported_numbers  # noqa: E402


def test_homography_recovers_ground_points():
    H_true = np.array([[0.05, 0.002, -30], [0.001, 0.09, -20], [1e-5, 8e-4, 1]])
    ground = np.array([[0, 0], [10, 0], [10, 7], [0, 7], [5, 3.5]], float)
    img = hg.ground_to_img(H_true, ground)
    cal = hg.fit(img, ground)
    assert cal.rms_err_m < 1e-6
    np.testing.assert_allclose(hg.img_to_ground(cal.H, img), ground, atol=1e-6)


def test_homography_rejects_collinear_points():
    with pytest.raises(ValueError):
        hg.fit([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [2, 0], [3, 0]])


def test_smoother_constant_velocity():
    t = np.arange(100) / 25.0
    z = np.c_[10 * t, 2 * t] + np.random.default_rng(0).normal(0, 0.05, (100, 2))
    s = smooth(t, z, meas_sigma_m=0.05)
    assert abs(np.median(s.speed[10:-10]) - np.hypot(10, 2)) < 0.15


def test_smoother_handles_gaps():
    t = np.arange(60) / 25.0
    z = np.c_[8 * t, 0 * t]
    z[20:30] = np.nan  # occlusion
    s = smooth(t, z, meas_sigma_m=0.05)
    assert abs(s.speed[25] - 8) < 0.3


def test_drop_aware_clock_finds_dropped_frames():
    fps, rng = 25.0, np.random.default_rng(1)
    true_slots = np.sort(rng.choice(np.arange(150), 120, replace=False))  # 30 frames dropped
    t_true = true_slots / fps
    v = 12.0  # m/s, steady
    pos = v * t_true
    step = {"car": np.r_[np.nan, np.diff(pos)] + np.r_[0, rng.normal(0, 0.01, 119)]}
    secs = np.floor(t_true)
    ticks = [(i, float(secs[i])) for i in range(1, len(secs)) if secs[i] != secs[i - 1]]
    clk = clock.refine_with_motion(len(t_true), ticks, fps, step)
    assert clk.method == "clock_ticks+motion"
    est_speed = np.median(np.diff(pos) / np.diff(clk.t))
    assert abs(est_speed - v) / v < 0.02
    assert abs(int(clk.to_json()["dropped_frames_inferred"]) - 30) <= 3


def test_signal_timeline_debounces_noise():
    states = [(i * 0.04, "green") for i in range(30)] + [(1.2, "red")] + \
             [(1.24 + i * 0.04, "green") for i in range(5)] + [(1.5 + i * 0.04, "red") for i in range(20)]
    tl = signals.timeline(states)
    assert [c["state"] for c in tl] == ["green", "red", "unknown"]
    assert signals.state_at(tl, 2.0) == "red"


def _fake_result(speed_kmh: float) -> TrackResult:
    from sakshi.engine.kalman import Smoothed

    t = np.arange(100) / 25.0
    x = np.zeros((100, 6))
    x[:, 0] = speed_kmh / 3.6 * t
    x[:, 2] = speed_kmh / 3.6
    sm = Smoothed(t, x, np.zeros((100, 6, 6)), np.ones(100, bool))
    samples = speed_kmh + np.random.default_rng(0).normal(0, 1.5, (200, 100))
    return TrackResult("car-0", np.arange(100), sm, samples, np.zeros((200, 100, 2)))


def test_claim_speed_verdicts():
    res = {"car-0": _fake_result(52)}
    ctx = {"impact_t": 3.5, "signal_changes": [], "stop_line": None, "braking": {}}
    base = {"statement_id": "s1", "quote": "", "subject_track": "car-0", "quantity": "speed_kmh",
            "value_text": None, "when": "just_before_impact"}
    assert claims.evaluate({**base, "value_number": 30}, res, ctx)["verdict"] == "inconsistent"
    assert claims.evaluate({**base, "value_number": 50}, res, ctx)["verdict"] == "consistent"
    assert claims.evaluate({**base, "subject_track": "car-9", "value_number": 50}, res, ctx)["verdict"] == "cant_tell"
    # The model sometimes puts the number in value_text.
    assert claims.evaluate({**base, "value_number": None, "value_text": "30"}, res, ctx)["verdict"] == "inconsistent"
    assert claims.evaluate({**base, "value_number": None, "value_text": "very fast"}, res, ctx)["verdict"] == "cant_tell"


def test_report_validator_rejects_invented_numbers():
    facts = {"speed": {"kmh": 52.3, "lo90": 46.1, "hi90": 58.0}}
    ok = {"summary": "Measured 52.3 km/h (90% interval 46.1 to 58.0)."}
    bad = {"summary": "The car was doing about 60 km/h."}
    assert unsupported_numbers(ok, facts) == []
    assert unsupported_numbers(bad, facts) == ["60"]
