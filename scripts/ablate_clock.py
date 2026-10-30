"""Ablation: how much does each timing method matter on a case with ground truth?

  python scripts/ablate_clock.py cases/synthetic

Runs the offline pipeline three times (nominal fps, clock ticks only, drop-aware
ticks + motion) and prints speed error and interval coverage for each. This is
the table that justifies the clock fix in the pitch.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import eval_case  # noqa: E402

from sakshi.engine.uncertainty import MCConfig  # noqa: E402
from sakshi.pipeline import run  # noqa: E402


def main(case_dir: str, samples: int = 150):
    src = Path(case_dir)
    tracks = json.loads((src / "tracks.json").read_text())
    rows = []
    for mode in ("nominal_fps", "ticks_only", "drop_aware"):
        with tempfile.TemporaryDirectory() as tmp:
            dst = Path(tmp) / "case"
            shutil.copytree(src, dst, ignore=shutil.ignore_patterns("case.json"))
            inp = json.loads((dst / "case_input.json").read_text())
            if mode != "drop_aware":
                inp["clock_mode"] = mode
            (dst / "case_input.json").write_text(json.dumps(inp))
            run(dst, progress=lambda *_: None, tracks_override=tracks, mc=MCConfig(n=samples))
            rep = _quiet_eval(dst)
            for tid, w in rep["vehicles"].items():
                for win, v in w.items():
                    rows.append((mode, tid, win, v["mape_pct"], v["mae_kmh"], v["interval_coverage_pct"]))
    print(f"\n{'clock method':<14} {'track':<7} {'window':<9} {'error %':>8} {'km/h':>6} {'in 90% interval':>16}")
    for r in rows:
        print(f"{r[0]:<14} {r[1]:<7} {r[2]:<9} {r[3]:>8.1f} {r[4]:>6.2f} {r[5]:>15.1f}%")


def _quiet_eval(dst: Path) -> dict:
    import contextlib
    import io

    with contextlib.redirect_stdout(io.StringIO()):
        return eval_case.main(str(dst))


if __name__ == "__main__":
    main(sys.argv[1])
