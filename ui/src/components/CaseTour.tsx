/**
 * The guided walkthrough: drives the real workspace through one case, step by
 * step, from that case's own numbers. Built for presenting live: each step is
 * one click, and the playhead, the selection and the 3D view all follow.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import type { CaseData } from '../types/case';
import { claimWindow, strongestContradiction, vehicleName } from '../utils/caseFacts';
import { Button, IconButton } from './ui';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

interface Step {
  title: string;
  body: React.ReactNode;
  run: () => (() => void) | void;
}

const store = () => useCaseStore.getState();

/** Play from `from` at slow speed and stop on `to`. Returns a cancel. */
function playInto(from: number, to: number): () => void {
  const st = store();
  st.clearHighlight();
  st.jumpToTime(from);
  st.setPlaybackSpeed(0.5);
  let done = false;
  const start = window.setTimeout(() => { if (!done) store().setIsPlaying(true); }, 250);
  const unsub = useCaseStore.subscribe((s) => {
    if (!done && s.isPlaying && s.currentTime >= to) {
      done = true;
      unsub();
      store().jumpToTime(to);
    }
  });
  return () => {
    done = true;
    window.clearTimeout(start);
    unsub();
    store().setIsPlaying(false);
  };
}

function buildSteps(data: CaseData): Step[] {
  const impact = data.facts?.impact ?? null;
  const closest = data.facts?.closest_approach ?? null;
  const moment = impact?.t ?? closest?.t ?? data.clock.frames[data.clock.frames.length - 1]?.t ?? 0;
  const claim = strongestContradiction(data) ?? data.claims?.[0] ?? null;
  const track = claim?.subject_track ?? data.trajectories[0]?.track ?? null;
  const name = track ? vehicleName(data, track) : 'the vehicle';
  const m = claim?.measured;
  const vehicles = data.tracks.filter((t) => t.concept !== 'traffic light').length;
  const spark = data.models?.find((x) => x.model.startsWith('muse-spark'));
  const inferred = data.clock.dropped_frames_inferred;

  const steps: Step[] = [
    {
      title: 'Every road user, tracked',
      body: <>SAM 3.1 followed {vehicles} road users pixel by pixel. The yellow dot is where a tyre meets the road: that point, not the box, is what gets measured.</>,
      run: () => {
        const st = store();
        st.clearHighlight();
        if (st.selectedTrack) st.setSelectedTrack(st.selectedTrack);
        st.setReconView('top');
        st.jumpToTime(Math.max(moment - 1.6, data.clock.frames[0]?.t ?? 0));
        if (!st.showMasks) st.toggleMasks();
      },
    },
    {
      title: 'Time you can trust',
      body: inferred != null
        ? <>Cheap recorders silently drop frames while still claiming 25 fps, so time cannot be taken from the frame number. {spark ? <>Muse Spark {spark.did}.</> : null} Those ticks, plus the vehicles’ own motion, recovered <span className="measured text-bone">{inferred}</span> lost frames: the amber marks on the timeline.</>
        : <>This clip has no readable burned-in clock, so frame times come from the container. Timing uncertainty is carried into every interval.</>,
      run: () => { store().setReconView('top'); },
    },
  ];

  if (claim && typeof m?.kmh === 'number') {
    steps.push({
      title: 'A speed, with its honest range',
      body: <>From metres and true seconds, the Kalman smoother gives {name} <span className="measured text-bone">{m.kmh.toFixed(1)} km/h</span>, with a 90% interval of <span className="measured text-bone">{m.lo90?.toFixed(1)} to {m.hi90?.toFixed(1)}</span>. No language model touched that number.</>,
      run: () => {
        const st = store();
        const w = claimWindow(claim, impact?.t);
        st.jumpToTime(w.t, { t0: w.t0, t1: w.t1 });
        if (track && st.selectedTrack !== track) st.setSelectedTrack(track);
      },
    });
  }

  steps.push({
    title: impact ? 'The impact' : 'The closest approach',
    body: impact
      ? <>Watch the contact point. Impact at <span className="measured text-bone">t = {impact.t.toFixed(3)} s</span> (±{impact.t_sigma.toFixed(3)} s). Everything after it is smoothed separately, so the crash cannot leak into the speeds before it.</>
      : <>No collision here, and Sakshi says so: closest approach of <span className="measured text-bone">{(closest?.gap_m as number | undefined)?.toFixed(2)} m</span> at <span className="measured text-bone">t = {closest?.t.toFixed(3)} s</span>.</>,
    run: () => playInto(Math.max(moment - 1.3, data.clock.frames[0]?.t ?? 0), moment),
  });

  if (claim) {
    const claimed = claim.value_number;
    steps.push({
      title: 'What was said, against what was measured',
      body: (
        <>
          <span className="said text-bone">“{claim.quote}”</span>{' '}
          {claimed != null && typeof m?.kmh === 'number'
            ? <>The white frame in the 3D view drives the same path at the claimed {claimed} km/h. Sakshi measured {m.kmh.toFixed(1)}.</>
            : <>{claim.reason}</>}
        </>
      ),
      run: () => {
        const st = store();
        const w = claimWindow(claim, impact?.t);
        st.setPlaybackSpeed(1);
        st.setReconView('3d');
        st.jumpToTime(Math.max(moment, w.t), { t0: w.t0, t1: w.t1, reason: claim.quote });
        if (track && st.selectedTrack !== track) st.setSelectedTrack(track);
      },
    });
  }

  steps.push({
    title: 'Where Sakshi stops',
    body: <>Every number in the written report is checked against the engine’s output{data.report?.validator?.passed ? ', and this one passed' : ''}. Sakshi reports measurements for an expert. It never says who is at fault.</>,
    run: () => { store().setReconView('top'); },
  });

  return steps;
}

export const CaseTour: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const caseData = useCaseStore((s) => s.caseData);
  const steps = useMemo(() => (caseData ? buildSteps(caseData) : []), [caseData]);
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { setIndex(0); }, [steps]);
  useEffect(() => steps[index]?.run() ?? undefined, [steps, index]);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.tour-copy', { autoAlpha: 0, y: 8, duration: 0.4, clearProps: 'all' });
      gsap.fromTo('.tour-progress', { scaleX: index / Math.max(1, steps.length) }, {
        scaleX: (index + 1) / Math.max(1, steps.length), duration: 0.5, transformOrigin: 'left center',
      });
    },
    { scope: root, dependencies: [index, steps.length] },
  );

  // Arrow keys belong to the frame stepper; N and P move the tour.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'n' || e.key === 'N') setIndex((i) => Math.min(steps.length - 1, i + 1));
      if (e.key === 'p' || e.key === 'P') setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [steps.length]);

  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;

  return (
    <div ref={root} className="relative shrink-0 bg-asphalt-850">
      <div className="absolute inset-x-0 top-0 h-px bg-line">
        <div className="tour-progress h-px bg-paint" style={{ transform: `scaleX(${(index + 1) / steps.length})`, transformOrigin: 'left center' }} />
      </div>
      <div className="flex items-center gap-4 px-3 py-2.5 sm:px-4">
        <div className="measured hidden shrink-0 text-[12px] text-bone-500 sm:block">{index + 1}/{steps.length}</div>
        <div className="tour-copy min-w-0 flex-1" aria-live="polite">
          <div className="text-[13px] font-medium text-bone">{step.title}</div>
          <p className="mt-0.5 text-[13px] leading-snug text-bone-300">{step.body}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Previous step (P)" disabled={index === 0} onClick={() => setIndex(index - 1)}><ArrowLeft className="h-4 w-4" /></IconButton>
          {last ? (
            <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
          ) : (
            <Button variant="primary" size="sm" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => setIndex(index + 1)} title="Next step (N)">Next</Button>
          )}
          <IconButton label="End walkthrough" onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
      </div>
    </div>
  );
};
