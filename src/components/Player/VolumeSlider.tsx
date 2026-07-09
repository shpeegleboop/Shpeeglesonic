import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { VolumeHighIcon, VolumeLowIcon, VolumeMuteIcon } from '../Icons';

export function VolumeSlider() {
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const player = useAudioPlayer();

  const VolumeIcon =
    isMuted || volume === 0 ? VolumeMuteIcon : volume < 50 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <div className="flex items-center gap-2">
      <button onClick={player.toggleMute} className="btn-ghost" title="Mute (M)">
        <VolumeIcon size={15} />
      </button>
      <input
        type="range"
        min="0"
        max="100"
        value={isMuted ? 0 : volume}
        onChange={(e) => player.setVolume(Number(e.target.value))}
        className="w-28"
      />
      <span className="text-xs font-mono text-gray-500 w-8">{isMuted ? 0 : volume}</span>
    </div>
  );
}
