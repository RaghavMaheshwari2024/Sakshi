"""Constant-acceleration Kalman filter + RTS smoother on the ground plane.

State: [x, y, vx, vy, ax, ay]. Handles uneven frame times and missing frames
(occlusion, duplicates). Speed comes from this smoother, never from raw
differences of positions.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class Smoothed:
    t: np.ndarray  # (T,)
    x: np.ndarray  # (T, 6) smoothed state
    P: np.ndarray  # (T, 6, 6)
    observed: np.ndarray  # (T,) bool

    @property
    def pos(self) -> np.ndarray:
        return self.x[:, 0:2]

    @property
    def vel(self) -> np.ndarray:
        return self.x[:, 2:4]

    @property
    def acc(self) -> np.ndarray:
        return self.x[:, 4:6]

    @property
    def speed(self) -> np.ndarray:
        return np.linalg.norm(self.vel, axis=1)

    @property
    def long_acc(self) -> np.ndarray:
        """Acceleration along the direction of travel (negative = braking)."""
        v = self.vel
        s = np.linalg.norm(v, axis=1)
        s = np.where(s < 0.3, np.nan, s)
        return (v * self.acc).sum(1) / s


def _F(dt: float) -> np.ndarray:
    f1 = np.array([[1, dt, 0.5 * dt * dt], [0, 1, dt], [0, 0, 1]])
    F = np.zeros((6, 6))
    for a in range(2):  # x and y blocks
        idx = [a, a + 2, a + 4]
        F[np.ix_(idx, idx)] = f1
    return F


def _Q(dt: float, q: float) -> np.ndarray:
    """White-jerk process noise with spectral density q (m^2/s^5)."""
    q1 = q * np.array(
        [
            [dt**5 / 20, dt**4 / 8, dt**3 / 6],
            [dt**4 / 8, dt**3 / 3, dt**2 / 2],
            [dt**3 / 6, dt**2 / 2, dt],
        ]
    )
    Q = np.zeros((6, 6))
    for a in range(2):
        idx = [a, a + 2, a + 4]
        Q[np.ix_(idx, idx)] = q1
    return Q


_Hm = np.zeros((2, 6))
_Hm[0, 0] = _Hm[1, 1] = 1.0


def smooth(t: np.ndarray, z: np.ndarray, *, meas_sigma_m: float | np.ndarray = 0.25,
           jerk_q: float = 30.0) -> Smoothed:
    """t: (T,) seconds; z: (T, 2) ground positions, NaN where not observed.

    jerk_q is tuned for road vehicles: low enough to reject mask jitter, high
    enough to follow hard braking and the impact itself.
    """
    t = np.asarray(t, float)
    z = np.asarray(z, float)
    T = len(t)
    obs = ~np.isnan(z).any(1)
    if obs.sum() < 3:
        raise ValueError("Track has fewer than 3 observed frames.")
    r = np.broadcast_to(np.asarray(meas_sigma_m, float), (T,))

    first = int(np.argmax(obs))
    x = np.zeros(6)
    x[:2] = z[first]
    early = np.flatnonzero(obs)[:10]
    if len(early) >= 3:
        # Initial state AT t[0] (the filter starts there): straight-line fit to
        # the first observations, extrapolated back over any leading gap.
        A = np.c_[np.ones(len(early)), t[early] - t[0]]
        coef, *_ = np.linalg.lstsq(A, z[early], rcond=None)
        x[:2], x[2:4] = coef[0], coef[1]
    P = np.diag([r[first] ** 2] * 2 + [100.0] * 2 + [9.0] * 2)

    xf = np.zeros((T, 6))
    Pf = np.zeros((T, 6, 6))
    xp = np.zeros((T, 6))
    Pp = np.zeros((T, 6, 6))
    Fs = np.zeros((T, 6, 6))
    for k in range(T):
        if k > 0:
            dt = max(t[k] - t[k - 1], 1e-4)
            F = _F(dt)
            x = F @ x
            P = F @ P @ F.T + _Q(dt, jerk_q)
            Fs[k] = F
        xp[k], Pp[k] = x, P
        if obs[k] and k >= first:
            R = np.eye(2) * r[k] ** 2
            y = z[k] - _Hm @ x
            S = _Hm @ P @ _Hm.T + R
            K = P @ _Hm.T @ np.linalg.inv(S)
            x = x + K @ y
            P = (np.eye(6) - K @ _Hm) @ P
        xf[k], Pf[k] = x, P

    xs = xf.copy()
    Ps = Pf.copy()
    for k in range(T - 2, -1, -1):
        C = Pf[k] @ Fs[k + 1].T @ np.linalg.inv(Pp[k + 1])
        xs[k] = xf[k] + C @ (xs[k + 1] - xp[k + 1])
        Ps[k] = Pf[k] + C @ (Ps[k + 1] - Pp[k + 1]) @ C.T
    return Smoothed(t, xs, Ps, obs)
