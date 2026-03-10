import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';

export function VolumeSlider() {
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const player = useAudioPlayer();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => usePlayerStore.getState().toggleMute()}
        className="btn-ghost text-sm"
        title="Mute (M)"
      >
        {isMuted || volume === 0 ? '🔇' : volume < 30 ? '🔈' : volume < 70 ? '🔉' : '🔊'}
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={isMuted ? 0 : volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        className="w-24"
      />
      <span className="text-xs font-mono text-gray-500 w-8">{isMuted ? 0 : volume}</span>
    </div>
  );
}
