import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Play, Workflow } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { VideoPanel } from './VideoPanel';
import { TopDownPanel } from './TopDownPanel';
import { SpeedChartPanel } from './SpeedChartPanel';
import { ClaimsPanel } from './ClaimsPanel';
import { MasterTimeline } from './MasterTimeline';
import { CaseTour } from './CaseTour';
import { ErrorBoundary } from './ErrorBoundary';
import { ProvenanceBadge } from './ProvenanceBadge';
import { ModelTheatre } from './ModelTheatre';
import { Button, EmptyState, IconButton, Panel, Segmented, Skeleton } from './ui';
import { loadScenarioIndex, ScenarioEntry } from '../utils/scenarios';
import { measuredTracks, speedBeforeImpact, vehicleName } from '../utils/caseFacts';
import { getTrackColor } from '../utils/colors';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

const Replay3D = lazy(() => import('./Replay3D').then((m) => ({ default: m.Replay3D })));

const Reconstruction: React.FC = () => {
  const reconView = useCaseStore((s) => s.reconView);
  const setReconView = useCaseStore((s) => s.setReconView);
  const open3D = () => {
    const u = new URL(window.location.href);
    u.searchParams.set('replay3d', '1');
    u.searchParams.delete('view');
    window.open(u.toString(), '_blank', 'noopener');
  };
  return (
    <Panel
      title="Reconstruction"
      meta="measured ground plane, metres"
      className="h-full"
      actions={
        <>
          <Segmented
            label="Reconstruction view"
            value={reconView}
            onChange={setReconView}
            options={[{ value: 'top', label: 'Top-down' }, { value: '3d', label: '3D' }]}
          />
          <IconButton label="Open the 3D replay full screen" onClick={open3D}><Maximize2 className="h-3.5 w-3.5" /></IconButton>
        </>
      }
    >
      <div className="absolute inset-0">
        {reconView === 'top' ? <TopDownPanel /> : (
          <ErrorBoundary
            resetKey={reconView}
            title="3D needs WebGL"
            detail="This browser could not start WebGL. The top-down view shows the same measured positions."
          >
            <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
              <Replay3D embedded initialMode="3d" />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </Panel>
  );
};

export const WorkspaceView: React.FC<{ onOpenProcessing: () => void }> = ({ onOpenProcessing }) => {
  const caseData = useCaseStore((s) => s.caseData);
  const scenarioId = useCaseStore((s) => s.scenarioId);
  const backendCaseId = useCaseStore((s) => s.backendCaseId);
  const [entry, setEntry] = useState<ScenarioEntry | null>(null);
  const [touring, setTouring] = useState(() => new URLSearchParams(window.location.search).has('tour'));
  const [isTheatreOpen, setIsTheatreOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScenarioIndex().then((ix) => setEntry(ix?.scenarios.find((s) => s.id === scenarioId) ?? null));
  }, [scenarioId]);

  // Switching case re-opens the instrument, panel by panel.
  useGSAP(
    () => {
      if (prefersReducedMotion() || !grid.current) return;
      gsap.from(grid.current.children, { autoAlpha: 0, duration: 0.45, stagger: 0.06, ease: 'none', clearProps: 'all' });
    },
    { dependencies: [caseData], scope: grid },
  );

  const tracks = useMemo(() => (caseData ? measuredTracks(caseData) : []), [caseData]);

  if (!caseData) {
    return <EmptyState title="No case is open">Pick a scenario from the case switcher, or start a new case.</EmptyState>;
  }

  const impact = caseData.facts?.impact;
  const closest = caseData.facts?.closest_approach;

  return (
    <div className="flex flex-1 flex-col bg-line lg:h-[calc(100dvh-53px)] lg:min-h-[620px] lg:flex-none lg:overflow-hidden">
      {/* What is on screen, at a glance */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1.5 border-b border-line bg-asphalt-900 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-[17px] font-light leading-tight text-bone">
            {entry?.title ?? backendCaseId ?? caseData.clip.file}
          </h1>
        </div>
        <dl className="measured flex min-w-0 flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-bone-400">
          {impact ? (
            <div className="flex gap-1.5"><dt>impact</dt><dd className="text-signal-red">{impact.t.toFixed(3)} s</dd></div>
          ) : closest ? (
            <div className="flex gap-1.5"><dt>no impact, closest</dt><dd className="text-signal-green">{(closest.gap_m as number)?.toFixed(2)} m</dd></div>
          ) : null}
          {tracks.map((id) => {
            const sp = speedBeforeImpact(caseData, id);
            return sp && (
              <div key={id} className="flex items-center gap-1.5" title={`Measured from t = ${sp.t0} to ${sp.t1} s, 90% interval`}>
                <dt className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: getTrackColor(id) }} />{vehicleName(caseData, id)}</dt>
                <dd className="text-bone">{sp.kmh.toFixed(1)} <span className="text-bone-500">({sp.lo90.toFixed(1)}–{sp.hi90.toFixed(1)})</span></dd>
              </div>
            );
          })}
        </dl>
        <div className="ml-auto hidden items-center gap-3 text-[12px] text-bone-500 2xl:flex">
          <span className="measured">{caseData.clip.frames} frames · {caseData.clip.fps_nominal} fps · {caseData.clip.width}×{caseData.clip.height}</span>
          <span className="measured" title="How well the clicked road points fit a flat road">calibration {caseData.calibration.reproj_rms_m.toFixed(3)} m</span>
          <span>{caseData.camera_mode === 'dashcam' ? 'Dashcam' : 'Fixed camera'}</span>
        </div>
        <ProvenanceBadge
          provenance={caseData.execution_provenance}
          onClickTheatre={() => setIsTheatreOpen(true)}
        />
        {!touring && (
          <Button variant="secondary" size="sm" className="ml-auto 2xl:ml-0" icon={<Play className="h-3 w-3 fill-current" />} onClick={() => setTouring(true)}>
            Walk through this case
          </Button>
        )}
      </div>

      {/* The instrument */}
      <div ref={grid} className="hairline-grid grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(320px,380px)] lg:grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="h-[62vw] min-h-[230px] md:h-[300px] lg:h-auto lg:min-h-0"><VideoPanel /></div>
        <div className="h-[80vw] min-h-[280px] md:h-[300px] lg:h-auto lg:min-h-0"><Reconstruction /></div>
        <div className="order-last h-[560px] md:col-span-2 md:h-[480px] lg:order-none lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:h-auto lg:min-h-0"><ClaimsPanel /></div>
        <div className="h-[320px] md:col-span-2 lg:col-span-2 lg:h-auto lg:min-h-0"><SpeedChartPanel /></div>
      </div>

      {/* Time runs under everything; on phones it stays in reach. */}
      <div className="sticky bottom-0 z-20 shrink-0 border-t border-line">
        {touring && <div className="border-b border-line"><CaseTour onClose={() => setTouring(false)} /></div>}
        <MasterTimeline />
      </div>

      {/* Who did what on this case, as recorded by the pipeline */}
      <div className="hidden h-7 shrink-0 items-center justify-between gap-4 border-t border-line bg-asphalt-900 px-3 text-[12px] text-bone-500 md:flex">
        <div className="flex min-w-0 items-center gap-4 overflow-hidden whitespace-nowrap">
          {(caseData.models || []).map((m) => (
            <span key={m.model} className="truncate" title={m.did}>
              <span className="text-bone-300">{m.model}</span> {m.role}
            </span>
          ))}
        </div>
        <button onClick={onOpenProcessing} className="flex shrink-0 items-center gap-1 hover:text-bone">
          <Workflow className="h-3 w-3" /> Pipeline run
        </button>
      </div>

      <ModelTheatre
        isOpen={isTheatreOpen}
        onClose={() => setIsTheatreOpen(false)}
        caseData={caseData}
      />
    </div>
  );
};
