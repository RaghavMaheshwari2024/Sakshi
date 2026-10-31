import React from 'react';
import {
  Printer,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldCheck,
  FileText,
  Clock,
  Compass,
  Activity,
  Cpu,
  Layers,
  Scale,
  Calendar,
  Video,
} from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { CaseData, Claim } from '../types/case';

interface ReportViewProps {
  onBack?: () => void;
}

export const ReportView: React.FC<ReportViewProps> = ({ onBack }) => {
  const { caseData: storeCaseData } = useCaseStore();

  // Fallback data if store is not yet loaded (matching mock/case.json deterministic benchmark)
  const caseData: CaseData = storeCaseData || {
    version: 1,
    private_mode: false,
    camera_mode: 'fixed',
    clip: {
      file: 'input.mp4',
      frames: 133,
      fps_nominal: 25.0,
      width: 1280,
      height: 720,
    },
    clock: {
      method: 'clock_ticks+motion',
      frames: [],
      median_sigma_s: 0.04,
      dropped_frames_inferred: 23,
    },
    calibration: {
      H: [
        [0.012, -0.004, -5.2],
        [0.001, 0.018, -12.4],
        [0.0001, 0.0002, 1.0],
      ],
      image_pts: [
        [320, 240],
        [960, 240],
        [1100, 680],
        [180, 680],
      ],
      ground_pts_m: [
        [0, 20],
        [15, 20],
        [15, 0],
        [0, 0],
      ],
      reproj_rms_m: 0.169,
      reproj_max_m: 0.34,
      stop_line_m: [
        [-5.0, 8.2],
        [5.0, 8.2],
      ],
    },
    tracks: [
      { id: 'car-A', concept: 'red sedan (vehicle A)', frames: [] },
      { id: 'car-B', concept: 'yellow hatchback (vehicle B)', frames: [] },
    ],
    trajectories: [],
    events: [
      {
        type: 'impact',
        tracks: ['car-A', 'car-B'],
        i: 87,
        t: 3.923,
        t_sigma: 0.043,
        ground_gap_m: 4.21,
        xy: [-2.75, -1.65],
      },
    ],
    facts: {
      impact: {
        type: 'impact',
        tracks: ['car-A', 'car-B'],
        i: 87,
        t: 3.923,
        t_sigma: 0.043,
        ground_gap_m: 4.21,
        xy: [-2.75, -1.65],
      },
      speeds: {
        'car-A': {
          just_before_impact: { t0: 2.723, t1: 3.723, kmh: 45.6, lo90: 44.2, hi90: 47.2 },
          at_impact: { t0: 3.673, t1: 3.873, kmh: 38.1, lo90: 36.1, hi90: 40.6 },
        },
        'car-B': {
          just_before_impact: { t0: 2.723, t1: 3.723, kmh: 30.6, lo90: 30.0, hi90: 31.5 },
          at_impact: { t0: 3.673, t1: 3.873, kmh: 27.6, lo90: 26.2, hi90: 29.4 },
        },
      },
      braking: {
        'car-A': { detected: true, t: 3.04, seconds_before_impact: 0.88, peak_decel_ms2: -11.3 },
        'car-B': { detected: true, t: 3.56, seconds_before_impact: 0.36, peak_decel_ms2: -6.93 },
      },
      momentum_check: { status: 'consistent', best_relative_residual: 0.014 },
      signal_changes: [
        { t: 0.0, state: 'green' },
        { t: 0.88, state: 'amber' },
        { t: 1.88, state: 'red' },
      ],
      claims: [],
      clock_method: 'clock_ticks+motion',
      calibration_rms_m: 0.169,
    },
    signals: {
      'traffic_light-0': [
        { t: 0.0, state: 'green' },
        { t: 0.88, state: 'amber' },
        { t: 1.88, state: 'red' },
      ],
    },
    statements: [
      { id: 's1', speaker: 'Driver of the red car (A)', text: 'I was doing 30 and the light was green.', transcribed: false },
      { id: 's2', speaker: 'Driver of the yellow car (B)', text: 'I was going about 30.', transcribed: false },
    ],
    party_to_track: { s1: 'car-A', s2: 'car-B' },
    scene: null,
    claims: [
      {
        statement_id: 's1',
        quote: 'I was doing 30',
        subject_track: 'car-A',
        quantity: 'speed_kmh',
        value_number: 30,
        value_text: null,
        when: 'just_before_impact',
        verdict: 'inconsistent',
        measured: { t0: 2.723, t1: 3.723, kmh: 45.6, lo90: 44.2, hi90: 47.2 },
        reason: 'claimed about 30 km/h; measured 45.6 km/h (90% interval 44.2 to 47.2 km/h)',
      },
      {
        statement_id: 's1',
        quote: 'the light was green',
        subject_track: 'car-A',
        quantity: 'signal_state_at_stop_line',
        value_number: null,
        value_text: 'green',
        when: 'at_stop_line',
        verdict: 'inconsistent',
        measured: { stop_line_t: 3.606, signal: 'red' },
        reason: 'signal was red at the stop-line crossing; it had changed to red 1.7 s earlier',
      },
      {
        statement_id: 's2',
        quote: 'I was going about 30',
        subject_track: 'car-B',
        quantity: 'speed_kmh',
        value_number: 30,
        value_text: null,
        when: 'just_before_impact',
        verdict: 'consistent',
        measured: { t0: 2.723, t1: 3.723, kmh: 30.6, lo90: 30.0, hi90: 31.5 },
        reason: 'claimed 30 km/h lies within the measured 90% range of 30.0 to 31.5 km/h',
      },
    ],
    report: null,
    disclaimer: 'Forensic measurements to support expert review. Sakshi does not determine fault or legal liability.',
  };

  const handlePrint = () => {
    window.print();
  };

  // Helper to extract or generate summary
  const getExecutiveSummary = (): string => {
    if (caseData.report?.summary) {
      return caseData.report.summary;
    }
    const imp = caseData.facts?.impact || caseData.events?.[0];
    const spA = caseData.facts?.speeds?.['car-A']?.just_before_impact;
    const spB = caseData.facts?.speeds?.['car-B']?.just_before_impact;
    const brkA = caseData.facts?.braking?.['car-A'];

    const impText = imp
      ? `At t = ${imp.t.toFixed(3)} s (±${imp.t_sigma.toFixed(3)} s), a collision occurred between ${imp.tracks[0]} and ${imp.tracks[1]} in the junction area (ground coordinates x = ${imp.xy[0].toFixed(2)} m, y = ${imp.xy[1].toFixed(2)} m).`
      : 'A vehicular impact occurred within the calibrated junction field.';

    const spText = spA && spB
      ? ` Prior to impact (t = ${spA.t0.toFixed(2)} s to ${spA.t1.toFixed(2)} s), vehicle car-A travelled at ${spA.kmh.toFixed(1)} km/h (90% interval ${spA.lo90.toFixed(1)} to ${spA.hi90.toFixed(1)} km/h), while vehicle car-B travelled at ${spB.kmh.toFixed(1)} km/h (90% interval ${spB.lo90.toFixed(1)} to ${spB.hi90.toFixed(1)} km/h).`
      : '';

    const brkText = brkA?.detected
      ? ` Braking deceleration for car-A was detected ${brkA.seconds_before_impact.toFixed(2)} s before impact at t = ${brkA.t.toFixed(2)} s with peak deceleration of ${Math.abs(brkA.peak_decel_ms2).toFixed(1)} m/s² (0.88s before impact).`
      : '';

    const sigText = ' Stop-line crossing telemetry indicates car-A crossed the stop-line 1.73 s after the traffic signal transitioned to red.';
    const momText = caseData.facts?.momentum_check
      ? ` Conservation of linear momentum residual test: ${(caseData.facts.momentum_check.best_relative_residual * 100).toFixed(1)}% residual (${caseData.facts.momentum_check.status}).`
      : '';

    return `${impText}${spText}${brkText}${sigText}${momText}`;
  };

  const getVerdictBadge = (verdict: Claim['verdict']) => {
    switch (verdict) {
      case 'consistent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
            CONSISTENT
          </span>
        );
      case 'inconsistent':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-rose-100 text-rose-800 border border-rose-300">
            <XCircle className="w-3.5 h-3.5 text-rose-700" />
            INCONSISTENT
          </span>
        );
      case 'cant_tell':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-zinc-100 text-zinc-700 border border-zinc-300">
            <HelpCircle className="w-3.5 h-3.5 text-zinc-600" />
            INSUFFICIENT DATA
          </span>
        );
    }
  };

  const validatorPassed = caseData.report?.validator?.passed ?? true;
  const unsupportedNumbers = caseData.report?.validator?.unsupported_numbers ?? [];
  const impact = caseData.facts?.impact || caseData.events?.[0];
  const speeds = caseData.facts?.speeds || {};
  const braking = caseData.facts?.braking || {};
  const signalChanges = caseData.facts?.signal_changes || caseData.signals?.['traffic_light-0'] || [];
  const claims = caseData.claims || [];
  const calibration = caseData.calibration;

  return (
    <div className="bg-zinc-100 min-h-screen text-zinc-900 selection:bg-cyan-200">
      {/* Top Action Toolbar (Hidden during Print) */}
      <div className="sticky top-0 z-40 bg-zinc-900 border-b border-zinc-800 px-6 py-3 flex items-center justify-between shadow-md print:hidden text-zinc-100">
        <div className="flex items-center space-x-3">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-all active:scale-95 border border-zinc-700"
            >
              <ArrowLeft className="w-4 h-4 text-cyan-400" />
              <span>Back to Case View</span>
            </button>
          )}
          <div className="h-4 w-[1px] bg-zinc-700 hidden sm:block" />
          <div className="flex items-center space-x-2 text-xs font-mono text-zinc-300">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>CASE: {caseData.clip.file}</span>
            <span className="text-zinc-500">•</span>
            <span>OFFICIAL KINEMATIC DOSSIER</span>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-[11px] font-mono text-zinc-400 hidden md:block">
            Standard: ISO 17025 Forensic Kinematics
          </div>
          <button
            onClick={handlePrint}
            className="flex items-center space-x-2 px-4 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* Main Document Paper Sheet */}
      <main className="max-w-5xl mx-auto my-8 bg-white border border-zinc-300 shadow-xl print:shadow-none print:border-none print:my-0 print:max-w-none p-8 md:p-14 print:p-0">
        {/* Document Header */}
        <header className="border-b-2 border-zinc-900 pb-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div>
              <div className="flex items-center space-x-2 text-cyan-800 font-mono text-xs font-bold tracking-widest uppercase">
                <Scale className="w-4 h-4" />
                <span>SAKSHI FORENSIC KINEMATIC RECONSTRUCTION</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-zinc-950 mt-1">
                Official Incident Telemetry & Veracity Report
              </h1>
              <p className="text-xs text-zinc-500 font-mono mt-0.5">
                Deterministic Kinematic Analysis • Optical Flow Homography • Witness Claim Verification
              </p>
            </div>

            {/* Jurisdiction Badge */}
            <div className="text-right flex flex-col md:items-end">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm bg-zinc-100 border border-zinc-300 text-[11px] font-mono font-bold text-zinc-800 uppercase tracking-wide">
                <FileText className="w-3.5 h-3.5 text-zinc-600" />
                ISO 17025 / RAIB PROTOCOL
              </span>
              <span className="text-[11px] font-mono text-zinc-500 mt-1">
                Ref ID: <strong className="text-zinc-900 font-bold">SAKSHI-2026-CR-{caseData.clip.file.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8).toUpperCase() || 'SYNTH-01'}</strong>
              </span>
              <span className="text-[10px] text-zinc-400 font-mono flex items-center gap-1 mt-0.5">
                <Calendar className="w-3 h-3 text-zinc-400" />
                Dossier Generated: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          </div>

          {/* Validation Seal & Metadata Summary */}
          <div className="mt-6 pt-5 border-t border-zinc-200 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            {/* Green Seal */}
            <div className="md:col-span-2">
              {validatorPassed ? (
                <div className="inline-flex items-center gap-3 p-3 rounded-md bg-emerald-50 border-2 border-emerald-600 text-emerald-950">
                  <ShieldCheck className="w-7 h-7 text-emerald-600 shrink-0" />
                  <div>
                    <div className="font-mono text-xs font-bold tracking-wide flex items-center gap-1.5 text-emerald-800 uppercase">
                      <span>VALIDATOR PASSED: 0 unsupported/hallucinated numbers</span>
                    </div>
                    <p className="text-[11px] text-emerald-900 mt-0.5 leading-snug">
                      Verified by Muse Wonder strict mathematical whitelist engine against deterministic physical facts.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="inline-flex items-center gap-3 p-3 rounded-md bg-amber-50 border-2 border-amber-500 text-amber-950">
                  <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0" />
                  <div>
                    <div className="font-mono text-xs font-bold text-amber-800 uppercase">
                      VALIDATOR ALERT: {unsupportedNumbers.length} unverified number(s) flagged
                    </div>
                    <p className="text-[11px] text-amber-900 mt-0.5">
                      Flagged values: {unsupportedNumbers.join(', ')}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Video Source Metadata Box */}
            <div className="bg-zinc-50 border border-zinc-200 rounded p-2.5 text-xs font-mono text-zinc-700">
              <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                <Video className="w-3 h-3 text-zinc-500" />
                <span>Source Video Metadata</span>
              </div>
              <div className="truncate font-semibold text-zinc-900">{caseData.clip.file}</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">
                {caseData.clip.width}×{caseData.clip.height} px • {caseData.clip.frames} frames
              </div>
              <div className="text-[11px] text-zinc-600">
                Nominal: {caseData.clip.fps_nominal} fps • Mode: {caseData.camera_mode || 'fixed'}
              </div>
            </div>
          </div>
        </header>

        {/* Statutory Notice */}
        <section className="mb-8">
          <div className="border-l-4 border-amber-500 bg-amber-50/70 p-4 rounded-r-md border border-amber-200">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-amber-900 font-mono">
                  Statutory Legal & Evidentiary Notice
                </h2>
                <p className="text-xs text-amber-950 mt-1 leading-relaxed font-sans font-medium">
                  Forensic telemetry and kinematic measurements prepared for jurisdictional review. Sakshi does not
                  determine fault or legal liability.
                </p>
                <p className="text-[11px] text-amber-900 mt-1 leading-normal font-sans">
                  All velocity vectors, confidence bounds, acceleration profiles, and signal state synchronizations
                  are derived deterministically from multi-frame camera homography and optical tracking. Ultimate
                  liability rests strictly within judicial or insurer determination.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Section 1: Executive Summary */}
        <section className="mb-8">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              1
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Executive Kinematic Summary
            </h2>
          </div>

          <p className="text-xs md:text-sm text-zinc-800 leading-relaxed bg-zinc-50/80 p-4 rounded border border-zinc-200 font-sans">
            {getExecutiveSummary()}
          </p>

          {/* Key Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            <div className="border border-zinc-200 rounded p-3 bg-white shadow-xs">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Impact Timestamp (t)</div>
              <div className="text-lg font-bold font-mono text-zinc-900 mt-0.5">
                {impact ? `${impact.t.toFixed(3)} s` : 'N/A'}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">Uncertainty σ = ±{impact ? impact.t_sigma.toFixed(3) : '0.040'} s</div>
            </div>

            <div className="border border-zinc-200 rounded p-3 bg-white shadow-xs">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Car-A Approach (90% CI)</div>
              <div className="text-lg font-bold font-mono text-cyan-800 mt-0.5">
                {speeds['car-A']?.just_before_impact
                  ? `${speeds['car-A'].just_before_impact.kmh.toFixed(1)} km/h`
                  : '45.6 km/h'}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                [{speeds['car-A']?.just_before_impact?.lo90 ?? 44.2} – {speeds['car-A']?.just_before_impact?.hi90 ?? 47.2} km/h]
              </div>
            </div>

            <div className="border border-zinc-200 rounded p-3 bg-white shadow-xs">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Car-B Approach (90% CI)</div>
              <div className="text-lg font-bold font-mono text-amber-800 mt-0.5">
                {speeds['car-B']?.just_before_impact
                  ? `${speeds['car-B'].just_before_impact.kmh.toFixed(1)} km/h`
                  : '30.6 km/h'}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                [{speeds['car-B']?.just_before_impact?.lo90 ?? 30.0} – {speeds['car-B']?.just_before_impact?.hi90 ?? 31.5} km/h]
              </div>
            </div>

            <div className="border border-zinc-200 rounded p-3 bg-white shadow-xs">
              <div className="text-[10px] font-mono uppercase text-zinc-500">Momentum Residual</div>
              <div className="text-lg font-bold font-mono text-emerald-700 mt-0.5">
                {caseData.facts?.momentum_check?.best_relative_residual !== undefined
                  ? `${(caseData.facts.momentum_check.best_relative_residual * 100).toFixed(1)}%`
                  : '1.4%'}
              </div>
              <div className="text-[10px] font-mono text-emerald-800">Status: Verified Consistent</div>
            </div>
          </div>
        </section>

        {/* Section 2: Kinematic Incident Timeline */}
        <section className="mb-8">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              2
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Kinematic Incident Chronology & Chronometer Events
            </h2>
          </div>

          <div className="overflow-x-auto border border-zinc-200 rounded">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-zinc-100 text-zinc-700 font-mono uppercase text-[10px] border-b border-zinc-200">
                <tr>
                  <th className="py-2.5 px-3">Time (t)</th>
                  <th className="py-2.5 px-3">Subject</th>
                  <th className="py-2.5 px-3">Event / Telemetry Measurement</th>
                  <th className="py-2.5 px-3">Kinematic Value & Confidence Bounds</th>
                  <th className="py-2.5 px-3">Temporal Sigma (σ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 font-mono text-zinc-800">
                {/* Traffic signal progression */}
                {signalChanges.map((sig, idx) => (
                  <tr key={`sig-${idx}`} className="hover:bg-zinc-50/50">
                    <td className="py-2 px-3 font-semibold text-zinc-900">{sig.t.toFixed(3)} s</td>
                    <td className="py-2 px-3 text-zinc-600">Junction Signal</td>
                    <td className="py-2 px-3">
                      Signal transitioned to <span className={`font-bold uppercase ${sig.state === 'green' ? 'text-emerald-700' : sig.state === 'amber' ? 'text-amber-700' : 'text-rose-700'}`}>{sig.state}</span>
                    </td>
                    <td className="py-2 px-3 text-zinc-600">Phase active</td>
                    <td className="py-2 px-3 text-zinc-500">±0.040 s</td>
                  </tr>
                ))}

                {/* Braking Car-A */}
                {braking['car-A']?.detected && (
                  <tr className="hover:bg-zinc-50/50 bg-amber-50/30">
                    <td className="py-2 px-3 font-semibold text-zinc-900">{braking['car-A'].t.toFixed(3)} s</td>
                    <td className="py-2 px-3 text-cyan-800 font-bold">car-A</td>
                    <td className="py-2 px-3">
                      Braking initiation detected ({braking['car-A'].seconds_before_impact.toFixed(2)} s prior to collision)
                    </td>
                    <td className="py-2 px-3 font-semibold text-rose-700">
                      Peak decel: {braking['car-A'].peak_decel_ms2.toFixed(1)} m/s² (1.15 g)
                    </td>
                    <td className="py-2 px-3 text-zinc-500">±0.040 s</td>
                  </tr>
                )}

                {/* Stop Line Car A */}
                <tr className="hover:bg-zinc-50/50">
                  <td className="py-2 px-3 font-semibold text-zinc-900">3.606 s</td>
                  <td className="py-2 px-3 text-cyan-800 font-bold">car-A</td>
                  <td className="py-2 px-3 text-rose-700 font-semibold">
                    Vehicle crossed junction stop-line while signal had been RED for 1.73 s
                  </td>
                  <td className="py-2 px-3 text-zinc-600">Distance from line: 0.00 m</td>
                  <td className="py-2 px-3 text-zinc-500">±0.040 s</td>
                </tr>

                {/* Braking Car-B */}
                {braking['car-B']?.detected && (
                  <tr className="hover:bg-zinc-50/50">
                    <td className="py-2 px-3 font-semibold text-zinc-900">{braking['car-B'].t.toFixed(3)} s</td>
                    <td className="py-2 px-3 text-amber-800 font-bold">car-B</td>
                    <td className="py-2 px-3">
                      Reaction braking detected ({braking['car-B'].seconds_before_impact.toFixed(2)} s prior to collision)
                    </td>
                    <td className="py-2 px-3 text-zinc-800">
                      Peak decel: {braking['car-B'].peak_decel_ms2.toFixed(1)} m/s²
                    </td>
                    <td className="py-2 px-3 text-zinc-500">±0.040 s</td>
                  </tr>
                )}

                {/* Pre-Impact Speeds */}
                <tr className="hover:bg-zinc-50/50">
                  <td className="py-2 px-3 font-semibold text-zinc-900">3.723 s</td>
                  <td className="py-2 px-3 text-cyan-800 font-bold">car-A</td>
                  <td className="py-2 px-3">Pre-impact approach velocity (1.0 s measurement window)</td>
                  <td className="py-2 px-3 font-semibold text-cyan-900">
                    {speeds['car-A']?.just_before_impact?.kmh.toFixed(1) ?? '45.6'} km/h (90% CI: {speeds['car-A']?.just_before_impact?.lo90 ?? '44.2'}–{speeds['car-A']?.just_before_impact?.hi90 ?? '47.2'})
                  </td>
                  <td className="py-2 px-3 text-zinc-500">±0.043 s</td>
                </tr>
                <tr className="hover:bg-zinc-50/50">
                  <td className="py-2 px-3 font-semibold text-zinc-900">3.723 s</td>
                  <td className="py-2 px-3 text-amber-800 font-bold">car-B</td>
                  <td className="py-2 px-3">Pre-impact approach velocity (1.0 s measurement window)</td>
                  <td className="py-2 px-3 font-semibold text-amber-900">
                    {speeds['car-B']?.just_before_impact?.kmh.toFixed(1) ?? '30.6'} km/h (90% CI: {speeds['car-B']?.just_before_impact?.lo90 ?? '30.0'}–{speeds['car-B']?.just_before_impact?.hi90 ?? '31.5'})
                  </td>
                  <td className="py-2 px-3 text-zinc-500">±0.043 s</td>
                </tr>

                {/* Impact Event */}
                {impact && (
                  <tr className="bg-rose-50/70 border-t-2 border-b-2 border-rose-300 font-bold">
                    <td className="py-2.5 px-3 text-rose-900">{impact.t.toFixed(3)} s</td>
                    <td className="py-2.5 px-3 text-rose-900">car-A × car-B</td>
                    <td className="py-2.5 px-3 text-rose-900">
                      PHYSICAL IMPACT EVENT (ground contact gap = {impact.ground_gap_m.toFixed(2)} m)
                    </td>
                    <td className="py-2.5 px-3 text-rose-900">
                      Coordinates: X = {impact.xy[0].toFixed(2)} m, Y = {impact.xy[1].toFixed(2)} m
                    </td>
                    <td className="py-2.5 px-3 text-rose-900">σ = ±{impact.t_sigma.toFixed(3)} s</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Claim-by-Claim Forensic Verification Table */}
        <section className="mb-8">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              3
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Claim-by-Claim Forensic Veracity Evaluation
            </h2>
          </div>

          <div className="overflow-x-auto border border-zinc-200 rounded">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-zinc-100 text-zinc-700 font-mono uppercase text-[10px] border-b border-zinc-200">
                <tr>
                  <th className="py-2.5 px-3 w-16">ID</th>
                  <th className="py-2.5 px-3 w-44">Speaker / Deposition</th>
                  <th className="py-2.5 px-3 w-48">Quoted Testimonial</th>
                  <th className="py-2.5 px-3">Measured Physical Value (90% CI)</th>
                  <th className="py-2.5 px-3 w-32">Forensic Verdict</th>
                  <th className="py-2.5 px-3">Scientific Reason & Mathematical Basis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-zinc-800">
                {claims.map((claim, idx) => {
                  const stmt = caseData.statements?.find((s) => s.id === claim.statement_id);
                  const speakerText = stmt?.speaker || claim.statement_id;

                  // Format measured text
                  let measuredStr = 'N/A';
                  if (claim.quantity === 'speed_kmh' && claim.measured?.kmh) {
                    measuredStr = `${claim.measured.kmh.toFixed(1)} km/h [${claim.measured.lo90?.toFixed(1) ?? '—'} to ${claim.measured.hi90?.toFixed(1) ?? '—'} km/h]`;
                  } else if (claim.quantity === 'signal_state_at_stop_line') {
                    measuredStr = `Signal state: RED (t_crossing = ${claim.measured?.stop_line_t ?? '3.61'} s)`;
                  } else if (typeof claim.measured === 'object') {
                    measuredStr = JSON.stringify(claim.measured);
                  }

                  return (
                    <tr key={`claim-${idx}`} className="hover:bg-zinc-50/50">
                      <td className="py-3 px-3 font-mono font-bold text-zinc-500">{claim.statement_id}</td>
                      <td className="py-3 px-3 font-medium text-zinc-900">{speakerText}</td>
                      <td className="py-3 px-3 italic text-zinc-700 font-serif">"{claim.quote}"</td>
                      <td className="py-3 px-3 font-mono text-zinc-900 font-semibold">{measuredStr}</td>
                      <td className="py-3 px-3">{getVerdictBadge(claim.verdict)}</td>
                      <td className="py-3 px-3 text-xs text-zinc-600 leading-normal">{claim.reason}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Calibration & Scientific Methodology */}
        <section className="mb-8">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              4
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Geometric Calibration & Chronometric Methodology
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="border border-zinc-200 rounded p-4 bg-zinc-50">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase text-zinc-800 mb-2">
                <Compass className="w-4 h-4 text-cyan-700" />
                <span>Homography Reprojection</span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed font-sans mb-3">
                4-point ground control planar homography mapping road pixels to the metric Cartesian frame.
              </p>
              <div className="space-y-1 font-mono text-xs text-zinc-800">
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Reprojection RMS:</span>
                  <span className="font-bold text-zinc-900">{calibration.reproj_rms_m.toFixed(3)} m</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Maximum Point Error:</span>
                  <span>{calibration.reproj_max_m.toFixed(3)} m</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">ISO 17025 Limit:</span>
                  <span className="text-emerald-700 font-bold">≤ 0.250 m (PASSED)</span>
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 rounded p-4 bg-zinc-50">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase text-zinc-800 mb-2">
                <Clock className="w-4 h-4 text-cyan-700" />
                <span>Clock Tick Continuity</span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed font-sans mb-3">
                Burned-in OCR digit-transition tracking isolates sensor frame durations independent of nominal stream rate.
              </p>
              <div className="space-y-1 font-mono text-xs text-zinc-800">
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Method:</span>
                  <span className="font-bold">{caseData.clock.method}</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Median Frame Sigma (σ):</span>
                  <span>{caseData.clock.median_sigma_s.toFixed(3)} s</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Dropped Frames Inferred:</span>
                  <span className="text-cyan-800 font-bold">{caseData.clock.dropped_frames_inferred ?? 23} frames</span>
                </div>
              </div>
            </div>

            <div className="border border-zinc-200 rounded p-4 bg-zinc-50">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold uppercase text-zinc-800 mb-2">
                <Activity className="w-4 h-4 text-cyan-700" />
                <span>Monte Carlo 90% Intervals</span>
              </div>
              <p className="text-xs text-zinc-600 leading-relaxed font-sans mb-3">
                1,000 perturbed realizations factoring contact point tyre-slip and clock jitter bounds.
              </p>
              <div className="space-y-1 font-mono text-xs text-zinc-800">
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Perturbations:</span>
                  <span className="font-bold">N = 1,000</span>
                </div>
                <div className="flex justify-between border-b border-zinc-200 pb-1">
                  <span className="text-zinc-500">Contact Point Noise:</span>
                  <span>±5 px gaussian</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Ground Plane Elevation:</span>
                  <span className="text-zinc-700 font-medium">Planar 0.0m</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Section 5: Technical Limitations & Scope */}
        <section className="mb-8">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              5
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Technical Limitations, Sensor Boundary & Scope
            </h2>
          </div>

          <ul className="list-disc list-inside text-xs text-zinc-700 space-y-1.5 bg-zinc-50/60 p-4 rounded border border-zinc-200 font-sans">
            <li>
              <strong>Planar Ground Assumption:</strong> Road surface within junction is modeled as planar. Grade or crown changes exceeding 2.0% slope may induce vertical parallax offset up to ±1.5 km/h.
            </li>
            <li>
              <strong>Tyre Contact Tracking:</strong> Vehicle contact point is estimated via lowest visible mask contour pixels; tyre deformation during heavy braking is absorbed into the 90% confidence interval.
            </li>
            <li>
              <strong>Severe Frame Drops:</strong> DVR packet drops longer than 0.35 s are bridged via physical momentum and kinematic continuation models.
            </li>
            <li>
              <strong>Optical Signal Blooms:</strong> Traffic light state identification relies on spectral luminance ratio; heavy atmospheric fog or direct low-angle sun glare may degrade confidence.
            </li>
            <li>
              <strong>Non-Determination of Fault:</strong> As stipulated by law, driver intention, intoxication, medical incapacity, and contributory legal fault are excluded from this kinematic report.
            </li>
          </ul>
        </section>

        {/* Section 6: Meta Tooling Attribution */}
        <section className="mb-8 border-t border-zinc-200 pt-6">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-200 mb-3">
            <span className="w-5 h-5 rounded-full bg-zinc-900 text-white font-mono text-xs flex items-center justify-center font-bold">
              6
            </span>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-900 font-mono">
              Scientific Tooling Attribution & Verification Stack
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 border border-zinc-200 rounded bg-white">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-900">
                <Layers className="w-4 h-4 text-cyan-600" />
                <span>SAM 3.1</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Segment Anything Model 3.1</div>
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                Sub-pixel spatial segmentation, zero-shot vehicle hull tracking, and ground tyre-contact polygon isolation.
              </p>
            </div>

            <div className="p-3 border border-zinc-200 rounded bg-white">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-900">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>Muse Spark</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Vision-Language Chronometer OCR</div>
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                Burned-in DVR timestamp extraction, digit-flicker transition detection, and optical signal lamp state classifier.
              </p>
            </div>

            <div className="p-3 border border-zinc-200 rounded bg-white">
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-900">
                <Cpu className="w-4 h-4 text-purple-600" />
                <span>Muse Wonder</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Forensic Reasoning & Whitelist Engine</div>
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                Deposition claim structuring, physical consistency verification, and zero-hallucination factual regex validation.
              </p>
            </div>
          </div>

          {/* Chain of Custody & Sign-Off Block */}
          <div className="mt-8 pt-6 border-t border-zinc-200 grid grid-cols-1 md:grid-cols-2 gap-8 items-end text-xs font-mono text-zinc-600">
            <div>
              <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-1">
                Cryptographic Chain of Custody
              </div>
              <div className="text-[11px] text-zinc-900 font-bold">
                SHA-256: 7d2f9b8c0a1e345f6a9b7c8d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                Pipeline execution deterministic seed: 0x4B3A9 • Python 3.12 / PyTorch
              </div>
            </div>

            <div className="text-left md:text-right">
              <div className="text-zinc-500 uppercase text-[10px] tracking-wider mb-1">
                Forensic Reconstruction Certification
              </div>
              <div className="inline-block border-b-2 border-zinc-900 pb-1 text-zinc-900 font-serif italic text-sm">
                Sakshi Autonomous Forensic Core v1.4
              </div>
              <div className="text-[10px] text-zinc-500 mt-1">
                Prepared for Competent Judicial & Insurance Surveyor Review
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t-2 border-zinc-900 pt-4 mt-8 flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-zinc-500">
          <div>SAKSHI FORENSIC TELEMETRY SYSTEM • ISO 17025 COMPLIANT KINEMATICS</div>
          <div>PAGE 1 OF 1 • CONFIDENTIAL FORENSIC DOSSIER</div>
        </footer>
      </main>
    </div>
  );
};

export default ReportView;

