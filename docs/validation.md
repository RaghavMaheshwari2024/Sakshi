# Validation

How Sakshi was tested, what it scored, and what still falls short. The same results are on the app's Validation screen.

## Engine on a synthetic crash (synthetic case, 12% of frames dropped + a 5-frame burst)

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

These are synthetic numbers. The CARLA results below are the ones to quote.

## CARLA test suite, fixed camera (Oct 31)

16 scenarios, all with live SAM 3.1, Muse Spark and Muse Wonder (Town10HD_Opt,
960x540, CRF 32, 12% of frames dropped + 3% duplicated unless stated). Run it
with `python scripts/carla_suite.py --variants lowest`; scores are against
CARLA ground truth (`scripts/eval_case.py`). Each case has two drivers'
statements (one in Hinglish) with 3-5 checkable claims.

**No wrong verdict in 63 claims across 16 scenarios: 48 right and 15 answered
"can't tell". Impact found in all 15 crashes, and correctly NOT found in the near miss.**

| Scenario | What it tests | Impact error (s) | A speed err | A in 90% | B speed err | B in 90% | Claims not wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base | side impact 50 vs 30 km/h, clear day | -0.16 | 7.65% | 83.3% | 9.95% | 66.7% | 4/4 |
| slow | 25 vs 15 km/h | -0.36 | 10.49% | 81.0% | 11.76% | 66.7% | 4/4 |
| fast | 80 vs 40 km/h | -0.08 | 6.77% | 81.0% | 7.12% | 88.1% | 4/4 |
| braking | A brakes at 6 m/s^2 for 1.5 s (65 -> ~33 km/h) | -0.12 | 6.35% | 95.3% | 8.75% | 69.8% | 5/5 |
| rear_end | A 50 km/h into B 20 km/h, same lane | 0.00 | 8.08% | 76.2% | 8.78% | 88.1% | 3/3 |
| near_miss | B clears 1 s before A | no impact (correct) | 1.85% | 88.4% | 4.67% | 58.1% | 3/3 |
| motorcycle | car hits a scooter at 35 km/h | -0.08 | 8.31% | 73.8% | 13.35% | 54.5% | 4/4 |
| night | same crash at night | -0.12 | 8.79% | 69.0% | 9.62% | 88.1% | 4/4 |
| rain | heavy rain | -0.12 | 6.47% | 88.1% | 9.09% | 76.2% | 4/4 |
| traffic | 8 other cars driving around | -0.12 | 7.62% | 85.7% | 9.06% | 76.2% | 4/4 |
| junction2 | another junction | -0.12 | 8.93% | 64.3% | 11.65% | 61.9% | 4/4 |
| high_camera | camera 18 m up, 25 m beyond | -0.08 | 5.93% | 100.0% | 9.59% | 64.3% | 4/4 |
| low_res | 640x360, CRF 36 | -0.12 | 7.51% | 81.0% | 11.06% | 76.2% | 4/4 |
| heavy_drops | 25% of frames dropped | -0.12 | 6.15% | 97.5% | 7.17% | 82.5% | 4/4 |
| no_drops | no dropped/duplicated frames | -0.16 | 6.34% | 35.4% | 1.47% | 100.0% | 4/4 |
| no_clock | no burned-in clock | -0.12 | 12.2% | 71.4% | 14.81% | 57.1% | 4/4 |

Speed error is the mean absolute error over the last 2 s before the impact (or
closest approach); "in 90%" is how often the true speed lies inside our 90%
interval there. Impact error is the true time of the frame we call the impact
minus the true impact time. Median speed error: A 7.6%, B 9.3%.

Known limits (measured, not hidden):
- **Impact is called ~0.1 s early** (up to 0.36 s at 25 km/h): it is the first
  frame the two road users are within 4.5 m, and contact points are wheels or
  mask bottoms, not bumpers. No verdict depends on it.
- **Speeds read ~3-4% fast** for a car driving toward the camera: the lowest
  mask pixel is the bumper (~0.3 m up), not the tyre. Following the wheels
  (`contact_mode: wheels`) did not help at this resolution: SAM found 2 wheels
  in the whole base clip.
- **90% intervals are too narrow** for some vehicles (55-70% coverage instead of
  90%; 35% for A in no_drops). Claims are judged with a +-10% tolerance on top,
  which is why verdicts still hold.
- **No burned-in clock: 12-15% speed error.** Frame drops are then invisible;
  the intervals widen for them but not fully.
- **Signal claims are "can't tell" here**: at CARLA's Low quality the lamps are
  not lit. Signal reading needs a higher-quality render or real footage.

What the suite runs caught and fixed (each now has a regression test in
`tests/test_impact_refine.py`): Wonder matching both statements to one
vehicle, or none (now: close-ups of the two vehicles involved, a geometry check,
one retry); a dropped frame read as braking in both cars at once (braking now
needs a lasting speed drop); "braked hard" read as "no"; claims with the wrong
label or merged values (now repaired or re-asked once, else shown as "could not
read", never given a verdict); the car behind hidden by the car in front in a
rear-end.

## Held-out check: multi-car scenes (Oct 31)

After the 16 passed, two scenes the engine was never tuned on were designed:
`crowded` (an oncoming car passes A one lane over just before the crash, a
car waits at the light) and `chain` (A runs into B at a red light and pushes it
into C). What came out of it:

- **A false-impact bug, found and fixed in general.** Two cars passing in
  opposite directions get close, overlap in the image and close fast, so the
  old detector would call it a crash on any two-way road. An impact now also
  has to change the motion (a vehicle is pushed or slowed: either velocity, or
  the relative velocity, changes by 30% of the closing speed). Unit test
  `test_no_impact_for_oncoming_cars_passing_in_adjacent_lanes`; all 16
  scenarios unchanged.
- **Known limit: vehicles the camera cannot see.** Seen end-on 30-40 m away,
  three queued cars hid each other (one was hidden in all 181 frames): Sakshi
  reported no impact and "can't tell", not an invented result.
- **Product rule: the user confirms who drove which vehicle.** In that run a
  statement was matched to the wrong (indistinguishable, distant) car and got
  a verdict. Wonder's match is a suggestion; the UI shows it and asks.
- The CARLA set-up for these scenes is not finished (the planned crash did not
  render cleanly), so they are `EXPERIMENTAL` in `scripts/carla_suite.py` and
  not part of the scores above.

## Calibrating without a survey

Nobody handed a CCTV clip knows the road in metres, so the calibration screen offers three methods.
All of them feed the same engine; `sakshi/engine/calib_sources.py` turns each into ground points.

| Method | The user does | Uncertainty |
|---|---|---|
| Road markings | clicks 4 corners of a rectangle with an assumed size | the size varies as one value per Monte Carlo draw, because a wrong lane width rescales everything |
| Satellite map | clicks the same road marks on the frame and on a map | per point, from the map zoom, and from the fit residual with 5 or more points |
| I measured it | types ground coordinates | as before (results unchanged) |

Exactly 4 points always fit, so the report and the UI never present their 0 m error as a check.
`scripts/calibration_coverage.py` replays the CARLA suite's tracks through these methods against true
speeds and writes the table on the Validation screen. Small rectangles stay honest only through very
wide intervals; a long rectangle or satellite points are far more useful. These scores come from
projecting known road positions, not from people clicking real footage or real satellite imagery.
