import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { usePlaylistGrouping } from '../../hooks/usePlaylistGrouping';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';
import { SearchBar } from '../Library/SearchBar';
import { SortControls } from '../Library/SortControls';

export function Sidebar() {
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed);
  const library = useLibrary();
  const displayTracks = usePlaylistGrouping(library);
  const player = useAudioPlayer();

  useEffect(() => {
    library.fetchTracks();
    library.fetchFolders();
  }, []);

  if (collapsed) return null;

  return (
    <aside className="w-72 flex flex-col bg-cosmic-surface border-r border-cosmic-border/50 overflow-hidden">
      <div className="p-2 space-y-2 border-b border-cosmic-border/30">
        <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
        <SortControls sortBy={library.sortBy} sortOrder={library.sortOrder} onSort={library.updateSort} />
      </div>

      <div className="flex-1 overflow-hidden">
        <TrackList
          tracks={displayTracks}
          sortBy={library.sortBy}
          onLibraryChanged={() => library.fetchTracks()}
          onPlay={(track) => {
            // Set queue to the displayed list, start at the clicked one
            const idx = displayTracks.findIndex((t) => t.id === track.id);
            usePlayerStore.getState().setQueue(displayTracks, idx);
            player.playTrack(track);
          }}
        />
      </div>
    </aside>
  );
}
