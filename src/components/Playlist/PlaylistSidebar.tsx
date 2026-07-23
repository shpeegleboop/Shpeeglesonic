import { useEffect, useRef, useState } from 'react';
import { usePlayerStore, FAVORITES_PLAYLIST_ID } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';
import { useLibrary } from '../../hooks/useLibrary';
import { PlusIcon, TrashIcon, HeartFilledIcon } from '../Icons';
import { ConfirmDialog } from '../ConfirmDialog';
import { PlaylistContextMenu } from './PlaylistContextMenu';

export function PlaylistSidebar() {
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId);
  const { playlists, fetchPlaylists, createPlaylist, renamePlaylist, reorderPlaylists, deletePlaylist } = usePlaylist();
  const { tracks } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<{ pl: Playlist; x: number; y: number } | null>(null);
  const dragFromRef = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName.trim());
    setNewName('');
    setCreating(false);
  };

  const confirmDelete = async (pl: Playlist) => {
    await deletePlaylist(pl.id);
    if (selectedPlaylistId === pl.id) {
      setSelectedPlaylistId(null);
    }
    setDeleting(null);
  };

  return (
    <div className="w-48 flex flex-col bg-cosmic-bg/50 border-r border-cosmic-border/30 overflow-hidden flex-shrink-0">
      <div className="px-3 py-2 border-b border-cosmic-border/30 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Playlists</span>
        <button
          onClick={() => setCreating(true)}
          className="text-neon-purple hover:text-white transition-colors p-0.5 rounded hover:bg-white/5"
          title="New Playlist"
        >
          <PlusIcon size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {/* All Tracks */}
        <div
          className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
            selectedPlaylistId === null
              ? 'bg-neon-purple/15 text-neon-purple border-l-2 border-l-neon-purple'
              : 'text-gray-300 hover:bg-cosmic-hover hover:text-white'
          }`}
          onClick={() => setSelectedPlaylistId(null)}
        >
          <div>All Tracks</div>
          <div className="text-xs text-gray-500">
            {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
          </div>
        </div>

        {/* Favorites (built-in) */}
        <div
          className={`px-3 py-2 cursor-pointer text-sm transition-colors ${
            selectedPlaylistId === FAVORITES_PLAYLIST_ID
              ? 'bg-neon-purple/15 text-neon-purple border-l-2 border-l-neon-purple'
              : 'text-gray-300 hover:bg-cosmic-hover hover:text-white'
          }`}
          onClick={() => setSelectedPlaylistId(FAVORITES_PLAYLIST_ID)}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-neon-pink">
              <HeartFilledIcon size={11} />
            </span>
            Favorites
          </div>
          <div className="text-xs text-gray-500">
            {tracks.filter((t) => t.favorited).length} {tracks.filter((t) => t.favorited).length === 1 ? 'track' : 'tracks'}
          </div>
        </div>

        {/* Playlists */}
        {playlists.map((pl, pi) =>
          renaming?.id === pl.id ? (
            <div key={pl.id} className="px-3 py-2">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && renameValue.trim()) {
                    await renamePlaylist(pl.id, renameValue.trim());
                    setRenaming(null);
                  }
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => setRenaming(null)}
                className="w-full bg-black/30 border border-neon-purple/30 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-neon-purple/60"
                autoFocus
              />
            </div>
          ) : (
          <div
            key={pl.id}
            className={`group px-3 py-2 cursor-pointer text-sm transition-colors flex items-center justify-between ${
              selectedPlaylistId === pl.id
                ? 'bg-neon-purple/15 text-neon-purple border-l-2 border-l-neon-purple'
                : 'text-gray-300 hover:bg-cosmic-hover hover:text-white'
            }`}
            onClick={() => setSelectedPlaylistId(pl.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ pl, x: e.clientX, y: e.clientY });
            }}
            draggable
            onDragStart={(e) => {
              dragFromRef.current = pi;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(pi));
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dropTarget !== pi) setDropTarget(pi);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFromRef.current !== null && dragFromRef.current !== pi) {
                reorderPlaylists(dragFromRef.current, pi);
              }
              dragFromRef.current = null;
              setDropTarget(null);
            }}
            onDragEnd={() => {
              dragFromRef.current = null;
              setDropTarget(null);
            }}
            style={dropTarget === pi ? { boxShadow: 'inset 0 2px 0 0 rgb(168 85 247)' } : undefined}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate">{pl.name}</div>
              <div className="text-xs text-gray-500">{pl.track_count} tracks</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleting(pl);
              }}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity ml-1 p-0.5"
              title="Delete playlist"
            >
              <TrashIcon size={12} />
            </button>
          </div>
          )
        )}

        {/* Create new playlist inline */}
        {creating && (
          <div className="px-3 py-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') {
                  setCreating(false);
                  setNewName('');
                }
              }}
              onBlur={() => {
                if (!newName.trim()) {
                  setCreating(false);
                  setNewName('');
                }
              }}
              placeholder="Playlist name..."
              className="w-full bg-black/30 border border-neon-purple/30 rounded px-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-neon-purple/60"
              autoFocus
            />
          </div>
        )}
      </div>

      {menu && (
        <PlaylistContextMenu
          playlist={menu.pl}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenameValue(menu.pl.name);
            setRenaming(menu.pl);
          }}
          onDelete={() => setDeleting(menu.pl)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message={`The playlist and its ${deleting.track_count} track reference${deleting.track_count === 1 ? '' : 's'} will be removed. Your music files stay in the library.`}
          confirmLabel="Delete"
          onConfirm={() => confirmDelete(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
