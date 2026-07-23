import { useEffect, useMemo, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylist } from '../../hooks/usePlaylist';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';
import { SearchBar } from '../Library/SearchBar';

interface PlaylistViewProps {
  playlistId: number;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
  const { playlistTracks, fetchPlaylistTracks, reorderPlaylistTrack } = usePlaylist();
  const player = useAudioPlayer();
  const [query, setQuery] = useState('');

  useEffect(() => {
    setQuery('');
    fetchPlaylistTracks(playlistId);
  }, [playlistId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return playlistTracks;
    return playlistTracks.filter((t) =>
      [t.title, t.artist, t.album, t.genre, t.file_name].some((v) => v?.toLowerCase().includes(q))
    );
  }, [playlistTracks, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-2 border-b border-cosmic-border/30">
        <SearchBar value={query} onChange={setQuery} />
      </div>
      <div className="flex-1 overflow-hidden">
        <TrackList
          tracks={filtered}
          onLibraryChanged={() => fetchPlaylistTracks(playlistId)}
          emptyTitle={searching ? 'No matches in this playlist' : undefined}
          emptySubtitle={searching ? 'Try a different search' : undefined}
          // Drag-reorder maps to playlist positions, which a filtered view
          // can't represent — disabled while searching
          onReorder={
            searching
              ? undefined
              : async (from, to) => {
                  await reorderPlaylistTrack(playlistId, from, to);
                  await fetchPlaylistTracks(playlistId);
                }
          }
          onPlay={(track) => {
            const idx = filtered.findIndex((t) => t.id === track.id);
            usePlayerStore.getState().setQueue(filtered, idx);
            player.playTrack(track);
          }}
        />
      </div>
    </div>
  );
}
