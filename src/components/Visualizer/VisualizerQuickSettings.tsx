import { useEffect, useRef, useState } from 'react';
import { usePlayerStore, VISUALIZER_MODES } from '../../stores/playerStore';
import { SettingsIcon } from '../Icons';

/** Gear button + popover with the visualizer parameters, overlaid on the visualizer itself. */
export function VisualizerQuickSettings() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mode = usePlayerStore((s) => s.visualizerMode);
  const settings = usePlayerStore((s) => s.visualizerSettings);
  const update = usePlayerStore((s) => s.updateVisualizerSettings);
  const setMode = usePlayerStore((s) => s.setVisualizerMode);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: 'sensitivity' | 'speed' | 'smoothing',
    format: (v: number) => string
  ) => (
    <div>
      <div className="flex justify-between text-[11px] text-gray-400 mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-gray-500">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => update({ [key]: parseFloat(e.target.value) })}
        className="w-full"
      />
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="absolute top-2 right-2 z-30"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setOpen(!open)}
        className={`p-1.5 rounded-lg backdrop-blur-md transition-all ${
          open
            ? 'bg-neon-purple/25 text-neon-purple'
            : 'bg-black/30 text-gray-400 opacity-50 hover:opacity-100 hover:text-white'
        }`}
        title="Visualizer settings"
      >
        <SettingsIcon size={14} />
      </button>

      {open && (
        <div className="absolute top-9 right-0 w-56 glass-panel p-3 space-y-3 shadow-xl shadow-black/50">
          <div className="grid grid-cols-2 gap-1">
            {VISUALIZER_MODES.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-1 py-1 text-[11px] rounded-md transition-all ${
                  mode === m.id
                    ? 'bg-neon-purple/25 text-neon-purple border border-neon-purple/40'
                    : 'text-gray-500 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
                title={`${m.label} (${i + 1})`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {slider('Sensitivity', settings.sensitivity, 0.3, 3.0, 0.1, 'sensitivity', (v) => v.toFixed(1))}
          {slider('Speed', settings.speed, 0.2, 3.0, 0.1, 'speed', (v) => v.toFixed(1))}
          {slider('Smoothing', settings.smoothing, 0.5, 0.95, 0.01, 'smoothing', (v) => v.toFixed(2))}

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-gray-400">Quality</span>
            <select
              value={settings.quality}
              onChange={(e) => update({ quality: e.target.value as 'low' | 'medium' | 'high' })}
              className="bg-cosmic-bg/80 border border-cosmic-border/40 rounded text-[11px] text-gray-300 py-0.5 px-1.5 focus:outline-none focus:border-neon-purple/40"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
