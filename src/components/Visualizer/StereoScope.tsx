import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';

interface StereoScopeProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

/**
 * Stereo Scope: classic L/R channel oscilloscope over a scrolling spectrogram.
 * Top 55%: left channel (purple) and right channel (cyan) waveform traces.
 * Bottom 45%: frequency-vs-time heatmap scrolling right-to-left, log-scaled
 * so bass detail gets room.
 */
export function StereoScope({ fftRef, lastUpdateRef, width, height }: StereoScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollCarryRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const scopeH = Math.floor(height * 0.55);
    const specH = height - scopeH;

    // Persistent offscreen buffer for the scrolling spectrogram
    const spec = document.createElement('canvas');
    spec.width = width;
    spec.height = specH;
    const specCtx = spec.getContext('2d', { alpha: false })!;
    specCtx.fillStyle = 'rgb(8, 8, 16)';
    specCtx.fillRect(0, 0, width, specH);
    specCanvasRef.current = spec;

    // Spectrogram column painted via ImageData (one blit per column, not
    // per-pixel fillRects). Color map: dark → violet → magenta → white-hot.
    const column = specCtx.createImageData(1, specH);

    // Log frequency mapping: y position in the spectrogram → bin index.
    // Precomputed per row for the column painter.
    const binForRow: number[] = [];
    for (let y = 0; y < specH; y++) {
      const f = 1 - y / specH; // bottom = low frequency
      binForRow[y] = Math.min(1023, Math.floor(Math.pow(f, 2.6) * 700));
    }

    const drawTrace = (wave: number[], centerY: number, amp: number, color: string, glow: string) => {
      ctx.beginPath();
      const n = wave.length || 2;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = centerY - ((wave[i] ?? 0) / 127) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Glow pass (additive, wide) then core line
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 6;
      ctx.strokeStyle = glow;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    let lastFrameTs = 0;

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const now = performance.now();
      const frameMs = lastFrameTs > 0 ? Math.min(50, now - lastFrameTs) : 16.67;
      lastFrameTs = now;
      const dtN = frameMs / 16.67;

      const data = fftRef.current;
      const stale = now - (lastUpdateRef.current ?? 0) > 250;
      const waveL = !stale && data?.wave_l ? data.wave_l : [];
      const waveR = !stale && data?.wave_r ? data.wave_r : [];
      const bins = !stale && data?.bins ? data.bins : [];

      // ── Scope area ──
      ctx.fillStyle = 'rgb(10, 10, 20)';
      ctx.fillRect(0, 0, width, scopeH);

      const lCenter = Math.floor(scopeH * 0.27);
      const rCenter = Math.floor(scopeH * 0.77);
      const amp = scopeH * 0.21;

      // Faint center lines + channel labels
      ctx.strokeStyle = 'rgba(120, 120, 160, 0.18)';
      ctx.lineWidth = 1;
      for (const cy of [lCenter, rCenter]) {
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(width, cy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160, 160, 200, 0.5)';
      ctx.font = `${Math.max(10, Math.floor(height * 0.014))}px monospace`;
      ctx.fillText('L', 8, lCenter - 8);
      ctx.fillText('R', 8, rCenter - 8);

      drawTrace(waveL, lCenter, amp, 'rgb(196, 120, 255)', 'rgb(168, 85, 247)');
      drawTrace(waveR, rCenter, amp, 'rgb(110, 231, 249)', 'rgb(34, 211, 238)');

      // Divider
      ctx.fillStyle = 'rgba(120, 120, 160, 0.25)';
      ctx.fillRect(0, scopeH - 1, width, 1);

      // ── Spectrogram area ──
      const specCanvas = specCanvasRef.current!;
      const sctx = specCtx;
      // Scroll speed normalized to real time (~120 px/s at any refresh rate)
      scrollCarryRef.current += 2 * dtN;
      const shift = Math.floor(scrollCarryRef.current);
      if (shift > 0) {
        scrollCarryRef.current -= shift;
        sctx.drawImage(specCanvas, -shift, 0);
        // Paint the new columns on the right
        const px = column.data;
        for (let y = 0; y < specH; y++) {
          const v = (bins[binForRow[y]] ?? 0) / 255;
          const i = y * 4;
          if (v < 0.02) {
            px[i] = 8; px[i + 1] = 8; px[i + 2] = 16;
          } else {
            px[i] = Math.min(255, v * 340 + v * v * 120);
            px[i + 1] = v * v * 190;
            px[i + 2] = Math.min(255, 60 + v * 300);
          }
          px[i + 3] = 255;
        }
        for (let col = 0; col < shift; col++) {
          sctx.putImageData(column, width - 1 - col, 0);
        }
      }
      ctx.drawImage(specCanvas, 0, scopeH);
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
