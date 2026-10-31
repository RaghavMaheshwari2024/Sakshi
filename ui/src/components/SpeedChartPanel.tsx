import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { scaleLinear } from 'd3-scale';
import { Gauge, Layers } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { Trajectory } from '../types/case';
import { getTrackColor } from '../utils/colors';

interface SpeedChartPanelProps {
  className?: string;
}

interface TelemetryPoint {
  inRange: boolean;
  speed: number;
  lo90: number;
  hi90: number;
}

/**
 * Linearly interpolates speed, lo90, and hi90 for a trajectory at timestamp `t`.
 * Returns inRange = false if `t` is outside the trajectory domain.
 */
function getInterpolatedTrajectory(traj: Trajectory, t: number): TelemetryPoint {
  if (!traj.t || traj.t.length === 0) {
    return { inRange: false, speed: 0, lo90: 0, hi90: 0 };
  }

  const firstT = traj.t[0];
  const lastT = traj.t[traj.t.length - 1];

  // Generous 0.05s tolerance for slight clock / boundary roundoffs
  if (t < firstT - 0.05 || t > lastT + 0.05) {
    return { inRange: false, speed: 0, lo90: 0, hi90: 0 };
  }

  const clampedT = Math.max(firstT, Math.min(lastT, t));

  // Binary search or linear scan for interval [idx, idx + 1]
  let idx = 0;
  while (idx < traj.t.length - 1 && traj.t[idx + 1] <= clampedT) {
    idx++;
  }

  if (idx >= traj.t.length - 1) {
    const lastIdx = traj.t.length - 1;
    return {
      inRange: true,
      speed: traj.speed_kmh[lastIdx] ?? 0,
      lo90: traj.lo90_kmh[lastIdx] ?? 0,
      hi90: traj.hi90_kmh[lastIdx] ?? 0,
    };
  }

  const t0 = traj.t[idx];
  const t1 = traj.t[idx + 1];
  const dt = t1 - t0;
  const alpha = dt > 0 ? (clampedT - t0) / dt : 0;

  const s0 = traj.speed_kmh[idx] ?? 0;
  const s1 = traj.speed_kmh[idx + 1] ?? 0;
  const speed = s0 + alpha * (s1 - s0);

  const l0 = traj.lo90_kmh[idx] ?? s0;
  const l1 = traj.lo90_kmh[idx + 1] ?? s1;
  const lo90 = l0 + alpha * (l1 - l0);

  const h0 = traj.hi90_kmh[idx] ?? s0;
  const h1 = traj.hi90_kmh[idx + 1] ?? s1;
  const hi90 = h0 + alpha * (h1 - h0);

  return { inRange: true, speed, lo90, hi90 };
}

export const SpeedChartPanel: React.FC<SpeedChartPanelProps> = ({ className = '' }) => {
  const {
    caseData,
    currentTime,
    currentFrame,
    selectedTrack,
    setSelectedTrack,
    jumpToTime,
    highlightWindow,
    showConfidenceBands,
    toggleConfidenceBands,
  } = useCaseStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Responsive dimensions for pixel-crisp SVG rendering
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({
    width: 680,
    height: 280,
  });

  // Scrubbing & Hover states
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const [hoverState, setHoverState] = useState<{ x: number; t: number } | null>(null);

  // ResizeObserver to track container bounds
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ width, height });
        }
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const trajectories = useCaseStore((state) => state.caseData?.trajectories) || [];

  // Margins for axes, labels, and ticks
  const margin = useMemo(
    () => ({
      top: 28,
      right: 28,
      bottom: 28,
      left: 48,
    }),
    []
  );

  const innerWidth = Math.max(10, dimensions.width - margin.left - margin.right);
  const innerHeight = Math.max(10, dimensions.height - margin.top - margin.bottom);

  // Time Domain [minT, maxT]
  const { minT, maxT } = useMemo(() => {
    const clockFrames = caseData?.clock?.frames || [];
    const clipFrames = caseData?.clip?.frames || 100;
    const fpsNominal = caseData?.clip?.fps_nominal || 25;

    let t0 = clockFrames[0]?.t ?? 0;
    let t1 = clockFrames[clockFrames.length - 1]?.t ?? clipFrames / fpsNominal;

    trajectories.forEach((traj) => {
      if (traj.t.length > 0) {
        t0 = Math.min(t0, traj.t[0]);
        t1 = Math.max(t1, traj.t[traj.t.length - 1]);
      }
    });

    if (t1 <= t0) {
      t1 = t0 + 5.0;
    }

    return { minT: t0, maxT: t1 };
  }, [caseData, trajectories]);

  // Speed Domain [0, yMax]
  const yMax = useMemo(() => {
    let maxFound = 40;
    trajectories.forEach((traj) => {
      traj.speed_kmh?.forEach((s) => {
        if (s > maxFound) maxFound = s;
      });
      traj.hi90_kmh?.forEach((s) => {
        if (s > maxFound) maxFound = s;
      });
    });

    // Provide 15% headroom and round to nearest 10
    return Math.max(60, Math.ceil((maxFound * 1.15) / 10) * 10);
  }, [trajectories]);

  // d3 Scales
  const xScale = useMemo(() => {
    return scaleLinear()
      .domain([minT, maxT])
      .range([margin.left, margin.left + innerWidth]);
  }, [minT, maxT, margin.left, innerWidth]);

  const yScale = useMemo(() => {
    return scaleLinear()
      .domain([0, yMax])
      .range([margin.top + innerHeight, margin.top]);
  }, [yMax, margin.top, innerHeight]);

  // Event Markers: Impact
  const impactEvent = useMemo(() => {
    if (caseData?.facts?.impact && typeof caseData.facts.impact.t === 'number') {
      return caseData.facts.impact;
    }
    if (caseData?.events) {
      const imp = caseData.events.find((e) => e.type === 'impact');
      if (imp && typeof imp.t === 'number') return imp;
    }
    return null;
  }, [caseData]);

  // Event Markers: Braking
  const brakingMarkers = useMemo(() => {
    const list: Array<{ trackId: string; t: number; peakDecel?: number }> = [];
    const bFacts = caseData?.facts?.braking;
    if (!bFacts) return list;

    if (Array.isArray(bFacts)) {
      bFacts.forEach((item: any) => {
        if (item && item.detected && typeof item.t === 'number') {
          list.push({
            trackId: item.track || item.track_id || 'vehicle',
            t: item.t,
            peakDecel: item.peak_decel_ms2,
          });
        }
      });
    } else if (typeof bFacts === 'object') {
      Object.entries(bFacts).forEach(([trackId, val]: [string, any]) => {
        if (val && val.detected && typeof val.t === 'number') {
          list.push({
            trackId,
            t: val.t,
            peakDecel: val.peak_decel_ms2,
          });
        }
      });
    }
    return list;
  }, [caseData]);

  // Event Markers: Signal Changes
  const signalChanges = useMemo(() => {
    if (caseData?.facts?.signal_changes && Array.isArray(caseData.facts.signal_changes)) {
      return caseData.facts.signal_changes;
    }
    if (caseData?.signals && typeof caseData.signals === 'object') {
      const firstSignal = Object.values(caseData.signals)[0];
      if (Array.isArray(firstSignal)) return firstSignal;
    }
    return [];
  }, [caseData]);

  // Precomputed SVG geometric paths for trajectories
  const trajectoryRenderData = useMemo(() => {
    return trajectories.map((traj) => {
      const isSelected = selectedTrack === traj.track;
      const isDimmed = selectedTrack !== null && !isSelected;
      const trackColor = getTrackColor(traj.track);

      // 1. Solid speed curve path string
      let curvePath = '';
      for (let i = 0; i < traj.t.length; i++) {
        const x = xScale(traj.t[i]);
        const y = yScale(traj.speed_kmh[i] ?? 0);
        curvePath += `${i === 0 ? 'M' : ' L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }

      // 2. 90% confidence ribbon polygon points
      let polygonPoints = '';
      let hiPath = '';
      let loPath = '';

      if (traj.hi90_kmh && traj.lo90_kmh && traj.t.length > 0) {
        const upperPoints: string[] = [];
        const lowerPoints: string[] = [];

        for (let i = 0; i < traj.t.length; i++) {
          const x = xScale(traj.t[i]).toFixed(1);
          const yHi = yScale(traj.hi90_kmh[i] ?? traj.speed_kmh[i]).toFixed(1);
          upperPoints.push(`${x},${yHi}`);
          hiPath += `${i === 0 ? 'M' : ' L'} ${x} ${yHi}`;
        }

        for (let i = traj.t.length - 1; i >= 0; i--) {
          const x = xScale(traj.t[i]).toFixed(1);
          const yLo = yScale(traj.lo90_kmh[i] ?? traj.speed_kmh[i]).toFixed(1);
          lowerPoints.push(`${x},${yLo}`);
        }

        for (let i = 0; i < traj.t.length; i++) {
          const x = xScale(traj.t[i]).toFixed(1);
          const yLo = yScale(traj.lo90_kmh[i] ?? traj.speed_kmh[i]).toFixed(1);
          loPath += `${i === 0 ? 'M' : ' L'} ${x} ${yLo}`;
        }

        polygonPoints = [...upperPoints, ...lowerPoints].join(' ');
      }

      return {
        traj,
        trackColor,
        isSelected,
        isDimmed,
        curvePath,
        polygonPoints,
        hiPath,
        loPath,
      };
    });
  }, [trajectories, selectedTrack, xScale, yScale]);

  // Scrubbing logic via PointerEvents
  const scrubToClientX = useCallback(
    (clientX: number) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const px = clientX - rect.left;
      const clampedX = Math.max(margin.left, Math.min(margin.left + innerWidth, px));
      const t = xScale.invert(clampedX);
      jumpToTime(t);
    },
    [xScale, margin.left, innerWidth, jumpToTime]
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    scrubToClientX(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const clampedX = Math.max(margin.left, Math.min(margin.left + innerWidth, px));
    const t = xScale.invert(clampedX);

    if (isScrubbing) {
      jumpToTime(t);
    }
    setHoverState({ x: clampedX, t });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setIsScrubbing(false);
  };

  const handlePointerLeave = () => {
    if (!isScrubbing) {
      setHoverState(null);
    }
  };

  // Axis tick generators
  const yTicks = useMemo(() => yScale.ticks(5), [yScale]);
  const xTicks = useMemo(() => {
    const tickCount = Math.max(4, Math.floor(innerWidth / 85));
    return xScale.ticks(tickCount);
  }, [xScale, innerWidth]);

  // Current playhead X
  const playheadX = xScale(currentTime);
  const isPlayheadVisible = playheadX >= margin.left && playheadX <= margin.left + innerWidth;

  // Highlight Window Calculations
  const highlightRect = useMemo(() => {
    if (!highlightWindow) return null;
    const x0 = Math.max(margin.left, xScale(highlightWindow.t0));
    const x1 = Math.min(margin.left + innerWidth, xScale(highlightWindow.t1));
    const width = Math.max(2, x1 - x0);
    return {
      x: x0,
      width,
      t0: highlightWindow.t0,
      t1: highlightWindow.t1,
      reason: highlightWindow.reason,
    };
  }, [highlightWindow, xScale, margin.left, innerWidth]);

  // Current Telemetry Readouts for Header
  const activeTelemetries = useMemo(() => {
    return trajectories.map((traj) => {
      const data = getInterpolatedTrajectory(traj, currentTime);
      return {
        track: traj.track,
        color: getTrackColor(traj.track),
        ...data,
      };
    });
  }, [trajectories, currentTime]);

  return (
    <div
      className={`bg-zinc-950/70 border border-zinc-800 rounded-lg p-3 text-zinc-100 flex flex-col select-none relative backdrop-blur h-full ${className}`}
    >
      {/* Top Header: Panel Title, Units & Interactivity Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/80 mb-2">
        {/* Title & Units */}
        <div className="flex items-center space-x-2.5">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <h2 className="text-xs font-semibold tracking-wide uppercase text-zinc-200">
            Kinematic Telemetry (Speed & Uncertainty)
          </h2>
          <span className="text-[11px] font-mono text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
            km/h vs Time (s)
          </span>
        </div>

        {/* Legend & Confidence Ribbon Toggle */}
        <div className="flex items-center space-x-3">
          {/* Track Filter Pills */}
          <div className="flex items-center space-x-1">
            {trajectories.map((traj) => {
              const isSelected = selectedTrack === traj.track;
              const isDimmed = selectedTrack !== null && !isSelected;
              const color = getTrackColor(traj.track);
              return (
                <button
                  key={traj.track}
                  onClick={() => setSelectedTrack(traj.track)}
                  className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono transition-all duration-150 active:scale-95 ${
                    isSelected
                      ? 'bg-zinc-800 ring-1 ring-zinc-500 text-zinc-100 shadow-sm'
                      : isDimmed
                      ? 'bg-zinc-900/50 text-zinc-500 hover:text-zinc-300'
                      : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300'
                  }`}
                  title={isSelected ? `Clear filter` : `Filter view to ${traj.track}`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span>{traj.track}</span>
                </button>
              );
            })}
            {selectedTrack && (
              <button
                onClick={() => setSelectedTrack(null)}
                className="text-[10px] text-zinc-400 hover:text-zinc-200 font-mono px-1 py-0.5"
                title="Reset track filter"
              >
                (Reset)
              </button>
            )}
          </div>

          <div className="h-3 w-[1px] bg-zinc-800" />

          {/* 90% Confidence Band Toggle */}
          <button
            onClick={() => toggleConfidenceBands?.()}
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all duration-150 active:scale-95 border ${
              showConfidenceBands
                ? 'bg-cyan-950/60 border-cyan-800 text-cyan-300 shadow-sm shadow-cyan-950'
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}
            title="Toggle 90% Confidence Interval Ribbons"
          >
            <Layers className="w-3.5 h-3.5 shrink-0" />
            <span>90% CI Bands</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                showConfidenceBands ? 'bg-cyan-400' : 'bg-zinc-600'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Telemetry Readout Header Strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-1.5 px-2.5 bg-zinc-900/60 rounded border border-zinc-800/80 mb-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-mono font-medium flex items-center space-x-1.5 shrink-0">
          <Gauge className="w-3.5 h-3.5 text-cyan-400" />
          <span>Telemetry @ t = {currentTime.toFixed(2)}s (frame #{currentFrame}):</span>
        </div>

        {activeTelemetries.length === 0 ? (
          <span className="text-xs font-mono text-zinc-500 italic">No trajectories tracked</span>
        ) : (
          activeTelemetries.map((item) => {
            const isSelected = selectedTrack === item.track;
            const isDimmed = selectedTrack !== null && !isSelected;
            return (
              <div
                key={item.track}
                onClick={() => setSelectedTrack(item.track)}
                className={`flex items-center space-x-1.5 text-xs font-mono px-2 py-0.5 rounded cursor-pointer transition-all duration-150 active:scale-95 ${
                  isSelected
                    ? 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600'
                    : isDimmed
                    ? 'opacity-40 text-zinc-500 hover:opacity-80'
                    : 'text-zinc-300 hover:bg-zinc-800/60'
                }`}
                title={`Click to filter on ${item.track}`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="font-semibold" style={{ color: item.color }}>
                  {item.track}:
                </span>
                {item.inRange ? (
                  <span className="tabular-nums">
                    <span className="font-bold text-zinc-100">{item.speed.toFixed(1)} km/h</span>{' '}
                    <span className="text-zinc-400 text-[11px]">
                      ({item.lo90.toFixed(1)}–{item.hi90.toFixed(1)}, 90%)
                    </span>
                  </span>
                ) : (
                  <span className="text-zinc-500 italic text-[11px]">-- km/h (out of frame)</span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Claim Highlight Window Banner (When active) */}
      {highlightWindow && (
        <div className="flex items-center justify-between px-3 py-1 mb-2 rounded bg-cyan-950/40 border border-cyan-800/60 text-xs font-mono animate-in fade-in duration-200">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span className="text-cyan-300 font-semibold tracking-wide">
              CLAIM INSPECTION WINDOW: {highlightWindow.t0.toFixed(2)}s –{' '}
              {highlightWindow.t1.toFixed(2)}s
            </span>
            {highlightWindow.reason && (
              <span className="text-zinc-400 font-sans text-[11px] truncate max-w-sm">
                • {highlightWindow.reason}
              </span>
            )}
          </div>
          <span className="text-[10px] text-cyan-400/80">
            Δt = {(highlightWindow.t1 - highlightWindow.t0).toFixed(2)}s
          </span>
        </div>
      )}

      {/* Main SVG Chart Container */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 min-h-[190px] bg-zinc-950/80 rounded border border-zinc-800/90 overflow-hidden cursor-crosshair"
      >
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full block touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          shapeRendering="geometricPrecision"
        >
          {/* Background Gradient & Clip Path */}
          <defs>
            <clipPath id="chart-clip-area">
              <rect
                x={margin.left}
                y={margin.top}
                width={innerWidth}
                height={innerHeight}
              />
            </clipPath>
          </defs>

          {/* Gridlines: Y-axis (Speed) */}
          {yTicks.map((tick) => {
            const y = yScale(tick);
            return (
              <g key={`y-tick-${tick}`}>
                <line
                  x1={margin.left}
                  x2={margin.left + innerWidth}
                  y1={y}
                  y2={y}
                  stroke="#27272a"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
                <text
                  x={margin.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#71717a"
                  className="font-mono text-[10px] select-none"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Gridlines: X-axis (Time) */}
          {xTicks.map((tick) => {
            const x = xScale(tick);
            return (
              <g key={`x-tick-${tick}`}>
                <line
                  x1={x}
                  x2={x}
                  y1={margin.top}
                  y2={margin.top + innerHeight}
                  stroke="#27272a"
                  strokeDasharray="2 4"
                  strokeWidth={1}
                  strokeOpacity={0.6}
                />
                <text
                  x={x}
                  y={margin.top + innerHeight + 16}
                  textAnchor="middle"
                  fill="#71717a"
                  className="font-mono text-[10px] select-none"
                >
                  {tick.toFixed(1)}s
                </text>
              </g>
            );
          })}

          {/* Signal State Background Intervals (Bottom strip) */}
          <g>
            {signalChanges.map((sig, idx) => {
              const nextSig = signalChanges[idx + 1];
              const t0 = sig.t;
              const t1 = nextSig ? nextSig.t : maxT;
              const x0 = Math.max(margin.left, xScale(t0));
              const x1 = Math.min(margin.left + innerWidth, xScale(t1));
              const w = Math.max(0, x1 - x0);

              let fillColor = '#52525b';
              if (sig.state === 'green') fillColor = '#10b981';
              if (sig.state === 'red') fillColor = '#f43f5e';
              if (sig.state === 'amber') fillColor = '#f59e0b';

              return (
                <rect
                  key={`sig-${idx}`}
                  x={x0}
                  y={margin.top + innerHeight + 1}
                  width={w}
                  height={3}
                  fill={fillColor}
                  opacity={0.8}
                />
              );
            })}
          </g>

          {/* Highlight Window (from "Show Me" Claim Card) */}
          {highlightRect && (
            <g clipPath="url(#chart-clip-area)">
              <rect
                x={highlightRect.x}
                y={margin.top}
                width={highlightRect.width}
                height={innerHeight}
                fill="#06b6d4"
                fillOpacity={0.12}
                stroke="#06b6d4"
                strokeWidth={1}
                strokeDasharray="4 2"
              />
            </g>
          )}

          {/* Clipped Data Paths: Trajectories */}
          <g clipPath="url(#chart-clip-area)">
            {/* 1. Shaded 90% Confidence Ribbons */}
            {showConfidenceBands &&
              trajectoryRenderData.map(
                ({ traj, trackColor, isDimmed, polygonPoints, hiPath, loPath }) => {
                  if (!polygonPoints) return null;
                  return (
                    <g key={`ci-${traj.track}`}>
                      <polygon
                        points={polygonPoints}
                        fill={trackColor}
                        fillOpacity={isDimmed ? 0.04 : 0.15}
                        className="transition-opacity duration-200 pointer-events-none"
                      />
                      {/* Ribbon envelope boundary dashes */}
                      <path
                        d={hiPath}
                        fill="none"
                        stroke={trackColor}
                        strokeWidth={0.75}
                        strokeOpacity={isDimmed ? 0.08 : 0.25}
                        strokeDasharray="2 2"
                        className="pointer-events-none"
                      />
                      <path
                        d={loPath}
                        fill="none"
                        stroke={trackColor}
                        strokeWidth={0.75}
                        strokeOpacity={isDimmed ? 0.08 : 0.25}
                        strokeDasharray="2 2"
                        className="pointer-events-none"
                      />
                    </g>
                  );
                }
              )}

            {/* 2. Solid Speed Curves */}
            {trajectoryRenderData.map(
              ({ traj, trackColor, isSelected, isDimmed, curvePath }) => {
                if (!curvePath) return null;
                return (
                  <path
                    key={`curve-${traj.track}`}
                    d={curvePath}
                    fill="none"
                    stroke={trackColor}
                    strokeWidth={isSelected ? 2.5 : 2}
                    strokeOpacity={isDimmed ? 0.2 : 0.95}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-200 pointer-events-none"
                  />
                );
              }
            )}
          </g>

          {/* Vertical Event Markers: Braking Onset */}
          {brakingMarkers.map((b, idx) => {
            const bx = xScale(b.t);
            if (bx < margin.left || bx > margin.left + innerWidth) return null;
            const trackColor = getTrackColor(b.trackId);
            return (
              <g
                key={`brake-${idx}`}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpToTime(b.t);
                }}
              >
                <line
                  x1={bx}
                  y1={margin.top}
                  x2={bx}
                  y2={margin.top + innerHeight}
                  stroke={trackColor}
                  strokeWidth={1}
                  strokeDasharray="2 2"
                  strokeOpacity={0.8}
                />
                <g transform={`translate(${bx}, ${margin.top + innerHeight - 16})`}>
                  <rect
                    x={-34}
                    y={0}
                    width={68}
                    height={14}
                    rx={2}
                    fill="#18181b"
                    fillOpacity={0.92}
                    stroke={trackColor}
                    strokeWidth={0.8}
                  />
                  <text
                    x={0}
                    y={10}
                    textAnchor="middle"
                    fill={trackColor}
                    className="text-[8.5px] font-mono font-bold"
                  >
                    🛑 BRAKE {b.t.toFixed(1)}s
                  </text>
                </g>
              </g>
            );
          })}

          {/* Vertical Event Marker: Collision Impact */}
          {impactEvent && (
            (() => {
              const ix = xScale(impactEvent.t);
              if (ix < margin.left || ix > margin.left + innerWidth) return null;
              return (
                <g
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    jumpToTime(impactEvent.t);
                  }}
                >
                  {/* Dashed Red Line */}
                  <line
                    x1={ix}
                    y1={margin.top}
                    x2={ix}
                    y2={margin.top + innerHeight}
                    stroke="#f43f5e"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />

                  {/* Top Impact Badge */}
                  <g transform={`translate(${ix}, ${margin.top + 2})`}>
                    <rect
                      x={-60}
                      y={0}
                      width={120}
                      height={18}
                      rx={3}
                      fill="#4c0519"
                      fillOpacity={0.95}
                      stroke="#f43f5e"
                      strokeWidth={1}
                    />
                    <text
                      x={0}
                      y={12.5}
                      textAnchor="middle"
                      fill="#fecdd3"
                      className="text-[9.5px] font-mono font-bold tracking-tight select-none"
                    >
                      💥 IMPACT (t = {impactEvent.t.toFixed(2)}s)
                    </text>
                  </g>
                </g>
              );
            })()
          )}

          {/* Current Playhead Scrubbing Indicator */}
          {isPlayheadVisible && (
            <g className="pointer-events-none">
              {/* Vertical Playhead Line with glow */}
              <line
                x1={playheadX}
                y1={margin.top}
                x2={playheadX}
                y2={margin.top + innerHeight}
                stroke="#ffffff"
                strokeWidth={1.5}
                className="drop-shadow-[0_0_5px_rgba(255,255,255,0.7)]"
              />

              {/* Top pointer marker */}
              <polygon
                points={`${playheadX - 4},${margin.top - 2} ${playheadX + 4},${margin.top - 2} ${playheadX},${margin.top + 5}`}
                fill="#ffffff"
              />

              {/* Exact Speed Points on Playhead */}
              {activeTelemetries.map((item) => {
                if (!item.inRange) return null;
                const cy = yScale(item.speed);
                const isSelected = selectedTrack === item.track;
                const isDimmed = selectedTrack !== null && !isSelected;
                return (
                  <circle
                    key={`playhead-pt-${item.track}`}
                    cx={playheadX}
                    cy={cy}
                    r={isSelected ? 4.5 : 3.5}
                    fill={item.color}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    opacity={isDimmed ? 0.25 : 1}
                    className="drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]"
                  />
                );
              })}
            </g>
          )}

          {/* Hover Scrub Guideline */}
          {hoverState && !isScrubbing && (
            <g className="pointer-events-none">
              <line
                x1={hoverState.x}
                y1={margin.top}
                x2={hoverState.x}
                y2={margin.top + innerHeight}
                stroke="#38bdf8"
                strokeWidth={1}
                strokeDasharray="2 2"
                strokeOpacity={0.6}
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip when hovering over chart */}
        {hoverState && !isScrubbing && (
          <div
            className="absolute pointer-events-none z-30 bg-zinc-900/95 border border-zinc-700/80 rounded shadow-2xl p-2.5 text-xs backdrop-blur font-mono"
            style={{
              left: Math.min(hoverState.x + 12, dimensions.width - 240),
              top: Math.max(margin.top + 6, 12),
            }}
          >
            <div className="text-[11px] text-zinc-400 border-b border-zinc-800 pb-1 mb-1.5 flex items-center justify-between space-x-3">
              <span>Time: <span className="text-cyan-400 font-bold">{hoverState.t.toFixed(2)}s</span></span>
              <span className="text-[9.5px] text-zinc-500">Click to seek</span>
            </div>

            {trajectories.map((traj) => {
              const d = getInterpolatedTrajectory(traj, hoverState.t);
              const color = getTrackColor(traj.track);
              return (
                <div
                  key={`hover-item-${traj.track}`}
                  className="flex items-center justify-between space-x-3 text-[11px] py-0.5"
                >
                  <span className="flex items-center space-x-1.5">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span style={{ color }}>{traj.track}:</span>
                  </span>
                  {d.inRange ? (
                    <span className="tabular-nums">
                      <span className="font-semibold text-zinc-100">{d.speed.toFixed(1)} km/h</span>{' '}
                      <span className="text-zinc-400 text-[10px]">
                        ({d.lo90.toFixed(1)}–{d.hi90.toFixed(1)}, 90%)
                      </span>
                    </span>
                  ) : (
                    <span className="text-zinc-500 italic text-[10px]">-- (out of frame)</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Axis & Subtitle Footer Notice */}
      <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono mt-1.5 px-1">
        <span>Click or drag across the chart to scrub playback</span>
        <span>90% CI calculated via RTS Kalman smoother & photogrammetry homography</span>
      </div>
    </div>
  );
};
