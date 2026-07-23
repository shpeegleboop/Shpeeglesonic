import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration, trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';
import { AlbumArt } from '../Player/AlbumArt';
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon,
  MusicNoteIcon,
  QueueIcon,
  WaveIcon,
} from '../Icons';

export function BottomBar() {
  const track = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const queueVisible = usePlayerStore((s) => s.queueVisible);
  const currentView = usePlayerStore((s) => s.currentView);
  const player = useAudioPlayer();

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const VolumeIcon =
    isMuted || volume === 0 ? VolumeMuteIcon : volume < 50 ? VolumeLowIcon : VolumeHighIcon;

  return (
    <div className="h-16 glass-surface border-t border-cosmic-border/50 flex items-center px-3 gap-3 select-none">
      {/* Progress bar (full width at top — tall hit area, thin visual bar) */}
      <div
        className="absolute left-0 right-0 h-3 cursor-pointer group flex items-end z-10"
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
            className="h-full absolute top-0 left-0 transition-none bg-gradient-to-r from-neon-purple to-neon-pink shadow-[0_0_8px_rgba(168,85,247,0.6)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Album art thumbnail — click to magnify */}
      <div
        data-testid="bottombar-art"
        className={`w-10 h-10 rounded-md overflow-hidden flex-shrink-0 ring-1 ring-white/10 ${track ? 'cursor-zoom-in' : ''}`}
        onClick={() => track && usePlayerStore.getState().setArtZoomVisible(true)}
        title={track ? 'View album art' : undefined}
      >
        {track ? (
          <AlbumArt track={track} size="sm" />
        ) : (
          <div className="w-full h-full bg-cosmic-panel flex items-center justify-center text-cosmic-border">
            <MusicNoteIcon size={16} />
          </div>
        )}
      </div>

      {/* Track info — click opens Now Playing */}
      <div
        data-testid="bottombar-trackinfo"
        className={`min-w-0 flex-1 mr-2 ${track ? 'cursor-pointer group/info' : ''}`}
        onClick={() => track && usePlayerStore.getState().setCurrentView('nowPlaying')}
        title={track ? 'Open Now Playing' : undefined}
      >
        {track ? (
          <>
            <div className="text-sm font-medium truncate group-hover/info:text-neon-purple transition-colors">{trackDisplayTitle(track)}</div>
            <div className="text-xs text-gray-400 truncate">{trackDisplayArtist(track)}</div>
          </>
        ) : (
          <div className="text-sm text-gray-500 truncate">No track playing</div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button onClick={player.playPrevTrack} className="btn-ghost" title="Previous (P)">
          <PrevIcon size={16} />
        </button>
        <button
          onClick={player.togglePlayPause}
          className="btn-play w-9 h-9"
          title="Play/Pause (Space)"
        >
          {isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} className="ml-0.5" />}
        </button>
        <button onClick={player.playNextTrack} className="btn-ghost" title="Next (N)">
          <NextIcon size={16} />
        </button>
      </div>

      {/* Time */}
      <div className="text-xs font-mono text-gray-400 w-24 text-center flex-shrink-0">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>

      {/* Volume */}
      <div className="flex items-center gap-1 w-28 flex-shrink-0">
        <button onClick={player.toggleMute} className="btn-ghost" title="Mute (M)">
          <VolumeIcon size={15} />
        </button>
        <input
          type="range"
          min="0"
          max="100"
          value={isMuted ? 0 : volume}
          onChange={(e) => player.setVolume(Number(e.target.value))}
          className="flex-1 min-w-0"
        />
      </div>

      {/* Visualizer + queue toggles */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() =>
            usePlayerStore.getState().setCurrentView(currentView === 'visualizer' ? 'nowPlaying' : 'visualizer')
          }
          className={`btn-ghost ${currentView === 'visualizer' ? 'text-neon-purple bg-neon-purple/15' : ''}`}
          title="Visualizer"
        >
          <WaveIcon size={15} />
        </button>
        <button
          onClick={() => usePlayerStore.getState().setQueueVisible(!queueVisible)}
          className={`btn-ghost ${queueVisible ? 'text-neon-purple bg-neon-purple/15' : ''}`}
          title="Queue (Q)"
        >
          <QueueIcon size={15} />
        </button>
      </div>

      {/* Spacer to keep controls away from window edge */}
      <div className="w-2 flex-shrink-0" />
    </div>
  );
}
