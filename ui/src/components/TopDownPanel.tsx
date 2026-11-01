import React, { useMemo, useState } from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton, Segmented } from './ui';
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
    const pad = 9.0;
    const paddedMinX = minX - pad;
    const paddedMaxX = maxX + pad;
    const paddedMinY = minY - pad;
    const paddedMaxY = maxY + pad;

    const width = Math.max(20, paddedMaxX - paddedMinX);
    const height = Math.max(20, paddedMaxY - paddedMinY);

    // Grid spacing (5m if span is under 60m, else 10m)
    const maxSpan = Math.max(width, height);
    const gridStep = maxSpan > 60 ? 10 : 5;
    // Marks are sized in metres; this keeps labels readable in a large scene.
    const u = maxSpan / 34;

    // The sheet runs past the frame, so it fills the panel at any aspect ratio.
    const startX = Math.floor((paddedMinX - maxSpan) / gridStep) * gridStep;
    const endX = Math.ceil((paddedMaxX + maxSpan) / gridStep) * gridStep;
    const startY = Math.floor((paddedMinY - maxSpan) / gridStep) * gridStep;
    const endY = Math.ceil((paddedMaxY + maxSpan) / gridStep) * gridStep;

    const verticalLines: number[] = [];
    for (let gx = startX; gx <= endX; gx += gridStep) {
      verticalLines.push(gx);
    }

    const horizontalLines: number[] = [];
    for (let gy = startY; gy <= endY; gy += gridStep) {
      horizontalLines.push(gy);
    }

    // Graph paper: fine lines every metre (2 m on very large scenes) between the labelled ones.
    const minorStep = maxSpan > 60 ? 5 : 1;
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
        u,
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
    <div className={`relative h-full w-full select-none overflow-hidden bg-asphalt-950 ${className}`}>
      {/* View controls float over the sheet */}
      <div className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded bg-asphalt-900/90 p-0.5">
        <Segmented
          label="Reference frame"
          value={replayMode}
          onChange={setReplayMode}
          options={[
            { value: 'road', label: 'Road', title: 'Road-fixed junction frame' },
            { value: 'ego', label: 'Car', title: 'Centred on the selected vehicle' },
          ]}
        />
        <IconButton label="Zoom in" onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.25))}><ZoomIn className="h-3.5 w-3.5" /></IconButton>
        <IconButton label="Zoom out" onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.25))}><ZoomOut className="h-3.5 w-3.5" /></IconButton>
        {zoomLevel !== 1.0 && (
          <IconButton label="Reset zoom" onClick={() => setZoomLevel(1.0)}><RotateCcw className="h-3.5 w-3.5" /></IconButton>
        )}
      </div>

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
          {/* World Layer: Handles Car-Centred Rotation and Translation */}
          <g transform={worldTransform}>
            {/* Road Grid Lines & Coordinates */}
            <g id="road-grid-layer" className="pointer-events-none opacity-90">
              {/* Graph paper: the sheet, then the fine 1 m lines */}
              <rect x={roadGrid.startX} y={-roadGrid.endY} width={roadGrid.endX - roadGrid.startX}
                    height={roadGrid.endY - roadGrid.startY} fill="#111214" />
              {roadGrid.minorX.map((gx) => (
                <line key={`mx-${gx}`} x1={gx} y1={-roadGrid.startY} x2={gx} y2={-roadGrid.endY}
                      stroke="#1d1e21" strokeWidth={0.09 * bounds.u} />
              ))}
              {roadGrid.minorY.map((gy) => (
                <line key={`my-${gy}`} x1={roadGrid.startX} y1={-gy} x2={roadGrid.endX} y2={-gy}
                      stroke="#1d1e21" strokeWidth={0.09 * bounds.u} />
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
                      stroke={isAxis ? '#46474c' : '#2e2f33'}
                      strokeWidth={(isAxis ? 0.16 : 0.1) * bounds.u}
                    />
                    {/* Tick Label */}
                    <text
                      x={gx}
                      y={-bounds.minY - 0.4 * bounds.u}
                      fill={isAxis ? '#d3d0c8' : '#85837c'}
                      fontSize={0.62 * bounds.u}
                      fontFamily="IBM Plex Mono, monospace"
                      textAnchor="middle"
                      transform={`rotate(${counterRotationDeg}, ${gx}, ${-bounds.minY - 0.4 * bounds.u})`}
                    >
                      {gx} m
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
                      stroke={isAxis ? '#46474c' : '#2e2f33'}
                      strokeWidth={(isAxis ? 0.16 : 0.1) * bounds.u}
                    />
                    {/* Tick Label */}
                    <text
                      x={bounds.minX + 0.8}
                      y={svgY + 0.25}
                      fill={isAxis ? '#d3d0c8' : '#85837c'}
                      fontSize={0.62 * bounds.u}
                      fontFamily="IBM Plex Mono, monospace"
                      textAnchor="start"
                      transform={`rotate(${counterRotationDeg}, ${bounds.minX + 0.8}, ${svgY + 0.25})`}
                    >
                      {gy} m
                    </text>
                  </g>
                );
              })}

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
                        stroke="#46474c"
                        strokeWidth="0.06"
                      />
                      <line
                        x1={px}
                        y1={py - 0.4}
                        x2={px}
                        y2={py + 0.4}
                        stroke="#46474c"
                        strokeWidth="0.06"
                      />
                      <circle cx={px} cy={py} r="0.12" fill="none" stroke="#85837c" strokeWidth="0.05" />
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
                  strokeWidth={0.32 * bounds.u}
                  strokeDasharray={`${0.8 * bounds.u} ${0.4 * bounds.u}`}
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
                  const labelX = midX + nx * 1.6 * bounds.u;
                  const labelY = midY + ny * 1.6 * bounds.u;

                  return (
                    <text
                      x={labelX}
                      y={labelY}
                      fill="#edeae3"
                      fontSize={0.62 * bounds.u}
                      fontFamily="IBM Plex Mono, monospace"
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
                      strokeWidth={(isSelected ? 0.16 : 0.1) * bounds.u}
                      strokeDasharray={`${0.5 * bounds.u} ${0.5 * bounds.u}`}
                      opacity={0.4}
                    />

                    {/* Past Path: vibrant solid line */}
                    {pastPathD && (
                      <path
                        d={pastPathD}
                        fill="none"
                        stroke={color}
                        strokeWidth={(isSelected ? 0.3 : 0.2) * bounds.u}
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
                          r={(isSelected ? 0.16 : 0.1) * bounds.u}
                          fill={isPast ? color : '#46474c'}
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
                <g transform={`translate(${impactEvent.xy[0]}, ${-impactEvent.xy[1]}) scale(${bounds.u * 0.72})`}>
                  <circle r="1.1" fill="#ef5a4c" fillOpacity={0.14} stroke="#ef5a4c" strokeWidth="0.1" />
                  <path d="M-.55 -.55 L.55 .55 M-.55 .55 L.55 -.55" stroke="#ef5a4c" strokeWidth="0.2" strokeLinecap="round" />
                  <g transform={`rotate(${counterRotationDeg})`}>
                    <text x="1.5" y="0.25" fill="#ef5a4c" fontSize="0.68" fontFamily="IBM Plex Mono, monospace">
                      impact {impactEvent.t.toFixed(2)} s
                    </text>
                  </g>
                </g>
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
                          stroke="#f2c037"
                          strokeWidth="0.16"
                          strokeDasharray="0.4 0.3"
                          opacity={0.85}
                         
                        />
                      )}

                      {/* 4 Tires */}
                      <rect
                        x={0.8}
                        y={-vehWidth / 2 - 0.16}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#141517"
                        stroke="#46474c"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={0.8}
                        y={vehWidth / 2 - 0.09}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#141517"
                        stroke="#46474c"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={-1.55}
                        y={-vehWidth / 2 - 0.16}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#141517"
                        stroke="#46474c"
                        strokeWidth="0.04"
                      />
                      <rect
                        x={-1.55}
                        y={vehWidth / 2 - 0.09}
                        width="0.75"
                        height="0.25"
                        rx="0.08"
                        fill="#141517"
                        stroke="#46474c"
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
                        fill="#0a0b0c"
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

                    <g transform={`translate(${svgPosX}, ${svgPosY}) rotate(${counterRotationDeg}) scale(${bounds.u})`}>
                      <text
                        y={-(vehWidth / 2 + 1.4) / bounds.u - 0.4}
                        fill="#edeae3"
                        stroke="#0a0b0c"
                        strokeWidth="0.22"
                        paintOrder="stroke"
                        fontSize="0.72"
                        fontFamily="IBM Plex Mono, monospace"
                        textAnchor="middle"
                      >
                        {traj.track} {state.speed.toFixed(0)} km/h
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        <div className="pointer-events-none absolute bottom-1.5 left-2 z-10 rounded-[3px] bg-asphalt-950/80 px-1.5 py-0.5 text-[11px] text-bone-300">
          1 m squares, labelled every {roadGrid.gridStep} m · {isEgoMode ? 'centred on the vehicle' : 'road-fixed'}
        </div>

        <div className="absolute left-2 top-2 z-10 space-y-px rounded bg-asphalt-900/90 p-1 text-[12px]">
          {trajectoriesWithState.map(({ traj, state, color }) => {
            if (!state) return null;
            const isSelected = selectedTrack === traj.track;
            return (
              <button
                key={`telemetry-${traj.track}`}
                onClick={() => setSelectedTrack(traj.track)}
                aria-pressed={isSelected}
                className={`measured block w-full rounded-[3px] px-1.5 py-0.5 text-left ${isSelected ? 'bg-asphalt-700' : 'hover:bg-asphalt-800'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-bone-300">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {traj.track}
                  </span>
                  <span className="text-bone">{state.speed.toFixed(1)} km/h</span>
                </span>
                <span className="hidden justify-between gap-3 text-[11px] text-bone-500 sm:flex">
                  <span>{state.x >= 0 ? '+' : ''}{state.x.toFixed(1)}, {state.y >= 0 ? '+' : ''}{state.y.toFixed(1)} m</span>
                  {state.accel !== null && (
                    <span className={state.accel < -1 ? 'text-signal-red' : state.accel > 1 ? 'text-signal-green' : ''}>
                      {state.accel >= 0 ? '+' : ''}{state.accel.toFixed(1)} m/s²
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {impactEvent && (
            <button
              onClick={() => jumpToTime(impactEvent.t)}
              title="Jump to the impact"
              className="measured flex w-full items-center justify-between gap-3 rounded-[3px] px-1.5 py-0.5 text-left text-signal-red hover:bg-asphalt-800"
            >
              <span>Impact</span>
              <span>{impactEvent.t.toFixed(2)} s</span>
            </button>
          )}
        </div>
    </div>
  );
};
