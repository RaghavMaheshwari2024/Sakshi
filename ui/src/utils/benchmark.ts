/**
 * The real validation results: public/scenarios/benchmark.json, exported from
 * cases/suite by ui/scripts/export_benchmark.py. Aggregates below are plain
 * arithmetic over those rows.
 */
export interface VehicleScore {
  frames_scored: number;
  mae_kmh: number;
  mape_pct: number;
  bias_pct: number;
  interval_coverage_pct: number;
}

export interface BenchmarkScenario {
  id: string;
  tests: string;
  impact: { outcome?: string; t_error_s?: number; clock_error_s?: number; confirmed?: boolean };
  true_impact_s: number | null;
  clock_method: string;
  dropped_frames: { inferred?: number | null; true?: number };
  degradation: { drop?: number; dup?: number; crf?: number; scale?: number; clock?: boolean };
  claims: {
    total: number;
    correct: number;
    acceptable: number;
    wrong: number;
    rows: { claim: string; true: unknown; expected: string; got: string; outcome: string }[];
  };
  vehicles: Record<string, { last_2s?: VehicleScore; approach?: VehicleScore }>;
}

export interface SeriesRow {
  i: number;
  t: number;
  truth: number;
  v: number;
  lo: number;
  hi: number;
}

export interface ModelUsage {
  live_calls: number;
  cached_calls: number;
  live_seconds: number;
  jobs: Record<string, number>;
}

export interface Benchmark {
  variant: string;
  scenarios: BenchmarkScenario[];
  series: Record<string, Record<string, { track: string; rows: SeriesRow[] }>>;
  usage: Record<string, ModelUsage>;
}

let cached: Promise<Benchmark | null> | null = null;

export function loadBenchmark(): Promise<Benchmark | null> {
  if (!cached) {
    cached = fetch('/scenarios/benchmark.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return cached;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarise(b: Benchmark) {
  const scenarios = b.scenarios;
  const vehicles = scenarios.flatMap((s) => Object.values(s.vehicles).map((v) => v.last_2s).filter(Boolean)) as VehicleScore[];
  const crashes = scenarios.filter((s) => s.true_impact_s != null);
  const timing = crashes.map((s) => Math.abs(s.impact.t_error_s ?? NaN)).filter(Number.isFinite);
  return {
    scenarios: scenarios.length,
    claims: scenarios.reduce((n, s) => n + s.claims.total, 0),
    correct: scenarios.reduce((n, s) => n + s.claims.correct, 0),
    declined: scenarios.reduce((n, s) => n + s.claims.acceptable, 0),
    wrong: scenarios.reduce((n, s) => n + s.claims.wrong, 0),
    crashes: crashes.length,
    impactsFound: crashes.filter((s) => s.impact.outcome === 'detected').length,
    medianErrorPct: median(vehicles.map((v) => v.mape_pct)),
    medianCoveragePct: median(vehicles.map((v) => v.interval_coverage_pct)),
    maxErrorPct: Math.max(...vehicles.map((v) => v.mape_pct)),
    medianImpactErrorS: median(timing),
    maxImpactErrorS: Math.max(...timing),
  };
}

