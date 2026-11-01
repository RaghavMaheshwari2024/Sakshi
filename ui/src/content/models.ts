/** What each Meta model does in Sakshi, as implemented in sakshi/meta and documented in the README. */
export interface ModelEntry {
  /** Prefix of the id in case.models and logs/model_usage.jsonl. */
  id: string;
  name: string;
  file: string;
  role: string;
  job: string;
  enables: string;
}

export const MODELS: ModelEntry[] = [
  {
    id: 'sam-3.1',
    name: 'SAM 3.1',
    file: 'sakshi/meta/sam.py',
    role: 'Sees',
    job: 'Tracks every car, motorcycle, person and traffic light with persistent ids and pixel masks. One request per concept, streamed and decoded with Meta’s meta-sam-parser.',
    enables: 'The mask’s lowest band gives the tyre-road contact point: the single pixel that becomes a position in metres.',
  },
  {
    id: 'muse-spark',
    name: 'Muse Spark',
    file: 'sakshi/meta/spark.py',
    role: 'Reads',
    job: 'Reads the burned-in CCTV clock at the frames where it changes, and reads a traffic light when the colour rule is unsure. Structured JSON output.',
    enables: 'True frame times, which is what makes speed from cheap footage possible at all.',
  },
  {
    id: 'muse-wonder',
    name: 'Muse Wonder',
    file: 'sakshi/meta/wonder.py',
    role: 'Understands',
    job: 'Describes each road user from labelled keyframes, suggests who drove what, extracts checkable claims in Hindi or English, and writes the report.',
    enables: 'A messy spoken statement becomes a precise question the engine can answer. A validator rejects any number it did not get from the engine.',
  },
  {
    id: 'muse-voice',
    name: 'Muse Voice Transcribe',
    file: 'sakshi/meta/voice.py',
    role: 'Hears',
    job: 'Transcribes recorded statements through a one-shot endpoint with a Hindi and English bias.',
    enables: 'A voice note from a roadside goes straight into the claim check.',
  },
  {
    id: 'muse-glimmer',
    name: 'Muse Glimmer',
    file: 'sakshi/meta/client.py',
    role: 'Runs privately',
    job: 'Open weights. With SAKSHI_PRIVATE=1, claim extraction and report writing run on your own GPU through any OpenAI-compatible server.',
    enables: 'Statements that cannot leave the building do not have to.',
  },
];

export const ENGINE = [
  { file: 'homography.py', title: 'Road plane', body: 'Image to road plane from 4 or more clicked point pairs, with reprojection error.' },
  { file: 'clock.py', title: 'True time', body: 'Clock ticks fix how many sensor frames each second held; the vehicles’ own motion shows where frames were lost.' },
  { file: 'contact.py', title: 'Contact point', body: 'The tyre-road point from the mask, or from wheels, and which frames are occluded.' },
  { file: 'kalman.py', title: 'Smoothing', body: 'Constant-acceleration Kalman filter and RTS smoother on the ground plane.' },
  { file: 'uncertainty.py', title: 'Intervals', body: 'Monte Carlo, 200 draws by default, over clicks, ground distances, contact offset, mask jitter, frame times and smoother stiffness.' },
  { file: 'events.py', title: 'Events', body: 'Impact, braking onset, stop-line crossing, and a momentum check at the impact time.' },
  { file: 'signals.py', title: 'Signals', body: 'Lit-lamp colour per frame, debounced into a signal timeline.' },
  { file: 'claims.py', title: 'Verdicts', body: 'Each claim becomes consistent, inconsistent or can’t tell, with the measurement that decided it.' },
];

export const DECISIONS = [
  {
    title: 'Language models never produce a number',
    body: 'Every speed, distance and time comes from the engine. Models read, reason and explain around those numbers. A validator compares each figure in the report with the engine’s facts and rejects the text if one has no source.',
    where: 'wonder.py: unsupported_numbers',
  },
  {
    title: 'Fix time before measuring speed',
    body: 'Frame-drop recovery is the difference between speeds that are 13 to 22% wrong and 2% wrong on the synthetic case, so it runs before anything else depends on time.',
    where: 'engine/clock.py',
  },
  {
    title: 'Split the smoother at the impact',
    body: 'Colliding vehicles are smoothed separately before and after contact, so the violent stop cannot leak backward into the pre-impact speed.',
    where: 'pipeline.py',
  },
  {
    title: 'Say “can’t tell”',
    body: 'If there are several lights and no governing one, or the lamps are unreadable, the verdict is “can’t tell”. A wrong verdict is far costlier than an admitted gap.',
    where: 'engine/claims.py',
  },
  {
    title: 'A person confirms who drove what',
    body: 'Muse Wonder suggests the match from keyframes and geometry checks it, but an investigator can overrule it before any claim is attached to a vehicle.',
    where: 'pipeline.py: match_parties',
  },
  {
    title: 'Every call cached and logged',
    body: 'Runs are repeatable and resumable, and each model call lands in logs/model_usage.jsonl, which is where the usage figures on this page come from.',
    where: 'sakshi/cache.py, usage_log.py',
  },
];
