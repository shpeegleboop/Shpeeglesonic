import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylist } from '../../hooks/usePlaylist';
import { useLibrary } from '../../hooks/useLibrary';
import { trackDisplayTitle, trackDisplayArtist } from '../../utils/formatters';
import { AlbumArt } from './AlbumArt';
import { Controls } from './Controls';
import { ProgressBar } from './ProgressBar';
import { VolumeSlider } from './VolumeSlider';
import { FormatBadge } from './FormatBadge';
import { VisualizerContainer } from '../Visualizer/VisualizerContainer';
import { open } from '@tauri-apps/plugin-dialog';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { MusicNoteIcon, FolderIcon, HeartIcon, HeartFilledIcon, PlusIcon, LyricsIcon } from '../Icons';

export function NowPlaying() {
  const track = usePlayerStore((s) => s.currentTrack);
  const trackInfo = usePlayerStore((s) => s.trackInfo);
  const isLoading = usePlayerStore((s) => s.isLoading);
  const lyricsVisible = usePlayerStore((s) => s.lyricsVisible);
  const player = useAudioPlayer();
  const playlist = usePlaylist();
  const library = useLibrary();
  const [showPlaylists, setShowPlaylists] = useState(false);
  const playlistPopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPlaylists) return;
    playlist.fetchPlaylists();
    const onDown = (e: MouseEvent) => {
      if (playlistPopRef.current && !playlistPopRef.current.contains(e.target as Node)) {
        setShowPlaylists(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showPlaylists]);

  const toggleFavorite = async () => {
    if (!track || track.id <= 0) return;
    try {
      const favorited = await invoke<boolean>('toggle_favorite', { trackId: track.id });
      usePlayerStore.getState().setCurrentTrack({ ...track, favorited });
      library.fetchTracks(); // keep the Favorites view/count in sync
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  };

  if (!track) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-neon-purple/15 to-neon-blue/10 border border-cosmic-border/40 flex items-center justify-center text-neon-purple/50 shadow-[0_0_40px_rgba(168,85,247,0.1)]">
          <MusicNoteIcon size={40} />
        </div>
        <div className="text-gray-500 text-center">
          <p className="text-lg mb-2 text-gray-400">No track playing</p>
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
          className="btn-primary flex items-center gap-2"
        >
          <FolderIcon size={14} />
          Open File
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 overflow-auto">
      {/* Visualizer (inline) — fills everything above the album art */}
      <div className="w-full flex-1 min-h-48 mb-2 relative">
        <VisualizerContainer inline />
      </div>

      {/* Album Art — click to magnify */}
      <div
        data-testid="nowplaying-art"
        className="cursor-zoom-in"
        onClick={() => usePlayerStore.getState().setArtZoomVisible(true)}
        title="View album art"
      >
        <AlbumArt track={track} size="lg" />
      </div>

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

      {/* Track actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleFavorite}
          className={`btn-ghost ${track.favorited ? 'text-neon-pink' : 'text-gray-400 hover:text-neon-pink'}`}
          title={track.favorited ? 'Unfavorite' : 'Favorite'}
        >
          {track.favorited ? <HeartFilledIcon size={18} /> : <HeartIcon size={18} />}
        </button>

        <div className="relative" ref={playlistPopRef}>
          <button
            onClick={() => setShowPlaylists((v) => !v)}
            className={`btn-ghost flex items-center gap-1 text-gray-400 hover:text-white ${showPlaylists ? 'text-neon-purple bg-neon-purple/15' : ''}`}
            title="Add to playlist"
          >
            <PlusIcon size={16} />
            <span className="text-xs">Playlist</span>
          </button>

          {showPlaylists && (
            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[180px] max-h-64 overflow-y-auto backdrop-blur-xl z-50">
              {playlist.playlists.length === 0 && (
                <div className="px-3 py-1.5 text-xs text-gray-500">No playlists yet</div>
              )}
              {playlist.playlists.map((pl) => (
                <div
                  key={pl.id}
                  className="px-3 py-1.5 text-sm hover:bg-neon-purple/20 cursor-pointer transition-colors text-gray-200 hover:text-white"
                  onClick={async () => {
                    await playlist.addTrackToPlaylist(pl.id, track.id);
                    setShowPlaylists(false);
                  }}
                >
                  {pl.name}
                  <span className="text-gray-500 text-xs ml-1">({pl.track_count})</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => usePlayerStore.getState().setLyricsVisible(!lyricsVisible)}
          className={`btn-ghost flex items-center gap-1 ${
            lyricsVisible ? 'text-neon-purple bg-neon-purple/15' : 'text-gray-400 hover:text-white'
          }`}
          title="Lyrics (L)"
        >
          <LyricsIcon size={16} />
          <span className="text-xs">Lyrics</span>
        </button>
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
