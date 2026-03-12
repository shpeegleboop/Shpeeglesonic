import { create } from 'zustand';

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
export type ViewMode = 'nowPlaying' | 'library' | 'playlist' | 'settings';
export type VisualizerType = 'spectrogram' | 'spiral' | 'mandelbrot' | 'combined';

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
  visualizerSettings: {
    sensitivity: number;
    speed: number;
    colorMode: 'auto' | 'spectrum' | 'custom';
    smoothing: number;
    quality: 'low' | 'medium' | 'high';
  };

  // UI
  sidebarCollapsed: boolean;
  lyricsVisible: boolean;
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
  clearQueue: () => void;
  nextTrack: () => Track | null;
  prevTrack: () => Track | null;
  setQueueIndex: (index: number) => void;
  setVisualizerMode: (mode: VisualizerType) => void;
  setVisualizerFullscreen: (fs: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCurrentView: (view: ViewMode) => void;
  setLyricsVisible: (visible: boolean) => void;
  updateVisualizerSettings: (settings: Partial<PlayerState['visualizerSettings']>) => void;
  setPlaybackError: (error: string | null) => void;
  setSelectedPlaylistId: (id: number | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
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
  visualizerSettings: {
    sensitivity: 1.0,
    speed: 1.0,
    colorMode: 'spectrum',
    smoothing: 0.8,
    quality: 'medium',
  },

  sidebarCollapsed: false,
  lyricsVisible: false,
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
    set({
      queue: tracks,
      originalQueue: tracks,
      queueIndex: startIndex,
      playHistory: [],
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
      return { queue: newQueue };
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
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setCurrentView: (view) => set({ currentView: view }),
  setLyricsVisible: (visible) => set({ lyricsVisible: visible }),
  updateVisualizerSettings: (settings) =>
    set((s) => ({
      visualizerSettings: { ...s.visualizerSettings, ...settings },
    })),
  setPlaybackError: (error) => set({ playbackError: error }),
  setSelectedPlaylistId: (id) => set({ selectedPlaylistId: id }),
}));
