import { useEffect, useRef } from 'react';
import { usePlayerStore, type Track } from '../../stores/playerStore';
import { useBrowse } from '../../hooks/useBrowse';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { GroupList } from './GroupList';
import { TrackList } from './TrackList';

interface BrowseColumnsProps {
  /** Search-filtered list, used for grouping and leaf contents. */
  tracks: Track[];
  /** Unfiltered library — only for keeping the path stable across searches. */
  allTracks: Track[];
  onLibraryChanged: () => void;
}

/** Finder-style columns: each click adds a pane to the right. */
export function BrowseColumns({ tracks, allTracks, onLibraryChanged }: BrowseColumnsProps) {
  const { columns, select, setField } = useBrowse(tracks, allTracks);
  const player = useAudioPlayer();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal the newest column as you drill deeper.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  return (
    <div ref={scrollRef} className="flex-1 flex overflow-x-auto overflow-y-hidden">
      {columns.map((col) =>
        col.isLeaf ? (
          <div key={col.index} className="flex-1 min-w-[320px] h-full">
            <TrackList
              tracks={col.leafTracks}
              onLibraryChanged={onLibraryChanged}
              onPlay={(track) => {
                // Queue the column you played from, not the whole library.
                const idx = col.leafTracks.findIndex((t) => t.id === track.id);
                usePlayerStore.getState().setQueue(col.leafTracks, idx);
                player.playTrack(track);
              }}
            />
          </div>
        ) : (
          <GroupList
            key={col.index}
            column={col}
            className="min-w-[220px] w-[220px]"
            onSelect={(v) => select(col.index, v)}
            onSetField={(f) => setField(col.index, f)}
            onLibraryChanged={onLibraryChanged}
          />
        )
      )}
    </div>
  );
}
