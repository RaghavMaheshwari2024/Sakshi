"""Image-to-road-plane mapping from clicked point pairs."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class Calibration:
    H: np.ndarray  # 3x3, image pixels -> ground metres
    image_pts: np.ndarray  # (N, 2) pixels
    ground_pts: np.ndarray  # (N, 2) metres
    rms_err_m: float
    max_err_m: float
    ground_sigma_m: float = 0.05
    mode: str = "custom"
    preset_id: str | None = None
    preset_label: str | None = None

    def to_json(self) -> dict:
        return {
            "H": self.H.tolist(),
            "image_pts": self.image_pts.tolist(),
            "ground_pts_m": self.ground_pts.tolist(),
            "reproj_rms_m": self.rms_err_m,
            "reproj_max_m": self.max_err_m,
            "ground_sigma_m": self.ground_sigma_m,
            "mode": self.mode,
            "preset_id": self.preset_id,
            "preset_label": self.preset_label,
        }


def img_to_ground(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Map (N, 2) pixel points to (N, 2) ground points in metres."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    hom = np.c_[pts, np.ones(len(pts))] @ H.T
    return hom[:, :2] / hom[:, 2:3]


def ground_to_img(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return img_to_ground(np.linalg.inv(H), pts)


def fit(image_pts, ground_pts, ground_sigma_m: float = 0.05,
        mode: str = "custom", preset_id: str | None = None,
        preset_label: str | None = None) -> Calibration:
    """Least-squares homography (all points; no RANSAC: clicks are curated)."""
    ip = np.asarray(image_pts, dtype=float).reshape(-1, 2)
    gp = np.asarray(ground_pts, dtype=float).reshape(-1, 2)
    if len(ip) < 4 or len(ip) != len(gp):
        raise ValueError("Need at least 4 matching point pairs.")
    # Guard against near-collinear clicks, which give a meaningless H.
    if np.linalg.matrix_rank(np.c_[gp - gp.mean(0)], tol=1e-3) < 2:
        raise ValueError("Ground points are collinear; spread them over the road.")
    if np.linalg.matrix_rank(np.c_[ip - ip.mean(0)], tol=1.0) < 2:
        raise ValueError("Image points lie on one line; click points spread over the road.")
    H, _ = cv2.findHomography(ip, gp, method=0)
    if H is None or not np.isfinite(H).all() or abs(np.linalg.det(H)) < 1e-12:
        raise ValueError("Homography fit failed; check the point pairs.")
    err = np.linalg.norm(img_to_ground(H, ip) - gp, axis=1)
    return Calibration(H, ip, gp, float(np.sqrt((err**2).mean())), float(err.max()),
                       ground_sigma_m=float(ground_sigma_m), mode=mode,
                       preset_id=preset_id, preset_label=preset_label)


def fit_preset(image_pts, preset_id: str,
               custom_w: float | None = None,
               custom_l: float | None = None) -> Calibration:
    """Build calibration directly from a standard road geometry preset or Google Maps measurement."""
    from . import presets

    if preset_id == "google_maps_rect" and custom_w and custom_l:
        spec = presets.make_custom_rect(custom_w, custom_l)
        pts_in = image_pts[:4] if len(image_pts) > 4 else image_pts
        return fit(pts_in, spec["ground_pts_m"],
                   ground_sigma_m=spec["ground_sigma_m"],
                   mode="google_maps",
                   preset_id="google_maps_rect",
                   preset_label=f"Google Maps ({custom_w}m × {custom_l}m)")
    p = presets.get_preset(preset_id)
    if not p:
        raise ValueError(f"Unknown preset: {preset_id}")
    ground_pts = p.ground_pts_m()
    pts_in = image_pts[:len(ground_pts)] if len(image_pts) > len(ground_pts) else image_pts
    return fit(pts_in, ground_pts,
               ground_sigma_m=p.ground_sigma_m,
               mode="preset",
               preset_id=p.id,
               preset_label=p.label)


def camera_pose(H: np.ndarray, width: int, height: int) -> dict | None:
    """Where the camera is, recovered from the road calibration alone.

    Assumes square pixels and the optical centre at the image centre (true for
    almost every CCTV and phone camera). Then one view of a flat road fixes the
    focal length, the camera's height and its viewing direction. Used to start
    the 3D replay exactly at the camera's viewpoint. Returns None when the
    calibration does not pin the focal length down (e.g. a camera looking
    straight down).

    `up_sign`: +1 if the ground frame (x, y) with z = up is right-handed,
    -1 if left-handed (CARLA's world frame). A 3D renderer needs it so the
    scene is not mirrored."""
    G = np.linalg.inv(H)  # ground (X, Y, 1) -> image (u, v, w)
    G = G / np.linalg.norm(G[:, 0])
    cx, cy = width / 2.0, height / 2.0
    p = G[0] - cx * G[2]
    q = G[1] - cy * G[2]
    g = G[2]
    cands = []
    den = g[0] * g[1]
    if abs(den) > 1e-12:  # columns 1 and 2 of K^-1 G orthogonal
        cands.append(-(p[0] * p[1] + q[0] * q[1]) / den)
    den = g[1] ** 2 - g[0] ** 2
    if abs(den) > 1e-12:  # ... and of equal length
        cands.append((p[0] ** 2 + q[0] ** 2 - p[1] ** 2 - q[1] ** 2) / den)
    f2 = [c for c in cands if c > 0]
    if not f2:
        return None
    f = float(np.sqrt(np.median(f2)))
    if not (0.2 * width < f < 10 * width):
        return None
    Kinv = np.array([[1 / f, 0, -cx / f], [0, 1 / f, -cy / f], [0, 0, 1]])
    A = Kinv @ G
    lam = 2.0 / (np.linalg.norm(A[:, 0]) + np.linalg.norm(A[:, 1]))
    if (lam * A[:, 2])[2] < 0:  # the road must be in front of the camera
        lam = -lam
    r1, r2, t = lam * A[:, 0], lam * A[:, 1], lam * A[:, 2]
    R = np.c_[r1, r2, np.cross(r1, r2)]
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt  # nearest rotation
    C = -R.T @ t  # camera centre in ground coordinates (z along r1 x r2)
    up_sign = 1.0 if C[2] > 0 else -1.0  # the camera is above the road
    axis = R.T @ np.array([0.0, 0.0, 1.0])  # optical axis in ground coordinates
    look = None
    if abs(axis[2]) > 1e-6:
        s = -C[2] / axis[2]
        if s > 0:
            look = (C + s * axis)[:2]
    return {
        "focal_px": round(f, 1),
        "fov_h_deg": round(float(np.degrees(2 * np.arctan(width / (2 * f)))), 2),
        "position_m": [round(float(C[0]), 3), round(float(C[1]), 3), round(float(abs(C[2])), 3)],
        "look_at_m": None if look is None else [round(float(look[0]), 3), round(float(look[1]), 3)],
        "pitch_down_deg": round(float(np.degrees(np.arcsin(min(1.0, abs(axis[2]))))), 2),
        "up_sign": up_sign,
        "assumes": "square pixels, optical centre at the image centre, flat road",
    }
