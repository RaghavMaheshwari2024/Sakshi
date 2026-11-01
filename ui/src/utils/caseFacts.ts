/**
 * Plain readings of case.json shared by the workspace, the report and the
 * story. Every value here comes from the pipeline's output; when a value is
 * missing the helpers return null so the UI can say so, never a default number.
 */
import type { CaseData, Claim, SignalChange } from '../types/case';

export interface SpeedWindow {
  t0: number;
  t1: number;
  kmh: number;
  lo90: number;
  hi90: number;
}

const COLOURS = ['white', 'black', 'grey', 'gray', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'brown', 'purple'];

/** "white car" from Muse Wonder's scene description, else the track id. */
export function vehicleName(data: CaseData, id: string): string {
  const concept = data.tracks.find((t) => t.id === id)?.concept || 'car';
  const described: { track_id: string; description?: string }[] = data.scene?.tracks || [];
  const text = described.find((s) => s.track_id === id)?.description || '';
  const colour = COLOURS.find((c) => new RegExp(`\\b${c}`, 'i').test(text));
  const word = concept === 'motorcycle' ? 'two-wheeler' : concept;
  return colour ? `${colour === 'gray' ? 'grey' : colour} ${word}` : id;
}

/** Tracks with a measured trajectory (the vehicles, not the traffic lights). */
export const measuredTracks = (data: CaseData): string[] => data.trajectories.map((t) => t.track);

/** The measured window before the impact, or before the closest approach on a near miss. */
export const speedBeforeImpact = (data: CaseData, id: string): SpeedWindow | null => {
  const s = data.facts?.speeds?.[id];
  return s?.just_before_impact ?? s?.just_before_closest_approach ?? null;
};

/** The governing light's changes, if one could be chosen. */
export function signalChanges(data: CaseData): SignalChange[] {
  if (data.facts?.signal_changes?.length) return data.facts.signal_changes;
  const lights = Object.values(data.signals || {});
  return lights.length === 1 ? lights[0] : [];
}

export function claimFocus(c: Claim): string {
  switch (c.quantity) {
    case 'speed_kmh':
      if (c.when === 'just_before_impact') return 'Speed just before impact';
      if (c.when === 'at_impact') return 'Speed at impact';
      if (c.when === 'at_stop_line') return 'Speed at stop line';
      return 'Vehicle speed';
    case 'signal_state_at_stop_line':
      return 'Signal at the stop line';
    case 'braked_before_impact':
      return 'Braking before impact';
    case 'stopped_before_impact':
      return 'Stopped before impact';
    default:
      return 'Other';
  }
}

/** The measurement behind a claim, in words. Null when nothing was measurable. */
export function claimMeasurement(c: Claim): string | null {
  const m = c.measured;
  if (!m) return null;
  if (typeof m === 'string') return m;
  if (typeof m.kmh === 'number') {
    const range = typeof m.lo90 === 'number' && typeof m.hi90 === 'number'
      ? ` (${m.lo90.toFixed(1)} to ${m.hi90.toFixed(1)}, 90%)` : '';
    return `${m.kmh.toFixed(1)} km/h${range}`;
  }
  if (m.signal) {
    const at = typeof m.stop_line_t === 'number' ? ` at t = ${m.stop_line_t.toFixed(2)} s` : '';
    return `Signal ${String(m.signal)}${at}`;
  }
  if (m.detected !== undefined) {
    if (!m.detected) return 'No sustained braking detected';
    const lead = typeof m.seconds_before_impact === 'number' ? ` ${m.seconds_before_impact.toFixed(2)} s before impact` : '';
    return `Braking detected${lead}`;
  }
  return null;
}

/** Where "Show me" jumps: the claim's own window, else ±1 s around the impact. */
export function claimWindow(c: Claim, impactT?: number): { t: number; t0: number; t1: number } {
  const m = c.measured;
  const num = (v: unknown): v is number => typeof v === 'number';
  let t = impactT ?? 0;
  if (num(m?.stop_line_t)) t = m.stop_line_t;
  else if (num(m?.t0)) t = num(m?.t1) ? (m.t0 + m.t1) / 2 : m.t0;
  return { t, t0: num(m?.t0) ? m.t0 : Math.max(0, t - 1), t1: num(m?.t1) ? m.t1 : t + 1 };
}

/** The claim with the widest gap between what was said and what was measured. */
export function strongestContradiction(data: CaseData): Claim | null {
  const speed = (data.claims || []).filter(
    (c) => c.verdict === 'inconsistent' && c.quantity === 'speed_kmh' && c.value_number != null && typeof c.measured?.kmh === 'number',
  );
  if (speed.length) return speed.reduce((a, b) => (Math.abs(a.measured.kmh - a.value_number!) >= Math.abs(b.measured.kmh - b.value_number!) ? a : b));
  return (data.claims || []).find((c) => c.verdict === 'inconsistent') ?? null;
}

export const verdictCounts = (claims: Claim[]) => ({
  total: claims.length,
  consistent: claims.filter((c) => c.verdict === 'consistent').length,
  inconsistent: claims.filter((c) => c.verdict === 'inconsistent').length,
  cant_tell: claims.filter((c) => c.verdict !== 'consistent' && c.verdict !== 'inconsistent').length,
});

/** Frames the clock says the recorder lost: positions in the clip, from clock.gaps. */
export function droppedPositions(data: CaseData): { i: number; lost: number }[] {
  return (data.clock?.gaps || []).flatMap((g, i) => (g > 1 ? [{ i, lost: g - 1 }] : []));
}
