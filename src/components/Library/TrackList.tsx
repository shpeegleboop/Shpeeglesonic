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
import { MetadataEditModal } from './MetadataEditModal';
import { MusicNoteIcon } from '../Icons';

interface TrackListProps {
  tracks: Track[];
  onPlay: (track: Track) => void;
  sortBy?: string;
  /** Called after metadata edits so the parent can refetch with its current sort/search */
  onLibraryChanged?: () => void;
  emptyTitle?: string;
  emptySubtitle?: string;
  /** Enables drag-to-reorder (playlist views). Only active when ungrouped. */
  onReorder?: (from: number, to: number) => void;
  /** Supplied only in playlist view — adds "Remove from Playlist" to the menu. */
  onRemoveFromPlaylist?: (track: Track) => void;
}

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

type VirtualRow = { type: 'track'; key: string; track: Track; trackIndex: number };

export function TrackList({ tracks, onPlay, sortBy = 'title', onLibraryChanged, emptyTitle, emptySubtitle, onReorder, onRemoveFromPlaylist }: TrackListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  // Grouping moved out to BrowseColumns/GroupList — this is now purely a flat
  // track list, which is what both the leaf column and PlaylistView want.
  const showSortMeta = sortBy !== 'title' && sortBy !== 'date_added' && sortBy !== 'duration';

  const rows = useMemo<VirtualRow[]>(
    () => tracks.map((track, i) => ({ type: 'track', key: `t-${track.id}-${i}`, track, trackIndex: i })),
    [tracks]
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 20,
  });

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 text-center">
        <div className="mb-3 text-gray-600 opacity-40">
          <MusicNoteIcon size={32} />
        </div>
        <p className="text-gray-500 text-sm">{emptyTitle ?? 'No tracks in library'}</p>
        <p className="text-gray-600 text-xs mt-1">{emptySubtitle ?? 'Add a folder in Settings'}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];

            const track = row.track;
            const isActive = currentTrack?.id === track.id && currentTrack?.file_path === track.file_path;
            const sortMetaValue = showSortMeta ? getSortMeta(track, sortBy) : '';
            const canReorder = !!onReorder;

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
                } ${
                  canReorder && dropTarget === row.trackIndex ? 'border-t-2 border-t-neon-purple' : ''
                }`}
                draggable={canReorder}
                onDragStart={
                  canReorder
                    ? (e) => {
                        dragFromRef.current = row.trackIndex;
                        e.dataTransfer.effectAllowed = 'move';
                        // A drag with no payload is refused by some engines
                        e.dataTransfer.setData('text/plain', String(row.trackIndex));
                      }
                    : undefined
                }
                onDragOver={
                  canReorder
                    ? (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dropTarget !== row.trackIndex) setDropTarget(row.trackIndex);
                      }
                    : undefined
                }
                onDrop={
                  canReorder
                    ? (e) => {
                        e.preventDefault();
                        if (dragFromRef.current !== null && dragFromRef.current !== row.trackIndex) {
                          onReorder(dragFromRef.current, row.trackIndex);
                        }
                        dragFromRef.current = null;
                        setDropTarget(null);
                      }
                    : undefined
                }
                onDragEnd={
                  canReorder
                    ? () => {
                        dragFromRef.current = null;
                        setDropTarget(null);
                      }
                    : undefined
                }
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
                    <div className={`text-sm truncate flex items-center gap-1.5 ${isActive ? 'text-neon-purple' : ''}`}>
                      <span className="truncate">{trackDisplayTitle(track)}</span>
                      {track.dup_flag && (
                        <span
                          className="flex-shrink-0 text-[10px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1 leading-tight"
                          title="Possible duplicate — another track looks like the same recording. Edit its metadata to dismiss."
                        >
                          d!?
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {trackDisplayArtist(track)}
                      {track.album && ` — ${track.album}`}
                    </div>
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
      </div>

      {contextMenu && (
        <TrackContextMenu
          track={contextMenu.track}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onEditMetadata={(track) => setEditingTrack(track)}
          onRemoveFromPlaylist={onRemoveFromPlaylist}
        />
      )}

      {editingTrack && (
        <MetadataEditModal
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={() => onLibraryChanged?.()}
        />
      )}

    </div>
  );
}
