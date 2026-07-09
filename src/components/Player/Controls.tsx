import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { PlayIcon, PauseIcon, PrevIcon, NextIcon, ShuffleIcon, RepeatIcon, RepeatOneIcon } from '../Icons';

export function Controls() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffleEnabled = usePlayerStore((s) => s.shuffleEnabled);
  const repeatMode = usePlayerStore((s) => s.repeatMode);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const player = useAudioPlayer();

  return (
    <div className="flex items-center justify-center gap-4">
      {/* Shuffle */}
      <button
        onClick={() => usePlayerStore.getState().toggleShuffle()}
        className={`btn-ghost relative ${shuffleEnabled ? 'text-neon-purple bg-neon-purple/15' : 'text-gray-500'}`}
        title={`Shuffle (S)${shuffleEnabled ? ' - ON' : ''}`}
      >
        <ShuffleIcon size={16} />
        {shuffleEnabled && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-purple" />}
      </button>

      {/* Previous */}
      <button onClick={player.playPrevTrack} className="btn-ghost" title="Previous (P)">
        <PrevIcon size={20} />
      </button>

      {/* Play/Pause */}
      <button
        onClick={player.togglePlayPause}
        disabled={!currentTrack}
        className="btn-play w-14 h-14"
        title="Play/Pause (Space)"
      >
        {isPlaying ? <PauseIcon size={22} /> : <PlayIcon size={22} className="ml-1" />}
      </button>

      {/* Next */}
      <button onClick={player.playNextTrack} className="btn-ghost" title="Next (N)">
        <NextIcon size={20} />
      </button>

      {/* Repeat */}
      <button
        onClick={() => usePlayerStore.getState().cycleRepeatMode()}
        className={`btn-ghost relative ${repeatMode !== 'off' ? 'text-neon-purple bg-neon-purple/15' : 'text-gray-500'}`}
        title={`Repeat (R) - ${repeatMode.toUpperCase()}`}
      >
        {repeatMode === 'one' ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
        {repeatMode !== 'off' && <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-purple" />}
      </button>
    </div>
  );
}
