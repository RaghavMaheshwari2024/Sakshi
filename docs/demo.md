# Demo guide

## The pitch (30 seconds)

> People remember. Physics measures. Sakshi takes ordinary road footage and what each driver said,
> and checks one against the other. Meta's models read the scene: SAM 3.1 tracks every road user,
> Muse Spark reads clocks and signals, Muse Voice transcribes statements, and Muse Wonder turns
> them into checkable claims. The models never produce the numbers. Every speed comes from geometry
> and a physics engine, with a 90% range, and every number in the report can be traced back to the footage.
> It supports expert review and never says who is at fault.

## If someone asks

**"Isn't this just a Kalman filter on bounding boxes?"**
The filter is why you can trust the numbers. Models are good at reading a scene and unreliable at
arithmetic, so each does the job it is good at: neural perception, then a deterministic measurement layer.

**"Is this a pre-recorded mock?"**
The 16 benchmark cases are stored results, labelled "Recorded benchmark", because they need simulator
ground truth to score. New cases run the real pipeline and are labelled from what actually happened:
"Live run" with the number of live calls. Upload a clip and watch the model outputs arrive.

**"How accurate is it?"**
Show the Validation screen, including what falls short. On the CARLA suite, the 90% ranges run narrow:
they contain the true speed less often than 90% of the time.

**"Could the LLM invent a number?"**
A check rejects any number in the summary that did not come from the engine. It proves where a number
came from, not that the conclusion is right; the engine's event rules carry that.

**"What about real footage?"**
Show the TfL clip. Early runs reported false collisions between distant cars; the engine now refuses to
judge contact where the image cannot show it. It has been tested on simulation and a small number of
real clips, without true speeds for the real ones.

## Claims to avoid

- "Formally verified" or "bound by conservation laws": speeds come from geometry and filtering, and the momentum check is a secondary test.
- "Zero hallucination": the number check covers where numbers came from, not whether conclusions are right.
- Real-world accuracy figures: the scored results are from simulation.
- "Instant" live results: a real run takes minutes.

## Running order (about 3 minutes)

1. **Overview** (20 s): the problem and the one-line idea.
2. **A recorded benchmark** (45 s): "Side impact". Point out the "Recorded benchmark" label, click "Show me" on the false statement, then show its 90% range.
3. **A live case** (60 s): start a run on your prepared clip before presenting, and open its pipeline view to show the model outputs. Finish on the finished "Live run" report.
4. **Calibration** (20 s): the satellite map and road markings, answering "who has a tape measure?"
5. **Validation** (20 s): true speeds, weak results included.

## Before presenting

- [ ] Check the hackathon's rules, including anything on declaring tools.
- [ ] Run a clip end to end on the demo machine or server the same day.
- [ ] Check the API key, and the access code if hosted.
- [ ] Record the backup below.
- [ ] Have a finished "Live run" case open in a second tab.

## Backup recording

Record one complete real run from upload to report, cutting waiting time and saying that you did.
Use it if the network or API fails, and say it is a recording.
