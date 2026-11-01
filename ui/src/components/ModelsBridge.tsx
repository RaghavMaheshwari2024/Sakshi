/**
 * A brief passage from the front page into the workspace: how Meta's models feed
 * the physics. The workspace is already loaded underneath, so this never makes
 * anyone wait: any click or key ends it at once.
 */
import React, { useEffect, useRef } from 'react';
import { gsap, useGSAP } from '../lib/motion';

const STAGES = [
  { model: 'SAM 3.1', from: 'A vehicle’s mask', to: 'The tyre on the road, in metres' },
  { model: 'Muse Spark', from: 'A burned-in clock', to: 'True time, and the frames lost' },
  { model: 'Muse Wonder', from: '“Main blue car chala raha tha, shayad 30 pe”', to: 'A claim physics can test' },
];

export const ModelsBridge: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const root = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const timeline = useRef<gsap.core.Timeline | null>(null);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onDone();
  };

  useGSAP(
    () => {
      timeline.current = gsap.timeline({ onComplete: finish })
        .from('.bridge-title', { autoAlpha: 0, y: 12, duration: 0.4 })
        .from('.bridge-stage', { autoAlpha: 0, y: 18, duration: 0.42, stagger: 0.1 }, '-=0.22')
        .from('.bridge-link path', { drawSVG: '0%', duration: 0.42, stagger: 0.05, ease: 'power2.inOut' }, '-=0.2')
        .from('.bridge-engine', { autoAlpha: 0, scale: 0.96, duration: 0.3, ease: 'back.out(1.6)' }, '-=0.14')
        .to({}, { duration: 0.75 })
        .to('.bridge-content', { autoAlpha: 0, y: -14, scale: 0.985, duration: 0.3, ease: 'power2.in' })
        .to(root.current, { autoAlpha: 0, duration: 0.38, ease: 'power1.inOut' }, '-=0.14');
    },
    { scope: root },
  );

  // Asked to leave: finish quickly from wherever it is, rather than cutting.
  const leave = () => {
    const tl = timeline.current;
    if (finished.current || !tl) return;
    tl.pause();
    gsap.to(root.current, { autoAlpha: 0, duration: 0.18, ease: 'none', onComplete: finish });
  };

  useEffect(() => {
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
    // `leave` only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} role="status" onPointerDown={leave}
         className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center overflow-y-auto bg-asphalt-950 px-4 py-8 sm:px-6">
      <div className="bridge-content w-full max-w-[1040px]">
        <h2 className="bridge-title mx-auto max-w-2xl text-center font-serif text-[clamp(25px,3.4vw,40px)] font-light leading-tight text-bone">
          Meta’s models read the scene. <span className="text-paint">Physics does the sums.</span>
        </h2>

        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {STAGES.map((s) => (
            <div key={s.model} className="bridge-stage rounded-lg border border-line-strong bg-asphalt-900 p-4 sm:p-5">
              <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-paint">{s.model}</div>
              <p className="mt-2.5 text-[13.5px] leading-snug text-bone-400">{s.from}</p>
              <p className="mt-1 text-[15px] leading-snug text-bone">→ {s.to}</p>
            </div>
          ))}
        </div>

        <svg className="bridge-link hidden h-14 w-full md:block" viewBox="0 0 1040 56" preserveAspectRatio="none" fill="none" aria-hidden="true">
          <path d="M173 0 C173 34 520 20 520 56" stroke="#f2c037" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <path d="M520 0 V56" stroke="#f2c037" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <path d="M867 0 C867 34 520 20 520 56" stroke="#f2c037" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </svg>

        <div className="bridge-engine mx-auto mt-3 w-fit rounded-lg border border-paint/50 bg-paint-soft px-5 py-2.5 text-center md:mt-0">
          <div className="text-[15px] text-bone">Physics engine</div>
          <div className="mt-0.5 text-[12.5px] text-bone-300">Speed in km/h, with a 90% range</div>
        </div>
      </div>
    </div>
  );
};
