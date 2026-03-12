import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { getLogBins, hslToRgb, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface SpectrogramProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

export function Spectrogram({ fftRef, lastUpdateRef, width, height }: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothedRef = useRef<number[]>(new Array(64).fill(0));
  const animRef = useRef<number>(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const smoothing = usePlayerStore((s) => s.visualizerSettings.smoothing);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const numBars = 64;
    let hueOffset = 0;

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const data = getDecayedFFT(fftRef, lastUpdateRef);
      if (!data) return;

      const logBins = getLogBins(data.bins, numBars);

      // Smooth
      const smoothed = smoothedRef.current;
      for (let i = 0; i < numBars; i++) {
        const target = (logBins[i] / 255) * sensitivity;
        smoothed[i] = smoothed[i] * smoothing + target * (1 - smoothing);
      }

      ctx.clearRect(0, 0, width, height);

      const barWidth = (width / numBars) * 0.8;
      const gap = (width / numBars) * 0.2;
      hueOffset += 0.3 * speed;

      for (let i = 0; i < numBars; i++) {
        const val = Math.min(1, smoothed[i]);
        const barHeight = val * height * 0.9;
        const x = i * (barWidth + gap) + gap / 2;
        const y = height - barHeight;

        // Color: warm bass → cool highs
        const hue = (220 - (i / numBars) * 180 + hueOffset) % 360;
        const sat = 70 + val * 30;
        const light = 30 + val * 40;
        const [r, g, b] = hslToRgb(hue, sat, light);

        // Gradient from bottom
        const gradient = ctx.createLinearGradient(x, height, x, y);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.9)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [barWidth / 4, barWidth / 4, 0, 0]);
        ctx.fill();

        // Glow
        if (val > 0.5) {
          ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
          ctx.shadowBlur = val * 15;
          ctx.fillRect(x, y, barWidth, 2);
          ctx.shadowBlur = 0;
        }
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, smoothing, speed]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="block"
    />
  );
}
