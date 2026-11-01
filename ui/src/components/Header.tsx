import React from 'react';
import { ShieldAlert, Video, Eye, FileText, Camera, BarChart3, Sliders, Plus, HelpCircle } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { ScenarioPicker } from './ScenarioPicker';

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
    <div className="flex flex-col border-b border-workspace-border select-none z-30">
      {/* Primary Top Bar */}
      <header className="h-13 bg-workspace-surface/95 backdrop-blur px-4 flex items-center justify-between gap-3">
        {/* Left: Branding & Camera Mode */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
            <span className="font-mono text-sm font-bold tracking-wider text-zinc-100">SAKSHI</span>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono hidden md:inline">
              FORENSICS
            </span>
          </div>

          <div className="h-4 w-[1px] bg-zinc-800 hidden sm:block" />

          {/* Camera Mode Badge */}
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-300">
            <Camera className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">
              {cameraMode === 'dashcam' ? 'DASHCAM EGO-MOTION' : 'FIXED CCTV JUNCTION'}
            </span>
            <span className="sm:hidden font-bold">
              {cameraMode === 'dashcam' ? 'DASH' : 'CCTV'}
            </span>
          </div>

          {/* Pre-rendered CARLA scenarios (shown only when they were exported) */}
          <ScenarioPicker />
        </div>

        {/* Center: The Dedicated View Tab Controller (Segmented & Isolated) */}
        <div className="flex-1 flex justify-center max-w-xl mx-2">
          <nav
            className="flex items-center p-0.5 rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-inner"
            role="tablist"
            aria-label="Workspace Views"
          >
            <button
              onClick={() => setActiveView('case')}
              role="tab"
              aria-selected={activeView === 'case'}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all active:scale-95 ${
                activeView === 'case'
                  ? 'bg-zinc-800 text-cyan-300 shadow-sm border border-zinc-700/80 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
              title="4-Panel Synchronized Kinematic Replay (Press 1)"
            >
              <Video className="w-3.5 h-3.5 text-cyan-400" />
              <span>Case View</span>
            </button>

            <button
              onClick={() => setActiveView('calibration')}
              role="tab"
              aria-selected={activeView === 'calibration'}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all active:scale-95 ${
                activeView === 'calibration'
                  ? 'bg-zinc-800 text-cyan-300 shadow-sm border border-zinc-700/80 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
              title="Camera Homography & Calibration (Press 4)"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Calibration</span>
            </button>

            <button
              onClick={() => setActiveView('report')}
              role="tab"
              aria-selected={activeView === 'report'}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all active:scale-95 ${
                activeView === 'report'
                  ? 'bg-zinc-800 text-cyan-300 shadow-sm border border-zinc-700/80 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
              title="Surveyor & Court Dossier (Press 2)"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Report</span>
              {caseData?.report?.validator?.passed && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
              )}
            </button>

            <button
              onClick={() => setActiveView('accuracy')}
              role="tab"
              aria-selected={activeView === 'accuracy'}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-medium transition-all active:scale-95 ${
                activeView === 'accuracy'
                  ? 'bg-zinc-800 text-cyan-300 shadow-sm border border-zinc-700/80 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
              }`}
              title="CARLA Benchmark Accuracy (Press 3)"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Accuracy</span>
            </button>
          </nav>
        </div>

        {/* Right: Actions (Guide, Evidence Feed, New Case) */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          {onOpenGuide && (
            <button
              onClick={onOpenGuide}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-amber-300 bg-amber-950/40 border border-amber-800/50 hover:bg-amber-900/40 transition-all active:scale-95"
              title="Open Quick-Start Guide (Shortcut: ?)"
            >
              <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Guide</span>
            </button>
          )}

          {onOpenProcessing && (
            <button
              onClick={onOpenProcessing}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded text-xs font-medium text-cyan-400 bg-cyan-950/40 border border-cyan-800/50 hover:bg-cyan-900/40 transition-all active:scale-95"
              title="View Live 11-Stage SSE Pipeline"
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

      {/* Secondary Forensic Strip: Legal Non-Liability Notice & Clip Telemetry */}
      <div className="h-6 px-4 bg-zinc-950 border-t border-zinc-800/60 flex items-center justify-between text-[11px] font-mono text-zinc-400">
        <div className="flex items-center space-x-2 overflow-hidden text-ellipsis whitespace-nowrap">
          <ShieldAlert className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-zinc-400">
            Forensic kinematics for expert review. Sakshi does not determine fault or legal liability.
          </span>
        </div>

        {caseData?.clip?.file && (
          <div className="hidden lg:flex items-center space-x-2 text-[10px] text-zinc-500 shrink-0 pl-3">
            <span>FILE: [{caseData.clip.file}]</span>
            <span>•</span>
            <span>{caseData.clip.frames} frames @ {caseData.clip.fps_nominal} fps</span>
            <span>•</span>
            <span>CALIB RMS: {caseData.calibration?.reproj_rms_m || 0.169}m</span>
          </div>
        )}
      </div>
    </div>
  );
};
