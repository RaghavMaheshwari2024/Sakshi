"""Day-1 checks: one small real call to each Meta model, results printed and cached.

  python scripts/make_synthetic_case.py          # gives us a clip with a clock
  python scripts/smoke_test.py --video cases/synthetic/input.mp4 --audio my_statement.m4a

Costs: SAM is billed per frame (minimum 50 frames per request), so the test uses
ONE concept on a short clip. Everything is cached; a re-run costs nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv()

from sakshi.video import crop, read_frames  # noqa: E402


def check_sam(video: Path, concept: str):
    from sakshi.meta import sam

    tracks = asyncio.run(sam.track_video(video, [concept]))
    print(f"SAM 3.1 '{concept}': {len(tracks)} track(s)")
    for t in tracks:
        fr = [f["i"] for f in t["frames"]]
        print(f"  {t['id']}: frames {min(fr)}-{max(fr)}, seen in {len(fr)}; "
              f"first contact point {t['frames'][0]['contact_px']}")
    print("  -> GATE: does each car keep ONE id from start to end? Check the frame ranges.")


def check_spark(video: Path, box):
    from sakshi.meta import spark

    f = read_frames(video, {0, 30})
    for i, img in f.items():
        print(f"Muse Spark clock read, frame {i}:", json.dumps(spark.read_timestamp(crop(img, box, 4))))


def check_voice(audio: Path):
    from sakshi.meta import voice

    out = voice.transcribe(audio, languages=["Hindi", "English"])
    print("Muse Voice Transcribe:", out.get("transcript"), f"({out.get('audioDurationMs')} ms)")


def check_wonder():
    from sakshi.meta import wonder

    claims = wonder.extract_claims(
        [{"id": "s1", "speaker": "Driver of the white car", "text": "Main 30 pe chala raha tha aur signal green tha."},
         {"id": "s2", "speaker": "Rider of the motorcycle", "text": "He came through on red, very fast."}],
        {"s1": "car-0", "s2": "motorcycle-0"},
    )
    print("Muse Wonder claims:", json.dumps(claims, ensure_ascii=False, indent=1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path)
    ap.add_argument("--concept", default="car")
    ap.add_argument("--clock-box", default="15,10,420,52", help="x1,y1,x2,y2 of the clock overlay")
    ap.add_argument("--audio", type=Path)
    ap.add_argument("--skip", default="", help="comma list: sam,spark,voice,wonder")
    a = ap.parse_args()
    skip = set(a.skip.split(","))
    if a.video and "sam" not in skip:
        check_sam(a.video, a.concept)
    if a.video and "spark" not in skip:
        check_spark(a.video, [int(v) for v in a.clock_box.split(",")])
    if a.audio and "voice" not in skip:
        check_voice(a.audio)
    if "wonder" not in skip:
        check_wonder()


if __name__ == "__main__":
    main()
