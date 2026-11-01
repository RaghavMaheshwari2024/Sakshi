/**
 * The step from the front page into the workspace: how Meta's models feed the
 * physics. It stays until the user moves on, so it can be read at any pace. The
 * workspace is already loaded underneath, so leaving is immediate.
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
  const leaving = useRef(false);

  const { contextSafe } = useGSAP(
    () => {
      gsap.timeline()
        .from('.bridge-title', { autoAlpha: 0, y: 12, duration: 0.4 })
        .from('.bridge-stage', { autoAlpha: 0, y: 18, duration: 0.42, stagger: 0.1 }, '-=0.22')
        .from('.bridge-link path', { drawSVG: '0%', duration: 0.42, stagger: 0.05, ease: 'power2.inOut' }, '-=0.2')
        .from('.bridge-engine', { autoAlpha: 0, scale: 0.96, duration: 0.3, ease: 'back.out(1.6)' }, '-=0.14')
        .from('.bridge-hint', { autoAlpha: 0, duration: 0.4, ease: 'none' }, '+=0.15')
        .to('.bridge-hint', { opacity: 0.45, duration: 1.1, ease: 'sine.inOut', repeat: -1, yoyo: true });
    },
    { scope: root },
  );

  const leave = contextSafe(() => {
    if (leaving.current) return;
    leaving.current = true;
    gsap.timeline({ onComplete: onDone })
      .to('.bridge-content', { autoAlpha: 0, y: -14, scale: 0.985, duration: 0.26, ease: 'power2.in', overwrite: true })
      .to(root.current, { autoAlpha: 0, duration: 0.32, ease: 'power1.inOut' }, '-=0.12');
  });

  // The keyboard route to the same click.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        leave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leave]);

  return (
    <div ref={root} role="dialog" aria-label="How Meta's models feed the physics" onClick={leave}
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

        <p className="bridge-hint mt-8 text-center text-[13.5px] text-bone-300">Click anywhere to open the investigation</p>
      </div>
    </div>
  );
};
