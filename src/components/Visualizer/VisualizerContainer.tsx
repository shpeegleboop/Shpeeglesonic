import { useRef, useEffect, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useFFTData } from '../../hooks/useFFTData';
import { Spectrogram } from './Spectrogram';
import { RadialSpiral } from './RadialSpiral';
import { RotatingSpiral } from './RotatingSpiral';
import { MandelbrotGL } from './MandelbrotGL';
import { Buddhabrot } from './Buddhabrot';
import { PaintSplash } from './PaintSplash';
import { MusicNotes } from './MusicNotes';
import { CombinedVisualizer } from './CombinedVisualizer';
import { VisualizerQuickSettings } from './VisualizerQuickSettings';
import { VISUALIZER_MODES } from '../../stores/playerStore';

interface VisualizerContainerProps {
  inline?: boolean;
}

export function VisualizerContainer({ inline }: VisualizerContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 200 });
  const mode = usePlayerStore((s) => s.visualizerMode);
  const fullscreen = usePlayerStore((s) => s.visualizerFullscreen);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);
  const { fftRef, lastUpdateRef } = useFFTData();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setSize({ width: Math.floor(width), height: Math.floor(height) });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const renderVisualizer = () => {
    // Canvas visualizers render at a quality-scaled internal resolution and
    // stretch to fill — a huge win on weak GPUs, invisible on strong ones.
    // (Mandelbrot manages its own pixel density from the CSS size.)
    const scale = mode === 'mandelbrot' ? 1 : quality === 'low' ? 0.55 : quality === 'medium' ? 0.8 : 1;
    const props = {
      fftRef,
      lastUpdateRef,
      width: Math.max(64, Math.floor(size.width * scale)),
      height: Math.max(64, Math.floor(size.height * scale)),
    };

    switch (mode) {
      case 'spectrogram':
        return <Spectrogram {...props} />;
      case 'spiral':
        return <RadialSpiral {...props} />;
      case 'rotator':
        return <RotatingSpiral {...props} />;
      case 'mandelbrot':
        return <MandelbrotGL {...props} />;
      case 'buddhabrot':
        return <Buddhabrot {...props} />;
      case 'paint':
        return <PaintSplash {...props} />;
      case 'notes':
        return <MusicNotes {...props} />;
      case 'combined':
        return <CombinedVisualizer {...props} />;
      default:
        return <Spectrogram {...props} />;
    }
  };

  if (fullscreen && !inline) {
    return (
      <div
        className="fixed inset-0 z-50 bg-cosmic-bg cursor-pointer"
        onClick={() => usePlayerStore.getState().setVisualizerFullscreen(false)}
      >
        <div ref={containerRef} className="w-full h-full">
          {renderVisualizer()}
        </div>

        <VisualizerQuickSettings />

        {/* Subtle controls overlay on hover */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity bg-cosmic-panel/80 backdrop-blur-md rounded-lg px-4 py-2 flex items-center gap-4">
          <span className="text-xs text-gray-400">ESC to exit</span>
          <div className="flex gap-1">
            {VISUALIZER_MODES.map((m, i) => (
              <button
                key={m.id}
                onClick={(e) => {
                  e.stopPropagation();
                  usePlayerStore.getState().setVisualizerMode(m.id);
                }}
                className={`px-2 py-0.5 text-xs rounded ${
                  mode === m.id ? 'bg-neon-purple/30 text-neon-purple' : 'text-gray-500 hover:text-white'
                }`}
              >
                {i + 1}: {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={containerRef} className="w-full h-full bg-cosmic-bg rounded-lg overflow-hidden">
        {renderVisualizer()}
      </div>
      <VisualizerQuickSettings />
    </div>
  );
}
