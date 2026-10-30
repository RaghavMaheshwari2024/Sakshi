"""Disk cache for every model call, so re-runs cost no API credit.

Keys are SHA-256 hashes of the request; values are JSON (or JSONL for streams).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .config import CACHE_DIR


def key_for(*parts: Any) -> str:
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, (bytes, bytearray)):
            h.update(p)
        else:
            h.update(json.dumps(p, sort_keys=True, default=str).encode())
        h.update(b"\x00")
    return h.hexdigest()[:32]


def file_sha(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _path(namespace: str, key: str, ext: str) -> Path:
    d = CACHE_DIR / namespace
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.{ext}"


def get_json(namespace: str, key: str) -> Any | None:
    p = _path(namespace, key, "json")
    return json.loads(p.read_text()) if p.exists() else None


def put_json(namespace: str, key: str, value: Any) -> None:
    _path(namespace, key, "json").write_text(json.dumps(value, indent=1, default=str))


def get_jsonl(namespace: str, key: str) -> list[dict] | None:
    p = _path(namespace, key, "jsonl")
    if not p.exists():
        return None
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def put_jsonl(namespace: str, key: str, rows: list[dict]) -> None:
    with _path(namespace, key, "jsonl").open("w") as f:
        for r in rows:
            f.write(json.dumps(r, default=str) + "\n")
