import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { getBandEnergy, getLogBins, BANDS, hslToRgb } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface CombinedProps {
  fftRef: React.RefObject<FFTData>;
  width: number;
  height: number;
}

export function CombinedVisualizer({ fftRef, width, height }: CombinedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const smoothing = usePlayerStore((s) => s.visualizerSettings.smoothing);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const smoothedBars = useRef<number[]>(new Array(32).fill(0));
  const smoothedBands = useRef({ subBass: 0, bass: 0, mids: 0, highs: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(cx, cy) * 0.85;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = fftRef.current;
      const bars = smoothedBars.current;
      const bands = smoothedBands.current;

      // Update smoothed bars
      const logBins = getLogBins(data.bins, 32);
      for (let i = 0; i < 32; i++) {
        const target = (logBins[i] / 255) * sensitivity;
        bars[i] = bars[i] * smoothing + target * (1 - smoothing);
      }

      // Update smoothed bands
      bands.subBass = bands.subBass * smoothing + getBandEnergy(data.bins, BANDS.subBass) * sensitivity * (1 - smoothing);
      bands.bass = bands.bass * smoothing + getBandEnergy(data.bins, BANDS.bass) * sensitivity * (1 - smoothing);
      bands.mids = bands.mids * smoothing + getBandEnergy(data.bins, BANDS.mids) * sensitivity * (1 - smoothing);
      bands.highs = bands.highs * smoothing + getBandEnergy(data.bins, BANDS.highs) * sensitivity * (1 - smoothing);

      // Fade
      ctx.fillStyle = 'rgba(10, 10, 20, 0.12)';
      ctx.fillRect(0, 0, width, height);

      const hue = (t * 15) % 360;

      // 1. Circular spectrogram bars
      const numBars = 32;
      const innerR = maxR * 0.25;
      for (let i = 0; i < numBars; i++) {
        const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
        const val = Math.min(1, bars[i]);
        const barLen = val * maxR * 0.3;

        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * (innerR + barLen);
        const y2 = cy + Math.sin(angle) * (innerR + barLen);

        const barHue = (hue + (i / numBars) * 120) % 360;
        const [r, g, b] = hslToRgb(barHue, 80, 40 + val * 40);

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.4 + val * 0.6})`;
        ctx.lineWidth = 2 + val * 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 2. Spiral arms
      const numArms = 5;
      for (let arm = 0; arm < numArms; arm++) {
        const armAngleOffset = (arm / numArms) * Math.PI * 2;
        const armHue = (hue + arm * 72) % 360;
        const [r, g, b] = hslToRgb(armHue, 70, 50);

        ctx.beginPath();
        const points = 80;
        for (let i = 0; i < points; i++) {
          const frac = i / points;
          const spiralAngle = armAngleOffset + frac * Math.PI * 4 + t * 0.5;
          const baseR = innerR + frac * maxR * 0.6;
          const wave = bands.mids * maxR * 0.1 * Math.sin(frac * 12 + t * 3);
          const r_val = baseR + wave;

          const x = cx + Math.cos(spiralAngle) * r_val;
          const y = cy + Math.sin(spiralAngle) * r_val;

          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + bands.mids * 0.3})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 3. Core pulse
      const coreR = innerR * (0.7 + bands.subBass * 0.5);
      const [cr, cg, cb] = hslToRgb(hue, 90, 50);
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      coreGrad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.5 + bands.subBass * 0.5})`);
      coreGrad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, smoothing, speed]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
}
