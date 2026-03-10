import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration, trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';
import { AlbumArt } from '../Player/AlbumArt';

export function BottomBar() {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const player = useAudioPlayer();

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="h-16 bg-cosmic-surface border-t border-cosmic-border/50 flex items-center px-3 gap-3 select-none">
      {/* Progress bar (full width at top — tall hit area, thin visual bar) */}
      <div
        className="absolute left-0 right-0 h-3 cursor-pointer group flex items-end"
        style={{ position: 'absolute', top: -4, left: 0, right: 0 }}
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          player.seek(pct * duration);
        }}
      >
        <div className="w-full h-0.5 group-hover:h-1 transition-all relative bg-cosmic-border">
          <div
            className="h-full bg-neon-purple absolute top-0 left-0 transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Album art thumbnail */}
      <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0">
        {track ? (
          <AlbumArt track={track} size="sm" />
        ) : (
          <div className="w-full h-full bg-cosmic-panel" />
        )}
      </div>

      {/* Track info */}
      <div className="min-w-0 max-w-[200px] mr-2">
        {track ? (
          <>
            <div className="text-sm font-medium truncate">{trackDisplayTitle(track)}</div>
            <div className="text-xs text-gray-400 truncate">{trackDisplayArtist(track)}</div>
          </>
        ) : (
          <div className="text-sm text-gray-500">No track playing</div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-2">
        <button onClick={player.playPrevTrack} className="btn-ghost text-lg">⏮</button>
        <button
          onClick={player.togglePlayPause}
          className="w-8 h-8 rounded-full bg-neon-purple/20 border border-neon-purple/40 flex items-center justify-center hover:bg-neon-purple/30 transition-all"
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button onClick={player.playNextTrack} className="btn-ghost text-lg">⏭</button>
      </div>

      {/* Time */}
      <div className="text-xs font-mono text-gray-400 w-20 text-center flex-shrink-0">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>

      {/* Volume */}
      <div className="flex items-center gap-1 w-24 flex-shrink-0">
        <button onClick={() => usePlayerStore.getState().toggleMute()} className="btn-ghost text-sm">
          {isMuted || volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          className="flex-1"
        />
      </div>

      {/* Spacer to keep controls away from window edge */}
      <div className="w-2 flex-shrink-0" />
    </div>
  );
}
