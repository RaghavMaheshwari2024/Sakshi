"""Build a synthetic junction crash with exact ground truth, no GPU or API needed.

It renders a CCTV-style clip (pinhole camera 9 m up), drops frames the way a
cheap recorder does, burns in a clock, and writes:

  cases/synthetic/input.mp4         the clip (nominal 25 fps, frames dropped)
  cases/synthetic/case_input.json   calibration clicks, statements, test claims
  cases/synthetic/tracks.json       SAM-shaped tracks (box + ground contact pixel)
  cases/synthetic/gt.json           true speeds, impact time, signal changes

Use it to test the engine end to end (scripts/run_case.py --offline) and as the
UI's mock case. It does NOT replace CARLA or real footage for the pitch.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent

W, H_IMG, FPS = 1280, 720, 25.0
K = np.array([[900.0, 0, W / 2], [0, 900.0, H_IMG / 2], [0, 0, 1]])
CAM = np.array([-20.0, -24.0, 9.0])
TARGET = np.array([0.0, 0.0, 0.0])


def look_at(c, target):
    f = target - c
    f /= np.linalg.norm(f)
    r = np.cross(f, [0, 0, 1.0])
    r /= np.linalg.norm(r)
    d = np.cross(f, r)  # image "down"
    return np.stack([r, d, f])  # rows: camera x (right), y (down), z (forward)


R = look_at(CAM, TARGET)


def project(X):
    X = np.atleast_2d(X)
    pc = (X - CAM) @ R.T
    uv = (pc[:, :2] / pc[:, 2:3]) * [K[0, 0], K[1, 1]] + K[:2, 2]
    return uv


def box_corners(center_xy, heading, L, Wd, Ht):
    c, s = np.cos(heading), np.sin(heading)
    dx = np.array([c, s]) * L / 2
    dy = np.array([-s, c]) * Wd / 2
    base = [center_xy + a * dx + b * dy for a in (-1, 1) for b in (-1, 1)]
    return np.array([[*p, z] for z in (0.0, Ht) for p in base])


def simulate(T=6.0, dt=1 / FPS):
    """Car A along +x brakes, then its front hits the side of car B (along +y),
    whose centre is at the origin at the moment of impact."""
    m1, m2 = 1400.0, 1150.0
    t_imp = 4.0
    v1_0, a1, t_brake = 50 / 3.6, -6.0, 3.2  # A: 50 km/h, brakes from 3.2 s
    v2 = 30 / 3.6  # B: steady 30 km/h
    v1_imp = v1_0 + a1 * (t_imp - t_brake)

    def a_state(t):
        if t < t_brake:
            x = -(v1_0 * (t_brake - 0) + v1_0 * (t_imp - t_brake) + 0.5 * a1 * (t_imp - t_brake) ** 2) + v1_0 * t
            return x - 3.1, v1_0
        tb = t - t_brake
        x_b = -(v1_0 * (t_imp - t_brake) + 0.5 * a1 * (t_imp - t_brake) ** 2)
        return x_b + v1_0 * tb + 0.5 * a1 * tb * tb - 3.1, v1_0 + a1 * tb

    vc = (m1 * np.array([v1_imp, 0]) + m2 * np.array([0, v2])) / (m1 + m2)
    rows = []
    for k in range(int(T / dt) + 1):
        t = k * dt
        if t <= t_imp:
            xa, va = a_state(t)
            pa, vela = np.array([xa, 0.0]), np.array([va, 0.0])
            pb, velb = np.array([0.0, -v2 * (t_imp - t)]), np.array([0.0, v2])
        else:  # vehicles move off together, decelerating at 5 m/s^2
            tau = t - t_imp
            sp = np.linalg.norm(vc)
            dec = 5.0
            tau_s = min(tau, sp / dec)
            dist = sp * tau_s - 0.5 * dec * tau_s**2
            u = vc / sp
            pa = np.array([-3.1, 0.0]) + u * dist  # A's front was in contact with B's side
            pb = u * dist
            vel = u * max(sp - dec * tau, 0)
            vela = velb = vel
        rows.append({"t": t, "A": (pa, vela), "B": (pb, velb)})
    return rows, t_imp


def light_state(t):
    return "green" if t < 1.0 else ("amber" if t < 2.0 else "red")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "cases" / "synthetic"))
    ap.add_argument("--drop", type=float, default=0.12, help="fraction of frames dropped")
    ap.add_argument("--seed", type=int, default=3)
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    rows, t_imp = simulate()
    keep = rng.random(len(rows)) > args.drop
    keep[60:65] = False  # one burst of 5 lost frames, a classic recorder glitch
    keep[0] = keep[-1] = True
    rows = [r for r, k in zip(rows, keep) if k]

    light_px = np.array([905.0, 150.0])
    vw = cv2.VideoWriter(str(out / "input.mp4"), cv2.VideoWriter.fourcc(*"mp4v"), FPS, (W, H_IMG))
    tracks = {"car-A": [], "car-B": [], "traffic_light-0": []}
    base_clock = 10 * 3600 + 15 * 60 + 30  # 10:15:30
    for i, r in enumerate(rows):
        img = np.full((H_IMG, W, 3), 70, np.uint8)
        # Road surface and lane marks, drawn on the ground plane.
        for y in np.arange(-30, 31, 3.5):
            a, b = project(np.array([[-40, y, 0], [40, y, 0]]))
            cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), (95, 95, 95), 1)
        sl = project(np.array([[-8, -3.5, 0], [-8, 3.5, 0]]))  # stop line for A
        cv2.line(img, tuple(sl[0].astype(int)), tuple(sl[1].astype(int)), (230, 230, 230), 3)
        for name, colour, dims in (("A", (60, 60, 220), (4.4, 1.8, 1.5)), ("B", (220, 200, 60), (4.2, 1.75, 1.5))):
            p, v = r[name]
            head = np.arctan2(v[1], v[0]) if np.linalg.norm(v) > 0.1 else (0.0 if name == "A" else np.pi / 2)
            corners = box_corners(p, head, *dims)
            if ((corners - CAM) @ R.T)[:, 2].min() < 1.0:
                continue  # behind or beside the camera: not visible, so SAM would not track it
            uv = project(corners)
            if uv[:, 0].max() < 0 or uv[:, 0].min() > W or uv[:, 1].max() < 0 or uv[:, 1].min() > H_IMG:
                continue  # outside the frame
            hull = cv2.convexHull(uv.astype(np.float32)).astype(int)
            cv2.fillConvexPoly(img, hull, colour)
            bottom = uv[:4][np.argmax(uv[:4, 1])]  # lowest ground corner = mask's lowest pixel
            if not (0 <= bottom[0] < W and 0 <= bottom[1] < H_IMG):
                continue  # contact point cut off by the frame edge
            tracks[f"car-{name}"].append(
                {"i": i, "box": [*uv.min(0).tolist(), *uv.max(0).tolist()],
                 "contact_px": (bottom + rng.normal(0, 0.8, 2)).tolist(), "conf": 0.95}
            )
        st = light_state(r["t"])
        col = {"red": (0, 0, 255), "amber": (0, 170, 255), "green": (0, 220, 0)}[st]
        cv2.rectangle(img, (890, 110), (920, 190), (20, 20, 20), -1)
        cy = {"red": 125, "amber": 150, "green": 175}[st]
        cv2.circle(img, (905, cy), 10, col, -1)
        tracks["traffic_light-0"].append({"i": i, "box": [890, 110, 920, 190], "contact_px": None, "conf": 0.9})
        clock_s = base_clock + int(r["t"])
        txt = f"2026-10-30 {clock_s // 3600:02d}:{clock_s % 3600 // 60:02d}:{clock_s % 60:02d}"
        cv2.putText(img, txt, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
        vw.write(img)
    vw.release()

    concept = {"car-A": "car", "car-B": "car", "traffic_light-0": "traffic light"}
    track_list = [{"id": k, "concept": concept[k], "frames": v} for k, v in tracks.items()]
    (out / "tracks.json").write_text(json.dumps(track_list))

    # Calibration: 6 road points the user would click (with click noise).
    ground = np.array([[-15, -3.5], [-15, 3.5], [10, -3.5], [10, 3.5], [0, -14], [0, 12]], float)
    clicks = project(np.c_[ground, np.zeros(len(ground))]) + rng.normal(0, 1.5, (len(ground), 2))
    ticks, last = [], None
    for i, r in enumerate(rows):
        s = base_clock + int(r["t"])
        if last is not None and s != last:
            ticks.append([i, float(s)])
        last = s
    case_input = {
        "statements": [
            {"id": "s1", "speaker": "Driver of the red car (A)", "text": "I was doing 30 and the light was green."},
            {"id": "s2", "speaker": "Driver of the yellow car (B)", "text": "I was going about 30."},
        ],
        "calibration": {"image_pts": clicks.tolist(), "ground_pts_m": ground.tolist(),
                        "stop_line_m": [[-8, -3.5], [-8, 3.5]], "clock_box_px": [15, 10, 420, 52]},
        "party_to_track": {"s1": "car-A", "s2": "car-B"},
        "clock_ticks_override": ticks,
        "claims_override": [
            {"statement_id": "s1", "quote": "I was doing 30", "subject_track": "car-A",
             "quantity": "speed_kmh", "value_number": 30, "value_text": None, "when": "just_before_impact"},
            {"statement_id": "s1", "quote": "the light was green", "subject_track": "car-A",
             "quantity": "signal_state_at_stop_line", "value_number": None, "value_text": "green",
             "when": "at_stop_line"},
            {"statement_id": "s2", "quote": "I was going about 30", "subject_track": "car-B",
             "quantity": "speed_kmh", "value_number": 30, "value_text": None, "when": "just_before_impact"},
        ],
    }
    (out / "case_input.json").write_text(json.dumps(case_input, indent=1))
    gt = {
        "t_impact": t_imp,
        "frames": [{"i": i, "t": r["t"], "A_speed_kmh": float(np.linalg.norm(r["A"][1]) * 3.6),
                    "B_speed_kmh": float(np.linalg.norm(r["B"][1]) * 3.6)} for i, r in enumerate(rows)],
        "signal_changes": [{"t": 0.0, "state": "green"}, {"t": 1.0, "state": "amber"}, {"t": 2.0, "state": "red"}],
        "expected_verdicts": ["inconsistent", "inconsistent", "consistent"],
        "kept_frames": len(rows),
    }
    (out / "gt.json").write_text(json.dumps(gt))
    print(f"Wrote {out} ({len(rows)} frames kept of {len(keep)})")


if __name__ == "__main__":
    main()
