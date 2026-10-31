import { create } from 'zustand';
import { CaseData } from '../types/case';

interface CaseStoreState {
  caseData: CaseData | null;
  videoUrl: string;
  currentFrame: number;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  selectedTrack: string | null;
  showMasks: boolean;
  showConfidenceBands: boolean;
  replayMode: "road" | "ego";
  highlightWindow: { t0: number; t1: number; reason?: string } | null;

  // Actions
  loadCase: (data: CaseData, videoUrl?: string) => void;
  setFrame: (i: number) => void;
  setTime: (t: number) => void;
  jumpToTime: (t: number, highlight?: { t0: number; t1: number; reason?: string }) => void;
  stepFrame: (delta: number) => void;
  setIsPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setPlaybackSpeed: (speed: number) => void;
  setSelectedTrack: (id: string | null) => void;
  toggleMasks: () => void;
  toggleConfidenceBands: () => void;
  setShowConfidenceBands: (show: boolean) => void;
  setReplayMode: (mode: "road" | "ego") => void;
  clearHighlight: () => void;
}

export const useCaseStore = create<CaseStoreState>((set, get) => ({
  caseData: null,
  videoUrl: '/mock/input.mp4',
  currentFrame: 0,
  currentTime: 0.0,
  isPlaying: false,
  playbackSpeed: 1.0,
  selectedTrack: null,
  showMasks: true,
  showConfidenceBands: true,
  replayMode: 'road',
  highlightWindow: null,

  loadCase: (data, videoUrl) => {
    const t0 = data.clock?.frames?.[0]?.t ?? 0;
    set({
      caseData: data,
      videoUrl: videoUrl || '/mock/input.mp4',
      currentFrame: 0,
      currentTime: t0,
      isPlaying: false,
      selectedTrack: null,
      highlightWindow: null,
      replayMode: data.camera_mode === 'dashcam' ? 'ego' : 'road',
    });
  },

  setFrame: (i) => {
    const { caseData } = get();
    if (!caseData?.clock?.frames) return;
    const maxI = caseData.clip.frames - 1;
    const clampedI = Math.max(0, Math.min(maxI, i));
    const t = caseData.clock.frames[clampedI]?.t ?? (clampedI / caseData.clip.fps_nominal);
    set({ currentFrame: clampedI, currentTime: t });
  },

  setTime: (t) => {
    const { caseData } = get();
    if (!caseData?.clock?.frames) return;
    const frames = caseData.clock.frames;
    // Find closest frame to true timestamp t
    let bestI = 0;
    let minDiff = Infinity;
    for (let idx = 0; idx < frames.length; idx++) {
      const diff = Math.abs(frames[idx].t - t);
      if (diff < minDiff) {
        minDiff = diff;
        bestI = idx;
      }
    }
    set({ currentFrame: bestI, currentTime: t });
  },

  jumpToTime: (t, highlight) => {
    get().setTime(t);
    set({ isPlaying: false, highlightWindow: highlight || null });
  },

  stepFrame: (delta) => {
    const { currentFrame } = get();
    get().setFrame(currentFrame + delta);
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setSelectedTrack: (id) => set((state) => ({ selectedTrack: state.selectedTrack === id ? null : id })),
  toggleMasks: () => set((state) => ({ showMasks: !state.showMasks })),
  toggleConfidenceBands: () => set((state) => ({ showConfidenceBands: !state.showConfidenceBands })),
  setShowConfidenceBands: (show) => set({ showConfidenceBands: show }),
  setReplayMode: (mode) => set({ replayMode: mode }),
  clearHighlight: () => set({ highlightWindow: null }),
}));
