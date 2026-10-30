"""CARLA scenario: a side impact at a signalised junction, filmed from a fixed
CCTV-style camera, with exact ground truth logged every frame.

Needs a running CARLA server (0.9.13+; tested API surface is stable from 0.9.11):
  ./CarlaUE4.sh -RenderOffScreen            # on the GPU machine or a Modal GPU box
  python sim/junction_crash.py --out cases/carla_001 --v1 50 --v2 30 --seed 1
  (options: --cam-ahead 29 --cam-side 8 --cam-height 11 --fov 90 to move the camera)

Writes:
  <out>/frames/000000.png ...   raw frames
  <out>/input_clean.mp4         clip at the simulation rate (no degradation)
  <out>/gt.json                 per-frame positions/speeds, impact time, light states,
                                camera intrinsics and pose, so a perfect homography
                                and perfect calibration clicks can be derived
Then make it CCTV-like:
  python sim/degrade.py <out>   (drops/duplicates frames, compresses, burns a clock)

Vehicle A runs at constant speed v1 toward the junction; vehicle B crosses at v2,
timed so they meet. A's traffic light is scripted green -> amber -> red so that A
crosses on red. Constant-velocity control keeps speeds exact until impact; after
impact control is released and physics takes over.
"""

from __future__ import annotations

import argparse
import json
import math
import queue
import random
import subprocess
from pathlib import Path
from typing import cast

import carla  # pip install carla==<your server version>

FPS = 25
W, H = 1280, 720


def pick_junction(world, rng):
    """A signalised junction with two roughly perpendicular entry lanes."""
    m = world.get_map()
    seen = set()
    options = []
    for wp in m.generate_waypoints(3.0):
        if not wp.is_junction:
            continue
        j = wp.get_junction()
        if j.id in seen:
            continue
        seen.add(j.id)
        lights = world.get_traffic_lights_in_junction(j.id)
        if not lights:
            continue
        entries = [a for a, _ in j.get_waypoints(carla.LaneType.Driving)]
        for e1 in entries:
            for e2 in entries:
                d = abs((e1.transform.rotation.yaw - e2.transform.rotation.yaw + 180) % 360 - 180)
                if 75 < d < 105:
                    options.append((j, e1, e2, lights))
    if not options:
        raise RuntimeError("No suitable signalised junction in this map; try Town03 or Town05.")
    return rng.choice(options)


def conflict_point(e1, e2):
    """Where the straight-line paths of the two entries intersect."""
    p1, p2 = e1.transform.location, e2.transform.location
    f1, f2 = e1.transform.get_forward_vector(), e2.transform.get_forward_vector()
    den = f1.x * f2.y - f1.y * f2.x
    s = ((p2.x - p1.x) * f2.y - (p2.y - p1.y) * f2.x) / den
    return carla.Location(p1.x + s * f1.x, p1.y + s * f1.y, p1.z)


def back_off(wp, metres):
    prev = wp.previous(metres)
    if not prev:
        raise RuntimeError("Not enough road behind the junction entry.")
    return prev[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--town", default="Town03")
    ap.add_argument("--v1", type=float, default=50.0, help="vehicle A speed, km/h")
    ap.add_argument("--v2", type=float, default=30.0, help="vehicle B speed, km/h")
    ap.add_argument("--lead", type=float, default=5.0, help="seconds before impact at start")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--host", default="localhost")
    # Default view: like a CCTV camera facing oncoming traffic, placed beyond the
    # junction on the side away from B's approach. It sees both cars for their
    # whole approach (a camera behind A's road sees A for only ~1 s).
    ap.add_argument("--cam-ahead", type=float, default=29.0, help="camera distance beyond the junction along A's road, m")
    ap.add_argument("--cam-side", type=float, default=8.0, help="camera offset away from B's side of the road, m")
    ap.add_argument("--cam-height", type=float, default=11.0, help="camera height above the road, m")
    ap.add_argument("--fov", type=float, default=90.0, help="horizontal field of view, degrees (CCTV is often 90+)")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = Path(args.out)
    (out / "frames").mkdir(parents=True, exist_ok=True)

    client = carla.Client(args.host, 2000)
    client.set_timeout(180.0)  # loading a map can take minutes on a laptop GPU
    world = client.get_world()
    if not world.get_map().name.endswith(args.town):
        print(f"Loading {args.town} (can take a minute or two)...")
        world = client.load_world(args.town)
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = 1.0 / FPS
    world.apply_settings(settings)
    bp = world.get_blueprint_library()
    actors = []
    try:
        junction, e1, e2, lights = pick_junction(world, rng)
        cp = conflict_point(e1, e2)
        v1, v2 = args.v1 / 3.6, args.v2 / 3.6
        # Start each vehicle so both reach the conflict point after `lead` s.
        # A aims its front at B's centre: A arrives ~2.5 m (half a car) earlier.
        d1 = v1 * args.lead + 2.2
        d2 = v2 * args.lead
        dist_e1 = e1.transform.location.distance(cp)
        dist_e2 = e2.transform.location.distance(cp)
        s1 = back_off(e1, max(d1 - dist_e1, 1.0))
        s2 = back_off(e2, max(d2 - dist_e2, 1.0))
        tA = s1.transform
        tB = s2.transform
        tA.location.z += 0.3
        tB.location.z += 0.3
        car_a = world.spawn_actor(bp.find("vehicle.tesla.model3"), tA)
        car_b = world.spawn_actor(bp.find("vehicle.audi.a2"), tB)
        actors += [car_a, car_b]

        # Fixed CCTV-style camera beyond the junction, facing A's oncoming traffic,
        # on the side of A's road away from where B comes from; it looks at the junction.
        fwd = e1.transform.get_forward_vector()
        right = e1.transform.get_right_vector()
        b_side = (tB.location.x - cp.x) * right.x + (tB.location.y - cp.y) * right.y
        away = -1.0 if b_side > 0 else 1.0
        cam_loc = carla.Location(cp.x + args.cam_ahead * fwd.x + away * args.cam_side * right.x,
                                 cp.y + args.cam_ahead * fwd.y + away * args.cam_side * right.y,
                                 cp.z + args.cam_height)
        dx, dy, dz = cp.x - cam_loc.x, cp.y - cam_loc.y, cp.z - cam_loc.z
        yaw = math.degrees(math.atan2(dy, dx))
        pitch = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
        cam_bp = bp.find("sensor.camera.rgb")
        cam_bp.set_attribute("image_size_x", str(W))
        cam_bp.set_attribute("image_size_y", str(H))
        cam_bp.set_attribute("fov", str(args.fov))
        cam_tf = carla.Transform(cam_loc, carla.Rotation(pitch=pitch, yaw=yaw))
        cam = cast(carla.Sensor, world.spawn_actor(cam_bp, cam_tf))
        actors.append(cam)
        images = queue.Queue()
        cam.listen(images.put)

        collisions = []
        col = cast(carla.Sensor, world.spawn_actor(bp.find("sensor.other.collision"), carla.Transform(), attach_to=car_a))
        actors.append(col)
        col.listen(lambda e: collisions.append(e.frame))

        # Light controlling A's approach: the one whose stop waypoints share A's road.
        light_a = min(lights, key=lambda L: min(
            (w.transform.location.distance(e1.transform.location) for w in L.get_stop_waypoints()),
            default=1e9))
        world.freeze_all_traffic_lights(True)
        for L in lights:
            L.set_state(carla.TrafficLightState.Red)
        light_a.set_state(carla.TrafficLightState.Green)

        for _ in range(10):  # let the vehicles settle on the road
            world.tick()
            images.get()
        car_a.enable_constant_velocity(carla.Vector3D(v1, 0, 0))  # local frame: forward
        car_b.enable_constant_velocity(carla.Vector3D(v2, 0, 0))

        frames, t0, impact_frame, released = [], None, None, False
        n_frames = int((args.lead + 3.0) * FPS)
        for k in range(n_frames):
            world.tick()
            snap = world.get_snapshot()
            img = images.get()
            t = snap.timestamp.elapsed_seconds
            t0 = t if t0 is None else t0
            ts = t - t0
            # Signal for A: green until lead-3 s, amber for 1 s, then red.
            if abs(ts - (args.lead - 3.0)) < 0.5 / FPS:
                light_a.set_state(carla.TrafficLightState.Yellow)
            if abs(ts - (args.lead - 2.0)) < 0.5 / FPS:
                light_a.set_state(carla.TrafficLightState.Red)
            if collisions and not released:
                impact_frame = k
                car_a.disable_constant_velocity()
                car_b.disable_constant_velocity()
                released = True
            img.save_to_disk(str(out / "frames" / f"{k:06d}.png"))
            row = {"i": k, "t": round(ts, 5), "sim_frame": snap.frame, "light_A": str(light_a.get_state())}
            for name, v in (("A", car_a), ("B", car_b)):
                tf, vel = v.get_transform(), v.get_velocity()
                row[name] = {"x": tf.location.x, "y": tf.location.y, "z": tf.location.z, "yaw": tf.rotation.yaw,
                             "speed_kmh": 3.6 * math.hypot(vel.x, vel.y)}
            frames.append(row)

        # The collision callback runs on another thread and can be seen a tick
        # late: take the impact frame from the collision event's own frame id.
        if collisions:
            impact_frame = next((r["i"] for r in frames if r["sim_frame"] >= collisions[0]), impact_frame)
        # Where A's signal head is, so the pipeline can pick that light's track.
        try:
            boxes = light_a.get_light_boxes()
            c = boxes[len(boxes) // 2].location
            light_xyz = [c.x, c.y, c.z]
        except (AttributeError, IndexError, RuntimeError):
            loc = light_a.get_location()
            light_xyz = [loc.x, loc.y, loc.z + 4.5]
        bbA, bbB = car_a.bounding_box.extent, car_b.bounding_box.extent
        light_changes = []
        for r in frames:
            st = {"Green": "green", "Yellow": "amber", "Red": "red"}.get(r["light_A"].split(".")[-1], r["light_A"])
            if not light_changes or light_changes[-1]["state"] != st:
                light_changes.append({"t": r["t"], "state": st})
        gt = {
            "fps": FPS,
            "t_impact": frames[impact_frame]["t"] if impact_frame is not None else None,
            "camera": {"x": cam_loc.x, "y": cam_loc.y, "z": cam_loc.z, "pitch": pitch, "yaw": yaw,
                       "fov_deg": args.fov, "width": W, "height": H},
            "vehicles": {"A": {"length": 2 * bbA.x, "width": 2 * bbA.y},
                         "B": {"length": 2 * bbB.x, "width": 2 * bbB.y}},
            "signal_changes": light_changes,
            "stop_line_A": [[w.transform.location.x, w.transform.location.y] for w in light_a.get_stop_waypoints()],
            "light_A_xyz": light_xyz,
            "frames": [{"i": r["i"], "t": r["t"], "A_speed_kmh": r["A"]["speed_kmh"],
                        "B_speed_kmh": r["B"]["speed_kmh"], "A": r["A"], "B": r["B"]} for r in frames],
            "note": "CARLA uses a left-handed frame (x forward, y right, z up); distances are unaffected.",
        }
        (out / "gt.json").write_text(json.dumps(gt, indent=1))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i",
                        str(out / "frames" / "%06d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                        "-crf", "18", str(out / "input_clean.mp4")], check=True)
        if impact_frame is None:
            print(f"Wrote {out}, but the cars did NOT collide: try another --seed")
        else:
            print(f"Wrote {out}; impact at frame {impact_frame} (t = {frames[impact_frame]['t']:.2f} s)")
        print(f"Check the view: open {out / 'frames' / '000000.png'}. If a building or tree blocks it, "
              "rerun with e.g. --cam-ahead 22, --cam-height 14 or --cam-side 4, or another --seed.")
    finally:
        for a in actors:
            try:
                a.destroy()
            except RuntimeError:
                pass
        settings.synchronous_mode = False
        world.apply_settings(settings)


if __name__ == "__main__":
    main()