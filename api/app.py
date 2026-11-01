"""Sakshi backend. Run: uvicorn api.app:app --reload

Endpoints the UI uses:
  GET  /cases                      case list for the home screen (id, status, camera_mode)
  POST /cases                      multipart: video, statements_json, audio files, camera_mode
  GET  /cases/{id}/frame/{i}.jpg   a frame, for the calibration screen
  POST /cases/{id}/calibration     JSON: image_pts, ground_pts_m, stop_line_m, clock_box_px,
                                   signal_light_px (the clicked signal head that governs the stop line)
  POST /cases/{id}/party           JSON: {"s1": "car-0", ...} (user confirms who drove what)
  GET  /cases/{id}/run             server-sent events: one per pipeline stage, then "done"
  GET  /cases/{id}/case.json       the result
  GET  /cases/{id}/video           the clip, for the case view
"""

from __future__ import annotations

import asyncio
import json
import sys
import threading
import uuid
from pathlib import Path

import cv2
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()  # before sakshi.config reads the environment

from sakshi.config import CASES_DIR  # noqa: E402
from sakshi.engine import homography, presets  # noqa: E402
from sakshi.pipeline import recalibrate_case, run  # noqa: E402
from sakshi.video import find_input_video, read_frames  # noqa: E402

app = FastAPI(title="Sakshi")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _case(case_id: str) -> Path:
    d = (CASES_DIR / case_id).resolve()
    if CASES_DIR.resolve() not in d.parents or not d.exists():
        raise HTTPException(404, "case not found")
    return d

def _video(d: Path) -> Path:
    """The clip the pipeline measures (re-encoded copy if one was made)."""
    h264 = d / "input_h264.mp4"
    if h264.exists():
        return h264
    try:
        return find_input_video(d)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    

def _inp(d: Path) -> dict:
    return json.loads((d / "case_input.json").read_text())


@app.get("/cases")
def list_cases():
    """Cases for the home screen, newest first: id, status, camera mode, frame count."""
    out = []
    if CASES_DIR.exists():
        for d in CASES_DIR.iterdir():
            if not (d / "case_input.json").exists():
                continue
            inp = _inp(d)
            done = (d / "case.json").exists()
            status = "done" if done else ("ready" if inp.get("calibration") else "calibrate")
            out.append({"id": d.name, "status": status, "camera_mode": inp.get("camera_mode", "fixed"),
                        "statements": len(inp.get("statements", [])),
                        "updated": round((d / ("case.json" if done else "case_input.json")).stat().st_mtime),
                        "thumbnail": f"/cases/{d.name}/frame/0.jpg"})
    return sorted(out, key=lambda c: -c["updated"])


@app.post("/cases")
async def create_case(video: UploadFile = File(...), statements_json: str = Form("[]"),
                      languages: str = Form('["Hindi", "English"]'), camera_mode: str = Form("fixed"),
                      audio: list[UploadFile] | None = File(None)):
    case_id = uuid.uuid4().hex[:10]
    d = CASES_DIR / case_id
    (d / "audio").mkdir(parents=True)
    suffix = Path(video.filename or "clip.mp4").suffix or ".mp4"
    (d / f"input{suffix}").write_bytes(await video.read())
    statements = json.loads(statements_json)
    for f in audio or []:
        if not f.filename:
            raise HTTPException(400, "audio file is missing a filename")
        (d / "audio" / Path(f.filename).name).write_bytes(await f.read())
    if camera_mode not in ("fixed", "dashcam"):
        raise HTTPException(400, "camera_mode must be 'fixed' or 'dashcam'")
    inp = {"statements": statements, "calibration": None, "party_to_track": None,
           "languages": json.loads(languages), "camera_mode": camera_mode}
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))
    return {"id": case_id}


@app.get("/cases/{case_id}/frame/{i}.jpg")
def frame(case_id: str, i: int):
    d = _case(case_id)
    f = read_frames(_video(d), {i}).get(i)
    if f is None:
        raise HTTPException(404, "frame out of range")
    return Response(cv2.imencode(".jpg", f)[1].tobytes(), media_type="image/jpeg")


@app.get("/calibration/presets")
@app.get("/api/calibration/presets")
def get_presets():
    """List road geometry presets with honest metric uncertainty."""
    return presets.list_presets()


@app.post("/cases/{case_id}/calibration")
def calibration(case_id: str, body: dict):
    d = _case(case_id)
    try:
        preset_id = body.get("preset_id")
        if preset_id:
            cal = homography.fit_preset(
                body["image_pts"],
                preset_id=preset_id,
                custom_w=body.get("custom_w"),
                custom_l=body.get("custom_l"),
            )
        else:
            cal = homography.fit(
                body["image_pts"],
                body["ground_pts_m"],
                ground_sigma_m=float(body.get("ground_sigma_m", 0.05)),
                mode=str(body.get("mode", "custom")),
                preset_id=body.get("preset_id"),
                preset_label=body.get("preset_label"),
            )
    except (KeyError, ValueError) as exc:  # tell the UI what is wrong with the clicks
        raise HTTPException(400, f"calibration rejected: {exc}") from exc
    line = body.get("stop_line_m")
    if line and (len(line) != 2 or
                 ((line[0][0] - line[1][0]) ** 2 + (line[0][1] - line[1][1]) ** 2) ** 0.5 < 0.5):
        raise HTTPException(400, "stop line needs two points at least 0.5 m apart")
    inp = _inp(d)
    stored_cal = dict(body)
    stored_cal["ground_pts_m"] = cal.ground_pts.tolist()
    stored_cal["ground_sigma_m"] = cal.ground_sigma_m
    stored_cal["mode"] = cal.mode
    stored_cal["preset_id"] = cal.preset_id
    stored_cal["preset_label"] = cal.preset_label
    inp["calibration"] = stored_cal
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))

    if (d / "case.json").exists() and body.get("recompute"):
        updated_case = recalibrate_case(d, stored_cal)
        return {
            "reproj_rms_m": cal.rms_err_m,
            "reproj_max_m": cal.max_err_m,
            "H": cal.H.tolist(),
            "ground_sigma_m": cal.ground_sigma_m,
            "mode": cal.mode,
            "preset_id": cal.preset_id,
            "preset_label": cal.preset_label,
            "case": updated_case,
        }

    (d / "case.json").unlink(missing_ok=True)  # inputs changed: the old result is stale
    return {
        "reproj_rms_m": cal.rms_err_m,
        "reproj_max_m": cal.max_err_m,
        "H": cal.H.tolist(),
        "ground_sigma_m": cal.ground_sigma_m,
        "mode": cal.mode,
        "preset_id": cal.preset_id,
        "preset_label": cal.preset_label,
    }


@app.post("/cases/{case_id}/recalibrate")
def recalibrate_endpoint(case_id: str, body: dict):
    d = _case(case_id)
    if not (d / "case.json").exists():
        raise HTTPException(400, "case has not been run yet; run pipeline first")
    try:
        updated_case = recalibrate_case(d, body)
        return updated_case
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, f"recalibration rejected: {exc}") from exc


@app.post("/cases/{case_id}/party")
def party(case_id: str, body: dict[str, str]):
    d = _case(case_id)
    inp = _inp(d)
    inp["party_to_track"] = body
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))
    (d / "case.json").unlink(missing_ok=True)  # inputs changed: the old result is stale
    return {"ok": True}


_RUNNING: set[str] = set()
_RUNNING_LOCK = threading.Lock()


@app.get("/cases/{case_id}/run")
async def run_case(case_id: str, force: bool = False):
    """Runs the pipeline once. A browser EventSource reconnects automatically
    when a stream ends, so a finished case answers "done" at once instead of
    running again (pass ?force=true to re-run), and a second request while a
    run is in progress gets 409. The UI should still call es.close() on done."""
    d = _case(case_id)
    if not _inp(d).get("calibration"):
        raise HTTPException(400, "calibrate first")
    if (d / "case.json").exists() and not force:
        async def already_done():
            yield 'event: done\ndata: {"cached": true}\n\n'
        return StreamingResponse(already_done(), media_type="text/event-stream")
    with _RUNNING_LOCK:
        if case_id in _RUNNING:
            raise HTTPException(409, "this case is already running")
        _RUNNING.add(case_id)
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    def progress(stage: str, data: dict):
        loop.call_soon_threadsafe(q.put_nowait, {"stage": stage, "data": data})

    def work():
        try:
            run(d, progress=progress)
        except Exception as exc:  # report to the UI instead of dying silently
            loop.call_soon_threadsafe(q.put_nowait, {"stage": "error", "data": {"message": str(exc)}})
        finally:
            with _RUNNING_LOCK:
                _RUNNING.discard(case_id)

    threading.Thread(target=work, daemon=True).start()

    async def events():
        while True:
            msg = await q.get()
            yield f"event: {msg['stage']}\ndata: {json.dumps(msg['data'], default=str)}\n\n"
            if msg["stage"] in ("done", "error"):
                break

    return StreamingResponse(events(), media_type="text/event-stream")


@app.get("/cases/{case_id}/case.json")
def case_json(case_id: str):
    p = _case(case_id) / "case.json"
    if not p.exists():
        raise HTTPException(404, "not run yet")
    return FileResponse(p, media_type="application/json")


@app.get("/cases/{case_id}/video")
def case_video(case_id: str):
    return FileResponse(_video(_case(case_id)))  # supports Range requests, so seeking works
