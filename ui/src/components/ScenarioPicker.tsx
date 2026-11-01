/**
 * Scenario picker: switch between the pre-rendered CARLA scenarios (base,
 * braking, night, rain, ...). Each card shows the scene at the impact and how
 * Sakshi scored against the simulator's ground truth. Picking one swaps the
 * whole workspace (video, replay, charts, claims, report) with no processing.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronDown, Film, Loader2, X } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import {
  ScenarioEntry, loadScenarioCase, loadScenarioIndex, openScenario, prefetchScenario, scenarioThumbUrl,
} from '../utils/scenarios';

const pct = (v: number | null | undefined) => (v == null ? '-' : `${v.toFixed(1)}%`);

function ScenarioCard({ s, active, busy, onPick }: { s: ScenarioEntry; active: boolean; busy: boolean; onPick: () => void }) {
  const [ok, total] = (s.claims_correct || '').split('/').map(Number);
  const allRight = total > 0 && ok === total;
  const a = s.vehicles.A, b = s.vehicles.B;
  return (
    <button
      onClick={onPick}
      onMouseEnter={() => prefetchScenario(s.id)}
      onFocus={() => prefetchScenario(s.id)}
      className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-all ${
        active ? 'border-cyan-400 ring-2 ring-cyan-400/40' : 'border-zinc-800 hover:border-zinc-600'
      } bg-zinc-900/80`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-950">
        <img src={scenarioThumbUrl(s.id)} alt="" loading="lazy"
             className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          s.impact ? 'bg-rose-500/90 text-white' : 'bg-emerald-500/90 text-zinc-950'
        }`}>
          {s.impact ? 'Impact' : 'No impact'}
        </span>
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <div className="text-[13px] font-semibold text-zinc-100">{s.title}</div>
        <div className="line-clamp-2 text-[11px] leading-snug text-zinc-400">{s.description}</div>
        <div className="mt-auto flex items-center justify-between pt-1.5 text-[10.5px]">
          {s.claims_correct ? (
            <span className={`flex items-center gap-1 ${allRight ? 'text-emerald-400' : 'text-amber-300'}`}
                  title="Claim verdicts that match CARLA ground truth">
              <CheckCircle2 className="h-3 w-3" /> {s.claims_correct} verdicts right
            </span>
          ) : <span className="text-zinc-500">{s.claims} claims</span>}
          {(a || b) && (
            <span className="tabular-nums text-zinc-400" title="Speed error against ground truth, last 2 s">
              error {pct(a?.error_pct)} / {pct(b?.error_pct)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export const ScenarioPicker: React.FC = () => {
  const scenarioId = useCaseStore((s) => s.scenarioId);
  const [entries, setEntries] = useState<ScenarioEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadScenarioIndex().then((ix) => setEntries(ix?.scenarios ?? null)); }, []);
  // Opening the picker warms every scenario's case.json, so any click is instant.
  useEffect(() => {
    if (open && entries) entries.forEach((e) => loadScenarioCase(e.id).catch(() => undefined));
  }, [open, entries]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const groups = useMemo(() => {
    const m = new Map<string, ScenarioEntry[]>();
    for (const s of entries || []) m.set(s.group, [...(m.get(s.group) || []), s]);
    return [...m.entries()];
  }, [entries]);

  if (!entries) return null; // no exported scenarios: the picker stays out of the way
  const current = entries.find((s) => s.id === scenarioId);

  const pick = async (id: string) => {
    if (id === scenarioId) { setOpen(false); return; }
    setBusy(id);
    setError(null);
    try {
      await openScenario(id);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded border border-cyan-800/70 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-200 hover:border-cyan-600"
        title="Switch between the pre-rendered CARLA scenarios"
      >
        <Film className="h-3 w-3" />
        <span className="hidden max-w-[220px] truncate sm:inline">{current ? current.title : 'Choose a scenario'}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-zinc-950/80 p-4 pt-16"
             onClick={() => setOpen(false)}>
          <div className="max-h-[82vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl"
               onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-zinc-100">Scenarios</div>
                <div className="text-xs text-zinc-400">
                  {entries.length} crashes simulated in CARLA, each run through Sakshi and scored against the simulator&apos;s
                  ground truth. Pick one to open it in full.
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            {error && <div className="mb-3 rounded border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-300">{error}</div>}
            {groups.map(([group, list]) => (
              <section key={group} className="mb-5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{group}</div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                  {list.map((s) => (
                    <ScenarioCard key={s.id} s={s} active={s.id === scenarioId} busy={busy === s.id} onPick={() => pick(s.id)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default ScenarioPicker;
