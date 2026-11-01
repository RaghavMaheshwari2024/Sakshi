/**
 * The written report: a document, not a screen, so it stays on paper white and
 * prints cleanly. Every figure is read from case.json for the case on screen.
 * Where the pipeline did not produce a value, the report says so.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import type { CaseData, Claim } from '../types/case';
import { Button, EmptyState } from './ui';
import { claimMeasurement, measuredTracks, signalChanges, speedBeforeImpact, vehicleName } from '../utils/caseFacts';

interface ReportViewProps {
  onBack?: () => void;
}

const VERDICT_TEXT: Record<Claim['verdict'], { label: string; tone: string }> = {
  consistent: { label: 'Consistent', tone: 'text-[#17744b]' },
  inconsistent: { label: 'Not consistent', tone: 'text-[#b5301f]' },
  cant_tell: { label: "Can't tell", tone: 'text-[#55534d]' },
};

const reasonText = (reason: string) => reason.replace(/\s*\(traffic_light[^)]*\)/, '');

/** Written from the facts when the case has no generated report text. */
function fallbackSummary(data: CaseData): string {
  const imp = data.facts?.impact;
  const parts: string[] = [];
  if (imp) parts.push(`Impact between ${imp.tracks.join(' and ')} at t = ${imp.t.toFixed(3)} s (timing uncertainty about ${imp.t_sigma.toFixed(3)} s).`);
  for (const id of measuredTracks(data)) {
    const sp = speedBeforeImpact(data, id);
    if (sp) parts.push(`${id} measured at ${sp.kmh.toFixed(1)} km/h (90% interval ${sp.lo90.toFixed(1)} to ${sp.hi90.toFixed(1)}) from t = ${sp.t0.toFixed(3)} to ${sp.t1.toFixed(3)} s.`);
  }
  return parts.join(' ') || 'No summary was generated for this case.';
}

interface Row { t: number; subject: string; event: string; value: string; strong?: boolean }

function chronology(data: CaseData): Row[] {
  const rows: Row[] = [];
  for (const s of signalChanges(data)) rows.push({ t: s.t, subject: 'Signal', event: `Changed to ${s.state}`, value: '' });
  for (const id of measuredTracks(data)) {
    const b = data.facts?.braking?.[id];
    if (b?.detected) {
      rows.push({
        t: b.t, subject: id, event: `Braking onset, ${Number(b.seconds_before_impact).toFixed(2)} s before impact`,
        value: b.peak_decel_ms2 != null ? `peak ${Math.abs(b.peak_decel_ms2).toFixed(1)} m/s²` : '',
      });
    }
    const sp = speedBeforeImpact(data, id);
    if (sp) {
      rows.push({
        t: sp.t0, subject: id, event: `Speed over t = ${sp.t0.toFixed(2)} to ${sp.t1.toFixed(2)} s`,
        value: `${sp.kmh.toFixed(1)} km/h (${sp.lo90.toFixed(1)} to ${sp.hi90.toFixed(1)}, 90%)`,
      });
    }
  }
  for (const c of data.claims || []) {
    if (typeof c.measured?.stop_line_t === 'number') {
      rows.push({ t: c.measured.stop_line_t, subject: c.subject_track, event: 'Crossed the stop line', value: c.measured.signal ? `signal ${c.measured.signal}` : '' });
    }
  }
  const imp = data.facts?.impact;
  if (imp) {
    rows.push({
      t: imp.t, subject: imp.tracks.join(' × '), event: 'Impact',
      value: `at (${imp.xy[0].toFixed(1)}, ${imp.xy[1].toFixed(1)}) m, ±${imp.t_sigma.toFixed(3)} s`, strong: true,
    });
  }
  const listed = rows.map((r) => `${r.subject}@${r.t}`);
  for (const c of data.claims || []) {
    const m = c.measured;
    if (typeof m?.kmh === 'number' && !listed.includes(`${c.subject_track}@${m.t0}`)) {
      listed.push(`${c.subject_track}@${m.t0}`);
      rows.push({
        t: m.t0, subject: c.subject_track, event: `Speed over t = ${m.t0.toFixed(2)} to ${m.t1.toFixed(2)} s, for statement ${c.statement_id}`,
        value: claimMeasurement(c) ?? '',
      });
    }
  }
  const ca = data.facts?.closest_approach;
  if (ca) rows.push({ t: ca.t, subject: (ca.tracks || []).join(' × '), event: 'Closest approach, no impact', value: `${(ca.gap_m as number)?.toFixed(2)} m apart`, strong: true });
  return rows.sort((a, b) => a.t - b.t);
}

/** A real digest of the footage on screen, computed here in the browser. */
function useFileDigest(url: string): string | null | 'pending' {
  const [digest, setDigest] = useState<string | null | 'pending'>('pending');
  useEffect(() => {
    let live = true;
    setDigest('pending');
    (async () => {
      try {
        const res = await fetch(url);
        const hash = await crypto.subtle.digest('SHA-256', await res.arrayBuffer());
        if (live) setDigest([...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''));
      } catch {
        if (live) setDigest(null);
      }
    })();
    return () => { live = false; };
  }, [url]);
  return digest;
}

const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="mt-9 break-inside-avoid-page">
    <h2 className="flex items-baseline gap-3 border-b border-[#16161422] pb-1.5 font-serif text-[19px] text-[#161614]">
      <span className="font-mono text-[12px] text-[#77756e]">{n}</span>{title}
    </h2>
    <div className="mt-3">{children}</div>
  </section>
);

export const ReportView: React.FC<ReportViewProps> = ({ onBack }) => {
  const caseData = useCaseStore((s) => s.caseData);
  const videoUrl = useCaseStore((s) => s.videoUrl);
  const digest = useFileDigest(videoUrl);
  const rows = useMemo(() => (caseData ? chronology(caseData) : []), [caseData]);

  if (!caseData) {
    return <EmptyState title="No case is open">Open a case to read its report.</EmptyState>;
  }

  const report = caseData.report;
  const validator = report?.validator;
  const impact = caseData.facts?.impact ?? null;
  const momentum = caseData.facts?.momentum_check;
  const calibration = caseData.calibration;
  const closest = caseData.facts?.closest_approach ?? null;
  // The vehicles this report is about: those in the event, else those in the statements.
  const tileIds = (impact?.tracks ?? closest?.tracks ?? [...new Set(caseData.claims.filter((c) => typeof c.measured?.kmh === 'number').map((c) => c.subject_track))]).slice(0, 2);
  const refId = `${(caseData.clip.file || 'case').replace(/\W/g, '').slice(0, 10).toUpperCase()}-${caseData.clip.frames}`;

  return (
    <div className="flex-1 bg-asphalt-950 print:bg-white">
      <div className="sticky top-[96px] z-20 lg:top-[53px] flex items-center justify-between gap-3 border-b border-line bg-asphalt-900 px-3 py-1.5 print:hidden sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {onBack && <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onBack}>Workspace</Button>}
          <span className="truncate text-[12.5px] text-bone-400">Generated from the case on screen</span>
        </div>
        <Button variant="primary" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>Print or save PDF</Button>
      </div>

      <article className="mx-auto my-6 max-w-[840px] bg-[#faf8f3] px-6 py-9 text-[#2c2b27] sm:px-12 sm:py-12 print:m-0 print:max-w-none print:bg-white print:p-0">
        <header className="border-b-2 border-[#161614] pb-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#77756e]">Sakshi crash reconstruction</div>
              <h1 className="mt-2 font-serif text-[32px] font-light leading-[1.1] text-[#161614]">Measurement report</h1>
            </div>
            <div className="shrink-0 text-right font-mono text-[11.5px] leading-relaxed text-[#55534d]">
              <div>Ref {refId}</div>
              <div>{new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-4">
            {[
              ['Source', caseData.clip.file],
              ['Frames', `${caseData.clip.frames} at ${caseData.clip.fps_nominal} fps nominal`],
              ['Resolution', `${caseData.clip.width}×${caseData.clip.height}`],
              ['Camera', caseData.camera_mode === 'dashcam' ? 'Dashcam' : 'Fixed'],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[#77756e]">{k}</dt>
                <dd className="font-mono text-[12px] text-[#161614]">{v}</dd>
              </div>
            ))}
          </dl>
        </header>

        <p className="mt-5 border-l-2 border-[#161614] pl-3 font-serif text-[14.5px] italic leading-relaxed text-[#161614]">
          {caseData.disclaimer || 'Measurements to support expert review. Sakshi does not determine fault.'}
        </p>

        <Section n={1} title="Summary">
          <p className="text-[14px] leading-relaxed">{report?.summary || fallbackSummary(caseData)}</p>
          <dl className="mt-4 grid grid-cols-2 gap-px border border-[#16161422] bg-[#16161422] sm:grid-cols-4">
            <div className="bg-[#faf8f3] p-3 print:bg-white">
              <dt className="text-[12px] text-[#77756e]">{impact ? 'Impact' : closest ? 'Closest approach' : 'Impact or near miss'}</dt>
              <dd className="mt-1 font-mono text-[17px] text-[#161614]">
                {impact ? `${impact.t.toFixed(3)} s` : closest ? `${closest.t.toFixed(3)} s` : 'None found'}
              </dd>
              {impact && <dd className="font-mono text-[11.5px] text-[#77756e]">±{impact.t_sigma.toFixed(3)} s</dd>}
            </div>
            {tileIds.map((id) => {
              const sp = speedBeforeImpact(caseData, id) ?? caseData.claims.find((c) => c.subject_track === id && typeof c.measured?.kmh === 'number')?.measured;
              return (
                <div key={id} className="bg-[#faf8f3] p-3 print:bg-white">
                  <dt className="text-[12px] capitalize text-[#77756e]">{vehicleName(caseData, id)}</dt>
                  <dd className="mt-1 font-mono text-[17px] text-[#161614]">{sp ? `${sp.kmh.toFixed(1)} km/h` : 'Not measured'}</dd>
                  {sp && <dd className="font-mono text-[11.5px] text-[#77756e]">{sp.lo90.toFixed(1)} to {sp.hi90.toFixed(1)}, 90%</dd>}
                </div>
              );
            })}
            <div className="bg-[#faf8f3] p-3 print:bg-white">
              <dt className="text-[12px] text-[#77756e]">Momentum check</dt>
              <dd className="mt-1 font-mono text-[17px] text-[#161614]">{momentum?.status === 'insufficient_data' ? 'Not enough data' : momentum?.status ?? (impact ? 'Not run' : 'No impact')}</dd>
              {momentum?.best_relative_residual != null && (
                <dd className="font-mono text-[11.5px] text-[#77756e]">residual {(momentum.best_relative_residual * 100).toFixed(1)}%</dd>
              )}
            </div>
          </dl>
        </Section>

        <Section n={2} title="Chronology">
          {rows.length === 0 ? <p className="text-[14px]">No events or checked speeds to list for this case.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-[#16161422] text-[12px] text-[#77756e]">
                  <th className="py-1.5 pr-3 font-normal">Time</th>
                  <th className="py-1.5 pr-3 font-normal">Subject</th>
                  <th className="py-1.5 pr-3 font-normal">Event</th>
                  <th className="py-1.5 font-normal">Measurement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b border-[#16161412] ${r.strong ? 'font-medium text-[#161614]' : ''}`}>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px]">{r.t.toFixed(3)} s</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[12.5px]">{r.subject}</td>
                    <td className="py-1.5 pr-3">{r.event}</td>
                    <td className="py-1.5 font-mono text-[12.5px]">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Section>

        <Section n={3} title="Statements against the measurements">
          {caseData.claims.length === 0 ? <p className="text-[14px]">No checkable claims were found in the statements.</p> : (
            <div className="space-y-4">
              {caseData.claims.map((c, idx) => {
                const v = VERDICT_TEXT[c.verdict] ?? VERDICT_TEXT.cant_tell;
                const speaker = caseData.statements?.find((s) => s.id === c.statement_id)?.speaker || c.statement_id;
                const measured = claimMeasurement(c);
                return (
                  <div key={idx} className="break-inside-avoid border-b border-[#16161412] pb-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[12.5px] text-[#55534d]">{speaker} <span className="font-mono">{c.statement_id}</span></span>
                      <span className={`shrink-0 text-[13px] font-medium ${v.tone}`}>{v.label}</span>
                    </div>
                    <p className="mt-1 font-serif text-[15px] italic text-[#161614]">“{c.quote}”</p>
                    {measured && <p className="mt-1 font-mono text-[12.5px] text-[#161614]">Measured: {measured}</p>}
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[#55534d]">{reasonText(c.reason)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section n={4} title="Method">
          <div className="grid gap-5 text-[13px] leading-relaxed sm:grid-cols-3">
            <div>
              <h3 className="font-medium text-[#161614]">Calibration</h3>
              <p className="mt-1">{calibration.image_pts.length} point pairs fit one road-plane homography.</p>
              <p className="mt-1 font-mono text-[12.5px]">RMS {calibration.reproj_rms_m.toFixed(3)} m, worst {calibration.reproj_max_m.toFixed(3)} m</p>
            </div>
            <div>
              <h3 className="font-medium text-[#161614]">Time</h3>
              <p className="mt-1">True frame times from the method below, not the nominal frame rate.</p>
              <p className="mt-1 font-mono text-[12.5px]">
                {caseData.clock.method}, σ {caseData.clock.median_sigma_s.toFixed(3)} s
                {caseData.clock.dropped_frames_inferred != null && `, ${caseData.clock.dropped_frames_inferred} drops inferred`}
              </p>
            </div>
            <div>
              <h3 className="font-medium text-[#161614]">Uncertainty</h3>
              <p className="mt-1">Monte Carlo over the clicks, ground distances, tyre contact point, mask jitter, frame times and smoother stiffness.</p>
              <p className="mt-1 font-mono text-[12.5px]">90% intervals</p>
            </div>
          </div>
        </Section>

        <Section n={5} title="Limitations">
          <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
            {(report?.limitations?.length ? report.limitations : ['No limitations were recorded with this case.']).map((l, i) => (
              <li key={i}>{reasonText(l)}</li>
            ))}
          </ul>
        </Section>

        <Section n={6} title="Provenance">
          {caseData.models?.length ? (
            <dl className="divide-y divide-[#16161412] text-[13px]">
              {caseData.models.map((m) => (
                <div key={m.model} className="grid gap-x-4 py-1.5 sm:grid-cols-[170px_1fr]">
                  <dt className="font-mono text-[12.5px] text-[#161614]">{m.model}</dt>
                  <dd>{m.did}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="text-[13px]">Model use was not recorded for this case.</p>}
          <p className={`mt-3 text-[13px] ${validator && !validator.passed ? 'text-[#b5301f]' : ''}`}>
            {!validator ? 'No generated text to check.'
              : validator.passed ? 'Number check passed: every number in the written summary came from the engine.'
                : `Number check flagged ${validator.unsupported_numbers.length}: ${validator.unsupported_numbers.join(', ')}.`}
          </p>
          <div className="mt-3 text-[12px] text-[#77756e]">SHA-256 of the footage, computed in this browser</div>
          <div className="break-all font-mono text-[11.5px] text-[#161614]">
            {digest === 'pending' ? 'Computing' : digest ?? 'Could not be computed in this browser.'}
          </div>
        </Section>

        <footer className="mt-10 flex items-center justify-between gap-4 border-t-2 border-[#161614] pt-3 text-[12px] text-[#77756e]">
          <span>Sakshi. For review by a qualified expert.</span>
          <span className="font-mono">{refId}</span>
        </footer>
      </article>
    </div>
  );
};

export default ReportView;
