"""Export the finished CARLA suite runs as static scenarios for the UI.

  python ui/scripts/export_scenarios.py                 # from the repo root
  python ui/scripts/export_scenarios.py --suite cases/suite --out ui/public/scenarios

For every scenario with a finished run (cases/suite/<name>/lowest/case.json),
writes ui/public/scenarios/<name>/ with:
  case.json   the pipeline result, as the UI reads it
  input.mp4   the footage, re-muxed for instant playback (no re-encode)
  thumb.jpg   a frame at the impact (or the closest approach)
and ui/public/scenarios/index.json listing them with their scores against
CARLA ground truth (from eval.json), so the picker can show them.
Nothing is re-run: it only copies what the suite already produced.
Needs ffmpeg on the PATH.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

# id: (group, title, what it shows)
SCENARIOS = {
    "base": ("Crash types", "Side impact, clear day", "White car at 50 km/h hits a blue car crossing at 30 km/h"),
    "slow": ("Crash types", "Low speeds", "25 vs 15 km/h"),
    "fast": ("Crash types", "High speeds", "80 vs 40 km/h"),
    "braking": ("Crash types", "Braking before impact", "White car brakes hard from 65 km/h 1.5 s before the hit"),
    "rear_end": ("Crash types", "Rear-end", "White car at 50 km/h runs into a car doing 20 km/h ahead"),
    "near_miss": ("Crash types", "Near miss", "The blue car clears the junction 1 s before the white car: no impact"),
    "motorcycle": ("Crash types", "Car hits a scooter", "Two-wheeler at 35 km/h"),
    "night": ("Conditions", "Night", "The base crash at night, headlights on"),
    "rain": ("Conditions", "Heavy rain", "The base crash in heavy rain"),
    "traffic": ("Conditions", "Busy junction", "8 other cars driving around"),
    "junction2": ("Conditions", "Another junction", "A different junction and approach pair"),
    "high_camera": ("Conditions", "High, distant camera", "Camera 18 m up and 25 m beyond the junction"),
    "low_res": ("Footage quality", "Low resolution", "640x360 with heavy compression"),
    "heavy_drops": ("Footage quality", "25% frames dropped", "A quarter of the frames lost by the recorder"),
    "no_drops": ("Footage quality", "Clean footage", "No dropped or duplicated frames"),
    "no_clock": ("Footage quality", "No burned-in clock", "No on-screen clock to recover dropped frames"),
}


def _vehicle_stats(ev: dict) -> dict:
    out = {}
    for tid, v in (ev.get("vehicles") or {}).items():
        last = v.get("last_2s") or {}
        out[v.get("vehicle", tid)] = {"track": tid, "error_pct": last.get("mape_pct"),
                                      "in90_pct": last.get("interval_coverage_pct")}
    return out


def export(suite: Path, out: Path, variant: str) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    index = []
    for sid, (group, title, desc) in SCENARIOS.items():
        run = suite / sid / variant
        case_p = run / "case.json"
        if not case_p.exists():
            print(f"  skip {sid}: no finished run at {run}")
            continue
        video = next((p for p in (run / "input_h264.mp4", run / "input.mp4", suite / sid / "input.mp4") if p.exists()), None)
        if video is None:
            print(f"  skip {sid}: no video")
            continue
        case = json.loads(case_p.read_text())
        ev = json.loads((run / "eval.json").read_text()) if (run / "eval.json").exists() else {}
        dst = out / sid
        dst.mkdir(exist_ok=True)
        shutil.copy(case_p, dst / "case.json")
        # Moov atom first, so the browser starts playing before the file has fully arrived.
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(video), "-c", "copy",
                        "-movflags", "+faststart", str(dst / "input.mp4")], check=True)
        moment = (case.get("events") or [None])[0] or (case.get("facts") or {}).get("closest_approach")
        fps = case["clip"]["fps_nominal"]
        t_thumb = (moment["i"] + 0.5) / fps if moment else 0.0
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t_thumb:.3f}", "-i", str(dst / "input.mp4"),
                        "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", str(dst / "thumb.jpg")], check=True)
        verdicts = [c.get("verdict") for c in case.get("claims", [])]
        impact = ev.get("impact") or {}
        index.append({
            "id": sid, "group": group, "title": title, "description": desc,
            "camera_mode": case.get("camera_mode", "fixed"),
            "impact": bool(case.get("events")),
            "impact_outcome": impact.get("outcome"),
            "impact_error_s": impact.get("t_error_s"),
            "claims": len(verdicts),
            "claims_correct": ev.get("claims_correct"),
            "verdicts": {v: verdicts.count(v) for v in ("consistent", "inconsistent", "cant_tell") if v in verdicts},
            "vehicles": _vehicle_stats(ev),
            "frames": case["clip"]["frames"],
        })
        print(f"  {sid}: {title} ({len(verdicts)} claims, eval {ev.get('claims_correct', 'n/a')})")
    (out / "index.json").write_text(json.dumps({"default": "base", "scenarios": index}, indent=1))
    return index


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", default="cases/suite")
    ap.add_argument("--out", default="ui/public/scenarios")
    ap.add_argument("--variant", default="lowest")
    a = ap.parse_args()
    idx = export(Path(a.suite), Path(a.out), a.variant)
    print(f"Exported {len(idx)} scenarios to {a.out}")


if __name__ == "__main__":
    main()
