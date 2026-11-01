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
from .engine import contact as contact_mod
from .engine import clock as clock_mod
from .engine import events, homography, signals
from .engine.kalman import Smoothed
from .engine.uncertainty import MCConfig, TrackResult, measure, step_displacements
from .video import crop, ensure_h264_mp4, find_input_video, iter_frames, probe, read_frames

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
                ticks_override=None, stats: dict | None = None,
                on_theatre_event: Callable[[dict], None] | None = None):
    """Returns (FrameClock, ticks). Ticks are kept for the drop-aware refinement."""
        # One pass, keeping only the previous frame: memory stays flat for long clips.
    dup_list, cand_all = [], []
    prev_g = prev_o = None
    for i, f in iter_frames(video):
        g = cv2.cvtColor(cv2.resize(f, (640, int(640 * f.shape[0] / f.shape[1]))), cv2.COLOR_BGR2GRAY)
        dup_list.append(prev_g is not None and clock_mod.is_duplicate(prev_g, g))
        prev_g = g
        if clock_box:
            o = cv2.cvtColor(crop(f, clock_box, 0), cv2.COLOR_BGR2GRAY)
            if prev_o is not None and clock_mod.overlay_changed(prev_o, o) and \
                    (not cand_all or i - cand_all[-1] >= 3):
                cand_all.append(i)
            prev_o = o
    dup = np.zeros(n, bool)
    dup[: min(n, len(dup_list))] = dup_list[:n]
    progress("clock", {"duplicates": int(dup.sum())})
    if ticks_override:  # testing: ticks known from ground truth
        ticks = [tuple(x) for x in ticks_override]
        return clock_mod.from_ticks(n, ticks, fps, dup), ticks
    if clock_box:
        from .meta import spark

        cand = cand_all[:60]
        if stats is not None:
            stats["spark_clock_reads"] = len(cand)
        frames = read_frames(video, set(cand))
        ticks = []
        for i in cand:
            sec = _time_to_seconds(spark.read_timestamp(crop(frames[i], clock_box, 4),
                                                        on_theatre_event=on_theatre_event))
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
                    offline: bool = False, stats: dict | None = None) -> dict:
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
            if stats is not None:
                stats["spark_light_reads"] = stats.get("spark_light_reads", 0) + len(picks)
            for k in picks:
                i = sorted(boxes)[k]
                states[k][1] = spark.read_light(crop(frames[i], boxes[i], 4))
        out[lt["id"]] = signals.timeline([tuple(s) for s in states])
        progress("signals", {"light": lt["id"], "changes": out[lt["id"]]})
    return out


def labelled_keyframes(video: Path, tracks: list[dict], n_frames: int, around: int | None, k: int = 16,
                       focus: list[str] | None = None):
    """Keyframes with every track's box and id drawn on, then one close-up per
    `focus` track (the vehicles in the impact or near miss) at the frame where it
    looks biggest before that moment, so its colour and type are clear even
    when it is small in the wide view."""
    idx = set(np.linspace(0, n_frames - 1, k).astype(int).tolist())
    if around is not None:
        idx |= set(range(max(0, around - 10), min(n_frames, around + 11), 5))
    by_id = {t["id"]: t for t in tracks}
    close = {}
    for tid in focus or []:
        fr = [f for f in by_id.get(tid, {}).get("frames", []) if around is None or f["i"] <= around]
        if fr:
            best = max(fr, key=lambda f: (f["box"][2] - f["box"][0]) * (f["box"][3] - f["box"][1]))
            close[tid] = best
            idx.add(best["i"])
    frames = read_frames(video, idx)
    colours = {}
    for t in tracks:
        colours[t["id"]] = tuple(int(x) for x in np.random.default_rng(len(colours)).integers(60, 255, 3))
    out = []
    key_idx = set(np.linspace(0, n_frames - 1, k).astype(int).tolist())
    if around is not None:
        key_idx |= set(range(max(0, around - 10), min(n_frames, around + 11), 5))
    for i in sorted(key_idx & set(frames)):
        img = frames[i].copy()
        for t in tracks:
            for f in t["frames"]:
                if f["i"] == i:
                    c = colours[t["id"]]
                    x1, y1, x2, y2 = map(int, f["box"])
                    cv2.rectangle(img, (x1, y1), (x2, y2), c, 2)
                    cv2.putText(img, t["id"], (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, c, 2)
        out.append(img)
    for tid, f in close.items():
        if f["i"] not in frames:
            continue
        x1, y1, x2, y2 = f["box"]
        w, h = x2 - x1, y2 - y1
        img = frames[f["i"]]
        H_, W_ = img.shape[:2]
        c = img[max(0, int(y1 - 0.3 * h)):min(H_, int(y2 + 0.3 * h)), max(0, int(x1 - 0.3 * w)):min(W_, int(x2 + 0.3 * w))]
        if c.size == 0:
            continue
        scale = 240 / max(c.shape[0], 1)
        c = cv2.resize(c, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        c = cv2.copyMakeBorder(c, 30, 0, 0, 0, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        cv2.putText(c, f"close-up of {tid}", (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        out.append(c)
    return out, [tid for tid, f in close.items() if f["i"] in frames]


def check_party(party: dict[str, str], statement_ids: list[str], involved: list[str]) -> tuple[dict, list[str]]:
    """Sanity-check Wonder's statement -> vehicle suggestions against the
    geometry: two statements cannot come from one vehicle, and when we know
    which vehicles collided (or nearly did), a statement-giver outside that pair
    is reassigned to the pair member nobody has claimed. With MORE statements
    than vehicles in the collision (a pile-up, a witness), a statement-giver
    outside it is allowed: their claims are about another moment or vehicle and
    are checked as such. Returns (party, notes)."""
    if not involved:
        return party, []
    party, notes = dict(party), []
    used: dict[str, str] = {}
    for sid in statement_ids:
        tid = party.get(sid)
        if tid is None:
            continue
        if tid not in used.values() and tid not in involved and len(statement_ids) > len(involved):
            notes.append(f"{sid}: {tid} is not in the collision Sakshi measured; kept (more statements "
                         "than vehicles in that collision)")
        elif tid in used.values() or tid not in involved:
            why = "already matched to another statement" if tid in used.values() else "not in the collision"
            free = [t for t in involved if t not in used.values() and t not in
                    [party.get(o) for o in statement_ids if o != sid]]
            if len(free) == 1:
                notes.append(f"{sid}: suggested {tid} ({why}); using {free[0]}")
                tid = free[0]
            else:
                notes.append(f"{sid}: suggested {tid} ({why}); left unmatched")
                party.pop(sid)
                continue
        party[sid] = tid
        used[sid] = tid
    # Two statements, one known pair, one statement unmatched: it is the other vehicle.
    missing = [sid for sid in statement_ids if sid not in party]
    free = [t for t in involved if t not in party.values()]
    if len(statement_ids) == 2 and len(missing) == 1 and len(free) == 1 and len(involved) == 2:
        party[missing[0]] = free[0]
        notes.append(f"{missing[0]}: no suggestion; using {free[0]}, the other vehicle in the collision")
    return party, notes


def _call_wonder(fn, *args, on_theatre_event=None, **kwargs):
    if on_theatre_event is not None:
        try:
            return fn(*args, on_theatre_event=on_theatre_event, **kwargs)
        except TypeError:
            pass
    return fn(*args, **kwargs)


def match_parties(wonder, keyframes: list, closeups: list[str], statements: list[dict], shown_ids: list[str],
                  involved: list[str], near_miss: bool, party: dict | None, progress: Progress = _noop,
                  on_theatre_event: Callable[[dict], None] | None = None):
    """Which road user each statement-giver drove: Muse Wonder's suggestion from
    the labelled keyframes (the last len(closeups) images are close-ups of the
    `involved` vehicles), checked against the geometry. If statements stay
    unmatched, ask once more with the close-ups only. A party map given by the
    user wins. Returns (scene, party)."""
    scene = _call_wonder(wonder.describe_scene, keyframes, statements, shown_ids, involved=involved,
                         n_closeups=len(closeups), near_miss=near_miss, on_theatre_event=on_theatre_event)
    progress("scene", {"suggested": scene["party_to_track"]})
    if party:
        return scene, party
    sids = [s["id"] for s in statements]
    party = {p["statement_id"]: p["track_id"] for p in scene["party_to_track"]}
    party, notes = check_party(party, sids, involved)
    if len(party) < len(sids) and closeups:
        closeup_imgs = keyframes[len(keyframes) - len(closeups):]
        focused = _call_wonder(wonder.describe_scene, closeup_imgs, statements, involved, involved=involved,
                               n_closeups=len(closeup_imgs), near_miss=near_miss, on_theatre_event=on_theatre_event)
        for p in focused["party_to_track"]:
            party.setdefault(p["statement_id"], p["track_id"])
        party, more = check_party(party, sids, involved)
        notes += ["asked again with close-ups only"] + more
        scene["party_to_track_closeups"] = focused["party_to_track"]
    if notes:
        scene["party_checks"] = notes
        progress("scene", {"party_checks": notes, "using": party})
    return scene, party


def read_claims(wonder, statements: list[dict], party: dict[str, str], progress: Progress = _noop,
                on_theatre_event: Callable[[dict], None] | None = None) -> list[dict]:
    """Claims from the statements, checked before any verdict is given.

    Each claim is repaired where its label contradicts its value
    (claims.normalize), then checked (claims.problems). If any are malformed,
    Muse Wonder is shown its answer and the problems and asked once more. A
    claim still malformed after that is kept but marked `unreadable`: it is
    shown as "could not read", never given a verdict. If the second request
    fails (network, API), the first answer is used with the same marking."""
    sids = [s["id"] for s in statements]
    tracks = sorted(set(party.values()))

    def check(raw):
        cl = [claims_mod.normalize(c) for c in raw]
        return cl, [claims_mod.problems(c, sids, tracks) for c in cl]

    first = _call_wonder(wonder.extract_claims, statements, party, on_theatre_event=on_theatre_event)
    claims, probs = check(first)
    flat = [p for ps in probs for p in ps]
    if flat:
        progress("claims", {"malformed": flat, "action": "asking Muse Wonder once more"})
        try:
            claims2, probs2 = check(_call_wonder(wonder.extract_claims, statements, party,
                                                 previous=first, problems=flat,
                                                 on_theatre_event=on_theatre_event))
        except Exception as e:  # noqa: BLE001
            progress("claims", {"retry_failed": str(e)[:200]})
        else:
            good1, good2 = sum(not p for p in probs), sum(not p for p in probs2)
            # Keep the second answer only if it is no worse: no fewer well-formed
            # claims (an empty list is not a fix) and no more problems.
            if good2 >= good1 and sum(map(len, probs2)) <= len(flat):
                claims, probs = claims2, probs2
    out = []
    for c, ps in zip(claims, probs):
        out.append({**c, "unreadable": ps} if ps else c)
    if any(probs):
        progress("claims", {"unreadable": [p for ps in probs for p in ps]})
    return out


def _split_tracks(tracks: list[dict], ids, i_split: int, before: bool) -> list[dict]:
    """The given tracks cut at frame i_split (kept: frames <= i if before, else >= i)."""
    out = []
    for t in tracks:
        if t["id"] in ids:
            fr = [f for f in t["frames"] if (f["i"] <= i_split if before else f["i"] >= i_split)]
            out.append({**t, "frames": fr})
    return out


def _stitch(pre: TrackResult, post: TrackResult | None, i_split: int) -> TrackResult:
    """One trajectory from a pre-impact and a post-impact smoothing."""
    if post is None:
        return pre
    k = post.frames > i_split
    n = min(len(pre.speed_samples), len(post.speed_samples))
    nom = Smoothed(
        np.r_[pre.nominal.t, post.nominal.t[k]],
        np.r_[pre.nominal.x, post.nominal.x[k]],
        np.r_[pre.nominal.P, post.nominal.P[k]],
        np.r_[pre.nominal.observed, post.nominal.observed[k]],
    )
    return TrackResult(
        pre.track_id, np.r_[pre.frames, post.frames[k]], nom,
        np.c_[pre.speed_samples[:n], post.speed_samples[:n][:, k]],
        np.concatenate([pre.pos_samples[:n], post.pos_samples[:n][:, k]], axis=1),
        {"smoothed_split_at_frame": int(i_split)},
    )


def split_at_impact(results, tracks, calib, clk, mc, impact, post_tracks=None) -> dict:
    """Re-smooth the colliding road users separately before and after contact.

    A smoother run across the impact spreads the sudden post-impact
    deceleration backwards and under-reads the speed just before contact.
    Smoothing each side on its own keeps the two motions apart.
    """
    ids, i = impact["tracks"], impact["i"]
    pre = measure(_split_tracks(tracks, ids, i, True), calib, clk, mc)
    # After contact the vehicles overlap for good; `post_tracks` (if given) keep
    # the contact points that the pre-impact occlusion check would remove.
    post = measure(_split_tracks(post_tracks or tracks, ids, i, False), calib, clk, mc)
    out = dict(results)
    for tid in ids:
        if tid in pre:
            out[tid] = _stitch(pre[tid], post.get(tid), i)
    return out


def _light_at(tracks: list[dict], px, max_dist_px: float = 40.0) -> str | None:
    """The traffic-light track whose box is nearest the clicked pixel."""
    best, best_d = None, max_dist_px
    lights = [t for t in tracks if t["concept"] == "traffic light" and t["frames"]]
    longest = max((len(t["frames"]) for t in lights), default=0)
    for t in lights:
        if len(t["frames"]) < 0.5 * longest:  # a flicker of a track cannot carry a timeline
            continue
        b = np.median([f["box"] for f in t["frames"]], axis=0)
        dx = max(b[0] - px[0], 0, px[0] - b[2])  # 0 when the click is inside the box
        dy = max(b[1] - px[1], 0, px[1] - b[3])
        d = float(np.hypot(dx, dy))
        if d <= best_d:
            best, best_d = t["id"], d
    return best


def choose_signal(sig: dict, chosen: str | None, tracks: list[dict] | None = None,
                  light_px=None) -> tuple[list[dict], str | None, str]:
    """Which traffic light governs the stop line. With several lights in view
    (cross traffic has its own), picking one at random would give wrong
    verdicts, so the user chooses: by track id (calibration.signal_track) or by
    clicking the signal head (calibration.signal_light_px)."""
    if not chosen and light_px and tracks:
        chosen = _light_at(tracks, light_px)
    if chosen and chosen in sig:
        return sig[chosen], chosen, ""
    if len(sig) == 1:
        tid = next(iter(sig))
        return sig[tid], tid, ""
    if not sig:
        return [], None, "no traffic light tracked"
    return [], None, (f"{len(sig)} traffic lights in view ({', '.join(sorted(sig))}); "
                      "choose which one governs the stop line")


def _models_summary(tracks, stats, statements, scene, party, claims, report, live: bool,
                    theatre_records: list[dict] | None = None) -> list[dict]:
    """What each Meta model did in this case, for the UI's model strip and the report."""
    out = []
    theatre = theatre_records or []
    if live:
        kinds: dict[str, int] = {}
        for t in tracks:
            kinds[t["concept"]] = kinds.get(t["concept"], 0) + 1
        sam_events = [e for e in theatre if "sam" in e.get("model", "")]
        out.append({
            "model": config.SAM_MODEL,
            "role": "tracking",
            "did": "tracked " + ", ".join(f"{n} {k}" for k, n in sorted(kinds.items())),
            "provenance": "live_api" if any(e.get("provenance") == "live_api" for e in sam_events) else ("disk_cache" if sam_events else "precomputed_bundle"),
            "latency_ms": round(sum(e.get("latency_ms", 0) for e in sam_events), 1),
            "cache_sha256": sam_events[0].get("sha256", "") if sam_events else "",
            "sample_output": sam_events[-1].get("artifact_preview", f"Tracked {len(tracks)} objects") if sam_events else f"Tracked {len(tracks)} objects",
        })
    reads = stats.get("spark_clock_reads", 0) + stats.get("spark_light_reads", 0)
    spark_events = [e for e in theatre if "spark" in e.get("model", "")]
    if reads or spark_events:
        out.append({
            "model": config.SPARK_MODEL,
            "role": "reading the video",
            "did": f"read the clock on {stats.get('spark_clock_reads', 0)} frames and the signal on {stats.get('spark_light_reads', 0)} frames",
            "provenance": "live_api" if any(e.get("provenance") == "live_api" for e in spark_events) else ("disk_cache" if spark_events else "precomputed_bundle"),
            "latency_ms": round(sum(e.get("latency_ms", 0) for e in spark_events), 1),
            "cache_sha256": spark_events[0].get("sha256", "") if spark_events else "",
            "sample_output": spark_events[-1].get("artifact_preview", "") if spark_events else "",
        })
    heard = sum(1 for s in statements if s.get("transcribed"))
    voice_events = [e for e in theatre if "voice" in e.get("model", "")]
    if heard or voice_events:
        out.append({
            "model": config.VOICE_MODEL,
            "role": "statements",
            "did": f"transcribed {heard or len(voice_events)} recorded statements",
            "provenance": "live_api" if any(e.get("provenance") == "live_api" for e in voice_events) else ("disk_cache" if voice_events else "precomputed_bundle"),
            "latency_ms": round(sum(e.get("latency_ms", 0) for e in voice_events), 1),
            "cache_sha256": voice_events[0].get("sha256", "") if voice_events else "",
            "sample_output": voice_events[-1].get("artifact_preview", "") if voice_events else "",
        })
    wonder_events = [e for e in theatre if "wonder" in e.get("model", "")]
    if scene or (claims and live) or report or wonder_events:
        did = []
        if scene:
            did.append(f"matched {len(scene.get('party_to_track', []))} of {len(statements)} statements to road users")
        if claims and live:
            did.append(f"extracted {len(claims)} checkable claims")
        if report:
            did.append("wrote the report summary" + (" (number check passed)" if report["validator"]["passed"] else ""))
        out.append({
            "model": config.WONDER_MODEL,
            "role": "understanding",
            "did": "; ".join(did) if did else "scene and claim reasoning",
            "provenance": "live_api" if any(e.get("provenance") == "live_api" for e in wonder_events) else ("disk_cache" if wonder_events else "precomputed_bundle"),
            "latency_ms": round(sum(e.get("latency_ms", 0) for e in wonder_events), 1),
            "cache_sha256": wonder_events[0].get("sha256", "") if wonder_events else "",
            "sample_output": wonder_events[-1].get("artifact_preview", "") if wonder_events else "",
        })
    return out


def run(case_dir: Path, progress: Progress = _noop, tracks_override: list[dict] | None = None,
        mc: MCConfig | None = None) -> dict:
    theatre_records: list[dict] = []

    def on_theatre(evt: dict):
        theatre_records.append(evt)
        progress("model_theatre", evt)

    case_dir = Path(case_dir)
    inp = json.loads((case_dir / "case_input.json").read_text())
    src = find_input_video(case_dir)
    video = ensure_h264_mp4(src, case_dir)
    info = probe(video)
    progress("video", {"frames": info.n, "fps": info.fps, "size": [info.width, info.height]})

    cal_in = inp["calibration"]
    calib = homography.fit(
        cal_in["image_pts"],
        cal_in["ground_pts_m"],
        ground_sigma_m=float(cal_in.get("ground_sigma_m", 0.05)),
        mode=str(cal_in.get("mode", "custom")),
        preset_id=cal_in.get("preset_id"),
        preset_label=cal_in.get("preset_label"),
    )
    progress("calibration", {"reproj_rms_m": round(calib.rms_err_m, 3)})

    stats: dict = {}
    if inp.get("clock_mode") == "nominal_fps":  # ablation: no timing correction
        clk, clk_ticks = clock_mod.from_fps(info.n, info.fps), None
    else:
        clk, clk_ticks = build_clock(video, info.n, info.fps, info.pts_s, cal_in.get("clock_box_px"),
                                     progress, ticks_override=inp.get("clock_ticks_override"), stats=stats,
                                     on_theatre_event=on_theatre)
    progress("clock", {"method": clk.method})

    contact_mode = inp.get("contact_mode", config.CONTACT_MODE)
    if tracks_override is not None:
        tracks = tracks_override
    else:
        from .meta import sam

        concepts = list(config.SAM_CONCEPTS) + (["wheel"] if contact_mode == "wheels" else [])
        progress("tracking", {"concepts": concepts})
        tracks = asyncio.run(sam.track_video(video, concepts, on_theatre_event=on_theatre))
    progress("tracking", {"tracks": [t["id"] for t in tracks if t["concept"] != "wheel"]})
    contact_report: dict = {}
    if contact_mode == "wheels":
        tracks, contact_report = contact_mod.wheel_contacts(tracks, calib.H)
        progress("tracking", {"wheel_contacts": contact_report})

    # A contact point hidden behind a vehicle in front is not a measurement.
    movers_all = [t for t in tracks if t["concept"] in events.MOVERS]
    tracks, occluded = contact_mod.drop_occluded(tracks, events.MOVERS)
    if occluded:
        progress("tracking", {"occluded_contact_frames": occluded})

    # Only road users are measured (not traffic lights, not vehicle parts).
    movers = [t for t in tracks if t["concept"] in events.MOVERS]
    refine = clk.method == "clock_ticks" and clk_ticks and inp.get("clock_mode") != "ticks_only"
    if refine:
        assert clk_ticks is not None  # refine is only truthy when there are ticks
        # Drop-aware refinement: the vehicles' own motion shows where frames were lost.
        steps, step_sig = step_displacements(tracks, calib, info.n)
        clk_ticked = clk
        clk = clock_mod.refine_with_motion(info.n, clk_ticks, info.fps, steps, clk.duplicate, step_sigma=step_sig)
        progress("clock", {"method": clk.method,
                           "dropped_frames_inferred": clk.to_json().get("dropped_frames_inferred")})

    results = measure(movers, calib, clk, mc)
    progress("physics", {"measured_tracks": list(results)})

    impacts = events.detect_impacts(results, tracks)
    if impacts and refine:
        assert clk_ticks is not None  # as above
        # After contact, motion is violent and no longer smooth, so it would read
        # as fake dropped frames: refit the clock from pre-impact motion only.
        i_imp = impacts[0]["i"]
        steps_pre = {k: np.where(np.arange(info.n) < i_imp, v, np.nan) for k, v in steps.items()}
        clk = clock_mod.refine_with_motion(info.n, clk_ticks, info.fps, steps_pre, clk_ticked.duplicate,
                                           step_sigma=step_sig)
        progress("clock", {"method": clk.method, "refit": "pre-impact motion only",
                           "dropped_frames_inferred": clk.to_json().get("dropped_frames_inferred")})
        results = measure(movers, calib, clk, mc)
        impacts = events.detect_impacts(results, tracks) or impacts
    impact = impacts[0] if impacts else None
    closest = None if impact else events.closest_approach(results, tracks)
    braking, momentum, speeds = {}, None, {}
    if impact:
        results = split_at_impact(results, movers, calib, clk, mc, impact, post_tracks=movers_all)
        progress("physics", {"split_at_frame": impact["i"]})
        for tid in impact["tracks"]:
            braking[tid] = events.braking_onset(results[tid], impact["t"])
            speeds[tid] = {
                "just_before_impact": events.window_speed(results[tid], impact["t"] - 1.2, impact["t"] - 0.2),
                "at_impact": events.window_speed(results[tid], impact["t"] - 0.25, impact["t"] - 0.05),
            }
        momentum = events.momentum_check(impact, results, tracks)
    elif closest:  # near miss: the same speed windows, around the closest approach
        for tid in closest["tracks"]:
            speeds[tid] = {"just_before_closest_approach":
                           events.window_speed(results[tid], closest["t"] - 1.2, closest["t"] - 0.2)}
    progress("events", {"impact": impact, "momentum": momentum, "closest_approach": closest})

    sig = signal_timeline(video, tracks, clk, progress, offline=tracks_override is not None, stats=stats)
    main_light, signal_track, signal_note = choose_signal(
        sig, cal_in.get("signal_track"), tracks, cal_in.get("signal_light_px"))

    # Statements: transcribe recorded ones with Muse Voice Transcribe.
    statements = []
    for s in inp.get("statements", []):
        if s.get("audio"):
            from .meta import voice

            tr = voice.transcribe(case_dir / s["audio"], languages=inp.get("languages"),
                                  on_theatre_event=on_theatre)
            s = {**s, "text": tr.get("transcript", ""), "transcribed": True}
        statements.append({k: s[k] for k in ("id", "speaker", "text") if k in s} | {"transcribed": s.get("transcribed", False)})
    progress("statements", {"n": len(statements)})

    scene = None
    party = inp.get("party_to_track")
    if statements and tracks_override is None:
        from .meta import wonder

        # Only road users are labelled: 10+ traffic-light boxes crowd the frames
        # and confused the scene description (signals are handled separately).
        shown = [t for t in tracks if t["concept"] in events.MOVERS]
        moment = impact or closest
        involved = list(moment["tracks"]) if moment else []
        keyframes, closeups = labelled_keyframes(video, shown, info.n, moment["i"] if moment else None,
                                                 focus=involved)
        near_miss = impact is None and closest is not None
        scene, party = match_parties(wonder, keyframes, closeups, statements, [t["id"] for t in shown],
                                     involved, near_miss, party, progress, on_theatre_event=on_theatre)

    checked = []
    ctx = {"impact_t": impact["t"] if impact else None, "closest_t": closest["t"] if closest else None,
           "signal_changes": main_light,
            "stop_line": cal_in.get("stop_line_m"), "braking": braking, "signal_note": signal_note}
    if inp.get("claims_override"):  # testing: claims written by hand, no model call
        checked = [claims_mod.evaluate(c, results, ctx) for c in inp["claims_override"]]
    elif statements and party:
        from .meta import wonder

        raw_claims = read_claims(wonder, statements, party, progress, on_theatre_event=on_theatre)
        checked = [claims_mod.evaluate(c, results, ctx) for c in raw_claims]
        progress("claims", {"verdicts": [c["verdict"] for c in checked]})

    facts = {
        "impact": impact,
        "closest_approach": closest,
        "speeds": speeds,
        "braking": braking,
        "momentum_check": momentum,
        "signal_changes": main_light,
        "signal_track": signal_track,
        "signal_note": signal_note,
        "claims": [{k: c[k] for k in ("statement_id", "quote", "verdict", "reason", "measured")} for c in checked],
        "clock_method": clk.method,
        "calibration_rms_m": round(calib.rms_err_m, 3),
    }
    report = None
    if tracks_override is None and (impact or checked):
        from .meta import wonder

        report = wonder.write_report(facts, on_theatre_event=on_theatre)
        progress("report", {"validator": report["validator"]})

    live_calls = sum(1 for e in theatre_records if e.get("provenance") == "live_api")
    cached_calls = sum(1 for e in theatre_records if e.get("provenance") == "disk_cache")
    total_latency_ms = sum(e.get("latency_ms", 0.0) for e in theatre_records)
    if tracks_override is not None:
        mode = "precomputed_bundle"
    elif live_calls > 0 and cached_calls == 0:
        mode = "live_api"
    elif live_calls > 0 and cached_calls > 0:
        mode = "hybrid_cache"
    else:
        mode = "disk_cache"

    execution_provenance = {
        "mode": mode,
        "live_calls": live_calls,
        "cached_calls": cached_calls,
        "total_latency_ms": round(total_latency_ms, 1),
    }

    case = {
        "version": 1,
        "camera_mode": inp.get("camera_mode", "fixed"),
        "contact": {"mode": contact_mode, "per_vehicle": contact_report, "occluded_frames": occluded},
        "models": _models_summary(tracks, stats, statements, scene, party, checked, report,
                                  live=tracks_override is None, theatre_records=theatre_records),
        "execution_provenance": execution_provenance,
        "private_mode": config.PRIVATE_MODE,
        "clip": {"file": video.name, "frames": info.n, "fps_nominal": info.fps,
                 "width": info.width, "height": info.height},
        "clock": clk.to_json(),
        "calibration": calib.to_json() | {"stop_line_m": cal_in.get("stop_line_m"),
                                          # for the 3D replay's starting viewpoint
                                          "camera": homography.camera_pose(calib.H, info.width, info.height)},
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


def recalibrate_case(case_dir: Path, cal_body: dict, mc: MCConfig | None = None) -> dict:
    """Fast deterministic recomputation of trajectories, Monte Carlo confidence intervals,
    events, and claim verdicts when calibration geometry or uncertainty changes (<500ms).
    """
    mc = mc or MCConfig(n=8)
    case_dir = Path(case_dir)
    case_path = case_dir / "case.json"
    if not case_path.exists():
        raise FileNotFoundError(f"Case {case_dir.name} has not been run yet")

    case = json.loads(case_path.read_text())
    image_pts = cal_body["image_pts"]
    preset_id = cal_body.get("preset_id")

    if preset_id:
        calib = homography.fit_preset(
            image_pts,
            preset_id=preset_id,
            custom_w=cal_body.get("custom_w"),
            custom_l=cal_body.get("custom_l"),
        )
    else:
        calib = homography.fit(
            image_pts,
            cal_body["ground_pts_m"],
            ground_sigma_m=float(cal_body.get("ground_sigma_m", 0.05)),
            mode=str(cal_body.get("mode", "custom")),
            preset_id=cal_body.get("preset_id"),
            preset_label=cal_body.get("preset_label"),
        )

    # Reconstruct clock from case.json
    c_json = case["clock"]
    t_arr = np.array([f["t"] for f in c_json["frames"]], dtype=float)
    dup_arr = np.array([f.get("dup", False) for f in c_json["frames"]], dtype=bool)
    sig_arr = np.full(len(t_arr), float(c_json.get("median_sigma_s", 0.01)))
    gaps_arr = np.array(c_json["gaps"], dtype=int) if "gaps" in c_json else None
    clk = clock_mod.FrameClock(t=t_arr, sigma=sig_arr, method=c_json.get("method", "nominal_fps"),
                               duplicate=dup_arr, gaps=gaps_arr)

    tracks = case.get("tracks", [])
    movers = [t for t in tracks if t.get("concept") in events.MOVERS]
    movers_all = list(movers)

    results = measure(movers, calib, clk, mc)
    impacts = events.detect_impacts(results, tracks)
    impact = impacts[0] if impacts else None
    closest = None if impact else events.closest_approach(results, tracks)
    braking, momentum, speeds = {}, None, {}

    if impact:
        results = split_at_impact(results, movers, calib, clk, mc, impact, post_tracks=movers_all)
        for tid in impact["tracks"]:
            braking[tid] = events.braking_onset(results[tid], impact["t"])
            speeds[tid] = {
                "just_before_impact": events.window_speed(results[tid], impact["t"] - 1.2, impact["t"] - 0.2),
                "at_impact": events.window_speed(results[tid], impact["t"] - 0.25, impact["t"] - 0.05),
            }
        momentum = events.momentum_check(impact, results, tracks)
    elif closest:
        for tid in closest["tracks"]:
            speeds[tid] = {
                "just_before_closest_approach": events.window_speed(results[tid], closest["t"] - 1.2, closest["t"] - 0.2)
            }

    stop_line = cal_body.get("stop_line_m", case.get("calibration", {}).get("stop_line_m"))
    signal_changes = case.get("facts", {}).get("signal_changes")
    signal_note = case.get("facts", {}).get("signal_note")
    signal_track = case.get("facts", {}).get("signal_track")

    ctx = {
        "impact_t": impact["t"] if impact else None,
        "closest_t": closest["t"] if closest else None,
        "signal_changes": signal_changes,
        "stop_line": stop_line,
        "braking": braking,
        "signal_note": signal_note,
    }

    raw_claims = case.get("claims", [])
    checked = [claims_mod.evaluate(c, results, ctx) for c in raw_claims]

    facts = {
        "impact": impact,
        "closest_approach": closest,
        "speeds": speeds,
        "braking": braking,
        "momentum_check": momentum,
        "signal_changes": signal_changes,
        "signal_track": signal_track,
        "signal_note": signal_note,
        "claims": [{k: c[k] for k in ("statement_id", "quote", "verdict", "reason", "measured")} for c in checked],
        "clock_method": clk.method,
        "calibration_rms_m": round(calib.rms_err_m, 3),
    }

    clip = case.get("clip", {})
    cam_pose = homography.camera_pose(calib.H, clip.get("width", 1920), clip.get("height", 1080))
    case["calibration"] = calib.to_json() | {
        "stop_line_m": stop_line,
        "camera": cam_pose,
    }
    case["trajectories"] = [r.to_json() for r in results.values()]
    case["events"] = impacts
    case["facts"] = facts
    case["claims"] = checked

    case_path.write_text(json.dumps(case, default=str))

    inp_path = case_dir / "case_input.json"
    if inp_path.exists():
        inp = json.loads(inp_path.read_text())
        cal_to_save = dict(cal_body)
        cal_to_save["ground_pts_m"] = calib.ground_pts.tolist()
        cal_to_save["ground_sigma_m"] = calib.ground_sigma_m
        cal_to_save["mode"] = calib.mode
        cal_to_save["preset_id"] = calib.preset_id
        cal_to_save["preset_label"] = calib.preset_label
        inp["calibration"] = cal_to_save
        inp_path.write_text(json.dumps(inp, indent=1))

    return case

