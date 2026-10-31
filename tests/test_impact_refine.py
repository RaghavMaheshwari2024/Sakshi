"""Fixes from the first full CARLA suite run (Oct 31)."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import events  # noqa: E402
from sakshi.engine.kalman import Smoothed  # noqa: E402
from sakshi.engine.uncertainty import TrackResult  # noqa: E402

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


def _result(t, a, v0, n=60, noise_kmh=0.8):
    """A TrackResult moving along x with acceleration profile `a` (m/s^2)."""
    v = v0 + np.cumsum(a) * (t[1] - t[0])
    x = np.zeros((len(t), 6))
    x[:, 0], x[:, 2], x[:, 4] = np.cumsum(v) * (t[1] - t[0]), v, a
    sm = Smoothed(t, x, np.zeros((len(t), 6, 6)), np.ones(len(t), bool))
    sp = v * 3.6 + np.random.default_rng(1).normal(0, noise_kmh, (n, len(t)))
    return TrackResult("car-0", np.arange(len(t)), sm, sp, np.zeros((n, len(t), 2)))


T = np.arange(0, 4.0, 0.04)


def test_speed_blip_is_not_braking():
    # Seen at night / junction2 / no_clock: an unseen dropped frame makes the
    # speed jump up and come back; the way down looked like 0.4 s of braking.
    a = np.where((T >= 1.8) & (T < 2.0), 8.0, 0.0) + np.where((T >= 2.0) & (T < 2.4), -4.0, 0.0)
    b = events.braking_onset(_result(T, a, 13.9), 4.0)
    assert not b["detected"] and b.get("rejected_runs") == 1


def test_real_braking_until_impact_is_detected():
    a = np.where(T >= 2.5, -6.0, 0.0)  # brakes 1.5 s before the hit, 50 -> ~18 km/h
    b = events.braking_onset(_result(T, a, 13.9), 4.0)
    assert b["detected"] and abs(b["seconds_before_impact"] - 1.5) < 0.05 and b["speed_drop_kmh"] > 20


def test_short_firm_braking_released_early_is_detected():
    a = np.where((T >= 1.5) & (T < 2.1), -4.0, 0.0)  # 0.6 s at 4 m/s^2: ~8.6 km/h slower afterwards
    b = events.braking_onset(_result(T, a, 13.9), 4.0)
    assert b["detected"]


def test_braked_claim_in_words_is_a_yes():
    # Seen in the braking scenario: value_text "braked hard" was read as "no".
    from sakshi.engine.claims import _claimed_yes

    for text in ("yes", None, "braked hard", "I braked", "True", "hard braking"):
        assert _claimed_yes({"value_text": text}), text
    for text in ("no", "did not brake", "didn't brake", "brake bilkul nahi lagaya", "never braked", "false"):
        assert not _claimed_yes({"value_text": text}), text


def test_contact_hidden_by_vehicle_in_front_is_dropped():
    from sakshi.engine.contact import drop_occluded
    from sakshi.engine.events import MOVERS

    # Rear-end seen from ahead: B (front, nearer the camera, lower in the image)
    # hides A's lower edge, so A's lowest visible pixel sits on B's outline.
    a = [{"i": 0, "box": [100, 100, 200, 180], "contact_px": [150, 180]},   # clear of B
         {"i": 1, "box": [100, 110, 200, 205], "contact_px": [150, 205]}]   # inside B's box
    b = [{"i": 0, "box": [90, 190, 210, 260], "contact_px": [150, 260]},
         {"i": 1, "box": [90, 195, 210, 265], "contact_px": [150, 265]}]
    tracks = [{"id": "car-A", "concept": "car", "frames": a}, {"id": "car-B", "concept": "car", "frames": b},
              {"id": "traffic_light-0", "concept": "traffic light", "frames": [{"i": 1, "box": [0, 0, 300, 300]}]}]
    out, rep = drop_occluded(tracks, MOVERS)
    fa, fb = out[0]["frames"], out[1]["frames"]
    assert fa[0]["contact_px"] and fa[1]["contact_px"] is None and fa[1]["occluded_by"] == "car-B"
    assert all(f["contact_px"] for f in fb)  # the front vehicle is never hidden by the one behind
    assert rep == {"car-A": 1}


def test_claims_with_a_contradicting_quantity_are_repaired():
    # Seen live in the braking and slow scenarios.
    from sakshi.engine.claims import normalize

    def c(q, num=None, text=None, quote=""):
        return {"statement_id": "s1", "quantity": q, "value_number": num, "value_text": text, "quote": quote,
                "subject_track": "car-1", "when": "unspecified"}

    assert normalize(c("speed_kmh", text="green"))["quantity"] == "signal_state_at_stop_line"
    assert normalize(c("speed_kmh", text="green"))["when"] == "at_stop_line"
    assert normalize(c("speed_kmh", text="braked hard"))["quantity"] == "braked_before_impact"
    assert normalize(c("speed_kmh", text="did not brake at all"))["quantity"] == "braked_before_impact"
    assert normalize(c("stopped_before_impact", text="did_not_brake"))["quantity"] == "braked_before_impact"
    fixed = normalize(c("speed_kmh", text="braked hard"))
    assert fixed["quantity_model"] == "speed_kmh"
    # Left alone: a stated speed, a correct label, a vague speed.
    for claim in (c("speed_kmh", num=30.0, text="about 30", quote="I braked hard at about 30"),
                  c("braked_before_impact", text="yes"), c("speed_kmh", text="slow")):
        assert normalize(claim) == claim


def test_unmatched_statements_get_a_second_look_with_the_closeups():
    # Seen live (night, rain): Wonder matched nobody, and the retry crashed
    # because it was handed track ids instead of the close-up images.
    from sakshi.pipeline import match_parties

    class FakeWonder:
        def __init__(self):
            self.calls = []

        def describe_scene(self, frames, statements, track_ids, **kw):
            self.calls.append((frames, track_ids))
            if len(self.calls) == 1:
                return {"party_to_track": []}
            assert all(isinstance(f, np.ndarray) for f in frames)
            return {"party_to_track": [{"statement_id": "s1", "track_id": "car-1", "reason": ""}]}

    keyframes = [np.zeros((10, 10, 3), np.uint8) for _ in range(5)]  # 3 keyframes + 2 close-ups
    w = FakeWonder()
    scene, party = match_parties(w, keyframes, ["car-0", "car-1"], [{"id": "s1"}, {"id": "s2"}],
                                 ["car-0", "car-1"], ["car-0", "car-1"], False, None)
    assert len(w.calls) == 2 and len(w.calls[1][0]) == 2 and w.calls[1][0][0] is keyframes[3]
    assert party == {"s1": "car-1", "s2": "car-0"}
    assert "asked again with close-ups only" in scene["party_checks"]


# --- Claim reading: check, ask once more, never a verdict on a broken claim ---

def _c(sid, q, subj, num=None, text=None, quote="q"):
    return {"statement_id": sid, "quantity": q, "subject_track": subj, "value_number": num, "value_text": text,
            "quote": quote, "when": "at_stop_line" if q.startswith("signal") else "unspecified"}


GOOD = [_c("s1", "speed_kmh", "car-2", 30.0), _c("s1", "signal_state_at_stop_line", "car-2", text="green"),
        _c("s2", "speed_kmh", "car-3", 30.0), _c("s2", "braked_before_impact", "car-2", text="no")]
# Seen live in the traffic scenario: speed and colour merged, a number on a
# braking claim, and two claims with no value at all.
BAD = [_c("s1", "speed_kmh", "car-2", 30.0, "green"), _c("s1", "speed_kmh", "car-2"),
       _c("s2", "braked_before_impact", "car-3", 30, "did_not_brake"), _c("s2", "braked_before_impact", "car-2")]
STATEMENTS = [{"id": "s1", "speaker": "", "text": ""}, {"id": "s2", "speaker": "", "text": ""}]
PARTY = {"s1": "car-2", "s2": "car-3"}


class _Wonder:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def extract_claims(self, statements, party, previous=None, problems=None):
        self.calls.append(problems)
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def test_problems_flags_the_live_traffic_failures():
    from sakshi.engine.claims import normalize, problems

    found = [problems(normalize(c), ["s1", "s2"], ["car-2", "car-3"]) for c in BAD]
    assert all(found), found
    assert not any(problems(normalize(c), ["s1", "s2"], ["car-2", "car-3"]) for c in GOOD)


def test_malformed_claims_are_asked_again_and_fixed():
    from sakshi.pipeline import read_claims

    w = _Wonder([BAD, GOOD])
    out = read_claims(w, STATEMENTS, PARTY)
    assert len(w.calls) == 2 and w.calls[1]  # the second request carries the problems
    assert out == GOOD


def test_still_malformed_claims_get_no_verdict():
    from sakshi.engine.claims import evaluate
    from sakshi.pipeline import read_claims

    out = read_claims(_Wonder([BAD, BAD]), STATEMENTS, PARTY)
    assert all(c.get("unreadable") for c in out)
    v = evaluate(out[3], {}, {})
    assert v["verdict"] == "cant_tell" and v["reason"].startswith("could not read")


def test_retry_failure_or_empty_answer_does_not_lose_claims():
    from sakshi.pipeline import read_claims

    mixed = GOOD[:2] + BAD[1:2]  # two good claims, one empty one
    for second in (RuntimeError("network down"), []):
        out = read_claims(_Wonder([mixed, second]), STATEMENTS, PARTY)
        assert out[:2] == GOOD[:2] and out[2].get("unreadable")


def test_good_claims_need_one_request_only():
    from sakshi.pipeline import read_claims

    w = _Wonder([GOOD])
    assert read_claims(w, STATEMENTS, PARTY) == GOOD and len(w.calls) == 1


def test_temperature_rejected_by_the_server_falls_back(monkeypatch):
    import contextlib
    import json as _json
    from types import SimpleNamespace

    from sakshi.meta import wonder

    calls = []

    def create(**kw):
        calls.append(kw)
        if "temperature" in kw:
            raise RuntimeError("400: temperature is not supported for this model")
        msg = SimpleNamespace(content=_json.dumps({"claims": []}))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(wonder, "sync_client", lambda: client)
    monkeypatch.setattr(wonder, "text_client_and_model", lambda m: (client, m, m))
    monkeypatch.setattr(wonder.cache, "get_json", lambda *a: None)
    monkeypatch.setattr(wonder.cache, "put_json", lambda *a: None)
    monkeypatch.setattr(wonder, "logged", lambda *a, **k: contextlib.nullcontext())
    assert wonder.extract_claims(STATEMENTS, PARTY) == []
    assert len(calls) == 2 and calls[0]["temperature"] == 0 and "temperature" not in calls[1]


def test_third_statement_from_outside_the_collision_is_kept():
    # Chain collision: three drivers, the measured collision has two vehicles.
    from sakshi.pipeline import check_party

    party, notes = check_party({"s1": "car-0", "s2": "car-1", "s3": "car-2"}, ["s1", "s2", "s3"], ["car-0", "car-1"])
    assert party == {"s1": "car-0", "s2": "car-1", "s3": "car-2"} and notes
    # Still one vehicle per statement.
    party, _ = check_party({"s1": "car-0", "s2": "car-1", "s3": "car-1"}, ["s1", "s2", "s3"], ["car-0", "car-1"])
    assert "s3" not in party


def test_report_limitations_are_written_by_code(monkeypatch):
    # Seen live (near_miss): Wonder's limitations included "the evaluation of the
    # footage was conducted by skilled and experienced personnel", and its
    # summary carried its own "Limitations:" block.
    from sakshi.meta import wonder

    facts = {"impact": None, "closest_approach": {"tracks": ["car-0", "car-1"], "t": 4.768, "gap_m": 8.31},
             "speeds": {}, "braking": {},
             "momentum_check": None, "signal_changes": [], "signal_track": None,
             "signal_note": "5 traffic lights in view; choose which one governs the stop line",
             "claims": [], "clock_method": "clock_ticks+motion", "calibration_rms_m": 0.433}
    reply = {"summary": "No impact; the white car was faster than claimed.\n\nLimitations:\n- fact, skilled personnel"}
    monkeypatch.setattr(wonder, "_chat_json", lambda *a, **k: dict(reply))
    r = wonder.write_report(facts)
    assert "Limitations" not in r["summary"] and "personnel" not in " ".join(r["limitations"])
    text = " ".join(r["limitations"])
    assert "closest approach" in text and "Traffic-light claims cannot be checked" in text
    assert r["validator"]["passed"]
