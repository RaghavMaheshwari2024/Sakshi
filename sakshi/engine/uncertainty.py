"""Measured trajectories with honest 90% intervals (Monte Carlo).

Every run of the pipeline is repeated N times with the uncertain inputs
perturbed: the clicked image points, the measured ground points, where on the
mask the tyre meets the road, mask jitter, and each frame's time. The 5th to
95th percentile of the resulting speeds is the reported 90% interval.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from . import homography as hg
from .clock import FrameClock
from .kalman import Smoothed, smooth

KMH = 3.6


@dataclass
class MCConfig:
    n: int = 200
    click_sigma_px: float = 2.0  # how precisely a user clicks a road mark
    ground_sigma_m: float = 0.10  # how precisely the ground distances are known
    contact_bias_px: float = 6.0  # lowest mask pixel may sit up to this far from the tyre line
    jitter_px: float = 1.5  # frame-to-frame mask edge noise
    jerk_q_range: tuple[float, float] = (10.0, 1000.0)  # smoother stiffness, sampled log-uniformly
    seed: int = 7


@dataclass
class TrackResult:
    track_id: str
    frames: np.ndarray  # (T,) frame indices covered
    nominal: Smoothed
    speed_samples: np.ndarray  # (N, T) km/h
    pos_samples: np.ndarray  # (N, T, 2) metres
    extras: dict = field(default_factory=dict)

    def interval(self, q_lo: float = 5, q_hi: float = 95):
        return (
            np.percentile(self.speed_samples, q_lo, axis=0),
            np.percentile(self.speed_samples, 50, axis=0),
            np.percentile(self.speed_samples, q_hi, axis=0),
        )

    def to_json(self) -> dict:
        lo, med, hi = self.interval()
        return {
            "track": self.track_id,
            "i": self.frames.tolist(),
            "t": np.round(self.nominal.t, 4).tolist(),
            "x": np.round(self.nominal.pos[:, 0], 3).tolist(),
            "y": np.round(self.nominal.pos[:, 1], 3).tolist(),
            "speed_kmh": np.round(med, 2).tolist(),
            "lo90_kmh": np.round(lo, 2).tolist(),
            "hi90_kmh": np.round(hi, 2).tolist(),
            "long_acc_ms2": [round(float(a), 3) if np.isfinite(a) else None for a in self.nominal.long_acc],
            "observed": self.nominal.observed.tolist(),
            **self.extras,
        }


def _metres_per_px(H: np.ndarray, p: np.ndarray) -> np.ndarray:
    """Local scale of the image->ground map at each pixel (vertical direction,
    the worst case for an elevated camera)."""
    a = hg.img_to_ground(H, p)
    b = hg.img_to_ground(H, p + np.array([0.0, 1.0]))
    return np.linalg.norm(b - a, axis=1)


def _track_arrays(track: dict, clock: FrameClock):
    """Pixel contact points per frame over the track's lifetime (NaN = unobserved)."""
    n = len(clock.t)  # ignore frame numbers the clip does not have
    by_i = {f["i"]: f["contact_px"] for f in track["frames"]
            if f.get("contact_px") and 0 <= f["i"] < n}
    if not by_i:
        return None
    i0, i1 = min(by_i), max(by_i)
    frames = np.arange(i0, i1 + 1)
    px = np.full((len(frames), 2), np.nan)
    for k, i in enumerate(frames):
        if i in by_i and not clock.duplicate[i]:
            px[k] = by_i[i]
    return frames, px


def _run_once(H, frames, px, t, jitter_px, rng=None, bias_px: float | np.ndarray = 0.0, jerk_q=30.0):
    p = px.copy()
    ok = ~np.isnan(p).any(1)
    if rng is not None:
        # Where on the mask the "lowest pixel" sits drifts as the view of the
        # vehicle changes (front tyres far away, bumper up close): model it as an
        # offset toward the camera that changes linearly over the track.
        b = np.atleast_1d(bias_px)
        ramp = np.linspace(b[0], b[-1], len(p))
        p[ok, 1] -= ramp[ok]
        p[ok] += rng.normal(0, jitter_px, size=(ok.sum(), 2))
    z = np.full_like(p, np.nan)
    z[ok] = hg.img_to_ground(H, p[ok])
    r = np.full(len(p), 0.25)
    r[ok] = np.maximum(jitter_px * _metres_per_px(H, p[ok]), 0.03)
    return smooth(t, z, meas_sigma_m=r, jerk_q=jerk_q)


def step_displacements(tracks: list[dict], calib: hg.Calibration, n: int, jitter_px: float = 1.5,
                       concepts=("car", "motorcycle", "bus", "truck", "auto rickshaw")):
    """Ground distance each vehicle moved between consecutive frames (raw, from
    the nominal calibration), and the 1-sigma noise of that distance (far-away
    vehicles are noisier because each pixel covers more road). Input to the
    drop-aware clock. Returns (distances, sigmas), dicts keyed by track id."""
    out, sig = {}, {}
    for tr in tracks:
        if tr["concept"] not in concepts:
            continue
        d = np.full(n, np.nan)
        e = np.full(n, np.nan)
        pts = {f["i"]: f["contact_px"] for f in tr["frames"] if f.get("contact_px")}
        for i in range(1, n):
            if i in pts and i - 1 in pts:
                pp = np.array([pts[i - 1], pts[i]])
                a, b = hg.img_to_ground(calib.H, pp)
                d[i] = float(np.linalg.norm(b - a))
                e[i] = float(np.sqrt(2) * jitter_px * _metres_per_px(calib.H, pp).mean())
        out[tr["id"]], sig[tr["id"]] = d, e
    return out, sig


def measure(tracks: list[dict], calib: hg.Calibration, clock: FrameClock,
            cfg: MCConfig | None = None) -> dict[str, TrackResult]:
    cfg = cfg or MCConfig()
    ground_sigma = getattr(calib, "ground_sigma_m", None)
    if ground_sigma is None or ground_sigma <= 0:
        ground_sigma = cfg.ground_sigma_m
    rng = np.random.default_rng(cfg.seed)
    prepared = {}
    for tr in tracks:
        arr = _track_arrays(tr, clock)
        if arr is None or (~np.isnan(arr[1]).any(1)).sum() < 5:
            continue
        prepared[tr["id"]] = arr

    out: dict[str, TrackResult] = {}
    nominal = {
        tid: _run_once(calib.H, fr, px, clock.t[fr], cfg.jitter_px)
        for tid, (fr, px) in prepared.items()
    }
    samples_v = {tid: [] for tid in prepared}
    samples_p = {tid: [] for tid in prepared}
    for _ in range(cfg.n):
        ip = calib.image_pts + rng.normal(0, cfg.click_sigma_px, calib.image_pts.shape)
        gp = calib.ground_pts + rng.normal(0, ground_sigma, calib.ground_pts.shape)
        H, _ = cv2.findHomography(ip, gp, method=0)
        if H is None or not np.isfinite(H).all() or abs(np.linalg.det(H)) < 1e-12:
            continue
        t_all = clock.sample(rng)  # correlated timing error, per the clock's method
        for tid, (fr, px) in prepared.items():
            bias = rng.uniform(0, cfg.contact_bias_px, 2)  # offset at the start and end of the track
            # Model uncertainty: how abruptly vehicles may change acceleration.
            q = float(np.exp(rng.uniform(np.log(cfg.jerk_q_range[0]), np.log(cfg.jerk_q_range[1]))))
            try:
                s = _run_once(H, fr, px, t_all[fr], cfg.jitter_px, rng, bias, q)
            except (np.linalg.LinAlgError, ValueError):
                continue  # a degenerate perturbed calibration: drop this sample
            if not np.isfinite(s.speed).all():
                continue
            samples_v[tid].append(s.speed * KMH)
            samples_p[tid].append(s.pos)
    for tid, (fr, _) in prepared.items():
        if not samples_v[tid]:  # every sample failed: report the nominal track, zero spread
            samples_v[tid] = [nominal[tid].speed * KMH]
            samples_p[tid] = [nominal[tid].pos]
        out[tid] = TrackResult(
            tid, fr, nominal[tid], np.array(samples_v[tid]), np.array(samples_p[tid])
        )
    return out
