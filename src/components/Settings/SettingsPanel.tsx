import { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useLibrary } from '../../hooks/useLibrary';
import { usePlayerStore } from '../../stores/playerStore';

export function SettingsPanel() {
  const library = useLibrary();
  const vizSettings = usePlayerStore((s) => s.visualizerSettings);
  const updateViz = usePlayerStore((s) => s.updateVisualizerSettings);

  useEffect(() => {
    library.fetchFolders();
  }, []);

  const handleAddFolder = async () => {
    const result = await open({
      directory: true,
      multiple: false,
      title: 'Select Music Folder',
    });
    if (result) {
      try {
        const count = await library.scanFolder(result as string);
        alert(`Scanned ${count} tracks`);
      } catch (e) {
        alert(`Scan failed: ${e}`);
      }
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

        <div className="flex gap-2">
          <button onClick={handleAddFolder} className="btn-primary" disabled={library.loading}>
            {library.loading ? 'Scanning...' : 'Add Folder'}
          </button>
          {library.folders.length > 0 && (
            <button
              onClick={async () => {
                for (const f of library.folders) {
                  await library.scanFolder(f);
                }
              }}
              className="btn-primary"
              disabled={library.loading}
            >
              Rescan All
            </button>
          )}
        </div>
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
              <option value="low">Low (best performance)</option>
              <option value="medium">Medium</option>
              <option value="high">High (GPU intensive)</option>
            </select>
          </div>
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
            ['1-4', 'Viz Type'],
            ['⌘F', 'Search'],
            ['⌘L', 'Library Panel'],
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
