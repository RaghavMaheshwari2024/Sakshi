/**
 * Case switcher: the pre-rendered CARLA scenarios and, when a backend is
 * running, its cases. Each scenario card shows the scene at the impact and how
 * Sakshi scored against the simulator's ground truth. Picking one swaps the
 * whole workspace (video, replay, charts, claims, report) with no processing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Film, Loader2 } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import {
  ScenarioEntry, loadScenarioCase, loadScenarioIndex, openScenario, prefetchScenario, scenarioThumbUrl,
} from '../utils/scenarios';
import { BackendCase, fetchBackendCases, openBackendCase } from '../utils/api';
import { Button, Dialog, Notice } from './ui';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

const pct = (v: number | null | undefined) => (v == null ? '-' : v.toFixed(1));

function ScenarioCard({ s, active, busy, onPick }: { s: ScenarioEntry; active: boolean; busy: boolean; onPick: () => void }) {
  const [ok, total] = (s.claims_correct || '').split('/').map(Number);
  const wrong = total - ok;
  const a = s.vehicles.A, b = s.vehicles.B;
  return (
    <button
      onClick={onPick}
      onMouseEnter={() => prefetchScenario(s.id)}
      onFocus={() => prefetchScenario(s.id)}
      aria-current={active ? 'true' : undefined}
      className={`scenario-card group flex flex-col overflow-hidden rounded border text-left transition-colors ${
        active ? 'border-paint' : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-asphalt-950">
        <img src={scenarioThumbUrl(s.id)} alt="" loading="lazy"
             className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
        <span className={`absolute left-1.5 top-1.5 rounded-[3px] bg-asphalt-950/85 px-1.5 py-0.5 text-[11px] ${s.impact ? 'text-signal-red' : 'text-signal-green'}`}>
          {s.impact ? 'Impact' : 'No impact'}
        </span>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-asphalt-950/60">
            <Loader2 className="h-5 w-5 animate-spin text-paint" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <div className="text-[13px] font-medium text-bone">{s.title}</div>
        <div className="line-clamp-2 text-[12px] leading-snug text-bone-400">{s.description}</div>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 text-[11.5px] text-bone-500">
          {total > 0 ? (
            <span title="Verdicts that contradict CARLA ground truth">
              {wrong === 0 ? `${total} claims, 0 wrong` : `${wrong} of ${total} wrong`}
            </span>
          ) : <span>{s.claims} claims</span>}
          {(a || b) && (
            <span className="measured" title="Speed error against ground truth, last 2 s, vehicle A / B">
              {pct(a?.error_pct)} / {pct(b?.error_pct)}%
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

const STATUS: Record<BackendCase['status'], string> = {
  done: 'Finished',
  ready: 'Calibrated, not run',
  calibrate: 'Needs calibration',
};

export const ScenarioPicker: React.FC<{ onPicked?: () => void; onCalibrate?: (id: string) => void }> = ({ onPicked, onCalibrate }) => {
  const scenarioId = useCaseStore((s) => s.scenarioId);
  const backendCaseId = useCaseStore((s) => s.backendCaseId);
  const [entries, setEntries] = useState<ScenarioEntry[] | null>(null);
  const [backendCases, setBackendCases] = useState<BackendCase[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => { loadScenarioIndex().then((ix) => setEntries(ix?.scenarios ?? null)); }, []);
  // Opening the picker warms every scenario's case.json, so any click is instant.
  useEffect(() => {
    if (!open) return;
    entries?.forEach((e) => loadScenarioCase(e.id).catch(() => undefined));
    fetchBackendCases().then(setBackendCases);
  }, [open, entries]);

  useGSAP(
    () => {
      if (!open || prefersReducedMotion()) return;
      gsap.from('.scenario-card', { autoAlpha: 0, y: 10, duration: 0.4, stagger: { amount: 0.3, from: 'start' }, delay: 0.08, clearProps: 'all' });
    },
    { dependencies: [open], scope: grid },
  );

  const groups = useMemo(() => {
    const m = new Map<string, ScenarioEntry[]>();
    for (const s of entries || []) m.set(s.group, [...(m.get(s.group) || []), s]);
    return [...m.entries()];
  }, [entries]);

  if (!entries) return null; // no exported scenarios: the picker stays out of the way
  const current = entries.find((s) => s.id === scenarioId);

  const pick = async (id: string) => {
    if (id === scenarioId) { setOpen(false); onPicked?.(); return; }
    setBusy(id);
    setError(null);
    try {
      await openScenario(id);
      setOpen(false);
      onPicked?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pickBackend = async (c: BackendCase) => {
    setBusy(c.id);
    setError(null);
    try {
      if (c.status === 'done') {
        await openBackendCase(c.id);
        onPicked?.();
      } else {
        onCalibrate?.(c.id);
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" className="max-w-[270px] min-w-0 !shrink" onClick={() => setOpen(true)}
              title={`Switch between all ${entries.length} cases`} aria-haspopup="dialog"
              icon={<Film className="h-3.5 w-3.5 shrink-0 text-paint" />}>
        <span className="truncate">{current ? current.title : backendCaseId ?? 'Choose a case'}</span>
        <span className="measured hidden shrink-0 text-bone-400 sm:inline">{current ? `${entries.indexOf(current) + 1} of ${entries.length}` : `${entries.length} cases`}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-bone-400" />
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        width="max-w-6xl"
        title="Cases"
        description={`${entries.length} crashes simulated in CARLA, each run through Sakshi and scored against the simulator's ground truth. Footage is degraded to look like cheap CCTV.`}
      >
        <div ref={grid} className="space-y-6 p-5">
          {error && <Notice tone="error">{error}</Notice>}
          {backendCases && backendCases.length > 0 && (
            <section>
              <div className="eyebrow mb-2">On this backend</div>
              <div className="grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
                {backendCases.map((c) => (
                  <button key={c.id} onClick={() => pickBackend(c)} aria-current={c.id === backendCaseId ? 'true' : undefined}
                          className="flex items-center justify-between gap-3 bg-asphalt-900 px-3 py-2.5 text-left transition-colors hover:bg-asphalt-800">
                    <span className="min-w-0">
                      <span className="measured block truncate text-[13px] text-bone">{c.id}</span>
                      <span className="block text-[12px] text-bone-400">{STATUS[c.status]}, {c.statements} statements</span>
                    </span>
                    {busy === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-paint" />}
                  </button>
                ))}
              </div>
            </section>
          )}
          {groups.map(([group, list]) => (
            <section key={group}>
              <div className="eyebrow mb-2">{group}</div>
              <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
                {list.map((s) => (
                  <ScenarioCard key={s.id} s={s} active={s.id === scenarioId} busy={busy === s.id} onPick={() => pick(s.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  );
};

export default ScenarioPicker;
