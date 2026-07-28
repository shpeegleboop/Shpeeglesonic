import { useEffect, useRef, useState } from 'react';
import { usePlayerStore, FAVORITES_PLAYLIST_ID } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';
import { useLibrary } from '../../hooks/useLibrary';
import { invoke } from '@tauri-apps/api/core';
import { isTrackDrag, startTrackDrag } from '../../utils/trackDrag';
import { tracksForDrop } from '../../utils/dropTracks';
import { PlusIcon, TrashIcon, HeartFilledIcon } from '../Icons';
import { ConfirmDialog } from '../ConfirmDialog';
import { PlaylistContextMenu } from './PlaylistContextMenu';

export function PlaylistSidebar() {
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId);
  const { playlists, fetchPlaylists, createPlaylist, renamePlaylist, reorderPlaylists, deletePlaylist, addTrackToPlaylist } = usePlaylist();
  const { tracks, fetchTracks } = useLibrary();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Playlist | null>(null);
  const [renaming, setRenaming] = useState<Playlist | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menu, setMenu] = useState<{ pl: Playlist; x: number; y: number } | null>(null);
  const dragFromRef = useRef<number | null>(null);
  // Enter and Escape both unmount the input, which fires blur on the way out.
  // Without this flag the blur handler would save a second time after Enter, or
  // resurrect an edit the user just cancelled with Escape. Reset on focus so
  // each edit starts clean.
  const editHandledRef = useRef(false);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  // Highlights the row a track drag is hovering. Separate from dropTarget,
  // which belongs to playlist reordering and is an index into `playlists`.
  const [trackDropTarget, setTrackDropTarget] = useState<number | null>(null);

  const dropOnPlaylist = async (e: React.DragEvent, playlistId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackDropTarget(null);
    const dropped = await tracksForDrop(e.dataTransfer);
    // Sequential: add_track_to_playlist appends at MAX(position)+1, so
    // concurrent calls would race for the same position.
    for (const t of dropped) {
      try {
        await addTrackToPlaylist(playlistId, t.id);
      } catch (err) {
        // A partial add beats dropping the good tracks too.
        console.error('Failed to add track to playlist:', err);
      }
    }
    await fetchPlaylists();
  };

  const dropOnFavorites = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTrackDropTarget(null);
    // toggle_favorite is the only command, so a blanket toggle would
    // UNfavorite the tracks in a dropped album that were already favorited.
    const toAdd = (await tracksForDrop(e.dataTransfer)).filter((t) => !t.favorited);
    for (const t of toAdd) {
      try {
        await invoke('toggle_favorite', { trackId: t.id });
      } catch (err) {
        console.error('Failed to favorite track:', err);
      }
    }
    // Favorites is a virtual playlist filtered client-side; without this the
    // view does not update.
    await fetchTracks();
  };

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
          } ${trackDropTarget === FAVORITES_PLAYLIST_ID ? 'ring-1 ring-neon-purple bg-neon-purple/10' : ''}`}
          onClick={() => setSelectedPlaylistId(FAVORITES_PLAYLIST_ID)}
          onDragOver={(e) => {
            if (!isTrackDrag(e.dataTransfer)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setTrackDropTarget(FAVORITES_PLAYLIST_ID);
          }}
          onDragLeave={() => setTrackDropTarget(null)}
          onDrop={dropOnFavorites}
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
                    editHandledRef.current = true;
                    await renamePlaylist(pl.id, renameValue.trim());
                    setRenaming(null);
                  }
                  if (e.key === 'Escape') {
                    editHandledRef.current = true;
                    setRenaming(null);
                  }
                }}
                onFocus={() => { editHandledRef.current = false; }}
                onBlur={async () => {
                  if (editHandledRef.current) return;
                  // Clicking away commits — discarding a rename someone just
                  // typed is the surprising behaviour, not the safe one.
                  const next = renameValue.trim();
                  if (next && next !== pl.name) await renamePlaylist(pl.id, next);
                  setRenaming(null);
                }}
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
            } ${trackDropTarget === pl.id ? 'ring-1 ring-neon-purple bg-neon-purple/10' : ''}`}
            onClick={() => setSelectedPlaylistId(pl.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ pl, x: e.clientX, y: e.clientY });
            }}
            draggable
            onDragStart={(e) => {
              dragFromRef.current = pi;
              // Carries a track payload too, so a playlist can be dropped on
              // the queue or the player bar. Its contents are fetched at drop
              // time — dragstart cannot await.
              startTrackDrag(e.dataTransfer, {
                trackIds: [],
                label: pl.name,
                playlistId: pl.id,
              });
            }}
            onDragOver={(e) => {
              // Reorder wins when the drag started on a playlist row. Playlist
              // rows now carry a track payload as well, so testing the payload
              // first would turn every reorder into an add.
              if (dragFromRef.current !== null) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropTarget !== pi) setDropTarget(pi);
                return;
              }
              if (isTrackDrag(e.dataTransfer)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setTrackDropTarget(pl.id);
              }
            }}
            onDragLeave={() => setTrackDropTarget(null)}
            onDrop={(e) => {
              if (dragFromRef.current !== null) {
                e.preventDefault();
                if (dragFromRef.current !== pi) {
                  reorderPlaylists(dragFromRef.current, pi);
                }
                dragFromRef.current = null;
                setDropTarget(null);
                return;
              }
              if (isTrackDrag(e.dataTransfer)) {
                void dropOnPlaylist(e, pl.id);
              }
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
                if (e.key === 'Enter') {
                  editHandledRef.current = true;
                  handleCreate();
                }
                if (e.key === 'Escape') {
                  editHandledRef.current = true;
                  setCreating(false);
                  setNewName('');
                }
              }}
              onFocus={() => { editHandledRef.current = false; }}
              onBlur={() => {
                if (editHandledRef.current) return;
                // Clicking away creates the playlist rather than silently
                // throwing away the name that was just typed.
                if (newName.trim()) handleCreate();
                else {
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
