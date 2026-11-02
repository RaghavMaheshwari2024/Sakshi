/**
 * The front page's centrepiece: the investigation screen's two panels, live. Footage with
 * its real masks on the left, the same instant on the measured road on the right, in step.
 * Every mask, position and speed comes from the case file; nothing is animated by hand.
 */
import React, { useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import type { CaseData } from '../types/case';
import { getTrackColor } from '../utils/colors';
import { drawRleMask } from '../utils/maskDecoder';
import { gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from '../lib/motion';
import { TopDownPanel } from './TopDownPanel';
import { Panel } from './ui';

const CANVAS_W = 1000;
const LABEL_H = 18;

interface HeroReplayProps {
  data: CaseData;
  videoUrl: string;
  /** Says where the footage is from; always on screen. */
  source: string;
  /** The frame shown while nothing plays. */
  restFrame?: number;
}

export const HeroReplay: React.FC<HeroReplayProps> = ({ data, videoUrl, source, restFrame = 0 }) => {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const hovering = useRef(false);
  const play = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(data.clock.frames[restFrame]?.t ?? 0);

  const fps = data.clip.fps_nominal;
  const inkScale = Math.max(1, Math.round(CANVAS_W / data.clip.width));

  const cars = useMemo(() => data.tracks
    .filter((t) => t.concept !== 'traffic light')
    .map((t) => ({ id: t.id, colour: getTrackColor(t.id), frames: new Map(t.frames.map((f) => [f.i, f])) })), [data]);

  const showFrame = (frame: number) => {
    const i = Math.min(frame, data.clip.frames - 1);
    setTime(data.clock.frames[i]?.t ?? 0);
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, data.clip.width * inkScale, data.clip.height * inkScale);
    ctx.font = '500 13px "IBM Plex Mono", monospace';
    for (const car of cars) {
      const f = car.frames.get(i);
      if (!f) continue;
      const [x0, y0, x1, y1] = f.box.map((v) => v * inkScale);
      if (f.rle) drawRleMask(ctx, f.rle, f.box, car.colour, inkScale, inkScale);
      ctx.strokeStyle = car.colour;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      const w = ctx.measureText(car.id).width + 10;
      ctx.fillStyle = 'rgba(10,11,12,0.82)';
      ctx.fillRect(x0, y0 - LABEL_H - 2, w, LABEL_H);
      ctx.fillStyle = car.colour;
      ctx.fillText(car.id, x0 + 5, y0 - 7);
      if (f.contact_px) {
        ctx.fillStyle = '#f2c037';
        ctx.beginPath();
        ctx.arc(f.contact_px[0] * inkScale, f.contact_px[1] * inkScale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  useGSAP(
    (_, contextSafe) => {
      const v = video.current;
      if (!v || !contextSafe) return;
      const reduced = prefersReducedMotion();
      const q = gsap.utils.selector(root);
      const restAt = restFrame / fps + 0.001;
      let handle = 0;
      let live = true;

      const follow = () => {
        const vfc = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number };
        const tick = (mediaTime: number) => {
          if (!live) return;
          showFrame(Math.round(mediaTime * fps));
          if (progress.current) progress.current.style.transform = `scaleX(${mediaTime / (v.duration || 1)})`;
        };
        if (vfc.requestVideoFrameCallback) {
          const step = (_now: number, m: { mediaTime: number }) => {
            tick(m.mediaTime);
            if (!v.paused) handle = vfc.requestVideoFrameCallback!(step);
          };
          handle = vfc.requestVideoFrameCallback(step);
        } else {
          const step = () => {
            tick(v.currentTime);
            if (!v.paused) handle = requestAnimationFrame(step);
          };
          handle = requestAnimationFrame(step);
        }
      };

      const start = contextSafe(() => {
        if (!v.paused) return;
        setPlaying(true);
        v.currentTime = 0;
        v.play().catch(() => setPlaying(false));
        follow();
      });
      play.current = start;

      const onEnded = contextSafe(() => {
        if (hovering.current) {
          start();
          return;
        }
        setPlaying(false);
        v.currentTime = restAt;
        if (progress.current) progress.current.style.transform = 'scaleX(0)';
      });
      const onSeeked = () => { if (v.paused) showFrame(restFrame); };
      v.addEventListener('ended', onEnded);
      v.addEventListener('seeked', onSeeked);

      // The light around the frame breathes slowly, for as long as motion is welcome.
      if (!reduced) gsap.to(q('.replay-halo'), { opacity: 0.8, scale: 1.03, duration: 3.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });

      // Visitors who never hover still see it once.
      let intro: ScrollTrigger | undefined;
      const ready = () => {
        v.currentTime = restAt;
        if (reduced) return;
        intro = ScrollTrigger.create({
          trigger: root.current, start: 'top 80%', once: true,
          onEnter: () => gsap.delayedCall(1.2, () => play.current()),
        });
      };
      if (v.readyState >= 2) ready();
      else v.addEventListener('loadeddata', ready, { once: true });

      return () => {
        live = false;
        intro?.kill();
        v.removeEventListener('ended', onEnded);
        v.removeEventListener('seeked', onSeeked);
        v.removeEventListener('loadeddata', ready);
        v.pause();
        cancelAnimationFrame(handle);
      };
    },
    { scope: root, dependencies: [data] },
  );

  return (
    <figure ref={root} className="relative">
      {/* The light is behind the frame and never over the measurements. */}
      <div className="replay-rays pointer-events-none absolute -inset-x-[10%] -top-[30%] h-[70%]" aria-hidden="true" />
      <div className="replay-halo pointer-events-none absolute -inset-[6%]" aria-hidden="true" />

      <div
        role="button"
        tabIndex={0}
        aria-label="Replay the clip: the footage and the same seconds measured on the road"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
          hovering.current = true;
          play.current();
        }}
        onPointerLeave={() => { hovering.current = false; }}
        onClick={() => play.current()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play.current(); } }}
        className="replay-stage relative cursor-pointer overflow-hidden rounded-xl border border-paint/35 bg-line text-left"
      >
        <div className="grid gap-px lg:h-[clamp(380px,40vw,560px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <Panel title="Footage" meta="SAM 3.1 masks" className="h-[75vw] lg:h-auto"
                 actions={<span className="text-[12px] text-bone-400">{source}</span>}>
            <div className="absolute inset-0 bg-black">
              <video ref={video} src={videoUrl} muted playsInline preload="auto" className="absolute inset-0 h-full w-full object-contain" aria-hidden="true" />
              <canvas ref={canvas} width={data.clip.width * inkScale} height={data.clip.height * inkScale}
                      className="absolute inset-0 h-full w-full object-contain" aria-hidden="true" />
            </div>
          </Panel>
          <Panel title="Reconstruction" meta="measured ground plane, metres" className="h-[85vw] lg:h-auto">
            <div className="pointer-events-none absolute inset-0">
              <TopDownPanel display={{ data, time }} />
            </div>
          </Panel>
        </div>
        <div className="pointer-events-none absolute bottom-2.5 right-3 flex items-center gap-1.5 rounded bg-asphalt-950/80 px-2 py-1 font-mono text-[12px] text-bone-200 transition-opacity duration-300"
             style={{ opacity: playing ? 0 : 1 }}>
          <Play className="h-3 w-3 fill-current" aria-hidden="true" /> Hover to replay
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-bone/10" aria-hidden="true">
          <div ref={progress} className="h-full origin-left scale-x-0 bg-paint" />
        </div>
      </div>
    </figure>
  );
};
