/** Says plainly where the result on screen came from. Only the case's own record can make it say live. */
import React from 'react';
import { useCaseStore } from '../store/useCaseStore';
import type { CaseData } from '../types/case';

export function caseSource(data: CaseData, isScenario: boolean): { label: string; detail: string; live: boolean } {
  if (isScenario) {
    return { label: 'Recorded benchmark', detail: 'A stored result for a simulated crash. Nothing is computed when you open it; start a new case for a live run.', live: false };
  }
  const run = data.run;
  if (!run) return { label: 'Earlier run', detail: 'This result does not record how its model calls were made.', live: false };
  if (run.mode === 'replayed_tracks') return { label: 'Stored tracks', detail: 'Computed by the engine from stored tracking, without tracking again.', live: false };
  const total = run.live_calls + run.cached_calls;
  if (run.live_calls === 0) return { label: 'Re-run from cache', detail: `The pipeline ran here, and all ${total} model calls came from the cache.`, live: false };
  return {
    label: 'Live run',
    detail: `${run.live_calls} live model calls (${run.live_seconds} s) and ${run.cached_calls} from the cache.`,
    live: true,
  };
}

export const CaseSourceBadge: React.FC<{ data: CaseData }> = ({ data }) => {
  const scenarioId = useCaseStore((s) => s.scenarioId);
  const { label, detail, live } = caseSource(data, Boolean(scenarioId));
  return (
    <span title={detail} className={`inline-flex shrink-0 items-center gap-1.5 rounded-[3px] px-1.5 py-0.5 text-[12px] ${live ? 'bg-signal-greensoft text-signal-green' : 'bg-asphalt-700 text-bone-300'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-signal-green' : 'bg-bone-400'}`} aria-hidden="true" />
      {label}
    </span>
  );
};
