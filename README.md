# Sakshi

Physics-checked crash reconstruction from any road video. Sakshi tracks every
road user with **SAM 3.1**, turns pixels into metres and seconds with a
deterministic geometry and physics engine, and checks each person's statement
against the measurements, with honest 90% intervals.

Sakshi reports measurements to support expert review. It never states who is at fault.

## example env
```bash
   MODEL_API_KEY=
   SAKSHI_SAM_MODEL=sam-3.1
   SAKSHI_SPARK_MODEL=muse-spark-1.3
   SAKSHI_WONDER_MODEL=muse-wonder-1.0
   SAKSHI_VOICE_MODEL=muse-voice-transcribe-1.0
   SAKSHI_SAM_CONCEPTS=car,motorcycle,person,traffic light
   SAKSHI_PRIVATE=0
   GLIMMER_BASE_URL=http://localhost:8001/v1
   GLIMMER_MODEL=meta-models/Muse-Glimmer-30B
```

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # add MODEL_API_KEY
python scripts/list_models.py   # confirm the model IDs your key can use
python scripts/check_sam.py my_clip.mp4 --concepts car   # SAM 3.1 gate: watch my_clip_tracks.mp4

# Engine end to end on a synthetic crash with exact ground truth (no API calls):
python scripts/make_synthetic_case.py
python scripts/run_case.py cases/synthetic --offline
python scripts/eval_case.py cases/synthetic
python scripts/ablate_clock.py cases/synthetic
pytest -q
```

`mock/case.json` (+ `mock/input.mp4`) is a complete output for building the UI
before the real pipeline runs.

## How each Meta model is used

Language models never produce a number. Every speed, distance and time comes
from the engine; the models read, reason and explain around those numbers.

| Model | File | Job |
| --- | --- | --- |
| SAM 3.1 (Meta Model API) | `sakshi/meta/sam.py` | Tracks every car, motorcycle, person and traffic light with persistent ids and pixel masks. One request per concept, streamed and decoded with Meta's `meta-sam-parser`. The mask's lowest band gives the tyre-road contact point. |
| Muse Spark | `sakshi/meta/spark.py` | Reads the burned-in CCTV clock at the frames where it changes (true frame times), and reads a traffic light when the colour rule is unsure. Structured JSON output. |
| Muse Wonder | `sakshi/meta/wonder.py` | Looks at keyframes with every track labelled and describes each road user; suggests which statement-giver drove which track; extracts checkable claims (Hindi or English); writes the report. A validator rejects any number not produced by the engine. |
| Muse Voice Transcribe | `sakshi/meta/voice.py` | Transcribes recorded statements (one-shot endpoint, Hindi/English bias). |
| Muse Glimmer (open weights) | `sakshi/meta/client.py` | Private mode (`SAKSHI_PRIVATE=1`): claim extraction and report writing run on our own GPU via any OpenAI-compatible server (`vllm serve meta-models/Muse-Glimmer-30B`). |
| Muse Code | — | Development only. |

Every call is cached (`cache/`) and logged (`logs/model_usage.jsonl`);
`python scripts/usage_report.py` prints the per-model table for the deck.

## The engine (`sakshi/engine/`)

1. `homography.py`: image to road plane from 4+ clicked point pairs, with reprojection error.
2. `clock.py`: true frame times. **Drop-aware**: clock ticks fix how many sensor
   frames each second held; the vehicles' own motion shows where frames were lost.
3. `kalman.py`: constant-acceleration Kalman filter + RTS smoother on the ground plane.
4. `uncertainty.py`: Monte Carlo over clicks, ground distances, contact offset,
   mask jitter, frame times (correlated, per clock method) and smoother stiffness → 90% intervals.
5. `events.py`: impact, braking onset, stop-line crossing, momentum check at the impact time.
6. `signals.py`: lit-lamp colour per frame, debounced into a signal timeline.
7. `claims.py`: each claim → consistent / inconsistent / can't tell, with the measurement.

## Current results (synthetic case, 12% of frames dropped + a 5-frame burst)

| Clock method | Speed error, last 2 s before impact | True speed inside 90% interval |
| --- | --- | --- |
| Nominal frame rate | 12.8–22.0% | 20–22% |
| Clock ticks only | 5.0–8.6% | 68–74% |
| **Drop-aware (ticks + motion)** | **1.6–2.1%** | **87–100%** |

Impact time within 0.08 s; signal changes exact; 3/3 claim verdicts correct;
momentum check consistent (residual 0.01). The colliding vehicles are smoothed
separately before and after contact, so post-impact deceleration does not leak
into the pre-impact speed.

Known limits:
- At 25% frame drops the error is about 6% and the intervals are too narrow (45–55% coverage).
- The road is treated as flat (one homography). Slopes and the gap between the
  lowest mask pixel and the true tyre line are carried as uncertainty, not corrected.
- With several traffic lights in view, the user must pick the one that governs
  the stop line (`calibration.signal_track`); otherwise signal claims are "can't tell".

These are synthetic numbers. The pitch must quote CARLA (`sim/`) and real-camera results.

### CARLA, first run (Town10HD_Opt, 50 vs 30 km/h side impact, 960x540, CRF 32, 23 of 200 frames dropped)

Real SAM 3.1 tracks from the live run; clock reads emulated from ground truth.

| | Car A (50 km/h, driving toward the camera) | Car B (30 km/h, crossing) |
| --- | --- | --- |
| Speed error, last 2 s | 5.7% | 6.9% |
| True speed inside 90% interval | 69% | 62% (84% over the whole approach) |

Impact 0.23 s early; both speed claims judged correctly; momentum check consistent.
What limits it (measured against ground truth):
- Car B's contact point is exact (30.0 km/h with true frame times): its error is
  frame timing, because cars this small hide single dropped frames from the
  motion test, so drops are placed at random within each clock second.
- Car A's lowest mask pixel slides along the car as it approaches (front tyres far
  away, bumper up close), reading 4-11% fast even with true times. Next step:
  correct the contact point with the camera geometry recovered from calibration.
- At CARLA's Low quality the signal lamps are not lit, so signal reading cannot be
  tested here: the claim is answered "can't tell".

## Simulating crashes with CARLA (`sim/`)

CARLA renders a crash with exact ground truth (positions, speeds, collision
time, signal states), so every accuracy number can be checked. Tested with
CARLA 0.9.16 on Ubuntu 24.04, RTX 3050 laptop (6 GB).

### One-time setup

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

### Every session: two terminals

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

### Options for `sim/junction_crash.py`

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

### The test suite (one command)

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

### Troubleshooting

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

## Backend (`api/app.py`)

`uvicorn api.app:app --reload`. Upload → frame for calibration → calibration →
confirm party map → `GET /cases/{id}/run` (server-sent events per stage) → `case.json`.

## case.json (what the UI reads)

`clip`, `clock` (method, per-frame times, inferred drops), `calibration`
(H, points, stop line), `tracks` (per frame: box, contact point, mask RLE local
to the box), `trajectories` (t, x, y, speed with lo90/hi90, acceleration),
`events` (impact), `facts` (speeds before/at impact, braking, momentum check,
signal changes), `signals`, `statements`, `party_to_track`, `scene`, `claims`,
`report` (with number-validator result), `disclaimer`.

## Data and licences

Only simulator output, our own recordings, and datasets whose terms allow this
use. See `THIRD_PARTY_NOTICES.md`.
