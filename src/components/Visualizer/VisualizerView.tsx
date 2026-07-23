import { usePlayerStore, VISUALIZER_MODES } from '../../stores/playerStore';
import { VisualizerContainer } from './VisualizerContainer';

function hueToHex(hue: number): string {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round((0.5 + c) * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round(((h * 60) % 360 + 360) % 360);
}

/** Dedicated Visualizer tab: full-size visualizer + every parameter in one panel. */
export function VisualizerView() {
  const mode = usePlayerStore((s) => s.visualizerMode);
  const settings = usePlayerStore((s) => s.visualizerSettings);
  const update = usePlayerStore((s) => s.updateVisualizerSettings);
  const setMode = usePlayerStore((s) => s.setVisualizerMode);
  const setFullscreen = usePlayerStore((s) => s.setVisualizerFullscreen);

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: 'sensitivity' | 'speed' | 'smoothing',
    format: (v: number) => string,
    hint: string
  ) => (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-300">{label}</span>
        <span className="font-mono text-neon-purple">{format(value)}</span>
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
      <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden p-3 gap-3">
      {/* Visualizer stage */}
      <div className="flex-1 min-w-0 relative">
        <VisualizerContainer inline />
      </div>

      {/* Parameter rail */}
      <div className="w-60 flex-shrink-0 overflow-y-auto space-y-4">
        <section className="glass-panel p-3 space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Mode</h3>
          <div className="grid grid-cols-1 gap-1">
            {VISUALIZER_MODES.map((m, i) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-all ${
                  mode === m.id
                    ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <span>{m.label}</span>
                <kbd className="font-mono text-[10px] text-gray-600">{i + 1}</kbd>
              </button>
            ))}
          </div>
        </section>

        <section className="glass-panel p-3 space-y-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Parameters</h3>

          {slider('Sensitivity', settings.sensitivity, 0.3, 3.0, 0.1, 'sensitivity', (v) => v.toFixed(1),
            'How hard the visuals react to the music')}
          {slider('Speed', settings.speed, 0.2, 3.0, 0.1, 'speed', (v) => v.toFixed(1),
            'Animation and rotation speed')}
          {slider('Smoothing', settings.smoothing, 0.5, 0.95, 0.01, 'smoothing', (v) => v.toFixed(2),
            'Higher = calmer, lower = twitchier')}

          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-300">Quality</span>
            </div>
            <select
              value={settings.quality}
              onChange={(e) => update({ quality: e.target.value as 'low' | 'medium' | 'high' })}
              className="w-full bg-cosmic-bg/60 border border-cosmic-border/40 rounded-md text-xs text-gray-300 py-1.5 px-2 focus:outline-none focus:border-neon-purple/40"
            >
              <option value="low">Low — best performance</option>
              <option value="medium">Medium</option>
              <option value="high">High — GPU intensive</option>
            </select>
            <p className="text-[11px] text-gray-600 mt-0.5">Detail level: iterations, particles, notes</p>
          </div>
        </section>

        {mode === 'mandelbrot' && (
          <section className="glass-panel p-3 space-y-3">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Mandelbrot Colors</h3>

            <div>
              <span className="text-xs text-gray-300 block mb-1">Gradient</span>
              <select
                value={settings.mandelbrotPalette ?? 'cosmic'}
                onChange={(e) => update({ mandelbrotPalette: e.target.value as 'cosmic' | 'acid' | 'fireice' | 'electric' })}
                className="w-full bg-cosmic-bg/60 border border-cosmic-border/40 rounded-md text-xs text-gray-300 py-1.5 px-2 focus:outline-none focus:border-neon-purple/40"
              >
                <option value="cosmic">Cosmic — smooth drift</option>
                <option value="acid">Acid — clashing bands</option>
                <option value="fireice">Fire &amp; Ice — hot vs cold</option>
                <option value="electric">Electric — rainbow strobe</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-300">Hue Shift</span>
                <span className="font-mono text-neon-purple">{Math.round(settings.mandelbrotHue ?? 0)}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={360}
                  step={1}
                  value={settings.mandelbrotHue ?? 0}
                  onChange={(e) => update({ mandelbrotHue: parseInt(e.target.value, 10) })}
                  className="flex-1 min-w-0"
                  style={{
                    background:
                      'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                    borderRadius: '4px',
                    height: '8px',
                  }}
                />
                <input
                  type="color"
                  value={hueToHex(settings.mandelbrotHue ?? 0)}
                  onChange={(e) => update({ mandelbrotHue: hexToHue(e.target.value) })}
                  className="w-7 h-7 rounded cursor-pointer border border-cosmic-border/40 bg-transparent p-0"
                  title="Pick a base color"
                />
              </div>
              <p className="text-[11px] text-gray-600 mt-0.5">Rotates the whole gradient around the wheel</p>
            </div>
          </section>
        )}

        <button onClick={() => setFullscreen(true)} className="btn-primary w-full">
          Fullscreen (F)
        </button>

        <p className="text-[11px] text-gray-600 px-1 leading-relaxed">
          V cycles modes · 1–9 and 0 jump straight to one · Esc exits fullscreen. All settings save automatically.
        </p>
      </div>
    </div>
  );
}
