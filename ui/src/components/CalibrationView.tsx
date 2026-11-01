import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Crosshair,
  Grid,
  Clock,
  Radio,
  Save,
  Play,
  RotateCcw,
  Plus,
  Trash2,
  Sliders,
  Move,
  Camera,
  ArrowLeft,
} from 'lucide-react';
import { CalibrationInfo, ClipInfo } from '../types/case';
import { Button, Notice, Segmented } from './ui';
import { CalibMethod, CalibrationMethodPanel, RectSize } from './CalibrationMethodPanel';
import { ROAD_PRESETS } from '../content/calibrationPresets';
import { geoToLocalM } from '../utils/geo';

export interface PointPair {
  id: string;
  u: number;
  v: number;
  x: number;
  y: number;
  errM?: number;
  /** Clicked on the frame, but its ground position is not known yet. */
  pending?: boolean;
  lat?: number;
  lng?: number;
  /** Map zoom it was picked at; null when coordinates were pasted. */
  zoom?: number | null;
}

export interface CalibrationViewProps {
  /** Backend case. Null for a pre-rendered scenario, which is explore-only. */
  caseId: string | null;
  /** Shown when there is no backend frame to draw on. */
  frameFallbackUrl?: string | null;
  initialCalibration?: CalibrationInfo | null;
  clip?: ClipInfo | null;
  cameraMode?: 'fixed' | 'dashcam';
  onSave?: (calibData: any) => Promise<void> | void;
  onRunPipeline?: () => void;
  onClose?: () => void;
}

type ActiveTool = 'points' | 'stopline' | 'clock' | 'signal';

// Synthetic ground truth defaults for immediate testing & resets
const rectCorners = (r: RectSize): [number, number][] => [[0, 0], [r.width_m, 0], [r.width_m, r.length_m], [0, r.length_m]];

const firstPreset = ROAD_PRESETS[0];

const DEFAULT_POINTS: PointPair[] = [
  { id: 'P1', u: 234.8, v: 509.1, x: -15.0, y: -3.5 },
  { id: 'P2', u: 158.8, v: 426.3, x: -15.0, y: 3.5 },
  { id: 'P3', u: 887.7, v: 332.5, x: 10.0, y: -3.5 },
  { id: 'P4', u: 760.0, v: 306.7, x: 10.0, y: 3.5 },
  { id: 'P5', u: 1001.6, v: 478.7, x: 0.0, y: -14.0 },
  { id: 'P6', u: 473.8, v: 304.4, x: 0.0, y: 12.0 },
];

export const CalibrationView: React.FC<CalibrationViewProps> = ({
  caseId,
  frameFallbackUrl,
  initialCalibration,
  clip,
  cameraMode = 'fixed',
  onSave,
  onRunPipeline,
  onClose,
}) => {
  // Mode state
  const [activeCameraMode, setActiveCameraMode] = useState<'fixed' | 'dashcam'>(cameraMode);
  const [activeTool, setActiveTool] = useState<ActiveTool>('points');

  // Where the ground coordinates come from. Never chosen for the user: a saved
  // case opens on the method it was saved with, and a method only takes over
  // when the user starts clicking for it.
  const [method, setMethod] = useState<CalibMethod>(initialCalibration?.method ?? (caseId && !initialCalibration ? 'preset' : 'manual'));
  const [rect, setRect] = useState<RectSize>(() => {
    const m = initialCalibration?.ground_model;
    return m?.kind === 'rect'
      ? { id: initialCalibration?.source?.preset_id ?? 'custom', width_m: m.width_m!, length_m: m.length_m!, sigma_width_m: m.sigma_width_m!, sigma_length_m: m.sigma_length_m! }
      : { id: firstPreset.id, width_m: firstPreset.width_m, length_m: firstPreset.length_m, sigma_width_m: firstPreset.sigma_width_m, sigma_length_m: firstPreset.sigma_length_m };
  });
  const typedPoints = useRef<PointPair[] | null>(null);
  const stopLinePx = useRef<[number, number][] | null>(null);
  const [calibWarnings, setCalibWarnings] = useState<string[]>(initialCalibration?.warnings ?? []);

  // Calibration entities
  const [points, setPoints] = useState<PointPair[]>(() => {
    if (initialCalibration?.image_pts && initialCalibration.ground_pts_m) {
      const geo = initialCalibration.source?.geo_pts;
      const zoom = initialCalibration.source?.map_zoom ?? null;
      return initialCalibration.image_pts.map((img, idx) => ({
        id: `P${idx + 1}`,
        u: Math.round(img[0] * 10) / 10,
        v: Math.round(img[1] * 10) / 10,
        x: initialCalibration.ground_pts_m[idx][0],
        y: initialCalibration.ground_pts_m[idx][1],
        ...(geo ? { lat: geo[idx][0], lng: geo[idx][1], zoom } : {}),
      }));
    }
    // Demo points only where nothing is saved anyway; real footage starts empty.
    return caseId ? [] : DEFAULT_POINTS;
  });

  const [stopLineM, setStopLineM] = useState<[[number, number], [number, number]]>(
    (initialCalibration?.stop_line_m as [[number, number], [number, number]]) || [
      [-8.0, -3.5],
      [-8.0, 3.5],
    ]
  );

  // A guess is drawn so the handles are visible, but only a placed line is saved.
  const [stopLineSet, setStopLineSet] = useState<boolean>(Boolean(initialCalibration?.stop_line_m));

  // Starting guesses for a 1280 px wide frame, scaled to this clip.
  const px = (clip?.width || 1280) / 1280;
  const [clockBoxPx, setClockBoxPx] = useState<[number, number, number, number]>(() => [15, 10, 420, 52].map((v) => Math.round(v * px)) as [number, number, number, number]);
  const [signalLightPx, setSignalLightPx] = useState<[number, number]>(() => [Math.round(950 * px), Math.round(220 * px)]);

  // Dashcam specific parameters
  const [dashcamLaneWidth, setDashcamLaneWidth] = useState<number>(3.5);
  const [dashcamCameraHeight, setDashcamCameraHeight] = useState<number>(1.3);
  const [horizonY, setHorizonY] = useState<number>(288);
  const [vanishingPoint, setVanishingPoint] = useState<[number, number]>([640, 288]);

  // Calibration metrics
  const [reprojRmsM, setReprojRmsM] = useState<number>(initialCalibration?.reproj_rms_m ?? 0.042);
  const [reprojMaxM, setReprojMaxM] = useState<number>(initialCalibration?.reproj_max_m ?? 0.078);
  const [homographyH, setHomographyH] = useState<number[][] | null>(initialCalibration?.H ?? null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Canvas refs & interaction
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [draggingStopLineIdx, setDraggingStopLineIdx] = useState<number | null>(null);
  const [isDrawingClockBox, setIsDrawingClockBox] = useState<boolean>(false);
  const [clockBoxStart, setClockBoxStart] = useState<[number, number] | null>(null);
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  // A frame to click on: frame 0 from the backend, else the scenario's still.
  useEffect(() => {
    const urls = [caseId ? `/cases/${caseId}/frame/0.jpg` : null, frameFallbackUrl].filter(Boolean) as string[];
    let live = true;
    const tryNext = (i: number) => {
      if (i >= urls.length) { if (live) setFrameImage(null); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { if (live) setFrameImage(img); };
      img.onerror = () => tryNext(i + 1);
      img.src = urls[i];
    };
    tryNext(0);
    return () => { live = false; };
  }, [caseId, frameFallbackUrl]);

  // Calibration points live in the clip's own pixels, so the canvas does too.
  const canvasW = clip?.width || frameImage?.naturalWidth || 1280;
  const canvasH = clip?.height || frameImage?.naturalHeight || 720;

  // Compute Homography Matrix & Reprojection Error using DLT Least Squares
  const solveHomography = useCallback((all: PointPair[]) => {
    const pts = all.filter((p) => !p.pending);
    if (pts.length < 4) return;

    // Normal equations (A^T A) h = A^T b for least squares homography
    // Solving for h = [h11, h12, h13, h21, h22, h23, h31, h32]^T with h33 = 1
    const n = pts.length;
    const AtA: number[][] = Array(8).fill(0).map(() => Array(8).fill(0));
    const Atb: number[] = Array(8).fill(0);

    for (let i = 0; i < n; i++) {
      const u = pts[i].u;
      const v = pts[i].v;
      const X = pts[i].x;
      const Y = pts[i].y;

      // Row 1: [u, v, 1, 0, 0, 0, -u*X, -v*X] * h = X
      const r1 = [u, v, 1, 0, 0, 0, -u * X, -v * X];
      const b1 = X;
      for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 8; k++) {
          AtA[j][k] += r1[j] * r1[k];
        }
        Atb[j] += r1[j] * b1;
      }

      // Row 2: [0, 0, 0, u, v, 1, -u*Y, -v*Y] * h = Y
      const r2 = [0, 0, 0, u, v, 1, -u * Y, -v * Y];
      const b2 = Y;
      for (let j = 0; j < 8; j++) {
        for (let k = 0; k < 8; k++) {
          AtA[j][k] += r2[j] * r2[k];
        }
        Atb[j] += r2[j] * b2;
      }
    }

    // Solve 8x8 system using Gaussian elimination with partial pivoting
    const A = AtA.map((row) => [...row]);
    const b = [...Atb];

    for (let col = 0; col < 8; col++) {
      let maxRow = col;
      let maxVal = Math.abs(A[col][col]);
      for (let row = col + 1; row < 8; row++) {
        if (Math.abs(A[row][col]) > maxVal) {
          maxVal = Math.abs(A[row][col]);
          maxRow = row;
        }
      }
      if (maxVal < 1e-12) return; // Singular

      // Swap rows
      const tmpA = A[col];
      A[col] = A[maxRow];
      A[maxRow] = tmpA;
      const tmpB = b[col];
      b[col] = b[maxRow];
      b[maxRow] = tmpB;

      // Pivot
      const pivot = A[col][col];
      for (let row = col + 1; row < 8; row++) {
        const factor = A[row][col] / pivot;
        for (let j = col; j < 8; j++) {
          A[row][j] -= factor * A[col][j];
        }
        b[row] -= factor * b[col];
      }
    }

    // Back-substitution
    const h = Array(8).fill(0);
    for (let row = 7; row >= 0; row--) {
      let sum = b[row];
      for (let j = row + 1; j < 8; j++) {
        sum -= A[row][j] * h[j];
      }
      h[row] = sum / A[row][row];
    }

    const H = [
      [h[0], h[1], h[2]],
      [h[3], h[4], h[5]],
      [h[6], h[7], 1.0],
    ];

    // Compute residual errors
    let sqSum = 0;
    let maxE = 0;
    const updatedPts = all.map((p) => {
      if (p.pending) return p;
      const denom = H[2][0] * p.u + H[2][1] * p.v + H[2][2];
      const estX = (H[0][0] * p.u + H[0][1] * p.v + H[0][2]) / denom;
      const estY = (H[1][0] * p.u + H[1][1] * p.v + H[1][2]) / denom;
      const err = Math.hypot(estX - p.x, estY - p.y);
      sqSum += err * err;
      if (err > maxE) maxE = err;
      return { ...p, errM: Math.round(err * 1000) / 1000 };
    });

    const rms = Math.round(Math.sqrt(sqSum / n) * 1000) / 1000;
    setReprojRmsM(rms);
    setReprojMaxM(Math.round(maxE * 1000) / 1000);
    setHomographyH(H);
    setPoints(updatedPts);
  }, []);

  // The saved fit is what the pipeline used, so show it until a point changes;
  // this screen's live solve is a close estimate, not the engine's own fit.
  const showingSavedFit = useRef(Boolean(initialCalibration?.H));
  useEffect(() => {
    if (showingSavedFit.current && initialCalibration?.H) {
      showingSavedFit.current = false;
      const H = initialCalibration.H;
      setPoints((prev) => prev.map((p) => {
        const w = H[2][0] * p.u + H[2][1] * p.v + H[2][2];
        const err = Math.hypot((H[0][0] * p.u + H[0][1] * p.v + H[0][2]) / w - p.x, (H[1][0] * p.u + H[1][1] * p.v + H[1][2]) / w - p.y);
        return { ...p, errM: Math.round(err * 1000) / 1000 };
      }));
      return;
    }
    solveHomography(points);
    // Only the number of points re-fits here; edits call solveHomography directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  const applyMethodPoints = (next: PointPair[]) => {
    setPoints(next);
    setCalibWarnings([]);
    solveHomography(next);
  };

  // Replacing the ground changes its frame, so the stop line stays where it is
  // on the image: remember it in pixels, and re-read it once the new fit exists.
  const startMethod = (m: CalibMethod) => {
    if (m === method && m === 'manual') return;
    const a = groundToImage(stopLineM[0][0], stopLineM[0][1]);
    const b = groundToImage(stopLineM[1][0], stopLineM[1][1]);
    stopLinePx.current = a && b ? [a, b] : null;
    if (method === 'manual') typedPoints.current = points;
    setMethod(m);
    setActiveTool('points');
    setCalibWarnings([]);
    if (m === 'manual') {
      const restored = typedPoints.current ?? (caseId ? [] : DEFAULT_POINTS);
      setPoints(restored);
      solveHomography(restored);
    } else {
      setPoints([]);
      setHomographyH(null);
    }
  };

  const changeRect = (r: RectSize) => {
    setRect(r);
    if (method !== 'preset') return;
    const g = rectCorners(r);
    const next = points.map((p, i) => ({ ...p, x: g[i][0], y: g[i][1] }));
    if (r.width_m > 0 && r.length_m > 0) applyMethodPoints(next);
    else setPoints(next);
  };

  // Ground positions follow from the map points, in metres around their centroid.
  const withMapGround = (all: PointPair[]): PointPair[] => {
    const local = geoToLocalM(all.filter((p) => !p.pending).map((p) => [p.lat!, p.lng!]));
    let i = 0;
    return all.map((p) => {
      if (p.pending) return p;
      const [x, y] = local[i++];
      return { ...p, x, y };
    });
  };

  const handleMapPick = (lat: number, lng: number, zoom: number | null) => {
    applyMethodPoints(withMapGround(points.map((p) => (p.pending ? { ...p, lat, lng, zoom, pending: false } : p))));
  };

  const handleMapMove = (id: string, lat: number, lng: number, zoom: number) => {
    applyMethodPoints(withMapGround(points.map((p) => (p.id === id ? { ...p, lat, lng, zoom } : p))));
  };

  const undoMethodPoint = () => {
    setCalibWarnings([]);
    setHomographyH(null);
    const next = points.slice(0, -1).map((p) => (method === 'preset' ? { ...p, pending: true } : p));
    const ready = method === 'satellite' ? withMapGround(next) : next;
    setPoints(ready);
    solveHomography(ready);
  };

  const imageToGround = (u: number, v: number): [number, number] | null => {
    if (!homographyH) return null;
    const H = homographyH;
    const w = H[2][0] * u + H[2][1] * v + H[2][2];
    return w ? [(H[0][0] * u + H[0][1] * v + H[0][2]) / w, (H[1][0] * u + H[1][1] * v + H[1][2]) / w] : null;
  };

  // Project Ground (X, Y) to Image (u, v) using H^-1
  const groundToImage = useCallback(
    (X: number, Y: number): [number, number] | null => {
      if (!homographyH) return null;
      // Invert 3x3 matrix H
      const H = homographyH;
      const det =
        H[0][0] * (H[1][1] * H[2][2] - H[1][2] * H[2][1]) -
        H[0][1] * (H[1][0] * H[2][2] - H[1][2] * H[2][0]) +
        H[0][2] * (H[1][0] * H[2][1] - H[1][1] * H[2][0]);

      if (Math.abs(det) < 1e-12) return null;
      const invDet = 1.0 / det;

      const invH = [
        [
          (H[1][1] * H[2][2] - H[1][2] * H[2][1]) * invDet,
          (H[0][2] * H[2][1] - H[0][1] * H[2][2]) * invDet,
          (H[0][1] * H[1][2] - H[0][2] * H[1][1]) * invDet,
        ],
        [
          (H[1][2] * H[2][0] - H[1][0] * H[2][2]) * invDet,
          (H[0][0] * H[2][2] - H[0][2] * H[2][0]) * invDet,
          (H[0][2] * H[1][0] - H[0][0] * H[1][2]) * invDet,
        ],
        [
          (H[1][0] * H[2][1] - H[1][1] * H[2][0]) * invDet,
          (H[0][1] * H[2][0] - H[0][0] * H[2][1]) * invDet,
          (H[0][0] * H[1][1] - H[0][1] * H[1][0]) * invDet,
        ],
      ];

      const denom = invH[2][0] * X + invH[2][1] * Y + invH[2][2];
      if (Math.abs(denom) < 1e-6) return null;
      const u = (invH[0][0] * X + invH[0][1] * Y + invH[0][2]) / denom;
      const v = (invH[1][0] * X + invH[1][1] * Y + invH[1][2]) / denom;
      return [u, v];
    },
    [homographyH]
  );

  // Render canvas overlays
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvasW;
    const height = canvasH;
    canvas.width = width;
    canvas.height = height;

    // 1. Draw Background: loaded frame image or simulated road junction
    if (frameImage) {
      ctx.drawImage(frameImage, 0, 0, width, height);
    } else {
      // Draw simulated photogrammetric roadway canvas
      ctx.fillStyle = '#0f1012';
      ctx.fillRect(0, 0, width, height);

      // Roadway asphalt surface
      ctx.fillStyle = '#141517';
      ctx.beginPath();
      ctx.moveTo(120, height);
      ctx.lineTo(440, 290);
      ctx.lineTo(840, 290);
      ctx.lineTo(1160, height);
      ctx.closePath();
      ctx.fill();

      // Crossing street
      ctx.fillStyle = '#1a1b1e';
      ctx.beginPath();
      ctx.moveTo(0, 480);
      ctx.lineTo(width, 360);
      ctx.lineTo(width, 420);
      ctx.lineTo(0, 560);
      ctx.closePath();
      ctx.fill();

      // Subtle asphalt texture lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let y = 300; y < height; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // 2. Draw Ground Grid Overlay (Photogrammetric Perspective Grid)
    if (homographyH) {
      ctx.strokeStyle = 'rgba(242, 192, 55, 0.32)'; 
      ctx.lineWidth = 1.5;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(242, 192, 55, 0.8)';

      // Longitudinal lines along X (-20 to 15 m)
      for (let x = -20; x <= 15; x += 5) {
        const pStart = groundToImage(x, -15);
        const pEnd = groundToImage(x, 15);
        if (pStart && pEnd) {
          ctx.beginPath();
          ctx.moveTo(pStart[0], pStart[1]);
          ctx.lineTo(pEnd[0], pEnd[1]);
          ctx.stroke();

          if (pEnd[1] > 0 && pEnd[1] < height) {
            ctx.fillText(`${x > 0 ? '+' : ''}${x}m`, pEnd[0] + 4, pEnd[1] - 4);
          }
        }
      }

      // Lateral lines along Y (-15 to 15 m)
      for (let y = -15; y <= 15; y += 3.5) {
        const pStart = groundToImage(-20, y);
        const pEnd = groundToImage(15, y);
        if (pStart && pEnd) {
          ctx.beginPath();
          ctx.moveTo(pStart[0], pStart[1]);
          ctx.lineTo(pEnd[0], pEnd[1]);
          ctx.stroke();
        }
      }
    }

    // 3. Draw Dashcam Guides (if Dashcam Mode is ON)
    if (activeCameraMode === 'dashcam') {
      // Horizon line
      ctx.strokeStyle = 'rgba(239, 90, 76, 0.7)'; // Rose
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(width, horizonY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#ef5a4c';
      ctx.fillText('HORIZON LINE (PITCH)', 20, horizonY - 6);

      // Vanishing Point
      ctx.fillStyle = '#ef5a4c';
      ctx.beginPath();
      ctx.arc(vanishingPoint[0], vanishingPoint[1], 4, 0, Math.PI * 2);
      ctx.fill();

      // Lane Guide rays from vanishing point
      const laneSpread = 260 * (dashcamLaneWidth / 3.5);
      ctx.strokeStyle = 'rgba(239, 90, 76, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(vanishingPoint[0], vanishingPoint[1]);
      ctx.lineTo(vanishingPoint[0] - laneSpread, height);
      ctx.moveTo(vanishingPoint[0], vanishingPoint[1]);
      ctx.lineTo(vanishingPoint[0] + laneSpread, height);
      ctx.stroke();
    }

    // 4. Draw Stop Line Segment
    if (stopLineM && stopLineM.length === 2) {
      const p1 = groundToImage(stopLineM[0][0], stopLineM[0][1]);
      const p2 = groundToImage(stopLineM[1][0], stopLineM[1][1]);

      if (p1 && p2) {
        // Glowing stop line
        ctx.strokeStyle = '#edeae3'; // Amber
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();

        // Endpoints
        [p1, p2].forEach((p, idx) => {
          ctx.fillStyle = '#edeae3';
          ctx.beginPath();
          ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = '10px "IBM Plex Mono", monospace';
          ctx.fillStyle = '#edeae3';
          ctx.fillText(`STOP ${idx + 1}`, p[0] + 8, p[1] - 8);
        });

        // Label at midpoint
        const midU = (p1[0] + p2[0]) / 2;
        const midV = (p1[1] + p2[1]) / 2;
        const lineLenM = Math.hypot(
          stopLineM[0][0] - stopLineM[1][0],
          stopLineM[0][1] - stopLineM[1][1]
        ).toFixed(1);

        ctx.fillStyle = 'rgba(10, 11, 12, 0.88)';
        ctx.strokeStyle = '#edeae3';
        ctx.lineWidth = 1;
        ctx.fillRect(midU - 45, midV - 22, 90, 18);
        ctx.strokeRect(midU - 45, midV - 22, 90, 18);

        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.fillStyle = '#edeae3';
        ctx.fillText(`STOP LINE ${lineLenM} m`, midU - 40, midV - 10);
      }
    }

    // 5. Draw Clock OCR Region Box (Muse Spark)
    if (clockBoxPx) {
      const [x1, y1, x2, y2] = clockBoxPx;
      const bw = x2 - x1;
      const bh = y2 - y1;

      ctx.strokeStyle = '#b4b1a9'; // Purple
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, y1, bw, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(180, 177, 169, 0.12)';
      ctx.fillRect(x1, y1, bw, bh);

      // Corner handles
      ctx.fillStyle = '#b4b1a9';
      ctx.fillRect(x1 - 3, y1 - 3, 6, 6);
      ctx.fillRect(x2 - 3, y1 - 3, 6, 6);
      ctx.fillRect(x1 - 3, y2 - 3, 6, 6);
      ctx.fillRect(x2 - 3, y2 - 3, 6, 6);

      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#b4b1a9';
      ctx.fillText('CLOCK (Muse Spark)', x1 + 4, y1 - 5);
    }

    // 6. Draw Signal Head Marker
    if (signalLightPx) {
      const [su, sv] = signalLightPx;

      ctx.strokeStyle = '#4fbf8b'; // Emerald
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(su, sv, 12, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#4fbf8b';
      ctx.beginPath();
      ctx.arc(su, sv, 4, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair lines
      ctx.beginPath();
      ctx.moveTo(su - 18, sv);
      ctx.lineTo(su + 18, sv);
      ctx.moveTo(su, sv - 18);
      ctx.lineTo(su, sv + 18);
      ctx.stroke();

      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#4fbf8b';
      ctx.fillText('GOVERNING SIGNAL', su + 16, sv + 4);
    }

    // 7. Draw Calibration Points
    points.forEach((p) => {
      const isSelected = selectedPointId === p.id;

      // Outer pulse ring if selected
      if (isSelected) {
        ctx.strokeStyle = 'rgba(242, 192, 55, 0.5)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(p.u, p.v, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Pin circle
      ctx.fillStyle = isSelected ? '#f2c037' : '#c99a22';
      ctx.beginPath();
      ctx.arc(p.u, p.v, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // ID text inside pin
      ctx.font = 'bold 9px "IBM Plex Mono", monospace';
      ctx.fillStyle = '#0a0b0c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.id, p.u, p.v);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Coordinate callout badge
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(10, 11, 12, 0.88)';
      ctx.fillRect(p.u + 12, p.v - 16, 105, 26);
      ctx.strokeStyle = isSelected ? '#f2c037' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.u + 12, p.v - 16, 105, 26);

      ctx.fillStyle = '#b4b1a9';
      ctx.fillText(`img: (${p.u.toFixed(0)}, ${p.v.toFixed(0)})`, p.u + 16, p.v - 4);
      ctx.fillStyle = '#f2c037';
      ctx.fillText(`gnd: (${p.x.toFixed(1)}, ${p.y.toFixed(1)})m`, p.u + 16, p.v + 7);
    });
  }, [
    frameImage,
    homographyH,
    groundToImage,
    points,
    selectedPointId,
    stopLineM,
    clockBoxPx,
    signalLightPx,
    activeCameraMode,
    horizonY,
    vanishingPoint,
    dashcamLaneWidth,
    canvasW,
    canvasH,
  ]);

  useEffect(() => {
    if (!homographyH) return;
    if (!stopLineSet) {
      const [a, b] = points.filter((p) => !p.pending);
      if (a && b) setStopLineM([[a.x, a.y], [b.x, b.y]]);
      return;
    }
    if (!stopLinePx.current) return;
    const [a, b] = stopLinePx.current.map(([u, v]) => imageToGround(u, v));
    stopLinePx.current = null;
    if (a && b) setStopLineM([[Math.round(a[0] * 10) / 10, Math.round(a[1] * 10) / 10], [Math.round(b[0] * 10) / 10, Math.round(b[1] * 10) / 10]]);
    // Runs when a new fit appears; imageToGround reads that same fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homographyH]);

  // Canvas Mouse Interaction Handlers
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const handleMouseDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [u, v] = getCanvasCoords(e);

    if (activeTool === 'points') {
      // Check if clicking existing point
      const clicked = points.find((p) => Math.hypot(p.u - u, p.v - v) < 16);
      if (clicked) {
        setDraggingPointId(clicked.id);
        setSelectedPointId(clicked.id);
        return;
      }
      if (method === 'preset') {
        if (points.length >= 4) return;
        const g = rectCorners(rect)[points.length];
        const added: PointPair = { id: `P${points.length + 1}`, u: Math.round(u * 10) / 10, v: Math.round(v * 10) / 10, x: g[0], y: g[1], pending: true };
        const next = [...points, added];
        const done = next.length === 4 ? next.map((p) => ({ ...p, pending: false })) : next;
        setPoints(done);
        setSelectedPointId(added.id);
        return; // the fit follows from the point count changing
      }
      if (method === 'satellite') {
        if (points.some((p) => p.pending)) return; // this point still needs its place on the map
        const added: PointPair = { id: `P${points.length + 1}`, u: Math.round(u * 10) / 10, v: Math.round(v * 10) / 10, x: 0, y: 0, pending: true };
        setPoints([...points, added]);
        setSelectedPointId(added.id);
        return;
      }
      // A new point starts where the current fit puts it, so it cannot wreck the
      // fit before its real ground position has been typed in.
      const newId = `P${Math.max(0, ...points.map((p) => Number(p.id.slice(1)) || 0)) + 1}`;
      const predicted = imageToGround(u, v);
      const newPoint: PointPair = {
        id: newId,
        u: Math.round(u * 10) / 10,
        v: Math.round(v * 10) / 10,
        x: predicted ? Math.round(predicted[0] * 10) / 10 : 0,
        y: predicted ? Math.round(predicted[1] * 10) / 10 : 0,
      };
      const updated = [...points, newPoint];
      setPoints(updated);
      setSelectedPointId(newId);
      solveHomography(updated);
    } else if (activeTool === 'stopline') {
      // Check if clicking near stop line endpoints
      const p1 = groundToImage(stopLineM[0][0], stopLineM[0][1]);
      const p2 = groundToImage(stopLineM[1][0], stopLineM[1][1]);
      if (p1 && Math.hypot(p1[0] - u, p1[1] - v) < 18) {
        setDraggingStopLineIdx(0);
        return;
      }
      if (p2 && Math.hypot(p2[0] - u, p2[1] - v) < 18) {
        setDraggingStopLineIdx(1);
        return;
      }
    } else if (activeTool === 'clock') {
      setIsDrawingClockBox(true);
      setClockBoxStart([Math.round(u), Math.round(v)]);
      setClockBoxPx([Math.round(u), Math.round(v), Math.round(u) + 10, Math.round(v) + 10]);
    } else if (activeTool === 'signal') {
      setSignalLightPx([Math.round(u), Math.round(v)]);
    }
  };

  const handleMouseMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const [u, v] = getCanvasCoords(e);

    if (draggingPointId) {
      setPoints((prev) =>
        prev.map((p) =>
          p.id === draggingPointId
            ? { ...p, u: Math.round(u * 10) / 10, v: Math.round(v * 10) / 10 }
            : p
        )
      );
    } else if (draggingStopLineIdx !== null && homographyH) {
      setStopLineSet(true);
      // Map image coordinate to ground coordinate using H
      const denom = homographyH[2][0] * u + homographyH[2][1] * v + homographyH[2][2];
      const gX = (homographyH[0][0] * u + homographyH[0][1] * v + homographyH[0][2]) / denom;
      const gY = (homographyH[1][0] * u + homographyH[1][1] * v + homographyH[1][2]) / denom;

      setStopLineM((prev) => {
        const next: [[number, number], [number, number]] = [[...prev[0]], [...prev[1]]];
        next[draggingStopLineIdx] = [Math.round(gX * 10) / 10, Math.round(gY * 10) / 10];
        return next;
      });
    } else if (isDrawingClockBox && clockBoxStart) {
      const x1 = Math.min(clockBoxStart[0], Math.round(u));
      const y1 = Math.min(clockBoxStart[1], Math.round(v));
      const x2 = Math.max(clockBoxStart[0], Math.round(u));
      const y2 = Math.max(clockBoxStart[1], Math.round(v));
      setClockBoxPx([x1, y1, x2, y2]);
    }
  };

  const handleMouseUp = () => {
    if (draggingPointId) {
      setDraggingPointId(null);
      solveHomography(points);
    }
    if (draggingStopLineIdx !== null) {
      setDraggingStopLineIdx(null);
    }
    if (isDrawingClockBox) {
      setIsDrawingClockBox(false);
      setClockBoxStart(null);
    }
  };

  // Typed-Distance Helper: sets ground offset based on known distance
  const handleApplyTypedDistance = (p1Id: string, p2Id: string, distanceM: number) => {
    const p1 = points.find((p) => p.id === p1Id);
    const p2 = points.find((p) => p.id === p2Id);
    if (!p1 || !p2) return;

    // Adjust p2 along X/Y direction to exactly match distanceM
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const currentDist = Math.hypot(dx, dy) || 1.0;
    const scale = distanceM / currentDist;

    const newX = Math.round((p1.x + dx * scale) * 10) / 10;
    const newY = Math.round((p1.y + dy * scale) * 10) / 10;

    const updated = points.map((p) => (p.id === p2Id ? { ...p, x: newX, y: newY } : p));
    setPoints(updated);
    solveHomography(updated);
  };

  // Preset Helper
  const loadPreset = (preset: 'synthetic') => {
    if (preset === 'synthetic') {
      setPoints(DEFAULT_POINTS);
      setStopLineM([
        [-8.0, -3.5],
        [-8.0, 3.5],
      ]);
      setClockBoxPx([15, 10, 420, 52]);
      setSignalLightPx([950, 220]);
      solveHomography(DEFAULT_POINTS);
    }
  };

  // Save Calibration handler
  const handleSaveCalibration = async () => {
    if (points.length < 4 || points.some((p) => p.pending)) {
      setSaveStatus('error');
      setSaveError(method === 'preset' ? 'Click all 4 corners first.' : method === 'satellite' ? 'Match at least 4 points on the frame and the map first.' : 'At least 4 points are needed.');
      return false;
    }
    setIsSaving(true);
    setSaveStatus('idle');

    const zooms = points.map((p) => p.zoom ?? null);
    const groundSource =
      method === 'preset'
        ? { method, preset: rect }
        : method === 'satellite'
          ? {
              method,
              geo_pts: points.map((p) => [p.lat, p.lng]),
              // The coarsest view any point was picked at; unknown if any was pasted.
              map_zoom: zooms.includes(null) ? null : Math.min(...(zooms as number[])),
            }
          : { method, ground_pts_m: points.map((p) => [p.x, p.y]) };

    const payload = {
      image_pts: points.map((p) => [p.u, p.v]),
      ...groundSource,
      stop_line_m: stopLineSet ? stopLineM : null,
      clock_box_px: clockBoxPx,
      signal_light_px: signalLightPx,
      camera_mode: activeCameraMode,
      dashcam_params:
        activeCameraMode === 'dashcam'
          ? {
              lane_width_m: dashcamLaneWidth,
              camera_height_m: dashcamCameraHeight,
              horizon_y: horizonY,
            }
          : null,
    };

    setSaveError(null);
    try {
      if (onSave) {
        await onSave(payload);
      } else {
        const res = await fetch(`/cases/${caseId}/calibration`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const detail = await res.json().then((j) => j.detail).catch(() => null);
          throw new Error(detail || `The backend returned ${res.status}.`);
        }
        const fit = await res.json();
        setReprojRmsM(fit.reproj_rms_m);
        setReprojMaxM(fit.reproj_max_m);
        setCalibWarnings(fit.warnings ?? []);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
      return true;
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof TypeError ? 'The backend is not reachable.' : (err as Error).message);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const stopLineLength = Math.hypot(
    stopLineM[0][0] - stopLineM[1][0],
    stopLineM[0][1] - stopLineM[1][1]
  ).toFixed(2);

  return (
    <div className="flex flex-1 flex-col bg-asphalt-900 text-bone lg:h-[calc(100dvh-53px)] lg:flex-none lg:overflow-hidden">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h1 className="font-serif text-[17px] font-light leading-tight text-bone">Calibration</h1>
          <p className="text-[12px] text-bone-400">Tie image pixels to metres on the road, then fit the plane.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Camera type"
            value={activeCameraMode}
            onChange={setActiveCameraMode}
            options={[{ value: 'fixed', label: 'Fixed camera' }, { value: 'dashcam', label: 'Dashcam' }]}
          />
          <Segmented
            label="Tool"
            value={activeTool}
            onChange={setActiveTool}
            options={[
              { value: 'points', label: <><Crosshair className="h-3 w-3" />Points {points.length}</>, title: 'Click or drag points on the road' },
              { value: 'stopline', label: <><Move className="h-3 w-3" />Stop line</>, title: 'Edit the stop line' },
              { value: 'clock', label: <><Clock className="h-3 w-3" />Clock</>, title: 'Box the burned-in clock' },
              { value: 'signal', label: <><Radio className="h-3 w-3" />Signal</>, title: 'Mark the governing traffic light' },
            ]}
          />
        </div>
      </div>

      {!caseId && (
        <div className="shrink-0 border-b border-line bg-asphalt-850 px-3 py-1.5 text-[12.5px] text-bone-300 sm:px-4">
          This is a pre-rendered scenario, so changes stay on this screen: the fit updates live but nothing is saved. Start a new case to calibrate real footage.
        </div>
      )}

      {/* Main Workspace Layout */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left: Large Video Frame Canvas */}
        <div
          ref={containerRef}
          className="relative flex min-h-[46vw] min-w-0 flex-1 items-center justify-center overflow-hidden border-b border-line bg-asphalt-950 lg:min-h-0 lg:border-b-0 lg:border-r"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handleMouseDown}
            onPointerMove={handleMouseMove}
            onPointerUp={handleMouseUp}
            aria-label="Camera frame. Click to add a calibration point, drag a pin to move it."
            className="block max-h-full max-w-full cursor-crosshair touch-none"
            style={{ aspectRatio: `${canvasW} / ${canvasH}` }}
          />

          {/* Floating Instructions HUD */}
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-[3px] bg-asphalt-950/85 px-2 py-1 text-[12px] text-bone-200">
            <span>
              {activeTool === 'points' && method === 'manual' && 'Click to add a point. Drag a pin to move it.'}
              {activeTool === 'points' && method === 'preset' && (points.length < 4 ? `Click corner ${points.length + 1} of 4.` : 'Drag a corner to refine it.')}
              {activeTool === 'points' && method === 'satellite' && (points.some((p) => p.pending) ? 'Now click the same mark on the map.' : 'Click a road mark, then the same mark on the map.')}
              {activeTool === 'stopline' && 'Drag the ends of the stop line.'}
              {activeTool === 'clock' && 'Drag a box over the burned-in clock.'}
              {activeTool === 'signal' && 'Click the traffic light that governs the stop line.'}
            </span>
          </div>

          {points.filter((p) => !p.pending).length > 4 && (
            <div className={`measured pointer-events-none absolute bottom-2 left-2 rounded-[3px] bg-asphalt-950/85 px-2 py-1 text-[12px] ${reprojRmsM < 0.15 ? 'text-signal-green' : 'text-signal-amber'}`}>
              RMS {reprojRmsM.toFixed(3)} m
            </div>
          )}
        </div>

        {/* Right: Calibration Controls & Point Pair Table */}
        <div className="flex w-full flex-col overflow-y-auto bg-asphalt-900 lg:w-[440px]">
          {activeCameraMode === 'fixed' && (
            <CalibrationMethodPanel
              method={method}
              points={points}
              rect={rect}
              onRectChange={changeRect}
              onStart={startMethod}
              onUndo={undoMethodPoint}
              onMapPick={handleMapPick}
              onMapMove={handleMapMove}
            />
          )}

          {/* Live Metrics Header Card */}
          <div className="p-4 border-b border-line  space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px]  text-bone-400">
                Fit quality
              </span>
            </div>

            {calibWarnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
            {points.filter((p) => !p.pending).length <= 4 ? (
              <p className="text-[12.5px] leading-relaxed text-bone-300">
                {points.filter((p) => !p.pending).length < 4
                  ? 'No fit yet: at least 4 points are needed.'
                  : calibWarnings.length ? 'Fit error is hidden for exactly 4 points.' : 'No independent check: exactly 4 points always fit, so a wrong click would not show here. Compare the grid with the road.'}
              </p>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              <div
                className={`p-3 rounded border flex flex-col justify-between ${
                  reprojRmsM < 0.15
                    ? 'bg-asphalt-850 border-line'
                    : 'bg-asphalt-850 border-line'
                }`}
              >
                <span className="text-[11.5px] font-mono  text-bone-400">
                  RMS error
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span
                    className={`measured text-[24px] tracking-tight ${
                      reprojRmsM < 0.15 ? 'text-signal-green' : 'text-signal-amber'
                    }`}
                  >
                    {reprojRmsM.toFixed(3)}
                  </span>
                  <span className="text-[12.5px] text-bone-400">m</span>
                </div>
                <span className="text-[11.5px] text-bone-400 mt-1">
                  {reprojRmsM < 0.15 ? 'Under the 0.15 m target' : 'Above the 0.15 m target; refine the points'}
                </span>
              </div>

              <div className="p-3 rounded border border-line bg-asphalt-850 flex flex-col justify-between">
                <span className="text-[11.5px] font-mono  text-bone-400">
                  Worst point
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="measured text-[24px] text-bone-200">
                    {reprojMaxM.toFixed(3)}
                  </span>
                  <span className="text-[12.5px] text-bone-400">m</span>
                </div>
                <span className="text-[11.5px] text-bone-500 mt-1">Largest single residual</span>
              </div>
            </div>
            )}
          </div>

          {/* Point Pair Correspondence Table */}
          {method === 'manual' && (
          <div className="p-4 border-b border-line space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Grid className="w-4 h-4 text-paint" />
                <h3 className="text-[12.5px] font-medium text-bone-200 ">
                  Point pairs ({points.length})
                </h3>
              </div>
              <button
                onClick={() => {
                  const newId = `P${points.length + 1}`;
                  const newPoint: PointPair = {
                    id: newId,
                    u: 640,
                    v: 360,
                    x: 0,
                    y: 0,
                  };
                  setPoints([...points, newPoint]);
                }}
                className="px-2 py-1 rounded text-[12.5px] bg-paint-soft border border-line-strong text-paint hover:bg-asphalt-800 flex items-center space-x-1"
              >
                <Plus className="w-3 h-3" />
                <span>Add point</span>
              </button>
            </div>

            {/* Table */}
            <div className="max-h-56 overflow-y-auto rounded border border-line bg-asphalt-950">
              <table className="w-full text-left text-[12.5px]">
                <thead className="bg-asphalt-850 border-b border-line text-bone-400">
                  <tr>
                    <th className="py-1.5 px-2.5">ID</th>
                    <th className="py-1.5 px-2">Image (u, v) px</th>
                    <th className="py-1.5 px-2">Ground (X, Y) m</th>
                    <th className="py-1.5 px-2 text-right">Residual</th>
                    <th className="py-1.5 px-2 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-bone-300">
                  {points.map((p) => {
                    const isSelected = selectedPointId === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedPointId(p.id)}
                        className={`hover:bg-asphalt-850 cursor-pointer transition-colors ${
                          isSelected ? 'bg-paint-soft text-bone' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2.5 font-medium text-paint">{p.id}</td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center space-x-1">
                            <input
                              type="number"
                              value={p.u}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPoints((prev) =>
                                  prev.map((pt) => (pt.id === p.id ? { ...pt, u: val } : pt))
                                );
                              }}
                              className="measured w-[58px] rounded border border-line bg-asphalt-850 px-1 py-0.5 text-right text-bone-200 outline-none focus:border-paint"
                            />
                            <span className="text-bone-500">,</span>
                            <input
                              type="number"
                              value={p.v}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPoints((prev) =>
                                  prev.map((pt) => (pt.id === p.id ? { ...pt, v: val } : pt))
                                );
                              }}
                              className="measured w-[58px] rounded border border-line bg-asphalt-850 px-1 py-0.5 text-right text-bone-200 outline-none focus:border-paint"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center space-x-1">
                            <input
                              type="number"
                              step="0.5"
                              value={Math.round(p.x * 100) / 100}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const updated = points.map((pt) =>
                                  pt.id === p.id ? { ...pt, x: val } : pt
                                );
                                setPoints(updated);
                                solveHomography(updated);
                              }}
                              className="measured w-[58px] rounded border border-line bg-asphalt-850 px-1 py-0.5 text-right text-bone-200 outline-none focus:border-paint"
                            />
                            <span className="text-bone-500">,</span>
                            <input
                              type="number"
                              step="0.5"
                              value={Math.round(p.y * 100) / 100}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const updated = points.map((pt) =>
                                  pt.id === p.id ? { ...pt, y: val } : pt
                                );
                                setPoints(updated);
                                solveHomography(updated);
                              }}
                              className="measured w-[58px] rounded border border-line bg-asphalt-850 px-1 py-0.5 text-right text-bone-200 outline-none focus:border-paint"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11.5px] ${
                              (p.errM ?? 0) < 0.15
                                ? 'text-signal-green bg-signal-greensoft'
                                : 'text-signal-amber bg-signal-amberSoft'
                            }`}
                          >
                            {(p.errM ?? 0).toFixed(3)}m
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          {points.length > 4 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const updated = points.filter((pt) => pt.id !== p.id);
                                setPoints(updated);
                                solveHomography(updated);
                              }}
                              className="text-bone-500 hover:text-signal-red p-0.5"
                              title="Delete point"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Typed-Distance Helper Tool */}
            <div className="p-2.5 rounded bg-asphalt-850 border border-line text-[12.5px] space-y-2">
              <div className="flex items-center space-x-1.5 text-bone-300 font-medium">
                <Sliders className="w-3.5 h-3.5 text-paint" />
                <span>Known distances</span>
              </div>
              <p className="text-[12px] text-bone-400">
                Set a measured road distance between two points, such as a 3.5 m lane.
              </p>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleApplyTypedDistance('P1', 'P2', 3.5)}
                  className="px-2 py-1 rounded bg-asphalt-800 hover:bg-asphalt-700 text-[12px] font-mono text-bone-200 border border-line-strong"
                >
                  Set P1↔P2 = 3.5m
                </button>
                <button
                  onClick={() => handleApplyTypedDistance('P3', 'P4', 3.5)}
                  className="px-2 py-1 rounded bg-asphalt-800 hover:bg-asphalt-700 text-[12px] font-mono text-bone-200 border border-line-strong"
                >
                  Set P3↔P4 = 3.5m
                </button>
                <button
                  onClick={() => handleApplyTypedDistance('P1', 'P3', 25.0)}
                  className="px-2 py-1 rounded bg-asphalt-800 hover:bg-asphalt-700 text-[12px] font-mono text-bone-200 border border-line-strong"
                >
                  P1↔P3 = 25m
                </button>
              </div>
            </div>
          </div>

          )}

          {/* Stop Line Segment Controls */}
          <div className="p-4 border-b border-line space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Move className="w-4 h-4 text-signal-amber" />
                <h3 className="text-[12.5px] font-medium text-bone-200 ">
                  Stop line ({stopLineSet ? `${stopLineLength}m` : 'not placed yet'})
                </h3>
              </div>
              <span
                className={`text-[11.5px] font-mono px-2 py-0.5 rounded border ${
                  parseFloat(stopLineLength) >= 0.5
                    ? 'bg-signal-greensoft border-line text-signal-green'
                    : 'bg-signal-redsoft border-line text-signal-red'
                }`}
              >
                {parseFloat(stopLineLength) >= 0.5 ? 'Valid (>= 0.5m)' : 'Min 0.5m required'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="p-2 rounded bg-asphalt-850 border border-line space-y-1">
                <span className="text-[11.5px] text-bone-400">Endpoint 1 (X, Y)m</span>
                <div className="flex items-center space-x-1">
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[0][0]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineSet(true);
                      setStopLineM([
                        [val, stopLineM[0][1]],
                        [stopLineM[1][0], stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-asphalt-950 px-1.5 py-0.5 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[0][1]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineSet(true);
                      setStopLineM([
                        [stopLineM[0][0], val],
                        [stopLineM[1][0], stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-asphalt-950 px-1.5 py-0.5 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                </div>
              </div>

              <div className="p-2 rounded bg-asphalt-850 border border-line space-y-1">
                <span className="text-[11.5px] text-bone-400">Endpoint 2 (X, Y)m</span>
                <div className="flex items-center space-x-1">
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[1][0]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineSet(true);
                      setStopLineM([
                        [stopLineM[0][0], stopLineM[0][1]],
                        [val, stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-asphalt-950 px-1.5 py-0.5 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[1][1]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineSet(true);
                      setStopLineM([
                        [stopLineM[0][0], stopLineM[0][1]],
                        [stopLineM[1][0], val],
                      ]);
                    }}
                    className="w-full bg-asphalt-950 px-1.5 py-0.5 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Clock ROI & Governing Signal Light */}
          <div className="p-4 border-b border-line space-y-3">
            {/* Clock Bounding Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-bone-200 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Burned-in clock box</span>
                </span>
                <button
                  onClick={() => setClockBoxPx([15, 10, 420, 52])}
                  className="text-[11.5px] font-mono text-bone-400 hover:underline"
                >
                  Preset [15, 10, 420, 52]
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-[12.5px]">
                {['x1', 'y1', 'x2', 'y2'].map((lbl, idx) => (
                  <div key={lbl} className="bg-asphalt-850 p-1.5 rounded border border-line">
                    <span className="text-[11.5px] text-bone-500">{lbl}</span>
                    <input
                      type="number"
                      value={clockBoxPx[idx]}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        const next = [...clockBoxPx] as [number, number, number, number];
                        next[idx] = val;
                        setClockBoxPx(next);
                      }}
                      className="w-full bg-asphalt-950 px-1 rounded border border-line-strong text-bone-200 text-right outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Signal Light Position */}
            <div className="space-y-1.5 pt-2 border-t border-line">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-medium text-signal-green flex items-center space-x-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Governing traffic light (px)</span>
                </span>
              </div>
              <div className="flex items-center space-x-2 text-[12.5px]">
                <div className="flex-1 bg-asphalt-850 p-1.5 rounded border border-line flex items-center space-x-2">
                  <span className="text-[11.5px] text-bone-500">u:</span>
                  <input
                    type="number"
                    value={signalLightPx[0]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setSignalLightPx([val, signalLightPx[1]]);
                    }}
                    className="w-full bg-asphalt-950 px-1 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                </div>
                <div className="flex-1 bg-asphalt-850 p-1.5 rounded border border-line flex items-center space-x-2">
                  <span className="text-[11.5px] text-bone-500">v:</span>
                  <input
                    type="number"
                    value={signalLightPx[1]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setSignalLightPx([signalLightPx[0], val]);
                    }}
                    className="w-full bg-asphalt-950 px-1 rounded border border-line-strong text-bone-200 text-right outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Dashcam Specific Controls (if active) */}
          {activeCameraMode === 'dashcam' && (
            <div className="p-4 border-b border-line bg-asphalt-850 space-y-3">
              <div className="flex items-center space-x-2 text-signal-red">
                <Camera className="w-4 h-4" />
                <h3 className="text-[12.5px] font-medium ">
                  Dashcam parameters (stored, not yet used by the engine)
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[12.5px]">
                <div className="space-y-1">
                  <span className="text-[11.5px] text-bone-400">Lane Width (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={dashcamLaneWidth}
                    onChange={(e) => setDashcamLaneWidth(parseFloat(e.target.value) || 3.5)}
                    className="w-full bg-asphalt-850 px-2 py-1 rounded border border-line text-bone-200 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11.5px] text-bone-400">Camera Height (m)</span>
                  <input
                    type="number"
                    step="0.05"
                    value={dashcamCameraHeight}
                    onChange={(e) => setDashcamCameraHeight(parseFloat(e.target.value) || 1.3)}
                    className="w-full bg-asphalt-850 px-2 py-1 rounded border border-line text-bone-200 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1 text-[12.5px]">
                <div className="flex justify-between">
                  <span className="text-[11.5px] text-bone-400">Horizon Y Position</span>
                  <span className="text-[11.5px] text-signal-red">{horizonY} px</span>
                </div>
                <input
                  type="range"
                  min="150"
                  max="450"
                  value={horizonY}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10);
                    setHorizonY(y);
                    setVanishingPoint([vanishingPoint[0], y]);
                  }}
                  className="w-full accent-[#f2c037]"
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="sticky bottom-0 mt-auto space-y-2 border-t border-line bg-asphalt-900 p-3">
            {saveStatus === 'error' && saveError && <Notice tone="error">{saveError}</Notice>}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {onClose && <Button variant="ghost" size="sm" icon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={onClose}>Back</Button>}
                <Button variant="ghost" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => { setMethod('manual'); setCalibWarnings([]); loadPreset('synthetic'); }}>Reset</Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" busy={isSaving} disabled={!caseId && !onSave} icon={<Save className="h-3.5 w-3.5" />} onClick={handleSaveCalibration}
                        title={caseId ? 'Save to the backend' : 'Pre-rendered scenarios cannot be saved'}>
                  {saveStatus === 'saved' ? 'Saved' : 'Save'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Play className="h-3 w-3 fill-current" />}
                  title={caseId ? 'Save, then run the pipeline' : 'Show the recorded pipeline run'}
                  onClick={async () => {
                    if (!caseId || (await handleSaveCalibration())) onRunPipeline?.();
                  }}
                >
                  {caseId ? 'Run pipeline' : 'See pipeline run'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
