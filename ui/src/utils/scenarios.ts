/**
 * Pre-rendered scenarios (the CARLA test suite), served as static files from
 * /scenarios/ (written by ui/scripts/export_scenarios.py). Nothing runs when a
 * scenario is picked: its case.json is fetched once and kept in memory, and
 * its video is already encoded for instant playback.
 */
import type { CaseData } from '../types/case';
import { useCaseStore } from '../store/useCaseStore';

export interface ScenarioVehicleScore {
  track: string;
  error_pct: number | null;
  in90_pct: number | null;
}

export interface ScenarioEntry {
  id: string;
  group: string;
  title: string;
  description: string;
  camera_mode: string;
  impact: boolean;
  impact_outcome: string | null;
  impact_error_s: number | null;
  claims: number;
  claims_correct: string | null; // "4/4" against CARLA ground truth
  verdicts: Partial<Record<'consistent' | 'inconsistent' | 'cant_tell', number>>;
  vehicles: Record<string, ScenarioVehicleScore>;
  frames: number;
}

export interface ScenarioIndex {
  default: string;
  scenarios: ScenarioEntry[];
}

const BASE = '/scenarios';
let indexPromise: Promise<ScenarioIndex | null> | null = null;
const caseCache = new Map<string, Promise<CaseData>>();
const videoWarm = new Set<string>();

export const scenarioVideoUrl = (id: string) => `${BASE}/${id}/input.mp4`;
export const scenarioThumbUrl = (id: string) => `${BASE}/${id}/thumb.jpg`;

/** The scenario list, or null when no scenarios were exported. */
export function loadScenarioIndex(): Promise<ScenarioIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}/index.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && Array.isArray(j.scenarios) && j.scenarios.length ? (j as ScenarioIndex) : null))
      .catch(() => null);
  }
  return indexPromise;
}

/** A scenario's case.json (fetched once, then served from memory). */
export function loadScenarioCase(id: string): Promise<CaseData> {
  let p = caseCache.get(id);
  if (!p) {
    p = fetch(`${BASE}/${id}/case.json`).then((r) => {
      if (!r.ok) throw new Error(`Scenario ${id}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => caseCache.delete(id));
    caseCache.set(id, p);
  }
  return p;
}

/** Warm the caches before a click (on hover): the JSON into memory, the video into the HTTP cache. */
export function prefetchScenario(id: string): void {
  loadScenarioCase(id).catch(() => undefined);
  if (!videoWarm.has(id)) {
    videoWarm.add(id);
    fetch(scenarioVideoUrl(id)).catch(() => videoWarm.delete(id));
  }
}

/** ?scenario=night in the address bar, for direct links and recording. */
export function scenarioFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('scenario');
}

export function setScenarioInUrl(id: string): void {
  const u = new URL(window.location.href);
  u.searchParams.set('scenario', id);
  window.history.replaceState(null, '', u.toString());
}

/** Load a scenario into the workspace (video, replay, charts, claims, report all follow). */
export async function openScenario(id: string): Promise<void> {
  const data = await loadScenarioCase(id);
  const st = useCaseStore.getState();
  st.loadCase(data, scenarioVideoUrl(id));
  st.setScenarioId(id);
  setScenarioInUrl(id);
}
