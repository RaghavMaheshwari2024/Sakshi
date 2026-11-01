/** Road rectangles with assumed sizes. Must match PRESETS in
 *  sakshi/engine/calib_sources.py (tests/test_calib_sources.py checks this). */
export interface RoadPreset {
  id: string;
  label: string;
  hint: string;
  width_m: number;
  length_m: number;
  sigma_width_m: number;
  sigma_length_m: number;
}

export const ROAD_PRESETS: RoadPreset[] = [
  { id: 'lane_zebra', label: 'Lane width + zebra crossing width', hint: 'Where one lane’s edges meet the two sides of a zebra crossing.', width_m: 3.5, length_m: 3.0, sigma_width_m: 0.25, sigma_length_m: 0.5 },
  { id: 'lane_stop_line', label: 'Lane width + stop-line distance', hint: 'One lane, from the stop line to a second line across the lane.', width_m: 3.5, length_m: 6.0, sigma_width_m: 0.25, sigma_length_m: 1.0 },
  { id: 'two_lanes_long', label: 'Two-lane road + 12 m stretch', hint: 'Both edges of a two-lane road along about 12 m. The longer base gives much tighter speeds.', width_m: 7.0, length_m: 12.0, sigma_width_m: 0.5, sigma_length_m: 1.5 },
];
