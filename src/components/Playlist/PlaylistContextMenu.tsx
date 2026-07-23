import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { type Track, usePlayerStore } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';

interface PlaylistContextMenuProps {
  playlist: Playlist;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/** Right-click menu for a playlist in the sidebar. */
export function PlaylistContextMenu({ playlist: pl, x, y, onClose, onRename, onDelete }: PlaylistContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showCopySub, setShowCopySub] = useState(false);
  const subCloseTimer = useRef<number | null>(null);
  const [working, setWorking] = useState(false);
  const playlists = usePlaylist();

  useEffect(() => {
    playlists.fetchPlaylists();
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      if (subCloseTimer.current !== null) clearTimeout(subCloseTimer.current);
    };
  }, [onClose]);

  const openSub = () => {
    if (subCloseTimer.current !== null) {
      clearTimeout(subCloseTimer.current);
      subCloseTimer.current = null;
    }
    setShowCopySub(true);
  };

  const scheduleCloseSub = () => {
    if (subCloseTimer.current !== null) clearTimeout(subCloseTimer.current);
    subCloseTimer.current = window.setTimeout(() => setShowCopySub(false), 150);
  };

  const fetchTracks = () => invoke<Track[]>('get_playlist_tracks', { playlistId: pl.id });

  const addAllToQueue = async () => {
    setWorking(true);
    try {
      const tracks = await fetchTracks();
      const store = usePlayerStore.getState();
      tracks.forEach((t) => store.addToQueue(t));
    } catch (e) {
      console.error('Failed to queue playlist:', e);
    }
    setWorking(false);
    onClose();
  };

  const copyToPlaylist = async (target: Playlist) => {
    setWorking(true);
    try {
      const tracks = await fetchTracks();
      for (const t of tracks) {
        await invoke('add_track_to_playlist', { playlistId: target.id, trackId: t.id });
      }
      await playlists.fetchPlaylists();
    } catch (e) {
      console.error('Failed to copy playlist:', e);
    }
    setWorking(false);
    onClose();
  };

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 200),
    zIndex: 9999,
  };

  const itemClass = 'px-3 py-1.5 text-sm hover:bg-neon-purple/20 cursor-pointer transition-colors text-gray-200 hover:text-white';
  const others = playlists.playlists.filter((p) => p.id !== pl.id);

  return createPortal(
    <div ref={menuRef} style={style} className="bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[200px] backdrop-blur-xl">
      <div className="px-3 py-1 text-[11px] text-gray-500 truncate border-b border-cosmic-border/30 mb-1">
        {pl.name} · {pl.track_count} {pl.track_count === 1 ? 'track' : 'tracks'}
      </div>

      <div className={itemClass} onClick={addAllToQueue}>
        {working ? 'Working…' : 'Add to Queue'}
      </div>

      <div className={`${itemClass} relative ${others.length === 0 ? 'opacity-40 cursor-default' : ''}`}
        onMouseEnter={others.length > 0 ? openSub : undefined}
        onMouseLeave={others.length > 0 ? scheduleCloseSub : undefined}
      >
        <div className="flex items-center justify-between">
          <span>Add to another Playlist</span>
          <span className="text-gray-500 text-xs ml-2">&rsaquo;</span>
        </div>

        {showCopySub && (
          <div className={`absolute top-0 bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[180px] ${
            x > window.innerWidth - 420 ? 'right-full mr-1' : 'left-full ml-1'
          }`}>
            {others.map((p) => (
              <div
                key={p.id}
                className={itemClass}
                onClick={(e) => {
                  e.stopPropagation();
                  copyToPlaylist(p);
                }}
              >
                {p.name}
                <span className="text-gray-500 text-xs ml-1">({p.track_count})</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-cosmic-border/30 my-1" />

      <div
        className={itemClass}
        onClick={() => {
          onClose();
          onRename();
        }}
      >
        Rename…
      </div>
      <div
        className={`${itemClass} !text-red-300 hover:!bg-red-500/20`}
        onClick={() => {
          onClose();
          onDelete();
        }}
      >
        Delete…
      </div>
    </div>,
    document.body
  );
}
