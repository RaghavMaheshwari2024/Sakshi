import React, { useEffect, useRef } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';

export const MasterTimeline: React.FC = () => {
  const {
    caseData,
    currentFrame,
    currentTime,
    isPlaying,
    playbackSpeed,
    highlightWindow,
    setTime,
    togglePlay,
    stepFrame,
    setPlaybackSpeed,
    clearHighlight,
  } = useCaseStore();

  const totalFrames = caseData?.clip?.frames || 1;
  const clockFrames = caseData?.clock?.frames || [];
  const maxTime = clockFrames[clockFrames.length - 1]?.t || (totalFrames / (caseData?.clip?.fps_nominal || 25));
  const minTime = clockFrames[0]?.t || 0;
  const timeSpan = Math.max(0.001, maxTime - minTime);

  const progressBarRef = useRef<HTMLDivElement>(null);

  // Global Keyboard shortcuts: J, K, L, Space, Arrow keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't hijack if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepFrame(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepFrame(1);
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        stepFrame(-5);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        stepFrame(5);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame]);

  // Click / scrub handler on progress bar
  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = minTime + ratio * timeSpan;
    clearHighlight();
    setTime(targetTime);
  };

  const impactTime = caseData?.facts?.impact?.t;
  const signalChanges = caseData?.facts?.signal_changes || [];

  return (
    <div className="h-16 border-t border-workspace-border bg-workspace-surface/95 backdrop-blur px-4 flex flex-col justify-center select-none z-30">
      {/* Top track: Signal Status + Dropped Frame Indicators */}
      <div
        ref={progressBarRef}
        onClick={handleScrub}
        className="relative h-4 w-full bg-zinc-950/80 rounded cursor-pointer overflow-hidden border border-zinc-800/80 mb-2 group"
      >
        {/* Signal state color strips */}
        {signalChanges.map((sig, idx) => {
          const nextSig = signalChanges[idx + 1];
          const tStart = sig.t;
          const tEnd = nextSig ? nextSig.t : maxTime;
          const leftPercent = ((tStart - minTime) / timeSpan) * 100;
          const widthPercent = ((tEnd - tStart) / timeSpan) * 100;

          let colorBg = 'bg-zinc-800';
          if (sig.state === 'green') colorBg = 'bg-emerald-500/30 border-r border-emerald-500/50';
          if (sig.state === 'red') colorBg = 'bg-rose-500/30 border-r border-rose-500/50';
          if (sig.state === 'amber') colorBg = 'bg-amber-500/30 border-r border-amber-500/50';

          return (
            <div
              key={idx}
              className={`absolute top-0 bottom-0 ${colorBg}`}
              style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
              title={`Signal: ${sig.state} @ t=${sig.t}s`}
            />
          );
        })}

        {/* Claim Highlight Window (when "Show Me" button was clicked) */}
        {highlightWindow && (
          <div
            className="absolute top-0 bottom-0 bg-cyan-500/30 border-x-2 border-cyan-400 animate-pulse"
            style={{
              left: `${Math.max(0, ((highlightWindow.t0 - minTime) / timeSpan) * 100)}%`,
              width: `${Math.max(1, ((highlightWindow.t1 - highlightWindow.t0) / timeSpan) * 100)}%`,
            }}
          />
        )}

        {/* Dropped frame markers (drop-aware tick indicators) */}
        {clockFrames.map((f) => {
          if (!f.dup) return null;
          const pos = ((f.t - minTime) / timeSpan) * 100;
          return (
            <div
              key={`dup-${f.i}`}
              className="absolute top-0 bottom-0 w-[1.5px] bg-amber-500/60"
              style={{ left: `${pos}%` }}
              title={`Duplicate frame #${f.i}`}
            />
          );
        })}

        {/* Collision Impact Marker */}
        {impactTime !== undefined && (
          <div
            className="absolute top-0 bottom-0 w-1 bg-rose-500 z-10 flex items-center justify-center"
            style={{ left: `${((impactTime - minTime) / timeSpan) * 100}%` }}
          >
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-rose-950 animate-ping" />
          </div>
        )}

        {/* Current Playhead Scrubber */}
        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white z-20 shadow-[0_0_8px_white]"
          style={{ left: `${((currentTime - minTime) / timeSpan) * 100}%` }}
        >
          <div className="w-2 h-2 -ml-[3px] -mt-[2px] rounded-full bg-white shadow" />
        </div>
      </div>

      {/* Bottom controls & Telemetry Readouts */}
      <div className="flex items-center justify-between">
        {/* Playback Buttons */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => stepFrame(-1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 active:scale-95 transition-all"
            title="Step Back 1 Frame (Left Arrow)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={togglePlay}
            className={`p-1.5 rounded text-white font-medium active:scale-95 transition-all ${
              isPlaying
                ? 'bg-amber-600 hover:bg-amber-500'
                : 'bg-cyan-600 hover:bg-cyan-500'
            }`}
            title="Play/Pause (Space or K)"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={() => stepFrame(1)}
            className="p-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 active:scale-95 transition-all"
            title="Step Forward 1 Frame (Right Arrow)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Speed selector */}
          <div className="flex items-center space-x-1 ml-2 border border-zinc-800 rounded bg-zinc-900 p-0.5">
            {[0.25, 0.5, 1.0].map((s) => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all ${
                  playbackSpeed === s
                    ? 'bg-zinc-700 text-zinc-100 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>

        {/* Center: Highlight Notice if active */}
        {highlightWindow && (
          <div className="flex items-center space-x-1.5 text-xs text-cyan-400 font-mono bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60">
            <span>CLAIM WINDOW: {highlightWindow.t0.toFixed(2)}s – {highlightWindow.t1.toFixed(2)}s</span>
            {highlightWindow.reason && <span className="text-zinc-400 font-sans text-[11px]">({highlightWindow.reason})</span>}
          </div>
        )}

        {/* Right: Exact Monospace Telemetry Readout per Claude's rule */}
        <div className="flex items-center space-x-3 text-xs font-mono">
          <div className="flex items-center space-x-1.5 text-zinc-300">
            <span className="text-zinc-500">FRAME:</span>
            <span className="font-bold text-zinc-100">{currentFrame}</span>
            <span className="text-zinc-500">/ {totalFrames - 1}</span>
          </div>

          <div className="h-3 w-[1px] bg-zinc-800" />

          <div className="flex items-center space-x-1.5 text-zinc-300">
            <span className="text-zinc-500">TRUE T:</span>
            <span className="font-bold text-cyan-400">{currentTime.toFixed(3)}s</span>
            {caseData?.clock?.median_sigma_s && (
              <span className="text-[10px] text-zinc-500">
                (±{(caseData.clock.median_sigma_s * 1000).toFixed(0)}ms)
              </span>
            )}
          </div>

          {caseData?.clock?.dropped_frames_inferred !== undefined && (
            <div className="hidden sm:flex items-center space-x-1 text-[11px] text-amber-400/90 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/40">
              <AlertTriangle className="w-3 h-3" />
              <span>{caseData.clock.dropped_frames_inferred} drops recovered</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
