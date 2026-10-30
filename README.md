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

## CARLA ground truth (`sim/`)

```bash
./CarlaUE4.sh -RenderOffScreen                       # GPU machine
python sim/junction_crash.py --out cases/carla_001 --v1 50 --v2 30
python sim/degrade.py cases/carla_001                 # drops, duplicates, compression, clock
python scripts/run_case.py cases/carla_001            # real SAM 3.1 + Muse models
python scripts/eval_case.py cases/carla_001
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
