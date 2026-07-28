import { type Track } from '../stores/playerStore';

/**
 * The library search predicate. Deliberately at parity with get_tracks' SQL
 * (`title/artist/album/genre LIKE '%q%'`) so the client-side filter and the
 * backend query can never disagree about what "matching" means.
 *
 * Used by useLibrary to filter the whole library client-side.
 */
export function matchesQuery(track: Track, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [track.title, track.artist, track.album, track.genre].some((v) =>
    v?.toLowerCase().includes(q)
  );
}
