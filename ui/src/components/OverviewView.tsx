/**
 * The front page: what Sakshi is, for whom, and proof, in one scroll. Every
 * exhibit is drawn live from the base scenario's case.json and the exported
 * validation results; the two road-safety figures are cited at the foot.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { ActiveView } from './AppBar';
import { ClaimLine } from './ClaimLine';
import { Button, Mark, VerdictTag } from './ui';
import type { CaseData } from '../types/case';
import { loadScenarioCase, scenarioThumbUrl } from '../utils/scenarios';
import { Benchmark, loadBenchmark, summarise } from '../utils/benchmark';
import { droppedPositions, strongestContradiction, vehicleName } from '../utils/caseFacts';
import { drawRleMask } from '../utils/maskDecoder';
import { getTrackColor } from '../utils/colors';
import { MODELS } from '../content/models';
import { countTo, gsap, ScrollTrigger, SplitText, useGSAP, useReveal, withMotion } from '../lib/motion';

const STORY_CASE = 'base';

const AUDIENCE = [
  ['Surveyors and insurers', 'A measured account of the moments before impact, with its uncertainty stated, to set against each party’s version.'],
  ['Lawyers and courts', 'A report where every figure traces to the footage, and which stops short of saying who is at fault.'],
  ['Drivers and families', 'An honest statement in any language can be checked against what the road actually recorded.'],
];

const STEPS = [
  { id: 'track', model: 'SAM 3.1', title: 'Find every road user', body: 'SAM 3.1 tracks each vehicle pixel by pixel. The lowest band of its mask gives the point where tyre meets road.' },
  { id: 'time', model: 'Muse Spark', title: 'Recover true time', body: 'Recorders drop frames and still claim 25 fps. Muse Spark reads the burned-in clock; the vehicles’ own motion shows where frames went missing.' },
  { id: 'ground', model: 'Engine', title: 'Turn pixels into metres', body: 'A few clicks on road markings fit the ground plane. Tracks become real paths you could lay a tape measure along.' },
  { id: 'speed', model: 'Engine', title: 'Measure, with honest doubt', body: 'A Kalman smoother gives speed. Monte Carlo runs over every uncertain input give a 90% interval, so no speed is ever shown bare.' },
  { id: 'verdict', model: 'Muse Wonder + Engine', title: 'Hold the statement to it', body: 'Muse Wonder extracts each checkable claim, in Hindi or English. The engine, not the model, decides whether the footage agrees.' },
];

/** The impact frame with its real masks. */
const TrackExhibit: React.FC<{ data: CaseData }> = ({ data }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { width, height } = data.clip;
    c.width = width;
    c.height = height;
    const i = data.events[0]?.i ?? 0;
    for (const t of data.tracks) {
      if (t.concept === 'traffic light') continue;
      const f = t.frames.find((x) => x.i === i) ?? t.frames[t.frames.length - 1];
      if (!f) continue;
      const colour = getTrackColor(t.id);
      if (f.rle) drawRleMask(ctx, f.rle, f.box, colour, 1, 1);
      ctx.strokeStyle = colour;
      ctx.strokeRect(f.box[0], f.box[1], f.box[2] - f.box[0], f.box[3] - f.box[1]);
      if (f.contact_px) {
        ctx.fillStyle = '#f2c037';
        ctx.beginPath();
        ctx.arc(f.contact_px[0], f.contact_px[1], 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [data]);
  return (
    <div className="relative">
      <img src={scenarioThumbUrl(STORY_CASE)} alt="Frame from the simulated junction at the moment of impact" className="block w-full" />
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
    </div>
  );
};

const TimeExhibit: React.FC<{ data: CaseData }> = ({ data }) => {
  const gaps = useMemo(() => droppedPositions(data), [data]);
  const lost = gaps.reduce((n, g) => n + g.lost, 0);
  return (
    <div className="p-5">
      <div className="eyebrow">{data.clip.frames} frames, as the recorder kept them</div>
      <div className="mt-3 flex h-16 gap-px">
        {data.clock.frames.map((f) => {
          const gap = gaps.some((g) => g.i === f.i);
          return <span key={f.i} className={`time-tick min-w-0 flex-1 origin-bottom ${gap ? 'bg-signal-amber' : 'bg-asphalt-600'}`} />;
        })}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-[13px] text-bone-400">Frames recovered</dt>
          <dd className="measured mt-0.5 text-[26px] text-signal-amber">{data.clock.dropped_frames_inferred ?? lost}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-bone-400">Typical timing error</dt>
          <dd className="measured mt-0.5 text-[26px] text-bone">±{(data.clock.median_sigma_s * 1000).toFixed(0)} ms</dd>
        </div>
      </dl>
    </div>
  );
};

const fitPath = (data: CaseData, W: number, H: number) => {
  const xs = data.trajectories.flatMap((t) => t.x), ys = data.trajectories.flatMap((t) => t.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((W - 40) / (maxX - minX || 1), (H - 40) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * k) / 2, oy = (H - (maxY - minY) * k) / 2;
  return { x: (v: number) => ox + (v - minX) * k, y: (v: number) => H - oy - (v - minY) * k, k };
};

const GroundExhibit: React.FC<{ data: CaseData }> = ({ data }) => {
  const W = 560, H = 315;
  const f = fitPath(data, W, H);
  const imp = data.events[0];
  const metres = Math.round(60 / f.k / 5) * 5 || 5;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Measured paths of both vehicles on the road plane">
      <defs>
        <pattern id="story-grid" width={f.k * 5} height={f.k * 5} patternUnits="userSpaceOnUse">
          <path d={`M ${f.k * 5} 0 L 0 0 0 ${f.k * 5}`} fill="none" stroke="rgba(237,234,227,0.07)" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#story-grid)" />
      {data.trajectories.map((t) => (
        <path key={t.track} className="ground-path" fill="none" stroke={getTrackColor(t.track)} strokeWidth={2}
              d={t.x.map((x, i) => `${i ? 'L' : 'M'}${f.x(x).toFixed(1)} ${f.y(t.y[i]).toFixed(1)}`).join('')} />
      ))}
      {imp && <circle className="ground-impact" cx={f.x(imp.xy[0])} cy={f.y(imp.xy[1])} r={6} fill="none" stroke="#ef5a4c" strokeWidth={2} />}
      <line x1={18} x2={18 + metres * f.k} y1={H - 18} y2={H - 18} stroke="#b4b1a9" />
      <text x={18} y={H - 24} fill="#b4b1a9" className="font-mono text-[11px]">{metres} m</text>
    </svg>
  );
};

const SpeedExhibit: React.FC<{ data: CaseData }> = ({ data }) => {
  const W = 560, H = 300, pad = { l: 34, r: 14, t: 14, b: 26 };
  const end = data.events[0]?.t ?? Infinity;
  const series = data.trajectories.map((t) => {
    const keep = t.t.map((_, i) => i).filter((i) => t.t[i] <= end);
    return { t, keep };
  });
  const tMin = Math.min(...series.map((s) => s.t.t[s.keep[0] ?? 0])), tMax = Math.max(...series.map((s) => s.t.t[s.keep[s.keep.length - 1] ?? 0]));
  const vMax = Math.ceil(Math.max(...series.flatMap((s) => s.keep.map((i) => s.t.hi90_kmh[i]))) / 20) * 20;
  const x = (v: number) => pad.l + ((v - tMin) / (tMax - tMin || 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / vMax) * (H - pad.t - pad.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Speed of both vehicles over time, with 90 percent intervals">
      {[0, vMax / 2, vMax].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(237,234,227,0.08)" />
          <text x={pad.l - 7} y={y(v) + 4} textAnchor="end" fill="#85837c" className="font-mono text-[11px]">{v}</text>
        </g>
      ))}
      {series.map(({ t, keep }) => (
        <g key={t.track}>
          <polygon className="speed-exhibit-band" fill={getTrackColor(t.track)} fillOpacity={0.14}
                   points={[...keep.map((i) => `${x(t.t[i]).toFixed(1)},${y(t.hi90_kmh[i]).toFixed(1)}`), ...keep.slice().reverse().map((i) => `${x(t.t[i]).toFixed(1)},${y(t.lo90_kmh[i]).toFixed(1)}`)].join(' ')} />
          <path className="speed-exhibit-line" fill="none" stroke={getTrackColor(t.track)} strokeWidth={1.75}
                d={keep.map((i, n) => `${n ? 'L' : 'M'}${x(t.t[i]).toFixed(1)} ${y(t.speed_kmh[i]).toFixed(1)}`).join('')} />
        </g>
      ))}
      <text x={W - pad.r} y={H - 8} textAnchor="end" fill="#85837c" className="font-mono text-[11px]">km/h, up to the impact</text>
    </svg>
  );
};

const VerdictExhibit: React.FC<{ data: CaseData; active: boolean }> = ({ data, active }) => {
  const claim = strongestContradiction(data);
  if (!claim || claim.value_number == null) return null;
  const m = claim.measured;
  return (
    <div className="p-5 sm:p-7">
      <VerdictTag verdict={claim.verdict} />
      <blockquote className="said mt-3 text-[24px] leading-snug">“{claim.quote}”</blockquote>
      <ClaimLine large className="mt-6" claimed={claim.value_number} kmh={m.kmh} lo={m.lo90} hi={m.hi90} verdict={claim.verdict} replayKey={active} />
    </div>
  );
};

export const OverviewView: React.FC<{ onOpenCase: () => void; onNavigate: (v: ActiveView) => void }> = ({ onOpenCase, onNavigate }) => {
  const [data, setData] = useState<CaseData | null>(null);
  const [bench, setBench] = useState<Benchmark | null>(null);
  const [step, setStep] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const steps = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadScenarioCase(STORY_CASE).then(setData).catch(() => setData(null));
    loadBenchmark().then(setBench);
  }, []);

  const claim = useMemo(() => (data ? strongestContradiction(data) : null), [data]);
  const sum = useMemo(() => (bench ? summarise(bench) : null), [bench]);

  // The opening: what was said, then what was measured, then the gap.
  useGSAP(
    () => {
      if (!data) return;
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const split = new SplitText('.hero-title', { type: 'lines,words', mask: 'lines' });
        const tl = gsap.timeline({ onComplete: () => split.revert() });
        tl.from(split.lines, { yPercent: 105, duration: 0.9, stagger: 0.09, ease: 'power4.out' })
          .from('.hero-sub > *', { autoAlpha: 0, y: 12, duration: 0.6, stagger: 0.08 }, '-=0.45')
          .from('.hero-frame', { autoAlpha: 0, duration: 0.8, ease: 'none' }, '-=0.7')
          .from('.hero-quote', { autoAlpha: 0, y: 10, duration: 0.5 }, '-=0.35');
        return () => split.revert();
      });
    },
    { scope: hero, dependencies: [Boolean(data)] },
  );

  // The story: the exhibit stays put while the steps scroll past it.
  useGSAP(
    () => {
      if (!data) return;
      const triggers = gsap.utils.toArray<HTMLElement>('.story-step').map((el, i) =>
        ScrollTrigger.create({
          trigger: el,
          start: 'top 55%',
          end: 'bottom 55%',
          onToggle: (self) => { if (self.isActive) setStep(i); },
        }));
      ScrollTrigger.refresh();
      return () => triggers.forEach((t) => t.kill());
    },
    { scope: steps, dependencies: [Boolean(data)] },
  );

  useGSAP(
    () => {
      withMotion(() => {
        const layer = `.exhibit-${STEPS[step].id}`;
        gsap.from(layer, { autoAlpha: 0, duration: 0.4, ease: 'none' });
        if (step === 1) gsap.from('.time-tick', { scaleY: 0, duration: 0.5, stagger: { amount: 0.5 } });
        if (step === 2) {
          gsap.from('.ground-path', { drawSVG: '0%', duration: 1.1, ease: 'power2.inOut', stagger: 0.1 });
          gsap.from('.ground-impact', { scale: 0, transformOrigin: 'center', duration: 0.4, delay: 1, ease: 'back.out(2)' });
        }
        if (step === 3) {
          gsap.from('.speed-exhibit-line', { drawSVG: '0%', duration: 1, ease: 'power2.inOut' });
          gsap.from('.speed-exhibit-band', { opacity: 0, duration: 0.5, delay: 0.6, ease: 'none' });
        }
      });
    },
    { scope: steps, dependencies: [step, Boolean(data)], revertOnUpdate: true },
  );

  // Numbers count up once, the first time they are seen.
  useGSAP(
    () => {
      if (!sum) return;
      withMotion(() => {
        gsap.utils.toArray<HTMLElement>('[data-count]').forEach((el) => {
          const value = Number(el.dataset.count);
          const decimals = Number(el.dataset.decimals ?? 0);
          ScrollTrigger.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => countTo(el, value, decimals) });
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: root, dependencies: [sum] },
  );

  useReveal(root, [Boolean(data), Boolean(sum)]);

  const m = claim?.measured;

  return (
    <div ref={root} className="flex-1">
      {/* Opening */}
      <section ref={hero} className="border-b border-line">
        <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-4 py-14 sm:px-6 lg:min-h-[calc(100dvh-53px)] lg:grid-cols-[minmax(0,1.14fr)_minmax(0,1fr)] lg:gap-14 lg:py-12">
          <div>
            <h1 className="hero-title display text-[clamp(44px,5.7vw,80px)]">
              People remember.<br />Physics measures.
            </h1>
            <div className="hero-sub">
              <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-bone-200">
                Sakshi (<span lang="hi">साक्षी</span>, “witness”) turns ordinary road footage into metres and seconds, then checks what
                each person said against them, with honest 90% intervals.
              </p>
              <div className="mt-7 flex flex-wrap items-center gap-2.5">
                <Button variant="primary" className="h-10 px-4 text-[14px]" icon={<ArrowRight className="h-4 w-4" />} onClick={onOpenCase}>
                  Open a case
                </Button>
                <Button variant="secondary" className="h-10 px-4 text-[14px]" onClick={() => onNavigate('system')}>How it’s built</Button>
              </div>
              <p className="mt-4 text-[13px] text-bone-400">It reports measurements for expert review. It never states who is at fault.</p>
            </div>
          </div>

          <figure className="overflow-hidden rounded border border-line bg-asphalt-900">
            <div className="hero-frame">
              {data ? <TrackExhibit data={data} /> : <div className="aspect-video animate-pulse bg-asphalt-800" />}
            </div>
            <figcaption className="hero-quote border-t border-line p-4 sm:p-5">
              {claim && m ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <blockquote className="said text-[18px] leading-snug sm:text-[20px]">“{claim.quote}”</blockquote>
                    <VerdictTag verdict={claim.verdict} className="mt-1" />
                  </div>
                  <ClaimLine className="mt-3" large claimed={claim.value_number!} kmh={m.kmh} lo={m.lo90} hi={m.hi90} verdict={claim.verdict} />
                  <p className="mt-2 text-[12px] text-bone-500">
                    {data && vehicleName(data, claim.subject_track)}, km/h, one CARLA simulated crash with degraded CCTV footage
                  </p>
                </>
              ) : <div className="h-36 animate-pulse rounded bg-asphalt-800" />}
            </figcaption>
          </figure>
        </div>
      </section>

      {/* The problem */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 py-20 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-14">
            <div data-reveal>
              <h2 className="h-section">After a crash, the footage rarely settles it.</h2>
              <p className="prose-muted mt-4 text-[16px]">
                Each side remembers it differently. A camera often saw it, but cheap CCTV means low resolution, heavy compression
                and silently lost frames. Reading a defensible speed from that is specialist work, so the dispute can come down to whose account sounds surest.
              </p>
            </div>
            <dl className="grid content-start gap-px self-start overflow-hidden rounded border border-line bg-line sm:grid-cols-2" data-reveal>
              <div className="bg-asphalt-900 p-5">
                <dd className="measured text-[38px] leading-none text-bone">1.19 M</dd>
                <dt className="mt-2 text-[13px] leading-snug text-bone-300">road deaths a year worldwide<sup className="ml-0.5 text-bone-500">1</sup></dt>
              </div>
              <div className="bg-asphalt-900 p-5">
                <dd className="measured text-[38px] leading-none text-bone">480,583</dd>
                <dt className="mt-2 text-[13px] leading-snug text-bone-300">reported road accidents in India in 2023, with 172,890 deaths<sup className="ml-0.5 text-bone-500">2</sup></dt>
              </div>
            </dl>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden rounded border border-line bg-line md:grid-cols-3">
            {AUDIENCE.map(([who, what]) => (
              <div key={who} data-reveal className="bg-asphalt-900 p-5">
                <h3 className="text-[15px] text-bone">{who}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-bone-300">{what}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The method */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 pt-20 sm:px-6">
          <h2 data-reveal className="h-section max-w-3xl">From a noisy clip to a checkable answer.</h2>
          <p data-reveal className="prose-muted mt-3 max-w-2xl text-[16px]">One real case, start to finish: a clip degraded to cheap CCTV, measured by the same pipeline you can open below.</p>
        </div>
        <div ref={steps} className="mx-auto mt-6 grid max-w-page gap-x-14 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
          {/* Exhibit: stays in view while the steps pass */}
          <div className="sticky top-[96px] z-10 order-first self-start lg:order-last lg:top-[calc(50vh-190px)]">
            <div className="overflow-hidden rounded border border-line bg-asphalt-900">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
                <span className="eyebrow">{STEPS[step].model}</span>
                <span className="measured text-[12px] text-bone-500">{step + 1}/{STEPS.length}</span>
              </div>
              <div className="relative min-h-[190px]">
                {data && (
                  <div className={`exhibit-${STEPS[step].id}`}>
                    {step === 0 && <TrackExhibit data={data} />}
                    {step === 1 && <TimeExhibit data={data} />}
                    {step === 2 && <GroundExhibit data={data} />}
                    {step === 3 && <SpeedExhibit data={data} />}
                    {step === 4 && <VerdictExhibit data={data} active={step === 4} />}
                  </div>
                )}
              </div>
            </div>
          </div>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id} className={`story-step flex min-h-[46vh] flex-col justify-center transition-opacity duration-300 lg:min-h-[64vh] ${step === i ? 'opacity-100' : 'opacity-40'}`}>
                <div className="measured text-[13px] text-paint">{i + 1}</div>
                <h3 className="mt-1 font-serif text-[26px] font-light leading-tight text-bone sm:text-[30px]">{s.title}</h3>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-bone-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Models */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 py-20 sm:px-6">
          <h2 data-reveal className="h-section max-w-3xl">Meta’s models see, read and listen. They never do the sums.</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {MODELS.map((model) => (
              <div key={model.id} data-reveal className="grid gap-x-8 gap-y-1 py-3.5 sm:grid-cols-[110px_200px_1fr]">
                <div className="eyebrow pt-1">{model.role}</div>
                <div className="text-[15px] text-bone">{model.name}</div>
                <div className="text-[14px] leading-relaxed text-bone-300">{model.enables}</div>
              </div>
            ))}
          </div>
          <div data-reveal className="mt-4">
            <Button variant="ghost" className="-ml-3" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => onNavigate('system')}>Models, pipeline and architecture</Button>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 py-20 sm:px-6">
          <h2 data-reveal className="h-section max-w-3xl">Tested where the true answer is known.</h2>
          <p data-reveal className="prose-muted mt-3 max-w-2xl text-[16px]">
            {sum?.scenarios ?? 16} crashes rendered in CARLA, with exact ground truth the pipeline never sees: night, rain, traffic, scooters, a near miss.
          </p>
          {sum && (
            <dl data-reveal className="hairline-grid mt-8 grid overflow-hidden rounded border border-line sm:grid-cols-3">
              <div className="bg-asphalt-900 p-5">
                <dd className="measured text-[44px] leading-none text-signal-green" data-count={sum.wrong}>{sum.wrong}</dd>
                <dt className="mt-2 text-[14px] leading-snug text-bone-300">wrong verdicts in {sum.claims} claims. {sum.correct} right; {sum.declined} answered “can’t tell”.</dt>
              </div>
              <div className="bg-asphalt-900 p-5">
                <dd className="measured text-[44px] leading-none text-bone"><span data-count={sum.impactsFound}>{sum.impactsFound}</span><span className="text-bone-500">/{sum.crashes}</span></dd>
                <dt className="mt-2 text-[14px] leading-snug text-bone-300">impacts found, median {sum.medianImpactErrorS.toFixed(2)} s off. The near miss was correctly called no impact.</dt>
              </div>
              <div className="bg-asphalt-900 p-5">
                <dd className="measured text-[44px] leading-none text-bone"><span data-count={sum.medianErrorPct} data-decimals="1">{sum.medianErrorPct.toFixed(1)}</span><span className="text-[22px] text-bone-500">%</span></dd>
                <dt className="mt-2 text-[14px] leading-snug text-bone-300">median speed error before impact. Intervals still run narrow: {sum.medianCoveragePct.toFixed(0)}% coverage against a promised 90%.</dt>
              </div>
            </dl>
          )}
          <div data-reveal className="mt-4">
            <Button variant="ghost" className="-ml-3" icon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => onNavigate('accuracy')}>Every scenario, and what still falls short</Button>
          </div>
        </div>
      </section>

      {/* Close */}
      <section>
        <div className="mx-auto max-w-page px-4 py-20 text-center sm:px-6">
          <div data-reveal className="flex justify-center"><Mark className="h-8 w-8" /></div>
          <h2 data-reveal className="h-section mx-auto mt-5 max-w-2xl">Scrub through a crash, and test a claim yourself.</h2>
          <div data-reveal className="mt-7">
            <Button variant="primary" className="h-10 px-4 text-[14px]" icon={<ArrowRight className="h-4 w-4" />} onClick={onOpenCase}>Open a case</Button>
          </div>
        </div>
        <footer className="border-t border-line">
          <div className="mx-auto max-w-page space-y-1 px-4 py-5 text-[12px] leading-relaxed text-bone-500 sm:px-6">
            <p>
              1. <a className="underline hover:text-bone" href="https://www.who.int/publications/i/item/9789240086517" target="_blank" rel="noreferrer">WHO, Global status report on road safety 2023</a>.{' '}
              2. <a className="underline hover:text-bone" href="https://morth.nic.in/sites/default/files/Road-Accident-in-India-2023-Publications.pdf" target="_blank" rel="noreferrer">MoRTH, Road Accidents in India 2023</a>.
            </p>
            <p>Sakshi is a measurement tool. It does not determine fault or legal liability. All footage shown is simulator output.</p>
          </div>
        </footer>
      </section>
    </div>
  );
};
