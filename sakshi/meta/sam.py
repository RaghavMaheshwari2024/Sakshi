"""SAM 3.1 video tracking through Meta Model API.

Request and stream handling follow Meta's cookbook example
(meta-model-cookbook/07_sam/01_api_basics, MIT licence): upload the MP4 with the
Files API, send ONE noun phrase per request, stream the Responses events, and
decode them with Meta's official parser (`meta-sam-parser`). We never parse the
SAM wire grammar ourselves.

Every stream is cached as JSONL of normalised events, so a re-run replays the
cache through the same parser and costs nothing.
"""

from __future__ import annotations

import asyncio
import mimetypes
import time
from collections.abc import AsyncGenerator, AsyncIterable, Callable
from contextlib import aclosing
from pathlib import Path
from typing import Any

import numpy as np
from meta_sam_parser import (
    VideoSegmentationResult,
    decode_mask_to_raster,
    decode_mask_to_rle,
    parse_responses_stream,
    video_segmentation_format,
)

from .. import cache, config
from ..usage_log import logged
from .client import async_client


# --- From Meta's cookbook (MIT): normalise SDK events for the parser --------
async def _stream_events(stream: AsyncIterable[Any]) -> AsyncGenerator[dict, None]:
    """The API streams `response.content_part.done` but not
    `response.output_text.done`, which the parser uses to close a lane, so
    synthesise it from the content part (as Meta's example does)."""
    completed: set[tuple[object, object, object]] = set()
    async for event in stream:
        data = event.model_dump() if hasattr(event, "model_dump") else dict(event)
        lane = (data.get("item_id"), data.get("output_index"), data.get("content_index"))
        if data.get("type") == "response.output_text.done":
            if lane not in completed:
                completed.add(lane)
                yield data
            continue
        yield data
        part = data.get("part")
        if (
            data.get("type") == "response.content_part.done"
            and lane not in completed
            and isinstance(part, dict)
            and part.get("type") == "output_text"
            and isinstance(part.get("text"), str)
        ):
            completed.add(lane)
            yield {
                "type": "response.output_text.done",
                "item_id": data.get("item_id"),
                "output_index": data.get("output_index"),
                "content_index": data.get("content_index"),
                "text": part["text"],
            }


async def _replay(rows: list[dict]) -> AsyncGenerator[dict, None]:
    for r in rows:
        yield r


async def _parse(events: AsyncIterable[dict]) -> VideoSegmentationResult:
    parsed = parse_responses_stream(events, video_segmentation_format())
    async with parsed:
        async for _ in parsed:  # drain snapshots; we only need the final result
            pass
        return await parsed.final_result()


# --- Upload ---------------------------------------------------------------
async def upload_video(path: Path) -> str:
    sha = cache.file_sha(path)
    hit = cache.get_json("sam_upload", sha)
    if hit:
        return hit["file_id"]
    mime = mimetypes.guess_type(path.name)[0] or "video/mp4"
    with logged(config.SAM_MODEL, "files.upload", bytes=path.stat().st_size):
        async with async_client() as api:
            up = await api.files.create(
                file=(path.name, path.read_bytes(), mime), purpose="user_data"
            )
    if not str(up.id).startswith("file-"):
        raise RuntimeError(f"Unexpected file id from Files API: {up.id!r}")
    cache.put_json("sam_upload", sha, {"file_id": up.id})
    return up.id


# --- One concept ----------------------------------------------------------
async def segment_concept(video: Path, concept: str,
                          on_theatre_event: Callable[[dict], None] | None = None) -> VideoSegmentationResult:
    """Track every instance of `concept` through the video (one request)."""
    t0 = time.time()
    sha = cache.file_sha(video)
    metadata = {"include_confidence": "true", "mask_encoding": "one_bit"}
    key = cache.key_for(sha, config.SAM_MODEL, concept, metadata)
    rows, meta = cache.get_jsonl_with_provenance("sam_stream", key)
    if rows is not None:
        with logged(config.SAM_MODEL, f"track '{concept}'", cached=True):
            result = await _parse(_replay(rows))
            latency_ms = round((time.time() - t0) * 1000, 1)
            if on_theatre_event:
                mask_cnt = sum(1 for r in result.records if r.kind == "mask")
                obj_cnt = len(set(r.object_id for r in result.records if r.kind == "mask"))
                on_theatre_event({
                    "step_id": f"sam_track_{concept.replace(' ', '_')}",
                    "model": config.SAM_MODEL,
                    "status": "completed",
                    "provenance": meta["provenance"],
                    "sha256": key,
                    "latency_ms": latency_ms,
                    "artifact_preview": f"Tracked '{concept}': {mask_cnt} mask frames across {obj_cnt} persistent object(s).",
                })
            return result

    file_id = await upload_video(video)
    recorded: list[dict] = []

    async def tee(events: AsyncIterable[dict]) -> AsyncGenerator[dict, None]:
        async for e in events:
            recorded.append(e)
            yield e

    # `input_video` is a Meta Model API extension, absent from the OpenAI SDK's types.
    request_input: Any = [
        {
            "type": "message",
            "role": "user",
            "content": [
                {"type": "input_text", "text": concept},
                {"type": "input_video", "file_id": file_id},
            ],
        }
    ]
    with logged(config.SAM_MODEL, f"track '{concept}'", cached=False):
        async with async_client() as api:
            stream = await api.responses.create(
                model=config.SAM_MODEL,
                stream=True,
                metadata=metadata,
                input=request_input,
            )
            async with stream, aclosing(_stream_events(stream)) as ev, aclosing(tee(ev)) as t:
                result = await _parse(t)
    cache.put_jsonl("sam_stream", key, recorded)
    latency_ms = round((time.time() - t0) * 1000, 1)
    if on_theatre_event:
        mask_cnt = sum(1 for r in result.records if r.kind == "mask")
        obj_cnt = len(set(r.object_id for r in result.records if r.kind == "mask"))
        on_theatre_event({
            "step_id": f"sam_track_{concept.replace(' ', '_')}",
            "model": config.SAM_MODEL,
            "status": "completed",
            "provenance": "live_api",
            "sha256": key,
            "latency_ms": latency_ms,
            "artifact_preview": f"Tracked '{concept}': {mask_cnt} mask frames across {obj_cnt} persistent object(s) (live Meta stream).",
        })
    return result


# --- Convert parser records to Sakshi tracks ------------------------------
def _ground_contact(raster: np.ndarray, left: float, top: float, right: float, bottom: float):
    """Image point where the object meets the road: the lowest band of the mask.

    Returns (x, y) in full-frame pixels, or None for an empty mask. For tall
    vehicles this point sits slightly in front of the true tyre line; the
    engine carries that offset as an uncertainty, not as a fixed truth.
    """
    ys, xs = np.nonzero(raster)
    if len(ys) == 0:
        return None
    h, w = raster.shape
    sx = (right - left) / w
    sy = (bottom - top) / h
    y_max = ys.max()
    band = ys >= y_max - max(1, int(0.05 * h))  # bottom 5% of the mask
    x = left + (xs[band].mean() + 0.5) * sx
    y = top + (y_max + 0.5) * sy
    return float(x), float(y)


def result_to_tracks(result: VideoSegmentationResult, concept: str) -> list[dict]:
    if result.outcome.status != "completed":
        reason = getattr(result.outcome, "reason", "unknown")
        raise RuntimeError(f"SAM 3.1 returned an incomplete result for '{concept}': {reason}")
    errors = [d for d in result.diagnostics if d.severity == "error"]
    if errors:
        raise RuntimeError("; ".join(f"line {d.line}: {d.message}" for d in errors))

    tracks: dict[str, dict] = {}
    for rec in result.records:
        if rec.kind != "mask" or rec.frame is None:
            continue
        tid = f"{concept.replace(' ', '_')}-{rec.object_id}"
        t = tracks.setdefault(tid, {"id": tid, "concept": concept, "frames": []})
        b = rec.bounds
        raster = np.frombuffer(decode_mask_to_raster(rec.mask), dtype=np.uint8).reshape(
            rec.mask.height, rec.mask.width
        )
        rle = decode_mask_to_rle(rec.mask)
        t["frames"].append(
            {
                "i": rec.frame.frame_index,
                "box": [b.left, b.top, b.right, b.bottom],
                "conf": rec.confidence,
                "area_px": int(raster.sum()),
                "contact_px": _ground_contact(raster, b.left, b.top, b.right, b.bottom),
                # Mask-local COCO RLE; the UI places it at `box`.
                "rle": {"size": list(rle["size"]), "counts": rle["counts"]}
                if isinstance(rle, dict)
                else {"size": list(rle.size), "counts": rle.counts},
            }
        )
    for t in tracks.values():
        t["frames"].sort(key=lambda f: f["i"])
    return list(tracks.values())


async def track_video(video: Path, concepts: list[str] | None = None,
                      on_theatre_event: Callable[[dict], None] | None = None) -> list[dict]:
    """Run SAM 3.1 once per concept and merge the tracks."""
    concepts = concepts or config.SAM_CONCEPTS
    results = await asyncio.gather(*(segment_concept(video, c, on_theatre_event=on_theatre_event) for c in concepts))
    out: list[dict] = []
    for c, r in zip(concepts, results):
        out.extend(result_to_tracks(r, c))
    return out