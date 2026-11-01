/** How Sakshi is built: models, pipeline, engine and the decisions behind them. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal, Workflow } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { Benchmark, loadBenchmark } from '../utils/benchmark';
import { DECISIONS, ENGINE, MODELS } from '../content/models';
import { Button } from './ui';
import { ModelTheatre } from './ModelTheatre';
import { gsap, useGSAP, useReveal, withMotion } from '../lib/motion';

const fmt = (n: number) => n.toLocaleString('en-US');

const LAYERS = [
  { title: 'Evidence', items: ['Road video', 'Spoken or written statements', 'A few clicks on the road'], tone: 'text-bone-200' },
  { title: 'Meta models', items: ['SAM 3.1: masks and tracks', 'Muse Spark: clock and signals', 'Muse Voice: audio to text', 'Muse Wonder: scene and claims'], tone: 'text-paint' },
  { title: 'Deterministic engine', items: ['Homography: pixels to metres', 'Clock: true frame times', 'Kalman, Monte Carlo: speed ± 90%', 'Events, signals, verdicts'], tone: 'text-bone-200' },
  { title: 'Reviewable output', items: ['case.json: every measurement', 'Report, number-checked', 'This workspace'], tone: 'text-bone-200' },
];

const Architecture: React.FC = () => {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      withMotion(() => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: 'top 80%', once: true } });
        tl.from('.arch-layer', { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.14 })
          .from('.arch-link', { scaleX: 0, transformOrigin: 'left center', duration: 0.35, stagger: 0.14 }, 0.25);
      });
    },
    { scope: root },
  );
  return (
    <div ref={root}>
      <div className="grid gap-px overflow-hidden rounded border border-line bg-line md:grid-cols-4">
        {LAYERS.map((layer, i) => (
          <div key={layer.title} className="arch-layer relative bg-asphalt-900 p-4">
            <div className="eyebrow">{i + 1} · {layer.title}</div>
            <ul className="mt-3 space-y-1.5 text-[13px]">
              {layer.items.map((item) => <li key={item} className={layer.tone}>{item}</li>)}
            </ul>
            {i < LAYERS.length - 1 && <span className="arch-link absolute right-0 top-[27px] hidden h-px w-6 bg-paint md:block" aria-hidden="true" />}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[13px] text-bone-400">
        The return path matters most: nothing the models write reaches the report until the validator has traced each number back to the engine.
      </p>
    </div>
  );
};

export const SystemView: React.FC<{ onOpenPipeline: () => void }> = ({ onOpenPipeline }) => {
  const caseData = useCaseStore((s) => s.caseData);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [isTheatreOpen, setIsTheatreOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { loadBenchmark().then(setBench); }, []);
  useReveal(root, [bench]);

  const usage = useMemo(() => {
    const entries = Object.entries(bench?.usage ?? {}).map(([model, u]) => ({ model, total: u.live_calls + u.cached_calls, ...u }));
    return entries.sort((a, b) => b.total - a.total);
  }, [bench]);
  const usageMax = usage[0]?.total ?? 1;

  const usageFor = (id: string) => usage.find((u) => u.model.startsWith(id));

  return (
    <div ref={root} className="mx-auto w-full max-w-page px-4 pb-20 pt-10 sm:px-6">
      <header className="max-w-3xl" data-reveal>
        <h1 className="display text-[clamp(34px,5vw,54px)]">Models read. The engine measures.</h1>
        <p className="prose-muted mt-3 text-[15px]">
          Sakshi separates what needs perception and language from what needs arithmetic, because a court cannot cross-examine a
          language model’s sum. Meta’s models turn pixels and speech into structure. A deterministic engine does the physics.
        </p>
      </header>

      <section className="mt-12" data-reveal>
        <Architecture />
      </section>

      <section className="mt-16">
        <div data-reveal className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-serif text-[26px] font-light text-bone">Five Meta models, one job each</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Terminal className="h-3.5 w-3.5 text-paint" />} onClick={() => setIsTheatreOpen(true)}>
              Open Model Theatre
            </Button>
            <Button size="sm" icon={<Workflow className="h-3.5 w-3.5" />} onClick={onOpenPipeline}>
              Watch the pipeline run
            </Button>
          </div>
        </div>
        <div className="mt-5 divide-y divide-line border-y border-line">
          {MODELS.map((m) => {
            const u = usageFor(m.id);
            const did = caseData?.models?.find((x) => x.model.startsWith(m.id))?.did;
            return (
              <article key={m.id} data-reveal className="grid gap-x-8 gap-y-2 py-5 md:grid-cols-[190px_1fr_230px]">
                <div>
                  <div className="eyebrow">{m.role}</div>
                  <h3 className="mt-1 text-[16px] text-bone">{m.name}</h3>
                  <div className="measured mt-0.5 text-[12px] text-bone-500">{m.file}</div>
                </div>
                <div className="text-[14px] leading-relaxed">
                  <p className="text-bone-200">{m.job}</p>
                  <p className="mt-1.5 text-bone-400">{m.enables}</p>
                </div>
                <div className="text-[13px] text-bone-400">
                  {did && <p><span className="text-bone-500">On this case: </span>{did}</p>}
                  {u ? (
                    <p className="measured mt-1.5 text-[12.5px]">{fmt(u.total)} calls logged</p>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] text-bone-500">Not used in the logged suite runs</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        {usage.length > 0 && (
          <div data-reveal className="mt-6 rounded border border-line bg-asphalt-900 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13px] text-bone">Logged model calls</h3>
              <span className="text-[12px] text-bone-500">From logs/model_usage.jsonl. Cached calls answer instantly and cost nothing.</span>
            </div>
            <div className="mt-3 space-y-2.5">
              {usage.map((u) => (
                <div key={u.model} className="grid grid-cols-[130px_1fr_auto] items-center gap-3 text-[12.5px]">
                  <span className="measured truncate text-bone-200">{u.model}</span>
                  <div className="flex h-2 bg-asphalt-700">
                    <span className="h-full bg-paint" style={{ width: `${(u.live_calls / usageMax) * 100}%` }} title={`${fmt(u.live_calls)} live`} />
                    <span className="h-full bg-bone-400/50" style={{ width: `${(u.cached_calls / usageMax) * 100}%` }} title={`${fmt(u.cached_calls)} cached`} />
                  </div>
                  <span className="measured text-bone-400">{fmt(u.live_calls)} live · {fmt(u.cached_calls)} cached</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-16">
        <h2 data-reveal className="font-serif text-[26px] font-light text-bone">The engine</h2>
        <p data-reveal className="prose-muted mt-2 max-w-2xl text-[14px]">Plain, testable Python in sakshi/engine. No model is called from here.</p>
        <div className="mt-5 grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {ENGINE.map((e) => (
            <div key={e.file} data-reveal className="bg-asphalt-900 p-4">
              <h3 className="text-[14px] text-bone">{e.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-bone-400">{e.body}</p>
              <div className="measured mt-2 text-[12px] text-bone-500">{e.file}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <h2 data-reveal className="font-serif text-[26px] font-light text-bone">Decisions that shaped it</h2>
        <div className="mt-5 grid gap-x-10 md:grid-cols-2">
          {DECISIONS.map((d) => (
            <article key={d.title} data-reveal className="border-t border-line py-4">
              <h3 className="text-[15px] text-bone">{d.title}</h3>
              <p className="mt-1 text-[14px] leading-relaxed text-bone-300">{d.body}</p>
              <div className="measured mt-1.5 text-[12px] text-bone-500">{d.where}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-16" data-reveal>
        <h2 className="font-serif text-[26px] font-light text-bone">One file, every result</h2>
        <p className="prose-muted mt-2 max-w-2xl text-[14px]">
          The pipeline writes a single case.json. The workspace, the report and the 3D replay read only that, so what you see is what was computed.
        </p>
        <div className="measured mt-3 flex flex-wrap gap-1.5 text-[12.5px]">
          {['clip', 'clock', 'calibration', 'tracks', 'trajectories', 'events', 'facts', 'signals', 'statements', 'party_to_track', 'scene', 'claims', 'report', 'models', 'disclaimer'].map((k) => (
            <span key={k} className="rounded-[3px] border border-line px-1.5 py-0.5 text-bone-300">{k}</span>
          ))}
        </div>
      </section>

      <ModelTheatre
        isOpen={isTheatreOpen}
        onClose={() => setIsTheatreOpen(false)}
        caseData={caseData}
      />
    </div>
  );
};
