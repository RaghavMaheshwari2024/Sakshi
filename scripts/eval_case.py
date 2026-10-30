"""Compare a case.json with ground truth (synthetic or CARLA gt.json).

Reports, per tracked vehicle: speed mean absolute error (km/h and %), and the
share of frames where the true speed lies inside our 90% interval. Also the
impact-time error, signal-change errors and claim verdicts.

  python scripts/eval_case.py cases/synthetic
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np


def main(case_dir: str | Path, mapping: dict[str, str] | None = None) -> dict:
    case_dir = Path(case_dir)
    case = json.loads((case_dir / "case.json").read_text())
    gt = json.loads((case_dir / "gt.json").read_text())
    gt_by_i = {f["i"]: f for f in gt["frames"]}
    if mapping is None and isinstance(gt["frames"][0].get("A"), dict):
        # CARLA: the ground frame IS the simulator's, so match tracks to
        # vehicles by mean distance between trajectories.
        mapping = {}
        for traj in case["trajectories"]:
            best = None
            for name in ("A", "B"):
                d = [np.hypot(x - gt_by_i[i][name]["x"], y - gt_by_i[i][name]["y"])
                     for i, x, y in zip(traj["i"], traj["x"], traj["y"]) if i in gt_by_i]
                if d and (best is None or np.mean(d) < best[1]):
                    best = (name, float(np.mean(d)))
            if best and best[1] < 5.0:
                mapping[traj["track"]] = best[0]
    mapping = mapping or {"car-A": "A", "car-B": "B"}
    t_imp = gt["t_impact"]
    report = {"vehicles": {}, "clock_method": case["clock"]["method"], "track_to_vehicle": mapping}
    for traj in case["trajectories"]:
        name = mapping.get(traj["track"])
        if not name:
            continue
        # Two windows. "last_2s" is where every claim is checked (the approach to
        # impact). "approach" is everything from 0.4 s in, including far-away
        # frames. After contact a camera sees two merged vehicles, so post-impact
        # frames are not scored.
        for label, t_from in (("last_2s", t_imp - 2.0), ("approach", 0.4)):
            rows = []
            for i, t, v, lo, hi in zip(traj["i"], traj["t"], traj["speed_kmh"], traj["lo90_kmh"], traj["hi90_kmh"]):
                g = gt_by_i.get(i)
                if g is None or g["t"] > t_imp - 0.1 or g["t"] < t_from:
                    continue
                gv = g[f"{name}_speed_kmh"]
                rows.append((gv, v, lo <= gv <= hi))
            a = np.array([(r[0], r[1]) for r in rows])
            err = np.abs(a[:, 1] - a[:, 0])
            report["vehicles"].setdefault(traj["track"], {})[label] = {
                "frames_scored": len(rows),
                "mae_kmh": round(float(err.mean()), 2),
                "mape_pct": round(float((err / np.maximum(a[:, 0], 1)).mean() * 100), 2),
                "interval_coverage_pct": round(100 * np.mean([r[2] for r in rows]), 1),
            }
    if case["events"]:
        report["impact_t_error_s"] = round(case["events"][0]["t"] - t_imp, 3)
    report["signal_changes"] = {"measured": case["facts"]["signal_changes"], "truth": gt["signal_changes"]}
    report["claims"] = [{"quote": c["quote"], "verdict": c["verdict"], "reason": c["reason"]} for c in case["claims"]]
    if "expected_verdicts" in gt:
        got = [c["verdict"] for c in case["claims"]]
        report["claims_correct"] = f"{sum(a == b for a, b in zip(got, gt['expected_verdicts']))}/{len(gt['expected_verdicts'])}"
    report["momentum_check"] = case["facts"]["momentum_check"]
    print(json.dumps(report, indent=1))
    return report


if __name__ == "__main__":
    main(sys.argv[1])
