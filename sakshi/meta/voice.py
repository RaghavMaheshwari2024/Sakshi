"""Muse Voice Transcribe: recorded statements to text.

Uses the one-shot endpoint exactly as Meta's cookbook does
(06_muse_voice/01_voice_api_fundamentals/utils.py, MIT): multipart POST with a
JSON `request` part and the `audio` part. Audio is converted to mono 16-bit
24 kHz WAV first (the engine's native rate). Limit: 10 minutes or 32 MB.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import requests

from .. import cache, config
from ..usage_log import logged


def _to_wav(src: Path) -> Path:
    from ..video import require_ffmpeg

    require_ffmpeg()
    out = Path(tempfile.mkstemp(suffix=".wav")[1])
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "24000",
         "-sample_fmt", "s16", str(out)],
        check=True,
    )
    return out


def transcribe(path: str | Path, *, languages: list[str] | None = None,
               diarize: bool = False,
               on_theatre_event: Callable[[dict], None] | None = None) -> dict:
    """Returns {"transcript", "turns", "audioDurationMs", ...}.

    `languages` are English names used as a bias, e.g. ["Hindi", "English"].
    """
    t0 = time.time()
    src = Path(path)
    mode = "DIARIZATION" if diarize else "PUSH_TO_TALK"
    key = cache.key_for(config.VOICE_MODEL, cache.file_sha(src), mode, languages)
    hit, meta = cache.get_json_with_provenance("voice", key)
    if hit is not None:
        with logged(config.VOICE_MODEL, "transcribe statement", cached=True):
            latency_ms = round((time.time() - t0) * 1000, 1)
            if on_theatre_event:
                tr = hit.get("transcript", "")
                snippet = tr[:60] + ("..." if len(tr) > 60 else "")
                on_theatre_event({
                    "step_id": f"voice_transcribe_{src.stem}",
                    "model": config.VOICE_MODEL,
                    "status": "completed",
                    "provenance": meta["provenance"],
                    "sha256": key,
                    "latency_ms": latency_ms,
                    "artifact_preview": f"ASR Transcript ({len(tr)} chars): \"{snippet}\"",
                })
            return hit

    wav = _to_wav(src)
    request: dict[str, Any] = {"mode": mode, "model": config.VOICE_MODEL, "audioEncoding": "WAV"}
    if languages:
        request["languageBias"] = languages
    try:
        with logged(config.VOICE_MODEL, "transcribe statement", bytes=wav.stat().st_size):
            with wav.open("rb") as audio:
                r = requests.post(
                    config.META_ASR_URL,
                    headers={"Authorization": f"Bearer {config.api_key()}"},
                    files={
                        "request": (None, json.dumps(request), "application/json"),
                        "audio": (wav.name, audio),
                    },
                    timeout=300,
                )
            if r.status_code != 200:
                raise RuntimeError(f"Voice Transcribe [{r.status_code}]: {r.text[:300]}")
    finally:
        os.unlink(wav)
    out = r.json()
    cache.put_json("voice", key, out)
    latency_ms = round((time.time() - t0) * 1000, 1)
    if on_theatre_event:
        tr = out.get("transcript", "")
        snippet = tr[:60] + ("..." if len(tr) > 60 else "")
        on_theatre_event({
            "step_id": f"voice_transcribe_{src.stem}",
            "model": config.VOICE_MODEL,
            "status": "completed",
            "provenance": "live_api",
            "sha256": key,
            "latency_ms": latency_ms,
            "artifact_preview": f"ASR Transcript ({len(tr)} chars): \"{snippet}\"",
        })
    return out
