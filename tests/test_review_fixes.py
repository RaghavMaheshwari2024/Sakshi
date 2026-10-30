"""Regression tests for the defects reported in the code review (Oct 30)."""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import claims, clock, events, homography as hg, kalman, signals  # noqa: E402
from sakshi.engine.kalman import Smoothed  # noqa: E402
from sakshi.engine.uncertainty import TrackResult  # noqa: E402
from sakshi.meta.wonder import unsupported_numbers  # noqa: E402
from sakshi.pipeline import choose_signal  # noqa: E402


def _result(tid, t, pos, vel, acc=None, n=50):
    t = np.asarray(t, float)
    acc = np.zeros_like(vel) if acc is None else acc
    x = np.zeros((len(t), 6))
    x[:, :2], x[:, 2:4], x[:, 4:6] = pos, vel, acc
    sm = Smoothed(t, x, np.zeros((len(t), 6, 6)), np.ones(len(t), bool))
    sp = np.linalg.norm(vel, axis=1) * 3.6
    noise = np.random.default_rng(0).normal(0, 0.5, (n, len(t)))
    return TrackResult(tid, np.arange(len(t)), sm, sp + noise, np.repeat(pos[None], n, 0))


def _claim(**kw):
    base = {"statement_id": "s1", "quote": "", "subject_track": "car-0", "quantity": "speed_kmh",
            "value_number": None, "value_text": None, "when": "unspecified"}
    return base | kw


def test_smoother_track_starting_with_unobserved_frames():
    t = np.arange(40) * 0.04
    z = np.c_[10 * t, np.zeros_like(t)]
    z[:6] = np.nan  # the track's first frames were duplicates
    s = kalman.smooth(t, z, meas_sigma_m=0.05)
    assert abs(s.speed[6] - 10) < 0.5


def test_braking_detected_when_released_just_before_impact():
    t = np.arange(0, 3.0, 0.04)
    a = np.where((t >= 1.0) & (t < 2.9), -6.0, 0.0)
    v = 15 + np.cumsum(a) * 0.04
    r = _result("car-0", t, np.c_[np.cumsum(v) * 0.04, 0 * t], np.c_[v, 0 * t], np.c_[a, 0 * t])
    b = events.braking_onset(r, 3.0)
    assert b["detected"] and abs(b["seconds_before_impact"] - 2.0) < 0.05


def _boxes(n, dy):
    return [{"i": k, "box": [100 + 5 * k, 300 + dy, 220 + 5 * k, 360 + dy]} for k in range(n)]


def test_no_impact_for_cars_side_by_side_in_adjacent_lanes():
    t = np.arange(0, 2, 0.04)
    vel = np.c_[12 + 0 * t, 0 * t]
    res = {"car-0": _result("car-0", t, np.c_[12 * t, 0 * t], vel),
           "car-1": _result("car-1", t, np.c_[12 * t, 0 * t + 3.5], vel)}
    tracks = [{"id": "car-0", "concept": "car", "frames": _boxes(len(t), 0)},
              {"id": "car-1", "concept": "car", "frames": _boxes(len(t), 30)}]
    assert events.detect_impacts(res, tracks) == []


def test_impact_still_found_for_a_closing_collision():
    t = np.arange(0, 2, 0.04)
    pa = np.c_[12 * t - 12, 0 * t]                      # east at 12 m/s
    pb = np.c_[0 * t, -8 * t + 8]                       # south at 8 m/s, meets at t = 1
    res = {"car-0": _result("car-0", t, pa, np.c_[12 + 0 * t, 0 * t]),
           "car-1": _result("car-1", t, pb, np.c_[0 * t, -8 + 0 * t])}
    tracks = [{"id": "car-0", "concept": "car", "frames": _boxes(len(t), 0)},
              {"id": "car-1", "concept": "car", "frames": _boxes(len(t), 30)}]
    imp = events.detect_impacts(res, tracks)
    assert len(imp) == 1 and 0.6 <= imp[0]["t"] <= 1.0


def test_stop_line_speed_claim_without_stop_line_is_cant_tell():
    t = np.arange(0, 4, 0.04)
    r = _result("car-0", t, np.c_[18 * t, 0 * t], np.c_[18 + 0 * t, 0 * t])
    out = claims.evaluate(_claim(value_number=20, when="at_stop_line"), {"car-0": r},
                          {"impact_t": 3.5, "signal_changes": [], "stop_line": None, "braking": {}})
    assert out["verdict"] == "cant_tell"


@pytest.mark.parametrize("said,verdict", [("yellow", "consistent"), ("Amber", "consistent"),
                                          ("green", "inconsistent"), ("blue", "cant_tell")])
def test_signal_colour_words(said, verdict):
    t = np.arange(0, 4, 0.04)
    r = _result("car-0", t, np.c_[18 * t - 30, 0 * t], np.c_[18 + 0 * t, 0 * t])
    ctx = {"impact_t": 3.5, "signal_changes": [{"t": 0.5, "state": "amber"}],
           "stop_line": [[0, -3], [0, 3]], "braking": {}}
    out = claims.evaluate(_claim(quantity="signal_state_at_stop_line", value_text=said,
                                 when="at_stop_line"), {"car-0": r}, ctx)
    assert out["verdict"] == verdict


def test_signal_unknown_while_lamp_hidden():
    st = [(0.04 * k, "red") for k in range(5)] + [(0.2 + 0.04 * k, "off") for k in range(30)] + \
         [(1.4 + 0.04 * k, "unclear") for k in range(30)] + [(2.6 + 0.04 * k, "green") for k in range(5)]
    tl = signals.timeline(st)
    assert [c["state"] for c in tl] == ["red", "unknown", "green", "unknown"]
    assert signals.state_at(tl, 1.5) is None       # hidden: can't tell
    assert signals.state_at(tl, 0.1) == "red"
    assert signals.state_at(tl, 2.65) == "green"


def test_validator_accepts_three_decimal_facts():
    facts = {"impact": {"t": 3.923}, "calibration_rms_m": 0.169}
    assert unsupported_numbers({"summary": "Impact at 3.923 s; calibration error 0.169 m"}, facts) == []
    assert unsupported_numbers({"summary": "Impact at 3.924 s"}, facts) == ["3.924"]


def test_ticks_on_the_same_frame_are_rejected():
    with pytest.raises(ValueError):
        clock.from_ticks(50, [(10, 1.0), (10, 2.0), (35, 3.0)], 25)


def test_collinear_image_points_rejected():
    with pytest.raises(ValueError):
        hg.fit([[100, 400], [200, 401], [300, 400], [400, 400]], [[0, 0], [5, 0], [0, 5], [5, 5]])


def test_signal_choice_with_several_lights():
    sig = {"traffic_light-0": [{"t": 0, "state": "red"}], "traffic_light-1": [{"t": 0, "state": "green"}]}
    changes, chosen, note = choose_signal(sig, None)
    assert changes == [] and chosen is None and "2 traffic lights" in note
    changes, chosen, _ = choose_signal(sig, "traffic_light-1")
    assert chosen == "traffic_light-1" and changes[0]["state"] == "green"


def test_signal_run_not_joined_across_a_long_gap():
    st = [(0.0, "green")] + [(0.04 * k, "unclear") for k in range(1, 91)] + [(3.68, "green"), (3.72, "green")]
    assert signals.timeline(st) == []  # never 3 clear frames in a row: nothing is known

def test_signal_chosen_by_clicking_the_light():
    tracks = [{"id": "traffic_light-0", "concept": "traffic light", "frames": [{"i": 0, "box": [100, 50, 120, 100]}]},
              {"id": "traffic_light-1", "concept": "traffic light", "frames": [{"i": 0, "box": [600, 40, 620, 90]}]}]
    sig = {"traffic_light-0": [{"t": 0, "state": "red"}], "traffic_light-1": [{"t": 0, "state": "green"}]}
    changes, chosen, _ = choose_signal(sig, None, tracks, [612, 70])
    assert chosen == "traffic_light-1"
    changes, chosen, note = choose_signal(sig, None, tracks, [350, 300])  # click far from any light
    assert chosen is None and "choose" in note
