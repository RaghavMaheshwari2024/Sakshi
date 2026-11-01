import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useCaseStore } from './store/useCaseStore';
import { ActiveView, AppBar, VIEW_KEYS } from './components/AppBar';
import { WorkspaceView } from './components/WorkspaceView';
import { OverviewView } from './components/OverviewView';
import { SystemView } from './components/SystemView';
import { ReportView } from './components/ReportView';
import { AccuracyView } from './components/AccuracyView';
import { CalibrationView } from './components/CalibrationView';
import { ProcessingModal } from './components/ProcessingModal';
import { NewCaseModal } from './components/NewCaseModal';
import { InvestigatorGuideModal } from './components/InvestigatorGuideModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button, Mark, Skeleton } from './components/ui';
import { loadScenarioIndex, openScenario, scenarioFromUrl } from './utils/scenarios';
import { acceptBackendCase, openBackendCase } from './utils/api';
import { gsap, prefersReducedMotion, useGSAP } from './lib/motion';
import type { CaseData } from './types/case';

const Replay3D = lazy(() => import('./components/Replay3D').then((m) => ({ default: m.Replay3D })));
const ReplayControls = lazy(() => import('./components/Replay3D').then((m) => ({ default: m.ReplayControls })));

const VIEWS: ActiveView[] = ['overview', 'case', 'calibration', 'report', 'accuracy', 'system'];

/** ?view=report opens a view directly; a ?scenario= link goes straight to the case. */
function viewFromUrl(): ActiveView {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('view') as ActiveView | null;
  if (v && VIEWS.includes(v)) return v;
  return params.has('scenario') ? 'case' : 'overview';
}

export const App: React.FC = () => {
  const caseData = useCaseStore((s) => s.caseData);
  const loadCase = useCaseStore((s) => s.loadCase);
  const scenarioId = useCaseStore((s) => s.scenarioId);
  const backendCaseId = useCaseStore((s) => s.backendCaseId);
  const [activeView, setActiveViewState] = useState<ActiveView>(viewFromUrl);
  const [isProcessingOpen, setIsProcessingOpen] = useState(false);
  const [autoRun, setAutoRun] = useState(false);
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A backend case with no result yet: nothing from the case on screen applies to it.
  const [uncalibrated, setUncalibrated] = useState<{ id: string; mode: 'fixed' | 'dashcam' } | null>(null);
  const viewRoot = useRef<HTMLDivElement>(null);

  const setActiveView = useCallback((view: ActiveView) => {
    setActiveViewState(view);
    const u = new URL(window.location.href);
    if (view === 'overview') u.searchParams.delete('view');
    else u.searchParams.set('view', view);
    window.history.replaceState(null, '', u.toString());
    window.scrollTo(0, 0);
  }, []);

  // The guide greets first-time investigators when they reach the workspace.
  useEffect(() => {
    if (activeView === 'case' && !loading && !localStorage.getItem('sakshi_guide_seen')
      && !sessionStorage.getItem('sakshi_guide_shown')) {
      sessionStorage.setItem('sakshi_guide_shown', '1');
      setIsGuideOpen(true);
    }
  }, [activeView, loading]);

  // Load a case on mount: a backend case by link, else a scenario, else the mock.
  useEffect(() => {
    let isMounted = true;
    const fetchCase = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams(window.location.search);
        const wantedCase = params.get('case');
        if (wantedCase) {
          await openBackendCase(wantedCase);
          if (isMounted) setLoading(false);
          return;
        }
        const index = await loadScenarioIndex();
        if (index) {
          const wanted = scenarioFromUrl();
          const id = index.scenarios.some((x) => x.id === wanted) ? wanted! : index.default;
          const startId = index.scenarios.some((x) => x.id === id) ? id : index.scenarios[0].id;
          await openScenario(startId);
          if (isMounted) setLoading(false);
          return;
        }
        const res = await fetch('/mock/case.json');
        if (!res.ok) throw new Error(`Failed to load case data: HTTP ${res.status}`);
        const data: CaseData = await res.json();
        if (isMounted) {
          loadCase(data, '/mock/input.mp4');
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to load case:', err);
          setLoadError(err instanceof Error ? err.message : 'Error loading incident data');
          setLoading(false);
        }
      }
    };
    fetchCase();
    return () => {
      isMounted = false;
    };
  }, [loadCase]);

  // Global navigation shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (isGuideOpen) setIsGuideOpen(false);
        else if (isProcessingOpen) setIsProcessingOpen(false);
        else if (isNewCaseOpen) setIsNewCaseOpen(false);
        else if (activeView !== 'case' && activeView !== 'overview') setActiveView('case');
      } else if (e.key === '?') {
        setIsGuideOpen((prev) => !prev);
      } else {
        const view = VIEW_KEYS[e.key];
        if (view) setActiveView(view);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, isProcessingOpen, isNewCaseOpen, isGuideOpen, setActiveView]);

  useGSAP(
    () => {
      if (!viewRoot.current || prefersReducedMotion() || activeView === 'overview') return;
      gsap.from(viewRoot.current, { autoAlpha: 0, y: 6, duration: 0.32, clearProps: 'all' });
    },
    { dependencies: [activeView, loading] },
  );

  const calibrateCase = useCallback((id: string, mode: 'fixed' | 'dashcam' = 'fixed') => {
    const st = useCaseStore.getState();
    st.setBackendCaseId(id);
    st.setScenarioId(null);
    setUncalibrated({ id, mode });
    setActiveView('calibration');
  }, [setActiveView]);

  const runPipeline = useCallback((start: boolean) => {
    setAutoRun(start);
    setIsProcessingOpen(true);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 p-6" role="status" aria-label="Loading case">
        <Mark className="h-8 w-8" />
        <div className="w-44 space-y-2">
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-1.5 w-2/3" />
        </div>
        <p className="text-[13px] text-bone-400">Opening the case file</p>
      </div>
    );
  }

  if (loadError && !caseData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <Mark className="h-8 w-8" />
        <h1 className="mt-2 font-serif text-[22px] font-light">The case file did not load</h1>
        <p className="max-w-md text-[13px] text-bone-400">{loadError}</p>
        <Button variant="secondary" onClick={() => window.location.reload()} className="mt-2">Try again</Button>
      </div>
    );
  }

  // Full-screen 3D replay (for recording the demo): open /?replay3d
  if (caseData && new URLSearchParams(window.location.search).has('replay3d')) {
    return (
      <div className="flex h-screen w-screen flex-col gap-2 bg-asphalt-950 p-3">
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <div className="min-h-0 flex-1"><Replay3D /></div>
          <ReplayControls />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="sticky top-0 z-30 print:hidden">
        <AppBar
          activeView={activeView}
          setActiveView={setActiveView}
          onOpenProcessing={() => runPipeline(false)}
          onOpenNewCase={() => setIsNewCaseOpen(true)}
          onOpenGuide={() => setIsGuideOpen(true)}
          onCalibrateCase={calibrateCase}
        />
      </div>

      <main className="flex min-h-0 flex-1 flex-col">
        <ErrorBoundary resetKey={activeView}>
          <div ref={viewRoot} className="flex min-h-0 flex-1 flex-col">
            {activeView === 'overview' && <OverviewView onOpenCase={() => setActiveView('case')} onNavigate={setActiveView} />}
            {activeView === 'case' && <WorkspaceView onOpenProcessing={() => runPipeline(false)} />}
            {activeView === 'report' && <ReportView onBack={() => setActiveView('case')} />}
            {activeView === 'accuracy' && <AccuracyView onBack={() => setActiveView('case')} onOpenCase={() => setActiveView('case')} />}
            {activeView === 'system' && <SystemView onOpenPipeline={() => runPipeline(false)} />}
            {activeView === 'calibration' && (
              <CalibrationView
                key={backendCaseId ?? scenarioId ?? 'mock'}
                caseId={backendCaseId}
                frameFallbackUrl={scenarioId ? `/scenarios/${scenarioId}/thumb.jpg` : null}
                initialCalibration={uncalibrated ? null : caseData?.calibration}
                clip={uncalibrated ? null : caseData?.clip}
                cameraMode={uncalibrated?.mode ?? caseData?.camera_mode ?? 'fixed'}
                onClose={() => setActiveView('case')}
                onRunPipeline={() => {
                  setActiveView('case');
                  runPipeline(Boolean(backendCaseId));
                }}
              />
            )}
          </div>
        </ErrorBoundary>
      </main>

      <ProcessingModal
        isOpen={isProcessingOpen}
        onClose={() => setIsProcessingOpen(false)}
        caseId={backendCaseId}
        recorded={uncalibrated ? null : caseData}
        autoStart={autoRun}
        onComplete={(id, data) => {
          acceptBackendCase(id, data);
          setUncalibrated(null);
          setIsProcessingOpen(false);
          setActiveView('case');
        }}
      />

      <NewCaseModal
        isOpen={isNewCaseOpen}
        onClose={() => setIsNewCaseOpen(false)}
        onCaseCreated={(id, mode) => {
          // A new case goes to calibration first: the backend will not run without it.
          setIsNewCaseOpen(false);
          calibrateCase(id, mode);
        }}
      />

      <InvestigatorGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </div>
  );
};

export default App;
