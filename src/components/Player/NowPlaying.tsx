import { usePlayerStore } from '../../stores/playerStore';
import { trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';
import { AlbumArt } from './AlbumArt';
import { Controls } from './Controls';
import { ProgressBar } from './ProgressBar';
import { VolumeSlider } from './VolumeSlider';
import { FormatBadge } from './FormatBadge';
import { VisualizerContainer } from '../Visualizer/VisualizerContainer';
import { open } from '@tauri-apps/plugin-dialog';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';

export function NowPlaying() {
  const track = usePlayerStore((s) => s.currentTrack);
  const trackInfo = usePlayerStore((s) => s.trackInfo);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const player = useAudioPlayer();

  if (!track) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        <div className="text-6xl opacity-20">♫</div>
        <div className="text-gray-500 text-center">
          <p className="text-lg mb-2">No track playing</p>
          <p className="text-sm">Select a track from the library or open a file</p>
        </div>
        <button
          onClick={async () => {
            const result = await open({
              multiple: false,
              filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'aiff', 'aif', 'ogg', 'm4a', 'aac'] }],
            });
            if (result) {
              player.playFile(result as string);
            }
          }}
          className="btn-primary"
        >
          Open File
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 overflow-auto">
      {/* Visualizer (inline) */}
      <div className="w-full max-w-lg h-48 rounded-lg overflow-hidden mb-2">
        <VisualizerContainer inline />
      </div>

      {/* Album Art */}
      <AlbumArt track={track} size="lg" />

      {/* Track Info */}
      <div className="text-center max-w-md">
        <h2 className="text-xl font-semibold truncate">{trackDisplayTitle(track)}</h2>
        <p className="text-gray-400 truncate">
          {trackDisplayArtist(track)}
          {track.album && <span> — {track.album}</span>}
        </p>
        {isLoading && (
          <p className="text-neon-cyan text-xs mt-1 animate-pulse">Loading...</p>
        )}
      </div>

      {/* Format badges */}
      <FormatBadge
        format={track.format || trackInfo?.format}
        sampleRate={track.sample_rate || trackInfo?.sample_rate}
        bitDepth={track.bit_depth || trackInfo?.bit_depth}
        bitrate={track.bitrate || trackInfo?.bitrate}
      />

      {/* Progress */}
      <div className="w-full max-w-md">
        <ProgressBar />
      </div>

      {/* Controls */}
      <Controls />

      {/* Volume */}
      <VolumeSlider />
    </div>
  );
}
