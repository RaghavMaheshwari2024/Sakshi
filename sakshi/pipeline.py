"""Clip + statements + calibration -> case.json.

Case folder layout (cases/<id>/):
  input.mp4             the clip (any common format; re-encoded if needed)
  case_input.json       statements, calibration clicks, optional party map
  audio/*.wav|m4a       optional recorded statements
  case.json             output, read by the UI

case_input.json:
{
  "statements": [{"id": "s1", "speaker": "Driver of the white car",
                  "text": "..."} | {"id": "s2", "speaker": "...", "audio": "audio/s2.m4a"}],
  "calibration": {"image_pts": [[u,v],...], "ground_pts_m": [[x,y],...],
                  "stop_line_m": [[x1,y1],[x2,y2]] | null,
                  "clock_box_px": [x1,y1,x2,y2] | null},
  "party_to_track": {"s1": "car-0"} | null,     # filled after the user confirms
  "languages": ["Hindi", "English"]
}
"""

from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from . import config
from .engine import claims as claims_mod
from .engine import clock as clock_mod
from .engine import events, homography, signals
from .engine.uncertainty import MCConfig, measure, step_displacements
from .video import crop, ensure_h264_mp4, iter_frames, probe, read_frames

Progress = Callable[[str, dict], None]


def _noop(stage: str, data: dict) -> None:
    print(f"[{stage}] {json.dumps(data, default=str)[:200]}")


def _time_to_seconds(r: dict) -> float | None:
    m = re.match(r"^(\d{1,2}):(\d{2}):(\d{2})$", r.get("time", "").strip())
    if not (r.get("readable") and m):
        return None
    s = int(m[1]) * 3600 + int(m[2]) * 60 + int(m[3])
    frac = r.get("fraction_seconds", "").strip()
    return s + (float("0." + frac) if frac.isdigit() else 0.0)


def build_clock(video: Path, n: int, fps: float, pts: np.ndarray, clock_box, progress: Progress,
                ticks_override=None):
    """Returns (FrameClock, ticks). Ticks are kept for the drop-aware refinement."""
    small, overlay = [], []
    for i, f in iter_frames(video):
        g = cv2.cvtColor(cv2.resize(f, (640, int(640 * f.shape[0] / f.shape[1]))), cv2.COLOR_BGR2GRAY)
        small.append(g)
        if clock_box:
            overlay.append(cv2.cvtColor(crop(f, clock_box, 0), cv2.COLOR_BGR2GRAY))
    dup = clock_mod.detect_duplicates(small)
    progress("clock", {"duplicates": int(dup.sum())})
    if ticks_override:  # testing: ticks known from ground truth
        ticks = [tuple(x) for x in ticks_override]
        return clock_mod.from_ticks(n, ticks, fps, dup), ticks
    if clock_box:
        from .meta import spark

        cand = clock_mod.detect_ticks(overlay)[:60]
        frames = read_frames(video, set(cand))
        ticks = []
        for i in cand:
            sec = _time_to_seconds(spark.read_timestamp(crop(frames[i], clock_box, 4)))
            if sec is not None:
                ticks.append((i, sec))
        # Keep only ticks that advance by whole seconds (rejects misreads).
        clean = [ticks[0]] if ticks else []
        for i, s in ticks[1:]:
            if 0 < s - clean[-1][1] <= 2 and i > clean[-1][0]:
                clean.append((i, s))
        progress("clock", {"ticks_read": len(ticks), "ticks_used": len(clean)})
        if len(clean) >= 2:
            return clock_mod.from_ticks(n, clean, fps, dup), clean
    if len(pts) == n and n > 1 and np.all(np.diff(pts) > 0):
        return clock_mod.from_pts(pts, dup), None
    return clock_mod.from_fps(n, fps, dup), None


def signal_timeline(video: Path, tracks: list[dict], clk, progress: Progress,
                    offline: bool = False) -> dict:
    lights = [t for t in tracks if t["concept"] == "traffic light"]
    out = {}
    for lt in lights:
        boxes = {f["i"]: f["box"] for f in lt["frames"]}
        frames = read_frames(video, set(boxes))
        states, unclear = [], []
        for i in sorted(boxes):
            # pad=0: only pixels inside the housing, so a car passing behind
            # the signal cannot be mistaken for a lit red lamp.
            st, conf = signals.classify_lamp(crop(frames[i], boxes[i], 0))
            states.append([float(clk.t[i]), st])
            if st == "unclear":
                unclear.append(len(states) - 1)
        if unclear and not offline:  # ask Muse Spark on a sample of the ambiguous frames
            from .meta import spark

            picks = unclear[:: max(1, len(unclear) // 20)][:20]
            for k in picks:
                i = sorted(boxes)[k]
                states[k][1] = spark.read_light(crop(frames[i], boxes[i], 4))
        out[lt["id"]] = signals.timeline([tuple(s) for s in states])
        progress("signals", {"light": lt["id"], "changes": out[lt["id"]]})
    return out


def labelled_keyframes(video: Path, tracks: list[dict], n_frames: int, around: int | None, k: int = 16):
    idx = set(np.linspace(0, n_frames - 1, k).astype(int).tolist())
    if around is not None:
        idx |= set(range(max(0, around - 10), min(n_frames, around + 11), 5))
    frames = read_frames(video, idx)
    colours = {}
    out = []
    for i in sorted(frames):
        img = frames[i].copy()
        for t in tracks:
            for f in t["frames"]:
                if f["i"] == i:
                    c = colours.setdefault(t["id"], tuple(int(x) for x in np.random.default_rng(len(colours)).integers(60, 255, 3)))
                    x1, y1, x2, y2 = map(int, f["box"])
                    cv2.rectangle(img, (x1, y1), (x2, y2), c, 2)
                    cv2.putText(img, t["id"], (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, c, 2)
        out.append(img)
    return out


def run(case_dir: Path, progress: Progress = _noop, tracks_override: list[dict] | None = None,
        mc: MCConfig | None = None) -> dict:
    case_dir = Path(case_dir)
    inp = json.loads((case_dir / "case_input.json").read_text())
    src = next(p for p in case_dir.iterdir() if p.stem == "input")
    video = ensure_h264_mp4(src, case_dir)
    info = probe(video)
    progress("video", {"frames": info.n, "fps": info.fps, "size": [info.width, info.height]})

    cal_in = inp["calibration"]
    calib = homography.fit(cal_in["image_pts"], cal_in["ground_pts_m"])
    progress("calibration", {"reproj_rms_m": round(calib.rms_err_m, 3)})

    if inp.get("clock_mode") == "nominal_fps":  # ablation: no timing correction
        clk, clk_ticks = clock_mod.from_fps(info.n, info.fps), None
    else:
        clk, clk_ticks = build_clock(video, info.n, info.fps, info.pts_s, cal_in.get("clock_box_px"),
                                     progress, ticks_override=inp.get("clock_ticks_override"))
    progress("clock", {"method": clk.method})

    if tracks_override is not None:
        tracks = tracks_override
    else:
        from .meta import sam

        progress("tracking", {"concepts": config.SAM_CONCEPTS})
        tracks = asyncio.run(sam.track_video(video))
    progress("tracking", {"tracks": [t["id"] for t in tracks]})

    if clk.method == "clock_ticks" and clk_ticks and inp.get("clock_mode") != "ticks_only":
        # Drop-aware refinement: the vehicles' own motion shows where frames were lost.
        steps, step_sig = step_displacements(tracks, calib, info.n)
        clk = clock_mod.refine_with_motion(info.n, clk_ticks, info.fps, steps, clk.duplicate, step_sigma=step_sig)
        progress("clock", {"method": clk.method,
                           "dropped_frames_inferred": clk.to_json().get("dropped_frames_inferred")})

    results = measure(tracks, calib, clk, mc)
    progress("physics", {"measured_tracks": list(results)})

    impacts = events.detect_impacts(results, tracks)
    impact = impacts[0] if impacts else None
    braking, momentum, speeds = {}, None, {}
    if impact:
        for tid in impact["tracks"]:
            braking[tid] = events.braking_onset(results[tid], impact["t"])
            speeds[tid] = {
                "just_before_impact": events.window_speed(results[tid], impact["t"] - 1.2, impact["t"] - 0.2),
                "at_impact": events.window_speed(results[tid], impact["t"] - 0.25, impact["t"] - 0.05),
            }
        momentum = events.momentum_check(impact, results, tracks)
    progress("events", {"impact": impact, "momentum": momentum})

    sig = signal_timeline(video, tracks, clk, progress, offline=tracks_override is not None)
    main_light = next(iter(sig.values()), [])

    # Statements: transcribe recorded ones with Muse Voice Transcribe.
    statements = []
    for s in inp.get("statements", []):
        if s.get("audio"):
            from .meta import voice

            tr = voice.transcribe(case_dir / s["audio"], languages=inp.get("languages"))
            s = {**s, "text": tr.get("transcript", ""), "transcribed": True}
        statements.append({k: s[k] for k in ("id", "speaker", "text") if k in s} | {"transcribed": s.get("transcribed", False)})
    progress("statements", {"n": len(statements)})

    scene = None
    party = inp.get("party_to_track")
    if statements and tracks_override is None:
        from .meta import wonder

        scene = wonder.describe_scene(
            labelled_keyframes(video, tracks, info.n, impact["i"] if impact else None), statements
        )
        progress("scene", {"suggested": scene["party_to_track"]})
        if not party:  # use the suggestion, but mark it as unconfirmed
            party = {p["statement_id"]: p["track_id"] for p in scene["party_to_track"]}

    checked = []
    ctx = {"impact_t": impact["t"] if impact else None, "signal_changes": main_light,
           "stop_line": cal_in.get("stop_line_m"), "braking": braking}
    if inp.get("claims_override"):  # testing: claims written by hand, no model call
        checked = [claims_mod.evaluate(c, results, ctx) for c in inp["claims_override"]]
    elif statements and party:
        from .meta import wonder

        raw_claims = wonder.extract_claims(statements, party)
        checked = [claims_mod.evaluate(c, results, ctx) for c in raw_claims]
        progress("claims", {"verdicts": [c["verdict"] for c in checked]})

    facts = {
        "impact": impact,
        "speeds": speeds,
        "braking": braking,
        "momentum_check": momentum,
        "signal_changes": main_light,
        "claims": [{k: c[k] for k in ("statement_id", "quote", "verdict", "reason", "measured")} for c in checked],
        "clock_method": clk.method,
        "calibration_rms_m": round(calib.rms_err_m, 3),
    }
    report = None
    if tracks_override is None and (impact or checked):
        from .meta import wonder

        report = wonder.write_report(facts)
        progress("report", {"validator": report["validator"]})

    case = {
        "version": 1,
        "private_mode": config.PRIVATE_MODE,
        "clip": {"file": video.name, "frames": info.n, "fps_nominal": info.fps,
                 "width": info.width, "height": info.height},
        "clock": clk.to_json(),
        "calibration": calib.to_json() | {"stop_line_m": cal_in.get("stop_line_m")},
        "tracks": tracks,
        "trajectories": [r.to_json() for r in results.values()],
        "events": impacts,
        "facts": facts,
        "signals": sig,
        "statements": statements,
        "party_to_track": party,
        "scene": scene,
        "claims": checked,
        "report": report,
        "disclaimer": "Measurements to support expert review. Sakshi does not determine fault.",
    }
    (case_dir / "case.json").write_text(json.dumps(case, default=str))
    progress("done", {"case": str(case_dir / "case.json")})
    return case
