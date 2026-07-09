import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { usePlayerStore } from '../stores/playerStore';

export interface FFTData {
  bins: number[];
  rms: number;
  time: number;
}

// Global listeners are set up once (not per-component)
let _trackEndedListenerSetUp = false;
let _playbackErrorListenerSetUp = false;

export function useFFTData() {
  const fftRef = useRef<FFTData>({
    bins: new Array(1024).fill(0),
    rms: 0,
    time: 0,
  });
  const lastUpdateRef = useRef<number>(Date.now());

  const setCurrentTime = usePlayerStore((s) => s.setCurrentTime);

  useEffect(() => {
    let unlistenFFT: UnlistenFn;
    let frameCount = 0;

    listen<FFTData>('fft-data', (event) => {
      fftRef.current = event.payload;
      lastUpdateRef.current = Date.now();
      // Update time in store at ~15Hz to avoid excessive re-renders
      frameCount++;
      if (frameCount % 4 === 0 && event.payload.time > 0) {
        setCurrentTime(event.payload.time);
      }
    }).then((fn) => {
      unlistenFFT = fn;
    });

    // Listen for track-ended to auto-advance
    if (!_trackEndedListenerSetUp) {
      _trackEndedListenerSetUp = true;
      listen('track-ended', async () => {
        const store = usePlayerStore.getState();
        if (store.isLoading) return; // Already loading next track

        store.setIsPlaying(false);

        // Handle repeat-one
        if (store.repeatMode === 'one' && store.currentTrack) {
          store.setIsLoading(true);
          const { invoke } = await import('@tauri-apps/api/core');
          try {
            const info = await invoke<{ file_path: string; duration_seconds: number; sample_rate: number; channels: number; format: string; bit_depth: number | null; bitrate: number | null }>('play_file', { path: store.currentTrack.file_path });
            store.setTrackInfo(info);
            store.setDuration(info.duration_seconds);
            store.setCurrentTime(0);
            store.setIsPlaying(true);
          } catch (e) {
            console.error('Repeat failed:', e);
          } finally {
            store.setIsLoading(false);
          }
          return;
        }

        // Auto-advance to next track
        const next = store.nextTrack();
        if (next) {
          store.setIsLoading(true);
          store.setCurrentTrack(next);
          const { invoke } = await import('@tauri-apps/api/core');
          try {
            const info = await invoke<{ file_path: string; duration_seconds: number; sample_rate: number; channels: number; format: string; bit_depth: number | null; bitrate: number | null }>('play_file', { path: next.file_path });
            store.setTrackInfo(info);
            store.setDuration(info.duration_seconds);
            store.setCurrentTime(0);
            store.setIsPlaying(true);
          } catch (e) {
            console.error('Auto-advance failed:', e);
          } finally {
            store.setIsLoading(false);
          }
        }
      }).then(() => {});
    }

    // Listen for playback errors from Rust
    if (!_playbackErrorListenerSetUp) {
      _playbackErrorListenerSetUp = true;
      listen<{ error: string; file: string }>('playback-error', (event) => {
        const { error, file } = event.payload;
        const store = usePlayerStore.getState();
        store.setPlaybackError(`Failed to play "${file}": ${error}`);
        store.setIsPlaying(false);
        store.setIsLoading(false);
      }).then(() => {});
    }

    return () => {
      unlistenFFT?.();
      // Don't unlisten track-ended — it's global
    };
  }, [setCurrentTime]);

  return { fftRef, lastUpdateRef };
}
