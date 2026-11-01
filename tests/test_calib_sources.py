"""Calibration without typed ground coordinates: road presets and satellite points."""

import json
import re
from pathlib import Path

import numpy as np
import pytest

from sakshi.engine import calib_sources as cs
from sakshi.engine import homography as hg
from sakshi.engine.clock import from_fps
from sakshi.engine.uncertainty import MCConfig, measure

# A camera above the road looking along +y: far points are higher in the image.
H_TRUE = np.linalg.inv(np.array([[200.0, -60.0, 640.0], [0.0, -30.0, 650.0], [0.0, 0.03, 1.0]]))


def corners(w, l):
    return hg.ground_to_img(H_TRUE, np.array([[0, 0], [w, 0], [w, l], [0, l]], float)).tolist()


def speed_span(cal, n=120):
    """A 50 km/h car on the road, measured through `cal`: (median speed, 90% span)."""
    fps, frames = 25.0, 30
    t = np.arange(frames) / fps
    g = np.c_[np.full(frames, 1.5), 1.0 + 50 / 3.6 * t]
    img = hg.ground_to_img(H_TRUE, g)
    track = {"id": "car-0", "concept": "car",
             "frames": [{"i": i, "box": [img[i, 0] - 20, img[i, 1] - 30, img[i, 0] + 20, img[i, 1]],
                         "contact_px": img[i].tolist()} for i in range(frames)]}
    r = measure([track], cal, from_fps(frames, fps), MCConfig(n=n, seed=3))["car-0"]
    lo, mid, hi = r.interval()
    return float(np.median(mid[8:22])), float(np.median((hi - lo)[8:22]))


def well_surveyed():
    ground = np.array([[0, 0], [8, 0], [8, 20], [0, 20], [4, 10], [8, 10]], float)
    return hg.fit(hg.ground_to_img(H_TRUE, ground), ground)


def test_manual_is_the_default_and_unchanged():
    ground = [[0, 0], [4, 0], [4, 6], [0, 6], [2, 3]]
    img = hg.ground_to_img(H_TRUE, np.array(ground, float)).tolist()
    cal = cs.resolve({"image_pts": img, "ground_pts_m": ground})
    assert cal.method == "manual" and cal.ground_model is None
    # Same random draws as the original Monte Carlo line, so old results do not move.
    a = cal.sample_ground(np.random.default_rng(1), 0.1)
    b = cal.ground_pts + np.random.default_rng(1).normal(0, 0.1, cal.ground_pts.shape)
    assert np.array_equal(a, b)


def test_preset_uses_its_rectangle_and_recovers_the_true_mapping():
    cal = cs.resolve({"method": "preset", "image_pts": corners(3.5, 3.0), "preset": {"id": "lane_zebra"}})
    assert cal.ground_pts.tolist() == [[0, 0], [3.5, 0], [3.5, 3], [0, 3]]
    assert np.allclose(hg.img_to_ground(cal.H, hg.ground_to_img(H_TRUE, np.array([[2.0, 20.0]]))), [[2, 20]], atol=1e-6)


def test_preset_ignores_nothing_silently():
    # The bug this design exists to prevent: extra points must be refused, not dropped.
    with pytest.raises(ValueError, match="exactly 4"):
        cs.resolve({"method": "preset", "image_pts": corners(3.5, 3)+[[1, 1]], "preset": {"id": "lane_zebra"}})
    with pytest.raises(ValueError, match="Unknown preset"):
        cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "nope"}})
    with pytest.raises(ValueError, match="custom rectangle needs"):
        cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "custom", "width_m": 3}})
    with pytest.raises(ValueError, match="between 0.5 m"):
        cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "lane_zebra", "width_m": -5}})
    with pytest.raises(ValueError, match="Unknown calibration method"):
        cs.resolve({"method": "guess", "image_pts": corners(3.5, 3)})


@pytest.mark.parametrize("order", [[0, 2, 1, 3], [3, 2, 1, 0]])
def test_preset_rejects_crossed_or_reversed_corners(order):
    pts = np.array(corners(3.5, 3))[order].tolist()
    with pytest.raises(ValueError, match="out of order"):
        cs.resolve({"method": "preset", "image_pts": pts, "preset": {"id": "lane_zebra"}})


def test_size_error_is_shared_by_all_corners():
    cal = cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "lane_zebra"}})
    rng = np.random.default_rng(0)
    draws = np.array([cal.sample_ground(rng, 0.1) for _ in range(800)])
    widths_near, widths_far = draws[:, 1, 0] - draws[:, 0, 0], draws[:, 2, 0] - draws[:, 3, 0]
    assert np.corrcoef(widths_near, widths_far)[0, 1] > 0.9
    assert widths_near.std() == pytest.approx(0.25, abs=0.04)


def test_assumed_size_widens_the_interval_compared_with_a_survey():
    img = corners(3.5, 6.0)
    surveyed = hg.fit(img, [[0, 0], [3.5, 0], [3.5, 6], [0, 6]])
    preset = cs.resolve({"method": "preset", "image_pts": img, "preset": {"id": "lane_stop_line"}})
    v1, s1 = speed_span(surveyed)
    v2, s2 = speed_span(preset)
    assert abs(v2 - speed_span(well_surveyed())[0]) < 3.0  # same road, same centre
    assert s2 > 1.2 * s1


def test_geo_conversion_matches_the_ui_fixture():
    fx = json.loads((Path(__file__).parent / "fixtures" / "geo_local.json").read_text())
    assert np.allclose(cs.geo_to_local_m(fx["geo"]), fx["local_m"], atol=1e-3)


def test_ui_presets_match_the_engine():
    ts = (Path(__file__).parent.parent / "ui/src/content/calibrationPresets.ts").read_text()
    for pid, p in cs.PRESETS.items():
        row = next(line for line in ts.splitlines() if f"id: '{pid}'" in line)
        for k in ("width_m", "length_m", "sigma_width_m", "sigma_length_m"):
            assert float(re.search(rf"\b{k}: ([0-9.]+)", row).group(1)) == p[k], (pid, k)


def test_geo_conversion_scale():
    p = cs.geo_to_local_m([[28.0, 77.0], [28.001, 77.0], [28.0, 77.001], [28.001, 77.001]])
    assert np.ptp(p[:, 1]) == pytest.approx(110.8, abs=0.3)  # 0.001 deg of latitude
    assert np.ptp(p[:, 0]) == pytest.approx(98.3, abs=0.3)  # shorter by cos(28)


def _satellite_body(n=6, zoom=20):
    ground = np.array([[0, 0], [8, 0], [8, 20], [0, 20], [4, 10], [8, 10]], float)[:n]
    lat0, lng0 = 28.6, 77.2
    geo = np.c_[lat0 + ground[:, 1] / 110_800, lng0 + ground[:, 0] / 97_800].tolist()
    return {"method": "satellite", "image_pts": hg.ground_to_img(H_TRUE, ground).tolist(), "geo_pts": geo, "map_zoom": zoom}


def test_satellite_measures_the_right_speed():
    cal = cs.resolve(_satellite_body())
    assert cal.method == "satellite" and cal.rms_err_m < 0.1
    assert cal.ground_model["sigma_m"] >= cs.SAT_MIN_SIGMA_M
    assert abs(speed_span(cal, n=40)[0] - speed_span(well_surveyed(), n=40)[0]) < 1.0


def test_satellite_sigma_follows_the_zoom_and_the_residuals():
    assert cs.resolve(_satellite_body(zoom=16)).ground_model["sigma_m"] > cs.resolve(_satellite_body(zoom=20)).ground_model["sigma_m"]
    assert cs.resolve(_satellite_body(zoom=None)).ground_model["sigma_m"] == cs.SAT_UNKNOWN_SIGMA_M
    bad = _satellite_body()
    bad["geo_pts"][4][0] += 5 / 110_800  # one map point 5 m out
    assert cs.resolve(bad).ground_model["sigma_m"] > 1.0


def test_satellite_rejects_bad_input():
    b = _satellite_body()
    with pytest.raises(ValueError, match="needs a map point"):
        cs.resolve({**b, "geo_pts": b["geo_pts"][:-1]})
    with pytest.raises(ValueError, match="more than 1 km"):
        cs.resolve({**b, "geo_pts": [[la + i * 0.01, ln] for i, (la, ln) in enumerate(b["geo_pts"])]})
    with pytest.raises(ValueError, match="valid latitude"):
        cs.resolve({**b, "geo_pts": [[99.0, ln] for _, ln in b["geo_pts"]]})
    with pytest.raises(ValueError, match="mirrored"):
        cs.resolve({**b, "geo_pts": [[la, 2 * 77.2 - ln] for la, ln in b["geo_pts"]]})


def test_warnings_explain_four_points_and_odd_camera_heights():
    cal = cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "lane_zebra"}})
    assert any("always fit" in w for w in cs.warnings(cal, 1280, 720))
    assert not any("always fit" in w for w in cs.warnings(cs.resolve(_satellite_body()), 1280, 720))


def test_report_states_the_basis_and_does_not_praise_a_four_point_fit():
    from sakshi.meta.wonder import limitation_lines

    cal = cs.resolve({"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "lane_zebra"}})
    text = " ".join(limitation_lines({"clock_method": "nominal_fps", "calibration_rms_m": 0.0,
                                      "calibration_points": 4, "calibration_basis": cs.basis_text(cal),
                                      "impact": {"t": 1}, "signal_changes": [1]}))
    assert "assumed, not measured" in text and "cannot be checked" in text
    assert "calibration error: 0" not in text


def test_api_stores_the_resolved_ground_and_refuses_bad_clicks(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    import api.app as app_mod

    monkeypatch.setattr(app_mod, "CASES_DIR", tmp_path)
    monkeypatch.setattr(app_mod, "_video", lambda d: d / "v.mp4")
    monkeypatch.setattr(app_mod, "probe", lambda p: type("I", (), {"width": 1280, "height": 720}))
    d = tmp_path / "c1"
    d.mkdir()
    (d / "case_input.json").write_text("{}")
    (d / "case.json").write_text("{}")
    client = TestClient(app_mod.app)
    assert "lane_zebra" in client.get("/cases/calibration-presets").json()
    r = client.post("/cases/c1/calibration", json={"method": "preset", "image_pts": corners(3.5, 3), "preset": {"id": "lane_zebra"}})
    assert r.status_code == 200 and r.json()["ground_pts_m"][2] == [3.5, 3.0]
    stored = json.loads((d / "case_input.json").read_text())["calibration"]
    assert stored["ground_pts_m"][2] == [3.5, 3.0] and cs.resolve(stored).method == "preset"
    assert not (d / "case.json").exists()  # stale results never survive a calibration change
    r = client.post("/cases/c1/calibration", json={"method": "preset", "image_pts": corners(3.5, 3)[:3], "preset": {"id": "lane_zebra"}})
    assert r.status_code == 400 and "exactly 4" in r.json()["detail"]
