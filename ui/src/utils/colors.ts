/**
 * Track colours. The two measured vehicles get bone and sky; red, amber and
 * green stay reserved for impact and signal state. Colours come from the id's
 * number, so a track keeps its colour whichever case or order it appears in.
 */
const TRACK_PALETTE = [
  '#efece4', // Bone
  '#7fb0ff', // Sky
  '#c6a2ff', // Violet
  '#62d0c6', // Teal
  '#f29fc5', // Pink
  '#b9c75d', // Olive
];

const ROAD_FURNITURE = '#85837c';

export const IMPACT_COLOR = '#ef5a4c';
export const PAINT_COLOR = '#f2c037';

export const SIGNAL_COLORS: Record<string, string> = {
  green: '#4fbf8b',
  amber: '#f0a63a',
  red: '#ef5a4c',
  off: '#34353a',
  unclear: '#34353a',
};

const named: Record<string, number> = { 'car-A': 0, 'car-B': 1 };

export function getTrackColor(trackId: string): string {
  if (trackId === 'ego' || trackId.startsWith('dashcam')) return TRACK_PALETTE[2];
  if (trackId.startsWith('traffic_light')) return ROAD_FURNITURE;
  const n = named[trackId] ?? Number(trackId.match(/(\d+)$/)?.[1]);
  if (Number.isFinite(n)) return TRACK_PALETTE[n % TRACK_PALETTE.length];
  let hash = 0;
  for (const ch of trackId) hash = (hash + ch.charCodeAt(0)) % TRACK_PALETTE.length;
  return TRACK_PALETTE[hash];
}
