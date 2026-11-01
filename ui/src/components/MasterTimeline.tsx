import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { IconButton, Segmented } from './ui';
import { droppedPositions, signalChanges as readSignals } from '../utils/caseFacts';
import { SIGNAL_COLORS } from '../utils/colors';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

export const MasterTimeline: React.FC = () => {
  const {
    caseData, currentFrame, currentTime, isPlaying, playbackSpeed, highlightWindow,
    setTime, togglePlay, stepFrame, setPlaybackSpeed, clearHighlight, toggleMasks,
  } = useCaseStore();

  const totalFrames = caseData?.clip?.frames || 1;
  const clockFrames = caseData?.clock?.frames || [];
  const maxTime = clockFrames[clockFrames.length - 1]?.t || totalFrames / (caseData?.clip?.fps_nominal || 25);
  const minTime = clockFrames[0]?.t || 0;
  const timeSpan = Math.max(0.001, maxTime - minTime);
  const pos = (t: number) => ((t - minTime) / timeSpan) * 100;

  const rail = useRef<HTMLDivElement>(null);
  const windowEl = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Keyboard: Space / K, J / L, arrows, M.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A button reached by keyboard keeps Space; one just clicked with the mouse does not,
      // or pressing Space after "Show me" would fire it again instead of playing.
      if (e.code === 'Space' && target?.tagName === 'BUTTON' && target.matches(':focus-visible')) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.code === 'Space' || e.key === 'k' || e.key === 'K') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepFrame(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); stepFrame(1); }
      else if (e.key === 'j' || e.key === 'J') { e.preventDefault(); stepFrame(-5); }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); stepFrame(5); }
      else if (e.key === 'm' || e.key === 'M') { e.preventDefault(); toggleMasks(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, stepFrame, toggleMasks]);

  const scrubTo = (clientX: number) => {
    if (!rail.current) return;
    const rect = rail.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    clearHighlight();
    setTime(minTime + ratio * timeSpan);
  };

  // A claim's window sweeps open from its start, drawing the eye to where it landed.
  useGSAP(
    () => {
      if (!windowEl.current || prefersReducedMotion()) return;
      gsap.fromTo(windowEl.current, { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 0.5 });
    },
    { dependencies: [highlightWindow?.t0, highlightWindow?.t1, highlightWindow?.reason] },
  );

  const impactTime = caseData?.facts?.impact?.t;
  const signals = useMemo(() => (caseData ? readSignals(caseData) : []), [caseData]);
  const drops = useMemo(() => (caseData ? droppedPositions(caseData) : []), [caseData]);
  const inferred = caseData?.clock?.dropped_frames_inferred;
  const sigmaMs = caseData?.clock?.median_sigma_s ? caseData.clock.median_sigma_s * 1000 : null;

  return (
    <section aria-label="Timeline" className="shrink-0 select-none bg-asphalt-900 px-3 pb-2 pt-2.5">
      <div
        ref={rail}
        role="slider"
        tabIndex={0}
        aria-label="Playhead"
        aria-valuemin={0}
        aria-valuemax={totalFrames - 1}
        aria-valuenow={currentFrame}
        aria-valuetext={`Frame ${currentFrame}, ${currentTime.toFixed(2)} seconds`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          scrubTo(e.clientX);
        }}
        onPointerMove={(e) => { if (dragging) scrubTo(e.clientX); }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        className="relative h-6 cursor-ew-resize touch-none"
      >
        {/* Bed */}
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-sm bg-asphalt-700">
          {signals.map((sig, idx) => {
            const end = signals[idx + 1]?.t ?? maxTime;
            return (
              <div key={idx} className="absolute inset-y-0 opacity-80"
                   style={{ left: `${pos(sig.t)}%`, width: `${pos(end) - pos(sig.t)}%`, background: SIGNAL_COLORS[sig.state] }}
                   title={`Signal ${sig.state} from t = ${sig.t.toFixed(2)} s`} />
            );
          })}
        </div>

        {/* Frames the recorder lost (from the clock) and frames it repeated */}
        {drops.map(({ i, lost }) => {
          const t = clockFrames[i]?.t;
          return t === undefined ? null : (
            <div key={`gap-${i}`} className="absolute bottom-0 h-1 w-px bg-signal-amber" style={{ left: `${pos(t)}%` }}
                 title={`${lost} frame${lost > 1 ? 's' : ''} lost before frame ${i}`} />
          );
        })}
        {clockFrames.filter((f) => f.dup).map((f) => (
          <div key={`dup-${f.i}`} className="absolute top-0 h-1 w-px bg-bone-400" style={{ left: `${pos(f.t)}%` }}
               title={`Duplicate frame ${f.i}`} />
        ))}

        {highlightWindow && (
          <div ref={windowEl} className="absolute inset-y-0.5 rounded-sm border border-paint bg-paint-soft"
               style={{
                 left: `${Math.max(0, pos(highlightWindow.t0))}%`,
                 width: `${Math.max(1, pos(Math.min(highlightWindow.t1, maxTime)) - Math.max(0, pos(highlightWindow.t0)))}%`,
               }} />
        )}

        {impactTime !== undefined && (
          <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-signal-red" style={{ left: `${pos(impactTime)}%` }}
               title={`Impact at t = ${impactTime.toFixed(3)} s`} />
        )}

        <div className="absolute inset-y-0 z-10 w-px -translate-x-1/2 bg-paint" style={{ left: `${pos(currentTime)}%` }}>
          <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-paint ring-2 ring-asphalt-900" />
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-0.5">
          <IconButton label="Step back one frame (left arrow)" onClick={() => stepFrame(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            title={isPlaying ? 'Pause (Space or K)' : 'Play (Space or K)'}
            className="inline-flex h-7 w-8 items-center justify-center rounded bg-paint text-asphalt-950 transition-colors hover:bg-[#f7cd58]"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
          <IconButton label="Step forward one frame (right arrow)" onClick={() => stepFrame(1)}><ChevronRight className="h-4 w-4" /></IconButton>
          <Segmented
            className="ml-1.5"
            label="Playback speed"
            value={playbackSpeed}
            onChange={setPlaybackSpeed}
            options={[0.25, 0.5, 1].map((s) => ({ value: s, label: `${s}×` }))}
          />
        </div>

        <div className="min-w-0 flex-1 truncate text-[12px] text-bone-300">
          {highlightWindow && (
            <>
              <span className="measured text-paint">{highlightWindow.t0.toFixed(2)} to {highlightWindow.t1.toFixed(2)} s</span>
              {highlightWindow.reason && <span className="said ml-2 text-bone-300">{highlightWindow.reason}</span>}
            </>
          )}
        </div>

        <dl className="measured flex items-center gap-3 text-[12px] text-bone-400">
          <div className="flex gap-1"><dt>frame</dt><dd className="text-bone">{currentFrame}<span className="text-bone-500">/{totalFrames - 1}</span></dd></div>
          <div className="flex gap-1">
            <dt>t</dt>
            <dd className="text-paint">{currentTime.toFixed(3)} s</dd>
            {sigmaMs !== null && <dd className="hidden sm:block" title="Median frame-time uncertainty">±{sigmaMs.toFixed(0)} ms</dd>}
          </div>
          {inferred != null && (
            <div className="hidden gap-1 lg:flex" title="Frames the recorder lost, recovered from the burned-in clock and the vehicles' motion">
              <dd className="text-signal-amber">{inferred}</dd><dt>drops recovered</dt>
            </div>
          )}
        </dl>
      </div>
    </section>
  );
};
