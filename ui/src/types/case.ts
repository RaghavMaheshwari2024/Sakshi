export interface ClipInfo {
  file: string;
  frames: number;
  fps_nominal: number;
  width: number;
  height: number;
}

export interface ClockFrame {
  i: number;
  t: number;
  dup: boolean;
}

export interface ClockInfo {
  method: string;
  frames: ClockFrame[];
  median_sigma_s: number;
  dropped_frames_inferred?: number;
  gaps?: number[];
}

export interface CalibrationInfo {
  H: number[][];
  image_pts: [number, number][];
  ground_pts_m: [number, number][];
  reproj_rms_m: number;
  reproj_max_m: number;
  /** Where the ground coordinates came from. Absent on older cases: typed points. */
  method?: "manual" | "preset" | "satellite";
  ground_model?: {
    kind: "rect" | "points";
    width_m?: number;
    length_m?: number;
    sigma_width_m?: number;
    sigma_length_m?: number;
    sigma_m?: number;
  } | null;
  source?: { preset_id?: string; label?: string; geo_pts?: [number, number][]; map_zoom?: number | null };
  warnings?: string[];
  stop_line_m: [number, number][] | null;
  /** Camera pose recovered from the calibration (for the 3D replay). */
  camera?: {
    focal_px: number;
    fov_h_deg: number;
    position_m: [number, number, number];
    look_at_m: [number, number] | null;
    pitch_down_deg: number;
    up_sign: number;
  } | null;
}

export interface TrackFrame {
  i: number;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  conf?: number;
  area_px?: number;
  contact_px: [number, number] | null;
  rle?: {
    size: [number, number]; // [h, w]
    counts: string | number[];
  };
}

export interface Track {
  id: string;
  concept: string;
  frames: TrackFrame[];
}

export interface Trajectory {
  track: string;
  i: number[];
  t: number[];
  x: number[];
  y: number[];
  speed_kmh: number[];
  lo90_kmh: number[];
  hi90_kmh: number[];
  long_acc_ms2: (number | null)[];
  observed: boolean[];
}

export interface ModelCredit {
  model: string;
  role: string;
  did: string;
}

export interface ImpactEvent {
  confirmed?: boolean;
  type: "impact";
  tracks: [string, string];
  i: number;
  t: number;
  t_sigma: number;
  ground_gap_m: number;
  xy: [number, number];
}

export interface SignalChange {
  t: number;
  state: "red" | "amber" | "green" | "off" | "unclear";
}

export interface Statement {
  id: string;
  speaker: string;
  text: string;
  transcribed?: boolean;
}

export interface Claim {
  statement_id: string;
  quote: string;
  subject_track: string;
  quantity: "speed_kmh" | "signal_state_at_stop_line" | "braked_before_impact" | "stopped_before_impact" | "other";
  value_number: number | null;
  value_text: string | null;
  when: "at_impact" | "just_before_impact" | "at_stop_line" | "unspecified";
  verdict: "consistent" | "inconsistent" | "cant_tell";
  measured: any;
  reason: string;
}

export interface Report {
  summary: string;
  timeline: string[];
  claim_findings: string[];
  limitations: string[];
  validator: {
    passed: boolean;
    unsupported_numbers: string[];
  };
}

export interface CaseData {
  version: number;
  private_mode?: boolean;
  camera_mode?: "fixed" | "dashcam";
  /** Which model did what on this case, written by the pipeline. */
  models?: ModelCredit[];
  contact?: { mode: string; per_vehicle?: Record<string, unknown>; occluded_frames?: Record<string, number> };
  clip: ClipInfo;
  clock: ClockInfo;
  calibration: CalibrationInfo;
  tracks: Track[];
  trajectories: Trajectory[];
  events: ImpactEvent[];
  facts: {
    impact: ImpactEvent | null;
    speeds: Record<string, any>;
    braking: Record<string, any>;
    momentum_check: any;
    signal_changes: SignalChange[];
    claims: any[];
    clock_method: string;
    calibration_rms_m: number;
    signal_track?: string | null;
    signal_note?: string;
    closest_approach?: { t: number; i?: number; gap_m?: number; tracks?: [string, string]; [key: string]: unknown } | null;
  };
  signals: Record<string, SignalChange[]>;
  statements: Statement[];
  party_to_track: Record<string, string> | null;
  scene: any;
  claims: Claim[];
  report: Report | null;
  disclaimer: string;
}
