import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Crosshair,
  Grid,
  Clock,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Save,
  Play,
  RotateCcw,
  Plus,
  Trash2,
  Sliders,
  Move,
  Camera,
  Layers,
  ArrowLeft,
} from 'lucide-react';
import { CalibrationInfo } from '../types/case';

export interface PointPair {
  id: string;
  u: number;
  v: number;
  x: number;
  y: number;
  errM?: number;
}

export interface CalibrationViewProps {
  caseId: string;
  initialCalibration?: CalibrationInfo | null;
  cameraMode?: 'fixed' | 'dashcam';
  onSave?: (calibData: any) => Promise<void> | void;
  onRunPipeline?: () => void;
  onClose?: () => void;
}

type ActiveTool = 'points' | 'stopline' | 'clock' | 'signal';

// Synthetic ground truth defaults for immediate testing & resets
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
  initialCalibration,
  cameraMode = 'fixed',
  onSave,
  onRunPipeline,
  onClose,
}) => {
  // Mode state
  const [activeCameraMode, setActiveCameraMode] = useState<'fixed' | 'dashcam'>(cameraMode);
  const [activeTool, setActiveTool] = useState<ActiveTool>('points');

  // Calibration entities
  const [points, setPoints] = useState<PointPair[]>(() => {
    if (initialCalibration?.image_pts && initialCalibration.ground_pts_m) {
      return initialCalibration.image_pts.map((img, idx) => ({
        id: `P${idx + 1}`,
        u: Math.round(img[0] * 10) / 10,
        v: Math.round(img[1] * 10) / 10,
        x: initialCalibration.ground_pts_m[idx][0],
        y: initialCalibration.ground_pts_m[idx][1],
      }));
    }
    return DEFAULT_POINTS;
  });

  const [stopLineM, setStopLineM] = useState<[[number, number], [number, number]]>(
    (initialCalibration?.stop_line_m as [[number, number], [number, number]]) || [
      [-8.0, -3.5],
      [-8.0, 3.5],
    ]
  );

  const [clockBoxPx, setClockBoxPx] = useState<[number, number, number, number]>([15, 10, 420, 52]);
  const [signalLightPx, setSignalLightPx] = useState<[number, number]>([950, 220]);

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

  // Canvas refs & interaction
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [draggingStopLineIdx, setDraggingStopLineIdx] = useState<number | null>(null);
  const [isDrawingClockBox, setIsDrawingClockBox] = useState<boolean>(false);
  const [clockBoxStart, setClockBoxStart] = useState<[number, number] | null>(null);
  const [frameImage, setFrameImage] = useState<HTMLImageElement | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  // Load frame 0 from backend or mock
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `/cases/${caseId}/frame/0.jpg`;
    img.onload = () => {
      setFrameImage(img);
    };
    img.onerror = () => {
      // If frame image fails to load, fallback gracefully
      setFrameImage(null);
    };
  }, [caseId]);

  // Compute Homography Matrix & Reprojection Error using DLT Least Squares
  const solveHomography = useCallback((pts: PointPair[]) => {
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
    const updatedPts = pts.map((p) => {
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

  // Update homography when points change
  useEffect(() => {
    solveHomography(points);
  }, [points.length]);

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

    const width = 1280;
    const height = 720;
    canvas.width = width;
    canvas.height = height;

    // 1. Draw Background: loaded frame image or simulated road junction
    if (frameImage) {
      ctx.drawImage(frameImage, 0, 0, width, height);
    } else {
      // Draw simulated photogrammetric roadway canvas
      ctx.fillStyle = '#0f1015';
      ctx.fillRect(0, 0, width, height);

      // Roadway asphalt surface
      ctx.fillStyle = '#161821';
      ctx.beginPath();
      ctx.moveTo(120, height);
      ctx.lineTo(440, 290);
      ctx.lineTo(840, 290);
      ctx.lineTo(1160, height);
      ctx.closePath();
      ctx.fill();

      // Crossing street
      ctx.fillStyle = '#1a1c27';
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
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)'; // cyan glow
      ctx.lineWidth = 1.5;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';

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
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)'; // Rose
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      ctx.lineTo(width, horizonY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f43f5e';
      ctx.fillText('HORIZON LINE (PITCH)', 20, horizonY - 6);

      // Vanishing Point
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(vanishingPoint[0], vanishingPoint[1], 4, 0, Math.PI * 2);
      ctx.fill();

      // Lane Guide rays from vanishing point
      const laneSpread = 260 * (dashcamLaneWidth / 3.5);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.4)';
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
        ctx.strokeStyle = '#f59e0b'; // Amber
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.stroke();

        // Endpoints
        [p1, p2].forEach((p, idx) => {
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(`STOP ${idx + 1}`, p[0] + 8, p[1] - 8);
        });

        // Label at midpoint
        const midU = (p1[0] + p2[0]) / 2;
        const midV = (p1[1] + p2[1]) / 2;
        const lineLenM = Math.hypot(
          stopLineM[0][0] - stopLineM[1][0],
          stopLineM[0][1] - stopLineM[1][1]
        ).toFixed(1);

        ctx.fillStyle = 'rgba(24, 24, 27, 0.85)';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1;
        ctx.fillRect(midU - 45, midV - 22, 90, 18);
        ctx.strokeRect(midU - 45, midV - 22, 90, 18);

        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(`STOP LINE: ${lineLenM}m`, midU - 40, midV - 10);
      }
    }

    // 5. Draw Clock OCR Region Box (Muse Spark)
    if (clockBoxPx) {
      const [x1, y1, x2, y2] = clockBoxPx;
      const bw = x2 - x1;
      const bh = y2 - y1;

      ctx.strokeStyle = '#c084fc'; // Purple
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x1, y1, bw, bh);
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(192, 132, 252, 0.15)';
      ctx.fillRect(x1, y1, bw, bh);

      // Corner handles
      ctx.fillStyle = '#c084fc';
      ctx.fillRect(x1 - 3, y1 - 3, 6, 6);
      ctx.fillRect(x2 - 3, y1 - 3, 6, 6);
      ctx.fillRect(x1 - 3, y2 - 3, 6, 6);
      ctx.fillRect(x2 - 3, y2 - 3, 6, 6);

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#c084fc';
      ctx.fillText('CLOCK OCR (Muse Spark)', x1 + 4, y1 - 5);
    }

    // 6. Draw Signal Head Marker
    if (signalLightPx) {
      const [su, sv] = signalLightPx;

      ctx.strokeStyle = '#10b981'; // Emerald
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(su, sv, 12, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#10b981';
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

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#34d399';
      ctx.fillText('SIGNAL HEAD (Governing)', su + 16, sv + 4);
    }

    // 7. Draw Calibration Points
    points.forEach((p) => {
      const isSelected = selectedPointId === p.id;

      // Outer pulse ring if selected
      if (isSelected) {
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(p.u, p.v, 14, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Pin circle
      ctx.fillStyle = isSelected ? '#06b6d4' : '#0891b2';
      ctx.beginPath();
      ctx.arc(p.u, p.v, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // ID text inside pin
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.id, p.u, p.v);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';

      // Coordinate callout badge
      ctx.font = '9px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(p.u + 12, p.v - 16, 105, 26);
      ctx.strokeStyle = isSelected ? '#06b6d4' : 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(p.u + 12, p.v - 16, 105, 26);

      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`img: (${p.u.toFixed(0)}, ${p.v.toFixed(0)})`, p.u + 16, p.v - 4);
      ctx.fillStyle = '#38bdf8';
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
  ]);

  // Canvas Mouse Interaction Handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return [(e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY];
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const [u, v] = getCanvasCoords(e);

    if (activeTool === 'points') {
      // Check if clicking existing point
      const clicked = points.find((p) => Math.hypot(p.u - u, p.v - v) < 16);
      if (clicked) {
        setDraggingPointId(clicked.id);
        setSelectedPointId(clicked.id);
        return;
      }
      // If clicking empty area, add new point
      const newId = `P${points.length + 1}`;
      const newPoint: PointPair = {
        id: newId,
        u: Math.round(u * 10) / 10,
        v: Math.round(v * 10) / 10,
        x: 0.0,
        y: 0.0,
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

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
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
  const loadPreset = (preset: 'synthetic' | 'lane' | 'square') => {
    if (preset === 'synthetic') {
      setPoints(DEFAULT_POINTS);
      setStopLineM([
        [-8.0, -3.5],
        [-8.0, 3.5],
      ]);
      setClockBoxPx([15, 10, 420, 52]);
      setSignalLightPx([950, 220]);
      solveHomography(DEFAULT_POINTS);
    } else if (preset === 'lane') {
      const lanePoints: PointPair[] = [
        { id: 'P1', u: 234.8, v: 509.1, x: -10.0, y: -3.5 },
        { id: 'P2', u: 158.8, v: 426.3, x: -10.0, y: 0.0 },
        { id: 'P3', u: 887.7, v: 332.5, x: 10.0, y: -3.5 },
        { id: 'P4', u: 760.0, v: 306.7, x: 10.0, y: 0.0 },
      ];
      setPoints(lanePoints);
      solveHomography(lanePoints);
    }
  };

  // Save Calibration handler
  const handleSaveCalibration = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    const payload = {
      image_pts: points.map((p) => [p.u, p.v]),
      ground_pts_m: points.map((p) => [p.x, p.y]),
      stop_line_m: stopLineM,
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
          throw new Error('Server rejected calibration');
        }
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const stopLineLength = Math.hypot(
    stopLineM[0][0] - stopLineM[1][0],
    stopLineM[0][1] - stopLineM[1][1]
  ).toFixed(2);

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans overflow-hidden select-none">
      {/* Top Controls Bar */}
      <div className="h-14 px-6 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between z-20">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-800 text-cyan-400">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-semibold tracking-wide text-zinc-100">
                Camera Calibration Workspace
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-zinc-800 text-zinc-300 border border-zinc-700">
                {caseId}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Interactive photogrammetric plane fitting & ground grid reprojection
            </p>
          </div>
        </div>

        {/* Camera Mode Toggle & Tool Palette */}
        <div className="flex items-center space-x-2">
          {/* Mode Switcher */}
          <div className="flex items-center rounded-lg bg-zinc-950 p-1 border border-zinc-800">
            <button
              onClick={() => setActiveCameraMode('fixed')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-all ${
                activeCameraMode === 'fixed'
                  ? 'bg-zinc-800 text-cyan-400 border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Fixed CCTV
            </button>
            <button
              onClick={() => setActiveCameraMode('dashcam')}
              className={`px-3 py-1 rounded text-xs font-mono font-medium transition-all ${
                activeCameraMode === 'dashcam'
                  ? 'bg-rose-950/80 text-rose-400 border border-rose-800 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Dashcam
            </button>
          </div>

          <div className="h-5 w-[1px] bg-zinc-800" />

          {/* Active Tool Selector */}
          <div className="flex items-center space-x-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => setActiveTool('points')}
              className={`px-2.5 py-1 rounded text-xs font-mono flex items-center space-x-1.5 transition-all ${
                activeTool === 'points'
                  ? 'bg-cyan-950 text-cyan-400 border border-cyan-800'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Click/drag points on ground plane"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Points ({points.length})</span>
            </button>

            <button
              onClick={() => setActiveTool('stopline')}
              className={`px-2.5 py-1 rounded text-xs font-mono flex items-center space-x-1.5 transition-all ${
                activeTool === 'stopline'
                  ? 'bg-amber-950 text-amber-400 border border-amber-800'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Edit Stop Line segment"
            >
              <Move className="w-3.5 h-3.5" />
              <span>Stop Line</span>
            </button>

            <button
              onClick={() => setActiveTool('clock')}
              className={`px-2.5 py-1 rounded text-xs font-mono flex items-center space-x-1.5 transition-all ${
                activeTool === 'clock'
                  ? 'bg-purple-950 text-purple-400 border border-purple-800'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Select burned-in clock region"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Clock ROI</span>
            </button>

            <button
              onClick={() => setActiveTool('signal')}
              className={`px-2.5 py-1 rounded text-xs font-mono flex items-center space-x-1.5 transition-all ${
                activeTool === 'signal'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Marker for governing traffic light"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Signal</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left: Large Video Frame Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative bg-black flex items-center justify-center overflow-hidden border-b lg:border-b-0 lg:border-r border-zinc-800"
        >
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            className="w-full h-full object-contain cursor-crosshair"
          />

          {/* Floating Instructions HUD */}
          <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg bg-zinc-950/80 backdrop-blur border border-zinc-800 text-[11px] font-mono text-zinc-300 pointer-events-none flex items-center space-x-2">
            <Layers className="w-3.5 h-3.5 text-cyan-400" />
            <span>
              {activeTool === 'points' && 'Click canvas to add point. Drag pin to reposition.'}
              {activeTool === 'stopline' && 'Drag endpoint circles to position stop line.'}
              {activeTool === 'clock' && 'Click & drag bounding box over burned-in CCTV timestamp.'}
              {activeTool === 'signal' && 'Click traffic light head governing the stop line.'}
            </span>
          </div>

          {/* Canvas Bottom Overlay: Live Reprojection Badge */}
          <div className="absolute bottom-4 left-4 flex items-center space-x-2">
            <div
              className={`px-3 py-1.5 rounded-lg border flex items-center space-x-2 text-xs font-mono backdrop-blur shadow-lg ${
                reprojRmsM < 0.15
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-amber-950/80 border-amber-500/50 text-amber-300'
              }`}
            >
              {reprojRmsM < 0.15 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              <span>
                RMS Reprojection Error: <strong>{reprojRmsM.toFixed(3)} m</strong>
              </span>
              <span className="text-[10px] opacity-75">
                ({reprojRmsM < 0.15 ? 'Optimal < 0.15m' : 'Refinement Recommended'})
              </span>
            </div>
          </div>
        </div>

        {/* Right: Calibration Controls & Point Pair Table */}
        <div className="w-full lg:w-[460px] bg-zinc-950 flex flex-col border-l border-zinc-800 overflow-y-auto">
          {/* Live Metrics Header Card */}
          <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/30 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono uppercase tracking-wider text-zinc-400">
                Calibration Quality
              </span>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={() => loadPreset('synthetic')}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                >
                  Load Synthetic
                </button>
                <button
                  onClick={() => loadPreset('lane')}
                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                >
                  3.5m Lane Grid
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div
                className={`p-3 rounded-lg border flex flex-col justify-between ${
                  reprojRmsM < 0.15
                    ? 'bg-emerald-950/30 border-emerald-800/60'
                    : 'bg-amber-950/30 border-amber-800/60'
                }`}
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  RMS Error (Metres)
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span
                    className={`text-2xl font-mono font-bold tracking-tight ${
                      reprojRmsM < 0.15 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {reprojRmsM.toFixed(3)}
                  </span>
                  <span className="text-xs font-mono text-zinc-400">m</span>
                </div>
                <span className="text-[10px] text-zinc-400 mt-1">
                  {reprojRmsM < 0.15 ? 'Target achieved (< 0.15m)' : 'Above threshold (> 0.15m)'}
                </span>
              </div>

              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/50 flex flex-col justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  Max Residual
                </span>
                <div className="flex items-baseline space-x-1.5 mt-1">
                  <span className="text-2xl font-mono font-bold text-zinc-200">
                    {reprojMaxM.toFixed(3)}
                  </span>
                  <span className="text-xs font-mono text-zinc-400">m</span>
                </div>
                <span className="text-[10px] text-zinc-500 mt-1">Single-point worst fit</span>
              </div>
            </div>
          </div>

          {/* Point Pair Correspondence Table */}
          <div className="p-4 border-b border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Grid className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                  Point Pairs ({points.length} matching pairs)
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
                className="px-2 py-1 rounded text-xs font-mono bg-cyan-950 border border-cyan-800 text-cyan-300 hover:bg-cyan-900 flex items-center space-x-1"
              >
                <Plus className="w-3 h-3" />
                <span>Add Point</span>
              </button>
            </div>

            {/* Table */}
            <div className="max-h-56 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400">
                  <tr>
                    <th className="py-1.5 px-2.5">ID</th>
                    <th className="py-1.5 px-2">Image (u, v) px</th>
                    <th className="py-1.5 px-2">Ground (X, Y) m</th>
                    <th className="py-1.5 px-2 text-right">Residual</th>
                    <th className="py-1.5 px-2 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300">
                  {points.map((p) => {
                    const isSelected = selectedPointId === p.id;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedPointId(p.id)}
                        className={`hover:bg-zinc-900/60 cursor-pointer transition-colors ${
                          isSelected ? 'bg-cyan-950/40 text-cyan-200' : ''
                        }`}
                      >
                        <td className="py-1.5 px-2.5 font-bold text-cyan-400">{p.id}</td>
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
                              className="w-14 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 text-zinc-200 text-right focus:border-cyan-500 outline-none"
                            />
                            <span className="text-zinc-600">,</span>
                            <input
                              type="number"
                              value={p.v}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPoints((prev) =>
                                  prev.map((pt) => (pt.id === p.id ? { ...pt, v: val } : pt))
                                );
                              }}
                              className="w-14 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 text-zinc-200 text-right focus:border-cyan-500 outline-none"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center space-x-1">
                            <input
                              type="number"
                              step="0.5"
                              value={p.x}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const updated = points.map((pt) =>
                                  pt.id === p.id ? { ...pt, x: val } : pt
                                );
                                setPoints(updated);
                                solveHomography(updated);
                              }}
                              className="w-14 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 text-zinc-200 text-right focus:border-cyan-500 outline-none"
                            />
                            <span className="text-zinc-600">,</span>
                            <input
                              type="number"
                              step="0.5"
                              value={p.y}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const updated = points.map((pt) =>
                                  pt.id === p.id ? { ...pt, y: val } : pt
                                );
                                setPoints(updated);
                                solveHomography(updated);
                              }}
                              className="w-14 bg-zinc-900 px-1 py-0.5 rounded border border-zinc-800 text-zinc-200 text-right focus:border-cyan-500 outline-none"
                            />
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] ${
                              (p.errM ?? 0) < 0.15
                                ? 'text-emerald-400 bg-emerald-950/40'
                                : 'text-amber-400 bg-amber-950/40'
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
                              className="text-zinc-500 hover:text-rose-400 p-0.5"
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
            <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs space-y-2">
              <div className="flex items-center space-x-1.5 text-zinc-300 font-medium">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>Typed-Distance Constraint Helper</span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Apply known physical road measurement between two points (e.g. standard 3.5m lane):
              </p>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleApplyTypedDistance('P1', 'P2', 3.5)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 border border-zinc-700"
                >
                  Set P1↔P2 = 3.5m
                </button>
                <button
                  onClick={() => handleApplyTypedDistance('P3', 'P4', 3.5)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 border border-zinc-700"
                >
                  Set P3↔P4 = 3.5m
                </button>
                <button
                  onClick={() => handleApplyTypedDistance('P1', 'P3', 25.0)}
                  className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-mono text-zinc-200 border border-zinc-700"
                >
                  P1↔P3 = 25m
                </button>
              </div>
            </div>
          </div>

          {/* Stop Line Segment Controls */}
          <div className="p-4 border-b border-zinc-800/80 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Move className="w-4 h-4 text-amber-400" />
                <h3 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                  Stop Line Segment ({stopLineLength}m)
                </h3>
              </div>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  parseFloat(stopLineLength) >= 0.5
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-400'
                    : 'bg-rose-950/60 border-rose-800 text-rose-400'
                }`}
              >
                {parseFloat(stopLineLength) >= 0.5 ? 'Valid (>= 0.5m)' : 'Min 0.5m required'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] text-zinc-400 uppercase">Endpoint 1 (X, Y)m</span>
                <div className="flex items-center space-x-1">
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[0][0]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineM([
                        [val, stopLineM[0][1]],
                        [stopLineM[1][0], stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[0][1]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineM([
                        [stopLineM[0][0], val],
                        [stopLineM[1][0], stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                </div>
              </div>

              <div className="p-2 rounded bg-zinc-900 border border-zinc-800 space-y-1">
                <span className="text-[10px] text-zinc-400 uppercase">Endpoint 2 (X, Y)m</span>
                <div className="flex items-center space-x-1">
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[1][0]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineM([
                        [stopLineM[0][0], stopLineM[0][1]],
                        [val, stopLineM[1][1]],
                      ]);
                    }}
                    className="w-full bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                  <input
                    type="number"
                    step="0.5"
                    value={stopLineM[1][1]}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setStopLineM([
                        [stopLineM[0][0], stopLineM[0][1]],
                        [stopLineM[1][0], val],
                      ]);
                    }}
                    className="w-full bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Clock ROI & Governing Signal Light */}
          <div className="p-4 border-b border-zinc-800/80 space-y-3">
            {/* Clock Bounding Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-purple-300 flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Burned-in Clock Box [x1, y1, x2, y2]</span>
                </span>
                <button
                  onClick={() => setClockBoxPx([15, 10, 420, 52])}
                  className="text-[10px] font-mono text-purple-400 hover:underline"
                >
                  Preset [15, 10, 420, 52]
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-xs font-mono">
                {['x1', 'y1', 'x2', 'y2'].map((lbl, idx) => (
                  <div key={lbl} className="bg-zinc-900 p-1.5 rounded border border-zinc-800">
                    <span className="text-[10px] text-zinc-500 uppercase">{lbl}</span>
                    <input
                      type="number"
                      value={clockBoxPx[idx]}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        const next = [...clockBoxPx] as [number, number, number, number];
                        next[idx] = val;
                        setClockBoxPx(next);
                      }}
                      className="w-full bg-zinc-950 px-1 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Signal Light Position */}
            <div className="space-y-1.5 pt-2 border-t border-zinc-900">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-400 flex items-center space-x-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Governing Traffic Light (u, v) px</span>
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-mono">
                <div className="flex-1 bg-zinc-900 p-1.5 rounded border border-zinc-800 flex items-center space-x-2">
                  <span className="text-[10px] text-zinc-500 uppercase">u:</span>
                  <input
                    type="number"
                    value={signalLightPx[0]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setSignalLightPx([val, signalLightPx[1]]);
                    }}
                    className="w-full bg-zinc-950 px-1 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                </div>
                <div className="flex-1 bg-zinc-900 p-1.5 rounded border border-zinc-800 flex items-center space-x-2">
                  <span className="text-[10px] text-zinc-500 uppercase">v:</span>
                  <input
                    type="number"
                    value={signalLightPx[1]}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setSignalLightPx([signalLightPx[0], val]);
                    }}
                    className="w-full bg-zinc-950 px-1 rounded border border-zinc-700 text-zinc-200 text-right outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Dashcam Specific Controls (if active) */}
          {activeCameraMode === 'dashcam' && (
            <div className="p-4 border-b border-zinc-800/80 bg-rose-950/10 space-y-3">
              <div className="flex items-center space-x-2 text-rose-400">
                <Camera className="w-4 h-4" />
                <h3 className="text-xs font-semibold uppercase tracking-wider">
                  Dashcam Ego-Motion Parameters
                </h3>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase">Lane Width (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    value={dashcamLaneWidth}
                    onChange={(e) => setDashcamLaneWidth(parseFloat(e.target.value) || 3.5)}
                    className="w-full bg-zinc-900 px-2 py-1 rounded border border-zinc-800 text-zinc-200 outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] text-zinc-400 uppercase">Camera Height (m)</span>
                  <input
                    type="number"
                    step="0.05"
                    value={dashcamCameraHeight}
                    onChange={(e) => setDashcamCameraHeight(parseFloat(e.target.value) || 1.3)}
                    className="w-full bg-zinc-900 px-2 py-1 rounded border border-zinc-800 text-zinc-200 outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[10px] text-zinc-400 uppercase">Horizon Y Position</span>
                  <span className="text-[10px] text-rose-400">{horizonY} px</span>
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
                  className="w-full accent-rose-500"
                />
              </div>
            </div>
          )}

          {/* Action Buttons Footer */}
          <div className="p-4 bg-zinc-900/60 border-t border-zinc-800 mt-auto flex items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              {onClose && (
                <button
                  onClick={onClose}
                  className="px-3 py-2 rounded-lg text-xs font-mono font-medium text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 border border-zinc-700 flex items-center space-x-1.5 transition-all"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              )}
              <button
                onClick={() => loadPreset('synthetic')}
                className="px-3 py-2 rounded-lg text-xs font-mono font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-800 flex items-center space-x-1.5 transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleSaveCalibration}
                disabled={isSaving}
                className="px-3.5 py-2 rounded-lg text-xs font-mono font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5 text-zinc-300" />
                <span>{isSaving ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}</span>
              </button>

              <button
                onClick={async () => {
                  await handleSaveCalibration();
                  onRunPipeline?.();
                }}
                className="px-4 py-2 rounded-lg text-xs font-mono font-semibold bg-cyan-400 hover:bg-cyan-300 text-zinc-950 shadow-md shadow-cyan-950/40 flex items-center space-x-2 transition-all active:scale-95"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run Pipeline</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
