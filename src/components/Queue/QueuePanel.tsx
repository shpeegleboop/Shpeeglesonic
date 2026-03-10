import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration, trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';

export function QueuePanel() {
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const player = useAudioPlayer();

  const upcoming = queue.slice(queueIndex + 1);

  if (queue.length === 0) return null;

  return (
    <div className="glass-panel mt-4 max-w-md w-full">
      <div className="px-3 py-2 border-b border-cosmic-border/30 flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">
          Up Next ({upcoming.length})
        </span>
        <button
          onClick={() => usePlayerStore.getState().clearQueue()}
          className="text-xs text-gray-500 hover:text-neon-red"
        >
          Clear
        </button>
      </div>

      <div className="max-h-48 overflow-auto">
        {upcoming.slice(0, 20).map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            className="px-3 py-1.5 hover:bg-cosmic-hover cursor-pointer flex items-center gap-2 text-sm"
            onDoubleClick={() => {
              usePlayerStore.getState().setQueueIndex(queueIndex + 1 + i);
              player.playTrack(track);
            }}
          >
            <span className="text-xs text-gray-600 w-4">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="truncate text-gray-300">{trackDisplayTitle(track)}</div>
              <div className="truncate text-xs text-gray-500">{trackDisplayArtist(track)}</div>
            </div>
            <span className="text-xs text-gray-600 font-mono">
              {formatDuration(track.duration_seconds)}
            </span>
          </div>
        ))}
        {upcoming.length > 20 && (
          <div className="px-3 py-1.5 text-xs text-gray-600 text-center">
            +{upcoming.length - 20} more
          </div>
        )}
      </div>
    </div>
  );
}
