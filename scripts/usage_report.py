"""Summarise logs/model_usage.jsonl: calls per Meta model and job.

  python scripts/usage_report.py      # paste the table into the deck/README
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sakshi.usage_log import LOG  # noqa: E402

rows = [json.loads(line) for line in LOG.read_text().splitlines()] if LOG.exists() else []
agg = defaultdict(lambda: {"live": 0, "cached": 0, "seconds": 0.0, "errors": 0})
for r in rows:
    a = agg[(r["model"], r["job"])]
    a["cached" if r["cached"] else "live"] += 1
    a["seconds"] += r["seconds"]
    a["errors"] += r["status"] != "ok"
print(f"{'model':<28} {'job':<26} {'live':>5} {'cached':>7} {'errors':>7} {'sec':>8}")
for (m, j), a in sorted(agg.items()):
    print(f"{m:<28} {j:<26} {a['live']:>5} {a['cached']:>7} {a['errors']:>7} {a['seconds']:>8.1f}")
