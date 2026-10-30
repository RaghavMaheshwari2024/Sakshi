"""SAM 3.1 gate: does every road user keep ONE id through the clip?

  python scripts/check_sam.py my_clip.mp4 --concepts car
  python scripts/check_sam.py my_clip.mp4 --concepts car,motorcycle,person

Runs SAM 3.1 (cached: a re-run costs nothing), then writes next to the clip:
  <clip>_tracks.mp4    the clip with each mask, id and ground-contact point drawn
  <clip>_tracks.json   the tracks, in the same format the pipeline uses
and prints one line per track plus warnings for likely id switches.

Watch the _tracks.mp4: a vehicle must keep the same colour and label from the
moment it appears until it leaves. The printed warnings tell you where to look.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sakshi import config  # noqa: E402
from sakshi.masks import paste_mask  # noqa: E402
from sakshi.meta import sam  # noqa: E402
from sakshi.video import iter_frames, probe  # noqa: E402

MIN_FRAMES = 10  # shorter tracks are usually flicker or a broken track


def _colour(k: int) -> tuple[int, int, int]:
    hue = (k * 47) % 180
    bgr = cv2.cvtColor(np.array([[[hue, 220, 255]]], dtype=np.uint8),cv2.COLOR_HSV2BGR)[0, 0]
    return int(bgr[0]), int(bgr[1]), int(bgr[2])


def _centre(box):
    return np.array([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])


def summarise(tracks: list[dict], n_frames: int) -> list[str]:
    """One line per track, then warnings."""
    lines, warnings = [], []
    for t in sorted(tracks, key=lambda t: t["frames"][0]["i"]):
        idx = [f["i"] for f in t["frames"]]
        first, last = idx[0], idx[-1]
        gaps = np.diff(idx) - 1
        conf = [f["conf"] for f in t["frames"] if f.get("conf") is not None]
        conf_txt = f"mean conf {np.mean(conf):.2f}" if conf else "no confidence"
        lines.append(
            f"  {t['id']:<18} frames {first:>4}-{last:<4} seen {len(idx):>4} "
            f"({100 * len(idx) / (last - first + 1):5.1f}% of its span)  "
            f"longest gap {int(gaps.max()) if len(gaps) else 0:>3}  {conf_txt}"
        )
        if len(idx) < MIN_FRAMES:
            warnings.append(f"{t['id']} lives only {len(idx)} frames (flicker, or a broken track)")
        if len(gaps) and gaps.max() > 10:
            k = int(np.argmax(gaps))
            warnings.append(f"{t['id']} disappears for {int(gaps[k])} frames after frame {idx[k]}")

    # A track that ends, then a new id of the same kind that starts close by
    # soon after, is most likely the same vehicle with a new id.
    for a in tracks:
        a_last = a["frames"][-1]
        diag = np.hypot(a_last["box"][2] - a_last["box"][0], a_last["box"][3] - a_last["box"][1])
        for b in tracks:
            if b is a or b["concept"] != a["concept"]:
                continue
            b_first = b["frames"][0]
            if 0 < b_first["i"] - a_last["i"] <= 15:
                d = np.linalg.norm(_centre(b_first["box"]) - _centre(a_last["box"]))
                if d < 1.5 * diag:
                    warnings.append(
                        f"possible ID SWITCH: {a['id']} ends at frame {a_last['i']} and "
                        f"{b['id']} starts at frame {b_first['i']} in the same place"
                    )

    max_i = max((f["i"] for t in tracks for f in t["frames"]), default=-1)
    if max_i >= n_frames:
        warnings.append(
            f"SAM reports frame {max_i} but the clip has {n_frames} frames when decoded "
            "here: frame numbering differs. Re-encode the clip (see the README) and retry."
        )
    return lines + ([""] + [f"  ! {w}" for w in warnings] if warnings else ["", "  no warnings"])


def render(video: Path, tracks: list[dict], out: Path, fps: float):
    by_frame: dict[int, list[tuple[int, dict, dict]]] = {}
    for k, t in enumerate(tracks):
        for f in t["frames"]:
            by_frame.setdefault(f["i"], []).append((k, t, f))
    writer = None
    for i, img in iter_frames(video):
        if writer is None:
            h, w = img.shape[:2]
            writer = cv2.VideoWriter(str(out), cv2.VideoWriter.fourcc(*"mp4v"), fps, (w, h))
        overlay = img.copy()
        for k, t, f in by_frame.get(i, []):
            col = _colour(k)
            if f.get("rle"):
                overlay[paste_mask(img.shape, f["box"], f["rle"])] = col
        img = cv2.addWeighted(overlay, 0.45, img, 0.55, 0)
        for k, t, f in by_frame.get(i, []):
            col = _colour(k)
            x0, y0, x1, y1 = (int(round(v)) for v in f["box"])
            cv2.rectangle(img, (x0, y0), (x1, y1), col, 2)
            cv2.putText(img, t["id"], (x0, max(15, y0 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, col, 2)
            if f.get("contact_px"):
                cx, cy = (int(round(v)) for v in f["contact_px"])
                cv2.circle(img, (cx, cy), 5, (255, 255, 255), -1)
                cv2.circle(img, (cx, cy), 5, col, 2)
        cv2.putText(img, f"frame {i}", (10, img.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                    (255, 255, 255), 2)
        writer.write(img)
    if writer is not None:
        writer.release()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--concepts", default="car", help="comma list, e.g. car,motorcycle,person")
    a = ap.parse_args()
    concepts = [c.strip() for c in a.concepts.split(",") if c.strip()]

    info = probe(a.video)
    print(f"Clip: {info.n} frames, {info.fps:.2f} fps, {info.width}x{info.height}")
    print(f"Calling {config.SAM_MODEL} for: {', '.join(concepts)} (cached after the first run)")
    tracks = asyncio.run(sam.track_video(a.video, concepts))
    print(f"\n{len(tracks)} track(s)")
    print("\n".join(summarise(tracks, info.n)) if tracks else "  none: try another concept word")

    stem = a.video.with_suffix("")
    Path(f"{stem}_tracks.json").write_text(json.dumps(tracks))
    out = Path(f"{stem}_tracks.mp4")
    render(a.video, tracks, out, info.fps)
    print(f"\nWatch {out}: every vehicle should keep one colour and label from entry to exit.")


if __name__ == "__main__":
    main()