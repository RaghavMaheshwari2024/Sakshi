# Sakshi

Physics-checked crash reconstruction from ordinary road video. Sakshi tracks every road user with
**SAM 3.1**, turns pixels into metres and seconds with a deterministic physics engine, and checks what
each person said against those measurements, with a 90% range on every speed.

It reports measurements to support expert review and never states who is at fault.

<!-- Demo video: add the link here -->

## For judges: run it in one go

You need [Docker](https://docs.docker.com/get-docker/). No API key or account is needed for this path.

```bash
git clone https://github.com/RaghavMaheshwari2024/Sakshi.git && cd Sakshi && docker build -t sakshi . && docker run --rm -p 8000:8000 sakshi
```

Open **http://localhost:8000**. The first build takes a few minutes. If port 8000 is taken, use `-p 8080:8000` and open port 8080.

### What to check without a key

The 16 cases in the case switcher are clearly labelled **Recorded benchmark**: stored results from the
real pipeline, shown so every feature can be checked with no credentials.

| Screen | What to try |
| --- | --- |
| Overview | The live London replay, the method, and the evidence |
| Investigate | Scrub a crash, then press **Show me** on a statement to jump to the moment it was judged |
| Report | The written report for the open case |
| Validation | Scores for every scenario, including what falls short |
| System | The models and the pipeline |

### Run the live pipeline with your own key

```bash
cp .env.example .env              # then set MODEL_API_KEY to your Meta Model API key
docker run --rm -p 8000:8000 --env-file .env sakshi
```

Choose **New case** and upload a clip. `ui/public/overview/replay.mp4` in this repo is a real London
camera clip you can use. Then calibrate the road, add statements if you like, and run. Each run makes live model calls on your key.

### Run it without Docker

Needs Python 3.12, Node 22 and ffmpeg.

```bash
python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp .env.example .env              # optional: set MODEL_API_KEY for live runs
(cd ui && npm ci && npm run build)
uvicorn api.app:app --port 8000
```

### Check the engine without a key

From the same virtual environment, these run the engine on a synthetic crash with exact ground truth and run the tests:

```bash
python scripts/make_synthetic_case.py
python scripts/run_case.py cases/synthetic --offline
python scripts/eval_case.py cases/synthetic
pytest -q
```

## How Meta's models are used

The models read the scene. They never produce a number: every speed, distance and time comes from the engine.

| Model | Job |
| --- | --- |
| SAM 3.1 | Tracks every car, motorcycle, person and traffic light with pixel masks. The mask's lowest band gives the point where tyre meets road. |
| Muse Spark | Reads the burned-in CCTV clock to recover true frame times, and reads a traffic light when the colour rule is unsure. |
| Muse Wonder | Describes each road user, suggests who drove what, extracts checkable claims in Hindi or English, and writes the report. A validator rejects any number the engine did not produce. |
| Muse Voice Transcribe | Transcribes recorded statements. |
| Muse Glimmer | Optional private mode (`SAKSHI_PRIVATE=1`): claims and report run on your own GPU. |
| Muse Code | Used in development only. |

## Results

Tested on 16 crashes rendered in CARLA and degraded to cheap CCTV, with exact ground truth the pipeline never sees:

- **0 wrong verdicts in 63 claims:** 48 right, and 15 answered "can't tell".
- **15 of 15 impacts found**, a median 0.12 s off. The near miss was correctly called no impact.
- **8.5% median speed error** before impact.

What still falls short:

- The 90% ranges run narrow: they contain the true speed about 76% of the time.
- These scores come from simulation. Real footage has been tested on only a few clips, without true speeds.
- With no burned-in clock, speed error rises to 12–15%.

## More detail

- [Validation](docs/validation.md): every scenario, known limits, and calibration methods
- [Architecture](docs/architecture.md): the engine, the API, and `case.json`
- [CARLA](docs/carla.md): rendering and scoring the test suite yourself
- [Hosting](#hosting): running a public copy

## Hosting

Every live run spends the key in `MODEL_API_KEY`, so set `SAKSHI_ACCESS_CODE` on any public server. It also
keeps uploaded footage private. `SAKSHI_MAX_UPLOAD_MB`, `SAKSHI_MAX_CLIP_SECONDS` and `SAKSHI_MAX_RUNS` limit use.
To keep cases between restarts, add `-v sakshi-data:/app/cases -v sakshi-cache:/app/cache` to `docker run`.

## External sources and tools

| What | Used for | Where |
| --- | --- | --- |
| **Transport for London JamCam** (Powered by TfL Open Data; TfL does not endorse Sakshi) | The real London traffic clip, camera 06600 at Cromwell Rd / Earls Court Rd | Overview replay, `ui/public/overview/` |
| **CARLA simulator** | Rendered test crashes with exact ground truth | 16 recorded cases, Validation, `sim/`, `ui/public/scenarios/` |
| **Meta Model API** (SAM 3.1, Muse Spark, Muse Wonder, Muse Voice Transcribe) | Tracking, reading clocks and signals, claims, reports, transcription | `sakshi/meta/` |
| **Muse Glimmer** open weights | Optional private mode | `sakshi/meta/client.py` |
| **meta-sam-parser**, **meta-model-cookbook** | Decoding SAM output; request and stream-handling patterns | `sakshi/meta/sam.py`, `sakshi/meta/voice.py` |
| **Leaflet** | The map on the satellite calibration screen | `ui/src/components/SatelliteMap.tsx` |
| **Esri World Imagery** (© Esri, Maxar, Earthstar Geographics) | Satellite map tiles, fetched at run time | Calibrate screen |
| **OpenStreetMap** (© OpenStreetMap contributors) and **Nominatim** | Street map tiles and place search, fetched at run time | Calibrate screen |
| **WHO**, *Global status report on road safety 2023* | Worldwide road deaths figure | Overview |
| **MoRTH**, *Road Accidents in India 2023* | India road accident figures | Overview |
| **FFmpeg**, **OpenCV**, **NumPy**, **SciPy**, **FastAPI** | Video handling, vision helpers, numerics, API | Backend |
| **React**, **Three.js** with React Three Fiber and Drei, **GSAP**, **d3-scale**, **Tailwind CSS**, **Lucide**, **Zustand**, **Vite** | Interface, 3D replay, animation, charts, icons, state, build | `ui/` |
| **IBM Plex** fonts | Interface type | `ui/` |

Any other footage comes from our own recordings. Licence details are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
