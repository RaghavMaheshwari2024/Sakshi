"""Export the real CARLA validation results for the UI's Validation view.

  python ui/scripts/export_benchmark.py          # from the repo root

Reads what the suite already produced and writes ui/public/scenarios/benchmark.json:
  scenarios  one row per finished scenario, from cases/suite/<id>/lowest/eval.json
  series     per vehicle, frame by frame: true speed vs measured speed and 90% interval
  usage      per-model call counts and time, from logs/model_usage.jsonl
Nothing is computed by a model and nothing is re-run.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUITE = ROOT / "cases" / "suite"
OUT = ROOT / "ui" / "public" / "scenarios" / "benchmark.json"
VARIANT = "lowest"
EVERY_N_FRAMES = 2  # keeps the file small; scores below use every frame


def series(case: dict, gt: dict, ev: dict) -> dict:
    """True vs measured speed for each vehicle, up to just before the reference
    time (post-contact frames are not scored by eval_case.py either)."""
    by_i = {f["i"]: f for f in gt["frames"]}
    t_ref = gt.get("t_impact")
    if t_ref is None:  # near miss: closest approach, as eval_case.py does
        best = min(gt["frames"], key=lambda r: (r["A"]["x"] - r["B"]["x"]) ** 2 + (r["A"]["y"] - r["B"]["y"]) ** 2)
        t_ref = best["t"]
    out = {}
    for tr in case["trajectories"]:
        name = (ev.get("track_to_vehicle") or {}).get(tr["track"])
        if not name:
            continue
        rows = []
        for n, (i, t, v, lo, hi) in enumerate(zip(tr["i"], tr["t"], tr["speed_kmh"], tr["lo90_kmh"], tr["hi90_kmh"])):
            g = by_i.get(i)
            if g is None or g["t"] > t_ref - 0.1 or g["t"] < 0.4:
                continue
            if n % EVERY_N_FRAMES:
                continue
            rows.append({"i": i, "t": round(g["t"], 3), "truth": round(g[f"{name}_speed_kmh"], 2),
                         "v": round(v, 2), "lo": round(lo, 2), "hi": round(hi, 2)})
        out[name] = {"track": tr["track"], "rows": rows}
    return out


def usage() -> dict:
    path = ROOT / "logs" / "model_usage.jsonl"
    totals: dict = defaultdict(lambda: {"live_calls": 0, "cached_calls": 0, "live_seconds": 0.0, "jobs": defaultdict(int)})
    if path.exists():
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = totals[row.get("model", "unknown")]
            t["cached_calls" if row.get("cached") else "live_calls"] += 1
            if not row.get("cached"):
                t["live_seconds"] += float(row.get("seconds") or 0)
            t["jobs"][row.get("job", "other")] += 1
    return {m: {**v, "live_seconds": round(v["live_seconds"], 1), "jobs": dict(v["jobs"])} for m, v in totals.items()}


def main() -> None:
    tests = {}
    summary = SUITE / "summary.csv"
    if summary.exists():
        with summary.open() as fh:
            tests = {r["scenario"]: r.get("tests", "") for r in csv.DictReader(fh)}

    scenarios, all_series = [], {}
    for sdir in sorted(p for p in SUITE.iterdir() if (p / VARIANT / "eval.json").exists()):
        run = sdir / VARIANT
        ev = json.loads((run / "eval.json").read_text())
        case = json.loads((run / "case.json").read_text())
        gt = json.loads((run / "gt.json").read_text())
        claims = ev.get("claims") or []
        vehicles = {}
        for v in (ev.get("vehicles") or {}).values():
            vehicles[v["vehicle"]] = {"last_2s": v.get("last_2s"), "approach": v.get("approach")}
        scenarios.append({
            "id": sdir.name,
            "tests": tests.get(sdir.name, ""),
            "impact": ev.get("impact") or {},
            "true_impact_s": gt.get("t_impact"),
            "clock_method": ev.get("clock_method"),
            "dropped_frames": ev.get("dropped_frames") or {},
            "degradation": gt.get("degradation") or {},
            "claims": {
                "total": len(claims),
                "correct": sum(c.get("outcome") == "correct" for c in claims),
                "acceptable": sum(c.get("outcome") == "acceptable" for c in claims),
                "wrong": sum(c.get("outcome") == "WRONG" for c in claims),
                "rows": [{k: c.get(k) for k in ("claim", "true", "expected", "got", "outcome")} for c in claims],
            },
            "vehicles": vehicles,
        })
        all_series[sdir.name] = series(case, gt, ev)

    OUT.write_text(json.dumps({"variant": VARIANT, "scenarios": scenarios, "series": all_series, "usage": usage()},
                              separators=(",", ":"), ensure_ascii=False))
    print(f"{len(scenarios)} scenarios -> {OUT} ({OUT.stat().st_size / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
