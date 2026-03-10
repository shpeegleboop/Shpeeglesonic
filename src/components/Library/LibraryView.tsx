import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
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

  return (
    <div className="flex flex-1 overflow-hidden">
      <PlaylistSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPlaylistId === null ? (
          <>
            <div className="p-2 space-y-2 border-b border-cosmic-border/30">
              <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
              <SortControls sortBy={library.sortBy} sortOrder={library.sortOrder} onSort={library.updateSort} />
            </div>
            <div className="flex-1 overflow-hidden">
              <TrackList
                tracks={library.tracks}
                sortBy={library.sortBy}
                onPlay={(track) => {
                  const idx = library.tracks.findIndex((t) => t.id === track.id);
                  usePlayerStore.getState().setQueue(library.tracks, idx);
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
