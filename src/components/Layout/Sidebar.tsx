import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { usePlaylistGrouping } from '../../hooks/usePlaylistGrouping';
import { useBrowse } from '../../hooks/useBrowse';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';
import { GroupList } from '../Library/GroupList';
import { SearchBar } from '../Library/SearchBar';
import { GROUP_FIELD_LABELS } from '../../utils/browsePath';
import { ChevronLeftIcon } from '../Icons';

export function Sidebar() {
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed);
  const library = useLibrary();
  const displayTracks = usePlaylistGrouping(library);
  const { columns, path, select, setField, popTo } = useBrowse(displayTracks, library.allTracks);
  const player = useAudioPlayer();

  useEffect(() => {
    library.fetchTracks();
    library.fetchFolders();
  }, []);

  if (collapsed) return null;

  // Only the deepest column fits at 288px — three side-by-side would be 96px
  // each. The breadcrumb walks back up instead.
  const deepest = columns[columns.length - 1];
  const crumbs = path.slice(0, -1);
  const parent = crumbs[crumbs.length - 1];

  return (
    <aside className="w-72 flex flex-col bg-cosmic-surface border-r border-cosmic-border/50 overflow-hidden">
      <div className="p-2 border-b border-cosmic-border/30">
        <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
      </div>

      {parent && (
        <button
          onClick={() => popTo(crumbs.length - 1)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-neon-purple/10 border-b border-cosmic-border/30 transition-colors"
          title="Back"
        >
          <ChevronLeftIcon size={12} />
          <span className="truncate">
            {parent.value ?? GROUP_FIELD_LABELS[parent.field]}
          </span>
        </button>
      )}

      <div className="flex-1 overflow-hidden">
        {deepest?.isLeaf ? (
          <TrackList
            tracks={deepest.leafTracks}
            onLibraryChanged={() => library.fetchTracks()}
            onPlay={(track) => {
              const idx = deepest.leafTracks.findIndex((t) => t.id === track.id);
              usePlayerStore.getState().setQueue(deepest.leafTracks, idx);
              player.playTrack(track);
            }}
          />
        ) : (
          deepest && (
            <GroupList
              column={deepest}
              className="w-full"
              onSelect={(v) => select(deepest.index, v)}
              onSetField={(f) => setField(deepest.index, f)}
              onLibraryChanged={() => library.fetchTracks()}
            />
          )
        )}
      </div>
    </aside>
  );
}
