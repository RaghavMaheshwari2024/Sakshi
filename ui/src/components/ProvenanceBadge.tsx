import React from 'react';
import { Activity, Database, Sparkles, Terminal } from 'lucide-react';
import { ExecutionProvenance } from '../types/case';

interface ProvenanceBadgeProps {
  provenance?: ExecutionProvenance;
  onClickTheatre?: () => void;
  compact?: boolean;
}

export const ProvenanceBadge: React.FC<ProvenanceBadgeProps> = ({
  provenance,
  onClickTheatre,
  compact = false,
}) => {
  const mode = provenance?.mode || 'precomputed_bundle';

  let config = {
    label: 'PRE-COMPUTED SCENARIO',
    shortLabel: 'SCENARIO',
    dotClass: 'bg-amber-400',
    containerClass: 'bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/20',
    icon: <Database className="w-3.5 h-3.5 text-amber-400" />,
    tooltip: 'CARLA synthetic ground-truth benchmark with pre-computed Meta AI bundle',
  };

  if (mode === 'live_api') {
    config = {
      label: 'LIVE META API',
      shortLabel: 'LIVE API',
      dotClass: 'bg-emerald-400 animate-ping',
      containerClass: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 shadow-sm shadow-emerald-950/40',
      icon: <Activity className="w-3.5 h-3.5 text-emerald-400" />,
      tooltip: `Streaming real-time from Meta AI APIs (${provenance?.total_latency_ms ?? 0}ms total latency)`,
    };
  } else if (mode === 'hybrid_cache' || mode === 'disk_cache') {
    config = {
      label: mode === 'hybrid_cache' ? 'HYBRID CACHE' : 'META DISK CACHE',
      shortLabel: 'CACHED',
      dotClass: 'bg-sky-400',
      containerClass: 'bg-sky-500/10 border-sky-500/30 text-sky-300 hover:bg-sky-500/20',
      icon: <Sparkles className="w-3.5 h-3.5 text-sky-400" />,
      tooltip: `Verified SHA-256 disk cache hits (${provenance?.cached_calls ?? 0} cached, ${provenance?.live_calls ?? 0} live)`,
    };
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={onClickTheatre}
        title={config.tooltip}
        type="button"
        className={`group relative inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-mono font-medium transition-all duration-150 ${config.containerClass}`}
      >
        <span className="relative flex h-2 w-2 items-center justify-center">
          <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${config.dotClass}`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dotClass.replace(' animate-ping', '')}`} />
        </span>
        {config.icon}
        <span>{compact ? config.shortLabel : config.label}</span>
        {provenance?.total_latency_ms && mode === 'live_api' ? (
          <span className="text-[10px] opacity-75">· {Math.round(provenance.total_latency_ms)}ms</span>
        ) : null}
      </button>

      {onClickTheatre && (
        <button
          onClick={onClickTheatre}
          title="Open Model Theatre (Inspect Live Meta Model Outputs)"
          type="button"
          className="inline-flex items-center gap-1 rounded border border-line bg-asphalt-800 px-2 py-1 text-[11px] font-mono text-bone-200 transition-colors hover:border-paint hover:text-paint"
        >
          <Terminal className="w-3 h-3 text-paint" />
          <span>Model Theatre</span>
        </button>
      )}
    </div>
  );
};
