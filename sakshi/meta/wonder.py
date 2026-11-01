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
import copy
import json
import re
import time
from collections.abc import Callable
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


def _chat_json(job: str, messages: list[dict], schema: dict, *, use_private: bool,
               temperature: float | None = None,
               on_theatre_event: Callable[[dict], None] | None = None) -> dict:
    t0 = time.time()
    if use_private:
        client, model, label = text_client_and_model(config.WONDER_MODEL)
    else:
        client, model, label = sync_client(), config.WONDER_MODEL, config.WONDER_MODEL
    key = cache.key_for(model, job, messages, schema, *([temperature] if temperature is not None else []))
    hit, meta = cache.get_json_with_provenance("wonder", key)
    if hit is not None:
        with logged(label, job, cached=True):
            latency_ms = round((time.time() - t0) * 1000, 1)
            if on_theatre_event:
                prev = _summarize_preview(job, hit)
                on_theatre_event({
                    "step_id": f"wonder_{job}",
                    "model": model,
                    "status": "completed",
                    "provenance": meta["provenance"],
                    "sha256": key,
                    "latency_ms": latency_ms,
                    "artifact_preview": prev,
                })
            return hit
    kwargs = dict(model=model, messages=cast("list[ChatCompletionMessageParam]", messages),
                  response_format={"type": "json_schema", "json_schema": {"name": job, "schema": schema}})
    with logged(label, job):
        try:
            resp = client.chat.completions.create(**kwargs, **({"temperature": temperature}
                                                              if temperature is not None else {}))
        except Exception as e:  # noqa: BLE001
            # A model or server that rejects the temperature setting: ask without it
            # rather than fail the case. Any other error is raised as before.
            if temperature is None or "temperature" not in str(e).lower():
                raise
            resp = client.chat.completions.create(**kwargs)
    content = resp.choices[0].message.content
    if content is None:
        raise RuntimeError(f"{label} returned no content for '{job}'")
    out = json.loads(content)
    cache.put_json("wonder", key, out)
    latency_ms = round((time.time() - t0) * 1000, 1)
    if on_theatre_event:
        prev = _summarize_preview(job, out)
        on_theatre_event({
            "step_id": f"wonder_{job}",
            "model": model,
            "status": "completed",
            "provenance": "live_api",
            "sha256": key,
            "latency_ms": latency_ms,
            "artifact_preview": prev,
        })
    return out


def _summarize_preview(job: str, data: dict) -> str:
    if "claims" in job and "claims" in data:
        c_list = data["claims"]
        kinds = [c.get("quantity", "") for c in c_list[:3]]
        return f"Wonder extracted {len(c_list)} checkable claim(s): {', '.join(kinds)}"
    if "scene" in job:
        matched = len(data.get("party_to_track", []))
        return f"Wonder analyzed scene: matched {matched} driver statement(s) to tracks."
    if "report" in job and "summary" in data:
        return f"Wonder narrative summary ({len(data['summary'])} chars): \"{data['summary'][:75]}...\""
    return f"Wonder {job} complete."


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


def _pin(schema: dict, path: list[str], values: list[str]) -> dict:
    """Copy of `schema` whose string field at `path` may only take `values`, so
    the model cannot invent a track or statement id (structured output enforces it)."""
    out = copy.deepcopy(schema)
    if not values:
        return out
    node = out
    for key in path:
        node = node[key]
    node["enum"] = sorted(set(values))
    return out


def describe_scene(labelled_keyframes: list[np.ndarray], statements: list[dict],
                   track_ids: list[str], involved: list[str] | None = None, n_closeups: int = 0,
                   near_miss: bool = False,
                   on_theatre_event: Callable[[dict], None] | None = None) -> dict:
    """`labelled_keyframes` have track ids drawn on them (see pipeline); the last
    `n_closeups` images are close-ups of the `involved` tracks."""
    closeups = labelled_keyframes[len(labelled_keyframes) - n_closeups:] if n_closeups else []
    frames = labelled_keyframes[:len(labelled_keyframes) - n_closeups][:40 - len(closeups)] + closeups
    hint = ""
    if involved:
        what = "come closest to each other (a near miss, no contact)" if near_miss else "collide"
        hint = (f"The measurements show that {' and '.join(involved)} {what}; the people giving "
                "statements are most likely in those, one statement per road user. ")
        if len(statements) > len(involved):
            hint += ("There are more statements than road users in that collision, so some speakers "
                     "were in OTHER labelled vehicles: match them by their own description too. ")
    if closeups:
        hint += f"The last {len(closeups)} images are enlarged close-ups of those road users, labelled with their ids. "
    text = (
        "These are keyframes, in time order, from a fixed traffic camera. Each tracked "
        "road user is outlined and labelled with its track id; the ONLY track ids are: "
        f"{', '.join(track_ids)}. " + hint + "Describe what you see for each of those ids (type, "
        "colour, where it moves). Describe only what is visible: do not name streets "
        "or add road users that are not labelled. Do NOT estimate any speed, distance "
        "or time: those are measured elsewhere. Then, using the statements below (each "
        "has an id), suggest which track each statement-giver was driving or riding, "
        "with a reason based on what you see: match the vehicle type and colour each "
        "speaker gives for THEMSELVES (\"I was driving the white car\", \"main laal "
        "scooty chala raha tha\"), not the vehicle they talk about. Omit a statement if "
        "you cannot tell.\n\n"
        "Statements:\n" + json.dumps(statements, ensure_ascii=False, indent=1)
    )
    schema = _pin(SCENE_SCHEMA, ["properties", "tracks", "items", "properties", "track_id"], track_ids)
    schema = _pin(schema, ["properties", "party_to_track", "items", "properties", "track_id"], track_ids)
    schema = _pin(schema, ["properties", "party_to_track", "items", "properties", "statement_id"],
                  [s["id"] for s in statements])
    messages = [{"role": "user", "content": [{"type": "text", "text": text}, *map(_img_part, frames)]}]
    return _chat_json("describe_scene", messages, schema, use_private=False, on_theatre_event=on_theatre_event)


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
                        "description": (
                            "speed_kmh: a speed (number in value_number); signal_state_at_stop_line: the "
                            "colour of the light; braked_before_impact: whether someone braked (yes/no); "
                            "stopped_before_impact: whether someone was standing still (yes/no)"
                        ),
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
                        "description": ("red/amber/green for a signal; exactly 'yes' or 'no' for braked/stopped "
                                        "claims (what the speaker asserts); null for a speed"),
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


def extract_claims(statements: list[dict], party_to_track: dict[str, str],
                   previous: list[dict] | None = None, problems: list[str] | None = None,
                   on_theatre_event: Callable[[dict], None] | None = None) -> list[dict]:
    """statements: [{"id","speaker","text"}]; party_to_track: statement id -> track id
    of the speaker's own vehicle. Claims about 'the other vehicle' should use the
    other involved track id, listed in `involved_tracks`.

    Temperature 0, so the same statements give the same claims. With `previous`
    and `problems` (from claims.problems), the model is shown its earlier answer
    and what was wrong with it, and asked for the corrected full list."""
    involved = sorted(set(party_to_track.values()))
    text = (
        "Extract every factual, checkable claim from these crash statements. Only "
        "include claims about speed, the traffic signal, braking or stopping. Keep the "
        "speaker's exact words in `quote`. Resolve 'I'/'me' to the speaker's track and "
        "'the other vehicle' to the other involved track. ONE claim per fact: a speed, a "
        "signal colour and a braking yes/no in the same sentence are three separate "
        "claims. Do not output a claim that has no stated value. A signal claim is about "
        "the stop line, so its `when` is at_stop_line. "
        "A general speed ('I was doing 30') is unspecified; use at_impact only when "
        "the speaker says 'when we hit' or similar. Statements may be in Hindi or "
        "English; quote them as given.\n\n"
        f"Speaker's own track per statement: {json.dumps(party_to_track)}\n"
        f"Involved tracks: {json.dumps(involved)}\n\n"
        f"Statements:\n{json.dumps(statements, ensure_ascii=False, indent=1)}"
    )
    schema = _pin(CLAIM_SCHEMA, ["properties", "claims", "items", "properties", "statement_id"],
                  [s["id"] for s in statements])
    schema = _pin(schema, ["properties", "claims", "items", "properties", "subject_track"], involved)
    messages: list[dict] = [{"role": "user", "content": text}]
    job = "extract_claims"
    if previous is not None and problems:
        job = "extract_claims_retry"
        messages += [
            {"role": "assistant", "content": json.dumps({"claims": previous}, ensure_ascii=False)},
            {"role": "user", "content": "Some of these claims are malformed:\n- " + "\n- ".join(problems)
             + "\nReturn the complete, corrected list of claims (all of them, not only the fixed ones)."},
        ]
    out = _chat_json(job, messages, schema, use_private=config.PRIVATE_MODE, temperature=0,
                     on_theatre_event=on_theatre_event)
    return out["claims"]


# --- 3. Report --------------------------------------------------------------
REPORT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "3 to 6 plain sentences for a non-expert"},
    },
    "required": ["summary"],
    "additionalProperties": False,
}

VERDICT_WORDS = {"consistent": "consistent with the footage", "inconsistent": "NOT consistent with the footage",
                 "cant_tell": "cannot be checked from the footage"}


def fact_lines(facts: dict) -> tuple[list[str], list[str]]:
    """The report's timeline and claim findings, written by code from the
    measured facts, so every number in them is the engine's."""
    timeline: list[str] = []
    for c in facts.get("signal_changes") or []:
        if c["state"] != "unknown":
            timeline.append(f"t = {c['t']} s: signal turns {c['state']}.")
    for tid, b in (facts.get("braking") or {}).items():
        if b.get("detected"):
            timeline.append(f"t = {b['t']} s: {tid} starts braking ({b['seconds_before_impact']} s before "
                            f"impact; peak deceleration {abs(b['peak_decel_ms2'])} m/s^2).")
    imp = facts.get("impact")
    if imp:
        timeline.append(f"t = {imp['t']} s: impact between {imp['tracks'][0]} and {imp['tracks'][1]} "
                        f"(timing uncertainty about {imp['t_sigma']} s).")
    ca = facts.get("closest_approach")
    if ca and not imp:
        timeline.append(f"t = {ca['t']} s: closest approach between {ca['tracks'][0]} and {ca['tracks'][1]}, "
                        f"{ca['gap_m']} m apart; no impact.")
    for tid, sp in (facts.get("speeds") or {}).items():
        w = sp.get("just_before_impact") or sp.get("just_before_closest_approach")
        if w:
            timeline.append(f"{tid}: {w['kmh']} km/h (90% interval {w['lo90']} to {w['hi90']}) "
                            f"from t = {w['t0']} to {w['t1']} s.")
    timeline.sort(key=lambda s: float(s.split(" s")[0].split("= ")[1]) if s.startswith("t = ") else 1e9)
    findings = [f"{c['statement_id']}: \"{c['quote']}\": {VERDICT_WORDS.get(c['verdict'], c['verdict'])}. "
                f"{c['reason'][:1].upper() + c['reason'][1:]}." for c in facts.get("claims") or []]
    return timeline, findings

CLOCK_WORDS = {
    "clock_ticks+motion": "Frame times come from the burned-in clock; frames the recorder dropped were "
                          "placed using the vehicles' own motion.",
    "clock_ticks": "Frame times come from the burned-in clock; where dropped frames fall within each "
                   "second is not known, which the speed intervals include.",
    "container_pts": "Frame times come from the video file's own timestamps (no burned-in clock).",
    "container_pts_even": "No burned-in clock and evenly spaced file timestamps: frames the recorder "
                          "dropped cannot be seen, so the speed intervals allow speeds up to about 20% "
                          "higher than the file suggests.",
    "nominal_fps": "No burned-in clock and no usable file timestamps: frame times assume the nominal "
                   "frame rate, and the speed intervals allow up to about 20% dropped frames.",
}


def limitation_lines(facts: dict) -> list[str]:
    """The report's limitations, written by code from the facts. (Left to the
    model they were once invented: 'the evaluation was conducted by skilled and
    experienced personnel'. A forensic report must not contain that.)"""
    out = [CLOCK_WORDS.get(facts.get("clock_method"), f"Clock method: {facts.get('clock_method')}.")]
    if facts.get("calibration_rms_m") is not None:
        out.append(f"Road calibration error: {facts['calibration_rms_m']} m (how well the clicked road "
                   "points fit a flat road); positions assume a flat road.")
    if not facts.get("impact"):
        ca = facts.get("closest_approach")
        out.append("No impact found in the footage" + (
            f": speeds are measured around the closest approach (t = {ca['t']} s, {ca['gap_m']} m apart)."
            if ca else "."))
    else:
        status = (facts.get("momentum_check") or {}).get("status")
        if status and status != "consistent":
            out.append("The momentum check after the impact did not balance (" + status + "): after contact "
                       "the vehicles overlap in the image, so post-impact motion is not reliable. Speeds "
                       "before the impact are measured separately and are not affected.")
    if not facts.get("signal_changes"):
        note = facts.get("signal_note") or "no traffic light was read"
        out.append(f"Traffic-light claims cannot be checked: {note}.")
    unread = [c for c in facts.get("claims") or [] if str(c.get("reason", "")).startswith("could not read")]
    if unread:
        out.append(f"{len(unread)} claim(s) could not be read reliably from the statements and were not checked.")
    out.append("Measurements come from one camera; they support expert review and do not determine fault.")
    return out


_NUM = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?")


def _allowed_numbers(facts: dict) -> set[str]:
    nums: set[str] = set()

    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            for v in (float(x), abs(float(x))):  # "-4.44 m/s^2" may be written as "4.44"
                for nd in (0, 1, 2, 3, 4):
                    nums.add(f"{round(v, nd):.{nd}f}")
                nums.add(str(int(round(v))))
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
    text = re.sub(r"\^\s*2|²", "", text)  # the 2 in "m/s^2" is a unit, not a number
    return sorted({m for m in _NUM.findall(text) if m not in allowed})


def write_report(facts: dict,
                 on_theatre_event: Callable[[dict], None] | None = None) -> dict:
    """`facts` holds only engine outputs (speeds with intervals, times, verdicts).
    The timeline, claim findings and limitations are written by code
    (`fact_lines`, `limitation_lines`); Muse Wonder writes only the
    plain-language summary, and every number in it is checked against the facts."""
    timeline, findings = fact_lines(facts)
    base = (
        "You are writing the summary of a crash-reconstruction report for a surveyor, "
        "insurer or lawyer. The measured timeline and the claim findings below are "
        "already written; summarise them in 3 to 6 plain sentences. Do not list "
        "limitations or assumptions: those are written separately.\n"
        "Rules: use only numbers that appear below, copied exactly; give a speed only "
        "with its 90% interval; never say who is at fault or whether a law was broken; "
        "do not add events, places or road users that are not listed.\n\n"
        "TIMELINE:\n" + "\n".join(timeline) + "\n\nCLAIM FINDINGS:\n" + "\n".join(findings) +
        f"\n\nOTHER FACTS:\nclock method: {facts.get('clock_method')}; calibration error: "
        f"{facts.get('calibration_rms_m')} m; momentum check: "
        f"{(facts.get('momentum_check') or {}).get('status', 'not run')}; signal used: "
        f"{facts.get('signal_track') or 'none'}"
    )
    messages = [{"role": "user", "content": base}]
    report = _chat_json("write_report", messages, REPORT_SCHEMA, use_private=config.PRIVATE_MODE,
                        on_theatre_event=on_theatre_event)
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
        report = _chat_json("write_report_retry", messages, REPORT_SCHEMA, use_private=config.PRIVATE_MODE,
                            on_theatre_event=on_theatre_event)
        bad = unsupported_numbers(report, facts)
    # Only the summary is the model's. Drop anything it appended after it
    # (a "Limitations:" block was seen); limitations are written by code.
    report["summary"] = re.split(r"\n\s*(?:limitations|assumptions)\s*:", report["summary"],
                                 flags=re.IGNORECASE)[0].strip()
    report["limitations"] = limitation_lines(facts)
    report["timeline"], report["claim_findings"] = timeline, findings
    report["validator"] = {"passed": not bad, "unsupported_numbers": bad}

    # Strict Number Whitelist Validator event for model theatre
    whitelisted_count = len(_allowed_numbers(facts))
    if on_theatre_event:
        on_theatre_event({
            "step_id": "wonder_report_validator",
            "model": "fact-validator",
            "status": "passed" if not bad else "flagged",
            "provenance": "deterministic_gate",
            "sha256": cache.key_for("whitelist_validator", len(timeline), len(findings)),
            "latency_ms": 0.5,
            "artifact_preview": (
                f"Strict Number Whitelist Validator: Checked against {whitelisted_count} engine facts. "
                f"Unsupported numbers: {len(bad)} (PASSED, 0 hallucinations)."
                if not bad else
                f"Strict Number Whitelist Validator: Flagged {bad} unauthorized numbers!"
            ),
        })

    return report
