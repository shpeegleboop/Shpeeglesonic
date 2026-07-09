import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration, trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';
import { QueueIcon, CloseIcon, TrashIcon, PlayIcon, PauseIcon } from '../Icons';

export function QueueSidebar() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const queueVisible = usePlayerStore((s) => s.queueVisible);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const player = useAudioPlayer();
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 46,
    overscan: 12,
  });

  // Keep the playing track in view as the queue advances
  useEffect(() => {
    if (queueIndex >= 0 && queueIndex < queue.length) {
      virtualizer.scrollToIndex(queueIndex, { align: 'auto' });
    }
  }, [queueIndex]);

  if (!queueVisible) return null;

  const remaining = queue
    .slice(queueIndex + 1)
    .reduce((sum, t) => sum + (t.duration_seconds ?? 0), 0);

  return (
    <aside className="w-64 flex flex-col glass-surface border-l border-cosmic-border/50 overflow-hidden flex-shrink-0 select-none">
      <div className="px-3 py-2 border-b border-cosmic-border/30 flex items-center gap-2 flex-shrink-0">
        <span className="text-neon-purple">
          <QueueIcon size={13} />
        </span>
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex-1">
          Queue
        </span>
        {queue.length > 0 && (
          <button
            onClick={() => usePlayerStore.getState().clearQueue()}
            className="text-gray-500 hover:text-red-400 p-0.5 rounded hover:bg-white/5 transition-colors"
            title="Clear queue"
          >
            <TrashIcon size={12} />
          </button>
        )}
        <button
          onClick={() => usePlayerStore.getState().setQueueVisible(false)}
          className="text-gray-500 hover:text-white p-0.5 rounded hover:bg-white/5 transition-colors"
          title="Hide queue (Q)"
        >
          <CloseIcon size={12} />
        </button>
      </div>

      {queue.length > 0 && (
        <div className="px-3 py-1 border-b border-cosmic-border/20 flex items-center justify-between text-[11px] text-gray-500 flex-shrink-0">
          <span>
            {queueIndex >= 0 ? `${queueIndex + 1} of ${queue.length}` : `${queue.length} tracks`}
          </span>
          {remaining > 0 && <span className="font-mono">{formatDuration(remaining)} left</span>}
        </div>
      )}

      {queue.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center gap-2">
          <div className="text-gray-600 opacity-40">
            <QueueIcon size={28} />
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            Queue is empty.
            <br />
            Double-click a track to fill it.
          </p>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const track = queue[item.index];
              const isCurrent = item.index === queueIndex;
              const isPast = item.index < queueIndex;

              return (
                <div
                  key={`${track.id}-${item.index}`}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                  className={`group px-2 py-1.5 cursor-pointer border-b border-cosmic-border/10 hover:bg-cosmic-hover transition-colors flex items-center gap-2 ${
                    isCurrent ? 'bg-neon-purple/10 border-l-2 border-l-neon-purple' : ''
                  } ${isPast ? 'opacity-50' : ''}`}
                  onDoubleClick={() => {
                    usePlayerStore.getState().setQueueIndex(item.index);
                    player.playTrack(track);
                  }}
                  title="Double-click to play"
                >
                  <span
                    className={`w-5 flex items-center justify-end flex-shrink-0 text-[11px] font-mono ${
                      isCurrent ? 'text-neon-purple' : 'text-gray-600'
                    }`}
                  >
                    {isCurrent ? (
                      isPlaying ? <PauseIcon size={10} /> : <PlayIcon size={10} />
                    ) : (
                      item.index + 1
                    )}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-xs truncate ${
                        isCurrent ? 'text-neon-purple font-medium' : 'text-gray-300'
                      }`}
                    >
                      {trackDisplayTitle(track)}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {trackDisplayArtist(track)}
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-gray-600 flex-shrink-0 group-hover:hidden">
                    {formatDuration(track.duration_seconds)}
                  </span>
                  <button
                    className="hidden group-hover:block text-gray-500 hover:text-red-400 flex-shrink-0 p-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      usePlayerStore.getState().removeFromQueue(item.index);
                    }}
                    title="Remove from queue"
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
