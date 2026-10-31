"""Check each extracted claim against the engine's measurements.

Verdicts: consistent / inconsistent / cant_tell. A claimed speed is treated as
approximate (people round), so it is the claimed range +/-10% that is compared
with our 90% interval. 'inconsistent' requires the two ranges not to overlap.
"""

from __future__ import annotations
import re

from . import events, signals
from .uncertainty import TrackResult

SPEED_TOLERANCE = 0.10


COLOUR = {"yellow": "amber", "orange": "amber", "amber": "amber", "red": "red", "green": "green"}


def _speed_window(claim: dict, res: TrackResult, impact_t: float | None, cross_t: float | None):
    when = claim.get("when", "unspecified")
    if when == "at_stop_line":
        # Never fall back to the pre-impact window: that is a different moment.
        return events.window_speed(res, cross_t - 0.2, cross_t + 0.2) if cross_t is not None else None
    if impact_t is None:
        return None
    if when == "at_impact":
        return events.window_speed(res, impact_t - 0.25, impact_t - 0.05)
    # just_before_impact / unspecified: the second before contact
    return events.window_speed(res, impact_t - 1.2, impact_t - 0.2)

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _claimed_number(claim: dict) -> float | None:
    """The stated number, from value_number or, if the model put it there, value_text
    ("30", "30 km/h"). Vague words like "very fast" give None."""
    if claim.get("value_number") is not None:
        return float(claim["value_number"])
    m = _NUMBER.search(claim.get("value_text") or "")
    return float(m.group()) if m else None


def evaluate(claim: dict, results: dict[str, TrackResult], ctx: dict) -> dict:
    """ctx: {"impact_t", "signal_changes", "stop_line", "braking": {track: {...}}}"""
    out = {**claim, "verdict": "cant_tell", "measured": None, "reason": ""}
    res = results.get(claim["subject_track"])
    if res is None:
        out["reason"] = "the footage does not track this road user"
        return out
    q = claim["quantity"]
    cross_t = events.stop_line_crossing(res, ctx["stop_line"]) if ctx.get("stop_line") else None

    if q == "speed_kmh":
        v = _claimed_number(claim)
        if v is None:
            out["reason"] = "no speed stated"
            return out
        out["value_number"] = v
        ref_t = ctx.get("impact_t")
        near_miss = ref_t is None and ctx.get("closest_t") is not None
        if near_miss:  # no impact: judge the speed around the closest approach
            ref_t = ctx["closest_t"]
        w = _speed_window(claim, res, ref_t, cross_t)
        if w is None:
            out["reason"] = "no measurement at the time the claim refers to"
            return out
        lo_c, hi_c = v * (1 - SPEED_TOLERANCE), v * (1 + SPEED_TOLERANCE)
        out["measured"] = w
        if hi_c < w["lo90"] or lo_c > w["hi90"]:
            out["verdict"] = "inconsistent"
            out["reason"] = (
                f"claimed about {v:g} km/h; measured {w['kmh']} km/h "
                f"(90% interval {w['lo90']} to {w['hi90']})"
            )
        else:
            out["verdict"] = "consistent"
            out["reason"] = f"claimed {v:g} km/h lies within the measured range"
        if near_miss and claim.get("when") != "at_stop_line":
            out["reason"] += " (no impact: measured around the closest approach)"
        return out

    if q == "signal_state_at_stop_line":
        changes = ctx.get("signal_changes") or []
        if not changes:
            out["reason"] = ctx.get("signal_note") or "no traffic light tracked"
            return out
        if cross_t is None:
            out["reason"] = "no stop line marked, or this road user did not cross it"
            return out
        actual = signals.state_at(changes, cross_t)
        out["measured"] = {"stop_line_t": round(cross_t, 3), "signal": actual}
        if actual is None:
            out["reason"] = "the signal was not visible at the crossing time"
            return out
        said = (claim.get("value_text") or "").strip().lower()
        claimed = COLOUR.get(said)
        if claimed is None:
            out["reason"] = f"'{said}' is not a signal colour"
            return out
        out["verdict"] = "consistent" if claimed == actual else "inconsistent"
        last_change = max((c for c in changes if c["t"] <= cross_t), key=lambda c: c["t"])
        out["reason"] = (
            f"signal was {actual} at the stop-line crossing; it had changed to {actual} "
            f"{cross_t - last_change['t']:.1f} s earlier"
        )
        return out

    if q in ("braked_before_impact", "stopped_before_impact"):
        b = (ctx.get("braking") or {}).get(claim["subject_track"])
        if b is None:
            out["reason"] = "no impact detected for this road user"
            return out
        claimed_yes = (claim.get("value_text") or "yes").lower() in ("yes", "true")
        if q == "braked_before_impact":
            out["measured"] = b
            out["verdict"] = "consistent" if claimed_yes == b["detected"] else "inconsistent"
            out["reason"] = (
                f"braking detected {b['seconds_before_impact']} s before impact"
                if b["detected"] else "no sustained braking detected before impact"
            )
        else:
            if ctx.get("impact_t") is None:
                out["reason"] = "no impact detected"
                return out
            w = events.window_speed(res, ctx["impact_t"] - 0.6, ctx["impact_t"] - 0.1)
            out["measured"] = w
            stopped = w is not None and w["hi90"] < 3.0
            out["verdict"] = "consistent" if claimed_yes == stopped else "inconsistent"
            out["reason"] = "stationary before impact" if stopped else "moving just before impact"
        return out

    out["reason"] = "not a measurable quantity"
    return out
