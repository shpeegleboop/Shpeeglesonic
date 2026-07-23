import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../stores/playerStore';
import { type Playlist } from './usePlaylist';
import { type useLibrary } from './useLibrary';

/**
 * When the library sort is "playlist", composes the display list as
 * [each playlist's tracks in order, annotated with its name] followed by
 * [tracks not in any playlist]. For any other sort, passes tracks through.
 * Shared by the Library tab and the Now Playing sidebar.
 */
export function usePlaylistGrouping(library: ReturnType<typeof useLibrary>): Track[] {
  const isPlaylistSort = library.sortBy === 'playlist';
  const [grouped, setGrouped] = useState<Track[]>([]);

  useEffect(() => {
    if (!isPlaylistSort) {
      setGrouped([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pls = await invoke<Playlist[]>('get_playlists');
        const q = library.searchQuery.trim().toLowerCase();
        const matches = (t: Track) =>
          !q || [t.title, t.artist, t.album, t.genre].some((v) => v?.toLowerCase().includes(q));
        const ordered = library.sortOrder === 'desc' ? [...pls].reverse() : pls;
        const inAnyPlaylist = new Set<number>();
        const composed: Track[] = [];
        for (const pl of ordered) {
          const ts = await invoke<Track[]>('get_playlist_tracks', { playlistId: pl.id });
          ts.forEach((t) => inAnyPlaylist.add(t.id));
          composed.push(...ts.filter(matches).map((t) => ({ ...t, playlist_label: pl.name })));
        }
        // library.tracks is already search-filtered by the backend
        composed.push(...library.tracks.filter((t) => !inAnyPlaylist.has(t.id)));
        if (!cancelled) setGrouped(composed);
      } catch (e) {
        console.error('Failed to build playlist grouping:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPlaylistSort, library.tracks, library.sortOrder]);

  return isPlaylistSort ? grouped : library.tracks;
}
