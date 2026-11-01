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

/** Small label above a section. Words only: the page reads in order without numbering. */
const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div data-reveal className="mb-4 flex items-center gap-2.5">
    <span className="h-px w-7 bg-paint" aria-hidden="true" />
    <span className="text-[12px] font-medium uppercase tracking-[0.16em] text-paint">{children}</span>
  </div>
);

const TRUE_SPEED_KMH = 50;

/** The arithmetic of a lost frame: a worked example, so anyone can try it. */
const ClockCard: React.FC = () => {
  const [lostPct, setLostPct] = useState(20);
  const naive = TRUE_SPEED_KMH / (1 - lostPct / 100);
  return (
    <article data-reveal className="why-card flex flex-col overflow-hidden rounded-lg border border-line bg-asphalt-900 transition-colors duration-300 hover:border-paint/40">
      <div className="p-5 pb-4 sm:p-6 sm:pb-4">
        <div className="text-[12px] uppercase tracking-[0.12em] text-signal-amber">Time</div>
        <h3 className="mt-2 font-serif text-[23px] font-light leading-tight text-bone">The clock can be wrong</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-bone-300">
          Cheap recorders lose frames but still claim 25 fps. Fewer frames look like less time, so the car looks faster. Sakshi looks for where the frames went, and widens its range when it can’t tell.
        </p>
      </div>
      <div className="mt-auto border-t border-line bg-asphalt-950/50 p-5 sm:p-6">
        <div className="flex h-9 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 40 }, (_, i) => (
            <span key={i} className={`min-w-0 flex-1 rounded-[1px] transition-colors duration-200 ${(i * 37) % 100 < lostPct ? 'bg-signal-red/25' : 'bg-bone-400'}`} />
          ))}
        </div>
        <label className="mt-4 block text-[13px] text-bone-300">
          <span className="flex justify-between"><span>Frames lost</span><span className="measured text-signal-amber">{lostPct}%</span></span>
          <input type="range" min={0} max={30} step={5} value={lostPct} onChange={(e) => setLostPct(Number(e.target.value))} className="mt-2 w-full cursor-pointer accent-[#f2c037]" />
        </label>
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <dt className="text-[12px] text-bone-400">Real speed</dt>
            <dd className="measured mt-0.5 text-[24px] text-bone">{TRUE_SPEED_KMH} <span className="text-[13px] text-bone-500">km/h</span></dd>
          </div>
          <div>
            <dt className="text-[12px] text-bone-400">Simple sum says</dt>
            <dd className={`measured mt-0.5 text-[24px] ${lostPct ? 'text-signal-amber' : 'text-bone'}`}>{naive.toFixed(1)} <span className="text-[13px] text-bone-500">km/h</span></dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] text-bone-500">A worked example of the arithmetic, not a measurement.</p>
      </div>
    </article>
  );
};

const invert3 = (H: number[][]): number[][] | null => {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
};

const RULER_STEP_M = 5;

/** Equal steps on the road, drawn where they really fall in the image. */
const RulerCard: React.FC<{ data: CaseData }> = ({ data }) => {
  const dots = useMemo(() => {
    const inv = invert3(data.calibration.H);
    if (!inv) return [];
    const end = data.events[0]?.t ?? Infinity;
    const { width, height } = data.clip;
    const paths = data.trajectories.map((t) => {
      const out: { u: number; v: number }[] = [];
      let last: [number, number] | null = null;
      t.x.forEach((x, i) => {
        const y = t.y[i];
        if (t.t[i] > end || (last && Math.hypot(x - last[0], y - last[1]) < RULER_STEP_M)) return;
        last = [x, y];
        const w = inv[2][0] * x + inv[2][1] * y + inv[2][2];
        const u = (inv[0][0] * x + inv[0][1] * y + inv[0][2]) / w;
        const v = (inv[1][0] * x + inv[1][1] * y + inv[1][2]) / w;
        if (u >= 0 && u <= width && v >= 0 && v <= height) out.push({ u, v });
      });
      return out;
    });
    return paths.reduce((best, p) => (p.length > best.length ? p : best), [] as { u: number; v: number }[]);
  }, [data]);
  return (
    <article data-reveal className="why-card flex flex-col overflow-hidden rounded-lg border border-line bg-asphalt-900 transition-colors duration-300 hover:border-paint/40">
      <div className="p-5 pb-4 sm:p-6 sm:pb-4">
        <div className="text-[12px] uppercase tracking-[0.12em] text-paint">Distance</div>
        <h3 className="mt-2 font-serif text-[23px] font-light leading-tight text-bone">The ruler changes size</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-bone-300">
          A camera sees the road at an angle, so a pixel far away covers more road than one nearby. Sakshi maps the picture onto the road first, then measures.
        </p>
      </div>
      <div className="relative mt-auto border-t border-line">
        <img src={scenarioThumbUrl(STORY_CASE)} alt="The simulated junction, with points marked at equal distances along a vehicle's path" className="block w-full" />
        <svg viewBox={`0 0 ${data.clip.width} ${data.clip.height}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
          {dots.map((d, i) => (
            <circle key={i} className="ruler-dot" cx={d.u} cy={d.v} r={data.clip.width / 90} fill="#f2c037" stroke="#0a0b0c" strokeWidth={data.clip.width / 400} />
          ))}
        </svg>
        <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-asphalt-950 to-transparent px-4 pb-3 pt-10 text-[12.5px] text-bone-200">
          Each dot is {RULER_STEP_M} m further along the measured path. Same distance, very different pixels.
        </p>
      </div>
    </article>
  );
};

/** A number alone versus an answer to the question being asked, from the real case. */
const AnswerCard: React.FC<{ data: CaseData }> = ({ data }) => {
  const claim = strongestContradiction(data);
  const m = claim?.measured;
  return (
    <article data-reveal className="why-card flex flex-col overflow-hidden rounded-lg border border-line bg-asphalt-900 transition-colors duration-300 hover:border-paint/40">
      <div className="p-5 pb-4 sm:p-6 sm:pb-4">
        <div className="text-[12px] uppercase tracking-[0.12em] text-signal-green">The question</div>
        <h3 className="mt-2 font-serif text-[23px] font-light leading-tight text-bone">A speed isn’t the answer</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-bone-300">
          People ask whether a statement holds up. Sakshi states how sure the measurement is, checks the claim against it, and says “can’t tell” when the footage can’t settle it.
        </p>
      </div>
      {claim && m && (
        <div className="mt-auto border-t border-line bg-asphalt-950/50 p-5 sm:p-6">
          <div className="text-[12px] text-bone-400">A simple sum stops here</div>
          <div className="measured mt-1 text-[32px] leading-none text-bone-300">{m.kmh.toFixed(0)} <span className="text-[14px] text-bone-500">km/h</span></div>
          <div className="my-4 h-px bg-line" />
          <div className="flex items-start justify-between gap-3">
            <div className="text-[12px] text-bone-400">Sakshi goes on</div>
            <VerdictTag verdict={claim.verdict} />
          </div>
          <blockquote className="said mt-2 text-[17px] leading-snug">“{claim.quote}”</blockquote>
          <ClaimLine className="mt-3" claimed={claim.value_number!} kmh={m.kmh} lo={m.lo90} hi={m.hi90} verdict={claim.verdict} />
        </div>
      )}
    </article>
  );
};

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
  const why = useRef<HTMLElement>(null);
  const close = useRef<HTMLElement>(null);

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
        tl.from('.hero-road path', { drawSVG: '50% 50%', duration: 1.6, stagger: 0.05, ease: 'power2.inOut' })
          .from(split.lines, { yPercent: 105, duration: 0.9, stagger: 0.09, ease: 'power4.out' }, 0.1)
          .from('.hero-sub > *', { autoAlpha: 0, y: 12, duration: 0.6, stagger: 0.08 }, '-=0.45')
          .from('.hero-frame', { autoAlpha: 0, duration: 0.8, ease: 'none' }, '-=0.7')
          .from('.hero-quote', { autoAlpha: 0, y: 10, duration: 0.5 }, '-=0.35')
          .from('.hero-corner', { autoAlpha: 0, scale: 1.5, duration: 0.5, stagger: 0.05, transformOrigin: 'center' }, '-=0.5');
        // A scan passes over the frame, as if the footage is being read.
        gsap.fromTo('.hero-scan', { yPercent: -100 }, { yPercent: 1100, duration: 4.5, ease: 'none', repeat: -1, repeatDelay: 1.5 });
        gsap.to('.hero-figure', {
          y: -36, ease: 'none',
          scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: 0.6 },
        });
        gsap.to('.hero-road', {
          yPercent: 12, ease: 'none',
          scrollTrigger: { trigger: hero.current, start: 'top top', end: 'bottom top', scrub: true },
        });
        // The glow follows the pointer.
        const box0 = hero.current?.getBoundingClientRect();
        if (box0) gsap.set('.hero-glow', { x: box0.width * 0.72, y: box0.height * 0.42 });
        const glowX = gsap.quickTo('.hero-glow', 'x', { duration: 1.1, ease: 'power3' });
        const glowY = gsap.quickTo('.hero-glow', 'y', { duration: 1.1, ease: 'power3' });
        const onMove = (e: PointerEvent) => {
          const box = hero.current?.getBoundingClientRect();
          if (box) { glowX(e.clientX - box.left); glowY(e.clientY - box.top); }
        };
        const el = hero.current;
        el?.addEventListener('pointermove', onMove);
        return () => { el?.removeEventListener('pointermove', onMove); split.revert(); };
      });
    },
    { scope: hero, dependencies: [Boolean(data)] },
  );

  // The equation lights up as you reach it, then the real ruler points appear.
  useGSAP(
    () => {
      if (!data) return;
      withMotion(() => {
        gsap.timeline({ scrollTrigger: { trigger: '.why-equation', start: 'top 85%', end: 'top 40%', scrub: 0.5 } })
          .fromTo('.eq-time', { color: '#99978f' }, { color: '#f0a63a', ease: 'none' })
          .fromTo('.eq-distance', { color: '#99978f' }, { color: '#f2c037', ease: 'none' }, 0)
          .fromTo('.eq-rule', { scaleX: 0 }, { scaleX: 1, ease: 'none', transformOrigin: 'left center' }, 0);
        gsap.from('.ruler-dot', {
          scale: 0, transformOrigin: 'center', duration: 0.4, stagger: 0.09, ease: 'back.out(2.5)',
          scrollTrigger: { trigger: '.ruler-dot', start: 'top 85%', once: true },
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: why, dependencies: [Boolean(data)] },
  );

  // The measured paths draw themselves as the page closes.
  useGSAP(
    () => {
      if (!data) return;
      withMotion(() => {
        gsap.from('.close-path', {
          drawSVG: '0%', ease: 'none', stagger: 0.1,
          scrollTrigger: { trigger: close.current, start: 'top 90%', end: 'top 25%', scrub: 0.6 },
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: close, dependencies: [Boolean(data)] },
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
      const fill = withMotion(() => {
        gsap.fromTo('.rail-fill', { scaleY: 0 }, {
          scaleY: 1, ease: 'none', transformOrigin: 'top center',
          scrollTrigger: { trigger: '.story-steps', start: 'top 55%', end: 'bottom 55%', scrub: 0.3 },
        });
      });
      ScrollTrigger.refresh();
      return () => { triggers.forEach((t) => t.kill()); fill.revert(); };
    },
    { scope: steps, dependencies: [Boolean(data)] },
  );

  useGSAP(
    () => {
      if (!data) return;
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
      <section ref={hero} className="relative overflow-hidden border-b border-line">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <svg className="hero-road absolute inset-x-0 bottom-0 h-[78%] w-full opacity-[0.22]" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMax slice" fill="none">
            {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((n) => (
              <path key={n} d={`M${600 + n * 22} 0 L${600 + n * 300} 600`} stroke={n === 0 ? '#f2c037' : '#edeae3'} strokeWidth={n === 0 ? 1.4 : 0.7} strokeDasharray={n === 0 ? '14 12' : undefined} />
            ))}
            {[60, 130, 215, 320, 445, 590].map((y) => <path key={y} d={`M0 ${y} H1200`} stroke="#edeae3" strokeWidth={0.5} opacity={y / 900} />)}
          </svg>
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-asphalt-950 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-asphalt-950 to-transparent" />
          <div className="hero-glow absolute left-0 top-0 -ml-[260px] -mt-[260px] h-[520px] w-[520px] rounded-full bg-paint/[0.09] blur-[90px]" />
        </div>
        <div className="relative mx-auto grid max-w-[1320px] items-center gap-10 px-4 py-14 sm:px-6 lg:min-h-[calc(100dvh-53px)] lg:grid-cols-[minmax(0,1.14fr)_minmax(0,1fr)] lg:gap-14 lg:py-12">
          <div>
            <div className="hero-sub mb-5 inline-flex items-center gap-2 rounded-full border border-line-strong bg-asphalt-900/70 px-3 py-1 text-[12.5px] text-bone-200 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-paint" aria-hidden="true" />
              Built on Meta’s SAM 3.1 and Muse models
            </div>
            <h1 className="hero-title display text-[clamp(44px,5.7vw,80px)]">
              People remember.<br /><span className="text-paint">Physics measures.</span>
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

          <figure className="hero-figure relative overflow-hidden rounded-lg border border-line-strong bg-asphalt-900 shadow-[0_30px_90px_-30px_rgba(242,192,55,0.28)]">
            <div className="hero-frame relative overflow-hidden">
              {data ? <TrackExhibit data={data} /> : <div className="aspect-video animate-pulse bg-asphalt-800" />}
              <div className="hero-scan pointer-events-none absolute inset-x-0 top-0 h-[10%] bg-gradient-to-b from-transparent via-paint/20 to-paint/40" aria-hidden="true" />
              {['left-2 top-2 border-l border-t', 'right-2 top-2 border-r border-t', 'bottom-2 left-2 border-b border-l', 'bottom-2 right-2 border-b border-r'].map((c) => (
                <span key={c} className={`hero-corner pointer-events-none absolute h-4 w-4 border-paint ${c}`} aria-hidden="true" />
              ))}
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
            <div>
              <Eyebrow>The problem</Eyebrow>
              <div data-reveal>
              <h2 className="h-section">After a crash, the footage rarely settles it.</h2>
              <p className="prose-muted mt-4 text-[16px]">
                Each side remembers it differently. A camera often saw it, but cheap CCTV means low resolution, heavy compression
                and silently lost frames. Reading a defensible speed from that is specialist work, so the dispute can come down to whose account sounds surest.
              </p>
              </div>
            </div>
            <dl className="grid content-start gap-px self-start overflow-hidden rounded border border-line bg-line sm:grid-cols-2" data-reveal>
              <div className="bg-asphalt-900 p-6">
                <dd className="measured text-[38px] leading-none text-bone">1.19 M</dd>
                <dt className="mt-2 text-[13px] leading-snug text-bone-300">road deaths a year worldwide<sup className="ml-0.5 text-bone-500">1</sup></dt>
              </div>
              <div className="bg-asphalt-900 p-6">
                <dd className="measured text-[38px] leading-none text-bone">480,583</dd>
                <dt className="mt-2 text-[13px] leading-snug text-bone-300">reported road accidents in India in 2023, with 172,890 deaths<sup className="ml-0.5 text-bone-500">2</sup></dt>
              </div>
            </dl>
          </div>

          <div className="mt-14 grid gap-px overflow-hidden rounded border border-line bg-line md:grid-cols-3">
            {AUDIENCE.map(([who, what]) => (
              <div key={who} data-reveal className="bg-asphalt-900 p-6 transition-colors duration-300 hover:bg-asphalt-850">
                <h3 className="text-[15px] text-bone">{who}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-bone-300">{what}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The honest question */}
      <section ref={why} className="relative overflow-hidden border-b border-line bg-asphalt-950">
        <div className="mx-auto max-w-page px-4 py-24 sm:px-6">
          <Eyebrow>A fair question</Eyebrow>
          <h2 data-reveal className="h-section max-w-3xl">Couldn’t you just divide distance by time?</h2>
          <p data-reveal className="prose-muted mt-4 max-w-2xl text-[16px]">
            You could, and a skilled analyst can. Sakshi does the same arithmetic. The hard part is whether cheap footage can be trusted for that distance and that time, and what the result says about what someone claimed.
          </p>
          <div className="why-equation mt-10 font-serif text-[clamp(28px,5vw,56px)] font-light leading-tight text-bone" aria-label="Speed equals distance divided by time">
            speed = <span className="eq-distance">distance</span> ÷ <span className="eq-time">time</span>
            <div className="eq-rule mt-3 h-px w-full max-w-2xl bg-gradient-to-r from-paint to-transparent" aria-hidden="true" />
          </div>
          {data ? (
            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              <ClockCard />
              <RulerCard data={data} />
              <AnswerCard data={data} />
            </div>
          ) : <div className="mt-10 h-96 animate-pulse rounded-lg bg-asphalt-850" />}
          <p data-reveal className="mt-8 max-w-3xl text-[15px] leading-relaxed text-bone-200">
            Sakshi doesn’t replace an expert. It’s for the person holding a clip without an analyst nearby: a first answer that shows its working and its doubt, ready for an expert to check.
          </p>
        </div>
      </section>

      {/* The method */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 pt-20 sm:px-6">
          <Eyebrow>The method</Eyebrow>
          <h2 data-reveal className="h-section max-w-3xl">From a noisy clip to a checkable answer.</h2>
          <p data-reveal className="prose-muted mt-3 max-w-2xl text-[16px]">One real case, start to finish: a clip degraded to cheap CCTV, measured by the same pipeline you can open below.</p>
        </div>
        <div ref={steps} className="mx-auto mt-6 grid max-w-page gap-x-14 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]">
          {/* Exhibit: stays in view while the steps pass */}
          <div className="sticky top-[96px] z-10 order-first self-start lg:order-last lg:top-[calc(50vh-190px)]">
            <div className="overflow-hidden rounded-lg border border-line-strong bg-asphalt-900 shadow-[0_24px_70px_-34px_rgba(242,192,55,0.3)]">
              <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                <span className="eyebrow">{STEPS[step].model}</span>
                <span className="flex gap-1" aria-hidden="true">
                  {STEPS.map((x, i) => <span key={x.id} className={`h-1 w-5 rounded-full transition-colors duration-300 ${i <= step ? 'bg-paint' : 'bg-asphalt-600'}`} />)}
                </span>
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
          <ol className="story-steps relative">
            <span className="absolute bottom-[23vh] left-[5px] top-[23vh] w-px bg-line-strong lg:bottom-[32vh] lg:top-[32vh]" aria-hidden="true">
              <span className="rail-fill block h-full w-full bg-paint" />
            </span>
            {STEPS.map((s, i) => (
              <li key={s.id} className={`story-step relative flex min-h-[46vh] flex-col justify-center pl-8 transition-opacity duration-300 lg:min-h-[64vh] ${step === i ? 'opacity-100' : 'opacity-40'}`}>
                <span className={`absolute left-0 top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full border transition-all duration-300 ${step >= i ? 'border-paint bg-paint' : 'border-line-strong bg-asphalt-950'} ${step === i ? 'shadow-[0_0_0_5px_rgba(242,192,55,0.16)]' : ''}`} aria-hidden="true" />
                <h3 className="font-serif text-[26px] font-light leading-tight text-bone sm:text-[30px]">{s.title}</h3>
                <p className="mt-2 max-w-md text-[15px] leading-relaxed text-bone-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Models */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-page px-4 py-20 sm:px-6">
          <Eyebrow>The models</Eyebrow>
          <h2 data-reveal className="h-section max-w-3xl">Meta’s models see, read and listen. They never do the sums.</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {MODELS.map((model) => (
              <div key={model.id} data-reveal className="grid gap-x-8 gap-y-1 border-l-2 border-transparent py-4 pl-3 transition-colors duration-300 hover:border-paint hover:bg-asphalt-900 sm:grid-cols-[110px_200px_1fr]">
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
          <Eyebrow>The evidence</Eyebrow>
          <h2 data-reveal className="h-section max-w-3xl">Tested where the true answer is known.</h2>
          <p data-reveal className="prose-muted mt-3 max-w-2xl text-[16px]">
            {sum?.scenarios ?? 16} crashes rendered in CARLA, with exact ground truth the pipeline never sees: night, rain, traffic, scooters, a near miss.
          </p>
          {sum && (
            <dl data-reveal className="hairline-grid mt-8 grid overflow-hidden rounded border border-line sm:grid-cols-3">
              <div className="bg-asphalt-900 p-6 transition-colors duration-300 hover:bg-asphalt-850">
                <dd className="measured text-[44px] leading-none text-signal-green" data-count={sum.wrong}>{sum.wrong}</dd>
                <dt className="mt-2 text-[14px] leading-snug text-bone-300">wrong verdicts in {sum.claims} claims. {sum.correct} right; {sum.declined} answered “can’t tell”.</dt>
              </div>
              <div className="bg-asphalt-900 p-6 transition-colors duration-300 hover:bg-asphalt-850">
                <dd className="measured text-[44px] leading-none text-bone"><span data-count={sum.impactsFound}>{sum.impactsFound}</span><span className="text-bone-500">/{sum.crashes}</span></dd>
                <dt className="mt-2 text-[14px] leading-snug text-bone-300">impacts found, median {sum.medianImpactErrorS.toFixed(2)} s off. The near miss was correctly called no impact.</dt>
              </div>
              <div className="bg-asphalt-900 p-6 transition-colors duration-300 hover:bg-asphalt-850">
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
      <section ref={close} className="relative overflow-hidden">
        <div className="relative mx-auto max-w-page px-4 py-28 text-center sm:px-6">
          {data && (() => {
            const W = 1200, H = 520, f = fitPath(data, W, H);
            return (
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="pointer-events-none absolute inset-x-[6%] inset-y-10 h-[calc(100%-5rem)] w-[88%] opacity-25" aria-hidden="true">
                {data.trajectories.map((t) => (
                  <path key={t.track} className="close-path" fill="none" stroke={getTrackColor(t.track)} strokeWidth={2.5}
                        d={t.x.map((x, i) => `${i ? 'L' : 'M'}${f.x(x).toFixed(1)} ${f.y(t.y[i]).toFixed(1)}`).join('')} />
                ))}
              </svg>
            );
          })()}
          <div data-reveal className="relative flex justify-center"><Mark className="h-8 w-8" /></div>
          <h2 data-reveal className="h-section relative mx-auto mt-5 max-w-2xl">Scrub through a crash, and test a claim yourself.</h2>
          <div data-reveal className="relative mt-7">
            <Button variant="primary" className="h-10 px-4 text-[14px]" icon={<ArrowRight className="h-4 w-4" />} onClick={onOpenCase}>Open a case</Button>
          </div>
        </div>
        <footer className="relative border-t border-line">
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
