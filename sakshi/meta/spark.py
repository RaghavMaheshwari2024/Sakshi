"""Muse Spark: fast, repeated reads on single frames.

Two jobs, both called many times per clip, which is why they use the fast
multimodal model rather than Muse Wonder:

1. Read the burned-in CCTV clock, so frame times come from the camera's own
   clock instead of a nominal frame rate (CCTV drops frames).
2. Read a traffic light's lit lamp when the colour rule in the engine is unsure.

Image format and structured output follow Meta's cookbook
(01_api_fundamentals/07_vision_input, 04_structured_output).
"""

from __future__ import annotations

import base64
import json

import cv2
import numpy as np

from .. import cache, config
from ..usage_log import logged, show
from .client import sync_client


def _data_url(img_bgr: np.ndarray, max_side: int = 768) -> tuple[str, bytes]:
    h, w = img_bgr.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1.0:
        img_bgr = cv2.resize(img_bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".png", img_bgr)
    if not ok:
        raise RuntimeError("Could not encode frame")
    b = buf.tobytes()
    return "data:image/png;base64," + base64.b64encode(b).decode(), b


def _ask(job: str, img_bgr: np.ndarray, prompt: str, schema: dict) -> dict:
    url, raw = _data_url(img_bgr)
    key = cache.key_for(config.SPARK_MODEL, job, prompt, schema, raw)
    hit = cache.get_json("spark", key)
    if hit is not None:
        with logged(config.SPARK_MODEL, job, cached=True) as call:
            pass
        show(call, hit)
        return hit
    with logged(config.SPARK_MODEL, job) as call:
        resp = sync_client().chat.completions.create(
            model=config.SPARK_MODEL,
            messages=[
                {
                    "role": "user",  # images must be in a user message
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": url}},
                    ],
                }
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": job.replace(" ", "_"), "schema": schema},
            },
        )
    content = resp.choices[0].message.content
    if content is None:
        raise RuntimeError(f"{config.SPARK_MODEL} returned no content for '{job}'")
    out = json.loads(content)
    cache.put_json("spark", key, out)
    show(call, out)
    return out


TIMESTAMP_SCHEMA = {
    "type": "object",
    "properties": {
        "readable": {"type": "boolean"},
        "raw_text": {"type": "string"},
        "date": {"type": "string", "description": "YYYY-MM-DD, or empty if absent"},
        "time": {"type": "string", "description": "HH:MM:SS 24-hour, or empty"},
        "fraction_seconds": {
            "type": "string",
            "description": "digits after the seconds if the overlay shows them, else empty",
        },
    },
    "required": ["readable", "raw_text", "date", "time", "fraction_seconds"],
    "additionalProperties": False,
}


def read_timestamp(crop_bgr: np.ndarray) -> dict:
    """Read a CCTV/dashcam clock overlay. Copy digits exactly; never guess."""
    prompt = (
        "This is a crop of a security-camera or dashcam frame containing a burned-in "
        "date/time overlay. Transcribe the overlay exactly. If any digit is unreadable, "
        "set readable=false. Do not infer or correct digits."
    )
    return _ask("read cctv clock", crop_bgr, prompt, TIMESTAMP_SCHEMA)


LIGHT_SCHEMA = {
    "type": "object",
    "properties": {
        "state": {"type": "string", "enum": ["red", "amber", "green", "off", "unclear"]},
    },
    "required": ["state"],
    "additionalProperties": False,
}


def read_light(crop_bgr: np.ndarray) -> str:
    prompt = (
        "This is a crop of a traffic signal. Which lamp is lit? Answer 'unclear' if "
        "you cannot tell with confidence."
    )
    return _ask("read traffic light", crop_bgr, prompt, LIGHT_SCHEMA)["state"]
