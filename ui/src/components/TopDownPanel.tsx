import React, { useMemo, useState } from 'react';
import { Navigation, Layers, Crosshair, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { getTrackColor } from '../utils/colors';
import { Trajectory } from '../types/case';

interface VehicleState {
  x: number;
  y: number;
  speed: number;
  accel: number | null;
  headingRad: number;
  headingDeg: number;
  isPreEntry: boolean;
  isPostExit: boolean;
  observed: boolean;
}

/**
 * Computes the interpolated vehicle state (position, speed, heading)
 * at the given timestamp for a specific trajectory.
 */
function getTrajectoryStateAtTime(traj: Trajectory, currentTime: number): VehicleState | null {
  const n = traj.t.length;
  if (n === 0) return null;

  // Before first point
  if (currentTime <= traj.t[0]) {
    let dx = 1;
    let dy = 0;
    if (n > 1) {
      dx = traj.x[1] - traj.x[0];
      dy = traj.y[1] - traj.y[0];
    }
    const headingRad = Math.atan2(dy, dx);
    return {
      x: traj.x[0],
      y: traj.y[0],
      speed: traj.speed_kmh[0] ?? 0,
      accel: traj.long_acc_ms2[0] ?? null,
      headingRad,
      headingDeg: (headingRad * 180) / Math.PI,
      isPreEntry: currentTime < traj.t[0] - 0.05,
      isPostExit: false,
      observed: traj.observed[0] ?? false,
    };
  }

  // After last point
  if (currentTime >= traj.t[n - 1]) {
    let dx = 1;
    let dy = 0;
    if (n > 1) {
      dx = traj.x[n - 1] - traj.x[n - 2];
      dy = traj.y[n - 1] - traj.y[n - 2];
    }
    const headingRad = Math.atan2(dy, dx);
    return {
      x: traj.x[n - 1],
      y: traj.y[n - 1],
      speed: traj.speed_kmh[n - 1] ?? 0,
      accel: traj.long_acc_ms2[n - 1] ?? null,
      headingRad,
      headingDeg: (headingRad * 180) / Math.PI,
      isPreEntry: false,
      isPostExit: currentTime > traj.t[n - 1] + 0.05,
      observed: traj.observed[n - 1] ?? false,
    };
  }

  // Find surrounding time interval [k, k+1]
  let k = 0;
  for (let i = 0; i < n - 1; i++) {
    if (currentTime >= traj.t[i] && currentTime <= traj.t[i + 1]) {
      k = i;
      break;
    }
  }

  const dt = traj.t[k + 1] - traj.t[k];
  const alpha = dt > 1e-6 ? (currentTime - traj.t[k]) / dt : 0;

  const x = traj.x[k] + alpha * (traj.x[k + 1] - traj.x[k]);
  const y = traj.y[k] + alpha * (traj.y[k + 1] - traj.y[k]);
  const speed = traj.speed_kmh[k] + alpha * (traj.speed_kmh[k + 1] - traj.speed_kmh[k]);
  const accel = traj.long_acc_ms2[k] ?? null;

  // Velocity displacement vector for heading
  let dx = traj.x[k + 1] - traj.x[k];
  let dy = traj.y[k + 1] - traj.y[k];

  // If displacement is negligible (e.g. stopped vehicle), search nearby points
  if (Math.hypot(dx, dy) < 0.02) {
    for (let j = k + 1; j < n; j++) {
      const dist = Math.hypot(traj.x[j] - x, traj.y[j] - y);
      if (dist > 0.1) {
        dx = traj.x[j] - x;
        dy = traj.y[j] - y;
        break;
      }
    }
    if (Math.hypot(dx, dy) < 0.02) {
      for (let j = k; j >= 0; j--) {
        const dist = Math.hypot(x - traj.x[j], y - traj.y[j]);
        if (dist > 0.1) {
          dx = x - traj.x[j];
          dy = y - traj.y[j];
          break;
        }
      }
    }
  }

  const headingRad = Math.atan2(dy, dx);
  const headingDeg = (headingRad * 180) / Math.PI;

  return {
    x,
    y,
    speed,
    accel,
    headingRad,
    headingDeg,
    isPreEntry: false,
    isPostExit: false,
    observed: traj.observed[k] ?? true,
  };
}

interface TopDownPanelProps {
  className?: string;
}

export const TopDownPanel: React.FC<TopDownPanelProps> = ({ className = '' }) => {
  const {
    caseData,
    currentTime,
    selectedTrack,
    setSelectedTrack,
    replayMode,
    setReplayMode,
    jumpToTime,
  } = useCaseStore();

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);

  // Compute overall bounding box of all ground geometry in metres
  const { bounds, roadGrid, stopLine } = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const includePoint = (x: number, y: number) => {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    };

    // Trajectory coordinates
    if (caseData?.trajectories) {
      for (const traj of caseData.trajectories) {
        for (let i = 0; i < traj.x.length; i++) {
          includePoint(traj.x[i], traj.y[i]);
        }
      }
    }

    // Calibration ground points
    if (caseData?.calibration?.ground_pts_m) {
      for (const pt of caseData.calibration.ground_pts_m) {
        includePoint(pt[0], pt[1]);
      }
    }

    // Stop line coordinates
    if (caseData?.calibration?.stop_line_m) {
      for (const pt of caseData.calibration.stop_line_m) {
        includePoint(pt[0], pt[1]);
      }
    }

    // Impact coordinate
    if (caseData?.facts?.impact?.xy) {
      includePoint(caseData.facts.impact.xy[0], caseData.facts.impact.xy[1]);
    }

    // Fallback if no valid points
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
      minX = -20;
      maxX = 20;
      minY = -20;
      maxY = 20;
    }

    // Margin padding in metres around the bounding box
    const pad = 6.0;
    const paddedMinX = minX - pad;
    const paddedMaxX = maxX + pad;
    const paddedMinY = minY - pad;
    const paddedMaxY = maxY + pad;

    const width = Math.max(20, paddedMaxX - paddedMinX);
    const height = Math.max(20, paddedMaxY - paddedMinY);

    // Grid spacing (5m if span is under 60m, else 10m)
    const maxSpan = Math.max(width, height);
    const gridStep = maxSpan > 60 ? 10 : 5;

    const startX = Math.floor(paddedMinX / gridStep) * gridStep;
    const endX = Math.ceil(paddedMaxX / gridStep) * gridStep;
    const startY = Math.floor(paddedMinY / gridStep) * gridStep;
    const endY = Math.ceil(paddedMaxY / gridStep) * gridStep;

    const verticalLines: number[] = [];
    for (let gx = startX; gx <= endX; gx += gridStep) {
      verticalLines.push(gx);
    }

    const horizontalLines: number[] = [];
    for (let gy = startY; gy <= endY; gy += gridStep) {
      horizontalLines.push(gy);
    }

    // Graph paper: fine lines every metre (2 m on very large scenes) between the labelled ones.
    const minorStep = maxSpan > 120 ? 2 : 1;
    const minorX: number[] = [];
    for (let gx = startX; gx <= endX; gx += minorStep) if (gx % gridStep !== 0) minorX.push(gx);
    const minorY: number[] = [];
    for (let gy = startY; gy <= endY; gy += minorStep) if (gy % gridStep !== 0) minorY.push(gy);

    return {
      bounds: {
        minX: paddedMinX,
        maxX: paddedMaxX,
        minY: paddedMinY,
        maxY: paddedMaxY,
        width,
        height,
      },
      roadGrid: {
        gridStep,
        verticalLines,
        horizontalLines,
        minorX,
        minorY,
        startX,
        endX,
        startY,
        endY,
      },
      stopLine: caseData?.calibration?.stop_line_m || null,
    };
  }, [caseData]);

  // Compute interpolated states for all trajectories at current time
  const trajectoriesWithState = useMemo(() => {
    if (!caseData?.trajectories) return [];
    return caseData.trajectories.map((traj) => ({
      traj,
      state: getTrajectoryStateAtTime(traj, currentTime),
      color: getTrackColor(traj.track),
    }));
  }, [caseData?.trajectories, currentTime]);

  // Find reference vehicle for Car-Centred mode
  const referenceVehicle = useMemo(() => {
    if (!trajectoriesWithState.length) return null;

    if (selectedTrack) {
      const match = trajectoriesWithState.find((t) => t.traj.track === selectedTrack);
      if (match && match.state) return match;
    }

    // Look for explicit ego / dashcam vehicle
    const egoMatch = trajectoriesWithState.find(
      (t) =>
        t.traj.track === 'ego' ||
        t.traj.track.toLowerCase().includes('ego') ||
        t.traj.track.toLowerCase().startsWith('dashcam')
    );
    if (egoMatch && egoMatch.state) return egoMatch;

    return trajectoriesWithState[0] || null;
  }, [trajectoriesWithState, selectedTrack]);

  // ViewBox & View transformation calculation
  // SVG mapping: svgX = x, svgY = -y (so that +Y points UP on the display)
  const isEgoMode = replayMode === 'ego';

  const { viewBox, worldTransform, counterRotationDeg } = useMemo(() => {
    if (isEgoMode && referenceVehicle?.state) {
      const ref = referenceVehicle.state;
      const refSvgX = ref.x;
      const refSvgY = -ref.y;

      // In SVG space: svg heading = -headingDeg
      // To rotate reference vehicle so it faces straight UP (-90 deg in SVG):
      // refHeadingSvg + rot = -90 => rot = -90 - refHeadingSvg = -90 + headingDeg
      const rotDeg = -90 + ref.headingDeg;
      const viewSize = Math.max(bounds.width, bounds.height, 35) / zoomLevel;

      return {
        viewBox: `${-viewSize / 2} ${-viewSize / 2} ${viewSize} ${viewSize}`,
        worldTransform: `rotate(${rotDeg}) translate(${-refSvgX}, ${-refSvgY})`,
        counterRotationDeg: -rotDeg,
      };
    }

    // Road-Fixed view
    const viewW = bounds.width / zoomLevel;
    const viewH = bounds.height / zoomLevel;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (-bounds.maxY + -bounds.minY) / 2;

    return {
      viewBox: `${centerX - viewW / 2} ${centerY - viewH / 2} ${viewW} ${viewH}`,
      worldTransform: '',
      counterRotationDeg: 0,
    };
  }, [isEgoMode, referenceVehicle, bounds, zoomLevel]);

  const impactEvent = caseData?.facts?.impact || null;

  return (
    <div
      className={`relative flex flex-col h-full bg-zinc-950/70 border border-zinc-800 rounded-lg overflow-hidden text-zinc-100 select-none ${className}`}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-zinc-900/60 border-b border-zinc-800/80 backdrop-blur z-20">
        <div className="flex items-center space-x-2.5">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 font-mono">
            Top-Down Kinematics Replay
          </span>

          {/* Active Mode Badge */}
          <div
            className={`flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-medium border ${
              isEgoMode
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-700/60'
                : 'bg-zinc-800 text-zinc-300 border-zinc-700/60'
            }`}
          >
            {isEgoMode && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />}
            <span>{isEgoMode ? 'Car-Centred (Dashcam)' : 'Road-Fixed'}</span>
          </div>
        </div>

        {/* Header Actions: Mode Toggle & Zoom Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Segmented Mode Switcher */}
          <div className="flex items-center p-0.5 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setReplayMode('road')}
              className={`px-2 py-1 rounded transition-all active:scale-[0.98] ${
                !isEgoMode
                  ? 'bg-zinc-800 text-zinc-100 font-semibold shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Road-Fixed junction frame"
            >
              Road-Fixed
            </button>
            <button
              type="button"
              onClick={() => setReplayMode('ego')}
              className={`flex items-center space-x-1 px-2 py-1 rounded transition-all active:scale-[0.98] ${
                isEgoMode
                  ? 'bg-cyan-950 text-cyan-300 font-semibold shadow-sm border border-cyan-700/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Vehicle-centered dashcam frame"
            >
              <Navigation className="w-3 h-3" />
              <span>Car-Centred</span>
            </button>
          </div>

          <div className="h-4 w-[1px] bg-zinc-800 mx-0.5" />

          {/* Zoom In/Out/Reset */}
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 active:scale-95 transition-all"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.25))}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 active:scale-95 transition-all"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          {zoomLevel !== 1.0 && (
            <button
              type="button"
              onClick={() => setZoomLevel(1.0)}
              className="p-1 rounded text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800/80 active:scale-95 transition-all"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main SVG Orthographic Viewport */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-[#0c0d11]">
        <svg
          className="w-full h-full cursor-crosshair"
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onClick={(e) => {
            // Clicking background deselects active track
            if (e.target === e.currentTarget) {
              setSelectedTrack(null);
            }
          }}
        >
          <defs>
            {/* Pulsing glow filter for impact marker */}
            <filter id="impact-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* World Layer: Handles Car-Centred Rotation and Translation */}
          <g transform={worldTransform}>
            {/* Road Grid Lines & Coordinates */}
            <g id="road-grid-layer" className="pointer-events-none opacity-90">
              {/* Graph paper: the sheet, then the fine 1 m lines */}
              <rect x={roadGrid.startX} y={-roadGrid.endY} width={roadGrid.endX - roadGrid.startX}
                    height={roadGrid.endY - roadGrid.startY} fill="#0f1218" />
              {roadGrid.minorX.map((gx) => (
                <line key={`mx-${gx}`} x1={gx} y1={-roadGrid.startY} x2={gx} y2={-roadGrid.endY}
                      stroke="#22333d" strokeWidth={0.09} />
              ))}
              {roadGrid.minorY.map((gy) => (
                <line key={`my-${gy}`} x1={roadGrid.startX} y1={-gy} x2={roadGrid.endX} y2={-gy}
                      stroke="#22333d" strokeWidth={0.09} />
              ))}
              {/* Vertical Grid Lines (Constant X) */}
              {roadGrid.verticalLines.map((gx) => {
                const isAxis = gx === 0;
                return (
                  <g key={`grid-x-${gx}`}>
                    <line
                      x1={gx}
                      y1={-roadGrid.startY}
                      x2={gx}
                      y2={-roadGrid.endY}
                      stroke={isAxis ? '#5b7787' : '#3d5a6a'}
                      strokeWidth={isAxis ? 0.2 : 0.15}
                    />
                    {/* Tick Label */}
                    <text
                      x={gx}
                      y={-bounds.minY - 0.6}
                      fill={isAxis ? '#d4d4d8' : '#8b9aa6'}
                      fontSize="0.75"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="middle"
                      transform={`rotate(${counterRotationDeg}, ${gx}, ${-bounds.minY - 0.6})`}
                    >
                      {gx > 0 ? `+${gx}m` : `${gx}m`}
                    </text>
                  </g>
                );
              })}

              {/* Horizontal Grid Lines (Constant Y) */}
              {roadGrid.horizontalLines.map((gy) => {
                const isAxis = gy === 0;
                const svgY = -gy;
                return (
                  <g key={`grid-y-${gy}`}>
                    <line
                      x1={roadGrid.startX}
                      y1={svgY}
                      x2={roadGrid.endX}
                      y2={svgY}
                      stroke={isAxis ? '#5b7787' : '#3d5a6a'}
                      strokeWidth={isAxis ? 0.2 : 0.15}
                    />
                    {/* Tick Label */}
                    <text
                      x={bounds.minX + 0.8}
                      y={svgY + 0.25}
                      fill={isAxis ? '#d4d4d8' : '#8b9aa6'}
                      fontSize="0.75"
                      fontFamily="JetBrains Mono, monospace"
                      textAnchor="start"
                      transform={`rotate(${counterRotationDeg}, ${bounds.minX + 0.8}, ${svgY + 0.25})`}
                    >
                      {gy > 0 ? `+${gy}m` : `${gy}m`}
                    </text>
                  </g>
                );
              })}

              {/* Origin Marker */}
              <circle cx={0} cy={0} r={0.3} fill="#71717a" opacity={0.6} />
              <text
                x={0.6}
                y={-0.6}
                fill="#71717a"
                fontSize="0.65"
                fontFamily="JetBrains Mono, monospace"
                transform={`rotate(${counterRotationDeg}, 0.6, -0.6)`}
              >
                (0,0)
              </text>
            </g>

            {/* Calibration Survey Points (Control points) */}
            {caseData?.calibration?.ground_pts_m && (
              <g id="calibration-control-points" className="pointer-events-none opacity-60">
                {caseData.calibration.ground_pts_m.map((pt, idx) => {
                  const px = pt[0];
                  const py = -pt[1];
                  return (
                    <g key={`cal-pt-${idx}`}>
                      <line
                        x1={px - 0.4}
                        y1={py}
                        x2={px + 0.4}
                        y2={py}
                        stroke="#52525b"
                        strokeWidth="0.06"
                      />
                      <line
                        x1={px}
                        y1={py - 0.4}
                        x2={px}
                        y2={py + 0.4}
                        stroke="#52525b"
                        strokeWidth="0.06"
                      />
                      <circle cx={px} cy={py} r="0.12" fill="none" stroke="#71717a" strokeWidth="0.05" />
                    </g>
                  );
                })}
              </g>
            )}

            {/* Stop Line Segment */}
            {stopLine && stopLine.length >= 2 && (
              <g id="stop-line-layer">
                {/* Thick road stop line marking */}
                <line
                  x1={stopLine[0][0]}
                  y1={-stopLine[0][1]}
                  x2={stopLine[1][0]}
                  y2={-stopLine[1][1]}
                  stroke="#ffffff"
                  strokeWidth="0.45"
                  strokeDasharray="0.8 0.4"
                  strokeLinecap="butt"
                  opacity={0.9}
                />
                {/* Stop Line Stencil Label */}
                {(() => {
                  const x0 = stopLine[0][0];
                  const y0 = -stopLine[0][1];
                  const x1 = stopLine[1][0];
                  const y1 = -stopLine[1][1];
                  const midX = (x0 + x1) / 2;
                  const midY = (y0 + y1) / 2;
                  const dx = x1 - x0;
                  const dy = y1 - y0;
                  const len = Math.hypot(dx, dy) || 1;
                  // Normal offset vector perpendicular to the line
                  const nx = -dy / len;
                  const ny = dx / len;
                  const labelX = midX + nx * 1.2;
                  const labelY = midY + ny * 1.2;

                  return (
                    <text
                      x={labelX}
                      y={labelY}
                      fill="#e4e4e7"
                      fontSize="0.75"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight="600"
                      textAnchor="middle"
                      opacity={0.85}
                      transform={`rotate(${counterRotationDeg}, ${labelX}, ${labelY})`}
                    >
                      STOP LINE
                    </text>
                  );
                })()}
              </g>
            )}

            {/* Full Trajectory Paths Layer */}
            <g id="trajectory-paths-layer">
              {trajectoriesWithState.map(({ traj, color }) => {
                const isSelected = selectedTrack === traj.track;
                const isDimmed = selectedTrack !== null && !isSelected;

                // Build SVG path data for full trajectory
                const pathPoints = traj.x.map((xVal, idx) => `${xVal},${-traj.y[idx]}`);
                const fullPathD = pathPoints.length > 0 ? `M ${pathPoints.join(' L ')}` : '';

                // Build SVG path data for past trajectory (up to current time)
                const pastIndices: number[] = [];
                for (let i = 0; i < traj.t.length; i++) {
                  if (traj.t[i] <= currentTime) {
                    pastIndices.push(i);
                  } else {
                    break;
                  }
                }
                const pastPoints = pastIndices.map((idx) => `${traj.x[idx]},${-traj.y[idx]}`);
                const pastPathD = pastPoints.length > 0 ? `M ${pastPoints.join(' L ')}` : '';

                return (
                  <g
                    key={`path-group-${traj.track}`}
                    className="cursor-pointer transition-opacity duration-200"
                    opacity={isDimmed ? 0.2 : 0.85}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrack(traj.track);
                    }}
                  >
                    {/* Wide transparent hit area for easy click selection */}
                    <path
                      d={fullPathD}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />

                    {/* Future / Full Path: semi-transparent dashed */}
                    <path
                      d={fullPathD}
                      fill="none"
                      stroke={color}
                      strokeWidth={isSelected ? '0.22' : '0.12'}
                      strokeDasharray="0.6 0.6"
                      opacity={0.4}
                    />

                    {/* Past Path: vibrant solid line */}
                    {pastPathD && (
                      <path
                        d={pastPathD}
                        fill="none"
                        stroke={color}
                        strokeWidth={isSelected ? '0.32' : '0.2'}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.9}
                      />
                    )}

                    {/* Trajectory breadcrumb dots every few frames */}
                    {traj.x.map((xVal, idx) => {
                      if (idx % 15 !== 0) return null;
                      const isPast = traj.t[idx] <= currentTime;
                      return (
                        <circle
                          key={`pt-${traj.track}-${idx}`}
                          cx={xVal}
                          cy={-traj.y[idx]}
                          r={isSelected ? 0.16 : 0.1}
                          fill={isPast ? color : '#3f3f46'}
                          opacity={isPast ? 0.8 : 0.4}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </g>

            {/* Impact Event Marker */}
            {impactEvent && impactEvent.xy && (
              <g
                id="impact-marker-layer"
                className="cursor-pointer group"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpToTime(impactEvent.t);
                }}
              >
                {/* Pulsing ring at impact coordinate */}
                <circle
                  cx={impactEvent.xy[0]}
                  cy={-impactEvent.xy[1]}
                  r="2.2"
                  stroke="#f43f5e"
                  strokeWidth="0.08"
                  strokeDasharray="0.4 0.3"
                  fill="none"
                  opacity={0.7}
                  className="animate-pulse"
                />
                <circle
                  cx={impactEvent.xy[0]}
                  cy={-impactEvent.xy[1]}
                  r="1.2"
                  stroke="#f43f5e"
                  strokeWidth="0.16"
                  fill="#f43f5e"
                  fillOpacity={0.12}
                />

                {/* Marker 'X' */}
                <line
                  x1={impactEvent.xy[0] - 0.75}
                  y1={-impactEvent.xy[1] - 0.75}
                  x2={impactEvent.xy[0] + 0.75}
                  y2={-impactEvent.xy[1] + 0.75}
                  stroke="#f43f5e"
                  strokeWidth="0.28"
                  strokeLinecap="round"
                />
                <line
                  x1={impactEvent.xy[0] - 0.75}
                  y1={-impactEvent.xy[1] + 0.75}
                  x2={impactEvent.xy[0] + 0.75}
                  y2={-impactEvent.xy[1] - 0.75}
                  stroke="#f43f5e"
                  strokeWidth="0.28"
                  strokeLinecap="round"
                />
                <circle cx={impactEvent.xy[0]} cy={-impactEvent.xy[1]} r="0.25" fill="#f43f5e" />

                {/* Impact Label Badge */}
                {(() => {
                  const ix = impactEvent.xy[0];
                  const iy = -impactEvent.xy[1];
                  const badgeY = iy - 2.2;
                  return (
                    <g transform={`rotate(${counterRotationDeg}, ${ix}, ${badgeY})`}>
                      <rect
                        x={ix - 3.8}
                        y={badgeY - 0.65}
                        width="7.6"
                        height="1.3"
                        rx="0.3"
                        fill="#09090b"
                        stroke="#f43f5e"
                        strokeWidth="0.08"
                        className="group-hover:stroke-rose-400 transition-colors"
                      />
                      <text
                        x={ix}
                        y={badgeY + 0.22}
                        fill="#fda4af"
                        fontSize="0.68"
                        fontFamily="JetBrains Mono, monospace"
                        fontWeight="700"
                        textAnchor="middle"
                      >
                        IMPACT (t = {impactEvent.t.toFixed(2)}s)
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* Vehicles Layer: Oriented Rectangles & Indicators */}
            <g id="vehicles-layer">
              {trajectoriesWithState.map(({ traj, state, color }) => {
                if (!state) return null;

                const isSelected = selectedTrack === traj.track;
                const isDimmed = selectedTrack !== null && !isSelected;

                // Vehicle dimensions in metres (standard passenger car: 4.5m x 1.9m)
                const vehLength = 4.5;
                const vehWidth = 1.9;

                const svgPosX = state.x;
                const svgPosY = -state.y;
                // SVG heading rotation: in SVG, dy_svg = -dy, so svgHeading = -headingDeg
                const svgHeadingDeg = -state.headingDeg;

                return (
                  <g
                    key={`veh-${traj.track}`}
                    className="cursor-pointer transition-opacity duration-200"
                    opacity={isDimmed ? 0.25 : state.isPreEntry ? 0.4 : 1.0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrack(traj.track);
                    }}
                  >
                    {/* Vehicle Oriented Group */}
                    <g transform={`translate(${svgPosX}, ${svgPosY}) rotate(${svgHeadingDeg})`}>
                      {/* Selection highlight glow halo */}
                      {isSelected && (
                        <rect
                          x={-vehLength / 2 - 0.4}
                          y={-vehWidth / 2 - 0.4}
                          width={vehLength + 0.8}
                          height={vehWidth + 0.8}
                          rx="0.7"
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="0.16"
                          strokeDasharray="0.4 0.3"
                          opacity={0.85}
                          className="animate-pulse"
                        />
                      )}

                      {/* 4 Tires */}
                      <rect
                        x={0.8}
                        y={-vehWidth / 2 - 0.16}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#18181b"
                        stroke="#52525b"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={0.8}
                        y={vehWidth / 2 - 0.09}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#18181b"
                        stroke="#52525b"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={-1.55}
                        y={-vehWidth / 2 - 0.16}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#18181b"
                        stroke="#52525b"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={-1.55}
                        y={vehWidth / 2 - 0.09}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#18181b"
                        stroke="#52525b"
                        strokeWidth="0.04"
                      />

                      {/* Main Vehicle Chassis Body */}
                      <rect
                        x={-vehLength / 2}
                        y={-vehWidth / 2}
                        width={vehLength}
                        height={vehWidth}
                        rx="0.45"
                        fill={color}
                        fillOpacity={isSelected ? 0.45 : 0.28}
                        stroke={isSelected ? '#ffffff' : color}
                        strokeWidth={isSelected ? 0.22 : 0.14}
                      />

                      {/* Windshield & Cabin Outline */}
                      <rect
                        x={-1.1}
                        y={-vehWidth / 2 + 0.22}
                        width="2.1"
                        height={vehWidth - 0.44}
                        rx="0.25"
                        fill="#09090b"
                        fillOpacity={0.4}
                        stroke={color}
                        strokeWidth="0.06"
                        opacity={0.7}
                      />
                      <line
                        x1="0.3"
                        y1={-vehWidth / 2 + 0.22}
                        x2="0.3"
                        y2={vehWidth / 2 - 0.22}
                        stroke={color}
                        strokeWidth="0.08"
                        opacity={0.8}
                      />

                      {/* Front Directional Arrow / Chevron */}
                      <path
                        d="M 1.25 -0.45 L 1.85 0 L 1.25 0.45"
                        fill="none"
                        stroke={isSelected ? '#ffffff' : color}
                        strokeWidth="0.18"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Headlight Dots */}
                      <circle cx="2.15" cy="-0.65" r="0.12" fill="#fef08a" opacity={0.9} />
                      <circle cx="2.15" cy="0.65" r="0.12" fill="#fef08a" opacity={0.9} />
                    </g>

                    {/* Vehicle Text Label Badge (Counter-rotated for horizontal legibility) */}
                    {(() => {
                      const badgeOffsetY = -vehWidth / 2 - 1.2;
                      return (
                        <g
                          transform={`translate(${svgPosX}, ${svgPosY + badgeOffsetY}) rotate(${counterRotationDeg})`}
                        >
                          <rect
                            x="-2.6"
                            y="-0.65"
                            width="5.2"
                            height="1.3"
                            rx="0.25"
                            fill="#09090b"
                            fillOpacity={0.9}
                            stroke={isSelected ? '#ffffff' : color}
                            strokeWidth={isSelected ? 0.12 : 0.06}
                          />
                          <text
                            x="0"
                            y="0.24"
                            fill="#f4f4f5"
                            fontSize="0.65"
                            fontFamily="JetBrains Mono, monospace"
                            fontWeight="600"
                            textAnchor="middle"
                          >
                            {traj.track} • {state.speed.toFixed(0)} km/h
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* Overlay Lower-Left: Forensic 10m Scale Bar & Coordinate Status */}
        <div className="absolute bottom-3 left-3 flex items-center space-x-3 bg-zinc-950/85 backdrop-blur-md border border-zinc-800 rounded px-3 py-1.5 text-xs font-mono text-zinc-300 shadow-lg pointer-events-none z-10">
          <div className="flex flex-col items-center">
            <div className="w-14 h-1.5 bg-zinc-300 border-x border-zinc-100 flex justify-between" />
            <span className="text-[10px] text-zinc-400 font-semibold mt-0.5">10m scale</span>
          </div>
          <div className="h-4 w-[1px] bg-zinc-800" />
          <div className="flex flex-col text-[10px] leading-tight text-zinc-400">
            <span>GRID: 1 m squares, labelled every {roadGrid.gridStep} m</span>
            <span>FRAME: {isEgoMode ? 'CAR-CENTRED EGO' : 'ROAD-FIXED JUNCTION'}</span>
          </div>
        </div>

        {/* Overlay Top-Right: Monospace Telemetry Readout */}
        <div className="absolute top-3 right-3 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 rounded-md p-2.5 shadow-xl text-xs font-mono space-y-1.5 z-10 min-w-[210px] max-w-[270px]">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-1 text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">
            <span>Live Telemetry</span>
            <span className="text-cyan-400">t = {currentTime.toFixed(2)}s</span>
          </div>

          <div className="space-y-1.5">
            {trajectoriesWithState.map(({ traj, state, color }) => {
              const isSelected = selectedTrack === traj.track;
              if (!state) return null;

              return (
                <div
                  key={`telemetry-${traj.track}`}
                  onClick={() => setSelectedTrack(traj.track)}
                  className={`flex flex-col p-1.5 rounded cursor-pointer transition-all active:scale-[0.98] ${
                    isSelected
                      ? 'bg-zinc-800/90 border border-zinc-600 text-zinc-100'
                      : 'hover:bg-zinc-900/80 border border-transparent text-zinc-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span>{traj.track}</span>
                    </div>
                    <span className="text-zinc-100">{state.speed.toFixed(1)} km/h</span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mt-0.5">
                    <span>
                      X: {state.x >= 0 ? `+${state.x.toFixed(1)}` : state.x.toFixed(1)}m
                    </span>
                    <span>
                      Y: {state.y >= 0 ? `+${state.y.toFixed(1)}` : state.y.toFixed(1)}m
                    </span>
                    {state.accel !== null && (
                      <span
                        className={
                          state.accel < -1.0
                            ? 'text-rose-400'
                            : state.accel > 1.0
                            ? 'text-emerald-400'
                            : 'text-zinc-400'
                        }
                      >
                        {state.accel >= 0
                          ? `+${state.accel.toFixed(1)}`
                          : state.accel.toFixed(1)}{' '}
                        m/s²
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {impactEvent && (
            <div
              onClick={() => jumpToTime(impactEvent.t)}
              className="mt-1.5 pt-1.5 border-t border-zinc-800/80 flex items-center justify-between text-[10px] text-rose-400 cursor-pointer hover:text-rose-300 transition-colors"
              title="Click to jump to impact time"
            >
              <div className="flex items-center space-x-1">
                <Crosshair className="w-3 h-3 text-rose-500" />
                <span className="font-semibold">IMPACT</span>
              </div>
              <span>
                t = {impactEvent.t.toFixed(2)}s ({impactEvent.ground_gap_m.toFixed(1)}m gap)
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
