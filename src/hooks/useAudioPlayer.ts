import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore, Track, TrackInfo } from '../stores/playerStore';

/**
 * Load requests are serialized process-wide, not per hook instance — several
 * components call useAudioPlayer(), and two of them must not be able to start
 * overlapping loads.
 *
 * The old guard was `if (store.isLoading) return`, reading a render-time
 * snapshot rather than live state, so it never fired for calls made in the same
 * tick. Two loads would then race to the engine and whichever reached its mutex
 * last won the audio — leaving the UI showing one track while a different one
 * played.
 */
let playSeq = 0;
let playChain: Promise<void> = Promise.resolve();

export function useAudioPlayer() {
  const store = usePlayerStore();

  const playTrack = (track: Track): Promise<void> => {
    const seq = ++playSeq;
    playChain = playChain.then(async () => {
      // A newer request arrived while this one was queued — skip it rather than
      // loading a track the user has already moved past.
      if (seq !== playSeq) return;

      const st = usePlayerStore.getState();
      st.setIsLoading(true);
      st.setPlaybackError(null);
      // Set inside the chain, immediately before the load, so the UI can never
      // advertise a track the engine was not actually asked to play.
      st.setCurrentTrack(track);
      try {
        const info = await invoke<TrackInfo>('play_file', { path: track.file_path });
        if (seq !== playSeq) return; // superseded mid-load
        st.setTrackInfo(info);
        st.setDuration(info.duration_seconds);
        st.setCurrentTime(0);
        st.setIsPlaying(true);

        // Record play count
        if (track.id > 0) {
          invoke('record_play', { trackId: track.id }).catch(() => {});
        }
      } catch (e) {
        console.error('Play failed:', e);
        if (seq === playSeq) {
          st.setPlaybackError(`Couldn't play ${track.file_name}: ${e}`);
          st.setIsPlaying(false);
        }
      } finally {
        if (seq === playSeq) st.setIsLoading(false);
      }
    });
    return playChain;
  };

  const playFile = async (path: string) => {
    try {
      const info = await invoke<TrackInfo>('play_file', { path });
      const fileName = path.split(/[\\/]/).pop() || path;
      const track: Track = {
        id: 0,
        file_path: path,
        file_name: fileName,
        date_added: null,
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
    const next = usePlayerStore.getState().nextTrack();
    if (next) {
      await playTrack(next);
    } else {
      await stop();
    }
  };

  const playPrevTrack = async () => {
    // Live state: currentTime advances 15x a second, so a render snapshot here
    // decides restart-vs-previous from a stale position.
    const s = usePlayerStore.getState();
    if (s.currentTime > 3 && s.currentTrack) {
      await seek(0);
      return;
    }
    const prev = s.prevTrack();
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
