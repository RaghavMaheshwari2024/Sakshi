"""Append-only log of every Meta model call: which model, what job, how long.

This file is the evidence for the "Use of Meta AI tooling" criterion: one line
per call, summarised by `python scripts/usage_report.py`.
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager

from .config import LOG_DIR

LOG = LOG_DIR / "model_usage.jsonl"


@contextmanager
def logged(model: str, job: str, *, cached: bool = False, **extra):
    t0 = time.time()
    status = "ok"
    try:
        yield
    except Exception as exc:  # noqa: BLE001 - we re-raise after logging
        status = f"error: {type(exc).__name__}"
        raise
    finally:
        row = {
            "ts": round(t0, 3),
            "model": model,
            "job": job,
            "cached": cached,
            "seconds": round(time.time() - t0, 3),
            "status": status,
            **extra,
        }
        with LOG.open("a") as f:
            f.write(json.dumps(row, default=str) + "\n")
