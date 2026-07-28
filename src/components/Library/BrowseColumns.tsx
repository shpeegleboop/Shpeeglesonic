import { useEffect, useRef } from 'react';
import { usePlayerStore, type Track } from '../../stores/playerStore';
import { useBrowse, type BrowseColumnModel } from '../../hooks/useBrowse';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { GroupList } from './GroupList';
import { ColumnHeader } from './ColumnHeader';
import { TrackList } from './TrackList';
import { type BrowseField } from '../../utils/browsePath';

/**
 * Defaults when a column has never been dragged, in rem so they grow with the
 * interface-size setting. Hardcoded px left 200% text crammed into a 220px
 * column, truncating almost every row.
 */
const GROUP_DEFAULT_REM = 13.75; // 220px at the default root size
const LEAF_MIN_REM = 20; // 320px at the default root size
const MIN_REM = 8.75; // 140px at the default root size

/** Explicit widths are stored in px, so the drag floor has to be converted. */
function remToPx(rem: number): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return rem * root;
}

interface BrowseColumnsProps {
  /** Search-filtered list, used for grouping and leaf contents. */
  tracks: Track[];
  /** Unfiltered library — only for keeping the path stable across searches. */
  allTracks: Track[];
  onLibraryChanged: () => void;
}

/**
 * Drag handle on a column's right edge. Present on every column including the
 * last — narrowing a lone track column is a legitimate thing to want, and it
 * simply leaves space to its right rather than trading with a neighbour.
 */
function ResizeHandle({ index, straddle }: { index: number; straddle: boolean }) {
  const setWidth = usePlayerStore((s) => s.setBrowseColumnWidth);
  const widths = usePlayerStore((s) => s.browseColumnWidths);

  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW =
      widths[index] ??
      (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect().width ??
      remToPx(GROUP_DEFAULT_REM);
    const floor = remToPx(MIN_REM);

    const move = (ev: MouseEvent) =>
      setWidth(index, Math.max(floor, Math.round(startW + ev.clientX - startX)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // Held on <body> so the cursor survives leaving the 5px handle mid-drag.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      onMouseDown={onDown}
      onDoubleClick={() => setWidth(index, null)}
      title="Drag to resize, double-click to reset"
      className={`absolute top-0 right-0 h-full w-[5px] z-10 cursor-col-resize hover:bg-neon-purple/40 transition-colors ${
        // Straddle the seam between columns, but stay inside the last one so
        // the handle isn't half-clipped at the edge of the pane.
        straddle ? 'translate-x-1/2' : ''
      }`}
    />
  );
}

/** Finder-style columns: each click adds a pane to the right. */
export function BrowseColumns({ tracks, allTracks, onLibraryChanged }: BrowseColumnsProps) {
  const { columns, select, setField } = useBrowse(tracks, allTracks);
  const widths = usePlayerStore((s) => s.browseColumnWidths);
  const player = useAudioPlayer();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal the newest column as you drill deeper.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columns.length]);

  const styleFor = (col: BrowseColumnModel) => {
    const w = widths[col.index];
    // An explicitly dragged width is absolute — the user picked those pixels.
    if (w) return { width: w, minWidth: w, flex: '0 0 auto' as const };
    // Untouched track columns absorb the leftover space — with only "Track
    // Title" open that means the full width, which is the point.
    return col.isLeaf
      ? { flex: '1 1 0%', minWidth: `${LEAF_MIN_REM}rem` }
      : {
          width: `${GROUP_DEFAULT_REM}rem`,
          minWidth: `${GROUP_DEFAULT_REM}rem`,
          flex: '0 0 auto' as const,
        };
  };

  return (
    <div ref={scrollRef} className="flex-1 flex overflow-x-auto overflow-y-hidden">
      {columns.map((col) => (
        <div key={col.index} style={styleFor(col)} className="relative h-full flex flex-col min-h-0">
          {col.isLeaf ? (
            <>
              <ColumnHeader
                field={col.field}
                fields={col.fields}
                onSetField={(f: BrowseField) => setField(col.index, f)}
              />
              <div className="flex-1 min-h-0 border-r border-cosmic-border/30">
                <TrackList
                  tracks={col.leafTracks}
                  sortBy={col.field}
                  scrollKey={col.scrollKey}
                  onLibraryChanged={onLibraryChanged}
                  onPlay={(track) => {
                    // Queue the column you played from, not the whole library.
                    const idx = col.leafTracks.findIndex((t) => t.id === track.id);
                    usePlayerStore.getState().setQueue(col.leafTracks, idx);
                    player.playTrack(track);
                  }}
                />
              </div>
            </>
          ) : (
            <GroupList
              column={col}
              className="flex-1 min-h-0"
              onSelect={(v) => select(col.index, v)}
              onSetField={(f) => setField(col.index, f)}
              onLibraryChanged={onLibraryChanged}
            />
          )}
          <ResizeHandle index={col.index} straddle={col.index < columns.length - 1} />
        </div>
      ))}
    </div>
  );
}
