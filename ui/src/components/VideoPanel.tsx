import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Pause, Play } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { getTrackColor } from '../utils/colors';
import { drawRleMask } from '../utils/maskDecoder';
import { IconButton, Panel } from './ui';
import { gsap, prefersReducedMotion } from '../lib/motion';

type FrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export const VideoPanel: React.FC = () => {
  const {
    caseData, videoUrl, currentFrame, currentTime, isPlaying, playbackSpeed, showMasks, selectedTrack,
    setFrame, setIsPlaying, togglePlay, stepFrame, toggleMasks, setSelectedTrack,
  } = useCaseStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const lastTime = useRef(currentTime);
  const [videoError, setVideoError] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => { setVideoError(false); }, [videoUrl]);

  // Seeks are serialised: overlapping currentTime writes (stepping, scrubbing, then
  // pressing play) can hang the element mid-seek. Only the latest target is kept.
  const pendingSeek = useRef<number | null>(null);

  const seekTo = useCallback((target: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (video.seeking) pendingSeek.current = target;
    else if (Math.abs(video.currentTime - target) > 0.01) video.currentTime = target;
  }, []);

  const startIfReady = useCallback(() => {
    const video = videoRef.current;
    if (!video || !useCaseStore.getState().isPlaying || video.seeking || pendingSeek.current !== null) return;
    video.play().catch(() => setIsPlaying(false));
  }, [setIsPlaying]);

  const onSeeked = () => {
    const next = pendingSeek.current;
    pendingSeek.current = null;
    if (next !== null) seekTo(next);
    if (!videoRef.current?.seeking) startIfReady();
  };

  // Sync the video to the shared playhead when paused or jumped.
  useEffect(() => {
    if (isPlaying) return;
    seekTo((currentFrame + 0.5) / (caseData?.clip?.fps_nominal || 25));
  }, [currentFrame, isPlaying, caseData, seekTo]);

  // Play, pause, speed.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
    if (!isPlaying) {
      video.pause();
      return;
    }
    startIfReady();
    // Backstop: never leave the play button pressed with nothing moving.
    const watchdog = window.setTimeout(() => {
      if (!video.paused) return;
      pendingSeek.current = null;
      video.play().catch(() => setIsPlaying(false));
    }, 600);
    return () => window.clearTimeout(watchdog);
  }, [isPlaying, playbackSpeed, setIsPlaying, startIfReady]);

  // While playing, the video drives the playhead.
  useEffect(() => {
    const video = videoRef.current as FrameCallbackVideo | null;
    if (!video || !isPlaying) return;
    let callbackId = 0, animId = 0, stopped = false;
    const onFrame = (_now: number, metadata?: { mediaTime: number }) => {
      if (stopped) return;
      const nominalFps = useCaseStore.getState().caseData?.clip?.fps_nominal || 25;
      const frameIdx = Math.round((metadata?.mediaTime ?? video.currentTime) * nominalFps);
      if (frameIdx !== useCaseStore.getState().currentFrame) setFrame(frameIdx);
      schedule();
    };
    const schedule = () => {
      if (video.requestVideoFrameCallback) callbackId = video.requestVideoFrameCallback(onFrame);
      else animId = requestAnimationFrame((n) => onFrame(n));
    };
    schedule();
    return () => {
      stopped = true;
      if (callbackId) video.cancelVideoFrameCallback?.(callbackId);
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, setFrame]);

  // The canvas sits exactly over the fitted video.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const renderOverlays = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !caseData || !box.w) return;
    const nativeW = caseData.clip.width || 1280;
    const nativeH = caseData.clip.height || 720;
    const aspect = nativeW / nativeH;
    let renderW = box.w, renderH = box.w / aspect;
    if (renderH > box.h) { renderH = box.h; renderW = box.h * aspect; }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(renderW * dpr);
    canvas.height = Math.round(renderH * dpr);
    canvas.style.width = `${renderW}px`;
    canvas.style.height = `${renderH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, renderW, renderH);
    if (!showMasks) return;

    const scaleX = renderW / nativeW, scaleY = renderH / nativeH;

    for (const track of caseData.tracks) {
      const frameData = track.frames.find((f) => f.i === currentFrame);
      if (!frameData) continue;
      const furniture = track.concept === 'traffic light';
      const color = getTrackColor(track.id);
      const isSelected = selectedTrack === track.id;
      const isDimmed = selectedTrack !== null && !isSelected;

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.25;
      if (frameData.rle && !furniture) drawRleMask(ctx, frameData.rle, frameData.box, color, scaleX, scaleY);

      const [bx0, by0, bx1, by1] = frameData.box;
      const x = bx0 * scaleX, y = by0 * scaleY, w = (bx1 - bx0) * scaleX, h = (by1 - by0) * scaleY;
      ctx.globalAlpha = (isDimmed ? 0.25 : 1) * (furniture ? 0.45 : 1);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x, y, w, h);

      if (!furniture) {
        ctx.font = '500 10px "IBM Plex Mono", monospace';
        const textWidth = ctx.measureText(track.id).width;
        ctx.fillStyle = 'rgba(10, 11, 12, 0.85)';
        ctx.fillRect(x, Math.max(0, y - 15), textWidth + 8, 14);
        ctx.fillStyle = color;
        ctx.fillText(track.id, x + 4, Math.max(10.5, y - 4.5));
      }

      if (frameData.contact_px && !furniture) {
        const px = frameData.contact_px[0] * scaleX, py = frameData.contact_px[1] * scaleY;
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f2c037';
        ctx.fill();
        ctx.strokeStyle = '#0a0b0c';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [caseData, currentFrame, showMasks, selectedTrack, box]);

  useEffect(() => { renderOverlays(); }, [renderOverlays]);

  // Crossing the impact while playing flashes the frame once.
  useEffect(() => {
    const impact = caseData?.facts?.impact?.t;
    const prev = lastTime.current;
    lastTime.current = currentTime;
    if (impact === undefined || !isPlaying || prev >= impact || currentTime < impact || prefersReducedMotion()) return;
    gsap.fromTo(flashRef.current, { opacity: 1 }, { opacity: 0, duration: 0.9, ease: 'power2.out' });
  }, [currentTime, isPlaying, caseData]);

  const seekVideoToPlayhead = (v: HTMLVideoElement) => {
    v.currentTime = (useCaseStore.getState().currentFrame + 0.5) / (caseData?.clip?.fps_nominal || 25);
  };

  return (
    <Panel
      title="Footage"
      meta="SAM 3.1 masks"
      className="h-full"
      actions={
        <>
          <span className="measured mr-1 hidden text-[12px] text-bone-400 sm:inline">#{currentFrame}</span>
          <IconButton label="Step back one frame" onClick={() => stepFrame(-1)}><ChevronLeft className="h-4 w-4" /></IconButton>
          <IconButton label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay}>
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Step forward one frame" onClick={() => stepFrame(1)}><ChevronRight className="h-4 w-4" /></IconButton>
          <IconButton label={showMasks ? 'Hide masks (M)' : 'Show masks (M)'} active={showMasks} onClick={toggleMasks}>
            {showMasks ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </IconButton>
        </>
      }
    >
      <div ref={containerRef} className="absolute inset-0 flex items-center justify-center overflow-hidden bg-asphalt-950">
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          muted
          preload="auto"
          crossOrigin="anonymous"
          aria-label="Crash footage"
          className="pointer-events-none max-h-full max-w-full object-contain"
          onLoadedMetadata={(e) => seekVideoToPlayhead(e.currentTarget)}
          onLoadedData={(e) => seekVideoToPlayhead(e.currentTarget)}
          onSeeked={onSeeked}
          onEnded={() => setIsPlaying(false)}
          onError={() => setVideoError(true)}
        />

        <canvas
          ref={canvasRef}
          aria-label="Tracked road users. Click a vehicle to filter the telemetry to it."
          className="absolute inset-0 m-auto cursor-crosshair"
          onClick={(e) => {
            if (!caseData || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - rect.left, clickY = e.clientY - rect.top;
            const scaleX = rect.width / (caseData.clip.width || 1280);
            const scaleY = rect.height / (caseData.clip.height || 720);
            for (const track of caseData.tracks) {
              if (track.concept === 'traffic light') continue;
              const frameData = track.frames.find((f) => f.i === currentFrame);
              if (!frameData) continue;
              const [x0, y0, x1, y1] = frameData.box;
              if (clickX >= x0 * scaleX && clickX <= x1 * scaleX && clickY >= y0 * scaleY && clickY <= y1 * scaleY) {
                setSelectedTrack(track.id);
                return;
              }
            }
            if (selectedTrack) setSelectedTrack(selectedTrack);
          }}
        />

        <div ref={flashRef} aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-0 ring-2 ring-inset ring-signal-red" />

        {videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-asphalt-950 p-6 text-center text-[13px] text-bone-400">
            The footage could not be loaded. The measurements in the other panels are unaffected.
          </div>
        )}

        <div className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-2.5 rounded-[3px] bg-asphalt-950/80 px-1.5 py-0.5 text-[11px] text-bone-300">
          <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-paint" />Tyre contact</span>
          <span className="hidden sm:inline">Click a vehicle to filter</span>
        </div>
      </div>
    </Panel>
  );
};
