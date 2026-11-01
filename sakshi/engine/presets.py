"""Known-length road geometry presets with honest metric uncertainty."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CalibrationPreset:
    id: str
    label: str
    description: str
    width_m: float
    length_m: float
    ground_sigma_m: float  # 1-sigma uncertainty in metres for Monte Carlo

    def ground_pts_m(self) -> list[list[float]]:
        """Return 4 rectangle corners in clockwise order:
        [0, 0] (bottom-left), [width, 0] (bottom-right), [width, length] (top-right), [0, length] (top-left)
        """
        return [
            [0.0, 0.0],
            [float(self.width_m), 0.0],
            [float(self.width_m), float(self.length_m)],
            [0.0, float(self.length_m)],
        ]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "description": self.description,
            "width_m": self.width_m,
            "length_m": self.length_m,
            "ground_sigma_m": self.ground_sigma_m,
            "ground_pts_m": self.ground_pts_m(),
        }


PRESETS: dict[str, CalibrationPreset] = {
    "urban_lane_crosswalk": CalibrationPreset(
        id="urban_lane_crosswalk",
        label="Urban Lane + Crosswalk",
        description="Standard 3.5m lane width × 2.5m zebra stripe module (IRC / MUTCD standards)",
        width_m=3.5,
        length_m=2.5,
        ground_sigma_m=0.25,
    ),
    "highway_lane_dashed": CalibrationPreset(
        id="highway_lane_dashed",
        label="Highway Lane + Dashed Line",
        description="3.65m highway lane × 6.0m dashed skip line module (3m stripe + 3m gap)",
        width_m=3.65,
        length_m=6.0,
        ground_sigma_m=0.30,
    ),
    "two_lane_box": CalibrationPreset(
        id="two_lane_box",
        label="2-Lane Junction Box",
        description="7.0m two-lane carriageway × 10.0m junction approach box",
        width_m=7.0,
        length_m=10.0,
        ground_sigma_m=0.40,
    ),
    "google_maps_rect": CalibrationPreset(
        id="google_maps_rect",
        label="Google Maps Satellite Measure",
        description="Rectangle measured using Google Maps satellite 'Measure distance' tool",
        width_m=3.5,
        length_m=10.0,
        ground_sigma_m=0.15,
    ),
    "manual_survey": CalibrationPreset(
        id="manual_survey",
        label="Manual Physical Survey",
        description="Physical measuring tape or laser rangefinder survey on site",
        width_m=0.0,
        length_m=0.0,
        ground_sigma_m=0.03,
    ),
}


def get_preset(preset_id: str) -> CalibrationPreset | None:
    return PRESETS.get(preset_id)


def list_presets() -> list[dict[str, Any]]:
    return [p.to_dict() for p in PRESETS.values()]


def make_custom_rect(width_m: float, length_m: float,
                     ground_sigma_m: float = 0.15,
                     label: str = "Google Maps Custom") -> dict[str, Any]:
    pts = [
        [0.0, 0.0],
        [float(width_m), 0.0],
        [float(width_m), float(length_m)],
        [0.0, float(length_m)],
    ]
    return {
        "id": "google_maps_rect",
        "label": label,
        "width_m": float(width_m),
        "length_m": float(length_m),
        "ground_sigma_m": float(ground_sigma_m),
        "ground_pts_m": pts,
    }
