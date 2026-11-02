# Architecture

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
