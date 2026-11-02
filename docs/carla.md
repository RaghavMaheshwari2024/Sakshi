# Simulating crashes with CARLA (`sim/`)

CARLA renders a crash with exact ground truth (positions, speeds, collision
time, signal states), so every accuracy number can be checked. Tested with
CARLA 0.9.16 on Ubuntu 24.04, RTX 3050 laptop (6 GB).

## One-time setup

1. Download the CARLA 0.9.16 Linux package from
   https://carla.readthedocs.io/en/latest/download/ (about 20 GB) and extract it:

```bash
mkdir -p ~/carla && tar -xzf ~/Downloads/CARLA_0.9.16.tar.gz -C ~/carla
```

2. Install the matching Python client in the project venv (the versions must match):

```bash
cd <repo> && source .venv/bin/activate
pip install carla==0.9.16
```

## Every session: two terminals

**Terminal 1: the CARLA server** (leave it running; it goes quiet once ready).
Start it on the map you will render: switching maps from a script can crash
CARLA on laptops.

```bash
cd ~/carla                      # the folder that contains CarlaUE4.sh
./CarlaUE4.sh -RenderOffScreen -quality-level=Low -prefernvidia -nosound
```

**Terminal 2: the repo.** Run one command at a time and check each result.

```bash
cd <repo> && source .venv/bin/activate

# 0. Server reachable? Prints the loaded map (Town10HD_Opt by default)
python -c "import carla; c=carla.Client('localhost',2000); c.set_timeout(30); print(c.get_world().get_map().name)"

# 1. Render the crash. Ends with "impact at frame N (t = ... s)" = ground truth
python sim/junction_crash.py --out cases/carla_002 --seed 1

# 2. Make it look like cheap CCTV: frame drops/duplicates, 960x540, CRF 32, burned-in clock
python sim/degrade.py cases/carla_002

# 3. Full pipeline with SAM 3.1, Muse Spark, Muse Wonder (live API calls, cached)
python scripts/run_case.py cases/carla_002

# 4. Score against ground truth: speed error, interval coverage, impact time, claim verdicts
python scripts/eval_case.py cases/carla_002

# 5. See the detected impact frame -> cases/carla_002/impact.png
python scripts/show_impact.py cases/carla_002
```

Check the camera view after step 1: open `cases/carla_002/frames/000000.png`.

## Options for `sim/junction_crash.py`

| Option | Default | Meaning |
| --- | --- | --- |
| `--out` | (required) | case folder, e.g. `cases/carla_003` |
| `--seed` | 1 | which junction and approach pair; change it for a new scene |
| `--v1`, `--v2` | 50, 30 | speeds of car A (white) and car B (blue), km/h |
| `--lead` | 5 | seconds from start to impact |
| `--town` | Town10HD_Opt | must be the map the server is running |
| `--cam-ahead` | 15 | camera distance beyond the junction along A's road, m |
| `--cam-side` | 8 | camera offset away from B's side, m |
| `--cam-height` | 11 | camera height, m |
| `--fov` | 90 | horizontal field of view, degrees |
| `--kind` | t_bone | `t_bone`, `rear_end` (A into B ahead, same lane), `near_miss` (no impact expected) |
| `--b-vehicle` | car | `car` or `motorcycle` (a scooter where the build has one) |
| `--brake-decel`, `--brake-before` | 0, 0 | A brakes at this m/s^2, starting this many s before impact |
| `--miss-gap` | 1.0 | near_miss: B passes this many s before A |
| `--weather` | ClearNoon | any `carla.WeatherParameters` preset: `ClearNight`, `HardRainNoon`, ... |
| `--traffic` | 0 | other cars on autopilot around the junction |

`sim/degrade.py` options: `--drop 0.12` (fraction of frames dropped), `--dup 0.03`,
`--crf 32`, `--scale 0.75`, `--click-noise-px 2`, `--seed 0`, `--no-clock` (no burned-in
clock), `--claim-a 30` (speed the white car's driver claims). It writes the
drivers' statements to suit the scenario, and the verdict a correct checker
should give for each claim into `gt.json` only (the pipeline never sees it).

## The test suite (one command)

`scripts/carla_suite.py` renders 12 scenarios plus 4 footage variants, runs
the full pipeline on each twice (contact point from the lowest mask pixel, and
from the wheels), scores everything against ground truth, and writes
`cases/suite/summary.md`. It resumes where it stopped, so a CARLA crash costs
only the scenario in progress.

```bash
python scripts/carla_suite.py --list              # what each scenario tests
python scripts/carla_suite.py                     # everything (about 1.5-2 hours)
python scripts/carla_suite.py --only base,near_miss --variants lowest   # a quick subset
```

Several scenarios for the accuracy table:

```bash
for s in 1 2 3; do
  python sim/junction_crash.py --out cases/carla_s$s --seed $s --v1 50 --v2 30 && \
  python sim/degrade.py cases/carla_s$s && \
  python scripts/run_case.py cases/carla_s$s && \
  python scripts/eval_case.py cases/carla_s$s > cases/carla_s$s/eval.json
done
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Segmentation fault` / `Signal 11` when a script loads a map | Start the server on that map instead, and pass the same `--town` |
| `GameThread timed out waiting for RenderThread` at startup | An old CARLA still holds the GPU: `pkill -9 -f CarlaUE4-Linux-Shipping`, check `nvidia-smi`, plug in the charger; reboot if it persists |
| `time-out ... waiting for the simulator` | The server crashed or is not started: check terminal 1 |
| A building, tree or pole blocks the view | `--cam-ahead 22`, `--cam-height 14`, `--cam-side 4`, or another `--seed` |
| `did NOT collide` | Another `--seed` |
| `Fewer than 4 road points are in view` (degrade) | Move the camera (options above) and render again |
| Signal claims always "can't tell" | Expected at `-quality-level=Low`: CARLA does not light the lamps |
| GPU memory full (`nvidia-smi` near 6 GB) | Close Chrome; keep `-quality-level=Low` |

Stop the server with Ctrl+C in terminal 1 (or `pkill -f CarlaUE4`).

To share a case for debugging (without the 200 PNG frames):

```bash
cd cases/carla_002 && zip ../carla_002_debug.zip input.mp4 case.json case_input.json gt.json gt_clean.json
```
