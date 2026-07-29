import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { useBrowse } from '../../hooks/useBrowse';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';
import { GroupList } from '../Library/GroupList';
import { ColumnHeader } from '../Library/ColumnHeader';
import { SearchBar } from '../Library/SearchBar';
import { FIELD_LABELS } from '../../utils/browsePath';
import { ChevronLeftIcon } from '../Icons';

export function Sidebar() {
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed);
  const library = useLibrary();
  const displayTracks = library.tracks;
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

  // Every column is a path step, leaf included, so going back is uniformly
  // "drop this column and clear the one above".
  const backIndex = (deepest?.index ?? 0) - 1;
  const canGoBack = backIndex >= 0;
  // What we'd return to, plus the selection pinning the current view — the
  // sidebar shows one column, so that context isn't visible anywhere else.
  const backField = canGoBack ? FIELD_LABELS[path[backIndex].field] : '';
  const pinned = canGoBack ? path[backIndex]?.value : null;

  return (
    <aside className="w-72 flex flex-col bg-cosmic-surface border-r border-cosmic-border/50 overflow-hidden">
      <div className="p-2 border-b border-cosmic-border/30">
        <SearchBar value={library.searchQuery} onChange={library.updateSearch} />
      </div>

      {canGoBack && (
        <button
          onClick={() => popTo(backIndex)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-neon-purple/10 border-b border-cosmic-border/30 transition-colors w-full"
          title={`Back to ${backField}`}
        >
          <ChevronLeftIcon size={12} />
          <span className="shrink-0">{backField}</span>
          {pinned && (
            <span className="truncate text-gray-500 ml-auto">{pinned}</span>
          )}
        </button>
      )}

      <div className="flex-1 overflow-hidden">
        {deepest?.isLeaf ? (
          // Needs its own header: without it the root track column has neither a
          // dropdown nor a back button, so there is no way out of the flat list
          // from this tab.
          <div className="h-full flex flex-col min-h-0">
            <ColumnHeader
              field={deepest.field}
              fields={deepest.fields}
              onSetField={(f) => setField(deepest.index, f)}
              albumOrder={deepest.usesAlbumOrder}
            />
            <div className="flex-1 min-h-0">
              <TrackList
                tracks={deepest.leafTracks}
                sortBy={deepest.field}
                scrollKey={deepest.scrollKey}
                onLibraryChanged={() => library.fetchTracks()}
                onPlay={(track) => {
                  const idx = deepest.leafTracks.findIndex((t) => t.id === track.id);
                  usePlayerStore.getState().setQueue(deepest.leafTracks, idx);
                  player.playTrack(track);
                }}
              />
            </div>
          </div>
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
