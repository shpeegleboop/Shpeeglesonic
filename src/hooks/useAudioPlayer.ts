import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore, Track, TrackInfo } from '../stores/playerStore';

export function useAudioPlayer() {
  const store = usePlayerStore();

  const playTrack = async (track: Track) => {
    // Prevent multiple simultaneous loads
    if (store.isLoading) return;
    try {
      store.setIsLoading(true);
      store.setPlaybackError(null);
      store.setCurrentTrack(track);
      const info = await invoke<TrackInfo>('play_file', { path: track.file_path });
      store.setTrackInfo(info);
      store.setDuration(info.duration_seconds);
      store.setCurrentTime(0);
      store.setIsPlaying(true);

      // Record play count
      if (track.id > 0) {
        invoke('record_play', { trackId: track.id }).catch(() => {});
      }
    } catch (e) {
      console.error('Play failed:', e);
      store.setIsPlaying(false);
    } finally {
      store.setIsLoading(false);
    }
  };

  const playFile = async (path: string) => {
    try {
      const info = await invoke<TrackInfo>('play_file', { path });
      const track: Track = {
        id: 0,
        file_path: path,
        file_name: path.split('/').pop() || path,
        title: path.split('/').pop()?.replace(/\.[^.]+$/, '') || null,
        artist: null,
        album_artist: null,
        album: null,
        genre: null,
        year: null,
        track_number: null,
        disc_number: null,
        bpm: null,
        duration_seconds: info.duration_seconds,
        format: info.format,
        bitrate: info.bitrate,
        sample_rate: info.sample_rate,
        bit_depth: info.bit_depth,
        channels: info.channels,
        has_album_art: false,
        art_path: null,
        play_count: 0,
        favorited: false,
      };
      store.setCurrentTrack(track);
      store.setTrackInfo(info);
      store.setDuration(info.duration_seconds);
      store.setCurrentTime(0);
      store.setIsPlaying(true);
    } catch (e) {
      console.error('Play failed:', e);
    }
  };

  const pause = async () => {
    try {
      await invoke('pause');
      store.setIsPlaying(false);
    } catch (e) {
      console.error('Pause failed:', e);
    }
  };

  const resume = async () => {
    try {
      await invoke('resume');
      store.setIsPlaying(true);
    } catch (e) {
      console.error('Resume failed:', e);
    }
  };

  const stop = async () => {
    try {
      await invoke('stop');
      store.setIsPlaying(false);
      store.setCurrentTime(0);
      store.setCurrentTrack(null);
      store.setTrackInfo(null);
    } catch (e) {
      console.error('Stop failed:', e);
    }
  };

  const seek = async (seconds: number) => {
    try {
      await invoke('seek', { position: seconds });
      store.setCurrentTime(seconds);
    } catch (e) {
      console.error('Seek failed:', e);
    }
  };

  const setVolume = async (vol: number) => {
    try {
      const clamped = Math.max(0, Math.min(100, Math.round(vol)));
      await invoke('set_volume', { volume: clamped });
      store.setVolume(clamped);
    } catch (e) {
      console.error('Volume failed:', e);
    }
  };

  const togglePlayPause = async () => {
    if (store.isPlaying) {
      await pause();
    } else if (store.currentTrack) {
      await resume();
    }
  };

  const playNextTrack = async () => {
    const next = store.nextTrack();
    if (next) {
      await playTrack(next);
    } else {
      await stop();
    }
  };

  const playPrevTrack = async () => {
    // If more than 3 seconds in, restart current track
    if (store.currentTime > 3 && store.currentTrack) {
      await seek(0);
      return;
    }
    const prev = store.prevTrack();
    if (prev) {
      await playTrack(prev);
    }
  };

  return {
    playTrack,
    playFile,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    togglePlayPause,
    playNextTrack,
    playPrevTrack,
  };
}
