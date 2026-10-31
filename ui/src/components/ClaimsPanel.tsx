import React, { useMemo, useState } from 'react';
import {
  CheckCircle,
  AlertTriangle,
  HelpCircle,
  Crosshair,
  Volume2,
  Filter,
} from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { Claim, Statement } from '../types/case';
import { getTrackColor } from '../utils/colors';

type VerdictFilter = 'all' | 'consistent' | 'inconsistent' | 'cant_tell';

interface VerdictConfig {
  label: string;
  badgeClass: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}

const VERDICT_CONFIGS: Record<'consistent' | 'inconsistent' | 'cant_tell', VerdictConfig> = {
  consistent: {
    label: 'CONSISTENT',
    badgeClass: 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-950/20',
    icon: CheckCircle,
    accentColor: '#10b981',
  },
  inconsistent: {
    label: 'INCONSISTENT',
    badgeClass: 'bg-rose-950/70 text-rose-400 border border-rose-500/40 shadow-sm shadow-rose-950/20',
    icon: AlertTriangle,
    accentColor: '#f43f5e',
  },
  cant_tell: {
    label: 'INCONCLUSIVE',
    badgeClass: 'bg-zinc-900/80 text-zinc-400 border border-zinc-700/60 shadow-sm',
    icon: HelpCircle,
    accentColor: '#71717a',
  },
};

/**
 * Maps quantity type to human-readable forensic evaluation target
 */
function getQuantityFocusLabel(quantity: Claim['quantity'], when?: Claim['when']): string {
  switch (quantity) {
    case 'speed_kmh':
      if (when === 'just_before_impact') return 'Speed just before impact';
      if (when === 'at_impact') return 'Speed at impact';
      if (when === 'at_stop_line') return 'Speed at stop line';
      return 'Vehicle speed';
    case 'signal_state_at_stop_line':
      return 'Signal status at stop line';
    case 'braked_before_impact':
      return 'Pre-impact braking';
    case 'stopped_before_impact':
      return 'Stationary before impact';
    default:
      return 'Forensic claim target';
  }
}

/**
 * Formats the measured telemetry with 90% confidence intervals or exact sensor readings
 */
function formatForensicMeasurement(claim: Claim): string {
  const m = claim.measured;
  if (!m) {
    return 'Measured: Telemetry unavailable';
  }

  // Speed telemetry with explicit 90% interval
  if (typeof m.kmh === 'number') {
    const kmh = m.kmh.toFixed(1);
    const lo = typeof m.lo90 === 'number' ? m.lo90.toFixed(1) : null;
    const hi = typeof m.hi90 === 'number' ? m.hi90.toFixed(1) : null;
    if (lo !== null && hi !== null) {
      return `Measured: ${kmh} km/h (${lo}–${hi}, 90%)`;
    }
    return `Measured: ${kmh} km/h`;
  }

  // Signal state at stop line crossing
  if (m.signal) {
    const sig = String(m.signal).toUpperCase();
    const t = typeof m.stop_line_t === 'number' ? ` @ t=${m.stop_line_t.toFixed(2)}s` : '';
    return `Measured: Signal was ${sig}${t}`;
  }

  // Braking / Deceleration event detection
  if (m.detected !== undefined) {
    if (m.detected) {
      const dt = typeof m.seconds_before_impact === 'number' ? `${m.seconds_before_impact}s ` : '';
      return `Measured: Braking detected ${dt}prior to collision`;
    }
    return 'Measured: No braking detected prior to collision';
  }

  if (typeof m === 'string') {
    return `Measured: ${m}`;
  }

  return 'Measured: Verified via telemetry';
}

/**
 * Calculates key timestamp for a claim to jump playback
 */
function getClaimTimestamp(claim: Claim, impactT?: number): { claimTime: number; t0: number; t1: number } {
  let claimTime = 0;

  if (claim.measured?.stop_line_t !== undefined && typeof claim.measured.stop_line_t === 'number') {
    claimTime = claim.measured.stop_line_t;
  } else if (claim.measured?.t0 !== undefined && typeof claim.measured.t0 === 'number') {
    if (claim.measured?.t1 !== undefined && typeof claim.measured.t1 === 'number') {
      claimTime = (claim.measured.t0 + claim.measured.t1) / 2;
    } else {
      claimTime = claim.measured.t0;
    }
  } else if (impactT !== undefined) {
    claimTime = impactT;
  }

  // Highlight interval: use explicit telemetry window if available, else ±1.0s
  const t0 = claim.measured?.t0 !== undefined && typeof claim.measured.t0 === 'number'
    ? claim.measured.t0
    : Math.max(0, claimTime - 1.0);
  const t1 = claim.measured?.t1 !== undefined && typeof claim.measured.t1 === 'number'
    ? claim.measured.t1
    : claimTime + 1.0;

  return { claimTime, t0, t1 };
}

export const ClaimsPanel: React.FC = () => {
  const {
    caseData,
    jumpToTime,
    selectedTrack,
    setSelectedTrack,
    highlightWindow,
  } = useCaseStore();

  const [filter, setFilter] = useState<VerdictFilter>('all');

  // Map statements by ID for speaker lookup
  const statementMap = useMemo(() => {
    const map = new Map<string, Statement>();
    caseData?.statements?.forEach((s) => {
      map.set(s.id, s);
    });
    return map;
  }, [caseData?.statements]);

  const claims = useMemo(() => {
    return caseData?.claims || [];
  }, [caseData?.claims]);

  const counts = useMemo(() => {
    let consistent = 0;
    let inconsistent = 0;
    let cant_tell = 0;

    claims.forEach((c) => {
      if (c.verdict === 'consistent') consistent++;
      else if (c.verdict === 'inconsistent') inconsistent++;
      else cant_tell++;
    });

    return { total: claims.length, consistent, inconsistent, cant_tell };
  }, [claims]);

  const filteredClaims = useMemo(() => {
    if (filter === 'all') return claims;
    return claims.filter((c) => c.verdict === filter);
  }, [claims, filter]);

  const handleShowMe = (claim: Claim) => {
    const { claimTime, t0, t1 } = getClaimTimestamp(claim, caseData?.facts?.impact?.t);
    jumpToTime(claimTime, {
      t0,
      t1,
      reason: claim.quote,
    });

    if (claim.subject_track) {
      setSelectedTrack(claim.subject_track);
    }
  };

  return (
    <aside className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 text-zinc-100 flex flex-col h-full overflow-hidden select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-zinc-800 shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400" />
          <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
            Forensic Statement Verification
          </h2>
          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
            {counts.total}
          </span>
        </div>

        {/* Filter Badges */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 active:scale-95 ${
              filter === 'all'
                ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('inconsistent')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 active:scale-95 flex items-center space-x-1 ${
              filter === 'inconsistent'
                ? 'bg-rose-950/60 text-rose-300 border border-rose-700/60'
                : 'text-zinc-500 hover:text-rose-400'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>{counts.inconsistent}</span>
          </button>
          <button
            type="button"
            onClick={() => setFilter('consistent')}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 active:scale-95 flex items-center space-x-1 ${
              filter === 'consistent'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-700/60'
                : 'text-zinc-500 hover:text-emerald-400'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>{counts.consistent}</span>
          </button>
          {counts.cant_tell > 0 && (
            <button
              type="button"
              onClick={() => setFilter('cant_tell')}
              className={`px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 active:scale-95 flex items-center space-x-1 ${
                filter === 'cant_tell'
                  ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
              <span>{counts.cant_tell}</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Claims List with thin custom scrollbar */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 my-2.5">
        {filteredClaims.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-zinc-500">
            <Filter className="w-8 h-8 mb-2 stroke-[1.5] text-zinc-600" />
            <p className="text-xs font-mono">
              {claims.length === 0 ? 'No recorded statements in case file' : 'No claims matching current filter'}
            </p>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="mt-3 text-xs text-cyan-400 hover:underline font-mono"
              >
                Reset filter
              </button>
            )}
          </div>
        ) : (
          filteredClaims.map((claim, idx) => {
            const statement = statementMap.get(claim.statement_id);
            const speakerName = statement?.speaker || 'Witness Statement';
            const isTranscribed = Boolean(statement?.transcribed);
            const trackColor = claim.subject_track ? getTrackColor(claim.subject_track) : '#a1a1aa';
            const verdictConfig = VERDICT_CONFIGS[claim.verdict] || VERDICT_CONFIGS.cant_tell;
            const VerdictIcon = verdictConfig.icon;
            const focusLabel = getQuantityFocusLabel(claim.quantity, claim.when);
            const measuredText = formatForensicMeasurement(claim);

            const { claimTime } = getClaimTimestamp(claim, caseData?.facts?.impact?.t);
            const isCurrentHighlight = highlightWindow?.reason === claim.quote;
            const isTrackSelected = selectedTrack === claim.subject_track;

            return (
              <div
                key={`${claim.statement_id}-${idx}`}
                className={`relative rounded-md border p-3 transition-all duration-150 ${
                  isCurrentHighlight
                    ? 'bg-zinc-900/90 border-cyan-500/60 ring-1 ring-cyan-500/40 shadow-lg shadow-cyan-950/20'
                    : isTrackSelected
                    ? 'bg-zinc-900/70 border-zinc-700 ring-1 ring-zinc-700/60'
                    : 'bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-700/70'
                }`}
              >
                {/* Card Header: Speaker, Audio Tag, Track, Verdict */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Speaker name */}
                    <span className="text-xs font-semibold text-zinc-200">
                      {speakerName}
                    </span>

                    {/* Statement ID Pill */}
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-400 bg-zinc-950/80 border border-zinc-800">
                      {claim.statement_id}
                    </span>

                    {/* Audio recording badge if transcribed */}
                    {isTranscribed && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] text-cyan-400/90 bg-cyan-950/40 border border-cyan-800/40 px-1.5 py-0.5 rounded font-mono"
                        title="Transcribed voice audio evidence"
                      >
                        <Volume2 className="w-3 h-3 text-cyan-400" />
                        <span>Audio</span>
                      </span>
                    )}

                    {/* Subject Track Button */}
                    {claim.subject_track && (
                      <button
                        type="button"
                        onClick={() => setSelectedTrack(claim.subject_track)}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-all duration-150 active:scale-95"
                        style={{
                          borderColor: `${trackColor}50`,
                          backgroundColor: `${trackColor}15`,
                          color: trackColor,
                        }}
                        title={`Filter or highlight ${claim.subject_track}`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: trackColor }}
                        />
                        <span>{claim.subject_track}</span>
                      </button>
                    )}
                  </div>

                  {/* Objective Forensic Verdict Badge */}
                  <div
                    className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold tracking-wider uppercase shrink-0 ${verdictConfig.badgeClass}`}
                  >
                    <VerdictIcon className="w-3 h-3" />
                    <span>{verdictConfig.label}</span>
                  </div>
                </div>

                {/* Verbatim Quote: original language text with clean italic quotation */}
                <div className="relative pl-3 border-l-2 border-zinc-700/80 my-2">
                  <p className="text-sm italic font-normal text-zinc-200 leading-snug">
                    “{claim.quote}”
                  </p>
                </div>

                {/* Claim Focus Tag */}
                <div className="flex items-center gap-2 text-[11px] text-zinc-400 mb-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                    Evaluation:
                  </span>
                  <span className="font-medium text-zinc-300">
                    {focusLabel}
                  </span>
                  {claim.value_number !== null && claim.value_number !== undefined && (
                    <span className="font-mono text-zinc-400">
                      (Claimed: {claim.value_number} {claim.quantity === 'speed_kmh' ? 'km/h' : ''})
                    </span>
                  )}
                  {claim.value_text && claim.quantity === 'signal_state_at_stop_line' && (
                    <span className="font-mono text-zinc-400">
                      (Claimed: {claim.value_text})
                    </span>
                  )}
                </div>

                {/* Forensic Measured Value in monospace font with explicit 90% confidence interval */}
                <div className="bg-zinc-950/80 border border-zinc-800/90 rounded px-2.5 py-1.5 mb-2 flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-500 text-[11px]">Telemetry:</span>
                  <span className="text-zinc-200 font-medium tracking-tight telemetry-val">
                    {measuredText}
                  </span>
                </div>

                {/* Forensic Reasoning: One-line concise factual justification */}
                {claim.reason && (
                  <p className="text-xs text-zinc-400 leading-relaxed font-sans mb-2.5">
                    <span className="text-zinc-500 font-medium">Finding: </span>
                    {claim.reason}
                  </p>
                )}

                {/* Card Action Row: Timestamp & "Show Me" button */}
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50">
                  <span className="text-[10px] font-mono text-zinc-500">
                    Ref Time: {claimTime > 0 ? `t=${claimTime.toFixed(2)}s` : 'Impact event'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleShowMe(claim)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800/90 hover:bg-zinc-750 text-cyan-400 hover:text-cyan-300 border border-zinc-700/80 hover:border-zinc-600 text-xs font-medium font-mono transition-all duration-150 active:scale-95 shadow-sm"
                    title={`Jump timeline and highlight forensic telemetry interval for "${claim.quote}"`}
                  >
                    <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Show Me</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Statutory Legal Disclaimer Footer: prominently anchored at bottom */}
      <div className="pt-2.5 mt-auto border-t border-zinc-800 shrink-0 select-none">
        <p className="text-[11px] leading-tight text-zinc-500 text-center font-sans">
          ⚖️ Statutory Notice: Forensic telemetry and kinematic measurements to support expert review. Sakshi does not determine fault or legal liability.
        </p>
      </div>
    </aside>
  );
};

export default ClaimsPanel;
