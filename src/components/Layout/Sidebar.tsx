import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';
import { SearchBar } from '../Library/SearchBar';
import { SortControls } from '../Library/SortControls';

export function Sidebar() {
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed);
  const library = useLibrary();
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
          tracks={library.tracks}
          sortBy={library.sortBy}
          onPlay={(track) => {
            // Set queue to all library tracks, start at the clicked one
            const idx = library.tracks.findIndex((t) => t.id === track.id);
            usePlayerStore.getState().setQueue(library.tracks, idx);
            player.playTrack(track);
          }}
        />
      </div>
    </aside>
  );
}
