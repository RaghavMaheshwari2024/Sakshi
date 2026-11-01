"""Export one real frame and its SAM masks for the Overview's opening exhibit.

  python ui/scripts/export_overview_frame.py <case_dir> <frame>     # from the repo root

Writes ui/public/overview/. Masks and verdicts come from the case's own case.json.
The top of the frame is cropped: it holds the camera operator's logo, and showing
it could suggest endorsement. The caption line at the bottom goes with it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

CROP_TOP, CROP_BOTTOM = 52, 20
OUT = Path(__file__).resolve().parents[1] / "public" / "overview"


def main(case_dir: str, frame: int) -> None:
    d = Path(case_dir)
    case = json.loads((d / "case.json").read_text())
    cap = cv2.VideoCapture(str(d / "input.mp4"))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame)
    ok, img = cap.read()
    if not ok:
        raise SystemExit(f"could not read frame {frame}")
    h = img.shape[0]
    OUT.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(OUT / "real_frame.jpg"), img[CROP_TOP:h - CROP_BOTTOM], [cv2.IMWRITE_JPEG_QUALITY, 92])
    subjects = {c["subject_track"] for c in case["claims"]}
    masks = []
    for t in case["tracks"]:
        f = next((x for x in t["frames"] if x["i"] == frame), None)
        if f and t["id"] in subjects:
            masks.append({"id": t["id"], "box": f["box"], "rle": f.get("rle"), "contact_px": f.get("contact_px")})
    claim = next(c for c in case["claims"] if c["verdict"] == "inconsistent")
    (OUT / "real_case.json").write_text(json.dumps({
        "width": case["clip"]["width"], "height": h, "crop_top": CROP_TOP, "crop_bottom": CROP_BOTTOM,
        "masks": masks,
        "claim": {k: claim[k] for k in ("quote", "value_number", "verdict", "measured", "subject_track")},
    }))


if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]))
