import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Eye, EyeOff, Crosshair } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { getTrackColor } from '../utils/colors';
import { drawRleMask } from '../utils/maskDecoder';

export const VideoPanel: React.FC = () => {
  const {
    caseData,
    videoUrl,
    currentFrame,
    isPlaying,
    playbackSpeed,
    showMasks,
    selectedTrack,
    setFrame,
    setIsPlaying,
    toggleMasks,
    setSelectedTrack,
  } = useCaseStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [, setVideoDims] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });

  // Sync video time to currentFrame when paused or jumped
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isPlaying) return;
    const nominalFps = caseData?.clip?.fps_nominal || 25;
    const targetVideoTime = (currentFrame + 0.5) / nominalFps;
    if (Math.abs(video.currentTime - targetVideoTime) > 0.01) {
      video.currentTime = targetVideoTime;
    }
  }, [currentFrame, isPlaying, caseData]);

  // Handle play/pause & speed
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = playbackSpeed;
    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [isPlaying, playbackSpeed, setIsPlaying]);

  // Frame listener via requestVideoFrameCallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let callbackId: number;
    let animId: number;

    const onFrame = (_now: DOMHighResTimeStamp, metadata?: any) => {
      if (video.paused && !isPlaying) return;
      const nominalFps = caseData?.clip?.fps_nominal || 25;
      const mediaTime = metadata?.mediaTime ?? video.currentTime;
      const frameIdx = Math.round(mediaTime * nominalFps);
      if (frameIdx !== currentFrame) {
        setFrame(frameIdx);
      }
      if ('requestVideoFrameCallback' in video) {
        callbackId = (video as any).requestVideoFrameCallback(onFrame);
      } else {
        animId = requestAnimationFrame(onFrame);
      }
    };

    if ('requestVideoFrameCallback' in video) {
      callbackId = (video as any).requestVideoFrameCallback(onFrame);
    } else {
      animId = requestAnimationFrame(onFrame);
    }

    return () => {
      if ('cancelVideoFrameCallback' in video && callbackId) {
        (video as any).cancelVideoFrameCallback(callbackId);
      }
      if (animId) cancelAnimationFrame(animId);
    };
  }, [caseData, currentFrame, isPlaying, setFrame]);

  // Draw SAM 3.1 masks and contact points on canvas
  const renderOverlays = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !caseData) return;

    const rect = container.getBoundingClientRect();
    const nativeW = caseData.clip.width || 1280;
    const nativeH = caseData.clip.height || 720;

    // Aspect-ratio fit inside container
    const aspect = nativeW / nativeH;
    let renderW = rect.width;
    let renderH = rect.width / aspect;
    if (renderH > rect.height) {
      renderH = rect.height;
      renderW = rect.height * aspect;
    }

    canvas.width = renderW;
    canvas.height = renderH;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, renderW, renderH);

    const scaleX = renderW / nativeW;
    const scaleY = renderH / nativeH;

    if (!showMasks) return;

    // Iterate over active tracks at current frame
    for (const track of caseData.tracks) {
      const frameData = track.frames.find((f) => f.i === currentFrame);
      if (!frameData) continue;

      const color = getTrackColor(track.id);
      const isSelected = selectedTrack === track.id;
      const isDimmed = selectedTrack !== null && !isSelected;

      ctx.save();
      if (isDimmed) ctx.globalAlpha = 0.25;

      // Draw SAM 3.1 RLE mask
      if (frameData.rle) {
        drawRleMask(ctx, frameData.rle, frameData.box, color, scaleX, scaleY);
      }

      // Draw bounding box
      const [bx0, by0, bx1, by1] = frameData.box;
      const x = bx0 * scaleX;
      const y = by0 * scaleY;
      const w = (bx1 - bx0) * scaleX;
      const h = (by1 - by0) * scaleY;

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 1.5;
      ctx.strokeRect(x, y, w, h);

      // Label chip above box
      ctx.fillStyle = 'rgba(18, 18, 20, 0.85)';
      const labelText = track.id;
      ctx.font = '600 10px JetBrains Mono, monospace';
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillRect(x, Math.max(0, y - 16), textWidth + 10, 15);
      ctx.fillStyle = color;
      ctx.fillText(labelText, x + 5, Math.max(11, y - 5));

      // Ground tyre-road contact point (white crosshair dot)
      if (frameData.contact_px) {
        const [cx, cy] = frameData.contact_px;
        const px = cx * scaleX;
        const py = cy * scaleY;

        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Contact crosshair
        ctx.beginPath();
        ctx.moveTo(px - 5, py);
        ctx.lineTo(px + 5, py);
        ctx.moveTo(px, py - 5);
        ctx.lineTo(px, py + 5);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.stroke();
      }

      ctx.restore();
    }
  }, [caseData, currentFrame, showMasks, selectedTrack]);

  useEffect(() => {
    renderOverlays();
  }, [renderOverlays]);

  return (
    <div className="relative w-full h-full bg-workspace-bg flex flex-col overflow-hidden border border-workspace-border rounded-lg">
      {/* Top Header Badge */}
      <div className="h-8 px-3 border-b border-workspace-border bg-workspace-card/60 flex items-center justify-between text-xs font-mono text-zinc-400 select-none">
        <div className="flex items-center space-x-2">
          <span className="font-semibold text-zinc-200">PANEL 1: CCTV FOOTAGE</span>
          <span className="text-[10px] text-zinc-500 uppercase">SAM 3.1 MASK OVERLAY</span>
        </div>

        <button
          onClick={toggleMasks}
          className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] transition-all active:scale-95 ${
            showMasks
              ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
              : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
          }`}
          title="Toggle SAM 3.1 Segmentations"
        >
          {showMasks ? <Eye className="w-3 h-3 text-cyan-400" /> : <EyeOff className="w-3 h-3" />}
          <span>{showMasks ? 'Masks On' : 'Masks Off'}</span>
        </button>
      </div>

      {/* Main Video & Canvas Container */}
      <div ref={containerRef} className="relative flex-1 w-full h-full flex items-center justify-center bg-black overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          muted
          preload="auto"
          crossOrigin="anonymous"
          className="max-w-full max-h-full object-contain pointer-events-none"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            setVideoDims({ width: v.videoWidth, height: v.videoHeight });
            const nominalFps = caseData?.clip?.fps_nominal || 25;
            v.currentTime = (currentFrame + 0.5) / nominalFps;
          }}
          onLoadedData={(e) => {
            const v = e.currentTarget;
            const nominalFps = caseData?.clip?.fps_nominal || 25;
            v.currentTime = (currentFrame + 0.5) / nominalFps;
          }}
          onEnded={() => setIsPlaying(false)}
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0 m-auto pointer-events-auto cursor-crosshair"
          onClick={(e) => {
            // Find if a track bounding box was clicked
            if (!caseData || !canvasRef.current) return;
            const rect = canvasRef.current.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;
            const scaleX = rect.width / (caseData.clip.width || 1280);
            const scaleY = rect.height / (caseData.clip.height || 720);

            for (const track of caseData.tracks) {
              const frameData = track.frames.find((f) => f.i === currentFrame);
              if (!frameData) continue;
              const [x0, y0, x1, y1] = frameData.box;
              if (
                clickX >= x0 * scaleX &&
                clickX <= x1 * scaleX &&
                clickY >= y0 * scaleY &&
                clickY <= y1 * scaleY
              ) {
                setSelectedTrack(track.id);
                return;
              }
            }
            setSelectedTrack(null);
          }}
        />

        {/* Legend indicator */}
        <div className="absolute bottom-2 left-2 flex items-center space-x-2 bg-zinc-950/80 px-2 py-1 rounded border border-zinc-800 text-[10px] font-mono text-zinc-400 pointer-events-none">
          <div className="flex items-center space-x-1">
            <span className="w-2 h-2 rounded-full bg-white ring-1 ring-black" />
            <span>Tyre Contact</span>
          </div>
          <span>•</span>
          <div className="flex items-center space-x-1">
            <Crosshair className="w-2.5 h-2.5 text-cyan-400" />
            <span>Click Box to Filter</span>
          </div>
        </div>
      </div>
    </div>
  );
};
