import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';

export function Controls() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleEnabled = usePlayerStore((s) => s.shuffleEnabled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const player = useAudioPlayer();

  return (
    <div className="flex items-center justify-center gap-3">
      {/* Shuffle */}
      <button
        onClick={() => usePlayerStore.getState().toggleShuffle()}
        className={`btn-ghost text-sm relative ${shuffleEnabled ? 'text-neon-purple bg-neon-purple/15 rounded-md' : 'opacity-50'}`}
        title={`Shuffle (S)${shuffleEnabled ? ' - ON' : ''}`}
      >
        🔀
        {shuffleEnabled && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-purple" />}
      </button>

      {/* Previous */}
      <button onClick={player.playPrevTrack} className="btn-ghost text-xl" title="Previous (P)">
        ⏮
      </button>

      {/* Play/Pause */}
      <button
        onClick={player.togglePlayPause}
        disabled={!currentTrack}
        className="w-12 h-12 rounded-full bg-neon-purple/20 border-2 border-neon-purple/50 flex items-center justify-center hover:bg-neon-purple/30 hover:border-neon-purple/70 transition-all text-xl disabled:opacity-30"
        title="Play/Pause (Space)"
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Next */}
      <button onClick={player.playNextTrack} className="btn-ghost text-xl" title="Next (N)">
        ⏭
      </button>

      {/* Repeat */}
      <button
        onClick={() => usePlayerStore.getState().cycleRepeatMode()}
        className={`btn-ghost text-sm relative ${repeatMode !== 'off' ? 'text-neon-purple bg-neon-purple/15 rounded-md' : 'opacity-50'}`}
        title={`Repeat (R) - ${repeatMode.toUpperCase()}`}
      >
        {repeatMode === 'one' ? '🔂' : '🔁'}
        {repeatMode !== 'off' && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-purple" />}
      </button>
    </div>
  );
}
