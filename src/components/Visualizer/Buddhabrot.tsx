import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface BuddhabrotProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

/**
 * Music-reactive Buddhabrot: random points outside the Mandelbrot set are
 * iterated and their escape trajectories accumulate as glowing nebula dust.
 * Bass warps the sampling region, beats flare the brightness, and the hue
 * drifts with the music. Rendered additively onto a slowly fading canvas.
 */
export function Buddhabrot({ fftRef, lastUpdateRef, width, height }: BuddhabrotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const flareRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Trajectory budget per frame by quality
    const samplesPerFrame = quality === 'low' ? 600 : quality === 'high' ? 2400 : 1300;
    const maxIter = quality === 'low' ? 60 : quality === 'high' ? 200 : 110;
    // Ignore fast escapes — long trajectories paint the fine filaments
    const minIter = quality === 'low' ? 8 : quality === 'high' ? 18 : 12;

    // Points inside the main cardioid or period-2 bulb never escape — skip
    // them without iterating (classic buddhabrot optimization)
    const inBulbs = (re: number, im: number): boolean => {
      const imSq = im * im;
      const q = (re - 0.25) * (re - 0.25) + imSq;
      if (q * (q + (re - 0.25)) < 0.25 * imSq) return true; // main cardioid
      if ((re + 1) * (re + 1) + imSq < 0.0625) return true; // period-2 bulb
      return false;
    };

    // Buddhabrot lives in [-2, 1] x [-1.5, 1.5]; rotate 90° so it stands upright
    const scale = Math.min(width / 3.0, height / 3.4) * 1.1;
    const cx = width / 2;
    const cy = height / 2;

    const plot = (re: number, im: number, r: number, g: number, b: number, a: number) => {
      // Rotate: screen x = im, screen y = re (classic upright buddhabrot)
      const x = cx + im * scale;
      const y = cy + (re + 0.5) * scale;
      if (x < 0 || x >= width || y < 0 || y >= height) return;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
      ctx.fillRect(x, y, 2, 2);
    };

    ctx.fillStyle = 'rgb(10, 10, 20)';
    ctx.fillRect(0, 0, width, height);

    const trajectory: { re: number; im: number }[] = new Array(maxIter);

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      if (beat.onset.bass || beat.onset.subBass) {
        flareRef.current = Math.min(flareRef.current + 0.6, 1.5);
      }
      flareRef.current *= 0.94;
      const flare = flareRef.current;

      // Fast-ish fade: quicker reaction and motion, still enough accumulation
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(10, 10, 20, 0.022)';
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'lighter';

      const energy = beat.energy.bass * 0.5 + beat.energy.mids * 0.3 + data.rms * 0.2;
      const budget = Math.floor(samplesPerFrame * (0.8 + energy * 1.4 + flare * 1.2));
      const hueBase = (t * 32) % 360;

      for (let s = 0; s < budget; s++) {
        // Uniform sampling over the whole set region — this is what makes the
        // classic Buddha silhouette emerge
        const cRe = -2.0 + Math.random() * 2.6;
        const cIm = (Math.random() - 0.5) * 2.8;
        if (inBulbs(cRe, cIm)) continue;

        // Iterate; record trajectory; keep only escaping points (true buddhabrot)
        let zRe = 0;
        let zIm = 0;
        let n = 0;
        for (; n < maxIter; n++) {
          const nRe = zRe * zRe - zIm * zIm + cRe;
          const nIm = 2 * zRe * zIm + cIm;
          zRe = nRe;
          zIm = nIm;
          trajectory[n] = { re: zRe, im: zIm };
          if (zRe * zRe + zIm * zIm > 4) break;
        }
        if (n >= maxIter || n < minIter) continue; // non-escaping or too short

        // Longer escapes = hotter color; per-trajectory hue jitter keeps it wild
        const heat = Math.min(1, n / (maxIter * 0.5));
        const hue = (hueBase + 200 + heat * 200 + Math.random() * 50) % 360;
        const [r, g, b] = hslToRgb(hue, 85 + heat * 15, 55 + heat * 25 + flare * 12);
        const alpha = 0.24 + heat * 0.2 + energy * 0.2 + flare * 0.22;

        // Skip the first two points (z₁ = c paints a structureless haze)
        for (let i = 2; i < n; i++) {
          plot(trajectory[i].re, trajectory[i].im, r, g, b, alpha);
        }

        // Sparkle: hot trajectories end in a white-hot glint
        if (heat > 0.55 && Math.random() < 0.35 + flare * 0.4) {
          const p = trajectory[n - 1];
          const sx = cx + p.im * scale;
          const sy = cy + (p.re + 0.5) * scale;
          if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
            ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + flare * 0.4})`;
            const sw = 1.5 + heat * 2 + flare * 2;
            ctx.fillRect(sx - sw / 2, sy - sw / 2, sw, sw);
          }
        }
      }

      ctx.globalCompositeOperation = 'source-over';
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
