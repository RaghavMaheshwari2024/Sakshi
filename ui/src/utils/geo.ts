/** (lat, lng) degrees to metres east and north of the points' centroid.
 *  Same formula as geo_to_local_m in sakshi/engine/calib_sources.py. */
export function geoToLocalM(geo: [number, number][]): [number, number][] {
  const n = geo.length || 1;
  const lat0 = geo.reduce((s, g) => s + g[0], 0) / n;
  const lng0 = geo.reduce((s, g) => s + g[1], 0) / n;
  const rad = Math.PI / 180;
  const s2 = Math.sin(lat0 * rad) ** 2;
  const a = 6378137.0;
  const e2 = 0.00669437999014; // WGS84
  const north = (a * (1 - e2)) / (1 - e2 * s2) ** 1.5;
  const east = (a / Math.sqrt(1 - e2 * s2)) * Math.cos(lat0 * rad);
  return geo.map(([lat, lng]) => [(lng - lng0) * rad * east, (lat - lat0) * rad * north]);
}

/** "28.6139, 77.2090" as (lat, lng), or null. */
export function parseLatLng(text: string): [number, number] | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}
