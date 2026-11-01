/**
 * The 11-stage pipeline, shown two honest ways.
 *  - Live: streams server-sent events from the backend for a backend case.
 *  - Recorded: steps through the open case's own results at presenting speed.
 *    Every value shown comes from that case.json; nothing runs and it says so.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Play, RotateCcw } from 'lucide-react';
import { getTrackColor, SIGNAL_COLORS } from '../utils/colors';
import type { CaseData } from '../types/case';
import { Button, Dialog, Notice, VerdictTag } from './ui';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

interface Suggestion { statement_id: string; track_id: string; reason?: string; rationale?: string }

export interface StageData {
  video?: { frames: number; fps: number; size: [number, number] };
  calibration?: { reproj_rms_m: number };
  clock?: { method?: string; duplicates?: number; ticks_read?: number; ticks_used?: number; dropped_frames_inferred?: number; note?: string };
  tracking?: { tracks?: string[]; concepts?: string[]; note?: string };
  physics?: { measured_tracks?: string[]; split_at_frame?: number };
  events?: { impact?: { t: number; t_sigma?: number; i?: number } | null; momentum?: { status?: string; best_relative_residual?: number } | null; closest_approach?: { t: number; gap_m?: number } | null };
  signals?: { light?: string; changes?: Array<{ t: number; state: string }>; note?: string };
  statements?: { n: number; items?: Array<{ id: string; speaker: string; text?: string }> };
  scene?: { suggested?: Suggestion[]; party_checks?: string[]; using?: Record<string, string> };
  claims?: { verdicts?: Array<'consistent' | 'inconsistent' | 'cant_tell'> };
  report?: { validator?: { passed: boolean; unsupported_numbers: string[] } };
}

export type StageStatus = 'pending' | 'running' | 'completed' | 'paused' | 'error';

interface StageDefinition {
  id: keyof StageData;
  name: string;
  tool: string;
  /** A Meta model did this step; otherwise the deterministic engine did. */
  model: boolean;
  description: string;
}

const STAGES: StageDefinition[] = [
  { id: 'video', name: 'Video', tool: 'Probe', model: false, description: 'Frames, nominal rate, resolution' },
  { id: 'calibration', name: 'Calibration', tool: 'Homography', model: false, description: 'Image pixels to road metres' },
  { id: 'clock', name: 'True frame times', tool: 'Muse Spark', model: true, description: 'Reads the burned-in clock; motion places lost frames' },
  { id: 'tracking', name: 'Tracking', tool: 'SAM 3.1', model: true, description: 'Masks with persistent ids; tyre-road contact points' },
  { id: 'physics', name: 'Kinematics', tool: 'Kalman, Monte Carlo', model: false, description: 'Smoothed motion, split at impact, 90% intervals' },
  { id: 'events', name: 'Events', tool: 'Engine', model: false, description: 'Impact or closest approach, momentum check' },
  { id: 'signals', name: 'Signal timeline', tool: 'Colour rule, Muse Spark', model: true, description: 'Lit-lamp colour per frame, debounced' },
  { id: 'statements', name: 'Statements', tool: 'Muse Voice', model: true, description: 'Hindi or English audio transcribed; text passes through' },
  { id: 'scene', name: 'Who drove what', tool: 'Muse Wonder', model: true, description: 'Keyframes matched to statement-givers; a person confirms' },
  { id: 'claims', name: 'Claim checks', tool: 'Muse Wonder, Engine', model: true, description: 'Wonder extracts each claim; the engine gives the verdict' },
  { id: 'report', name: 'Report', tool: 'Muse Wonder', model: true, description: 'Written from facts; a validator rejects unknown numbers' },
];

const STAGE_MS = 520;

/** Stage results read back out of a finished case. */
function stagesFromCase(c: CaseData): StageData {
  const model = (prefix: string) => c.models?.find((m) => m.model.startsWith(prefix))?.did;
  const impact = c.facts?.impact ?? null;
  return {
    video: { frames: c.clip.frames, fps: c.clip.fps_nominal, size: [c.clip.width, c.clip.height] },
    calibration: { reproj_rms_m: Number(c.calibration.reproj_rms_m.toFixed(3)) },
    clock: {
      method: c.clock.method,
      duplicates: c.clock.frames.filter((f) => f.dup).length,
      dropped_frames_inferred: c.clock.dropped_frames_inferred,
      note: model('muse-spark'),
    },
    tracking: {
      tracks: c.tracks.filter((t) => t.concept !== 'traffic light').map((t) => t.id),
      concepts: [...new Set(c.tracks.map((t) => t.concept))],
      note: model('sam'),
    },
    physics: { measured_tracks: c.trajectories.map((t) => t.track), split_at_frame: impact?.i },
    events: { impact, momentum: c.facts?.momentum_check ?? null, closest_approach: c.facts?.closest_approach ?? null },
    signals: {
      changes: c.facts?.signal_changes ?? [],
      note: c.facts?.signal_note?.replace(/\s*\(traffic_light[^)]*\)/, ''),
    },
    statements: { n: c.statements.length, items: c.statements },
    scene: { suggested: c.scene?.party_to_track ?? [] },
    claims: { verdicts: c.claims.map((x) => x.verdict) },
    report: c.report ? { validator: c.report.validator } : undefined,
  };
}

const StageResult: React.FC<{ id: keyof StageData; data: StageData }> = ({ id, data }) => {
  const row = (children: React.ReactNode) => <div className="measured text-[12px] text-bone-300">{children}</div>;
  switch (id) {
    case 'video':
      return data.video ? row(<>{data.video.frames} frames · {data.video.fps} fps · {data.video.size?.join('×')}</>) : null;
    case 'calibration':
      return data.calibration ? row(<>{data.calibration.reproj_rms_m} m RMS on the road plane</>) : null;
    case 'clock':
      return data.clock ? row(
        <>{data.clock.method}{data.clock.dropped_frames_inferred != null && <> · <span className="text-signal-amber">{data.clock.dropped_frames_inferred} drops recovered</span></>}{data.clock.duplicates != null && <> · {data.clock.duplicates} duplicates</>}{data.clock.ticks_read != null && <> · {data.clock.ticks_read} ticks read</>}{data.clock.note && <span className="block font-sans text-bone-400">{data.clock.note}</span>}</>,
      ) : null;
    case 'tracking':
      return data.tracking ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-bone-300">
          {(data.tracking.tracks || []).map((t) => (
            <span key={t} className="measured inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: getTrackColor(t) }} />{t}</span>
          ))}
          {data.tracking.note && <span className="text-bone-400">{data.tracking.note}</span>}
        </div>
      ) : null;
    case 'physics':
      return data.physics ? row(<>{(data.physics.measured_tracks || []).join(', ')}{data.physics.split_at_frame != null && <> · smoothed separately either side of frame {data.physics.split_at_frame}</>}</>) : null;
    case 'events': {
      const e = data.events;
      if (!e) return null;
      return row(
        <>
          {e.impact ? <span className="text-signal-red">impact t = {Number(e.impact.t).toFixed(3)} s{e.impact.t_sigma != null && ` ±${e.impact.t_sigma}`}</span>
            : e.closest_approach ? <>no impact · closest {Number(e.closest_approach.gap_m).toFixed(2)} m at t = {Number(e.closest_approach.t).toFixed(2)} s</>
              : 'no impact found'}
          {e.momentum?.status && <> · momentum {e.momentum.status}{e.momentum.best_relative_residual != null && ` (residual ${e.momentum.best_relative_residual})`}</>}
        </>,
      );
    }
    case 'signals': {
      const s = data.signals;
      if (!s) return null;
      if (!s.changes?.length) return <div className="text-[12px] text-bone-400">{s.note || 'No signal timeline for this clip.'}</div>;
      return (
        <div className="flex flex-wrap gap-2 text-[12px]">
          {s.changes.map((ch, i) => (
            <span key={i} className="measured inline-flex items-center gap-1 text-bone-300">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SIGNAL_COLORS[ch.state] ?? SIGNAL_COLORS.off }} />
              {ch.state} {Number(ch.t).toFixed(2)} s
            </span>
          ))}
        </div>
      );
    }
    case 'statements':
      return data.statements ? row(<>{data.statements.n} statements</>) : null;
    case 'scene':
      return data.scene?.suggested?.length ? row(<>{data.scene.suggested.map((s) => `${s.statement_id} → ${s.track_id}`).join(', ')}</>) : null;
    case 'claims':
      return data.claims?.verdicts ? (
        <div className="flex flex-wrap gap-1">{data.claims.verdicts.map((v, i) => <VerdictTag key={i} verdict={v} />)}</div>
      ) : null;
    case 'report': {
      const v = data.report?.validator;
      if (!v) return null;
      return (
        <div className={`text-[12px] ${v.passed ? 'text-signal-green' : 'text-signal-amber'}`}>
          {v.passed ? 'Number check passed: every figure came from the engine' : `Number check flagged ${v.unsupported_numbers.length}: ${v.unsupported_numbers.join(', ')}`}
        </div>
      );
    }
    default:
      return null;
  }
};

export interface ProcessingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Backend case, when one is open. */
  caseId: string | null;
  /** The open case, for the recorded view. */
  recorded: CaseData | null;
  autoStart?: boolean;
  onComplete?: (caseId: string, data: CaseData) => void;
}

type Source = 'idle' | 'live' | 'recorded';

export const ProcessingModal: React.FC<ProcessingModalProps> = ({ isOpen, onClose, caseId, recorded, autoStart = false, onComplete }) => {
  const [statuses, setStatuses] = useState<Record<string, StageStatus>>({});
  const [data, setData] = useState<StageData>({});
  const [source, setSource] = useState<Source>('idle');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [awaitingParty, setAwaitingParty] = useState(false);
  const [partyMapping, setPartyMapping] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Suggestion[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [statements, setStatements] = useState<Array<{ id: string; speaker: string }>>([]);
  const [result, setResult] = useState<CaseData | null>(null);

  const eventSource = useRef<EventSource | null>(null);
  const timer = useRef<number | null>(null);
  const resumeReplay = useRef<(() => void) | null>(null);
  const rerunWith = useRef<Record<string, string> | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setStatuses(Object.fromEntries(STAGES.map((s) => [s.id, 'pending'])));
    setData({});
    setIsDone(false);
    setErrorMessage(null);
    setAwaitingParty(false);
    setResult(null);
    resumeReplay.current = null;
  }, []);

  const stop = useCallback(() => {
    eventSource.current?.close();
    eventSource.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setIsProcessing(false);
  }, []);

  const startRecorded = useCallback(() => {
    if (!recorded) return;
    stop();
    reset();
    const stages = stagesFromCase(recorded);
    const statementList = recorded.statements.map((s) => ({ id: s.id, speaker: s.speaker }));
    setSource('recorded');
    setIsProcessing(true);
    setStatements(statementList);
    setTracks(recorded.trajectories.map((t) => t.track));
    setPartyMapping(recorded.party_to_track ?? {});
    setSuggested(stages.scene?.suggested ?? []);

    const stepMs = prefersReducedMotion() ? 60 : STAGE_MS;
    const step = (idx: number) => {
      if (idx >= STAGES.length) {
        setIsProcessing(false);
        setIsDone(true);
        return;
      }
      const stage = STAGES[idx];
      setStatuses((p) => ({ ...p, [stage.id]: 'running' }));
      timer.current = window.setTimeout(() => {
        setData((p) => ({ ...p, [stage.id]: stages[stage.id] }));
        if (stage.id === 'scene' && statementList.length) {
          // The confirmation is part of the method, so the replay stops for it too.
          setStatuses((p) => ({ ...p, scene: 'paused' }));
          setAwaitingParty(true);
          resumeReplay.current = () => step(idx + 1);
          return;
        }
        setStatuses((p) => ({ ...p, [stage.id]: 'completed' }));
        step(idx + 1);
      }, stepMs);
    };
    step(0);
  }, [recorded, reset, stop]);

  const startLive = useCallback(() => {
    if (!caseId) return;
    stop();
    reset();
    setSource('live');
    setIsProcessing(true);
    const es = new EventSource(`/cases/${caseId}/run?force=true`);
    eventSource.current = es;
    let received = false;

    const onStage = (stageId: keyof StageData, payload: Record<string, unknown>) => {
      received = true;
      setData((p) => ({ ...p, [stageId]: { ...(p[stageId] || {}), ...payload } }));
      const at = STAGES.findIndex((s) => s.id === stageId);
      setStatuses((p) => {
        const next = { ...p };
        STAGES.forEach((s, i) => {
          if (i <= at && next[s.id] !== 'paused') next[s.id] = 'completed';
        });
        if (STAGES[at + 1] && next[STAGES[at + 1].id] === 'pending') next[STAGES[at + 1].id] = 'running';
        return next;
      });
      if (stageId === 'tracking' && Array.isArray(payload.tracks)) setTracks(payload.tracks as string[]);
      if (stageId === 'statements' && Array.isArray(payload.items)) setStatements(payload.items as { id: string; speaker: string }[]);
      if (stageId === 'scene' && Array.isArray(payload.suggested)) {
        const list = payload.suggested as Suggestion[];
        setSuggested(list);
        setPartyMapping(Object.fromEntries(list.map((s) => [s.statement_id, s.track_id])));
        setStatements((prev) => (prev.length ? prev : list.map((s) => ({ id: s.statement_id, speaker: s.statement_id }))));
        setAwaitingParty(true);
      }
    };

    STAGES.forEach((stage) => {
      es.addEventListener(stage.id, (e: MessageEvent) => {
        try {
          onStage(stage.id, JSON.parse(e.data));
        } catch (err) {
          console.warn(`Unreadable event for ${stage.id}:`, err);
        }
      });
    });

    es.addEventListener('done', async () => {
      stop();
      // A reassignment made during the run applies now: save it and run again.
      if (rerunWith.current) {
        const body = JSON.stringify(rerunWith.current);
        rerunWith.current = null;
        await fetch(`/cases/${caseId}/party`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        startLiveRef.current();
        return;
      }
      setIsDone(true);
      try {
        const res = await fetch(`/cases/${caseId}/case.json`);
        if (res.ok) setResult(await res.json());
      } catch {
        setErrorMessage('The run finished, but its result could not be loaded.');
      }
    });

    es.addEventListener('error', (e) => {
      const server = (e as MessageEvent).data;
      let message = received
        ? 'The connection to the backend dropped before the run finished.'
        : 'The backend did not start the run. It needs to be running, and the case needs a saved calibration.';
      if (server) {
        try { message = JSON.parse(server).message ?? message; } catch { /* keep the default */ }
      }
      setErrorMessage(message);
      setStatuses((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === 'running' ? 'error' : v])));
      stop();
    });
  }, [caseId, reset, stop]);

  const startLiveRef = useRef(startLive);
  startLiveRef.current = startLive;

  useEffect(() => {
    if (!isOpen) {
      stop();
      return;
    }
    if (caseId && autoStart) startLive();
    else if (recorded) startRecorded();
    else reset();
    return stop;
    // Opening is the trigger; the case on screen cannot change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const confirmParty = async () => {
    setAwaitingParty(false);
    if (source === 'recorded') {
      setStatuses((p) => ({ ...p, scene: 'completed' }));
      resumeReplay.current?.();
      return;
    }
    const changed = suggested.some((s) => partyMapping[s.statement_id] !== s.track_id);
    if (changed) {
      if (isProcessing) rerunWith.current = partyMapping;
      else if (caseId) {
        await fetch(`/cases/${caseId}/party`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partyMapping) });
        startLive();
      }
    }
  };

  const completed = Object.values(statuses).filter((s) => s === 'completed').length;
  const progress = completed / STAGES.length;

  useGSAP(
    () => {
      if (!bar.current) return;
      gsap.to(bar.current, { scaleX: progress, duration: prefersReducedMotion() ? 0 : 0.45, ease: 'power2.out' });
    },
    { dependencies: [progress] },
  );

  const close = () => {
    stop();
    onClose();
  };

  const stateTag = source === 'live'
    ? <span className="rounded-[3px] bg-signal-greensoft px-1.5 py-0.5 text-[12px] text-signal-green">Live from the backend</span>
    : source === 'recorded'
      ? <span className="rounded-[3px] bg-asphalt-700 px-1.5 py-0.5 text-[12px] text-bone-300">Recorded run</span>
      : null;

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      title="Pipeline run"
      headerExtra={stateTag}
      description={source === 'recorded'
        ? 'Stepping through the results stored with this case. Nothing is being computed.'
        : 'Eleven stages. Models read and describe; the engine does all the arithmetic.'}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-[12px] text-bone-400">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-paint" />Meta model</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-asphalt-600" />Deterministic engine</span>
          </div>
          <div className="flex items-center gap-2">
            {recorded && !isProcessing && (
              <Button size="sm" icon={<RotateCcw className="h-3 w-3" />} onClick={startRecorded}>Replay</Button>
            )}
            {caseId && !(isProcessing && source === 'live') && (
              <Button size="sm" icon={<Play className="h-3 w-3" />} onClick={startLive} title="Runs the pipeline on the backend. Model calls are cached.">
                Run on backend
              </Button>
            )}
            {result && caseId
              ? <Button variant="primary" size="sm" onClick={() => onComplete?.(caseId, result)}>Open the result</Button>
              : <Button variant={isDone ? 'primary' : 'secondary'} size="sm" onClick={close}>{isDone ? 'Inspect the case' : isProcessing ? 'Stop' : 'Close'}</Button>}
          </div>
        </div>
      }
    >
      <div className="h-px bg-line">
        <div ref={bar} className="h-px origin-left scale-x-0 bg-paint" />
      </div>

      {errorMessage && (
        <div className="px-5 pt-4">
          <Notice
            tone="error"
            action={recorded ? <Button size="sm" onClick={startRecorded}>Show recorded run</Button> : undefined}
          >
            {errorMessage}
          </Notice>
        </div>
      )}

      {!recorded && !caseId && (
        <p className="p-5 text-[13px] text-bone-400">Open a case to see its pipeline run.</p>
      )}

      <ol className="py-1">
        {STAGES.map((stage, i) => {
          const status = statuses[stage.id] || 'pending';
          const showResult = status === 'completed' || (status === 'paused' && stage.id === 'scene');
          return (
            <li key={stage.id} className={`grid grid-cols-[28px_1fr] gap-x-2 px-5 py-2 transition-opacity sm:grid-cols-[28px_minmax(0,220px)_1fr] ${status === 'pending' ? 'opacity-50' : ''}`}>
              <div className="pt-0.5">
                {status === 'completed' ? <Check className="h-4 w-4 text-signal-green" strokeWidth={2.5} aria-label="Done" />
                  : status === 'running' ? <Loader2 className="h-4 w-4 animate-spin text-paint" aria-label="Running" />
                    : status === 'paused' ? <span className="mt-1 block h-2 w-2 rounded-full bg-signal-amber" aria-label="Waiting for you" />
                      : status === 'error' ? <span className="mt-1 block h-2 w-2 rounded-full bg-signal-red" aria-label="Failed" />
                        : <span className="measured text-[12px] text-bone-500">{i + 1}</span>}
              </div>
              <div className="min-w-0">
                <div className="text-[13px] text-bone">{stage.name}</div>
                <div className="flex items-center gap-1.5 text-[12px] text-bone-400">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${stage.model ? 'bg-paint' : 'bg-asphalt-600'}`} />
                  <span className="truncate">{stage.tool}</span>
                </div>
              </div>
              <div className="col-start-2 mt-1 min-w-0 sm:col-start-3 sm:mt-0">
                {showResult ? <StageResult id={stage.id} data={data} /> : <div className="text-[12px] text-bone-500">{stage.description}</div>}
              </div>

              {stage.id === 'scene' && awaitingParty && (
                <div className="col-span-full mt-2 rounded border border-signal-amber/40 bg-asphalt-850 p-3 sm:ml-[36px]">
                  <h3 className="text-[13px] font-medium text-bone">Who drove what?</h3>
                  <p className="mt-0.5 text-[12.5px] text-bone-400">
                    Muse Wonder’s suggestion from the keyframes. A person confirms it before any claim is checked against a vehicle.
                  </p>
                  <div className="mt-2 divide-y divide-line">
                    {statements.map((st) => {
                      const s = suggested.find((x) => x.statement_id === st.id);
                      const value = partyMapping[st.id] ?? 'unassigned';
                      return (
                        <div key={st.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-[13px] text-bone-200">{st.speaker} <span className="measured text-[12px] text-bone-500">{st.id}</span></div>
                            {(s?.reason || s?.rationale) && <p className="mt-0.5 text-[12.5px] leading-snug text-bone-400">{s.reason || s.rationale}</p>}
                          </div>
                          <label className="flex shrink-0 items-center gap-2 text-[12px] text-bone-400">
                            Assign to
                            <select
                              value={value}
                              disabled={source === 'recorded'}
                              onChange={(e) => setPartyMapping((p) => ({ ...p, [st.id]: e.target.value }))}
                              className="field measured w-auto py-1 disabled:opacity-60"
                            >
                              {[...new Set([...tracks, value])].filter((t) => t !== 'unassigned').map((t) => <option key={t} value={t}>{t}</option>)}
                              <option value="unassigned">Unassigned</option>
                            </select>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-[12px] text-bone-500">
                      {source === 'recorded' ? 'Recorded run: assignments can change on a backend case.' : 'A change re-runs the checks with your assignment.'}
                    </span>
                    <Button variant="primary" size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={confirmParty}>
                      {source === 'recorded' ? 'Continue' : 'Confirm'}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
};

