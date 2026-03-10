import { useEffect, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { usePlaylist, type Playlist } from '../../hooks/usePlaylist';

export function PlaylistSidebar() {
  const selectedPlaylistId = usePlayerStore((s) => s.selectedPlaylistId);
  const setSelectedPlaylistId = usePlayerStore((s) => s.setSelectedPlaylistId);
  const { playlists, fetchPlaylists, createPlaylist, deletePlaylist } = usePlaylist();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    fetchPlaylists();
  }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createPlaylist(newName.trim());
    setNewName('');
    setCreating(false);
  };

  const handleDelete = async (e: React.MouseEvent, pl: Playlist) => {
    e.stopPropagation();
    await deletePlaylist(pl.id);
    if (selectedPlaylistId === pl.id) {
      setSelectedPlaylistId(null);
    }
  };

  return (
    <div className="w-48 flex flex-col bg-cosmic-bg/50 border-r border-cosmic-border/30 overflow-hidden flex-shrink-0">
      <div className="px-3 py-2 border-b border-cosmic-border/30 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Playlists</span>
        <button
          onClick={() => setCreating(true)}
          className="text-neon-purple hover:text-white text-lg leading-none transition-colors"
          title="New Playlist"
        >
          +
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
          All Tracks
        </div>

        {/* Playlists */}
        {playlists.map((pl) => (
          <div
            key={pl.id}
            className={`group px-3 py-2 cursor-pointer text-sm transition-colors flex items-center justify-between ${
              selectedPlaylistId === pl.id
                ? 'bg-neon-purple/15 text-neon-purple border-l-2 border-l-neon-purple'
                : 'text-gray-300 hover:bg-cosmic-hover hover:text-white'
            }`}
            onClick={() => setSelectedPlaylistId(pl.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="truncate">{pl.name}</div>
              <div className="text-xs text-gray-500">{pl.track_count} tracks</div>
            </div>
            <button
              onClick={(e) => handleDelete(e, pl)}
              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs transition-opacity ml-1"
              title="Delete playlist"
            >
              x
            </button>
          </div>
        ))}

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
    </div>
  );
}
