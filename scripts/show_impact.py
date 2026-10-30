"""Save the frame where Sakshi detected the impact, with both road users drawn.

  python scripts/show_impact.py cases/carla_002      # -> cases/carla_002/impact.png
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sakshi.masks import paste_mask  # noqa: E402
from sakshi.video import read_frames  # noqa: E402

COLOURS = [(0, 0, 255), (255, 0, 0)]  # BGR: red, blue


def main(case_dir: str):
    d = Path(case_dir)
    case = json.loads((d / "case.json").read_text())
    imp = case["facts"].get("impact")
    if not imp:
        sys.exit("No impact detected in this case.")
    i = imp["i"]
    img = read_frames(d / case["clip"]["file"], {i})[i]
    for colour, tid in zip(COLOURS, imp["tracks"]):
        track = next(t for t in case["tracks"] if t["id"] == tid)
        f = next((f for f in track["frames"] if f["i"] == i), None)
        if f is None:
            continue
        if f.get("rle"):
            overlay = img.copy()
            overlay[paste_mask(img.shape, f["box"], f["rle"])] = colour
            img = cv2.addWeighted(overlay, 0.5, img, 0.5, 0)
        x0, y0, x1, y1 = (int(round(v)) for v in f["box"])
        cv2.rectangle(img, (x0, y0), (x1, y1), colour, 2)
        cv2.putText(img, tid, (x0, max(15, y0 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, 2)
    cv2.putText(img, f"impact: frame {i}, t = {imp['t']} s", (10, img.shape[0] - 15),
                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
    out = d / "impact.png"
    cv2.imwrite(str(out), img)
    print(f"Saved {out}")


if __name__ == "__main__":
    main(sys.argv[1])
