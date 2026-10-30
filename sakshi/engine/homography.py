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

    def to_json(self) -> dict:
        return {
            "H": self.H.tolist(),
            "image_pts": self.image_pts.tolist(),
            "ground_pts_m": self.ground_pts.tolist(),
            "reproj_rms_m": self.rms_err_m,
            "reproj_max_m": self.max_err_m,
        }


def img_to_ground(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Map (N, 2) pixel points to (N, 2) ground points in metres."""
    pts = np.asarray(pts, dtype=float).reshape(-1, 2)
    hom = np.c_[pts, np.ones(len(pts))] @ H.T
    return hom[:, :2] / hom[:, 2:3]


def ground_to_img(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return img_to_ground(np.linalg.inv(H), pts)


def fit(image_pts, ground_pts) -> Calibration:
    """Least-squares homography (all points; no RANSAC: clicks are curated)."""
    ip = np.asarray(image_pts, dtype=float).reshape(-1, 2)
    gp = np.asarray(ground_pts, dtype=float).reshape(-1, 2)
    if len(ip) < 4 or len(ip) != len(gp):
        raise ValueError("Need at least 4 matching point pairs.")
    # Guard against near-collinear clicks, which give a meaningless H.
    if np.linalg.matrix_rank(np.c_[gp - gp.mean(0)], tol=1e-3) < 2:
        raise ValueError("Ground points are collinear; spread them over the road.")
    H, _ = cv2.findHomography(ip, gp, method=0)
    if H is None:
        raise ValueError("Homography fit failed; check the point pairs.")
    err = np.linalg.norm(img_to_ground(H, ip) - gp, axis=1)
    return Calibration(H, ip, gp, float(np.sqrt((err**2).mean())), float(err.max()))
