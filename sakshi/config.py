"""Central configuration. Every model name lives here, overridable by env vars.

Run `python scripts/list_models.py` once and fix any name that differs from
what your account lists.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(os.environ.get("SAKSHI_CACHE", ROOT / "cache"))
CASES_DIR = Path(os.environ.get("SAKSHI_CASES", ROOT / "cases"))
LOG_DIR = Path(os.environ.get("SAKSHI_LOGS", ROOT / "logs"))

META_BASE_URL = os.environ.get("META_BASE_URL", "https://api.meta.ai/v1")
META_ASR_URL = os.environ.get("META_ASR_URL", "https://api.meta.ai/v1/asr/transcribe")


def api_key() -> str:
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise RuntimeError("Set MODEL_API_KEY (see .env.example).")
    return key


# --- Meta Model API models -------------------------------------------------
SAM_MODEL = os.environ.get("SAKSHI_SAM_MODEL", "sam-3.1")
SPARK_MODEL = os.environ.get("SAKSHI_SPARK_MODEL", "muse-spark-1.3")
WONDER_MODEL = os.environ.get("SAKSHI_WONDER_MODEL", "muse-wonder-1.0")
VOICE_MODEL = os.environ.get("SAKSHI_VOICE_MODEL", "muse-voice-transcribe-1.0")

# --- Private mode: Muse Glimmer (open weights) behind any OpenAI-compatible
# server, e.g. `vllm serve meta-models/Muse-Glimmer-30B` on Modal.
PRIVATE_MODE = os.environ.get("SAKSHI_PRIVATE", "0") == "1"
GLIMMER_BASE_URL = os.environ.get("GLIMMER_BASE_URL", "http://localhost:8000/v1")
GLIMMER_MODEL = os.environ.get("GLIMMER_MODEL", "meta-models/Muse-Glimmer-30B")
GLIMMER_API_KEY = os.environ.get("GLIMMER_API_KEY", "not-needed")

# SAM 3.1 takes ONE short noun phrase per request (Meta docs), and tracks up to
# 16 objects per frame per request. Video is billed per frame, per request, so
# every concept multiplies cost: keep this list short and clips short.
SAM_CONCEPTS = [
    c.strip()
    for c in os.environ.get(
        "SAKSHI_SAM_CONCEPTS", "car,motorcycle,person,traffic light"
    ).split(",")
    if c.strip()
]

for d in (CACHE_DIR, CASES_DIR, LOG_DIR):
    d.mkdir(parents=True, exist_ok=True)
