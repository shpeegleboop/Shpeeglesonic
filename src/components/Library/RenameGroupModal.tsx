import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CloseIcon } from '../Icons';

interface RenameGroupModalProps {
  field: 'artist' | 'album' | 'genre';
  /** Display label of the group (e.g. "Unknown Artist" when untagged) */
  label: string;
  /** Actual tag value, or null for untagged tracks */
  oldValue: string | null;
  trackCount: number;
  onClose: () => void;
  onDone: (updated: number, failed: number) => void;
}

interface RenameResult {
  updated: number;
  failed: number;
  first_error: string | null;
}

export function RenameGroupModal({ field, label, oldValue, trackCount, onClose, onDone }: RenameGroupModalProps) {
  const [newValue, setNewValue] = useState(oldValue ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRename = async () => {
    if (!newValue.trim() || newValue.trim() === oldValue) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<RenameResult>('rename_group_field', {
        field,
        oldValue,
        newValue: newValue.trim(),
      });
      if (result.failed > 0) {
        setError(
          `Updated ${result.updated}, failed ${result.failed}.` +
            (result.first_error ? ` First error: ${result.first_error}` : '')
        );
        setSaving(false);
        onDone(result.updated, result.failed);
      } else {
        onDone(result.updated, 0);
        onClose();
      }
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

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
      <div className="glass-panel w-full max-w-sm p-5 space-y-4 shadow-2xl shadow-black/60">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold capitalize">Rename {field}</h2>
          <button onClick={onClose} className="btn-ghost !p-1" title="Close (Esc)">
            <CloseIcon size={14} />
          </button>
        </div>

        <p className="text-xs text-gray-500">
          Renames <span className="text-gray-300">{label}</span> across{' '}
          <span className="text-gray-300">{trackCount}</span> {trackCount === 1 ? 'track' : 'tracks'} — file
          tags included. Use this to merge variants like "Artist feat. X" into one {field}.
        </p>

        <input
          type="text"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename();
          }}
          placeholder={`New ${field} name…`}
          autoFocus
          className="w-full bg-cosmic-bg/60 border border-cosmic-border/40 rounded-md px-2.5 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-neon-purple/50 transition-colors"
        />

        {error && <p className="text-xs text-neon-red break-words">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost text-sm px-4" disabled={saving}>
            Cancel
          </button>
          <button onClick={handleRename} className="btn-primary" disabled={saving || !newValue.trim()}>
            {saving ? 'Renaming…' : `Rename ${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
