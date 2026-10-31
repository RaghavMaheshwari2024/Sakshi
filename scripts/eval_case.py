"""Compare a case.json with ground truth (synthetic or CARLA gt.json).

Reports, per tracked vehicle: speed error (km/h, %, signed bias) and the share
of frames where the true speed lies inside our 90% interval; whether the
impact was found (or, for a near miss, correctly NOT found) and its time error;
dropped frames inferred vs true; and each claim's verdict against the verdict a
correct checker should give. Writes <case>/eval.json.

  python scripts/eval_case.py cases/carla_002
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def _ref_time(gt) -> float | None:
    if gt.get("t_impact") is not None:
        return gt["t_impact"]
    if isinstance(gt["frames"][0].get("A"), dict):  # CARLA near miss: closest approach
        best = min(gt["frames"], key=lambda r: np.hypot(r["A"]["x"] - r["B"]["x"], r["A"]["y"] - r["B"]["y"]))
        return best["t"]
    return None


def _match_tracks(case, gt_by_i) -> dict[str, str]:
    """CARLA: the ground frame IS the simulator's, so match tracks to vehicles
    by mean distance between trajectories."""
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
    return mapping


def _score_claims(case, gt, mapping) -> dict:
    expected = gt.get("expected_claims")
    if not expected:
        return {}
    rows, right = [], 0
    for e in expected:
        got = next((c for c in case["claims"]
                    if c.get("statement_id") == e["statement_id"] and c.get("quantity") == e["quantity"]), None)
        verdict = got["verdict"] if got else "not extracted"
        subject_ok = got is not None and mapping.get(got.get("subject_track")) == e["subject"]
        if verdict == e["expected"] or (e["expected"] == "either" and verdict in ("consistent", "inconsistent")):
            outcome = "correct"
        elif verdict in e.get("acceptable", []):
            outcome = "acceptable"
        else:
            outcome = "WRONG"
        right += outcome in ("correct", "acceptable")
        rows.append({"claim": f"{e['statement_id']} {e['quantity']} = {e['claimed']}", "true": e.get("true"),
                     "expected": e["expected"], "got": verdict, "subject_ok": subject_ok, "outcome": outcome,
                     "reason": got["reason"] if got else None})
    return {"claims_correct": f"{right}/{len(expected)}", "claims": rows}


def main(case_dir: str | Path, mapping: dict[str, str] | None = None, quiet: bool = False) -> dict:
    case_dir = Path(case_dir)
    case = json.loads((case_dir / "case.json").read_text())
    gt = json.loads((case_dir / "gt.json").read_text())
    gt_by_i = {f["i"]: f for f in gt["frames"]}
    carla = isinstance(gt["frames"][0].get("A"), dict)
    if mapping is None and carla:
        mapping = _match_tracks(case, gt_by_i)
    mapping = mapping or {"car-A": "A", "car-B": "B"}
    t_ref = _ref_time(gt)
    kind = gt.get("kind", "t_bone")
    report: dict = {"scenario": gt.get("scenario"), "kind": kind, "valid_render": gt.get("valid", True),
                    "contact_mode": (case.get("contact") or {}).get("mode", "lowest"),
                    "clock_method": case["clock"]["method"], "track_to_vehicle": mapping, "vehicles": {}}
    if "src_i" in gt["frames"][0]:
        src = [f["src_i"] for f in gt["frames"]]
        true_drops = int(sum(max(0, b - a - 1) for a, b in zip(src, src[1:])))
        report["dropped_frames"] = {"inferred": case["clock"].get("dropped_frames_inferred"), "true": true_drops}
    for traj in case["trajectories"]:
        name = mapping.get(traj["track"])
        if not name or t_ref is None:
            continue
        # "last_2s": where every claim is checked (the approach to the impact or
        # closest approach). "approach": everything from 0.4 s in. After contact a
        # camera sees two merged vehicles, so post-impact frames are not scored.
        for label, t_from in (("last_2s", t_ref - 2.0), ("approach", 0.4)):
            rows = []
            for i, t, v, lo, hi in zip(traj["i"], traj["t"], traj["speed_kmh"], traj["lo90_kmh"], traj["hi90_kmh"]):
                g = gt_by_i.get(i)
                if g is None or g["t"] > t_ref - 0.1 or g["t"] < t_from:
                    continue
                gv = g[f"{name}_speed_kmh"]
                rows.append((gv, v, lo <= gv <= hi))
            if not rows:
                continue
            a = np.array([(r[0], r[1]) for r in rows])
            err = a[:, 1] - a[:, 0]
            report["vehicles"].setdefault(traj["track"], {"vehicle": name})[label] = {
                "frames_scored": len(rows),
                "mae_kmh": round(float(np.abs(err).mean()), 2),
                "mape_pct": round(float((np.abs(err) / np.maximum(a[:, 0], 1)).mean() * 100), 2),
                "bias_pct": round(float((err / np.maximum(a[:, 0], 1)).mean() * 100), 2),
                "interval_coverage_pct": round(100 * np.mean([r[2] for r in rows]), 1),
            }
    found = case["events"][0] if case["events"] else None
    if kind == "near_miss":
        report["impact"] = ({"outcome": "correct: no impact"} if found is None else
                            {"outcome": "FALSE impact", "t": found["t"]})
        ca = case["facts"].get("closest_approach")
        if ca:
            report["closest_approach_t_error_s"] = round(ca["t"] - t_ref, 3) if t_ref is not None else None
    elif gt.get("t_impact") is None:
        report["impact"] = {"outcome": "no ground-truth impact (invalid render)"}
    elif found is None:
        report["impact"] = {"outcome": "MISSED"}
    else:
        report["impact"] = {"outcome": "detected", "t_error_s": round(found["t"] - gt["t_impact"], 3)}
    report["signal_changes"] = {"measured": case["facts"]["signal_changes"], "truth": gt.get("signal_changes")}
    report.update(_score_claims(case, gt, mapping))
    if "expected_verdicts" in gt:  # the synthetic case
        got = [c["verdict"] for c in case["claims"]]
        report["claims_correct"] = f"{sum(a == b for a, b in zip(got, gt['expected_verdicts']))}/{len(gt['expected_verdicts'])}"
    report["momentum_check"] = case["facts"]["momentum_check"]
    (case_dir / "eval.json").write_text(json.dumps(report, indent=1))
    if not quiet:
        print(json.dumps(report, indent=1))
    return report


if __name__ == "__main__":
    main(sys.argv[1])
