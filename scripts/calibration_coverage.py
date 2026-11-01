"""Does an assumed road size still give honest speed intervals?

Replays the CARLA suite's real tracks through calibrations a user without a
survey could produce, where the road differs from what the preset assumes, and
scores them against the simulator's true speeds:

  surveyed   the suite's own calibration (the baseline)
  preset     4 clicked corners of a rectangle whose true size is off by 0, 1 and 2 sigma
  satellite  6 map points, each off by the noise the method allows for

Writes ui/public/scenarios/calibration_coverage.json for the Validation view.
No model is called.

  python scripts/calibration_coverage.py [--samples 100]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from sakshi.engine import calib_sources as cs  # noqa: E402
from sakshi.engine import events  # noqa: E402
from sakshi.engine import homography as hg  # noqa: E402
from sakshi.engine.clock import FrameClock  # noqa: E402
from sakshi.engine.uncertainty import MCConfig, measure  # noqa: E402

SUITE = ROOT / "cases" / "suite"
OUT = ROOT / "ui" / "public" / "scenarios" / "calibration_coverage.json"
CLICK_PX = 2.0
M_PER_DEG = 110_800.0  # any scale: the map frame is rebuilt from the same numbers


def clock_of(case: dict) -> FrameClock:
    c = case["clock"]
    t = np.array([f["t"] for f in c["frames"]], float)
    return FrameClock(t=t, sigma=np.full(len(t), c.get("median_sigma_s", 0.01)), method=c["method"],
                      duplicate=np.array([f.get("dup", False) for f in c["frames"]], bool))


def road_frame(gt: dict, t_ref: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Where A is before the reference time, and unit vectors along and across its road."""
    pts = np.array([[f["A"]["x"], f["A"]["y"]] for f in gt["frames"] if t_ref - 1.5 <= f["t"] <= t_ref])
    along = pts[-1] - pts[0]
    along = along / max(np.linalg.norm(along), 1e-6)
    return pts.mean(0), along, np.array([-along[1], along[0]])


def corners_on_road(H_true, centre, along, across, w, l) -> np.ndarray:
    """Pixels of the road rectangle, in the winding the preset expects. CARLA's
    frame is left-handed, so `across` may need flipping."""
    for sign in (1, -1):
        g = np.array([centre + sign * a * across + b * along
                      for a, b in ((-w / 2, -l / 2), (w / 2, -l / 2), (w / 2, l / 2), (-w / 2, l / 2))])
        img = hg.ground_to_img(H_true, g)
        try:
            cs._check_convex_quad(img)
            return img
        except ValueError:
            continue
    raise ValueError("rectangle not visible as a quad")


def score(cal, tracks, mapping, clk, gt, t_ref, samples) -> list[dict]:
    res = measure(tracks, cal, clk, MCConfig(n=samples))
    by_i = {f["i"]: f for f in gt["frames"]}
    rows = []
    for tid, r in res.items():
        name = mapping.get(tid)
        lo, mid, hi = r.interval()
        for i, v, a, b in zip(r.frames, mid, lo, hi):
            g = by_i.get(int(i))
            if g is None or not t_ref - 2.0 <= g["t"] <= t_ref - 0.1 or name not in ("A", "B"):
                continue
            truth = g[f"{name}_speed_kmh"]
            rows.append({"err": float(v - truth), "cover": bool(a <= truth <= b), "span": float(b - a)})
    return rows


def summarise(rows: list[dict]) -> dict:
    return {"frames": len(rows),
            "mae_kmh": round(float(np.mean([abs(r["err"]) for r in rows])), 2),
            "coverage_pct": round(100 * float(np.mean([r["cover"] for r in rows])), 1),
            "median_span_kmh": round(float(np.median([r["span"] for r in rows])), 1)}


def scenario(d: Path, samples: int, rng, pool: dict[str, list]) -> None:
    case = json.loads((d / "case.json").read_text())
    gt = json.loads((d / "gt.json").read_text())
    ev = json.loads((d / "eval.json").read_text())
    mapping = ev.get("track_to_vehicle") or {}
    t_ref = gt.get("t_impact")
    if t_ref is None:
        best = min(gt["frames"], key=lambda r: np.hypot(r["A"]["x"] - r["B"]["x"], r["A"]["y"] - r["B"]["y"]))
        t_ref = best["t"]
    clk = clock_of(case)
    last = max(f["i"] for f in gt["frames"] if f["t"] <= t_ref)
    tracks = [{**t, "frames": [f for f in t["frames"] if f["i"] <= last]} for t in case["tracks"]
              if t["concept"] in events.MOVERS and t["id"] in mapping]
    c = case["calibration"]
    surveyed = hg.fit(c["image_pts"], c["ground_pts_m"])
    pool["surveyed"] += score(surveyed, tracks, mapping, clk, gt, t_ref, samples)
    centre, along, across = road_frame(gt, t_ref)

    for pid, p in cs.PRESETS.items():
        for z in (0, 1, 2):
            sign = rng.choice([-1, 1], 2)
            w = p["width_m"] + sign[0] * z * p["sigma_width_m"]
            l = p["length_m"] + sign[1] * z * p["sigma_length_m"]
            try:
                img = corners_on_road(surveyed.H, centre, along, across, w, l)
                img = img + rng.normal(0, CLICK_PX, img.shape)
                cal = cs.resolve({"method": "preset", "image_pts": img.tolist(), "preset": {"id": pid}})
            except ValueError as exc:
                print(f"  {d.parent.name} {pid} {z} sigma: skipped ({exc})")
                continue
            pool[f"{pid}/{z}sigma"] += score(cal, tracks, mapping, clk, gt, t_ref, samples)

    # Six road points around the scene, read off a map with the allowed noise.
    offs = np.array([[-6, -15], [6, -15], [6, 15], [-6, 15], [-6, 0], [6, 0]], float)
    ground = centre + offs[:, 0:1] * across + offs[:, 1:2] * along
    img = hg.ground_to_img(surveyed.H, ground)
    for sign in (1, -1):  # a map is right-handed; CARLA's frame is not
        local = np.c_[sign * offs[:, 0], offs[:, 1]] + rng.normal(0, cs.SAT_MIN_SIGMA_M, offs.shape)
        geo = np.c_[28.6 + local[:, 1] / M_PER_DEG, 77.2 + local[:, 0] / (M_PER_DEG * np.cos(np.radians(28.6)))]
        try:
            cal = cs.resolve({"method": "satellite", "image_pts": (img + rng.normal(0, CLICK_PX, img.shape)).tolist(),
                              "geo_pts": geo.tolist(), "map_zoom": 20})
        except ValueError:
            continue
        pool["satellite"] += score(cal, tracks, mapping, clk, gt, t_ref, samples)
        break


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=100)
    args = ap.parse_args()
    rng = np.random.default_rng(11)
    pool: dict[str, list] = {"surveyed": [], "satellite": []}
    for pid in cs.PRESETS:
        for z in (0, 1, 2):
            pool[f"{pid}/{z}sigma"] = []
    dirs = sorted(p for p in SUITE.glob("*/lowest") if (p / "eval.json").exists() and (p / "gt.json").exists())
    for d in dirs:
        print(d.parent.name, flush=True)
        scenario(d, args.samples, rng, pool)
    out = {"scenarios": len(dirs), "samples": args.samples, "click_px": CLICK_PX,
           "note": "Last 2 s before impact or closest approach; true sizes off by 0, 1 and 2 sigma from the preset.",
           "presets": {k: {"label": v["label"], "width_m": v["width_m"], "length_m": v["length_m"],
                           "sigma_width_m": v["sigma_width_m"], "sigma_length_m": v["sigma_length_m"]}
                       for k, v in cs.PRESETS.items()},
           "results": {k: summarise(v) for k, v in pool.items() if v}}
    OUT.write_text(json.dumps(out, indent=1))
    print(json.dumps(out["results"], indent=1))


if __name__ == "__main__":
    main()
