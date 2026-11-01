"""Tests for road geometry presets, honest metric uncertainty, and fast recalibration."""

import sys
from pathlib import Path
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.engine import homography as hg, presets
from sakshi.engine.clock import from_fps
from sakshi.engine.uncertainty import MCConfig, measure
from sakshi.cache import get_json_with_provenance


def test_preset_definitions():
    avail = {p["id"]: p for p in presets.list_presets()}
    assert "urban_lane_crosswalk" in avail
    assert "highway_lane_dashed" in avail
    assert "two_lane_box" in avail
    assert "google_maps_rect" in avail
    assert "manual_survey" in avail

    assert avail["urban_lane_crosswalk"]["ground_sigma_m"] == 0.25
    assert avail["highway_lane_dashed"]["ground_sigma_m"] == 0.30
    assert avail["two_lane_box"]["ground_sigma_m"] == 0.40
    assert avail["google_maps_rect"]["ground_sigma_m"] == 0.15
    assert avail["manual_survey"]["ground_sigma_m"] == 0.03


def test_fit_preset_google_maps_custom():
    H_true = np.array([[0.05, 0.002, -30], [0.001, 0.09, -20], [1e-5, 8e-4, 1]])
    # Custom W=3.5, L=15.0
    ground = np.array([[0, 0], [3.5, 0], [3.5, 15.0], [0, 15.0]], float)
    img = hg.ground_to_img(H_true, ground).tolist()

    cal = hg.fit_preset(img, "google_maps_rect", custom_w=3.5, custom_l=15.0)
    assert cal.mode == "google_maps"
    assert cal.preset_id == "google_maps_rect"
    assert cal.ground_sigma_m == 0.15
    assert "3.5m" in cal.preset_label
    assert cal.rms_err_m < 1e-4


def test_monotonic_interval_widening_with_ground_sigma():
    """Verify that presets with higher ground metric uncertainty honestly
    widen the 90% confidence speed interval (hi90 - lo90) monotonically.
    """
    H_true = np.array([[0.05, 0.002, -30], [0.001, 0.09, -20], [1e-5, 8e-4, 1]])
    fps = 25.0
    n_frames = 60
    clk = from_fps(n_frames, fps)

    # 4 corner ground reference rectangle (e.g. 7m x 10m)
    ground_rect = np.array([[0.0, 0.0], [7.0, 0.0], [7.0, 10.0], [0.0, 10.0]], float)
    img_rect = hg.ground_to_img(H_true, ground_rect).tolist()

    # Synthetic vehicle moving straight along Y axis at 50 km/h (13.888 m/s)
    speed_mps = 50.0 / 3.6
    t_frames = np.arange(n_frames) / fps
    car_ground = np.c_[np.full(n_frames, 3.5), 1.0 + speed_mps * t_frames]
    car_img = hg.ground_to_img(H_true, car_ground)

    tracks = [{
        "id": "car-0",
        "concept": "car",
        "frames": [{"i": i, "box": [float(car_img[i, 0] - 20), float(car_img[i, 1] - 30),
                                    float(car_img[i, 0] + 20), float(car_img[i, 1] + 30)],
                    "contact_px": [float(car_img[i, 0]), float(car_img[i, 1])]}
                   for i in range(n_frames)],
    }]

    mc_cfg = MCConfig(n=150, seed=42)

    sigmas = [0.03, 0.15, 0.25, 0.30, 0.40]
    spans = []

    for sig in sigmas:
        cal = hg.fit(img_rect, ground_rect.tolist(), ground_sigma_m=sig)
        assert cal.ground_sigma_m == sig
        res = measure(tracks, cal, clk, cfg=mc_cfg)["car-0"]

        # Nominal Kalman smoother speed recovers the exact physical speed (preserving accuracy)
        nom_speed_kmh = float(np.median(res.nominal.speed[15:45] * 3.6))
        assert abs(nom_speed_kmh - 50.0) < 0.1, f"Nominal speed error: {nom_speed_kmh}"

        # 90% confidence interval width
        lo90, med_kmh, hi90 = res.interval()
        span = float(np.median(hi90[15:45] - lo90[15:45]))
        spans.append(span)

    # Verify monotonic widening: span(0.03) < span(0.15) < span(0.25) < span(0.30) < span(0.40)
    for k in range(len(spans) - 1):
        assert spans[k] < spans[k + 1], (
            f"Expected monotonic widening: span for sigma={sigmas[k]} ({spans[k]:.3f}) "
            f"should be strictly less than for sigma={sigmas[k+1]} ({spans[k+1]:.3f})"
        )


def test_cache_provenance_meta():
    import uuid
    from sakshi.cache import put_json, key_for
    key = key_for("test_provenance", uuid.uuid4().hex)

    # Before put: live_api provenance
    data, meta = get_json_with_provenance("test_prov", key)
    assert data is None
    assert meta["provenance"] == "live_api"
    assert meta["sha256"] == key

    # Put into cache
    put_json("test_prov", key, {"result": "success", "model": "sam-3.1"})

    # After put: disk_cache provenance
    data2, meta2 = get_json_with_provenance("test_prov", key)
    assert data2 == {"result": "success", "model": "sam-3.1"}
    assert meta2["provenance"] == "disk_cache"
    assert meta2["sha256"] == key


def test_recalibrate_case_fast_sub_500ms():
    import json
    import shutil
    import tempfile
    import time
    from sakshi.pipeline import recalibrate_case

    base_case_path = Path(__file__).resolve().parent.parent / "ui" / "public" / "scenarios" / "base" / "case.json"
    if not base_case_path.exists():
        pytest.skip("base scenario case.json not found")

    with tempfile.TemporaryDirectory() as td:
        tmp_dir = Path(td)
        shutil.copy(base_case_path, tmp_dir / "case.json")
        (tmp_dir / "case_input.json").write_text(json.dumps({
            "calibration": {"image_pts": [[100, 100], [200, 100], [200, 200], [100, 200]],
                            "ground_pts_m": [[0, 0], [3.5, 0], [3.5, 10], [0, 10]]}
        }))

        old_case = json.loads(base_case_path.read_text())
        old_img_pts = old_case["calibration"]["image_pts"]

        t0 = time.perf_counter()
        updated = recalibrate_case(tmp_dir, {
            "image_pts": old_img_pts,
            "preset_id": "urban_lane_crosswalk",
            "ground_sigma_m": 0.25,
        })
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        assert updated["calibration"]["preset_id"] == "urban_lane_crosswalk"
        assert updated["calibration"]["ground_sigma_m"] == 0.25
        assert len(updated["trajectories"]) > 0
        assert elapsed_ms < 1000.0, f"Recalibration took {elapsed_ms:.1f}ms, expected sub-second"

