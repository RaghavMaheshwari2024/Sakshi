"""Regression tests for the problems found in the first CARLA run (Oct 31)."""

import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import clock, signals  # noqa: E402
from sakshi.meta.wonder import CLAIM_SCHEMA, SCENE_SCHEMA, _pin, fact_lines  # noqa: E402
from sakshi.pipeline import _light_at  # noqa: E402


def _clock_crop(text: str) -> np.ndarray:
    img = np.full((36, 324), 70, np.uint8)
    cv2.putText(img, text, (6, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 255, 2, cv2.LINE_AA)
    noise = np.random.default_rng(len(text)).normal(0, 3, img.shape)
    return np.clip(img + noise, 0, 255).astype(np.uint8)


def test_tick_detected_when_one_digit_changes():
    a, b, c = _clock_crop("30-10-2026 17:42:05"), _clock_crop("30-10-2026 17:42:05"), _clock_crop("30-10-2026 17:42:06")
    assert np.abs(c.astype(int) - b).mean() < 8      # the old average-change test missed this
    assert not clock.overlay_changed(a, b)
    assert clock.overlay_changed(b, c)
    assert clock.detect_ticks([a, b, c, c, c]) == [2]


def test_duplicate_survives_compression_noise():
    rng = np.random.default_rng(0)
    base = rng.integers(0, 255, (360, 640)).astype(np.uint8)
    dup = np.clip(base + rng.normal(0, 4, base.shape), 0, 255).astype(np.uint8)   # re-encoded copy
    moved = dup.copy()
    moved[100:130, 200:260] = 255 - moved[100:130, 200:260]                       # a small car moved
    assert clock.is_duplicate(base, dup)
    assert not clock.is_duplicate(base, moved)


def test_unlocated_drops_are_sampled_not_spread_evenly():
    # 1 s of footage holds 25 sensor frames but only 21 were recorded; no usable motion.
    n, ticks = 50, [(5, 1.0), (26, 2.0), (47, 3.0)]
    clk = clock.refine_with_motion(n, ticks, 25.0, {}, np.zeros(n, bool))
    rng = np.random.default_rng(0)
    samples = np.array([clk.sample(rng) for _ in range(50)])
    spread = samples[:, 15].std()
    assert spread > 0.01                                  # frame times inside the second vary
    assert np.allclose(samples[:, 26] - samples[:, 5], 1.0, atol=0.05)  # each second still 1 s


def test_painted_yellow_housing_is_not_amber():
    housing = np.zeros((40, 16, 3), np.uint8)
    housing[:] = (0, 200, 230)                            # yellow paint, BGR
    assert signals.classify_lamp(housing)[0] == "unclear"
    lit = np.full((40, 16, 3), 25, np.uint8)
    cv2.circle(lit, (8, 33), 5, (40, 220, 40), -1)        # green lamp lit on a dark head
    assert signals.classify_lamp(lit)[0] == "green"


def test_light_choice_ignores_short_tracks():
    long_far = {"id": "traffic_light-0", "concept": "traffic light",
                "frames": [{"i": i, "box": [500, 100, 520, 140]} for i in range(100)]}
    short_near = {"id": "traffic_light-7", "concept": "traffic light",
                  "frames": [{"i": i, "box": [40, 200, 62, 235]} for i in range(8)]}
    assert _light_at([long_far, short_near], [73, 252]) is None     # nearest is a flicker: no choice
    assert _light_at([long_far, short_near], [515, 120]) == "traffic_light-0"


def test_wonder_schemas_only_allow_real_ids():
    s = _pin(SCENE_SCHEMA, ["properties", "tracks", "items", "properties", "track_id"], ["car-1", "car-0"])
    assert s["properties"]["tracks"]["items"]["properties"]["track_id"]["enum"] == ["car-0", "car-1"]
    assert "enum" not in SCENE_SCHEMA["properties"]["tracks"]["items"]["properties"]["track_id"]  # copy
    c = _pin(CLAIM_SCHEMA, ["properties", "claims", "items", "properties", "statement_id"], ["s1", "s2"])
    assert c["properties"]["claims"]["items"]["properties"]["statement_id"]["enum"] == ["s1", "s2"]


def test_report_lines_written_from_facts():
    facts = {"impact": {"tracks": ["car-0", "car-1"], "t": 4.688, "t_sigma": 0.042},
             "speeds": {"car-1": {"just_before_impact": {"t0": 3.5, "t1": 4.5, "kmh": 53.2, "lo90": 50.7, "hi90": 55.1}}},
             "braking": {"car-1": {"detected": False}},
             "signal_changes": [{"t": 0.0, "state": "green"}, {"t": 7.8, "state": "unknown"}],
             "claims": [{"statement_id": "s1", "quote": "about 30", "verdict": "inconsistent",
                         "reason": "claimed about 30 km/h; measured 53.2 km/h"}]}
    timeline, findings = fact_lines(facts)
    assert timeline[0].startswith("t = 0.0 s: signal turns green")
    assert any("impact between car-0 and car-1" in x for x in timeline)
    assert "NOT consistent" in findings[0] and "53.2" in findings[0]


def test_validator_accepts_unsigned_deceleration():
    from sakshi.meta.wonder import unsupported_numbers
    facts = {"braking": {"car-1": {"peak_decel_ms2": -4.44}}}
    assert unsupported_numbers({"summary": "peak deceleration 4.44 m/s^2"}, facts) == []
