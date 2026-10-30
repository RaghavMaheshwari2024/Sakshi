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

    proj.depth = lambda pts: (np.atleast_2d(pts) - c) @ fwd  # > 0: in front of the camera
    return proj


def _spread(points: np.ndarray, k: int) -> list[int]:
    """Indices of k points spread out (farthest-point sampling), like a user
    clicking marks all over the visible road."""
    chosen = [int(np.argmin(points[:, 0] + points[:, 1]))]
    dist = np.linalg.norm(points - points[chosen[0]], axis=1)
    while len(chosen) < min(k, len(points)):
        i = int(np.argmax(dist))
        chosen.append(i)
        dist = np.minimum(dist, np.linalg.norm(points - points[i], axis=1))
    return chosen


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

    # Calibration from the true camera: 12 road points spread over the parts of
    # both vehicles' lanes that the camera sees (3 m either side of each path),
    # as a user would click road marks, plus realistic click noise.
    proj = project_fn(gt["camera"])
    h, w = int(gt["camera"]["height"] * args.scale), int(gt["camera"]["width"] * args.scale)
    f0, fi = gt["frames"][0], gt["frames"][min(len(gt["frames"]) - 1, int(gt["fps"] * 4))]
    imp = gt["frames"][-1] if gt.get("t_impact") is None else min(
        gt["frames"], key=lambda r: abs(r["t"] - gt["t_impact"]))
    z = np.mean([f0["A"]["z"], f0["B"]["z"]])
    cand = []
    for name in ("A", "B"):
        rows = [r for r in gt["frames"] if r["t"] <= imp["t"]][::5]
        for r0, r1 in zip(rows, rows[1:]):
            a = np.array([r0[name]["x"], r0[name]["y"]])
            u = np.array([r1[name]["x"], r1[name]["y"]]) - a
            if np.linalg.norm(u) < 1e-6:
                continue
            n = np.array([-u[1], u[0]]) / np.linalg.norm(u)
            cand += [a + 3.0 * n, a - 3.0 * n]
    cand = np.array(cand)
    c3 = np.c_[cand, np.full(len(cand), z)]
    px = proj(c3) * args.scale
    m = 10  # keep clicks off the very edge of the image
    depth = proj.depth(c3)
    # Marks beyond ~70 m are a few pixels wide; nobody would click them.
    ok = (depth > 1) & (depth < 70) & (px[:, 0] > m) & (px[:, 0] < w - m) & (px[:, 1] > m) & (px[:, 1] < h - m)
    if ok.sum() < 4:
        raise SystemExit("Fewer than 4 road points are in view: move the camera (see junction_crash.py options).")
    sel = _spread(cand[ok], 12)
    ground = cand[ok][sel]
    img_pts = px[ok][sel] + rng.normal(0, args.click_noise_px, (len(sel), 2))
    visible = np.ones(len(ground), bool)
    # Stop line: across A's lane through the stop waypoint, perpendicular to A's path.
    stop_line = None
    if gt.get("stop_line_A"):
        a = np.array([f0["A"]["x"], f0["A"]["y"]])
        b = np.array([fi["A"]["x"], fi["A"]["y"]])
        u = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-u[1], u[0]])
        p0 = np.array(gt["stop_line_A"][0])
        stop_line = [(p0 - 3.5 * n).tolist(), (p0 + 3.5 * n).tolist()]
    # The pixel of A's signal head, so the pipeline picks that light's track
    # (in the UI the user clicks it). Only if it is in view.
    signal_px = None
    if gt.get("light_A_xyz"):
        lp = proj(np.array(gt["light_A_xyz"]))[0] * args.scale
        if proj.depth(np.array(gt["light_A_xyz"]))[0] > 1 and 0 <= lp[0] < w and 0 <= lp[1] < h:
            signal_px = [round(float(lp[0]), 1), round(float(lp[1]), 1)]
    case_input = {
        # Statements describe the cars as a person would (by colour), so Muse Wonder
        # must find which track each speaker drove from the pictures. s2 is in Hinglish.
        "statements": [
            {"id": "s1", "speaker": "Driver of the white car",
             "text": "I was driving the white car at about 30 and the light was green."},
            {"id": "s2", "speaker": "Driver of the blue car",
             "text": f"Main blue car chala raha tha, dheere, shayad {round(gt.get('v2_kmh', 30))} pe."},
        ],
        "calibration": {
            "image_pts": img_pts[visible].tolist(), "ground_pts_m": ground[visible].tolist(),
            "stop_line_m": stop_line,
            "clock_box_px": [6, 6, int(330 * args.scale / 0.75), 42],
            "signal_light_px": signal_px,
        },
        "party_to_track": None,
        "languages": ["Hindi", "English"],
    }
    (d / "case_input.json").write_text(json.dumps(case_input, indent=1))
    print(f"{len(out_rows)} frames written ({int((~keep).sum())} dropped); "
          f"{int(visible.sum())} calibration points visible; {len(ticks)} clock ticks; "
          f"signal head {'at ' + str(signal_px) if signal_px else 'NOT in view'}")


if __name__ == "__main__":
    main()
