import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Mic } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import type { Claim, Statement } from '../types/case';
import { getTrackColor } from '../utils/colors';
import { claimFocus, claimMeasurement, claimWindow, vehicleName, verdictCounts } from '../utils/caseFacts';
import { ClaimLine } from './ClaimLine';
import { Button, EmptyState, Panel, VerdictTag } from './ui';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

type VerdictFilter = 'all' | 'consistent' | 'inconsistent' | 'cant_tell';

/** "13 traffic lights in view (traffic_light-0, ...); choose..." without the id list. */
const readableReason = (reason: string) => reason.replace(/\s*\(traffic_light[^)]*\)/, '');

const ClaimCard: React.FC<{
  claim: Claim;
  statement?: Statement;
  active: boolean;
  dimmed: boolean;
  onShowMe: () => void;
}> = ({ claim, statement, active, dimmed, onShowMe }) => {
  const { caseData, setSelectedTrack } = useCaseStore();
  const card = useRef<HTMLElement>(null);
  const trackColor = claim.subject_track ? getTrackColor(claim.subject_track) : '#99978f';
  const { t } = claimWindow(claim, caseData?.facts?.impact?.t);
  const m = claim.measured;
  const hasLine = claim.quantity === 'speed_kmh' && claim.value_number != null
    && typeof m?.kmh === 'number' && typeof m?.lo90 === 'number' && typeof m?.hi90 === 'number';
  const measurement = claimMeasurement(claim);

  useEffect(() => {
    if (active) card.current?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  return (
    <article
      ref={card}
      className={`claim-card relative border-b border-line px-3 py-3 transition-colors ${active ? 'bg-asphalt-800' : ''} ${dimmed ? 'opacity-55' : ''}`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[2px] bg-paint" aria-hidden="true" />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-bone-400">
          <span className="truncate text-bone-200">{statement?.speaker || 'Statement'}</span>
          <span className="measured shrink-0 text-bone-500">{claim.statement_id}</span>
          {statement?.transcribed && (
            <span className="inline-flex shrink-0 items-center gap-0.5" title="Transcribed from audio by Muse Voice">
              <Mic className="h-3 w-3" /> audio
            </span>
          )}
        </div>
        <VerdictTag verdict={claim.verdict} />
      </div>

      <blockquote className="said mt-2 text-[15.5px] leading-snug">“{claim.quote}”</blockquote>

      {hasLine ? (
        <ClaimLine className="mt-3" claimed={claim.value_number!} kmh={m.kmh} lo={m.lo90} hi={m.hi90} verdict={claim.verdict} replayKey={active} />
      ) : (
        <div className="mt-2 flex items-baseline justify-between gap-3 text-[12.5px]">
          <span className="text-bone-400">{claimFocus(claim)}</span>
          {measurement && <span className="measured text-right text-bone-200">{measurement}</span>}
        </div>
      )}

      {claim.reason && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-bone-400" title={claim.reason}>{readableReason(claim.reason)}</p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-bone-500">
          {claim.subject_track && (
            <button
              type="button"
              onClick={() => setSelectedTrack(claim.subject_track)}
              title={`Filter the workspace to ${claim.subject_track}`}
              className="inline-flex items-center gap-1 rounded-[3px] px-1 py-0.5 text-bone-300 hover:bg-asphalt-700"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: trackColor }} />
              {caseData ? vehicleName(caseData, claim.subject_track) : claim.subject_track}
            </button>
          )}
          <span className="measured">t = {t.toFixed(2)} s</span>
        </div>
        <Button variant="secondary" size="sm" icon={<Crosshair className="h-3 w-3" />} onClick={onShowMe}
                title={`Jump to the measurement behind "${claim.quote}"`}>
          Show me
        </Button>
      </div>
    </article>
  );
};

export const ClaimsPanel: React.FC = () => {
  const { caseData, jumpToTime, selectedTrack, setSelectedTrack, highlightWindow } = useCaseStore();
  const [filter, setFilter] = useState<VerdictFilter>('all');
  const list = useRef<HTMLDivElement>(null);

  const statementMap = useMemo(() => new Map((caseData?.statements || []).map((s) => [s.id, s])), [caseData?.statements]);
  const claims = useMemo(() => caseData?.claims || [], [caseData?.claims]);
  const counts = useMemo(() => verdictCounts(claims), [claims]);
  const visible = useMemo(() => (filter === 'all' ? claims : claims.filter((c) => c.verdict === filter)), [claims, filter]);

  useEffect(() => { setFilter('all'); }, [claims]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.claim-card', { autoAlpha: 0, y: 8, duration: 0.4, stagger: 0.05, clearProps: 'all' });
    },
    { scope: list, dependencies: [claims, filter] },
  );

  const showMe = (claim: Claim) => {
    const { t, t0, t1 } = claimWindow(claim, caseData?.facts?.impact?.t);
    jumpToTime(t, { t0, t1, reason: claim.quote });
    if (claim.subject_track && useCaseStore.getState().selectedTrack !== claim.subject_track) {
      setSelectedTrack(claim.subject_track);
    }
  };

  const filters: { id: VerdictFilter; label: string; n: number; dot?: string }[] = [
    { id: 'all', label: 'All', n: counts.total },
    { id: 'inconsistent', label: 'Not consistent', n: counts.inconsistent, dot: 'bg-signal-red' },
    { id: 'consistent', label: 'Consistent', n: counts.consistent, dot: 'bg-signal-green' },
    { id: 'cant_tell', label: "Can't tell", n: counts.cant_tell, dot: 'bg-bone-400' },
  ];

  return (
    <Panel title="Statements" meta="checked against the measurements" className="h-full" bodyClassName="flex flex-col">
      <div role="group" aria-label="Filter by verdict" className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1">
        {filters.filter((f) => f.id === 'all' || f.n > 0).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            title={f.label}
            onClick={() => setFilter(f.id)}
            className={`inline-flex h-6 items-center gap-1.5 rounded-[3px] px-1.5 text-[12px] transition-colors ${
              filter === f.id ? 'bg-asphalt-700 text-bone' : 'text-bone-400 hover:text-bone'
            }`}
          >
            {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
            {f.id === 'all' ? 'All' : <span className="sr-only">{f.label}</span>}
            <span className="measured">{f.n}</span>
          </button>
        ))}
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <EmptyState
            title={claims.length === 0 ? 'No statements in this case' : 'No claims with this verdict'}
            action={filter !== 'all' ? <Button size="sm" onClick={() => setFilter('all')}>Show all</Button> : undefined}
          />
        ) : (
          visible.map((claim, idx) => (
            <ClaimCard
              key={`${claim.statement_id}-${claim.quote}-${idx}`}
              claim={claim}
              statement={statementMap.get(claim.statement_id)}
              active={highlightWindow?.reason === claim.quote}
              dimmed={selectedTrack !== null && claim.subject_track !== selectedTrack}
              onShowMe={() => showMe(claim)}
            />
          ))
        )}
      </div>

      <p className="shrink-0 border-t border-line px-3 py-1.5 text-[11.5px] leading-snug text-bone-500">
        Measurements to support expert review. Sakshi does not determine fault or legal liability.
      </p>
    </Panel>
  );
};

export default ClaimsPanel;
