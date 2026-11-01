/**
 * Replay3D: the CCTV frame lifts into a 3D scene of the junction.
 *
 * Everything drawn comes from case.json; nothing is invented:
 *  - the road surface is the live video projected onto the ground plane through
 *    the calibration homography (calibration.H maps image px -> ground metres);
 *  - vehicles drive their measured trajectories (x, y, t), drawn as boxes;
 *  - tags show the measured speed with its 90% interval;
 *  - the starting viewpoint is the camera pose recovered from the calibration
 *    (calibration.camera), so "Camera view" lines up with the footage.
 *
 * Coordinates: ground (X, Y) in metres. three.js is right-handed with y up, so a
 * ground point maps to (X, 0, s*Y) with s = -camera.up_sign (s = -1 for a
 * right-handed ground frame, +1 for CARLA's left-handed one).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Box, Grid3x3, Map as MapIcon, Pause, Play, Video } from 'lucide-react';
import { useCaseStore } from '../store/useCaseStore';
import { getTrackColor } from '../utils/colors';
import type { CaseData, Trajectory } from '../types/case';

type Vec2 = [number, number];

interface CameraPose {
  focal_px: number;
  position_m: [number, number, number];
  look_at_m: Vec2 | null;
  up_sign: number;
}

const MOVERS = new Set(['car', 'motorcycle', 'person', 'auto rickshaw', 'bus', 'truck', 'bicycle']);
const SIZE: Record<string, [number, number, number]> = {
  car: [4.5, 1.5, 1.8], motorcycle: [2.0, 1.2, 0.8], bicycle: [1.8, 1.1, 0.6], person: [0.5, 1.7, 0.5],
  'auto rickshaw': [2.8, 1.7, 1.4], bus: [11, 3.2, 2.5], truck: [8, 3.2, 2.5],
};
const COLOURS = ['white', 'black', 'grey', 'gray', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'brown', 'purple'];

/** Ground (X, Y) -> three.js position on the road. */
const toWorld = (x: number, y: number, s: number, h = 0) => new THREE.Vector3(x, h, s * y);

function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * Camera pose from the calibration alone (same maths as the engine's
 * homography.camera_pose): square pixels, optical centre at the image centre,
 * flat road. Used when case.json was produced before calibration.camera existed.
 */
function poseFromH(Hm: number[][], width: number, height: number): CameraPose | null {
  const G0 = invert3(Hm);
  const n0 = Math.hypot(G0[0][0], G0[1][0], G0[2][0]);
  const G = G0.map((r) => r.map((x) => x / n0));
  const cx = width / 2, cy = height / 2;
  const p = [0, 1, 2].map((j) => G[0][j] - cx * G[2][j]);
  const q = [0, 1, 2].map((j) => G[1][j] - cy * G[2][j]);
  const g = G[2];
  const cands: number[] = [];
  if (Math.abs(g[0] * g[1]) > 1e-12) cands.push(-(p[0] * p[1] + q[0] * q[1]) / (g[0] * g[1]));
  if (Math.abs(g[1] ** 2 - g[0] ** 2) > 1e-12) cands.push((p[0] ** 2 + q[0] ** 2 - p[1] ** 2 - q[1] ** 2) / (g[1] ** 2 - g[0] ** 2));
  const f2 = cands.filter((c) => c > 0).sort((a, b) => a - b);
  if (!f2.length) return null;
  const f = Math.sqrt(f2.length === 2 ? (f2[0] + f2[1]) / 2 : f2[0]);
  if (!(f > 0.2 * width && f < 10 * width)) return null;
  // A = K^-1 G, columns a1, a2, a3
  const col = (j: number) => [(G[0][j] - cx * G[2][j]) / f, (G[1][j] - cy * G[2][j]) / f, G[2][j]];
  const a1 = col(0), a2 = col(1), a3 = col(2);
  const nrm = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  let lam = 2 / (nrm(a1) + nrm(a2));
  if (lam * a3[2] < 0) lam = -lam;
  const r1 = a1.map((x) => x * lam), r2 = a2.map((x) => x * lam), t = a3.map((x) => x * lam);
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
  // C = -R^T t with R = [r1 r2 r3] as columns
  const C = [0, 1, 2].map((i) => -([r1, r2, r3][i][0] * t[0] + [r1, r2, r3][i][1] * t[1] + [r1, r2, r3][i][2] * t[2]));
  const axis = [r1[2], r2[2], r3[2]]; // R^T (0, 0, 1)
  let look: Vec2 | null = null;
  if (Math.abs(axis[2]) > 1e-6) {
    const k = -C[2] / axis[2];
    if (k > 0) look = [C[0] + k * axis[0], C[1] + k * axis[1]];
  }
  return { focal_px: f, position_m: [C[0], C[1], Math.abs(C[2])], look_at_m: look, up_sign: C[2] > 0 ? 1 : -1 };
}

/** Position, heading and speed of one trajectory at time t (null outside it). */
function stateAt(tr: Trajectory, t: number) {
  const n = tr.t.length;
  if (n < 2 || t < tr.t[0] || t > tr.t[n - 1]) return null;
  let k = 1;
  while (k < n - 1 && tr.t[k] < t) k++;
  const t0 = tr.t[k - 1], t1 = tr.t[k];
  const a = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const lerp = (arr: number[]) => arr[k - 1] + (arr[k] - arr[k - 1]) * a;
  // Heading from a step ~0.2 s wide, so it doesn't jitter frame to frame.
  const k0 = Math.max(0, k - 3), k1 = Math.min(n - 1, k + 2);
  return {
    x: lerp(tr.x), y: lerp(tr.y),
    dx: tr.x[k1] - tr.x[k0], dy: tr.y[k1] - tr.y[k0],
    kmh: lerp(tr.speed_kmh), lo: lerp(tr.lo90_kmh), hi: lerp(tr.hi90_kmh), k,
  };
}

/** "white car" from Wonder's scene description, else the track id. */
function vehicleName(data: CaseData, id: string, concept: string): string {
  const tracks: { track_id: string; description?: string }[] = data.scene?.tracks || [];
  const d = tracks.find((s) => s.track_id === id)?.description || '';
  const colour = COLOURS.find((c) => new RegExp(`\\b${c}`, 'i').test(d));
  const word = concept === 'motorcycle' ? 'two-wheeler' : concept;
  return colour ? `${colour === 'gray' ? 'grey' : colour} ${word}` : id;
}

// ---------------------------------------------------------------- road surface

const roadVertex = /* glsl */ `
  attribute vec2 ground;
  varying vec2 vGround;
  void main() {
    vGround = ground;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const roadFragment = /* glsl */ `
  uniform sampler2D video;
  uniform mat3 Hinv;      // ground (X, Y, 1) -> image (u, v, w)
  uniform vec2 imgSize;
  uniform float gridOn;
  varying vec2 vGround;
  // Anti-aliased grid line strength for a given spacing (metres).
  float gridLine(vec2 g, float spacing) {
    vec2 c = g / spacing;
    vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(d.x, d.y), 1.0);
  }
  void main() {
    vec3 p = Hinv * vec3(vGround, 1.0);
    // Graph paper: 1 m squares, a bold line every 5 m.
    float minor = gridLine(vGround, 1.0) * 0.5, major = gridLine(vGround, 5.0);
    vec3 paper = vec3(0.045, 0.05, 0.06);
    vec3 ink = vec3(0.32, 0.78, 0.88);
    vec3 offImage = paper + ink * (minor * 0.10 + major * 0.28);
    if (p.z <= 0.0) { gl_FragColor = vec4(offImage, 1.0); return; }
    vec2 uv = p.xy / p.z / imgSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(offImage, 1.0); return; }
    vec3 c = texture2D(video, vec2(uv.x, 1.0 - uv.y)).rgb;
    c = mix(c, ink, minor * 0.10 * gridOn + major * 0.30 * gridOn);
    gl_FragColor = vec4(c, 1.0);
  }`;

function RoadSurface({ data, video, s, bounds, grid }: {
  data: CaseData; video: HTMLVideoElement; s: number; bounds: [number, number, number, number]; grid: boolean;
}) {
  const [x0, x1, y0, y1] = bounds;
  const geom = useMemo(() => {
    const N = 48, pos: number[] = [], gr: number[] = [], idx: number[] = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const X = x0 + ((x1 - x0) * i) / N, Y = y0 + ((y1 - y0) * j) / N;
        pos.push(X, 0, s * Y);
        gr.push(X, Y);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('ground', new THREE.Float32BufferAttribute(gr, 2));
    g.setIndex(idx);
    return g;
  }, [x0, x1, y0, y1, s]);

  const material = useMemo(() => {
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    // H is defined up to scale, including its sign: scale H^-1 so that road
    // points in front of the camera map to w > 0 (checked on a point near the
    // bottom of the image, which is always road in front of the camera).
    const H = data.calibration.H, u = data.clip.width / 2, v = data.clip.height * 0.9;
    const gw = H[2][0] * u + H[2][1] * v + H[2][2];
    const gx = (H[0][0] * u + H[0][1] * v + H[0][2]) / gw, gy = (H[1][0] * u + H[1][1] * v + H[1][2]) / gw;
    const Hi0 = invert3(H);
    const sign = Math.sign(Hi0[2][0] * gx + Hi0[2][1] * gy + Hi0[2][2]) || 1;
    const Hi = Hi0.map((row) => row.map((x) => x * sign));
    // three.js Matrix3.set takes row-major values.
    const m = new THREE.Matrix3().set(Hi[0][0], Hi[0][1], Hi[0][2], Hi[1][0], Hi[1][1], Hi[1][2], Hi[2][0], Hi[2][1], Hi[2][2]);
    return new THREE.ShaderMaterial({
      uniforms: { video: { value: tex }, Hinv: { value: m }, imgSize: { value: new THREE.Vector2(data.clip.width, data.clip.height) },
                  gridOn: { value: 1.0 } },
      vertexShader: roadVertex, fragmentShader: roadFragment, side: THREE.DoubleSide,
    });
  }, [data, video]);

  material.uniforms.gridOn.value = grid ? 1.0 : 0.0;
  return <mesh geometry={geom} material={material} />;
}

// ---------------------------------------------------------------- vehicles

/**
 * The measured point is the vehicle's lowest visible pixel: the part of it
 * nearest the camera. Draw the box with that corner there, i.e. its centre
 * half a length and half a width further from the camera (display only).
 */
function boxCentre(x: number, y: number, dx: number, dy: number, L: number, W: number, cam: Vec2 | null): Vec2 {
  const n = Math.hypot(dx, dy);
  if (!cam || n < 1e-6) return [x, y];
  const ux = dx / n, uy = dy / n, nx = -uy, ny = ux;
  const ax = x - cam[0], ay = y - cam[1];
  const su = Math.sign(ax * ux + ay * uy) || 1, sn = Math.sign(ax * nx + ay * ny) || 1;
  return [x + su * (L / 2) * ux + sn * (W / 2) * nx, y + su * (L / 2) * uy + sn * (W / 2) * ny];
}

function Vehicle({ tr, concept, name, s, t, cam, lift, compact }: {
  tr: Trajectory; concept: string; name: string; s: number; t: number; cam: Vec2 | null; lift: number; compact?: boolean;
}) {
  const st = stateAt(tr, t);
  const colour = getTrackColor(tr.track);
  const [L, Hh, W] = SIZE[concept] || SIZE.car;
  let trail: THREE.Vector3[] | null = null;
  if (st) {
    const pts: THREE.Vector3[] = [];
    for (let k = Math.max(0, st.k - 60); k < st.k; k++) pts.push(toWorld(tr.x[k], tr.y[k], s, 0.05));
    pts.push(toWorld(st.x, st.y, s, 0.05));
    trail = pts.length > 1 ? pts : null;
  }
  if (!st) return null;
  const yaw = Math.atan2(-(s * st.dy), st.dx);
  const [cx, cy] = boxCentre(st.x, st.y, st.dx, st.dy, L, W, cam);
  return (
    <group>
      {trail && <Line points={trail} color={colour} lineWidth={3} transparent opacity={0.85} />}
      <group position={toWorld(cx, cy, s, Hh / 2)} rotation={[0, yaw, 0]}>
        <mesh>
          <boxGeometry args={[L, Hh, W]} />
          <meshStandardMaterial color={colour} transparent opacity={0.55} roughness={0.4} metalness={0.1} />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(L, Hh, W)]} />
          <lineBasicMaterial color={colour} />
        </lineSegments>
      </group>
      <Html position={toWorld(cx, cy, s, Hh + lift)} center zIndexRange={[20, 0]}>
        {compact ? (
          <div className="pointer-events-none select-none whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white"
               style={{ background: 'rgba(9,9,11,0.8)', borderColor: colour }}>
            {st.kmh.toFixed(0)} km/h
          </div>
        ) : (
          <div className="pointer-events-none select-none whitespace-nowrap rounded-md border px-2 py-1 text-center shadow-lg"
               style={{ background: 'rgba(9,9,11,0.82)', borderColor: colour }}>
            <div className="text-[11px] font-medium capitalize" style={{ color: colour }}>{name}</div>
            <div className="text-[15px] font-semibold text-white tabular-nums">{st.kmh.toFixed(1)} km/h</div>
            <div className="text-[10px] text-zinc-400 tabular-nums">90%: {st.lo.toFixed(1)} to {st.hi.toFixed(1)}</div>
          </div>
        )}
      </Html>
    </group>
  );
}

function ImpactRing({ xy, tImpact, t, s }: { xy: Vec2; tImpact: number; t: number; s: number }) {
  const dt = t - tImpact;
  if (dt < 0 || dt > 1.2) return null;
  const r = 1 + dt * 9, op = 1 - dt / 1.2;
  return (
    <group position={toWorld(xy[0], xy[1], s, 0.08)} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <ringGeometry args={[r, r + 0.35, 64]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={op} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.9, 32]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.5 * op} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- claim ghost

interface Ghost { track: string; sid: string; kmh: number }

/** Speed claims with a number, one per vehicle: "what if the claimed speed were true". */
function claimGhosts(data: CaseData): Ghost[] {
  const out: Ghost[] = [];
  for (const c of data.claims || []) {
    if (c.quantity !== 'speed_kmh' || c.value_number == null) continue;
    if (!data.trajectories.some((tr) => tr.track === c.subject_track)) continue;
    if (out.some((g) => g.track === c.subject_track)) continue;
    out.push({ track: c.subject_track, sid: c.statement_id, kmh: c.value_number });
  }
  return out;
}

/** Point at arc length `d` along a trajectory's measured path. */
function alongPath(tr: Trajectory, cum: number[], d: number) {
  const n = cum.length;
  let k = 1;
  while (k < n - 1 && cum[k] < d) k++;
  const seg = cum[k] - cum[k - 1] || 1e-6;
  const a = Math.max(0, Math.min(1, (d - cum[k - 1]) / seg));
  return {
    x: tr.x[k - 1] + (tr.x[k] - tr.x[k - 1]) * a, y: tr.y[k - 1] + (tr.y[k] - tr.y[k - 1]) * a,
    dx: tr.x[k] - tr.x[k - 1], dy: tr.y[k] - tr.y[k - 1],
  };
}

/**
 * A wire-frame twin of the vehicle that drives the SAME measured path, but at
 * the speed its driver claimed, from the moment the camera first sees it. At
 * the impact it stops, and a dashed line shows how far back the claim puts
 * the vehicle. Purely what the claim implies; labelled as such.
 */
function ClaimGhost({ tr, g, concept, s, t, tImpact, compact }: {
  tr: Trajectory; g: Ghost; concept: string; s: number; t: number; tImpact: number | null; compact?: boolean;
}) {
  const cum = useMemo(() => {
    const c = [0];
    for (let k = 1; k < tr.x.length; k++) c.push(c[k - 1] + Math.hypot(tr.x[k] - tr.x[k - 1], tr.y[k] - tr.y[k - 1]));
    return c;
  }, [tr]);
  const t0 = tr.t[0];
  if (t < t0) return null;
  const tEnd = tImpact ?? tr.t[tr.t.length - 1];
  const tg = Math.min(t, tEnd);
  const p = alongPath(tr, cum, ((g.kmh / 3.6) * (tg - t0)));
  const [L, Hh, W] = SIZE[concept] || SIZE.car;
  const yaw = Math.atan2(-(s * p.dy), p.dx);
  let gapLine: THREE.Vector3[] | null = null, gap = 0;
  if (tImpact != null && t >= tImpact) {
    const real = stateAt(tr, tImpact);
    if (real) {
      // Distance along the path between the claim's position and the real one.
      let dReal = 0;
      for (let k = 1; k < real.k; k++) dReal = cum[k];
      dReal += Math.hypot(real.x - tr.x[real.k - 1], real.y - tr.y[real.k - 1]);
      gap = dReal - (g.kmh / 3.6) * (tImpact - t0);
      gapLine = [toWorld(p.x, p.y, s, 0.12), toWorld(real.x, real.y, s, 0.12)];
    }
  }
  return (
    <group>
      <group position={toWorld(p.x, p.y, s, Hh / 2)} rotation={[0, yaw, 0]}>
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(L, Hh, W)]} />
          <lineBasicMaterial color="#e4e4e7" transparent opacity={0.85} />
        </lineSegments>
        <mesh>
          <boxGeometry args={[L, Hh, W]} />
          <meshBasicMaterial color="#e4e4e7" transparent opacity={0.08} depthWrite={false} />
        </mesh>
      </group>
      <Html position={toWorld(p.x, p.y, s, Hh + 1.4)} center zIndexRange={[19, 0]}>
        <div className="pointer-events-none whitespace-nowrap rounded border border-dashed border-zinc-400 bg-zinc-950/80 px-2 py-0.5 text-[11px] text-zinc-200">
          {compact ? `${g.sid} claim: ${g.kmh}` : `If ${g.sid}'s claim were true: ${g.kmh} km/h`}
        </div>
      </Html>
      {gapLine && gap > 0.5 && (
        <>
          <Line points={gapLine} color="#e4e4e7" lineWidth={2} dashed dashSize={0.6} gapSize={0.4} />
          <Html position={gapLine[0].clone().lerp(gapLine[1], 0.6).setY(0.6)} center zIndexRange={[18, 0]}
                style={{ transform: 'translateY(18px)' }}>
            <div className="pointer-events-none whitespace-nowrap rounded bg-rose-500/90 px-2 py-0.5 text-[12px] font-semibold text-white">
              {compact ? `${gap.toFixed(1)} m back` : `${gap.toFixed(1)} m further back at the impact`}
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

// ---------------------------------------------------------------- camera flight

interface Pose { pos: THREE.Vector3; look: THREE.Vector3; fov: number }
type Mode = 'camera' | '3d' | 'top';

/** Flies from wherever the camera is to `target`; then hands over to the orbit controls. */
function CameraRig({ target, mode, onSettled }: { target: Pose; mode: Mode; onSettled: (m: Mode) => void }) {
  const { camera } = useThree();
  const anim = useRef<{ mode: Mode | null; p: number; from: Pose | null; lift: number }>({ mode: null, p: 1, from: null, lift: 0 });
  const cam = camera as THREE.PerspectiveCamera;
  useFrame((_, dt) => {
    const a = anim.current;
    if (a.mode !== mode) {
      // Start a new flight from the current view (wherever the orbit left it).
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const hit = dir.y < -1e-3 ? cam.position.clone().add(dir.multiplyScalar(-cam.position.y / dir.y)) : target.look.clone();
      const first = a.mode === null;
      a.from = { pos: cam.position.clone(), look: hit, fov: cam.fov };
      a.lift = (a.mode === 'camera' || mode === 'camera') && !first ? 12 : 0;
      a.mode = mode;
      a.p = first ? 1 : 0;
    }
    if (a.p >= 1 && a.from === null) return; // settled: the orbit controls own the camera
    a.p = Math.min(1, a.p + dt / 2.0);
    const e = a.p < 0.5 ? 4 * a.p ** 3 : 1 - Math.pow(-2 * a.p + 2, 3) / 2;
    const from = a.from!;
    const pos = from.pos.clone().lerp(target.pos, e);
    pos.y += Math.sin(Math.PI * e) * a.lift;
    cam.position.copy(pos);
    cam.fov = from.fov + (target.fov - from.fov) * e;
    cam.updateProjectionMatrix();
    cam.lookAt(from.look.clone().lerp(target.look, e));
    if (a.p >= 1) {
      a.from = null;
      onSettled(mode);
    }
  });
  return null;
}

// ---------------------------------------------------------------- the panel

interface Replay3DProps {
  /** Starting view. */
  initialMode?: Mode;
  /** Inside a dashboard panel: no footage overlay, and the video panel drives the playhead. */
  embedded?: boolean;
}

export const Replay3D: React.FC<Replay3DProps> = ({ initialMode = 'camera', embedded = false }) => {
  const { caseData: data, videoUrl, currentFrame, currentTime, isPlaying, playbackSpeed, setFrame, setIsPlaying } = useCaseStore();
  const [video] = useState(() => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    return v;
  });
  const [mode, setMode] = useState<Mode>(initialMode);
  const [settledMode, setSettledMode] = useState<Mode | null>(null);
  const [grid, setGrid] = useState(true);
  const [ghosts, setGhosts] = useState(true);
  const overlayRef = useRef<HTMLDivElement>(null);

  // One video element is both the visible overlay (camera view) and the road texture.
  useEffect(() => { video.src = videoUrl; video.load(); }, [video, videoUrl]);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || embedded) return;
    Object.assign(video.style, { width: '100%', height: '100%', objectFit: 'contain' });
    el.appendChild(video);
    return () => { if (video.parentElement === el) el.removeChild(video); };
  }, [video, embedded]);

  // Follow the shared playhead; when stand-alone, also drive it while playing.
  useEffect(() => {
    if (!data || isPlaying) return;
    const target = (currentFrame + 0.5) / data.clip.fps_nominal;
    if (Math.abs(video.currentTime - target) > 0.01) video.currentTime = target;
  }, [currentFrame, isPlaying, data, video]);
  useEffect(() => {
    video.playbackRate = playbackSpeed;
    if (isPlaying) video.play().catch(() => setIsPlaying(false));
    else video.pause();
  }, [isPlaying, playbackSpeed, video, setIsPlaying]);
  useEffect(() => {
    if (!data || !isPlaying || embedded) return;
    let id = 0;
    const tick = () => {
      const i = Math.min(data.clip.frames - 1, Math.floor(video.currentTime * data.clip.fps_nominal));
      if (i !== useCaseStore.getState().currentFrame) setFrame(i);
      if (video.ended) setIsPlaying(false);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [data, isPlaying, video, setFrame, setIsPlaying, embedded]);

  const scene = useMemo(() => {
    if (!data) return null;
    const cam: CameraPose | null = data.calibration.camera || poseFromH(data.calibration.H, data.clip.width, data.clip.height);
    const s = -(cam?.up_sign ?? 1);
    const movers = data.trajectories.filter((tr) => {
      const c = data.tracks.find((t) => t.id === tr.track)?.concept || 'car';
      return MOVERS.has(c) && tr.t.length > 1;
    });
    const xs = movers.flatMap((tr) => tr.x), ys = movers.flatMap((tr) => tr.y);
    const lo = [Math.min(...xs), Math.min(...ys)], hi = [Math.max(...xs), Math.max(...ys)];
    const pad = 25;
    const bounds: [number, number, number, number] = xs.length
      ? [lo[0] - pad, hi[0] + pad, lo[1] - pad, hi[1] + pad]
      : [-40, 40, -40, 40];
    const centre = xs.length ? toWorld((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, s) : new THREE.Vector3();
    const imp = data.events?.[0];
    const focus = imp ? toWorld(imp.xy[0], imp.xy[1], s) : centre;
    const vfov = (f: number) => (2 * Math.atan(data.clip.height / (2 * f)) * 180) / Math.PI;
    const camera: Pose = cam
      ? {
          pos: toWorld(cam.position_m[0], cam.position_m[1], s, cam.position_m[2]),
          look: cam.look_at_m ? toWorld(cam.look_at_m[0], cam.look_at_m[1], s) : focus.clone(),
          fov: vfov(cam.focal_px),
        }
      : { pos: focus.clone().add(new THREE.Vector3(0, 45, 30)), look: focus.clone(), fov: 45 };
    // 3D: up and off to one side of the camera, looking down at the impact.
    const side = camera.pos.clone().sub(focus).setY(0).normalize();
    const orbit: Pose = {
      pos: focus.clone().add(new THREE.Vector3(-side.z * 22 + side.x * 14, 30, side.x * 22 + side.z * 14)),
      look: focus.clone(), fov: 45,
    };
    // Top: straight down over everything that moved (a tiny offset keeps "up" defined).
    // Framed on the impact (about 36 m across) when there is one; zoom out to see more.
    const span = imp ? 36 : xs.length ? Math.max(hi[0] - lo[0], hi[1] - lo[1]) + 16 : 60;
    const topCentre = imp ? focus : centre;
    const top: Pose = {
      pos: topCentre.clone().add(new THREE.Vector3(0, span / (2 * Math.tan((20 * Math.PI) / 180)), 0.01)),
      look: topCentre.clone(), fov: 40,
    };
    const stop = data.calibration.stop_line_m;
    const camXY: Vec2 | null = cam ? [cam.position_m[0], cam.position_m[1]] : null;
    return { s, movers, bounds, poses: { camera, '3d': orbit, top } as Record<Mode, Pose>, stop, imp, camXY };
  }, [data]);

  const ghostList = useMemo(() => (data ? claimGhosts(data) : []), [data]);
  if (!data || !scene) return null;
  const { s, movers, bounds, poses, stop, imp, camXY } = scene;
  const overlayOpacity = !embedded && mode === 'camera' && settledMode === 'camera' ? 1 : 0;
  const concept = (id: string) => data.tracks.find((t) => t.id === id)?.concept || 'car';
  const modes: [Mode, string][] = embedded ? [['top', 'Top'], ['3d', '3D']] : [['camera', 'Camera'], ['3d', '3D replay'], ['top', 'Top']];

  return (
    <div className="relative h-full w-full min-h-[300px] overflow-hidden rounded-lg bg-zinc-950">
      <Canvas camera={{ position: poses[initialMode].pos.toArray(), fov: poses[initialMode].fov, near: 0.5, far: 2000 }} dpr={[1, 2]}>
        <color attach="background" args={['#09090b']} />
        <fog attach="fog" args={['#09090b', 120, 320]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[30, 60, 20]} intensity={1.1} />
        <RoadSurface data={data} video={video} s={s} bounds={bounds} grid={grid} />
        {stop && <Line points={[toWorld(stop[0][0], stop[0][1], s, 0.06), toWorld(stop[1][0], stop[1][1], s, 0.06)]} color="#ffffff" lineWidth={4} />}
        {movers.map((tr, idx) => (
          <Vehicle key={tr.track} tr={tr} concept={concept(tr.track)} name={vehicleName(data, tr.track, concept(tr.track))} s={s}
                   t={currentTime} cam={camXY} lift={(embedded ? 1.0 : 1.6) + idx * (embedded ? 1.2 : 2.6)} compact={embedded} />
        ))}
        {ghosts && ghostList.map((g) => {
          const tr = movers.find((m) => m.track === g.track);
          return tr ? <ClaimGhost key={g.track} tr={tr} g={g} concept={concept(g.track)} s={s} t={currentTime}
                                tImpact={imp?.t ?? null} compact={embedded} /> : null;
        })}
        {imp && <ImpactRing xy={imp.xy} tImpact={imp.t} t={currentTime} s={s} />}
        <CameraRig target={poses[mode]} mode={mode} onSettled={setSettledMode} />
        {mode !== 'camera' && settledMode === mode && (
          <OrbitControls target={poses[mode].look} enableDamping enableRotate={mode === '3d'} screenSpacePanning
                         maxPolarAngle={Math.PI / 2.05} minDistance={6} maxDistance={220} />
        )}
      </Canvas>

      {/* The footage itself, over the 3D scene, until the camera lifts off. */}
      {!embedded && (
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 transition-opacity duration-700" style={{ opacity: overlayOpacity }} />
      )}

      <div className="absolute right-3 top-3 flex items-center gap-2 text-xs">
        {mode !== 'camera' && (
          <>
            <button onClick={() => setGhosts(!ghosts)} disabled={!ghostList.length}
                    className={`rounded-full border px-3 py-1.5 ${ghosts && ghostList.length ? 'border-zinc-300 text-zinc-100' : 'border-zinc-700 text-zinc-500'}`}>
              {embedded ? 'Ghost' : 'Claimed-speed ghost'}
            </button>
            <button onClick={() => setGrid(!grid)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 ${grid ? 'border-cyan-600 text-cyan-300' : 'border-zinc-700 text-zinc-500'}`}>
              <Grid3x3 className="h-3.5 w-3.5" /> Grid
            </button>
          </>
        )}
        <div className="flex overflow-hidden rounded-full border border-zinc-700 bg-zinc-900/90">
          {modes.map(([m, label]) => (
            <button key={m} onClick={() => { setSettledMode(null); setMode(m); }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 ${mode === m ? 'bg-cyan-500/20 text-cyan-300' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {m === 'camera' ? <Video className="h-3.5 w-3.5" /> : m === '3d' ? <Box className="h-3.5 w-3.5" /> : <MapIcon className="h-3.5 w-3.5" />} {label}
            </button>
          ))}
        </div>
      </div>
      {mode !== 'camera' && (embedded ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-zinc-950/80 px-2 py-1 text-[10px] text-zinc-400">
          {grid ? '1 m grid, bold every 5 m' : 'grid off'}{ghosts && ghostList.length > 0 ? ' \u00b7 white frame = claimed speed' : ''}
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-3 left-3 max-w-[78%] rounded-md bg-zinc-950/80 px-3 py-2 text-[11px] leading-snug text-zinc-400">
          {grid && <span className="mr-1 text-cyan-300">Grid: 1 m squares, bold line every 5 m.</span>}
          Measured positions; each vehicle is a box whose corner nearest the camera sits on its measured ground point.
          The road is the camera image projected onto the ground, so anything above the road looks stretched.
          {ghosts && ghostList.length > 0 && ' White wire-frame: where the vehicle would be at its claimed speed, on the same path.'}
        </div>
      ))}
    </div>
  );
};

/** Play / pause, speed and a scrubber (used on the full-screen /?replay3d page). */
export const ReplayControls: React.FC = () => {
  const { caseData, currentFrame, currentTime, isPlaying, playbackSpeed, togglePlay, setFrame, setPlaybackSpeed } = useCaseStore();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); togglePlay(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);
  if (!caseData) return null;
  const imp = caseData.events?.[0];
  const n = caseData.clip.frames;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300">
      <button onClick={togglePlay} className="flex items-center gap-1.5 rounded-md bg-cyan-500/20 px-3 py-1.5 text-cyan-300">
        {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {isPlaying ? 'Pause' : 'Play'}
      </button>
      {[0.25, 0.5, 1].map((r) => (
        <button key={r} onClick={() => setPlaybackSpeed(r)}
                className={`rounded px-2 py-1 ${playbackSpeed === r ? 'bg-zinc-700 text-white' : 'text-zinc-400'}`}>{r}x</button>
      ))}
      <div className="relative flex-1">
        <input type="range" min={0} max={n - 1} value={currentFrame} onChange={(e) => setFrame(+e.target.value)}
               className="w-full accent-cyan-400" />
        {imp && <div className="pointer-events-none absolute -top-1 h-4 w-0.5 bg-rose-500" style={{ left: `${(imp.i / (n - 1)) * 100}%` }} />}
      </div>
      <span className="w-24 text-right tabular-nums text-zinc-400">t = {currentTime.toFixed(2)} s</span>
    </div>
  );
};

export default Replay3D;
