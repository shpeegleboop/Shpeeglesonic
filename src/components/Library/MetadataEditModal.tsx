import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../../stores/playerStore';
import { CloseIcon } from '../Icons';

interface MetadataEditModalProps {
  track: Track;
  onClose: () => void;
  onSaved: () => void;
}

export function MetadataEditModal({ track, onClose, onSaved }: MetadataEditModalProps) {
  const [title, setTitle] = useState(track.title ?? '');
  const [artist, setArtist] = useState(track.artist ?? '');
  const [albumArtist, setAlbumArtist] = useState(track.album_artist ?? '');
  const [album, setAlbum] = useState(track.album ?? '');
  const [genre, setGenre] = useState(track.genre ?? '');
  const [year, setYear] = useState(track.year ? String(track.year) : '');
  const [trackNumber, setTrackNumber] = useState(track.track_number ? String(track.track_number) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke('update_track_metadata', {
        trackId: track.id,
        update: {
          title: title || null,
          artist: artist || null,
          album_artist: albumArtist || null,
          album: album || null,
          genre: genre || null,
          year: year ? parseInt(year, 10) || null : null,
          track_number: trackNumber ? parseInt(trackNumber, 10) || null : null,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, props?: object) => (
    <label className="block">
      <span className="text-xs text-gray-400 block mb-1">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
        }}
        className="w-full bg-cosmic-bg/60 border border-cosmic-border/40 rounded-md px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-neon-purple/50 transition-colors"
        {...props}
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="glass-panel w-full max-w-md p-5 space-y-4 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Edit Metadata</h2>
          <button onClick={onClose} className="btn-ghost !p-1" title="Close (Esc)">
            <CloseIcon size={14} />
          </button>
        </div>

        <p className="text-xs text-gray-500 font-mono truncate" title={track.file_path}>
          {track.file_name}
        </p>

        <div className="space-y-3">
          {field('Title', title, setTitle, { autoFocus: true })}
          {field('Artist', artist, setArtist)}
          {field('Album Artist', albumArtist, setAlbumArtist)}
          {field('Album', album, setAlbum)}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">{field('Genre', genre, setGenre)}</div>
            <div className="col-span-1">{field('Year', year, setYear, { inputMode: 'numeric' })}</div>
            <div className="col-span-1">{field('Track #', trackNumber, setTrackNumber, { inputMode: 'numeric' })}</div>
          </div>
        </div>

        <p className="text-xs text-gray-600">
          Changes are written to the file's tags and will persist across rescans.
        </p>

        {error && <p className="text-xs text-neon-red break-words">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm px-4" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
