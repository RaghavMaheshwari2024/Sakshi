"""Turn a clean CARLA render into realistic CCTV footage, keeping exact truth.

  python sim/degrade.py cases/carla_001 --drop 0.12 --dup 0.03 --crf 32

Writes into the same folder:
  input.mp4          degraded clip: frames dropped and duplicated, a burned-in
                     clock (whole seconds, like most recorders), strong compression
  gt.json            re-indexed to the degraded clip's frame numbers (original kept
                     as gt_clean.json)
  case_input.json    calibration from the TRUE camera (6 road points projected,
                     plus realistic click noise), the stop line, and statements

Every number the pitch quotes from CARLA comes from comparing a run on
input.mp4 against this gt.json.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def project_fn(cam):
    """Pinhole projection for a CARLA camera (UE axes: x forward, y right, z up)."""
    p, y = math.radians(cam["pitch"]), math.radians(cam["yaw"])
    fwd = np.array([math.cos(p) * math.cos(y), math.cos(p) * math.sin(y), math.sin(p)])
    right = np.array([-math.sin(y), math.cos(y), 0.0])
    up = np.cross(fwd, right)  # checked: yaw=pitch=0 gives (0, 0, 1)
    f = cam["width"] / (2 * math.tan(math.radians(cam["fov_deg"]) / 2))
    c = np.array([cam["x"], cam["y"], cam["z"]])

    def proj(pts):
        d = np.atleast_2d(pts) - c
        x, yy, z = d @ fwd, d @ right, d @ up
        return np.c_[cam["width"] / 2 + f * yy / x, cam["height"] / 2 - f * z / x]

    return proj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("--drop", type=float, default=0.12)
    ap.add_argument("--dup", type=float, default=0.03)
    ap.add_argument("--crf", type=int, default=32)
    ap.add_argument("--scale", type=float, default=0.75, help="downscale, like a cheap DVR")
    ap.add_argument("--click-noise-px", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    d = Path(args.case_dir)
    rng = np.random.default_rng(args.seed)
    gt = json.loads((d / ("gt_clean.json" if (d / "gt_clean.json").exists() else "gt.json")).read_text())
    shutil.copy(d / "gt.json", d / "gt_clean.json") if not (d / "gt_clean.json").exists() else None
    frames = sorted((d / "frames").glob("*.png"))

    keep = rng.random(len(frames)) > args.drop
    keep[0] = keep[-1] = True
    base_clock = 17 * 3600 + 42 * 60 + 5
    out_rows, ticks, last_sec = [], [], None
    with tempfile.TemporaryDirectory() as tmp:
        k = 0
        for src_i, (path, kept) in enumerate(zip(frames, keep)):
            if not kept:
                continue
            reps = 2 if rng.random() < args.dup else 1  # duplicated frame
            img = cv2.imread(str(path))
            if img is None:
                raise SystemExit(f"could not read frame {path}")
            img = cv2.resize(img, None, fx=args.scale, fy=args.scale, interpolation=cv2.INTER_AREA)
            t = gt["frames"][src_i]["t"]
            sec = base_clock + int(math.floor(t))
            txt = f"30-10-2026 {sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"
            cv2.putText(img, txt, (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            for _ in range(reps):
                cv2.imwrite(f"{tmp}/{k:06d}.png", img)
                row = dict(gt["frames"][src_i])
                row["i"], row["src_i"] = k, src_i
                out_rows.append(row)
                if last_sec is not None and sec != last_sec:
                    ticks.append([k, float(sec)])
                last_sec = sec
                k += 1
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(gt["fps"]), "-i",
                        f"{tmp}/%06d.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf",
                        str(args.crf), str(d / "input.mp4")], check=True)

    gt_out = {**gt, "frames": out_rows, "true_ticks": ticks,
              "degradation": {"drop": args.drop, "dup": args.dup, "crf": args.crf, "scale": args.scale}}
    (d / "gt.json").write_text(json.dumps(gt_out, indent=1))

    # Calibration from the true camera: road points around both vehicle paths.
    proj = project_fn(gt["camera"])
    f0, fi = gt["frames"][0], gt["frames"][min(len(gt["frames"]) - 1, int(gt["fps"] * 4))]
    z = np.mean([f0["A"]["z"], f0["B"]["z"]])
    pts = []
    for name in ("A", "B"):
        a = np.array([f0[name]["x"], f0[name]["y"]])
        b = np.array([fi[name]["x"], fi[name]["y"]])
        n = np.array([-(b - a)[1], (b - a)[0]])
        n /= np.linalg.norm(n) + 1e-9
        pts += [a + 3.0 * n, a - 3.0 * n, b + 3.0 * n]
    ground = np.array(pts)
    img_pts = proj(np.c_[ground, np.full(len(ground), z)]) * args.scale
    img_pts += rng.normal(0, args.click_noise_px, img_pts.shape)
    h, w = int(gt["camera"]["height"] * args.scale), int(gt["camera"]["width"] * args.scale)
    visible = (img_pts[:, 0] > 0) & (img_pts[:, 0] < w) & (img_pts[:, 1] > 0) & (img_pts[:, 1] < h)
    # Stop line: across A's lane through the stop waypoint, perpendicular to A's path.
    stop_line = None
    if gt.get("stop_line_A"):
        a = np.array([f0["A"]["x"], f0["A"]["y"]])
        b = np.array([fi["A"]["x"], fi["A"]["y"]])
        u = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-u[1], u[0]])
        p0 = np.array(gt["stop_line_A"][0])
        stop_line = [(p0 - 3.5 * n).tolist(), (p0 + 3.5 * n).tolist()]
    case_input = {
        "statements": [
            {"id": "s1", "speaker": "Driver of vehicle A", "text": "I was driving at about 30 and the light was green."},
            {"id": "s2", "speaker": "Driver of vehicle B", "text": f"I was going slowly, maybe {round(gt.get('v2_kmh', 30))}."},
        ],
        "calibration": {
            "image_pts": img_pts[visible].tolist(), "ground_pts_m": ground[visible].tolist(),
            "stop_line_m": stop_line,
            "clock_box_px": [6, 6, int(330 * args.scale / 0.75), 42],
        },
        "party_to_track": None,
        "languages": ["Hindi", "English"],
    }
    (d / "case_input.json").write_text(json.dumps(case_input, indent=1))
    print(f"{len(out_rows)} frames written ({int((~keep).sum())} dropped); "
          f"{int(visible.sum())} calibration points visible; {len(ticks)} clock ticks")


if __name__ == "__main__":
    main()
