import { useEffect, useRef, useState } from 'react';
import { type Track, usePlayerStore } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { invoke } from '@tauri-apps/api/core';

interface TrackContextMenuProps {
  track: Track;
  x: number;
  y: number;
  onClose: () => void;
}

export function TrackContextMenu({ track, x, y, onClose }: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showPlaylistSub, setShowPlaylistSub] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const playlist = usePlaylist();
  const player = useAudioPlayer();

  useEffect(() => {
    playlist.fetchPlaylists();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 280),
    zIndex: 9999,
  };

  const handlePlay = () => {
    player.playTrack(track);
    onClose();
  };

  const handlePlayNext = () => {
    usePlayerStore.getState().playNext(track);
    onClose();
  };

  const handleAddToQueue = () => {
    usePlayerStore.getState().addToQueue(track);
    onClose();
  };

  const handleToggleFavorite = async () => {
    try {
      await invoke('toggle_favorite', { trackId: track.id });
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
    onClose();
  };

  const handleAddToPlaylist = async (pl: Playlist) => {
    await playlist.addTrackToPlaylist(pl.id, track.id);
    onClose();
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) return;
    setCreatingPlaylist(true);
    try {
      const id = await invoke<number>('create_playlist', { name: newPlaylistName.trim() });
      await invoke('add_track_to_playlist', { playlistId: id, trackId: track.id });
      await playlist.fetchPlaylists();
    } catch (e) {
      console.error('Failed to create playlist:', e);
    }
    setCreatingPlaylist(false);
    onClose();
  };

  const menuItemClass = 'px-3 py-1.5 text-sm hover:bg-neon-purple/20 cursor-pointer transition-colors text-gray-200 hover:text-white';

  return (
    <div ref={menuRef} style={style} className="bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[200px] backdrop-blur-xl">
      <div className={menuItemClass} onClick={handlePlay}>
        Play
      </div>
      <div className={menuItemClass} onClick={handlePlayNext}>
        Play Next
      </div>
      <div className={menuItemClass} onClick={handleAddToQueue}>
        Add to Queue
      </div>

      <div className="h-px bg-cosmic-border/30 my-1" />

      <div
        className={`${menuItemClass} relative`}
        onMouseEnter={() => setShowPlaylistSub(true)}
        onMouseLeave={() => setShowPlaylistSub(false)}
      >
        <div className="flex items-center justify-between">
          <span>Add to Playlist</span>
          <span className="text-gray-500 text-xs ml-2">&rsaquo;</span>
        </div>

        {showPlaylistSub && (
          <div className="absolute left-full top-0 ml-1 bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[180px]">
            {playlist.playlists.map((pl) => (
              <div
                key={pl.id}
                className={menuItemClass}
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddToPlaylist(pl);
                }}
              >
                {pl.name}
                <span className="text-gray-500 text-xs ml-1">({pl.track_count})</span>
              </div>
            ))}
            {playlist.playlists.length > 0 && <div className="h-px bg-cosmic-border/30 my-1" />}
            <div className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                placeholder="New playlist..."
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateAndAdd();
                  e.stopPropagation();
                }}
                disabled={creatingPlaylist}
                className="w-full bg-black/30 border border-cosmic-border/50 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-purple/50"
                autoFocus
              />
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-cosmic-border/30 my-1" />

      <div className={menuItemClass} onClick={handleToggleFavorite}>
        {track.favorited ? 'Unfavorite' : 'Favorite'}
      </div>
    </div>
  );
}
