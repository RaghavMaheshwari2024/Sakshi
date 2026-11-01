/**
 * One place for GSAP: plugin registration, shared defaults, and the rule that
 * nothing moves for people who asked for less motion. Components use useGSAP
 * with a scope (see the official gsap-react skill) so cleanup is automatic.
 */
import type React from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, DrawSVGPlugin);
gsap.defaults({ ease: 'power3.out', duration: 0.6 });

export const MOTION_OK = '(prefers-reduced-motion: no-preference)';

export const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run `setup` only when motion is welcome; everything is reverted on cleanup. */
export function withMotion(setup: () => void | (() => void)): gsap.MatchMedia {
  const mm = gsap.matchMedia();
  mm.add(MOTION_OK, setup);
  return mm;
}

/** Tween a number and write it into an element as text (real values only). */
export function countTo(el: Element, value: number, decimals = 0, suffix = '', duration = 1.1): gsap.core.Tween {
  const state = { v: 0 };
  return gsap.to(state, {
    v: value,
    duration,
    ease: 'power2.out',
    onUpdate: () => {
      el.textContent = `${state.v.toFixed(decimals)}${suffix}`;
    },
  });
}

/** Elements marked data-reveal rise in as they scroll into view, in batches. */
export function useReveal(scope: React.RefObject<HTMLElement>, dependencies: unknown[] = []): void {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', scope.current);
        gsap.set(items, { autoAlpha: 0, y: 14 });
        ScrollTrigger.batch(items, {
          start: 'top 90%',
          once: true,
          onEnter: (batch) => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.6, stagger: 0.06, overwrite: true }),
        });
        document.fonts?.ready.then(() => ScrollTrigger.refresh());
      });
    },
    { scope, dependencies, revertOnUpdate: true },
  );
}

export { gsap, useGSAP, ScrollTrigger, SplitText };
