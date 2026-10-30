"""Muse Wonder: the reasoning layer. It reads and explains; it never measures.

Three jobs:
1. `describe_scene`: look at keyframes with every SAM track labelled on them,
   describe each road user ("white hatchback entering from the left") and
   suggest which statement-giver drove which track. The user confirms.
2. `extract_claims`: turn each statement into structured, checkable claims.
3. `write_report`: write the plain-language report from the engine's numbers.
   A validator rejects any number in the text that the engine did not produce.

Private mode routes jobs 2 and 3 to Muse Glimmer on our own GPU.
"""

from __future__ import annotations

import base64
import json
import re
from typing import cast

import cv2
import numpy as np

from openai.types.chat import ChatCompletionMessageParam

from .. import cache, config
from ..usage_log import logged
from .client import sync_client, text_client_and_model


def _img_part(img_bgr: np.ndarray, max_side: int = 1024) -> dict:
    h, w = img_bgr.shape[:2]
    s = min(1.0, max_side / max(h, w))
    if s < 1.0:
        img_bgr = cv2.resize(img_bgr, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])
    url = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode()
    return {"type": "image_url", "image_url": {"url": url}}


def _chat_json(job: str, messages: list[dict], schema: dict, *, use_private: bool) -> dict:
    if use_private:
        client, model, label = text_client_and_model(config.WONDER_MODEL)
    else:
        client, model, label = sync_client(), config.WONDER_MODEL, config.WONDER_MODEL
    key = cache.key_for(model, job, messages, schema)
    hit = cache.get_json("wonder", key)
    if hit is not None:
        with logged(label, job, cached=True):
            return hit
    with logged(label, job):
        resp = client.chat.completions.create(
            model=model,
            messages=cast("list[ChatCompletionMessageParam]", messages),
            response_format={"type": "json_schema", "json_schema": {"name": job, "schema": schema}},
        )
    content = resp.choices[0].message.content
    if content is None:
        raise RuntimeError(f"{label} returned no content for '{job}'")
    out = json.loads(content)
    cache.put_json("wonder", key, out)
    return out


# --- 1. Scene description -------------------------------------------------
SCENE_SCHEMA = {
    "type": "object",
    "properties": {
        "road_layout": {"type": "string"},
        "tracks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "track_id": {"type": "string"},
                    "description": {"type": "string"},
                    "role": {"type": "string", "enum": ["involved", "bystander", "signal", "unclear"]},
                },
                "required": ["track_id", "description", "role"],
                "additionalProperties": False,
            },
        },
        "party_to_track": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "statement_id": {"type": "string"},
                    "track_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["statement_id", "track_id", "reason"],
                "additionalProperties": False,
            },
        },
        "event_sequence": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["road_layout", "tracks", "party_to_track", "event_sequence"],
    "additionalProperties": False,
}


def describe_scene(labelled_keyframes: list[np.ndarray], statements: list[dict]) -> dict:
    """`labelled_keyframes` have track ids drawn on them (see pipeline)."""
    frames = labelled_keyframes[:40]  # well under the ~50-image guideline
    text = (
        "These are keyframes, in time order, from a fixed traffic camera. Each tracked "
        "road user is outlined and labelled with a track id. Describe each track id "
        "visually, the road layout, and the order of events in plain words. Do NOT "
        "estimate any speed, distance or time: those are measured elsewhere. Then, "
        "using the statements below, suggest which track each statement-giver was "
        "driving or riding, with a reason; omit a statement if you cannot tell.\n\n"
        "Statements:\n" + json.dumps(statements, ensure_ascii=False, indent=1)
    )
    messages = [{"role": "user", "content": [{"type": "text", "text": text}, *map(_img_part, frames)]}]
    return _chat_json("describe_scene", messages, SCENE_SCHEMA, use_private=False)


# --- 2. Claim extraction ----------------------------------------------------
CLAIM_SCHEMA = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "statement_id": {"type": "string"},
                    "quote": {"type": "string", "description": "exact words from the statement"},
                    "subject_track": {
                        "type": "string",
                        "description": "track id the claim is about, from the party map",
                    },
                    "quantity": {
                        "type": "string",
                        "enum": [
                            "speed_kmh",
                            "signal_state_at_stop_line",
                            "braked_before_impact",
                            "stopped_before_impact",
                            "other",
                        ],
                    },
                    "value_number": {
                        "type": ["number", "null"],
                        "description": "any stated number goes here, e.g. 30 for 'I was doing 30'",
                    },
                    "value_text": {
                        "type": ["string", "null"],
                        "description": "red/amber/green, or yes/no, when the value is not a number",
                    },
                    "when": {
                        "type": "string",
                        "enum": ["at_impact", "just_before_impact", "at_stop_line", "unspecified"],
                        "description": (
                            "at_impact only if the speaker refers to the moment of contact; "
                            "at_stop_line for the signal or for speed at the junction entry; "
                            "unspecified for a general speed like 'I was doing 30'"
                        ),
                    },
                },
                "required": [
                    "statement_id",
                    "quote",
                    "subject_track",
                    "quantity",
                    "value_number",
                    "value_text",
                    "when",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["claims"],
    "additionalProperties": False,
}


def extract_claims(statements: list[dict], party_to_track: dict[str, str]) -> list[dict]:
    """statements: [{"id","speaker","text"}]; party_to_track: statement id -> track id
    of the speaker's own vehicle. Claims about 'the other vehicle' should use the
    other involved track id, listed in `involved_tracks`."""
    involved = sorted(set(party_to_track.values()))
    text = (
        "Extract every factual, checkable claim from these crash statements. Only "
        "include claims about speed, the traffic signal, braking or stopping. Keep the "
        "speaker's exact words in `quote`. Resolve 'I'/'me' to the speaker's track and "
        "'the other vehicle' to the other involved track. Use null when no value is "
        "stated. A signal claim is about the stop line, so its `when` is at_stop_line. "
        "A general speed ('I was doing 30') is unspecified; use at_impact only when "
        "the speaker says 'when we hit' or similar. Statements may be in Hindi or "
        "English; quote them as given.\n\n"
        f"Speaker's own track per statement: {json.dumps(party_to_track)}\n"
        f"Involved tracks: {json.dumps(involved)}\n\n"
        f"Statements:\n{json.dumps(statements, ensure_ascii=False, indent=1)}"
    )
    out = _chat_json(
        "extract_claims",
        [{"role": "user", "content": text}],
        CLAIM_SCHEMA,
        use_private=config.PRIVATE_MODE,
    )
    return out["claims"]


# --- 3. Report --------------------------------------------------------------
REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "timeline": {"type": "array", "items": {"type": "string"}},
        "claim_findings": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "timeline", "claim_findings", "limitations"],
    "additionalProperties": False,
}

_NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def _allowed_numbers(facts: dict) -> set[str]:
    nums: set[str] = set()

    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            for nd in (0, 1, 2):
                nums.add(f"{round(float(x), nd):.{nd}f}")
            nums.add(str(int(round(x))))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
        elif isinstance(x, str):
            for m in _NUM.findall(x):
                nums.add(m)

    walk(facts)
    return nums


def unsupported_numbers(report: dict, facts: dict) -> list[str]:
    allowed = _allowed_numbers(facts) | {"90"}  # "90% interval" is our wording
    text = json.dumps(report, ensure_ascii=False)
    return sorted({m for m in _NUM.findall(text) if m not in allowed})


def write_report(facts: dict) -> dict:
    """`facts` holds only engine outputs (speeds with intervals, times, verdicts)."""
    base = (
        "Write a neutral crash-reconstruction summary for a surveyor or lawyer from "
        "these MEASURED FACTS. Rules: use only numbers that appear in the facts, "
        "copied exactly; always give a speed with its 90% interval; never state who "
        "is at fault or whether a law was broken; report signal states and times as "
        "facts only; if a claim is 'cant_tell', say the footage does not show it.\n\n"
        f"FACTS:\n{json.dumps(facts, ensure_ascii=False, indent=1)}"
    )
    messages = [{"role": "user", "content": base}]
    report = _chat_json("write_report", messages, REPORT_SCHEMA, use_private=config.PRIVATE_MODE)
    bad = unsupported_numbers(report, facts)
    if bad:  # one corrective retry, then fail closed
        messages = messages + [
            {"role": "assistant", "content": json.dumps(report)},
            {
                "role": "user",
                "content": f"These numbers are not in the facts: {bad}. Rewrite "
                "using only numbers from the facts.",
            },
        ]
        report = _chat_json("write_report_retry", messages, REPORT_SCHEMA, use_private=config.PRIVATE_MODE)
        bad = unsupported_numbers(report, facts)
    report["validator"] = {"passed": not bad, "unsupported_numbers": bad}
    return report
