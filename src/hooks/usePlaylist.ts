import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../stores/playerStore';

export interface Playlist {
  id: number;
  name: string;
  track_count: number;
}

// Shared playlist state across all usePlaylist() instances
let _globalPlaylists: Playlist[] = [];
let _listeners: Set<() => void> = new Set();

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

export function usePlaylist() {
  const [playlists, setPlaylists] = useState<Playlist[]>(_globalPlaylists);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);

  useEffect(() => {
    const listener = () => {
      setPlaylists([..._globalPlaylists]);
    };
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  const fetchPlaylists = useCallback(async () => {
    try {
      const result = await invoke<Playlist[]>('get_playlists');
      _globalPlaylists = result;
      setPlaylists(result);
      notifyListeners();
      return result;
    } catch (e) {
      console.error('Failed to fetch playlists:', e);
      return [];
    }
  }, []);

  const createPlaylist = useCallback(async (name: string) => {
    try {
      await invoke<number>('create_playlist', { name });
      await fetchPlaylists();
    } catch (e) {
      console.error('Failed to create playlist:', e);
    }
  }, [fetchPlaylists]);

  const deletePlaylist = useCallback(async (playlistId: number) => {
    try {
      await invoke('delete_playlist', { playlistId });
      await fetchPlaylists();
    } catch (e) {
      console.error('Failed to delete playlist:', e);
    }
  }, [fetchPlaylists]);

  const addTrackToPlaylist = useCallback(async (playlistId: number, trackId: number) => {
    try {
      await invoke('add_track_to_playlist', { playlistId, trackId });
      await fetchPlaylists();
    } catch (e) {
      console.error('Failed to add track to playlist:', e);
    }
  }, [fetchPlaylists]);

  const removeTrackFromPlaylist = useCallback(async (playlistId: number, trackId: number) => {
    try {
      await invoke('remove_track_from_playlist', { playlistId, trackId });
      await fetchPlaylists();
    } catch (e) {
      console.error('Failed to remove track from playlist:', e);
    }
  }, [fetchPlaylists]);

  const fetchPlaylistTracks = useCallback(async (playlistId: number) => {
    try {
      const result = await invoke<Track[]>('get_playlist_tracks', { playlistId });
      setPlaylistTracks(result);
      return result;
    } catch (e) {
      console.error('Failed to fetch playlist tracks:', e);
      return [];
    }
  }, []);

  return {
    playlists,
    playlistTracks,
    fetchPlaylists,
    createPlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
    fetchPlaylistTracks,
  };
}
