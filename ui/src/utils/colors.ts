const TRACK_PALETTE = [
  '#06b6d4', // Cyan
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#3b82f6', // Blue
];

const trackColorMap = new Map<string, string>();

export function getTrackColor(trackId: string): string {
  if (trackId === 'ego' || trackId.startsWith('dashcam')) {
    return '#f43f5e'; // Rose for ego vehicle
  }
  if (!trackColorMap.has(trackId)) {
    const idx = trackColorMap.size % TRACK_PALETTE.length;
    trackColorMap.set(trackId, TRACK_PALETTE[idx]);
  }
  return trackColorMap.get(trackId)!;
}

export const VERDICT_COLORS = {
  consistent: {
    badge: 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40',
    dot: 'bg-emerald-400',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
  },
  inconsistent: {
    badge: 'bg-rose-950/80 text-rose-400 border-rose-500/40',
    dot: 'bg-rose-400',
    border: 'border-rose-500/30',
    text: 'text-rose-400',
  },
  cant_tell: {
    badge: 'bg-zinc-900/80 text-zinc-400 border-zinc-700/40',
    dot: 'bg-zinc-400',
    border: 'border-zinc-700/30',
    text: 'text-zinc-400',
  },
};
