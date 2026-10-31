import React from 'react';
import { ShieldAlert, Video, Eye, FileText, Camera, BarChart3, Sliders, Plus, HelpCircle } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';

export type ActiveView = 'case' | 'report' | 'accuracy' | 'calibration';

interface HeaderProps {
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  onOpenProcessing?: () => void;
  onOpenNewCase?: () => void;
  onOpenGuide?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  setActiveView,
  onOpenProcessing,
  onOpenNewCase,
  onOpenGuide,
}) => {
  const { caseData } = useCaseStore();
  const cameraMode = caseData?.camera_mode || 'fixed';

  return (
    <header className="h-14 border-b border-workspace-border bg-workspace-surface/90 backdrop-blur px-4 flex items-center justify-between z-30 select-none">
      {/* Left: Branding & Case Status */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <span className="font-mono text-sm font-bold tracking-wider text-zinc-100">SAKSHI</span>
          <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono hidden sm:inline">CRASH FORENSICS</span>
        </div>

        <div className="h-4 w-[1px] bg-zinc-800" />

        {/* Camera Mode Badge */}
        <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300">
          <Camera className="w-3 h-3 text-cyan-400" />
          <span>{cameraMode === 'dashcam' ? 'DASHCAM EGO-MOTION' : 'FIXED CCTV JUNCTION'}</span>
        </div>

        {caseData?.clip?.file && (
          <span className="text-xs text-zinc-400 font-mono hidden xl:inline">
            [{caseData.clip.file}] • {caseData.clip.frames} frames @ {caseData.clip.fps_nominal} fps
          </span>
        )}
      </div>

      {/* Middle: Prominent Statutory Legal Disclaimer */}
      <div className="hidden lg:flex items-center space-x-2 px-3 py-1 rounded-md bg-zinc-900/60 border border-zinc-800/80">
        <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-[11px] text-zinc-400 font-medium">
          Forensic measurement tool for expert review. Sakshi does not determine fault or liability.
        </span>
      </div>

      {/* Right: View Switchers & Actions */}
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        <button
          onClick={() => setActiveView('case')}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
            activeView === 'case'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
          }`}
          title="Case 4-Panel Hero View"
        >
          <Video className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Case View</span>
        </button>

        <button
          onClick={() => setActiveView('calibration')}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
            activeView === 'calibration'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
          }`}
          title="Camera & Ground Calibration"
        >
          <Sliders className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Calibration</span>
        </button>

        <button
          onClick={() => setActiveView('report')}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
            activeView === 'report'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
          }`}
          title="Printable Surveyor & Court Dossier"
        >
          <FileText className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Report</span>
          {caseData?.report?.validator?.passed && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
          )}
        </button>

        <button
          onClick={() => setActiveView('accuracy')}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
            activeView === 'accuracy'
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/50'
          }`}
          title="CARLA Benchmark & Clock Ablation Verification"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Accuracy</span>
        </button>

        <div className="h-4 w-[1px] bg-zinc-800 mx-1 hidden sm:block" />

        {onOpenGuide && (
          <button
            onClick={onOpenGuide}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/40 transition-all active:scale-95"
            title="Open Investigator Guide (or press ?)"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Guide</span>
          </button>
        )}

        {onOpenProcessing && (
          <button
            onClick={onOpenProcessing}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-cyan-400 bg-cyan-950/40 border border-cyan-800/50 hover:bg-cyan-900/40 transition-all active:scale-95"
            title="Open Live SSE Pipeline & Model Attribution Feed"
          >
            <Eye className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Evidence Feed</span>
          </button>
        )}

        {onOpenNewCase && (
          <button
            onClick={onOpenNewCase}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-all active:scale-95"
            title="Upload New Crash Footage"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden md:inline">New Case</span>
          </button>
        )}
      </div>
    </header>
  );
};
