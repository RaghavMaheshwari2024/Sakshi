/**
 * The product's signature mark: what someone said, placed on the same ruler as
 * what the footage measured. The bar is the 90% interval, the tick the measured
 * value, the diamond the claim. Drawn only from the claim's own numbers.
 */
import React, { useRef } from 'react';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';
import type { Claim } from '../types/case';

interface ClaimLineProps {
  claimed: number;
  kmh: number;
  lo: number;
  hi: number;
  verdict: Claim['verdict'];
  /** Larger type for the story; compact in the claims list. */
  large?: boolean;
  /** Replays the draw when this changes. */
  replayKey?: unknown;
  className?: string;
}

const TONE: Record<Claim['verdict'], string> = {
  consistent: '#4fbf8b',
  inconsistent: '#ef5a4c',
  cant_tell: '#b4b1a9',
};

export const ClaimLine: React.FC<ClaimLineProps> = ({ claimed, kmh, lo, hi, verdict, large, replayKey, className = '' }) => {
  const root = useRef<HTMLDivElement>(null);
  const lowest = Math.min(claimed, lo), highest = Math.max(claimed, hi);
  const pad = Math.max(4, (highest - lowest) * 0.22);
  const min = Math.max(0, lowest - pad), max = highest + pad;
  const at = (v: number) => ((v - min) / (max - min)) * 100;
  const tone = TONE[verdict] ?? TONE.cant_tell;
  const left = Math.min(at(claimed), at(lo)), right = Math.max(at(claimed), at(hi));
  const inside = claimed >= lo && claimed <= hi;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.cl-band', { scaleX: 0, duration: 0.55 })
        .from('.cl-tick', { scaleY: 0, duration: 0.3 }, '-=0.25')
        .from('.cl-claim', { scale: 0, duration: 0.35, ease: 'back.out(2)' }, '-=0.15')
        .from('.cl-gap', { scaleX: 0, duration: 0.45 }, '-=0.1')
        .from('.cl-label', { autoAlpha: 0, duration: 0.3, stagger: 0.04 }, '-=0.3');
    },
    { scope: root, dependencies: [replayKey, claimed, kmh, lo, hi], revertOnUpdate: true },
  );

  const labelSize = large ? 'text-[15px]' : 'text-[11.5px]';
  const clampStyle = (v: number): React.CSSProperties => ({ left: `${Math.min(92, Math.max(8, at(v)))}%` });

  return (
    <div
      ref={root}
      role="img"
      aria-label={`Claimed ${claimed} kilometres per hour. Measured ${kmh.toFixed(1)}, with a 90 percent interval from ${lo.toFixed(1)} to ${hi.toFixed(1)}.`}
      className={`relative ${large ? 'h-[88px]' : 'h-[50px]'} ${className}`}
    >
      {/* said, above the line */}
      <div className={`cl-label said absolute top-0 -translate-x-1/2 whitespace-nowrap ${labelSize}`} style={{ ...clampStyle(claimed), color: tone }}>
        said {claimed}
      </div>
      {/* the ruler */}
      <div className={`absolute inset-x-0 h-px bg-line-strong ${large ? 'top-[43px]' : 'top-[24px]'}`} />
      {!inside && (
        <div className={`cl-gap absolute h-px origin-left ${large ? 'top-[43px]' : 'top-[24px]'}`}
             style={{ left: `${left}%`, width: `${right - left}%`, background: tone, opacity: 0.55 }} />
      )}
      <div className={`cl-band absolute origin-left rounded-[1px] bg-bone/30 ${large ? 'top-[36px] h-[15px]' : 'top-[20px] h-[9px]'}`}
           style={{ left: `${at(lo)}%`, width: `${Math.max(0.6, at(hi) - at(lo))}%` }} />
      <div className={`cl-tick absolute w-[2px] -translate-x-1/2 bg-bone ${large ? 'top-[32px] h-[23px]' : 'top-[17px] h-[15px]'}`}
           style={{ left: `${at(kmh)}%` }} />
      <div className={`cl-claim absolute -translate-x-1/2 -translate-y-1/2 ${large ? 'top-[43px]' : 'top-[24px]'}`} style={{ left: `${at(claimed)}%` }}>
        <div className={`rotate-45 ${large ? 'h-3 w-3' : 'h-2 w-2'}`} style={{ background: tone }} />
      </div>
      {/* measured, below the line */}
      <div className={`cl-label measured absolute bottom-0 -translate-x-1/2 whitespace-nowrap text-bone-200 ${labelSize}`} style={clampStyle(kmh)}>
        {kmh.toFixed(1)} <span className="text-bone-500">({lo.toFixed(1)}–{hi.toFixed(1)})</span>
      </div>
    </div>
  );
};
