import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { type Track, usePlayerStore } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';

interface GroupContextMenuProps {
  /** Display label of the group (artist/album/genre/year/format value) */
  label: string;
  tracks: Track[];
  /** Rename only applies to real tag fields (artist/album/genre) */
  canRename: boolean;
  renameLabel: string;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
}

/** Right-click menu for library group headers — acts on all tracks in the group. */
export function GroupContextMenu({ label, tracks, canRename, renameLabel, x, y, onClose, onRename }: GroupContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [showPlaylistSub, setShowPlaylistSub] = useState(false);
  const subCloseTimer = useRef<number | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [working, setWorking] = useState(false);
  const playlist = usePlaylist();

  useEffect(() => {
    playlist.fetchPlaylists();
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
    setShowPlaylistSub(true);
  };

  const scheduleCloseSub = () => {
    if (subCloseTimer.current !== null) clearTimeout(subCloseTimer.current);
    subCloseTimer.current = window.setTimeout(() => setShowPlaylistSub(false), 150);
  };

  const addAllToQueue = () => {
    const store = usePlayerStore.getState();
    tracks.forEach((t) => store.addToQueue(t));
    onClose();
  };

  const addAllToPlaylist = async (pl: Playlist) => {
    setWorking(true);
    for (const t of tracks) {
      await playlist.addTrackToPlaylist(pl.id, t.id);
    }
    setWorking(false);
    onClose();
  };

  const createAndAddAll = async () => {
    if (!newPlaylistName.trim()) return;
    setWorking(true);
    try {
      const id = await invoke<number>('create_playlist', { name: newPlaylistName.trim() });
      for (const t of tracks) {
        await invoke('add_track_to_playlist', { playlistId: id, trackId: t.id });
      }
      await playlist.fetchPlaylists();
    } catch (e) {
      console.error('Failed to create playlist:', e);
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

  return createPortal(
    <div ref={menuRef} style={style} className="bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[200px] backdrop-blur-xl">
      <div className="px-3 py-1 text-[11px] text-gray-500 truncate border-b border-cosmic-border/30 mb-1">
        {label} · {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
      </div>

      <div className={itemClass} onClick={addAllToQueue}>
        Add to Queue
      </div>

      <div className={`${itemClass} relative`} onMouseEnter={openSub} onMouseLeave={scheduleCloseSub}>
        <div className="flex items-center justify-between">
          <span>{working ? 'Adding…' : 'Add to Playlist'}</span>
          <span className="text-gray-500 text-xs ml-2">&rsaquo;</span>
        </div>

        {showPlaylistSub && (
          <div className={`absolute top-0 bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 min-w-[180px] ${
            x > window.innerWidth - 420 ? 'right-full mr-1' : 'left-full ml-1'
          }`}>
            {playlist.playlists.map((pl) => (
              <div
                key={pl.id}
                className={itemClass}
                onClick={(e) => {
                  e.stopPropagation();
                  addAllToPlaylist(pl);
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
                  if (e.key === 'Enter') createAndAddAll();
                  e.stopPropagation();
                }}
                disabled={working}
                className="w-full bg-black/30 border border-cosmic-border/50 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-purple/50"
                autoFocus
              />
            </div>
          </div>
        )}
      </div>

      {canRename && (
        <>
          <div className="h-px bg-cosmic-border/30 my-1" />
          <div
            className={itemClass}
            onClick={() => {
              onClose();
              onRename();
            }}
          >
            Rename {renameLabel}…
          </div>
        </>
      )}
    </div>,
    document.body
  );
}
