import React, { useEffect, useState } from 'react';
import { useCaseStore } from './store/useCaseStore';
import { Header, ActiveView } from './components/Header';
import { VideoPanel } from './components/VideoPanel';
import { TopDownPanel } from './components/TopDownPanel';
import { SpeedChartPanel } from './components/SpeedChartPanel';
import { ClaimsPanel } from './components/ClaimsPanel';
import { MasterTimeline } from './components/MasterTimeline';
import { ReportView } from './components/ReportView';
import { AccuracyView } from './components/AccuracyView';
import { CalibrationView } from './components/CalibrationView';
import { ProcessingModal } from './components/ProcessingModal';
import { NewCaseModal } from './components/NewCaseModal';
import { InvestigatorGuideModal } from './components/InvestigatorGuideModal';
import { Replay3D, ReplayControls } from './components/Replay3D';
import { Loader2, AlertCircle, Cpu, Eye } from 'lucide-react';
import { CaseData } from './types/case';

export const App: React.FC = () => {
  const { caseData, loadCase } = useCaseStore();
  const [activeView, setActiveView] = useState<ActiveView>('case');
  const [isProcessingOpen, setIsProcessingOpen] = useState(false);
  const [isNewCaseOpen, setIsNewCaseOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(() => {
    // Open guide automatically on first start if not dismissed permanently
    return !localStorage.getItem('sakshi_guide_seen');
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ingest mock case data on mount
  useEffect(() => {
    let isMounted = true;
    const fetchCase = async () => {
      try {
        setLoading(true);
        // Try to fetch from Vite public mock directory
        const res = await fetch('/mock/case.json');
        if (!res.ok) {
          throw new Error(`Failed to load case data: HTTP ${res.status}`);
        }
        const data: CaseData = await res.json();
        if (isMounted) {
          loadCase(data, '/mock/input.mp4');
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Failed to load case:', err);
          setLoadError(err.message || 'Error loading incident data');
          setLoading(false);
        }
      }
    };

    fetchCase();
    return () => {
      isMounted = false;
    };
  }, [loadCase]);

  // Global Navigation Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === 'Escape') {
        if (isGuideOpen) setIsGuideOpen(false);
        else if (isProcessingOpen) setIsProcessingOpen(false);
        else if (isNewCaseOpen) setIsNewCaseOpen(false);
        else if (activeView !== 'case') setActiveView('case');
      } else if (e.key === '?') {
        setIsGuideOpen((prev) => !prev);
      } else if (e.key === '1') {
        setActiveView('case');
      } else if (e.key === '2') {
        setActiveView('report');
      } else if (e.key === '3') {
        setActiveView('accuracy');
      } else if (e.key === '4') {
        setActiveView('calibration');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, isProcessingOpen, isNewCaseOpen, isGuideOpen]);

  if (loading) {
    return (
      <div className="min-h-screen bg-workspace-bg text-zinc-100 flex flex-col items-center justify-center p-6 space-y-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
          <Loader2 className="w-6 h-6 text-cyan-400 absolute inset-0 m-auto animate-pulse" />
        </div>
        <div className="text-center font-mono space-y-1">
          <div className="text-sm font-semibold tracking-wider text-zinc-200">
            LOADING KINEMATIC DOSSIER
          </div>
          <div className="text-xs text-zinc-500">Reading case.json telemetry and video stream...</div>
        </div>
      </div>
    );
  }

  if (loadError && !caseData) {
    return (
      <div className="min-h-screen bg-workspace-bg text-zinc-100 flex flex-col items-center justify-center p-6 space-y-4">
        <div className="p-3 rounded-full bg-rose-950/60 border border-rose-800 text-rose-400">
          <AlertCircle className="w-8 h-8" />
        </div>
        <div className="text-center font-mono space-y-2 max-w-md">
          <div className="text-sm font-semibold text-rose-300">INCIDENT DATA LOAD FAILURE</div>
          <div className="text-xs text-zinc-400">{loadError}</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 border border-zinc-700 font-mono transition-all"
          >
            Retry Ingestion
          </button>
        </div>
      </div>
    );
  }

  // Full-screen 3D replay (for recording the demo and the X clip): open /?replay3d
  if (caseData && new URLSearchParams(window.location.search).has('replay3d')) {
    return (
      <div className="flex h-screen w-screen flex-col gap-2 bg-zinc-950 p-3">
        <div className="min-h-0 flex-1"><Replay3D /></div>
        <ReplayControls />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-workspace-bg text-zinc-100 flex flex-col font-sans antialiased overflow-x-hidden">
      {/* Universal Header (Hidden when printing the report) */}
      <div className="print:hidden">
        <Header
          activeView={activeView}
          setActiveView={setActiveView}
          onOpenProcessing={() => setIsProcessingOpen(true)}
          onOpenNewCase={() => setIsNewCaseOpen(true)}
          onOpenGuide={() => setIsGuideOpen(true)}
        />
      </div>

      {/* Primary Workspace Viewport */}
      <main className="flex-1 flex flex-col min-h-0 pb-16">
        {activeView === 'report' && (
          <ReportView onBack={() => setActiveView('case')} />
        )}

        {activeView === 'accuracy' && (
          <AccuracyView onBack={() => setActiveView('case')} />
        )}

        {activeView === 'calibration' && (
          <div className="flex-1 p-4 flex flex-col">
            <CalibrationView
              caseId="carla_002"
              initialCalibration={caseData?.calibration}
              cameraMode={caseData?.camera_mode || 'fixed'}
              onClose={() => setActiveView('case')}
              onRunPipeline={() => {
                setActiveView('case');
                setIsProcessingOpen(true);
              }}
            />
          </div>
        )}

        {activeView === 'case' && (
          <div className="flex-1 flex flex-col p-2 sm:p-3 space-y-3 min-h-0">
            {/* 4-Panel Hero Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-h-0">
              {/* Left Column: Video Overlay (P1) + Speed Chart (P3) */}
              <div className="flex flex-col space-y-3">
                <div className="h-[360px] xl:h-[430px]">
                  <VideoPanel />
                </div>
                <div className="h-[310px] xl:h-[360px]">
                  <SpeedChartPanel />
                </div>
              </div>

              {/* Right Column: Top-Down Birds-Eye Replay (P2) + Statements & Verification (P4) */}
              <div className="flex flex-col space-y-3">
                <div className="h-[360px] xl:h-[430px]">
                  <TopDownPanel />
                </div>
                <div className="h-[310px] xl:h-[360px]">
                  <ClaimsPanel />
                </div>
              </div>
            </div>

            {/* Bottom Full-Width Master Scrubber & Signal Timeline */}
            <div className="shrink-0">
              <MasterTimeline />
            </div>

            {/* Meta Tooling Attribution & Evidence Strip */}
            <div className="h-8 px-3 rounded-md bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
              <div className="flex items-center space-x-3 overflow-x-auto scrollbar-none">
                <div className="flex items-center space-x-1.5 text-zinc-300 shrink-0">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-semibold text-zinc-200">Meta AI Models:</span>
                </div>
                <div className="flex items-center space-x-1 text-zinc-400 shrink-0">
                  <span className="text-cyan-400 font-medium">SAM 3.1:</span>
                  <span>Hull Tracking ({caseData?.tracks?.length || 2} road users)</span>
                </div>
                <span className="text-zinc-700 hidden sm:inline">•</span>
                <div className="flex items-center space-x-1 text-zinc-400 shrink-0">
                  <span className="text-amber-400 font-medium">Muse Spark:</span>
                  <span>Clock OCR ({caseData?.clock?.frames?.length || 100} ticks, drop inference)</span>
                </div>
                <span className="text-zinc-700 hidden sm:inline">•</span>
                <div className="flex items-center space-x-1 text-zinc-400 shrink-0">
                  <span className="text-emerald-400 font-medium">Muse Wonder:</span>
                  <span>Scene Reasoning & Fact Whitelist Validator (0 hallucinations)</span>
                </div>
                <span className="text-zinc-700 hidden sm:inline">•</span>
                <div className="flex items-center space-x-1 text-zinc-400 shrink-0">
                  <span className="text-violet-400 font-medium">Muse Voice:</span>
                  <span>Multilingual Statement Transcription ({caseData?.statements?.length || 2} audio streams)</span>
                </div>
              </div>

              <button
                onClick={() => setIsProcessingOpen(true)}
                className="hidden lg:flex items-center space-x-1 text-cyan-400 hover:text-cyan-300 hover:underline shrink-0 pl-3 active:scale-95 transition-all"
              >
                <Eye className="w-3 h-3" />
                <span>View Full Pipeline Run</span>
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Floating Modals */}
      <ProcessingModal
        isOpen={isProcessingOpen}
        onClose={() => setIsProcessingOpen(false)}
        caseId="carla_002"
        autoStart={false}
      />

      <NewCaseModal
        isOpen={isNewCaseOpen}
        onClose={() => setIsNewCaseOpen(false)}
        onCaseCreated={() => {
          setIsNewCaseOpen(false);
          setIsProcessingOpen(true);
        }}
      />

      <InvestigatorGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
      />
    </div>
  );
};

export default App;
