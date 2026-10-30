"""Run the full pipeline on a case folder.

  python scripts/run_case.py cases/synthetic --offline    # uses tracks.json, no API calls
  python scripts/run_case.py cases/my_clip                # SAM 3.1 + Muse models
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()  # before sakshi.config reads the environment

from sakshi.engine.uncertainty import MCConfig  # noqa: E402
from sakshi.pipeline import run  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("--offline", action="store_true", help="use <case>/tracks.json instead of SAM 3.1")
    ap.add_argument("--samples", type=int, default=200, help="Monte Carlo samples")
    args = ap.parse_args()
    case = Path(args.case_dir)
    tracks = json.loads((case / "tracks.json").read_text()) if args.offline else None
    run(case, tracks_override=tracks, mc=MCConfig(n=args.samples))


if __name__ == "__main__":
    main()
