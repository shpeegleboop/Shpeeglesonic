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
      store.setPlaybackError(`Couldn't play ${track.file_name}: ${e}`);
      store.setIsPlaying(false);
    } finally {
      store.setIsLoading(false);
    }
  };

  const playFile = async (path: string) => {
    try {
      const info = await invoke<TrackInfo>('play_file', { path });
      const fileName = path.split(/[\\/]/).pop() || path;
      const track: Track = {
        id: 0,
        file_path: path,
        file_name: fileName,
        title: fileName.replace(/\.[^.]+$/, '') || null,
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
        album_art_color: null,
        play_count: 0,
        favorited: false,
        dup_flag: false,
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
      // Dragging the volume slider unmutes
      if (store.isMuted && clamped > 0) {
        usePlayerStore.setState({ isMuted: false });
      }
    } catch (e) {
      console.error('Volume failed:', e);
    }
  };

  const toggleMute = async () => {
    const { isMuted, volume } = usePlayerStore.getState();
    try {
      await invoke('set_volume', { volume: isMuted ? volume : 0 });
      usePlayerStore.setState({ isMuted: !isMuted });
    } catch (e) {
      console.error('Mute failed:', e);
    }
  };

  const togglePlayPause = async () => {
    // Read fresh state — render snapshots can be stale in event handlers
    const s = usePlayerStore.getState();
    if (s.isPlaying) {
      await pause();
    } else if (s.currentTrack) {
      if (s.trackInfo) {
        await resume();
      } else {
        // Track restored from a previous session — engine has nothing loaded yet
        const resumeAt = s.currentTime;
        await playTrack(s.currentTrack);
        if (resumeAt > 0) await seek(resumeAt);
      }
    } else if (s.queue.length > 0) {
      // No current track but the queue survived — play from the queue position
      const idx = s.queueIndex >= 0 && s.queueIndex < s.queue.length ? s.queueIndex : 0;
      usePlayerStore.getState().setQueueIndex(idx);
      await playTrack(s.queue[idx]);
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
    toggleMute,
    togglePlayPause,
    playNextTrack,
    playPrevTrack,
  };
}
