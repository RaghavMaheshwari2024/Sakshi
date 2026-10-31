"""CARLA scenarios at a signalised junction, filmed from a fixed CCTV-style
camera, with exact ground truth logged every frame.

Kinds (--kind): t_bone (A hits B's side), rear_end (A runs into B ahead in the
same lane), near_miss (B clears the junction --miss-gap s before A: there must
be NO impact). Variations: --b-vehicle motorcycle, --brake-decel/--brake-before
(A brakes before the hit), --weather (e.g. ClearNight, HardRainNoon),
--traffic N (other cars driving around).

Needs a running CARLA server (0.9.13+; tested API surface is stable from 0.9.11):
  ./CarlaUE4.sh -RenderOffScreen            # on the GPU machine or a Modal GPU box
  python sim/junction_crash.py --out cases/carla_001 --v1 50 --v2 30 --seed 1
  (options: --town Town10HD_Opt --cam-ahead 15 --cam-side 8 --cam-height 11 --fov 90)
Start CARLA on the map you render (switching maps can crash CARLA on laptops).

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


MOTORCYCLES = ["vehicle.vespa.zx125", "vehicle.yamaha.yzf", "vehicle.kawasaki.ninja",
               "vehicle.harley-davidson.low_rider"]


def pick_blueprint(bp_lib, kind: str):
    if kind == "car":
        return bp_lib.find("vehicle.audi.a2")
    for name in MOTORCYCLES:
        try:
            return bp_lib.find(name)
        except (IndexError, RuntimeError):
            continue
    two = [b for b in bp_lib.filter("vehicle.*")
           if b.has_attribute("number_of_wheels") and int(b.get_attribute("number_of_wheels")) == 2]
    if not two:
        raise RuntimeError("No motorcycle blueprint in this CARLA build.")
    return two[0]


def set_colour(blueprint, rgb: str) -> bool:
    if blueprint.has_attribute("color"):
        blueprint.set_attribute("color", rgb)
        return True
    return False


def spawn_traffic(client, world, bp_lib, cp, n: int, rng, port: int = 8000):
    """n other cars on autopilot, spawned 40-150 m from the junction."""
    if n <= 0:
        return [], None
    tm = client.get_trafficmanager(port)
    tm.set_synchronous_mode(True)
    tm.set_random_device_seed(rng.randint(0, 9999))
    points = [sp for sp in world.get_map().get_spawn_points() if 40 < sp.location.distance(cp) < 150]
    rng.shuffle(points)
    cars = [b for b in bp_lib.filter("vehicle.*")
            if b.has_attribute("number_of_wheels") and int(b.get_attribute("number_of_wheels")) == 4]
    spawned = []
    for sp in points:
        if len(spawned) >= n:
            break
        v = world.try_spawn_actor(rng.choice(cars), sp)
        if v is not None:
            v.set_autopilot(True, port)
            spawned.append(v)
    return spawned, tm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--town", default="Town10HD_Opt", help="CARLA's default map: no map switch needed")
    ap.add_argument("--kind", default="t_bone", choices=["t_bone", "rear_end", "near_miss"])
    ap.add_argument("--v1", type=float, default=50.0, help="vehicle A (white car) speed, km/h")
    ap.add_argument("--v2", type=float, default=30.0, help="vehicle B speed, km/h")
    ap.add_argument("--b-vehicle", default="car", choices=["car", "motorcycle"])
    ap.add_argument("--brake-decel", type=float, default=0.0, help="A brakes at this rate, m/s^2 (0 = no braking)")
    ap.add_argument("--brake-before", type=float, default=0.0, help="A starts braking this many s before impact")
    ap.add_argument("--miss-gap", type=float, default=1.0, help="near_miss: B passes this many s before A")
    ap.add_argument("--weather", default="ClearNoon", help="a carla.WeatherParameters preset, e.g. ClearNight")
    ap.add_argument("--traffic", type=int, default=0, help="other cars driving around")
    ap.add_argument("--lead", type=float, default=5.0, help="seconds from start to impact")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--host", default="localhost")
    # Default view: like a CCTV camera facing oncoming traffic, placed beyond the
    # junction on the side away from B's approach. It sees both cars for their
    # whole approach (a camera behind A's road sees A for only ~1 s).
    ap.add_argument("--cam-ahead", type=float, default=15.0, help="camera distance beyond the junction along A's road, m")
    ap.add_argument("--cam-side", type=float, default=8.0, help="camera offset away from B's side of the road, m")
    ap.add_argument("--cam-height", type=float, default=11.0, help="camera height above the road, m")
    ap.add_argument("--fov", type=float, default=90.0, help="horizontal field of view, degrees (CCTV is often 90+)")
    args = ap.parse_args()
    rng = random.Random(args.seed)
    out = Path(args.out)
    (out / "frames").mkdir(parents=True, exist_ok=True)
    for old in (out / "frames").glob("*.png"):  # a rerun must not mix in old frames
        old.unlink()

    a_brake = max(0.0, args.brake_decel) if args.brake_before > 0 else 0.0
    tb = args.brake_before if a_brake else 0.0
    if args.v1 / 3.6 - a_brake * tb <= 0.5:
        raise SystemExit("A would stop before the impact: lower --brake-decel or --brake-before.")

    client = carla.Client(args.host, 2000)
    client.set_timeout(180.0)  # loading a map can take minutes on a laptop GPU
    world = client.get_world()
    if not world.get_map().name.endswith(args.town):
        print(f"Loading {args.town} (can take a minute or two)...")
        world = client.load_world(args.town)
    try:
        world.set_weather(getattr(carla.WeatherParameters, args.weather))
    except AttributeError:
        raise SystemExit(f"Unknown weather preset {args.weather!r}; try ClearNoon, HardRainNoon, ClearNight.")
    night = "Night" in args.weather
    settings = world.get_settings()
    settings.synchronous_mode = True
    settings.fixed_delta_seconds = 1.0 / FPS
    world.apply_settings(settings)
    bp = world.get_blueprint_library()
    actors, tm = [], None
    try:
        junction, e1, e2, lights = pick_junction(world, rng)
        cp = conflict_point(e1, e2)
        v1, v2 = args.v1 / 3.6, args.v2 / 3.6
        # Distance A's centre covers before the planned impact (with braking).
        dA = v1 * args.lead - 0.5 * a_brake * tb * tb
        dB = v2 * args.lead
        dist_e1 = e1.transform.location.distance(cp)
        dist_e2 = e2.transform.location.distance(cp)
        if args.kind == "rear_end":
            # Both in A's lane; A's front meets B's rear about 3 m before the
            # conflict point, in view of the camera.
            s1 = back_off(e1, max(dA + 5.4 - dist_e1, 1.0))
            s2 = back_off(e1, max(dB + 1.1 - dist_e1, 1.0))
            if v1 - a_brake * tb <= v2:
                raise SystemExit("rear_end needs A faster than B at the impact.")
        else:
            # A aims its front at B's centre: A's centre is ~2.2 m short at impact.
            s1 = back_off(e1, max(dA + 2.2 - dist_e1, 1.0))
            gap = args.miss_gap if args.kind == "near_miss" else 0.0
            s2 = back_off(e2, max(v2 * (args.lead - gap) - dist_e2, 1.0))
        tA, tB = s1.transform, s2.transform
        tA.location.z += 0.3
        tB.location.z += 0.3
        # Fixed colours, so statements can say "the white car" / "the blue car"
        # and Muse Wonder has to match them to tracks from the pictures.
        bp_a, bp_b = bp.find("vehicle.tesla.model3"), pick_blueprint(bp, args.b_vehicle)
        set_colour(bp_a, "245,245,245")
        b_coloured = set_colour(bp_b, "20,60,200")
        car_a = cast(carla.Vehicle, world.spawn_actor(bp_a, tA))
        car_b = cast(carla.Vehicle, world.spawn_actor(bp_b, tB))
        actors += [car_a, car_b]
        if night:
            lights_on = carla.VehicleLightState(carla.VehicleLightState.LowBeam | carla.VehicleLightState.Position)
            car_a.set_light_state(lights_on)
            car_b.set_light_state(lights_on)

        # Fixed CCTV-style camera beyond the junction, facing A's oncoming traffic,
        # on the side of A's road away from where B comes from; it looks at the junction.
        fwd = e1.transform.get_forward_vector()
        right = e1.transform.get_right_vector()
        side_ref = e2.transform.location if args.kind == "rear_end" else tB.location
        b_side = (side_ref.x - cp.x) * right.x + (side_ref.y - cp.y) * right.y
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

        collisions = []  # (sim frame, other actor id), for A
        col = cast(carla.Sensor, world.spawn_actor(bp.find("sensor.other.collision"), carla.Transform(), attach_to=car_a))
        actors.append(col)
        col.listen(lambda e: collisions.append((e.frame, cast(carla.CollisionEvent, e).other_actor.id)))

        # Light controlling A's approach: the one whose stop waypoints share A's road.
        light_a = min(lights, key=lambda L: min(
            (w.transform.location.distance(e1.transform.location) for w in L.get_stop_waypoints()),
            default=1e9))
        world.freeze_all_traffic_lights(True)
        for L in lights:
            L.set_state(carla.TrafficLightState.Red)
        light_a.set_state(carla.TrafficLightState.Green)

        traffic, tm = spawn_traffic(client, world, bp, cp, args.traffic, rng)
        actors += traffic

        for _ in range(10):  # let the vehicles settle on the road
            world.tick()
            images.get()
        car_a.enable_constant_velocity(carla.Vector3D(v1, 0, 0))  # local frame: forward
        car_b.enable_constant_velocity(carla.Vector3D(v2, 0, 0))

        frames, t0, released = [], None, False
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
            if not collisions and not released and a_brake and ts >= args.lead - tb:
                # A brakes: lower its held speed a little every tick.
                car_a.enable_constant_velocity(carla.Vector3D(max(v1 - a_brake * (ts - (args.lead - tb)), 0.0), 0, 0))
            if collisions and not released:
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
        impact_frame, hit_other = None, None
        if collisions:
            first_frame, hit_other = collisions[0]
            impact_frame = next((r["i"] for r in frames if r["sim_frame"] >= first_frame), None)
        hit_b = hit_other == car_b.id
        if args.kind == "near_miss":
            valid = not hit_b
        else:
            valid = hit_b
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
        b_word = "car" if args.b_vehicle == "car" else "scooter"
        gt = {
            "fps": FPS,
            "scenario": {k_: v_ for k_, v_ in vars(args).items() if k_ not in ("out", "host")},
            "kind": args.kind,
            "valid": valid,
            "t_impact": frames[impact_frame]["t"] if (impact_frame is not None and hit_b) else None,
            "collided_with": None if hit_other is None else ("B" if hit_b else "other"),
            "camera": {"x": cam_loc.x, "y": cam_loc.y, "z": cam_loc.z, "pitch": pitch, "yaw": yaw,
                       "fov_deg": args.fov, "width": W, "height": H},
            "vehicles": {"A": {"length": 2 * bbA.x, "width": 2 * bbA.y, "colour": "white", "type": "car",
                               "model": "Tesla Model 3"},
                         "B": {"length": 2 * bbB.x, "width": 2 * bbB.y, "colour": "blue" if b_coloured else None,
                               "type": args.b_vehicle, "word": b_word, "model": bp_b.id}},
            "v1_kmh": args.v1, "v2_kmh": args.v2,
            "a_braking": {"decel_ms2": a_brake, "starts_before_impact_s": tb} if a_brake else None,
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
        if args.kind == "near_miss":
            print(f"Wrote {out}; near miss " + ("as planned (no collision with B)" if valid else
                                                "FAILED: the cars collided, increase --miss-gap"))
        elif impact_frame is None:
            print(f"Wrote {out}, but the cars did NOT collide: try another --seed")
        elif not hit_b:
            print(f"Wrote {out}, but A hit something other than B: try another --seed or less --traffic")
        else:
            print(f"Wrote {out}; impact at frame {impact_frame} (t = {frames[impact_frame]['t']:.2f} s)")
        print(f"Check the view: open {out / 'frames' / '000000.png'}. If a building or tree blocks it, "
              "rerun with e.g. --cam-ahead 22, --cam-height 14 or --cam-side 4, or another --seed.")
        if not valid:
            raise SystemExit(2)
    finally:
        for a in actors:
            try:
                a.destroy()
            except RuntimeError:
                pass
        if tm is not None:
            tm.set_synchronous_mode(False)
        settings.synchronous_mode = False
        world.apply_settings(settings)


if __name__ == "__main__":
    main()
