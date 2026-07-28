import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../stores/playerStore';
import { getGlobalTracks } from '../hooks/useLibrary';
import { readTrackDrag, resolveTracks } from './trackDrag';

/**
 * The tracks a drop should act on.
 *
 * Kept out of trackDrag.ts so that module stays pure and unit-testable under
 * vitest's node environment — this one reaches for Tauri.
 *
 * Callers must invoke it synchronously from the drop handler: getData() is only
 * readable during the event, and the payload is read before the first await.
 */
export async function tracksForDrop(dt: DataTransfer): Promise<Track[]> {
  const payload = readTrackDrag(dt);
  if (!payload) return [];

  if (payload.playlistId !== undefined) {
    try {
      return await invoke<Track[]>('get_playlist_tracks', { playlistId: payload.playlistId });
    } catch (e) {
      console.error('Failed to read dragged playlist:', e);
      return [];
    }
  }

  return resolveTracks(payload.trackIds, getGlobalTracks());
}
