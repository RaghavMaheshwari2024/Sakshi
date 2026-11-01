"""Events and verdicts must hold up on busy real roads, not only on staged crashes."""

import numpy as np
import pytest

from sakshi.engine import claims, events
from sakshi.engine.kalman import Smoothed
from sakshi.engine.uncertainty import TrackResult
from sakshi.meta.wonder import limitation_lines
from sakshi.pipeline import match_parties

T = np.arange(0, 4, 0.04)


def result(tid, start, vel, spread=0.5):
    vel = np.asarray(vel, float)
    pos = np.asarray(start, float) + T[:, None] * vel
    speed = np.full(len(T), np.linalg.norm(vel))
    x = np.c_[pos, np.tile(vel, (len(T), 1)), np.zeros((len(T), 2))]
    nominal = Smoothed(T, x, np.zeros((len(T), 6, 6)), np.ones(len(T), bool))
    samples = speed * 3.6 + np.random.default_rng(1).normal(0, spread, (60, 1))
    return TrackResult(tid, np.arange(len(T)), nominal, samples, np.zeros((60, len(T), 2)))


def track(tid, boxes):
    return {"id": tid, "concept": "car", "frames": [{"i": i, "box": b} for i, b in enumerate(boxes)]}


class Scale:  # metres per image pixel, everywhere: close to the camera, and far along the road
    NEAR = np.diag([0.05, 0.05, 1.0])
    FAR = np.diag([1.0, 1.0, 1.0])


def two_closing(H):
    a = result("a", [0, 0], [2, 0])
    b = result("b", [16, 0], [-1, 0])  # within contact range just as the clip ends
    box = [100, 100, 200, 150]
    tracks = [track("a", [box] * len(T)), track("b", [box] * len(T))]
    return events.detect_impacts({"a": a, "b": b}, tracks, H=H)


def test_contact_needs_an_image_sharp_enough_to_show_it():
    assert not two_closing(Scale.FAR)  # overlapping boxes, but a pixel covers a metre
    assert two_closing(Scale.NEAR)  # the same event, close to the camera


def crossing_pair(vb):
    t = 2.0
    a = result("a", np.array([0, 0]) - t * np.array([8, 0]), [8, 0])
    b = result("b", np.array([0, 5]) - t * np.asarray(vb, float), vb)
    tracks = [track("a", [[100, 100, 150, 130]] * len(T)), track("b", [[300, 200, 350, 230]] * len(T))]
    return {"a": a, "b": b}, tracks


def test_near_miss_needs_crossing_paths():
    r, tr = crossing_pair([0, 6])
    found = events.closest_approach(r, tr, H=Scale.NEAR)
    assert found and found["tracks"] == ["a", "b"]
    r, tr = crossing_pair([-8, 0])  # oncoming lane
    assert events.closest_approach(r, tr, H=Scale.NEAR) is None
    r, tr = crossing_pair([6, 0])  # overtaking in the next lane
    assert events.closest_approach(r, tr, H=Scale.NEAR) is None


def test_near_miss_ignores_vehicles_cut_by_the_frame_edge():
    r, tr = crossing_pair([0, 6])
    assert events.closest_approach(r, tr, H=Scale.NEAR, frame_size=(1280, 720))
    assert events.closest_approach(r, tr, H=Scale.NEAR, frame_size=(151, 720)) is None


def speed_claim(track_id, kmh):
    return {"quantity": "speed_kmh", "subject_track": track_id, "value_number": kmh, "when": "unspecified"}


CTX = {"impact_t": None, "closest_t": None, "moment_tracks": []}


def test_a_claim_with_no_event_uses_the_tracks_own_speed():
    r = {"car": result("car", [0, 0], [12, 0])}  # 43 km/h
    out = claims.evaluate(speed_claim("car", 15), r, CTX)
    assert out["verdict"] == "inconsistent" and out["measured"]["kmh"] == pytest.approx(43.2, abs=1)


def test_a_moment_between_other_vehicles_does_not_judge_this_one():
    r = {"car": result("car", [0, 0], [12, 0])}
    out = claims.evaluate(speed_claim("car", 15), r, {**CTX, "closest_t": 99.0, "moment_tracks": ["x", "y"]})
    assert out["measured"] is not None and out["verdict"] == "inconsistent"


def test_a_range_too_wide_to_settle_a_claim_is_not_agreement():
    r = {"car": result("car", [0, 0], [5, 0], spread=15)}  # 18 km/h, about 50 km/h wide
    out = claims.evaluate(speed_claim("car", 15), r, CTX)
    assert out["verdict"] == "cant_tell" and "too wide" in out["reason"]
    assert claims.evaluate(speed_claim("car", 90), r, CTX)["verdict"] == "inconsistent"  # still rules out the absurd
    tight = {"car": result("car", [0, 0], [5, 0], spread=1)}
    assert claims.evaluate(speed_claim("car", 18), tight, CTX)["verdict"] == "consistent"


def test_speed_window_reports_the_time_actually_measured():
    w = events.window_speed(result("car", [0, 0], [5, 0]), -0.3, 0.7)
    assert w["t0"] == 0.0 and w["t1"] <= 0.7


class NoMatch:
    calls = 0

    def describe_scene(self, *a, **k):
        self.calls += 1
        return {"party_to_track": []}


def test_drivers_are_not_forced_onto_a_near_miss_pair():
    w = NoMatch()
    st = [{"id": "s1", "speaker": "A", "text": "x"}]
    _, party = match_parties(w, [0, 1], ["a", "b"], st, ["a", "b", "c"], ["a", "b"], True, None)
    assert party == {} and w.calls == 1


def test_a_users_assignment_comes_back_on_the_rerun():
    seen = []
    st = [{"id": "s1", "speaker": "A", "text": "x"}]
    _, party = match_parties(NoMatch(), [0], [], st, ["a"], [], False, {"s1": "a"}, lambda *e: seen.append(e))
    assert party == {"s1": "a"} and seen[0][1]["suggested"][0]["track_id"] == "a"


def test_momentum_without_data_is_not_called_unbalanced():
    text = " ".join(limitation_lines({"clock_method": "x", "impact": {"t": 1},
                                      "momentum_check": {"status": "insufficient_data"}, "signal_changes": [1]}))
    assert "could not be run" in text and "did not balance" not in text


def test_the_run_announces_statements_so_they_can_be_assigned_without_a_suggestion(tmp_path):
    """The UI lists statements for assignment from this event: Wonder may suggest nothing."""
    import json
    import shutil
    from pathlib import Path

    from sakshi.pipeline import run
    from sakshi.engine.uncertainty import MCConfig

    src = Path(__file__).parent.parent / "ui/public/scenarios/base"
    case = json.loads((src / "case.json").read_text())
    shutil.copy(src / "input.mp4", tmp_path)
    cal = case["calibration"]
    (tmp_path / "case_input.json").write_text(json.dumps({
        "statements": [{"id": "s1", "speaker": "Driver", "text": "I was slow."}],
        "calibration": {"image_pts": cal["image_pts"], "ground_pts_m": cal["ground_pts_m"]}}))
    seen = {}
    run(tmp_path, progress=lambda stage, data: seen.update({stage: data}), tracks_override=case["tracks"], mc=MCConfig(n=2))
    assert seen["statements"]["items"] == [{"id": "s1", "speaker": "Driver"}]
    assert "car-0" in seen["tracking"]["views"]
