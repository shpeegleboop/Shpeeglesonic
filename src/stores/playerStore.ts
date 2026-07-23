import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

const PERSIST_KEY = 'shpeeglesonic-player';

/** Sentinel "playlist" id for the built-in Favorites view in the sidebar. */
export const FAVORITES_PLAYLIST_ID = -1;
const PERSIST_THROTTLE_MS = 500;

// Throttled persist storage. Every store change persists the WHOLE partialized
// state — with a full-library queue that's ~2MB of JSON — and currentTime
// updates arrive at 15Hz during playback. Unthrottled, that's tens of MB/s of
// serialization garbage plus synchronous localStorage writes, enough to OOM
// the webview over a long session. Coalesce to at most one write per interval,
// flushing on pagehide so the last state survives app close.
const throttledStorage: PersistStorage<any> = (() => {
  let timer: number | null = null;
  let latest: unknown = null;

  const flush = () => {
    if (latest !== null) {
      localStorage.setItem(PERSIST_KEY, JSON.stringify(latest));
      latest = null;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
  }

  return {
    getItem: (name) => {
      const s = localStorage.getItem(name);
      return s ? JSON.parse(s) : null;
    },
    setItem: (_name, value) => {
      latest = value;
      if (timer === null) {
        timer = window.setTimeout(() => {
          timer = null;
          flush();
        }, PERSIST_THROTTLE_MS);
      }
    },
    removeItem: (name) => localStorage.removeItem(name),
  };
})();

export interface Track {
  id: number;
  file_path: string;
  file_name: string;
  title: string | null;
  artist: string | null;
  album_artist: string | null;
  album: string | null;
  genre: string | null;
  year: number | null;
  track_number: number | null;
  disc_number: number | null;
  bpm: number | null;
  duration_seconds: number | null;
  format: string | null;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  channels: number | null;
  has_album_art: boolean;
  art_path: string | null;
  album_art_color: string | null;
  play_count: number;
  favorited: boolean;
  dup_flag: boolean;
  /** Frontend-only annotation used by the library's "Playlist" grouping */
  playlist_label?: string;
}

export interface TrackInfo {
  file_path: string;
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  format: string;
  bit_depth: number | null;
  bitrate: number | null;
}

export type RepeatMode = 'off' | 'all' | 'one';
export type ViewMode = 'nowPlaying' | 'library' | 'playlist' | 'settings' | 'visualizer';
export type VisualizerType =
  | 'spectrogram'
  | 'spiral'
  | 'rotator'
  | 'mandelbrot'
  | 'buddhabrot'
  | 'paint'
  | 'notes'
  | 'combined';

export const VISUALIZER_MODES: { id: VisualizerType; label: string }[] = [
  { id: 'spectrogram', label: 'Bars' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'rotator', label: 'Rotating Spiral' },
  { id: 'mandelbrot', label: 'Mandelbrot' },
  { id: 'buddhabrot', label: 'Buddhabrot' },
  { id: 'paint', label: 'Paint Splash' },
  { id: 'notes', label: 'Music Notes' },
  { id: 'combined', label: 'Combined' },
];

interface PlayerState {
  // Playback
  currentTrack: Track | null;
  trackInfo: TrackInfo | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;

  // Queue
  queue: Track[];
  queueIndex: number;
  originalQueue: Track[];
  playHistory: Track[];

  // Library
  libraryLoaded: boolean;
  scanProgress: number | null;

  // Visualizer
  visualizerMode: VisualizerType;
  visualizerFullscreen: boolean;
  artZoomVisible: boolean; // album-art lightbox (transient, not persisted)
  visualizerSettings: {
    sensitivity: number;
    speed: number;
    colorMode: 'auto' | 'spectrum' | 'custom';
    smoothing: number;
    quality: 'low' | 'medium' | 'high';
    mandelbrotPalette: 'cosmic' | 'acid' | 'fireice' | 'electric';
    mandelbrotHue: number; // 0-360 shift applied to the palette
  };

  // UI
  sidebarCollapsed: boolean;
  lyricsVisible: boolean;
  queueVisible: boolean;
  currentView: ViewMode;
  playbackError: string | null;
  selectedPlaylistId: number | null;

  // Actions
  setCurrentTrack: (track: Track | null) => void;
  setTrackInfo: (info: TrackInfo | null) => void;
  setIsPlaying: (playing: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  addToQueue: (track: Track) => void;
  playNext: (track: Track) => void;
  reorderQueue: (from: number, to: number) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  nextTrack: () => Track | null;
  prevTrack: () => Track | null;
  setQueueIndex: (index: number) => void;
  setVisualizerMode: (mode: VisualizerType) => void;
  setVisualizerFullscreen: (fs: boolean) => void;
  setArtZoomVisible: (v: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCurrentView: (view: ViewMode) => void;
  setLyricsVisible: (visible: boolean) => void;
  setQueueVisible: (visible: boolean) => void;
  updateVisualizerSettings: (settings: Partial<PlayerState['visualizerSettings']>) => void;
  setPlaybackError: (error: string | null) => void;
  setSelectedPlaylistId: (id: number | null) => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
  currentTrack: null,
  trackInfo: null,
  isPlaying: false,
  isLoading: false,
  currentTime: 0,
  duration: 0,
  volume: 80,
  isMuted: false,
  shuffleEnabled: false,
  repeatMode: 'off',

  queue: [],
  queueIndex: -1,
  originalQueue: [],
  playHistory: [],

  libraryLoaded: false,
  scanProgress: null,

  visualizerMode: 'spectrogram',
  visualizerFullscreen: false,
  artZoomVisible: false,
  // The golden config — tuned live on real music
  visualizerSettings: {
    sensitivity: 3.0,
    speed: 1.0,
    colorMode: 'spectrum',
    smoothing: 0.95,
    quality: 'high',
    mandelbrotPalette: 'cosmic',
    mandelbrotHue: 0,
  },

  sidebarCollapsed: false,
  lyricsVisible: false,
  queueVisible: true,
  currentView: 'nowPlaying',
  playbackError: null,
  selectedPlaylistId: null,

  setCurrentTrack: (track) => set({ currentTrack: track }),
  setTrackInfo: (info) => set({ trackInfo: info }),
  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set((s) => ({ isMuted: !s.isMuted })),

  toggleShuffle: () => {
    const { shuffleEnabled, queue, queueIndex, originalQueue } = get();
    if (shuffleEnabled) {
      // Restore original order
      const currentTrack = queue[queueIndex];
      const newIndex = originalQueue.findIndex((t) => t.id === currentTrack?.id);
      set({
        shuffleEnabled: false,
        queue: [...originalQueue],
        queueIndex: newIndex >= 0 ? newIndex : 0,
      });
    } else {
      // Shuffle using Fisher-Yates
      const currentTrack = queue[queueIndex];
      const shuffled = [...queue];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      // Move current track to front
      if (currentTrack) {
        const idx = shuffled.findIndex((t) => t.id === currentTrack.id);
        if (idx > 0) {
          [shuffled[0], shuffled[idx]] = [shuffled[idx], shuffled[0]];
        }
      }
      set({
        shuffleEnabled: true,
        originalQueue: [...queue],
        queue: shuffled,
        queueIndex: 0,
      });
    }
  },

  cycleRepeatMode: () => {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const { repeatMode } = get();
    const idx = modes.indexOf(repeatMode);
    set({ repeatMode: modes[(idx + 1) % modes.length] });
  },

  setQueue: (tracks, startIndex = 0) =>
    set((s) => {
      // If the user has shuffle on, honor it for the new queue too —
      // previously the flag stayed lit while the queue played in order.
      if (!s.shuffleEnabled || tracks.length < 2) {
        return { queue: tracks, originalQueue: tracks, queueIndex: startIndex, playHistory: [] };
      }
      const shuffled = [...tracks];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const sel = tracks[startIndex];
      if (sel) {
        const idx = shuffled.findIndex((t) => t.id === sel.id && t.file_path === sel.file_path);
        if (idx > 0) [shuffled[0], shuffled[idx]] = [shuffled[idx], shuffled[0]];
      }
      return { queue: shuffled, originalQueue: tracks, queueIndex: 0, playHistory: [] };
    }),

  addToQueue: (track) =>
    set((s) => ({
      queue: [...s.queue, track],
      originalQueue: [...s.originalQueue, track],
    })),

  playNext: (track) =>
    set((s) => {
      const newQueue = [...s.queue];
      newQueue.splice(s.queueIndex + 1, 0, track);
      // Mirror the insert into originalQueue (after the current track's
      // original position) — otherwise toggling shuffle off restores the
      // pre-insert snapshot and silently drops the track.
      const current = s.queue[s.queueIndex];
      const newOriginal = [...s.originalQueue];
      const oi = current
        ? newOriginal.findIndex((t) => t.id === current.id && t.file_path === current.file_path)
        : -1;
      newOriginal.splice(oi >= 0 ? oi + 1 : newOriginal.length, 0, track);
      return { queue: newQueue, originalQueue: newOriginal };
    }),

  reorderQueue: (from, to) =>
    set((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) {
        return {};
      }
      const queue = [...s.queue];
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);

      // Keep the playing index pointed at the same track
      let queueIndex = s.queueIndex;
      if (from === queueIndex) queueIndex = to;
      else if (from < queueIndex && to >= queueIndex) queueIndex -= 1;
      else if (from > queueIndex && to <= queueIndex) queueIndex += 1;

      // When unshuffled the visible order IS the canonical order; while
      // shuffled, the reorder applies to the shuffled view only.
      const originalQueue = s.shuffleEnabled ? s.originalQueue : [...queue];
      return { queue, queueIndex, originalQueue };
    }),

  removeFromQueue: (index) =>
    set((s) => {
      const removed = s.queue[index];
      if (!removed) return {};
      const queue = s.queue.filter((_, i) => i !== index);
      let queueIndex = s.queueIndex;
      if (index < queueIndex) {
        queueIndex -= 1;
      } else if (index === queueIndex) {
        queueIndex = Math.min(queueIndex, queue.length - 1);
      }
      const oi = s.originalQueue.findIndex(
        (t) => t.id === removed.id && t.file_path === removed.file_path
      );
      const originalQueue =
        oi >= 0 ? s.originalQueue.filter((_, i) => i !== oi) : s.originalQueue;
      return { queue, queueIndex, originalQueue };
    }),

  clearQueue: () => set({ queue: [], queueIndex: -1, originalQueue: [], playHistory: [] }),

  nextTrack: () => {
    const { queue, queueIndex, repeatMode, currentTrack } = get();
    if (queue.length === 0) return null;

    if (repeatMode === 'one') {
      return queue[queueIndex] || null;
    }

    let nextIndex = queueIndex + 1;
    if (nextIndex >= queue.length) {
      if (repeatMode === 'all') {
        nextIndex = 0;
      } else {
        return null;
      }
    }

    if (currentTrack) {
      set((s) => ({ playHistory: [...s.playHistory, currentTrack] }));
    }
    set({ queueIndex: nextIndex });
    return queue[nextIndex] || null;
  },

  prevTrack: () => {
    const { queue, queueIndex, playHistory } = get();
    if (playHistory.length > 0) {
      const prev = playHistory[playHistory.length - 1];
      set((s) => ({
        playHistory: s.playHistory.slice(0, -1),
        queueIndex: Math.max(0, s.queueIndex - 1),
      }));
      return prev;
    }
    if (queueIndex > 0) {
      const prevIndex = queueIndex - 1;
      set({ queueIndex: prevIndex });
      return queue[prevIndex] || null;
    }
    return queue[0] || null;
  },

  setQueueIndex: (index) => set({ queueIndex: index }),
  setVisualizerMode: (mode) => set({ visualizerMode: mode }),
  setVisualizerFullscreen: (fs) => set({ visualizerFullscreen: fs }),
  setArtZoomVisible: (v) => set({ artZoomVisible: v }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setCurrentView: (view) => set({ currentView: view }),
  setLyricsVisible: (visible) => set({ lyricsVisible: visible }),
  setQueueVisible: (visible) => set({ queueVisible: visible }),
  updateVisualizerSettings: (settings) =>
    set((s) => ({
      visualizerSettings: { ...s.visualizerSettings, ...settings },
    })),
  setPlaybackError: (error) => set({ playbackError: error }),
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
    }),
    {
      name: PERSIST_KEY,
      storage: throttledStorage,
      // Everything worth keeping across restarts. Live playback state
      // (isPlaying, currentTime, trackInfo) intentionally resets.
      partialize: (s) => ({
        currentTrack: s.currentTrack,
        currentTime: s.currentTime,
        volume: s.volume,
        isMuted: s.isMuted,
        shuffleEnabled: s.shuffleEnabled,
        repeatMode: s.repeatMode,
        queue: s.queue,
        queueIndex: s.queueIndex,
        originalQueue: s.originalQueue,
        playHistory: s.playHistory,
        visualizerMode: s.visualizerMode,
        visualizerSettings: s.visualizerSettings,
        lyricsVisible: s.lyricsVisible,
        queueVisible: s.queueVisible,
        sidebarCollapsed: s.sidebarCollapsed,
        currentView: s.currentView,
        selectedPlaylistId: s.selectedPlaylistId,
      }),
      // Deep-merge visualizerSettings so new fields keep their defaults
      // when restoring state saved by an older version
      merge: (persisted, current) => {
        const p = persisted as Partial<PlayerState> | undefined;
        return {
          ...current,
          ...p,
          visualizerSettings: {
            ...current.visualizerSettings,
            ...(p?.visualizerSettings ?? {}),
          },
        };
      },
      onRehydrateStorage: () => (state) => {
        // Show the restored track's length in the progress bar before playback starts
        if (state?.currentTrack) {
          state.setDuration(state.currentTrack.duration_seconds ?? 0);
        }
      },
    }
  )
);
