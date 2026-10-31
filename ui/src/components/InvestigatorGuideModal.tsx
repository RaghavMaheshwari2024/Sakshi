import React, { useState, useEffect } from 'react';
import {
  X,
  BookOpen,
  Video,
  Compass,
  Activity,
  CheckCircle2,
  ShieldCheck,
  Crosshair,
  ArrowRight,
} from 'lucide-react';

interface InvestigatorGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InvestigatorGuideModal: React.FC<InvestigatorGuideModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'workspace' | 'panels' | 'shortcuts' | 'statutory'>('workspace');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, dontShowAgain]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (dontShowAgain) {
      localStorage.setItem('sakshi_guide_seen', 'true');
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-zinc-100"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-cyan-950/60 border border-cyan-800/50 text-cyan-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-semibold text-zinc-100">Investigator Quick-Start Guide</h2>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/40">
                  SAKSHI v1.0
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Synchronized forensic kinematics suite for jurisdictional crash review
              </p>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-all active:scale-95"
            aria-label="Close Guide"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center px-6 border-b border-zinc-800/80 bg-zinc-950/90 text-xs font-mono shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('workspace')}
            className={`py-3 px-3 border-b-2 font-medium transition-all ${
              activeTab === 'workspace'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            1. Workspace Concept
          </button>
          <button
            onClick={() => setActiveTab('panels')}
            className={`py-3 px-3 border-b-2 font-medium transition-all ${
              activeTab === 'panels'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            2. The 4 Hero Panels
          </button>
          <button
            onClick={() => setActiveTab('shortcuts')}
            className={`py-3 px-3 border-b-2 font-medium transition-all ${
              activeTab === 'shortcuts'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            3. Keyboard & Controls
          </button>
          <button
            onClick={() => setActiveTab('statutory')}
            className={`py-3 px-3 border-b-2 font-medium transition-all ${
              activeTab === 'statutory'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            4. Statutory Non-Liability
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-zinc-300">
          {activeTab === 'workspace' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-2">
                <h3 className="font-semibold text-zinc-100 flex items-center space-x-2">
                  <span className="w-2 h-2 rounded-full bg-cyan-400" />
                  <span>One Synchronized Timeline Across All Four Panels</span>
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Sakshi replaces disconnected tools with a single, frame-synchronized forensic workspace.
                  Scrubbing the timeline, playing the video, clicking any speed curve, or selecting a witness statement
                  immediately updates every view in lockstep to that exact instant in time.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center space-x-2 text-cyan-400 font-mono text-xs font-semibold">
                    <Video className="w-4 h-4" />
                    <span>Dual Camera Modes</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Supports both <strong>Fixed CCTV Junctions</strong> (using ground photogrammetric homography) and{' '}
                    <strong>Dashcam Ego-Motion</strong> (where Sakshi separates host car velocity from target vehicle kinematics).
                  </p>
                </div>

                <div className="p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-800/80 space-y-1.5">
                  <div className="flex items-center space-x-2 text-amber-400 font-mono text-xs font-semibold">
                    <Activity className="w-4 h-4" />
                    <span>90% Confidence Intervals Everywhere</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    A bare speed number is never displayed. Every velocity, timestamp, and deceleration reading
                    features an explicit 90% confidence envelope derived via Monte Carlo Kalman smoothing.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-cyan-950/20 border border-cyan-800/40 flex items-start space-x-3">
                <Crosshair className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1 text-zinc-300">
                  <div className="font-semibold text-cyan-300 font-mono">The "Show Me" Principle</div>
                  <p className="text-zinc-400">
                    Whenever an eyewitness or driver claim is challenged, click the <strong>"Show Me"</strong> button.
                    The workspace instantly seeks to the contested moment and highlights the measurement interval on the speed chart.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'panels' && (
            <div className="space-y-3.5">
              <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-start space-x-3">
                <div className="p-2 rounded bg-cyan-950 border border-cyan-800/60 text-cyan-400 shrink-0">
                  <Video className="w-4 h-4" />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-zinc-100 font-mono">Panel 1: CCTV / Dashcam Footage</div>
                  <p className="text-zinc-400 leading-relaxed">
                    HTML5 video overlay synchronized with Meta <strong>SAM 3.1</strong> neural segmentation masks.
                    White crosshairs pin the ground tyre-contact patches. Click any car box directly on video to filter telemetry.
                    Toggle masks anytime with the <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono">M</kbd> key.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-start space-x-3">
                <div className="p-2 rounded bg-amber-950 border border-amber-800/60 text-amber-400 shrink-0">
                  <Compass className="w-4 h-4" />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-zinc-100 font-mono">Panel 2: 2D Orthographic Birds-Eye Replay</div>
                  <p className="text-zinc-400 leading-relaxed">
                    Metric ground plane reconstruction ($X, Y$ in meters) showing true vehicle dimensions, heading angles $\theta$,
                    stop lines, and collision coordinates (marked with $\times$). Switch between <strong>Road-Fixed</strong> and{' '}
                    <strong>Car-Centred</strong> modes.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-start space-x-3">
                <div className="p-2 rounded bg-emerald-950 border border-emerald-800/60 text-emerald-400 shrink-0">
                  <Activity className="w-4 h-4" />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-zinc-100 font-mono">Panel 3: Kinematic Telemetry & Uncertainty Band</div>
                  <p className="text-zinc-400 leading-relaxed">
                    Pure SVG speed profiles over time ($km/h$ vs $t$). Shaded ribbons illustrate 90% confidence bounds.
                    Features vertical dashed event markers for 💥 <strong>Impact</strong>, 🛑 <strong>Braking onset</strong>,
                    and 🚦 <strong>Traffic light phase changes</strong>. Drag anywhere on the chart to scrub time.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-lg bg-zinc-900/60 border border-zinc-800 flex items-start space-x-3">
                <div className="p-2 rounded bg-violet-950 border border-violet-800/60 text-violet-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="space-y-1 text-xs">
                  <div className="font-semibold text-zinc-100 font-mono">Panel 4: Forensic Statement Verification</div>
                  <p className="text-zinc-400 leading-relaxed">
                    Ingested driver and witness quotes (Hindi/English) evaluated strictly against kinematic measurements.
                    Outputs objective verdicts (<span className="text-emerald-400 font-semibold">CONSISTENT</span>,{' '}
                    <span className="text-rose-400 font-semibold">INCONSISTENT</span>,{' '}
                    <span className="text-zinc-400 font-semibold">CAN'T TELL</span>) with factual reasoning and "Show Me" navigation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-zinc-800 overflow-hidden">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Key / Shortcut</th>
                      <th className="py-2.5 px-4 font-semibold">Action</th>
                      <th className="py-2.5 px-4 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">Space / K</td>
                      <td className="py-2 px-4 text-zinc-200">Play / Pause</td>
                      <td className="py-2 px-4 text-zinc-400">Toggle playback across footage and 2D replay</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">← / →</td>
                      <td className="py-2 px-4 text-zinc-200">Single Frame Step</td>
                      <td className="py-2 px-4 text-zinc-400">Step ±1 frame (0.04s precision)</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">J / L</td>
                      <td className="py-2 px-4 text-zinc-200">Fast Shuttle</td>
                      <td className="py-2 px-4 text-zinc-400">Jump backwards / forwards 5 frames</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">M</td>
                      <td className="py-2 px-4 text-zinc-200">Toggle Masks</td>
                      <td className="py-2 px-4 text-zinc-400">Show or hide SAM 3.1 neural segmentation masks</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">1 / 2 / 3 / 4</td>
                      <td className="py-2 px-4 text-zinc-200">Switch Views</td>
                      <td className="py-2 px-4 text-zinc-400">1: Case Hero, 2: Report, 3: Accuracy, 4: Calibration</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">?</td>
                      <td className="py-2 px-4 text-zinc-200">Open Guide</td>
                      <td className="py-2 px-4 text-zinc-400">Reopen this quick-start reference at any time</td>
                    </tr>
                    <tr className="hover:bg-zinc-900/30">
                      <td className="py-2 px-4 text-cyan-400 font-bold">Esc</td>
                      <td className="py-2 px-4 text-zinc-200">Close / Return</td>
                      <td className="py-2 px-4 text-zinc-400">Dismiss open dialog or return to Case View</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'statutory' && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-amber-950/20 border border-amber-800/40 space-y-3">
                <div className="flex items-center space-x-2 text-amber-300 font-semibold font-mono text-xs">
                  <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
                  <span>Statutory Boundary & Non-Liability Notice</span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Sakshi is strictly a <strong>scientific kinematic measurement and timeline reconstruction instrument</strong>.
                  It computes velocities, decelerations, homography reprojection, and statement consistency intervals to support
                  qualified accident reconstructionists, surveyors, and courts of law.
                </p>
                <div className="text-xs text-amber-200/90 font-mono bg-amber-950/40 p-2.5 rounded border border-amber-800/40">
                  "Forensic telemetry and kinematic measurements to support expert review. Sakshi does not determine fault or legal liability."
                </div>
              </div>

              <div className="space-y-2 text-xs text-zinc-400">
                <div className="font-semibold text-zinc-200">Domain Boundaries:</div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Sakshi does <strong>not</strong> assign legal liability, fault, blame, or moral guilt.</li>
                  <li>All models run in deterministic or factually validated mode with zero unsupported hallucinated figures.</li>
                  <li>Statements are classified purely as <em>Consistent</em>, <em>Inconsistent</em>, or <em>Can't Tell</em> based on physical evidence.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between shrink-0">
          <label className="flex items-center space-x-2 cursor-pointer select-none text-xs text-zinc-400 hover:text-zinc-200">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
            />
            <span>Don't show automatically on startup</span>
          </label>

          <button
            onClick={handleDismiss}
            className="px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-cyan-400 hover:bg-cyan-300 text-zinc-950 shadow-md transition-all active:scale-95 flex items-center space-x-1.5"
          >
            <span>Enter Investigation Suite</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
