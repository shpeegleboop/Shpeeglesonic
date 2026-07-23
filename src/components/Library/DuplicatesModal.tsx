import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../../stores/playerStore';
import { useLibrary } from '../../hooks/useLibrary';
import { FormatBadge } from '../Player/FormatBadge';
import { MetadataEditModal } from './MetadataEditModal';
import { CloseIcon } from '../Icons';

interface DuplicatesModalProps {
  onClose: () => void;
}

type DupEntry = Track & { hidden: boolean };

/**
 * Lists every song with multiple versions (same title + artist), including
 * versions already hidden, side by side with audio quality. Tick a version to
 * hide it from the library (nothing is deleted); untick to bring it back.
 */
export function DuplicatesModal({ onClose }: DuplicatesModalProps) {
  const library = useLibrary();
  const [entries, setEntries] = useState<DupEntry[]>([]);
  const [editing, setEditing] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await invoke<DupEntry[]>('get_duplicate_candidates');
      setEntries(result);
    } catch (e) {
      console.error('Failed to fetch duplicate candidates:', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, DupEntry[]>();
    for (const t of entries) {
      const key = `${(t.title ?? '').toLowerCase()}|${(t.artist ?? '').toLowerCase()}`;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    }
    // Show groups still needing attention: something hidden or still flagged
    return Array.from(map.values()).filter((g) => g.some((e) => e.hidden || e.dup_flag));
  }, [entries]);

  const setHidden = async (entry: DupEntry, hide: boolean, group: DupEntry[]) => {
    const keeper = group.find((e) => e.id !== entry.id && !e.hidden);
    try {
      await invoke('set_track_hidden', {
        trackId: entry.id,
        duplicateOf: hide ? keeper?.id ?? null : null,
      });
    } catch (e) {
      console.error('Failed to toggle hidden:', e);
    }
  };

  const applyAndRefresh = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      await refresh();
      library.fetchTracks(); // keep the library view in sync
      setBusy(false);
    }
  };

  const hideLowerQuality = () =>
    applyAndRefresh(async () => {
      for (const group of groups) {
        const visible = group.filter((e) => !e.hidden);
        if (visible.length < 2) continue;
        // Keep the highest bitrate (first wins ties); hide the rest
        const best = visible.reduce((a, b) => ((b.bitrate ?? 0) > (a.bitrate ?? 0) ? b : a));
        for (const e of visible) {
          if (e.id !== best.id) await setHidden(e, true, group);
        }
      }
    });

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-cosmic-surface border border-cosmic-border/60 rounded-xl shadow-2xl shadow-black/50 max-w-3xl w-full max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-cosmic-border/30 flex items-center gap-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-white flex-1">Potential Duplicates</h3>
          <span className="text-xs text-gray-500">
            {groups.length} {groups.length === 1 ? 'group' : 'groups'}
          </span>
          {groups.some((g) => g.filter((e) => !e.hidden).length > 1) && (
            <button onClick={hideLowerQuality} disabled={busy} className="btn-primary text-xs !py-1">
              {busy ? 'Working…' : 'Hide lower quality duplicates'}
            </button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-white p-0.5 rounded hover:bg-white/5" title="Close">
            <CloseIcon size={14} />
          </button>
        </div>

        <p className="px-5 pt-3 text-xs text-gray-500 flex-shrink-0">
          Versions of the same song, side by side. Tick <span className="text-gray-300">Hide</span> to
          remove a version from the library (the file stays on disk — untick to bring it back), or
          edit metadata to confirm a track isn't a duplicate.
        </p>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
          {groups.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">
              No potential duplicates — your library looks clean.
            </p>
          )}
          {groups.map((group) => {
            const visibleCount = group.filter((e) => !e.hidden).length;
            return (
              <div key={`${group[0].title}-${group[0].artist}`} className="border border-cosmic-border/30 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-cosmic-panel/60 text-sm">
                  <span className="font-semibold text-neon-purple">{group[0].title}</span>
                  <span className="text-gray-400"> — {group[0].artist ?? 'Unknown Artist'}</span>
                  <span className="text-xs text-gray-500 ml-2">{group.length} versions</span>
                </div>
                {group.map((t) => (
                  <div
                    key={t.id}
                    className={`px-3 py-2 border-t border-cosmic-border/20 flex items-center gap-3 ${
                      t.hidden ? 'opacity-45' : ''
                    }`}
                  >
                    <label
                      className={`flex items-center gap-1.5 flex-shrink-0 text-xs ${
                        !t.hidden && visibleCount === 1 ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 cursor-pointer'
                      }`}
                      title={
                        !t.hidden && visibleCount === 1
                          ? 'The last visible version cannot be hidden'
                          : t.hidden
                            ? 'Untick to restore this version to the library'
                            : 'Hide this version from the library'
                      }
                    >
                      <input
                        type="checkbox"
                        className="accent-neon-purple"
                        checked={t.hidden}
                        disabled={busy || (!t.hidden && visibleCount === 1)}
                        onChange={(e) => applyAndRefresh(() => setHidden(t, e.target.checked, group))}
                      />
                      Hide
                    </label>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-300 truncate">{t.file_name}</div>
                      <div className="text-[11px] text-gray-600 truncate font-mono">{t.file_path}</div>
                    </div>
                    <FormatBadge format={t.format} sampleRate={t.sample_rate} bitDepth={t.bit_depth} bitrate={t.bitrate} />
                    <button onClick={() => setEditing(t)} className="btn-ghost text-xs flex-shrink-0">
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <MetadataEditModal
          track={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            refresh();
            library.fetchTracks();
          }}
        />
      )}
    </div>,
    document.body
  );
}
