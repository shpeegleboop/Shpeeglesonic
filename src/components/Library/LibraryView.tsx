import { useEffect } from 'react';
import { usePlayerStore, FAVORITES_PLAYLIST_ID } from '../../stores/playerStore';
import { usePlaylistGrouping } from '../../hooks/usePlaylistGrouping';
import { useLibrary } from '../../hooks/useLibrary';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from './TrackList';
import { SearchBar } from './SearchBar';
import { SortControls } from './SortControls';
import { PlaylistSidebar } from '../Playlist/PlaylistSidebar';
import { PlaylistView } from '../Playlist/PlaylistView';

export function LibraryView() {
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const library = useLibrary();
  const player = useAudioPlayer();

  useEffect(() => {
    library.fetchTracks();
    library.fetchFolders();
  }, []);

  const isFavorites = selectedPlaylistId === FAVORITES_PLAYLIST_ID;
  const baseTracks = usePlaylistGrouping(library);
  const visibleTracks = isFavorites ? baseTracks.filter((t) => t.favorited) : baseTracks;

  return (
    <div className="flex flex-1 overflow-hidden">
      <PlaylistSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPlaylistId === null || isFavorites ? (
          <>
            <div className="p-2 space-y-2 border-b border-cosmic-border/30">
              <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
              <SortControls sortBy={library.sortBy} sortOrder={library.sortOrder} onSort={library.updateSort} />
            </div>
            <div className="flex-1 overflow-hidden">
              <TrackList
                tracks={visibleTracks}
                sortBy={library.sortBy}
                onLibraryChanged={() => library.fetchTracks()}
                emptyTitle={isFavorites ? 'No favorites yet' : undefined}
                emptySubtitle={isFavorites ? 'Right-click a track (or use the heart on Now Playing) to favorite it' : undefined}
                onPlay={(track) => {
                  const idx = visibleTracks.findIndex((t) => t.id === track.id);
                  usePlayerStore.getState().setQueue(visibleTracks, idx);
                  player.playTrack(track);
                }}
              />
            </div>
          </>
        ) : (
          <PlaylistView playlistId={selectedPlaylistId} />
        )}
      </div>
    </div>
  );
}
