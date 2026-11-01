/**
 * Validation: how Sakshi scores against simulator ground truth. All figures
 * come from public/scenarios/benchmark.json (exported from cases/suite) or, for
 * the clock table, from the repo's documented ablation on the synthetic case.
 * Weak results are shown as plainly as strong ones.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download } from 'lucide-react';
import { scaleLinear } from 'd3-scale';
import { useCaseStore } from '../store/useCaseStore';
import { Benchmark, BenchmarkScenario, loadBenchmark, SeriesRow, summarise, VehicleScore } from '../utils/benchmark';
import { loadScenarioIndex, openScenario, ScenarioEntry } from '../utils/scenarios';
import { droppedPositions } from '../utils/caseFacts';
import { Button, EmptyState, Metric, Segmented, Skeleton } from './ui';
import { gsap, ScrollTrigger, useGSAP, useReveal, withMotion } from '../lib/motion';

interface AccuracyViewProps {
  onBack?: () => void;
  onOpenCase?: () => void;
}

const SectionHead: React.FC<{ title: string; children?: React.ReactNode }> = ({ title, children }) => (
  <div data-reveal className="max-w-2xl">
    <h2 className="font-serif text-[26px] font-light leading-tight text-bone">{title}</h2>
    {children && <p className="prose-muted mt-2 text-[14px]">{children}</p>}
  </div>
);

/** Error bar on a shared scale; the mark for one vehicle in one scenario. */
const ErrorBar: React.FC<{ score?: VehicleScore; max: number }> = ({ score, max }) => {
  if (!score) return <span className="text-bone-500">-</span>;
  return (
    <div className="flex items-center gap-2" title={`Mean error ${score.mae_kmh} km/h over ${score.frames_scored} frames, bias ${score.bias_pct}%`}>
      <div className="relative h-1.5 w-full min-w-[56px] bg-asphalt-700">
        <div className="val-bar absolute inset-y-0 left-0 origin-left bg-bone-300" style={{ width: `${(score.mape_pct / max) * 100}%` }} />
      </div>
      <span className="measured w-9 shrink-0 text-right text-[12.5px] text-bone">{score.mape_pct.toFixed(1)}</span>
    </div>
  );
};

/** Coverage against the 90% the interval promises. */
const CoverageDot: React.FC<{ score?: VehicleScore }> = ({ score }) => {
  if (!score) return <span className="text-bone-500">-</span>;
  const pct = score.interval_coverage_pct;
  return (
    <div className="flex items-center gap-2" title={`The true speed was inside the 90% interval on ${pct}% of frames`}>
      <div className="relative h-3 w-full min-w-[56px]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-line-strong" />
        <div className="absolute inset-y-0 w-px bg-paint" style={{ left: '90%' }} />
        <div className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${pct >= 80 ? 'bg-signal-green' : pct >= 65 ? 'bg-signal-amber' : 'bg-signal-red'}`}
             style={{ left: `${Math.min(99, pct)}%` }} />
      </div>
      <span className="measured w-9 shrink-0 text-right text-[12.5px] text-bone">{pct.toFixed(0)}</span>
    </div>
  );
};

const TruthChart: React.FC<{ rows: SeriesRow[]; impactT: number | null }> = ({ rows, impactT }) => {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(760);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = 260, m = { t: 12, r: 12, b: 24, l: 34 };
  const t0 = rows[0]?.t ?? 0, t1 = rows[rows.length - 1]?.t ?? 1;
  const hi = Math.max(...rows.map((r) => Math.max(r.hi, r.truth)));
  const lo = Math.min(...rows.map((r) => Math.min(r.lo, r.truth)));
  const x = scaleLinear().domain([t0, t1]).range([m.l, w - m.r]);
  const y = scaleLinear().domain([Math.max(0, lo - 4), hi + 4]).nice().range([h - m.b, m.t]);
  const line = (k: 'truth' | 'v') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(r.t).toFixed(1)} ${y(r[k]).toFixed(1)}`).join('');
  const band = [...rows.map((r) => `${x(r.t).toFixed(1)},${y(r.hi).toFixed(1)}`), ...rows.slice().reverse().map((r) => `${x(r.t).toFixed(1)},${y(r.lo).toFixed(1)}`)].join(' ');

  useGSAP(
    () => {
      withMotion(() => {
        gsap.from('.truth-line', { drawSVG: '0%', duration: 0.9, ease: 'power2.inOut', stagger: 0.1, clearProps: 'strokeDasharray,strokeDashoffset' });
        gsap.from('.truth-band', { opacity: 0, duration: 0.5, delay: 0.3, ease: 'none', clearProps: 'opacity' });
      });
    },
    { scope: box, dependencies: [rows], revertOnUpdate: true },
  );

  return (
    <div ref={box} className="w-full">
      <svg width={w} height={h} role="img" aria-label="Measured speed and its 90 percent interval against the simulator's true speed" className="block">
        {y.ticks(5).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="rgba(237,234,227,0.07)" />
            <text x={m.l - 8} y={y(v) + 3.5} textAnchor="end" fill="#85837c" className="font-mono text-[10.5px]">{v}</text>
          </g>
        ))}
        {x.ticks(Math.max(3, Math.floor(w / 110))).map((v) => (
          <text key={v} x={x(v)} y={h - 7} textAnchor="middle" fill="#85837c" className="font-mono text-[10.5px]">{v.toFixed(1)} s</text>
        ))}
        <polygon className="truth-band" points={band} fill="#edeae3" fillOpacity={0.12} />
        <path className="truth-line" d={line('truth')} fill="none" stroke="#f2c037" strokeWidth={1.5} />
        <path className="truth-line" d={line('v')} fill="none" stroke="#edeae3" strokeWidth={1.5} />
        {impactT != null && impactT <= t1 + 0.2 && <line x1={Math.min(x(impactT), w - m.r)} x2={Math.min(x(impactT), w - m.r)} y1={m.t} y2={h - m.b} stroke="#ef5a4c" />}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[12px] text-bone-400">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-paint" />True speed (CARLA)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-bone" />Sakshi measured</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 bg-bone/15" />90% interval</span>
      </div>
    </div>
  );
};

// Documented in the repo README (scripts/ablate_clock.py on cases/synthetic: 12% of frames dropped plus a 5-frame burst).
const ABLATION = [
  { method: 'Nominal frame rate', err: [12.8, 22.0], cover: [20, 22] },
  { method: 'Clock ticks only', err: [5.0, 8.6], cover: [68, 74] },
  { method: 'Drop-aware: ticks and motion', err: [1.6, 2.1], cover: [87, 100], strong: true },
];

export const AccuracyView: React.FC<AccuracyViewProps> = ({ onBack, onOpenCase }) => {
  const caseData = useCaseStore((s) => s.caseData);
  const [bench, setBench] = useState<Benchmark | null | 'loading'>('loading');
  const [titles, setTitles] = useState<Record<string, ScenarioEntry>>({});
  const [scenario, setScenario] = useState('base');
  const [vehicle, setVehicle] = useState<'A' | 'B'>('A');
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBenchmark().then(setBench);
    loadScenarioIndex().then((ix) => setTitles(Object.fromEntries((ix?.scenarios || []).map((s) => [s.id, s]))));
  }, []);

  const ready = bench && bench !== 'loading' ? bench : null;
  const sum = useMemo(() => (ready ? summarise(ready) : null), [ready]);
  const ordered = useMemo(() => {
    if (!ready) return [];
    const order = Object.keys(titles);
    return [...ready.scenarios].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }, [ready, titles]);

  useReveal(root, [ready]);
  useGSAP(
    () => {
      if (!ready) return;
      withMotion(() => {
        gsap.from('.val-bar', {
          scaleX: 0, duration: 0.8, stagger: 0.012,
          scrollTrigger: { trigger: '.val-table', start: 'top 85%', once: true },
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: root, dependencies: [ready] },
  );

  if (bench === 'loading') {
    return (
      <div className="mx-auto w-full max-w-page space-y-4 px-4 py-10" role="status" aria-label="Loading results">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-24 w-full" /><Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (!ready || !sum) {
    return (
      <EmptyState title="Validation results are not available">
        benchmark.json was not found. Create it with: python ui/scripts/export_benchmark.py
      </EmptyState>
    );
  }

  const name = (s: BenchmarkScenario) => titles[s.id]?.title ?? s.id;
  const current = ready.scenarios.find((s) => s.id === scenario) ?? ready.scenarios[0];
  const series = ready.series[current.id]?.[vehicle];
  const rows = series?.rows ?? [];
  const score = current.vehicles[vehicle]?.last_2s;
  const maxErr = Math.ceil(sum.maxErrorPct);
  const clean = ready.scenarios.find((s) => s.id === 'no_drops');
  const base = ready.scenarios.find((s) => s.id === 'base');
  const noClock = ready.scenarios.find((s) => s.id === 'no_clock');
  const gaps = caseData ? droppedPositions(caseData) : [];
  const dupCount = caseData?.clock.frames.filter((f) => f.dup).length ?? 0;

  const summaryText = () => [
    `Sakshi validation against CARLA 0.9.16 ground truth: ${sum.scenarios} scenarios, fixed camera, footage degraded to CCTV quality.`,
    `Claims: ${sum.claims} checked, ${sum.correct} correct, ${sum.declined} answered can't tell, ${sum.wrong} wrong.`,
    `Impacts: ${sum.impactsFound} of ${sum.crashes} found; the near miss correctly reported no impact.`,
    `Median impact timing error: ${sum.medianImpactErrorS.toFixed(2)} s (worst ${sum.maxImpactErrorS.toFixed(2)} s).`,
    `Median speed error, last 2 s: ${sum.medianErrorPct.toFixed(1)}% (worst ${sum.maxErrorPct.toFixed(1)}%).`,
    `Median coverage of the 90% interval: ${sum.medianCoveragePct.toFixed(0)}%, so intervals run narrower than they should.`,
  ].join('\n');

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
    } catch {
      // Clipboard API refused (permissions, plain http): use a hidden field instead.
      const field = document.createElement('textarea');
      field.value = summaryText();
      document.body.appendChild(field);
      field.select();
      document.execCommand('copy');
      field.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ summary: sum, scenarios: ready.scenarios }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sakshi_carla_validation.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={root} className="mx-auto w-full max-w-page px-4 pb-20 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {onBack && <Button variant="ghost" size="sm" className="-ml-2" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onBack}>Workspace</Button>}
        <div className="flex items-center gap-1.5">
          <Button size="sm" icon={copied ? <Check className="h-3.5 w-3.5 text-signal-green" /> : <Copy className="h-3.5 w-3.5" />} onClick={copySummary}>
            {copied ? 'Copied' : 'Copy summary'}
          </Button>
          <Button size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportJson}>Export JSON</Button>
        </div>
      </div>

      <header className="mt-8 max-w-3xl" data-reveal>
        <h1 className="display text-[clamp(34px,5vw,54px)]">Scored against the truth</h1>
        <p className="prose-muted mt-3 text-[15px]">
          CARLA renders a crash with exact positions, speeds and impact time. Each clip is degraded to look like cheap
          CCTV, run through the full pipeline with real SAM 3.1 tracks, then scored. The pipeline never sees the answers.
        </p>
      </header>

      <div data-reveal className="hairline-grid mt-8 grid grid-cols-2 overflow-hidden rounded border border-line lg:grid-cols-4">
        <Metric className="bg-asphalt-900 p-4" label="Wrong verdicts" value={sum.wrong} tone="text-signal-green"
                note={`of ${sum.claims} claims: ${sum.correct} correct, ${sum.declined} answered “can’t tell”`} />
        <Metric className="bg-asphalt-900 p-4" label="Impacts found" value={`${sum.impactsFound}/${sum.crashes}`}
                note={`Median timing error ${sum.medianImpactErrorS.toFixed(2)} s. The near miss was correctly reported as no impact.`} />
        <Metric className="bg-asphalt-900 p-4" label="Speed error" value={sum.medianErrorPct.toFixed(1)} unit="%"
                note={`Median over the last 2 s before impact. Worst vehicle ${sum.maxErrorPct.toFixed(1)}%.`} />
        <Metric className="bg-asphalt-900 p-4" label="90% interval coverage" value={sum.medianCoveragePct.toFixed(0)} unit="%" tone="text-signal-amber"
                note="Median. It should be 90, so the intervals still run too narrow." />
      </div>

      <section className="mt-16">
        <SectionHead title={`${sum.scenarios} scenarios, one pipeline`}>
          Speed error and coverage over the last 2 s before impact, where claims are checked. A is the white car.
          The yellow tick is the 90% the interval promises. Open any row to see it in the workspace.
        </SectionHead>
        <div data-reveal className="val-table mt-5 overflow-x-auto rounded border border-line">
          <table className="tbl min-w-[860px]">
            <thead>
              <tr>
                <th>Scenario</th><th className="w-[120px]">Impact, s off</th>
                <th className="w-[130px]">Error A, %</th><th className="w-[130px]">Error B, %</th>
                <th className="w-[130px]">Coverage A, %</th><th className="w-[130px]">Coverage B, %</th>
                <th>Drops found</th><th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => {
                const a = s.vehicles.A?.last_2s, b = s.vehicles.B?.last_2s;
                return (
                  <tr key={s.id} className="transition-colors hover:bg-asphalt-850">
                    <td>
                      <button
                        className="text-left text-bone hover:text-paint"
                        title={s.tests}
                        onClick={async () => { await openScenario(s.id); onOpenCase?.(); }}
                      >
                        {name(s)}
                      </button>
                    </td>
                    <td className="measured">
                      {s.true_impact_s == null ? <span className="text-signal-green">none, correct</span> : s.impact.t_error_s?.toFixed(2)}
                    </td>
                    <td><ErrorBar score={a} max={maxErr} /></td>
                    <td><ErrorBar score={b} max={maxErr} /></td>
                    <td><CoverageDot score={a} /></td>
                    <td><CoverageDot score={b} /></td>
                    <td className="measured whitespace-nowrap">{s.dropped_frames.inferred ?? 'n/a'}/{s.dropped_frames.true ?? '-'}</td>
                    <td className="measured whitespace-nowrap" title={`${s.claims.correct} correct, ${s.claims.acceptable} can't tell, ${s.claims.wrong} wrong`}>
                      {s.claims.correct}<span className="text-bone-500"> + {s.claims.acceptable}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p data-reveal className="mt-2 text-[12.5px] text-bone-500">
          Claims: correct verdicts + “can’t tell” answers. Those are almost all signal claims: CARLA’s Low quality does not light the lamps, so the honest answer is that the footage cannot say.
        </p>
      </section>

      <section className="mt-16">
        <SectionHead title="Frame by frame">
          Sakshi’s measured speed over the true speed, for any scenario. The table lists the frames behind the chart.
        </SectionHead>
        <div data-reveal className="mt-5 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px] text-bone-400">
            Scenario
            <select value={scenario} onChange={(e) => setScenario(e.target.value)} className="field w-auto py-1">
              {ordered.map((s) => <option key={s.id} value={s.id}>{name(s)}</option>)}
            </select>
          </label>
          <Segmented label="Vehicle" value={vehicle} onChange={setVehicle}
                     options={[{ value: 'A', label: 'Vehicle A' }, { value: 'B', label: 'Vehicle B' }]} />
          {score && (
            <span className="measured text-[12.5px] text-bone-400">
              MAE {score.mae_kmh} km/h · {score.mape_pct}% · bias {score.bias_pct}% · coverage {score.interval_coverage_pct}% · {score.frames_scored} frames
            </span>
          )}
        </div>
        <div data-reveal className="mt-4 rounded border border-line bg-asphalt-900 p-4">
          {rows.length ? <TruthChart rows={rows} impactT={current.true_impact_s} /> : <EmptyState title="No scored frames for this vehicle" />}
        </div>
        {rows.length > 0 && (
          <details className="group mt-2">
            <summary className="cursor-pointer py-1 text-[13px] text-bone-300 hover:text-bone">Show the {rows.length} sampled frames</summary>
            <div className="mt-2 max-h-[340px] overflow-auto rounded border border-line">
              <table className="tbl measured">
                <thead className="sticky top-0 bg-asphalt-900">
                  <tr><th>Frame</th><th>True t, s</th><th>True, km/h</th><th>Measured</th><th>90% interval</th><th>Error</th><th>Relative</th><th>Inside</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const err = Math.abs(r.v - r.truth), inside = r.lo <= r.truth && r.truth <= r.hi;
                    return (
                      <tr key={r.i}>
                        <td className="text-bone-500">{r.i}</td><td>{r.t.toFixed(2)}</td><td>{r.truth.toFixed(1)}</td><td className="text-bone">{r.v.toFixed(1)}</td>
                        <td>{r.lo.toFixed(1)} to {r.hi.toFixed(1)}</td><td>{err.toFixed(2)}</td><td>{r.truth > 1 ? `${((err / r.truth) * 100).toFixed(1)}%` : '-'}</td>
                        <td className={inside ? 'text-signal-green' : 'text-signal-amber'}>{inside ? 'yes' : 'no'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <section className="mt-16">
        <SectionHead title="Why the clock comes first">
          Cheap recorders lose frames but keep labelling the file 25 fps. Dividing by the frame number then makes cars
          appear to jump, and every speed inherits the error. Sakshi recovers true frame times first.
        </SectionHead>
        <div className="mt-5 grid gap-px overflow-hidden rounded border border-line bg-line lg:grid-cols-2">
          <div data-reveal className="bg-asphalt-900 p-4">
            <div className="text-[13px] text-bone">The controlled test</div>
            <p className="mt-0.5 text-[12.5px] text-bone-400">Synthetic crash with exact truth, 12% of frames dropped plus a 5-frame burst. Speed error, last 2 s.</p>
            <div className="mt-4 space-y-3">
              {ABLATION.map((a) => (
                <div key={a.method}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className={a.strong ? 'text-bone' : 'text-bone-300'}>{a.method}</span>
                    <span className="measured text-bone">{a.err[0]} to {a.err[1]}%</span>
                  </div>
                  <div className="relative mt-1 h-1.5 bg-asphalt-700">
                    <div className={`val-bar absolute inset-y-0 origin-left ${a.strong ? 'bg-paint' : 'bg-bone-400'}`}
                         style={{ left: `${(a.err[0] / 24) * 100}%`, width: `${((a.err[1] - a.err[0]) / 24) * 100}%` }} />
                  </div>
                  <div className="measured mt-0.5 text-[12px] text-bone-500">true speed inside the 90% interval: {a.cover[0]} to {a.cover[1]}%</div>
                </div>
              ))}
            </div>
          </div>
          <div data-reveal className="bg-asphalt-900 p-4">
            <div className="text-[13px] text-bone">The same crash in CARLA, three ways</div>
            <p className="mt-0.5 text-[12.5px] text-bone-400">Speed error, vehicle A / B, last 2 s.</p>
            <dl className="mt-4 divide-y divide-line text-[13px]">
              {[
                ['No frame loss', clean],
                ['Frame loss, clock recovered', base],
                ['Frame loss, no burned-in clock', noClock],
              ].map(([label, s]) => {
                const row = s as BenchmarkScenario | undefined;
                return row && (
                  <div key={label as string} className="flex items-baseline justify-between gap-3 py-2">
                    <dt className="text-bone-300">{label as string}</dt>
                    <dd className="measured text-bone">
                      {row.vehicles.A?.last_2s?.mape_pct.toFixed(1)} / {row.vehicles.B?.last_2s?.mape_pct.toFixed(1)}%
                      <span className="ml-3 text-bone-500">{row.clock_method}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <p className="mt-3 text-[12.5px] leading-relaxed text-bone-400">
              Small cars hide single dropped frames from the motion test, so in CARLA the recovery finds most drops, not all
              ({base?.dropped_frames.inferred} of {base?.dropped_frames.true} on this crash).
            </p>
          </div>
        </div>
        {caseData && (
          <div data-reveal className="mt-3 rounded border border-line bg-asphalt-900 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="text-bone">Frames in the case on screen</span>
              <span className="measured text-[12.5px] text-bone-400">
                {caseData.clip.frames} frames · {caseData.clock.dropped_frames_inferred ?? 'no'} drops inferred · {dupCount} duplicates
              </span>
            </div>
            <div className="mt-2 flex h-5 gap-px" role="img" aria-label="One mark per frame. Amber marks where frames were lost, grey where one repeated.">
              {caseData.clock.frames.map((f) => {
                const lost = gaps.some((g) => g.i === f.i);
                return (
                  <span key={f.i} title={lost ? `Lost before frame ${f.i}` : f.dup ? `Frame ${f.i} repeated` : `Frame ${f.i}`}
                        className={`min-w-0 flex-1 ${lost ? 'bg-signal-amber' : f.dup ? 'bg-bone-400' : 'bg-asphalt-700'}`} />
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-[12px] text-bone-400">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-asphalt-700" />Frame</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-signal-amber" />Frames lost here</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 bg-bone-400" />Repeated frame</span>
            </div>
          </div>
        )}
      </section>

      <section className="mt-16">
        <SectionHead title="Camera types" />
        <div data-reveal className="mt-5 overflow-x-auto rounded border border-line">
          <table className="tbl min-w-[640px]">
            <thead><tr><th></th><th>Fixed camera</th><th>Dashcam</th></tr></thead>
            <tbody>
              <tr><td className="text-bone">Status</td><td>Implemented and validated on {sum.scenarios} scenarios</td><td className="text-signal-amber">Not implemented: the mode is stored with the case</td></tr>
              <tr><td className="text-bone">Calibration</td><td>Road-plane homography from 4 or more point pairs</td><td>Calibration screen collects lane width, camera height and horizon</td></tr>
              <tr><td className="text-bone">Speed error</td><td className="measured">{sum.medianErrorPct.toFixed(1)}% median</td><td>Not measured</td></tr>
              <tr><td className="text-bone">What is missing</td><td>Slopes and the tyre-line offset are carried as uncertainty, not corrected</td><td>Removing the camera’s own motion</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-16">
        <SectionHead title="What still falls short" />
        <ul data-reveal className="mt-4 max-w-3xl space-y-2.5 text-[14px] leading-relaxed text-bone-200">
          <li><span className="text-bone">Intervals run narrow.</span> A 90% interval should contain the truth 90% of the time; the median here is {sum.medianCoveragePct.toFixed(0)}%, and one vehicle reaches {Math.min(...ready.scenarios.flatMap((s) => Object.values(s.vehicles).map((v) => v.last_2s?.interval_coverage_pct ?? 100))).toFixed(0)}%.</li>
          <li><span className="text-bone">Approaching vehicles read fast.</span> The lowest mask pixel slides along a car as it nears the camera, from front tyre to bumper.</li>
          <li><span className="text-bone">Signal reading is unproven in CARLA.</span> At Low quality the lamps are not lit, so those claims are “can’t tell”. With several lights in view, a person must pick the one that governs the stop line.</li>
          <li><span className="text-bone">Post-impact motion is unreliable.</span> Vehicles overlap after contact, so the momentum check can fail. Speeds before impact are measured separately and are not affected.</li>
          <li><span className="text-bone">This is simulation.</span> These numbers are from CARLA. Two harder held-out scenarios (a chain collision and a crowded junction) have no finished run yet, and real-camera results are still to come.</li>
        </ul>
      </section>
    </div>
  );
};

export default AccuracyView;
