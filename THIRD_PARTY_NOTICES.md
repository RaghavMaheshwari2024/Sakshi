# Third-party notices

- **meta-model-cookbook** (Meta Platforms, Inc., MIT licence): the SAM 3.1
  stream-normalisation helper in `sakshi/meta/sam.py` and the request shape in
  `sakshi/meta/voice.py` follow
  https://github.com/meta-models/meta-model-cookbook (07_sam/01_api_basics,
  06_muse_voice/01_voice_api_fundamentals).
- **meta-sam-parser** (Meta, SAM License): decodes SAM 3.1 output. Results using
  SAM Materials must acknowledge their use.
- **SAM 3.1** model access via Meta Model API, under Meta's terms.
- **Muse Glimmer** weights: Apache 2.0 (meta-models/Muse-Glimmer-30B).
- **CARLA** (MIT code, CC-BY assets): simulator renders in `sim/`. Credit CARLA
  in any video or slide that shows its footage.
- Python libraries: openai (Apache 2.0), numpy, scipy (BSD), opencv-python-headless
  (Apache 2.0), FastAPI (MIT), uvicorn (BSD), requests (Apache 2.0), pydantic (MIT),
  python-dotenv (BSD).

- Leaflet (BSD-2-Clause): map on the calibration screen. Map tiles are fetched at run time from Esri World Imagery and OpenStreetMap (© OpenStreetMap contributors); place search uses Nominatim. Each provider's attribution and usage terms apply.

- Transport for London JamCam footage (camera 06600): the replay clip in `ui/public/overview/`. Powered by TfL Open Data. TfL does not endorse Sakshi.
- Figures cited on the Overview: WHO, Global status report on road safety 2023; MoRTH, Road Accidents in India 2023.
- Interface libraries: React, React Three Fiber, Drei, Three.js, d3-scale, Tailwind CSS, Lucide, Zustand and Vite (each under its own open-source licence, see `ui/package.json`); GSAP under its own standard licence; IBM Plex fonts via Fontsource (SIL Open Font License).
- FFmpeg: decodes and probes video in the backend and the Docker image, under its own licence.
- Tonghua, Jilin CCTV clip of a rear-end collision, 11 March 2025, used in the demo video and not stored in this repo: https://commons.wikimedia.org/wiki/File:Jilin_Tonghua_car_rear-end_collision_accident,_2025-03-11.webm. Wikimedia Commons marks it public domain as footage from an automated CCTV camera, a basis that page notes is legally unclear in most jurisdictions. Source given there: Douyin.
