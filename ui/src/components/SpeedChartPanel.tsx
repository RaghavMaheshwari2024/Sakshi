import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { scaleLinear } from 'd3-scale';
import { useCaseStore } from '../store/useCaseStore';
import { Trajectory } from '../types/case';
import { getTrackColor, IMPACT_COLOR, PAINT_COLOR, SIGNAL_COLORS } from '../utils/colors';
import { Panel } from './ui';
import { gsap, prefersReducedMotion, useGSAP } from '../lib/motion';

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

  const trajectories = useMemo(() => caseData?.trajectories ?? [], [caseData]);

  // Margins for axes, labels, and ticks
  const margin = useMemo(
    () => ({
      top: 10,
      right: 14,
      bottom: 22,
      left: 34,
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

    if (typeof bFacts === 'object') {
      Object.entries(bFacts).forEach(([trackId, val]) => {
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

      if (traj.hi90_kmh && traj.lo90_kmh && traj.t.length > 0) {
        const upperPoints: string[] = [];
        const lowerPoints: string[] = [];

        for (let i = 0; i < traj.t.length; i++) {
          const x = xScale(traj.t[i]).toFixed(1);
          const yHi = yScale(traj.hi90_kmh[i] ?? traj.speed_kmh[i]).toFixed(1);
          upperPoints.push(`${x},${yHi}`);
        }

        for (let i = traj.t.length - 1; i >= 0; i--) {
          const x = xScale(traj.t[i]).toFixed(1);
          const yLo = yScale(traj.lo90_kmh[i] ?? traj.speed_kmh[i]).toFixed(1);
          lowerPoints.push(`${x},${yLo}`);
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

  // A new case draws its speed curves left to right, then the intervals settle in.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.speed-band', { opacity: 0, duration: 0.5, delay: 0.5, ease: 'none', clearProps: 'opacity' });
      gsap.from('.speed-curve', { drawSVG: '0%', duration: 0.9, delay: 0.12, ease: 'power2.inOut', clearProps: 'strokeDasharray,strokeDashoffset' });
    },
    { dependencies: [caseData], scope: containerRef },
  );

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
    <Panel
      title="Speed"
      meta="km/h with 90% interval"
      className={`h-full select-none ${className}`}
      bodyClassName="flex flex-col"
      actions={
        <>
          {selectedTrack && (
            <button onClick={() => setSelectedTrack(null)} className="px-1 text-[12px] text-bone-400 hover:text-bone" title="Clear the vehicle filter">
              Clear filter
            </button>
          )}
          <button
            onClick={() => toggleConfidenceBands?.()}
            aria-pressed={showConfidenceBands}
            title="Show or hide the 90% intervals"
            className={`inline-flex h-6 items-center rounded-[3px] px-1.5 text-[12px] transition-colors ${
              showConfidenceBands ? 'bg-asphalt-700 text-bone' : 'text-bone-400 hover:text-bone'
            }`}
          >
            90% band
          </button>
        </>
      }
    >
      {/* What each vehicle is doing at the playhead */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-1 text-[12px]">
        <span className="measured text-bone-500">t = {currentTime.toFixed(2)} s · #{currentFrame}</span>
        {activeTelemetries.length === 0 ? (
          <span className="text-bone-500">No trajectories tracked</span>
        ) : (
          activeTelemetries.map((item) => {
            const isSelected = selectedTrack === item.track;
            const isDimmed = selectedTrack !== null && !isSelected;
            return (
              <button
                key={item.track}
                onClick={() => setSelectedTrack(item.track)}
                aria-pressed={isSelected}
                title={isSelected ? 'Clear filter' : `Filter to ${item.track}`}
                className={`measured inline-flex items-center gap-1.5 rounded-[3px] px-1 transition-colors ${
                  isSelected ? 'bg-asphalt-700 text-bone' : isDimmed ? 'text-bone-500' : 'text-bone-200 hover:bg-asphalt-800'
                }`}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-bone-400">{item.track}</span>
                {item.inRange ? (
                  <span>
                    {item.speed.toFixed(1)}{' '}
                    <span className="text-bone-500">({item.lo90.toFixed(1)}–{item.hi90.toFixed(1)})</span>
                  </span>
                ) : (
                  <span className="text-bone-500">out of frame</span>
                )}
              </button>
            );
          })
        )}
        {highlightWindow && (
          <span className="measured ml-auto text-paint" title={highlightWindow.reason}>
            window {highlightWindow.t0.toFixed(2)}–{highlightWindow.t1.toFixed(2)} s
          </span>
        )}
      </div>

      {/* Main SVG Chart Container */}
      <div
        ref={containerRef}
        className="relative min-h-0 w-full flex-1 cursor-crosshair overflow-hidden"
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
                  stroke="rgba(237,234,227,0.07)"
                  strokeWidth={1}
                />
                <text
                  x={margin.left - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#85837c"
                  className="select-none font-mono text-[10.5px]"
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
                  stroke="rgba(237,234,227,0.04)"
                  strokeWidth={1}
                />
                <text
                  x={x}
                  y={margin.top + innerHeight + 16}
                  textAnchor="middle"
                  fill="#85837c"
                  className="select-none font-mono text-[10.5px]"
                >
                  {tick.toFixed(1)}
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

              const fillColor = SIGNAL_COLORS[sig.state] ?? SIGNAL_COLORS.off;

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
                fill={PAINT_COLOR}
                fillOpacity={0.1}
              />
            </g>
          )}

          {/* Clipped Data Paths: Trajectories */}
          <g clipPath="url(#chart-clip-area)">
            {/* 1. Shaded 90% Confidence Ribbons */}
            {showConfidenceBands &&
              trajectoryRenderData.map(
                ({ traj, trackColor, isDimmed, polygonPoints }) => {
                  if (!polygonPoints) return null;
                  return (
                    <g key={`ci-${traj.track}`}>
                      <polygon
                        points={polygonPoints}
                        fill={trackColor}
                        fillOpacity={isDimmed ? 0.04 : 0.13}
                        className="speed-band pointer-events-none transition-opacity duration-200"
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
                    strokeWidth={isSelected ? 2 : 1.5}
                    strokeOpacity={isDimmed ? 0.2 : 0.95}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="speed-curve pointer-events-none"
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
                <text x={bx + 4} y={margin.top + innerHeight - 5} fill={trackColor} className="font-mono text-[10.5px]">
                  brake {b.t.toFixed(2)}
                </text>
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
                  <line x1={ix} y1={margin.top} x2={ix} y2={margin.top + innerHeight} stroke={IMPACT_COLOR} strokeWidth={1.5} />
                  <text
                    x={ix - 5}
                    y={margin.top + 11}
                    textAnchor="end"
                    fill={IMPACT_COLOR}
                    className="select-none font-mono text-[10.5px]"
                  >
                    impact {impactEvent.t.toFixed(2)}
                  </text>
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
                stroke={PAINT_COLOR}
                strokeWidth={1}
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
                    stroke="#0f1012"
                    strokeWidth={1.5}
                    opacity={isDimmed ? 0.25 : 1}
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
                stroke="rgba(237,234,227,0.3)"
                strokeWidth={1}
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip when hovering over chart */}
        {hoverState && !isScrubbing && (
          <div
            className="measured pointer-events-none absolute z-30 rounded border border-line-strong bg-asphalt-800 px-2 py-1.5 text-[12px]"
            style={{
              left: Math.max(4, Math.min(hoverState.x + 12, dimensions.width - 230)),
              top: Math.max(margin.top + 6, 12),
            }}
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-bone-400">
              <span className="text-bone">{hoverState.t.toFixed(2)} s</span>
              <span className="font-sans text-[11px]">Click to seek</span>
            </div>

            {trajectories.map((traj) => {
              const d = getInterpolatedTrajectory(traj, hoverState.t);
              const color = getTrackColor(traj.track);
              return (
                <div
                  key={`hover-item-${traj.track}`}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-1.5 text-bone-400">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    {traj.track}
                  </span>
                  {d.inRange ? (
                    <span>
                      {d.speed.toFixed(1)} <span className="text-bone-500">({d.lo90.toFixed(1)}–{d.hi90.toFixed(1)})</span>
                    </span>
                  ) : (
                    <span className="text-bone-500">out of frame</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

    </Panel>
  );
};
