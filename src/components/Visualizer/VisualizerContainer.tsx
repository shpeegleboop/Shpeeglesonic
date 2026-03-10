import { useRef, useEffect, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useFFTData } from '../../hooks/useFFTData';
import { Spectrogram } from './Spectrogram';
import { RadialSpiral } from './RadialSpiral';
import { MandelbrotGL } from './MandelbrotGL';
import { CombinedVisualizer } from './CombinedVisualizer';

interface VisualizerContainerProps {
  inline?: boolean;
}

export function VisualizerContainer({ inline }: VisualizerContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 200 });
  const mode = usePlayerStore((s) => s.visualizerMode);
  const fullscreen = usePlayerStore((s) => s.visualizerFullscreen);
  const fftRef = useFFTData();

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
    const props = { fftRef, width: size.width, height: size.height };

    switch (mode) {
      case 'spectrogram':
        return <Spectrogram {...props} />;
      case 'spiral':
        return <RadialSpiral {...props} />;
      case 'mandelbrot':
        return <MandelbrotGL {...props} />;
      case 'combined':
        return <CombinedVisualizer {...props} />;
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

        {/* Subtle controls overlay on hover */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity bg-cosmic-panel/80 backdrop-blur-md rounded-lg px-4 py-2 flex items-center gap-4">
          <span className="text-xs text-gray-400">ESC to exit</span>
          <div className="flex gap-1">
            {(['spectrogram', 'spiral', 'mandelbrot', 'combined'] as const).map((m, i) => (
              <button
                key={m}
                onClick={(e) => {
                  e.stopPropagation();
                  usePlayerStore.getState().setVisualizerMode(m);
                }}
                className={`px-2 py-0.5 text-xs rounded ${
                  mode === m ? 'bg-neon-purple/30 text-neon-purple' : 'text-gray-500 hover:text-white'
                }`}
              >
                {i + 1}: {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-cosmic-bg rounded-lg overflow-hidden">
      {renderVisualizer()}
    </div>
  );
}
