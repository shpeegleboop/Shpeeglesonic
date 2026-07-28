import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useLibrary } from '../../hooks/useLibrary';
import { usePlayerStore, FONT_SCALES, type FontScale } from '../../stores/playerStore';
import { DuplicatesModal } from '../Library/DuplicatesModal';
import { ConfirmDialog } from '../ConfirmDialog';

export function SettingsPanel() {
  const library = useLibrary();
  const vizSettings = usePlayerStore((s) => s.visualizerSettings);
  const updateViz = usePlayerStore((s) => s.updateVisualizerSettings);
  const fontScale = usePlayerStore((s) => s.fontScale);
  const setFontScale = usePlayerStore((s) => s.setFontScale);
  const scanProgress = usePlayerStore((s) => s.scanProgress);
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [confirmPrune, setConfirmPrune] = useState(false);

  useEffect(() => {
    library.fetchFolders();
  }, []);

  const report = (s: { added: number; updated: number; skipped: number; errors: number }) =>
    [
      `Added ${s.added}`,
      `updated ${s.updated}`,
      s.skipped > 0 ? `skipped ${s.skipped}` : null,
      s.errors > 0 ? `${s.errors} errors` : null,
    ]
      .filter(Boolean)
      .join(', ');

  const runAll = async (incremental: boolean) => {
    setScanStatus(null);
    setMissing([]);
    try {
      const totals = { added: 0, updated: 0, skipped: 0, errors: 0 };
      const gone: string[] = [];
      for (const f of library.folders) {
        const s = incremental ? await library.quickScan(f) : await library.scanFolder(f);
        totals.added += s.added;
        totals.updated += s.updated;
        totals.skipped += s.skipped;
        totals.errors += s.errors;
        gone.push(...s.missing);
      }
      setMissing(gone);
      setScanStatus({ ok: true, text: report(totals) });
    } catch (e) {
      setScanStatus({ ok: false, text: `Scan failed: ${e}` });
    }
  };

  const handleAddFolder = async () => {
    const result = await open({
      directory: true,
      multiple: false,
      title: 'Select Music Folder',
    });
    if (!result) return;
    setScanStatus(null);
    setMissing([]);
    try {
      const s = await library.scanFolder(result as string);
      setScanStatus({ ok: true, text: report(s) });
    } catch (e) {
      setScanStatus({ ok: false, text: `Scan failed: ${e}` });
    }
  };

  return (
    <div className="flex-1 overflow-auto p-6 max-w-2xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-neon-purple">Settings</h1>

      {/* Library Folders */}
      <section className="glass-panel p-4 space-y-3">
        <h2 className="text-lg font-semibold">Library Folders</h2>
        <p className="text-sm text-gray-400">Add folders containing your music files.</p>

        {library.folders.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No folders added yet</p>
        ) : (
          <ul className="space-y-1">
            {library.folders.map((folder) => (
              <li key={folder} className="flex items-center justify-between bg-cosmic-bg/50 rounded px-3 py-2">
                <span className="text-sm font-mono truncate flex-1">{folder}</span>
                <button
                  onClick={() => library.removeFolder(folder)}
                  className="text-xs text-neon-red hover:text-red-400 ml-2"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2 flex-wrap">
          <button onClick={handleAddFolder} className="btn-primary" disabled={library.loading}>
            Add Folder
          </button>
          {library.folders.length > 0 && (
            <>
              <button
                onClick={() => runAll(true)}
                className="btn-primary"
                disabled={library.loading}
                title="Only reads files that are new or have changed since the last scan"
              >
                Scan for New Tracks
              </button>
              <button onClick={() => runAll(false)} className="btn-primary" disabled={library.loading}>
                Rescan All
              </button>
            </>
          )}
        </div>

        {scanProgress && (
          <p className="text-xs text-neon-cyan font-mono">
            Scanning… {scanProgress.done} / {scanProgress.total}
            {scanProgress.label && ` — ${scanProgress.label}`}
          </p>
        )}
        {library.loading && !scanProgress && (
          <p className="text-xs text-gray-500">Checking files…</p>
        )}

        {scanStatus && (
          <p className={`text-xs ${scanStatus.ok ? 'text-neon-cyan' : 'text-neon-red'}`}>
            {scanStatus.text}
          </p>
        )}

        {missing.length > 0 && (
          <div className="flex items-center gap-3 rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2">
            <span className="flex-1 text-xs text-amber-300">
              {missing.length} {missing.length === 1 ? 'track is' : 'tracks are'} in the library but
              missing from disk.
            </span>
            <button
              onClick={() => setConfirmPrune(true)}
              className="flex-shrink-0 text-xs text-neon-red hover:text-red-400"
            >
              Remove them
            </button>
          </div>
        )}

        {confirmPrune && (
          <ConfirmDialog
            title="Remove missing tracks?"
            message={`${missing.length} tracks will be removed from the library, along with their playlist entries and favorites. The files themselves are already gone from disk.`}
            confirmLabel="Remove"
            onCancel={() => setConfirmPrune(false)}
            onConfirm={async () => {
              const removed = await invoke<number>('prune_missing_tracks', { paths: missing });
              setConfirmPrune(false);
              setMissing([]);
              setScanStatus({ ok: true, text: `Removed ${removed} missing tracks` });
              library.fetchTracks();
            }}
          />
        )}

        <div className="pt-2 border-t border-cosmic-border/20">
          <p className="text-xs text-gray-500 mb-2">
            Byte-identical files are collapsed automatically after each scan. Tracks marked{' '}
            <span className="text-[10px] font-mono text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-1">d!?</span>{' '}
            look like the same recording as another file — edit their metadata to confirm or dismiss.
          </p>
          <button
            onClick={() => setShowDuplicates(true)}
            className="btn-primary"
            disabled={library.loading}
          >
            Show Potential Duplicates
          </button>
        </div>

        {showDuplicates && <DuplicatesModal onClose={() => setShowDuplicates(false)} />}
      </section>

      {/* Visualizer Settings */}
      <section className="glass-panel p-4 space-y-4">
        <h2 className="text-lg font-semibold">Visualizer</h2>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Sensitivity: {vizSettings.sensitivity.toFixed(1)}
            </label>
            <input
              type="range" min="0.3" max="3.0" step="0.1"
              value={vizSettings.sensitivity}
              onChange={(e) => updateViz({ sensitivity: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Speed: {vizSettings.speed.toFixed(1)}
            </label>
            <input
              type="range" min="0.2" max="3.0" step="0.1"
              value={vizSettings.speed}
              onChange={(e) => updateViz({ speed: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">
              Smoothing: {vizSettings.smoothing.toFixed(2)}
            </label>
            <input
              type="range" min="0.5" max="0.95" step="0.01"
              value={vizSettings.smoothing}
              onChange={(e) => updateViz({ smoothing: parseFloat(e.target.value) })}
              className="w-full"
            />
          </div>

          <div>
            <label className="text-sm text-gray-400 block mb-1">Quality</label>
            <select
              value={vizSettings.quality}
              onChange={(e) => updateViz({ quality: e.target.value as 'low' | 'medium' | 'high' })}
              className="bg-cosmic-bg border border-cosmic-border rounded px-3 py-1.5 text-sm w-full"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Appearance</h2>
        <div className="glass-panel p-4">
          <label className="text-sm text-gray-400 block mb-1">Interface size</label>
          <select
            value={fontScale}
            onChange={(e) => setFontScale(e.target.value as FontScale)}
            className="bg-cosmic-bg border border-cosmic-border rounded px-3 py-1.5 text-sm w-full"
          >
            {FONT_SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.percent !== 100 ? ` — ${s.percent}%` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Scales the whole interface, not just text, so controls grow with the type.
          </p>
        </div>
      </section>

      {/* Keyboard Shortcuts */}
      <section className="glass-panel p-4">
        <h2 className="text-lg font-semibold mb-3">Keyboard Shortcuts</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {[
            ['Space', 'Play / Pause'],
            ['← / →', 'Seek ±5s'],
            ['↑ / ↓', 'Volume'],
            ['N / P', 'Next / Prev'],
            ['S', 'Shuffle'],
            ['R', 'Repeat'],
            ['F', 'Fullscreen Viz'],
            ['V', 'Cycle Viz'],
            ['M', 'Mute'],
            ['L', 'Lyrics'],
            ['Q', 'Queue Panel'],
            ['Ctrl+F', 'Search'],
            ['Ctrl+L', 'Library Panel'],
            ['Esc', 'Exit Fullscreen'],
          ].map(([key, action]) => (
            <div key={key} className="flex justify-between py-0.5">
              <kbd className="font-mono text-neon-cyan text-xs bg-cosmic-bg px-1.5 py-0.5 rounded">{key}</kbd>
              <span className="text-gray-400">{action}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
