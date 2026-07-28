import { useEffect } from 'react';
import { usePlayerStore, FAVORITES_PLAYLIST_ID } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { BrowseColumns } from './BrowseColumns';
import { SearchBar } from './SearchBar';
import { PlaylistSidebar } from '../Playlist/PlaylistSidebar';
import { PlaylistView } from '../Playlist/PlaylistView';

export function LibraryView() {
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const library = useLibrary();

  useEffect(() => {
    library.fetchTracks();
    library.fetchFolders();
  }, []);

  const isFavorites = selectedPlaylistId === FAVORITES_PLAYLIST_ID;
  const baseTracks = library.tracks;
  const visibleTracks = isFavorites ? baseTracks.filter((t) => t.favorited) : baseTracks;

  return (
    <div className="flex flex-1 overflow-hidden">
      <PlaylistSidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedPlaylistId === null || isFavorites ? (
          <>
            <div className="p-2 border-b border-cosmic-border/30">
              <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
            </div>
            <div className="flex-1 overflow-hidden flex">
              <BrowseColumns
                tracks={visibleTracks}
                allTracks={library.allTracks}
                onLibraryChanged={() => library.fetchTracks()}
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
