import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylist } from '../../hooks/usePlaylist';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { TrackList } from '../Library/TrackList';

interface PlaylistViewProps {
  playlistId: number;
}

export function PlaylistView({ playlistId }: PlaylistViewProps) {
  const { playlistTracks, fetchPlaylistTracks } = usePlaylist();
  const player = useAudioPlayer();

  useEffect(() => {
    fetchPlaylistTracks(playlistId);
  }, [playlistId]);

  return (
    <div className="flex-1 overflow-hidden">
      <TrackList
        tracks={playlistTracks}
        onPlay={(track) => {
          const idx = playlistTracks.findIndex((t) => t.id === track.id);
          usePlayerStore.getState().setQueue(playlistTracks, idx);
          player.playTrack(track);
        }}
      />
    </div>
  );
}
