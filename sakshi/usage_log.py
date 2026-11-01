"""Append-only log of every Meta model call: which model, what job, how long.

This file is the evidence for the "Use of Meta AI tooling" criterion: one line
per call, summarised by `python scripts/usage_report.py`.
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Callable

from .config import LOG_DIR

LOG = LOG_DIR / "model_usage.jsonl"
MAX_SHOWN_CHARS = 240

# A run listens here to show each model's output as it arrives. The log file keeps
# only the call, never its content: statements can be sensitive.
_observer: ContextVar[Callable[[dict], None] | None] = ContextVar("usage_observer", default=None)


def observe(fn: Callable[[dict], None] | None):
    """Send every shown call in this context to `fn`. Returns a token for `stop_observing`."""
    return _observer.set(fn)


def stop_observing(token) -> None:
    _observer.reset(token)


def show(call: dict, output) -> None:
    """Report a finished call and what the model actually returned."""
    fn = _observer.get()
    if fn is None:
        return
    text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, default=str)
    fn({k: call[k] for k in ("model", "job", "cached", "seconds")} |
       {"output": text[:MAX_SHOWN_CHARS] + ("…" if len(text) > MAX_SHOWN_CHARS else "")})


@contextmanager
def logged(model: str, job: str, *, cached: bool = False, **extra):
    t0 = time.time()
    status = "ok"
    call: dict = {"model": model, "job": job, "cached": cached, "seconds": 0.0}
    try:
        yield call
    except Exception as exc:  # noqa: BLE001 - we re-raise after logging
        status = f"error: {type(exc).__name__}"
        raise
    finally:
        call["seconds"] = round(time.time() - t0, 3)
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
