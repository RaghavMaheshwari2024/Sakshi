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


def _frames_from_video(video: Path, out_dir: Path) -> list[Path]:
    if not video.exists():
        raise SystemExit(f"No frames/ and no {video.name}: render the scenario first.")
    cap, paths, k = cv2.VideoCapture(str(video)), [], 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        p = out_dir / f"{k:06d}.png"
        cv2.imwrite(str(p), img)
        paths.append(p)
        k += 1
    cap.release()
    return paths


def ref_time(gt) -> float:
    """The moment claims refer to: the impact, or for a near miss the closest approach."""
    if gt.get("t_impact") is not None:
        return gt["t_impact"]
    best = min(gt["frames"], key=lambda r: np.hypot(r["A"]["x"] - r["B"]["x"], r["A"]["y"] - r["B"]["y"]))
    return best["t"]


def _true_speed(gt, name, t0, t1) -> float:
    v = [r[f"{name}_speed_kmh"] for r in gt["frames"] if t0 <= r["t"] <= t1]
    return float(np.mean(v))


def _speed_verdict(claimed: float, true: float) -> str:
    """What a correct checker should say. Claims carry +-10%; a small margin
    either side is genuinely borderline, so either verdict is fine there."""
    off = abs(claimed - true)
    if off <= 0.10 * claimed:
        return "consistent"
    return "inconsistent" if off > 0.10 * claimed + 3.0 else "either"


def _light_at_stop_line(gt):
    """Signal state when A's FRONT crosses its stop line (what Sakshi measures)."""
    if not gt.get("stop_line_A") or not gt.get("signal_changes"):
        return None
    f0, f1 = gt["frames"][0]["A"], gt["frames"][min(len(gt["frames"]) - 1, 25)]["A"]
    u = np.array([f1["x"] - f0["x"], f1["y"] - f0["y"]])
    u /= np.linalg.norm(u) + 1e-9
    p0 = np.array(gt["stop_line_A"][0])
    half = gt["vehicles"]["A"]["length"] / 2
    for r in gt["frames"]:
        front = np.array([r["A"]["x"], r["A"]["y"]]) + half * u
        if (front - p0) @ u >= 0:
            state = None
            for c in gt["signal_changes"]:
                if c["t"] <= r["t"]:
                    state = c["state"]
            return state
    return None


def _statements(gt, args):
    """Two statements in the voices of the drivers, and what a correct checker
    should say about each claim in them (kept in gt.json only)."""
    kind = gt.get("kind", "t_bone")
    t_ref = ref_time(gt)
    win = (t_ref - 1.2, t_ref - 0.2)
    braked = bool(gt.get("a_braking"))
    vb = gt["vehicles"]["B"]
    b_desc = f"{vb['colour']} {vb.get('word', 'car')}" if vb.get("colour") else vb.get("word", "car")
    v1, v2 = _true_speed(gt, "A", *win), _true_speed(gt, "B", *win)
    c1 = args.claim_a if args.claim_a is not None else max(10, 5 * round(v1 * 0.6 / 5))
    c2 = max(5, round(v2))
    s1 = f"I was driving the white car at about {c1:g}"
    exp = [{"statement_id": "s1", "quantity": "speed_kmh", "subject": "A", "claimed": c1,
            "true": round(v1, 1), "expected": _speed_verdict(c1, v1)}]
    if kind != "rear_end":
        s1 += " and the light was green"
        state = _light_at_stop_line(gt)
        if state is not None:
            exp.append({"statement_id": "s1", "quantity": "signal_state_at_stop_line", "subject": "A",
                        "claimed": "green", "true": state,
                        "expected": "consistent" if state == "green" else "inconsistent",
                        "acceptable": ["cant_tell"]})  # lamps are not lit at CARLA's Low quality
    s1 += "."
    if braked and kind != "near_miss":
        s1 += " I braked hard before we hit."
        exp.append({"statement_id": "s1", "quantity": "braked_before_impact", "subject": "A", "claimed": "yes",
                    "true": "yes", "expected": "consistent"})
    s2 = f"Main {b_desc} chala raha tha, dheere, shayad {c2} pe."
    exp.append({"statement_id": "s2", "quantity": "speed_kmh", "subject": "B", "claimed": c2,
                "true": round(v2, 1), "expected": _speed_verdict(c2, v2)})
    if kind != "near_miss":
        s2 += " White car ne brake bilkul nahi lagaya."  # "the white car did not brake at all"
        exp.append({"statement_id": "s2", "quantity": "braked_before_impact", "subject": "A", "claimed": "no",
                    "true": "yes" if braked else "no", "expected": "inconsistent" if braked else "consistent"})
    statements = [{"id": "s1", "speaker": "Driver of the white car", "text": s1},
                  {"id": "s2", "speaker": f"Driver of the {b_desc}", "text": s2}]
    return statements, exp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("--drop", type=float, default=0.12)
    ap.add_argument("--dup", type=float, default=0.03)
    ap.add_argument("--crf", type=int, default=32)
    ap.add_argument("--scale", type=float, default=0.75, help="downscale, like a cheap DVR")
    ap.add_argument("--click-noise-px", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--no-clock", action="store_true", help="no burned-in clock (many phone and some CCTV clips)")
    ap.add_argument("--claim-a", type=float, default=None,
                    help="speed the white car's driver claims, km/h (default: an understatement)")
    args = ap.parse_args()
    d = Path(args.case_dir)
    rng = np.random.default_rng(args.seed)
    gt = json.loads((d / ("gt_clean.json" if (d / "gt_clean.json").exists() else "gt.json")).read_text())
    shutil.copy(d / "gt.json", d / "gt_clean.json") if not (d / "gt_clean.json").exists() else None
    frames = sorted((d / "frames").glob("*.png"))
    if not frames:  # the PNGs were deleted to save space: decode the clean render instead
        frames = _frames_from_video(d / "input_clean.mp4", Path(tempfile.mkdtemp(prefix="sakshi_frames_")))

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
            if not args.no_clock:
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

    statements, expected = _statements(gt, args)
    gt_out = {**gt, "frames": out_rows, "true_ticks": ticks, "expected_claims": expected,
              "degradation": {"drop": args.drop, "dup": args.dup, "crf": args.crf, "scale": args.scale,
                              "clock": not args.no_clock}}
    (d / "gt.json").write_text(json.dumps(gt_out, indent=1))

    # Calibration from the true camera: 12 road points spread over the parts of
    # both vehicles' lanes that the camera sees (3 m either side of each path),
    # as a user would click road marks, plus realistic click noise.
    proj = project_fn(gt["camera"])
    h, w = int(gt["camera"]["height"] * args.scale), int(gt["camera"]["width"] * args.scale)
    f0, fi = gt["frames"][0], gt["frames"][min(len(gt["frames"]) - 1, int(gt["fps"] * 4))]
    t_ref = ref_time(gt)
    imp = min(gt["frames"], key=lambda r: abs(r["t"] - t_ref))
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
        # Statements describe the vehicles as a person would (colour, type), so
        # Muse Wonder must find which track each speaker drove from the pictures.
        "statements": statements,
        "camera_mode": "fixed",
        "calibration": {
            "image_pts": img_pts[visible].tolist(), "ground_pts_m": ground[visible].tolist(),
            "stop_line_m": stop_line,
            # The clock text is drawn after resizing, so its box does not scale.
            "clock_box_px": None if args.no_clock else [6, 6, 330, 42],
            "signal_light_px": signal_px,
        },
        "party_to_track": None,
        "languages": ["Hindi", "English"],
    }
    (d / "case_input.json").write_text(json.dumps(case_input, indent=1))
    print(f"{len(out_rows)} frames written ({int((~keep).sum())} dropped); "
          f"{int(visible.sum())} calibration points visible; "
          f"{'no clock' if args.no_clock else str(len(ticks)) + ' clock ticks'}; "
          f"signal head {'at ' + str(signal_px) if signal_px else 'NOT in view'}")


if __name__ == "__main__":
    main()
