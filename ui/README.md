# Sakshi UI

React, TypeScript, Tailwind, GSAP. Everything shown comes from `case.json` or the
exported validation results; if a value was not produced, the UI says so.

```bash
npm install
npm run dev              # http://localhost:5173
```

Every pre-rendered scenario works with no backend. To upload and run real cases,
start the API as well. Vite proxies `/cases` to port 8000 by default; set
`SAKSHI_API` if the backend is elsewhere:

```bash
uvicorn api.app:app                                     # from the repo root
SAKSHI_API=http://127.0.0.1:8765 npm run dev            # backend on another port
```

## Views

| View | Key | What it is |
| --- | --- | --- |
| Overview | 0 | The story, drawn live from the base scenario |
| Investigate | 1 | Footage, reconstruction, speed and statements on one timeline |
| Report | 2 | The printable report for the open case |
| Validation | 3 | Scores against CARLA ground truth, weak results included |
| Calibrate | 4 | Fit the road plane; pre-rendered scenarios are explore-only |
| System | 5 | Models, pipeline, engine and decisions |

Useful links: `?scenario=night`, `?view=report`, `?case=<backend id>`,
`?replay3d` (full-screen 3D, for recording) and `?tour` (start the walkthrough).

For a live demo: open a case, press **Walk through this case**, then **N** for each
step. **Pipeline run** replays the open case's recorded stages with no backend,
and says that it is a recording.

## Data

- `public/scenarios/`: written by `scripts/export_scenarios.py` from `cases/suite`.
- `public/scenarios/benchmark.json`: written by `scripts/export_benchmark.py` from
  the suite's `eval.json`, `gt.json` and `logs/model_usage.jsonl`. Re-run it after
  a new suite run:

```bash
python ui/scripts/export_benchmark.py     # from the repo root
```

The clock comparison on the Validation view quotes the table in the root README.
Update `ABLATION` in `src/components/AccuracyView.tsx` if that table changes.

## Design system

- **Type carries meaning.** Serif italic (`.said`) is what someone said. Mono
  (`.measured`) is what was measured. Sans is the interface.
- **Colour.** Asphalt surfaces, bone text, one road-paint yellow accent. Red, amber
  and green are signal colours and always mean something.
- **Layout.** Panels share hairlines in one instrument grid (`.hairline-grid`).
- **Parts** live in `src/components/ui/`.

## Motion

GSAP goes through `src/lib/motion.ts`, which registers plugins and holds the
reduced-motion rule. Use `useGSAP` with a `scope`; wrap anything optional in
`withMotion`. `data-reveal` on an element fades it in on scroll via `useReveal`.

## Checks

```bash
npx tsc -b
npx vite --port 5173 &
node scripts/verify-ui.mjs /tmp/shots    # every view and interaction, with screenshots
```

`scripts/verify-live.mjs` covers live mode against a backend, or a stub that
exposes `/__state` and `/__fail`.
