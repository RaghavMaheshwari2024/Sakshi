"""Sakshi backend. Run: uvicorn api.app:app --reload

Endpoints the UI uses:
  POST /cases                      multipart: video, statements_json, audio files
  GET  /cases/{id}/frame/{i}.jpg   a frame, for the calibration screen
  POST /cases/{id}/calibration     JSON: image_pts, ground_pts_m, stop_line_m, clock_box_px
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
from sakshi.pipeline import run  # noqa: E402
from sakshi.video import read_frames  # noqa: E402

app = FastAPI(title="Sakshi")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _case(case_id: str) -> Path:
    d = (CASES_DIR / case_id).resolve()
    if CASES_DIR.resolve() not in d.parents or not d.exists():
        raise HTTPException(404, "case not found")
    return d


def _inp(d: Path) -> dict:
    return json.loads((d / "case_input.json").read_text())


@app.post("/cases")
async def create_case(video: UploadFile = File(...), statements_json: str = Form("[]"),
                      languages: str = Form('["Hindi", "English"]'),
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
    inp = {"statements": statements, "calibration": None, "party_to_track": None,
           "languages": json.loads(languages)}
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))
    return {"id": case_id}


@app.get("/cases/{case_id}/frame/{i}.jpg")
def frame(case_id: str, i: int):
    d = _case(case_id)
    src = next(p for p in d.iterdir() if p.stem.startswith("input"))
    f = read_frames(src, {i}).get(i)
    if f is None:
        raise HTTPException(404, "frame out of range")
    return Response(cv2.imencode(".jpg", f)[1].tobytes(), media_type="image/jpeg")


@app.post("/cases/{case_id}/calibration")
def calibration(case_id: str, body: dict):
    from sakshi.engine import homography

    d = _case(case_id)
    cal = homography.fit(body["image_pts"], body["ground_pts_m"])  # validates, raises on bad input
    inp = _inp(d)
    inp["calibration"] = body
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))
    return {"reproj_rms_m": cal.rms_err_m, "reproj_max_m": cal.max_err_m, "H": cal.H.tolist()}


@app.post("/cases/{case_id}/party")
def party(case_id: str, body: dict[str, str]):
    d = _case(case_id)
    inp = _inp(d)
    inp["party_to_track"] = body
    (d / "case_input.json").write_text(json.dumps(inp, indent=1))
    return {"ok": True}


@app.get("/cases/{case_id}/run")
async def run_case(case_id: str):
    d = _case(case_id)
    if not _inp(d).get("calibration"):
        raise HTTPException(400, "calibrate first")
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()

    def progress(stage: str, data: dict):
        loop.call_soon_threadsafe(q.put_nowait, {"stage": stage, "data": data})

    def work():
        try:
            run(d, progress=progress)
        except Exception as exc:  # report to the UI instead of dying silently
            loop.call_soon_threadsafe(q.put_nowait, {"stage": "error", "data": {"message": str(exc)}})

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
    d = _case(case_id)
    h264 = d / "input_h264.mp4"
    src = h264 if h264.exists() else next(p for p in d.iterdir() if p.stem == "input")
    return FileResponse(src)
