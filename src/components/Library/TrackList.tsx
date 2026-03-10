import { useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type Track, usePlayerStore } from '../../stores/playerStore';
import {
  formatDuration,
  trackDisplayTitle,
  trackDisplayArtist,
  formatBitrate,
  formatSampleRate,
  formatBitDepth,
} from '../../utils/formatters';
import { TrackContextMenu } from './TrackContextMenu';

interface TrackListProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
  sortBy?: string;
}

// Sort fields that should show grouped/collapsible headers
const GROUPABLE_SORTS = ['artist', 'album', 'genre'];

// Get a metadata badge value for the current sort
function getSortMeta(track: Track, sortBy: string): string {
  switch (sortBy) {
    case 'bpm':
      return track.bpm ? `${Math.round(track.bpm)} BPM` : '';
    case 'bitrate':
      return formatBitrate(track.bitrate);
    case 'sample_rate':
      return formatSampleRate(track.sample_rate);
    case 'format':
      return [track.format, formatBitDepth(track.bit_depth)].filter(Boolean).join(' ');
    case 'year':
      return track.year ? String(track.year) : '';
    case 'duration':
      return ''; // already shown on the right
    default:
      return '';
  }
}

// Get group key for groupable sorts
function getGroupKey(track: Track, sortBy: string): string {
  switch (sortBy) {
    case 'artist':
      return track.artist || 'Unknown Artist';
    case 'album':
      return track.album || 'Unknown Album';
    case 'genre':
      return track.genre || 'Unknown Genre';
    default:
      return '';
  }
}

type VirtualRow =
  | { type: 'header'; key: string; label: string; count: number; groupIndex: number }
  | { type: 'track'; key: string; track: Track; trackIndex: number };

export function TrackList({ tracks, onPlay, sortBy = 'title' }: TrackListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  const isGrouped = GROUPABLE_SORTS.includes(sortBy);
  const showSortMeta = !isGrouped && sortBy !== 'title' && sortBy !== 'date_added' && sortBy !== 'duration';

  // Build virtual rows: either flat track list or grouped with headers
  const { rows } = useMemo(() => {
    if (!isGrouped) {
      const flatRows: VirtualRow[] = tracks.map((track, i) => ({
        type: 'track' as const,
        key: `t-${track.id}-${i}`,
        track,
        trackIndex: i,
      }));
      return { rows: flatRows };
    }

    // Group tracks
    const groups: { label: string; tracks: { track: Track; originalIndex: number }[] }[] = [];
    let currentGroup: typeof groups[0] | null = null;

    tracks.forEach((track, i) => {
      const key = getGroupKey(track, sortBy);
      if (!currentGroup || currentGroup.label !== key) {
        currentGroup = { label: key, tracks: [] };
        groups.push(currentGroup);
      }
      currentGroup.tracks.push({ track, originalIndex: i });
    });

    const virtualRows: VirtualRow[] = [];

    groups.forEach((group, gi) => {
      virtualRows.push({
        type: 'header',
        key: `h-${gi}-${group.label}`,
        label: group.label,
        count: group.tracks.length,
        groupIndex: gi,
      });

      if (!collapsedGroups.has(gi)) {
        group.tracks.forEach(({ track, originalIndex }) => {
          virtualRows.push({
            type: 'track',
            key: `t-${track.id}-${originalIndex}`,
            track,
            trackIndex: originalIndex,
          });
        });
      }
    });

    return { rows: virtualRows };
  }, [tracks, sortBy, isGrouped, collapsedGroups]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (rows[index]?.type === 'header' ? 36 : 44),
    overscan: 20,
  });

  const toggleGroup = (groupIndex: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupIndex)) {
        next.delete(groupIndex);
      } else {
        next.add(groupIndex);
      }
      return next;
    });
  };

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="text-3xl mb-2 opacity-20">♫</div>
        <p className="text-gray-500 text-sm">No tracks in library</p>
        <p className="text-gray-600 text-xs mt-1">Add a folder in Settings</p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];

          if (row.type === 'header') {
            const isCollapsed = collapsedGroups.has(row.groupIndex);
            return (
              <div
                key={row.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${item.start}px)`,
                }}
                className="px-2 py-1.5 bg-cosmic-surface/80 border-b border-cosmic-border/20 cursor-pointer select-none sticky-header flex items-center gap-2 hover:bg-cosmic-hover transition-colors"
                onClick={() => toggleGroup(row.groupIndex)}
              >
                <span className="text-gray-500 text-xs w-4">
                  {isCollapsed ? '▸' : '▾'}
                </span>
                <span className="text-sm font-semibold text-neon-purple truncate">
                  {row.label}
                </span>
                <span className="text-xs text-gray-500 flex-shrink-0">
                  {row.count} {row.count === 1 ? 'track' : 'tracks'}
                </span>
              </div>
            );
          }

          const track = row.track;
          const isActive = currentTrack?.id === track.id && currentTrack?.file_path === track.file_path;
          const sortMetaValue = showSortMeta ? getSortMeta(track, sortBy) : '';

          // In grouped mode, show simpler info (title only, since group header shows artist/album/genre)
          const showSubline = !isGrouped;

          return (
            <div
              key={row.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
              className={`px-2 py-1.5 cursor-pointer border-b border-cosmic-border/10 hover:bg-cosmic-hover transition-colors select-none ${
                isActive ? 'bg-neon-purple/10 border-l-2 border-l-neon-purple' : ''
              } ${isGrouped ? 'pl-8' : ''}`}
              onDoubleClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPlay(track);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ track, x: e.clientX, y: e.clientY });
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate ${isActive ? 'text-neon-purple' : ''}`}>
                    {trackDisplayTitle(track)}
                  </div>
                  {showSubline && (
                    <div className="text-xs text-gray-500 truncate">
                      {trackDisplayArtist(track)}
                      {track.album && ` — ${track.album}`}
                    </div>
                  )}
                </div>
                {sortMetaValue && (
                  <div className="text-xs font-mono text-neon-purple/70 flex-shrink-0 bg-neon-purple/10 rounded px-1.5 py-0.5">
                    {sortMetaValue}
                  </div>
                )}
                <div className="text-xs font-mono text-gray-600 flex-shrink-0">
                  {formatDuration(track.duration_seconds)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {contextMenu && (
        <TrackContextMenu
          track={contextMenu.track}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
