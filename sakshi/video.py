"""Video I/O. Frame index i here must equal SAM 3.1's frame index i, so frames
are always decoded sequentially from the same file sent to SAM."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class VideoInfo:
    path: Path
    n: int
    fps: float
    width: int
    height: int
    pts_s: np.ndarray  # container timestamps, seconds


def ensure_h264_mp4(src: Path, dst_dir: Path) -> Path:
    """SAM 3.1 accepts MP4/MOV with H.264/H.265/MPEG-4 (not VP9/WebM).
    Re-encode anything else, keeping every frame (no frame-rate conversion)."""
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name", "-of", "json", str(src)],
        capture_output=True, text=True, check=True,
    )
    codec = json.loads(probe.stdout)["streams"][0]["codec_name"]
    if src.suffix.lower() in (".mp4", ".mov") and codec in ("h264", "hevc", "mpeg4"):
        return src
    out = dst_dir / "input_h264.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-fps_mode", "passthrough",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-an", str(out)],
        check=True,
    )
    return out


def probe(path: Path) -> VideoInfo:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    pts = []
    while True:
        ok = cap.grab()
        if not ok:
            break
        pts.append(cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0)
    cap.release()
    return VideoInfo(path, len(pts), float(fps), w, h, np.array(pts))


def iter_frames(path: Path):
    cap = cv2.VideoCapture(str(path))
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        yield i, frame
        i += 1
    cap.release()


def read_frames(path: Path, indices: set[int]) -> dict[int, np.ndarray]:
    out = {}
    for i, f in iter_frames(path):
        if i in indices:
            out[i] = f
        if len(out) == len(indices):
            break
    return out


def crop(img: np.ndarray, box, pad: int = 2) -> np.ndarray:
    x1, y1, x2, y2 = [int(round(v)) for v in box]
    h, w = img.shape[:2]
    return img[max(0, y1 - pad):min(h, y2 + pad), max(0, x1 - pad):min(w, x2 + pad)]
