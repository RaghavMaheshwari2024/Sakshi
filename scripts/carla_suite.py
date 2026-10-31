"""CARLA test suite for fixed-camera (CCTV) mode: render, degrade, run, score.

  python scripts/carla_suite.py --list                 # show the scenarios
  python scripts/carla_suite.py                        # run all (resumes where it stopped)
  python scripts/carla_suite.py --only base,near_miss  # run some
  python scripts/carla_suite.py --variants lowest      # skip the wheel-contact variant

Needs the CARLA server running on Town10HD_Opt (see README). Each scenario is
rendered once into cases/suite/<name>/, made CCTV-like, then run through the
full pipeline once per contact variant ("lowest" mask pixel, "wheels") in
cases/suite/<name>/<variant>/, and scored against ground truth. Footage
variants (low resolution, heavy drops, no clock...) reuse the base render.

Results: cases/suite/summary.md and summary.csv (one row per scenario and
variant), plus eval.json and log.txt in each case folder. Re-running skips
finished steps; --redo forces them again.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")

import eval_case  # noqa: E402  (scripts/ is on sys.path when run as a script)

SUITE = ROOT / "cases" / "suite"

# name: (what it tests, render args or "from:<scenario>", degrade args)
SCENARIOS: dict[str, tuple[str, list[str] | str, list[str]]] = {
    "base": ("side impact 50 vs 30 km/h, clear day (reference)", ["--cam-side", "4"], []),
    "slow": ("low speeds 25 vs 15 km/h", ["--cam-side", "4", "--v1", "25", "--v2", "15"], []),
    "fast": ("high speeds 80 vs 40 km/h", ["--cam-side", "4", "--v1", "80", "--v2", "40"], []),
    "braking": ("A brakes at 6 m/s^2 from 1.5 s before impact (65 -> ~33 km/h)",
                ["--cam-side", "4", "--v1", "65", "--brake-decel", "6", "--brake-before", "1.5"], []),
    "rear_end": ("rear-end: A 50 km/h into B 20 km/h ahead in the same lane",
                 ["--cam-side", "4", "--kind", "rear_end", "--v1", "50", "--v2", "20"], []),
    "near_miss": ("near miss: B clears 1 s before A; there must be NO impact",
                  ["--cam-side", "4", "--kind", "near_miss", "--miss-gap", "1.0"], []),
    "motorcycle": ("car hits a scooter (two-wheeler) at 35 km/h",
                   ["--cam-side", "4", "--b-vehicle", "motorcycle", "--v2", "35"], []),
    "night": ("same crash at night", ["--cam-side", "4", "--weather", "ClearNight"], []),
    "rain": ("same crash in heavy rain", ["--cam-side", "4", "--weather", "HardRainNoon"], []),
    "traffic": ("8 other cars driving around", ["--cam-side", "4", "--traffic", "8"], []),
    "junction2": ("another junction and approach pair", ["--seed", "2", "--cam-side", "4"], []),
    "high_camera": ("camera higher and further away (18 m up, 25 m beyond)",
                    ["--cam-side", "4", "--cam-height", "18", "--cam-ahead", "25"], []),
    "low_res": ("base footage at 640x360, heavy compression", "from:base", ["--scale", "0.5", "--crf", "36"]),
    "heavy_drops": ("base footage with 25% of frames dropped", "from:base", ["--drop", "0.25"]),
    "no_drops": ("base footage with no dropped or duplicated frames", "from:base", ["--drop", "0", "--dup", "0"]),
    "no_clock": ("base footage with no burned-in clock", "from:base", ["--no-clock"]),
}

SUITE_CONCEPTS = "car,motorcycle,traffic light"  # no pedestrians in these scenes


def sh(cmd: list[str], log: Path, env=None) -> int:
    with log.open("a") as f:
        f.write(f"\n$ {' '.join(cmd)}\n")
        f.flush()
        return subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT, cwd=ROOT, env=env).returncode


def carla_up() -> bool:
    try:
        import carla
        c = carla.Client("localhost", 2000)
        c.set_timeout(10.0)
        c.get_server_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def render(name: str, spec, d: Path, log: Path, redo: bool) -> str:
    if (d / "gt_clean.json").exists() and (d / "input_clean.mp4").exists() and not redo:
        return "cached"
    d.mkdir(parents=True, exist_ok=True)
    if isinstance(spec, str) and spec.startswith("from:"):
        base = SUITE / spec[5:]
        if not (base / "gt_clean.json").exists():
            return f"needs {spec[5:]} rendered first"
        shutil.copy(base / "gt_clean.json", d / "gt_clean.json")
        shutil.copy(base / "gt_clean.json", d / "gt.json")
        shutil.copy(base / "input_clean.mp4", d / "input_clean.mp4")
        return "copied"
    if not carla_up():
        return "CARLA not reachable"
    for stale in ("gt.json", "gt_clean.json", "input.mp4", "case_input.json"):
        (d / stale).unlink(missing_ok=True)
    code = sh([sys.executable, "sim/junction_crash.py", "--out", str(d), *spec], log)
    if code == 2:
        return "invalid render (see log)"
    if code != 0:
        return "render failed (see log)"
    shutil.copy(d / "gt.json", d / "gt_clean.json")
    shutil.rmtree(d / "frames", ignore_errors=True)  # ~300 MB; degrade reads input_clean.mp4
    return "rendered"


def run_variant(d: Path, variant: str, dargs: list[str], log: Path, redo: bool, samples: int) -> dict:
    v = d / variant
    if (v / "eval.json").exists() and not redo:
        return json.loads((v / "eval.json").read_text())
    v.mkdir(exist_ok=True)
    for f in ("gt.json", "input.mp4", "case_input.json"):
        shutil.copy(d / f, v / f)
    inp = json.loads((v / "case_input.json").read_text())
    inp["contact_mode"] = variant
    (v / "case_input.json").write_text(json.dumps(inp, indent=1))
    for stale in ("case.json", "input_h264.mp4"):
        (v / stale).unlink(missing_ok=True)
    env = {**os.environ, "SAKSHI_SAM_CONCEPTS": SUITE_CONCEPTS}
    code = sh([sys.executable, "scripts/run_case.py", str(v), "--samples", str(samples)], log, env=env)
    if code != 0 or not (v / "case.json").exists():
        return {"error": "pipeline failed (see log)"}
    return eval_case.main(v, quiet=True)


def row(name: str, variant: str, what: str, ev: dict, note: str = "") -> dict:
    r = {"scenario": name, "variant": variant, "tests": what, "note": note}
    if "error" in ev or not ev:
        r["note"] = ev.get("error", note) if ev else note
        return r
    imp = ev.get("impact", {})
    r["impact"] = imp.get("outcome", "")
    r["impact_err_s"] = imp.get("t_error_s", "")
    for veh in ("A", "B"):
        stats = next((s for s in ev.get("vehicles", {}).values() if s.get("vehicle") == veh), {})
        last = stats.get("last_2s", {})
        r[f"{veh}_err_pct"] = last.get("mape_pct", "")
        r[f"{veh}_bias_pct"] = last.get("bias_pct", "")
        r[f"{veh}_in90_pct"] = last.get("interval_coverage_pct", "")
    r["claims"] = ev.get("claims_correct", "")
    drops = ev.get("dropped_frames") or {}
    r["drops_inferred/true"] = f"{drops.get('inferred')}/{drops.get('true')}" if drops else ""
    r["clock"] = ev.get("clock_method", "")
    wrong = [c["claim"] for c in ev.get("claims", []) if c["outcome"] == "WRONG"]
    if wrong:
        r["note"] = (note + " wrong: " + "; ".join(wrong)).strip()
    return r


COLS = ["scenario", "variant", "impact", "impact_err_s", "A_err_pct", "A_bias_pct", "A_in90_pct",
        "B_err_pct", "B_bias_pct", "B_in90_pct", "claims", "drops_inferred/true", "clock", "note", "tests"]


def write_summary(rows: list[dict]):
    with (SUITE / "summary.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    lines = ["# CARLA suite (fixed camera)", "",
             "Speed error and 90% coverage are over the last 2 s before the impact (or closest approach).", "",
             "| " + " | ".join(COLS[:-1]) + " |", "|" + " --- |" * (len(COLS) - 1)]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(c, "")) for c in COLS[:-1]) + " |")
    lines += ["", "## What each scenario tests", ""]
    lines += [f"- **{n}**: {w}" for n, (w, _, _) in SCENARIOS.items()]
    (SUITE / "summary.md").write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list of scenario names")
    ap.add_argument("--variants", default="lowest,wheels", help="contact variants to run")
    ap.add_argument("--samples", type=int, default=200, help="Monte Carlo samples per run")
    ap.add_argument("--redo", action="store_true", help="redo finished steps")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args()
    if a.list:
        for n, (w, spec, dargs) in SCENARIOS.items():
            print(f"{n:<12} {w}")
        return
    names = [n for n in (a.only.split(",") if a.only else SCENARIOS) if n]
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit(f"Unknown scenario(s): {unknown}. See --list.")
    variants = [v for v in a.variants.split(",") if v]
    SUITE.mkdir(parents=True, exist_ok=True)
    rows, failures = [], 0
    for name in names:
        what, spec, dargs = SCENARIOS[name]
        d, t0 = SUITE / name, time.time()
        d.mkdir(parents=True, exist_ok=True)
        log = d / "log.txt"
        print(f"\n== {name}: {what}", flush=True)
        status = render(name, spec, d, log, a.redo)
        print(f"   render: {status}", flush=True)
        if status not in ("cached", "copied", "rendered"):
            rows.append(row(name, "-", what, {}, status))
            failures += status in ("CARLA not reachable", "render failed (see log)")
            if failures >= 2:
                print("\nCARLA seems down: restart it (see README troubleshooting), then rerun this command; "
                      "finished scenarios are skipped.")
                break
            continue
        failures = 0
        if a.redo or not (d / "input.mp4").exists() or status in ("rendered", "copied"):
            (d / "gt.json").write_text((d / "gt_clean.json").read_text())
            if sh([sys.executable, "sim/degrade.py", str(d), *dargs], log) != 0:
                rows.append(row(name, "-", what, {}, "degrade failed (see log)"))
                continue
        for v in variants:
            ev = run_variant(d, v, dargs, log, a.redo, a.samples)
            r = row(name, v, what, ev)
            rows.append(r)
            print(f"   {v:<7} impact {r.get('impact', '')} {r.get('impact_err_s', '')} | "
                  f"A {r.get('A_err_pct', '')}% in90 {r.get('A_in90_pct', '')}% | "
                  f"B {r.get('B_err_pct', '')}% in90 {r.get('B_in90_pct', '')}% | claims {r.get('claims', '')} "
                  f"{r.get('note', '')}", flush=True)
        print(f"   ({time.time() - t0:.0f} s)", flush=True)
        write_summary(rows)
    write_summary(rows)
    print(f"\nSummary: {SUITE / 'summary.md'}")


if __name__ == "__main__":
    main()
