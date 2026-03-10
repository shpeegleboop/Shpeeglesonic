import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { getBandEnergy, BANDS, hslToRgb } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface RadialSpiralProps {
  fftRef: React.RefObject<FFTData>;
  width: number;
  height: number;
}

export function RadialSpiral({ fftRef, width, height }: RadialSpiralProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const smoothing = usePlayerStore((s) => s.visualizerSettings.smoothing);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);

  // Smoothed band energies
  const bandsRef = useRef({ subBass: 0, bass: 0, mids: 0, highs: 0, air: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(cx, cy) * 0.9;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;

      const data = fftRef.current;
      const bands = bandsRef.current;

      // Smooth band energies
      const rawSubBass = getBandEnergy(data.bins, BANDS.subBass) * sensitivity;
      const rawBass = getBandEnergy(data.bins, BANDS.bass) * sensitivity;
      const rawMids = getBandEnergy(data.bins, BANDS.mids) * sensitivity;
      const rawHighs = getBandEnergy(data.bins, BANDS.highs) * sensitivity;
      const rawAir = getBandEnergy(data.bins, BANDS.air) * sensitivity;

      bands.subBass = bands.subBass * smoothing + rawSubBass * (1 - smoothing);
      bands.bass = bands.bass * smoothing + rawBass * (1 - smoothing);
      bands.mids = bands.mids * smoothing + rawMids * (1 - smoothing);
      bands.highs = bands.highs * smoothing + rawHighs * (1 - smoothing);
      bands.air = bands.air * smoothing + rawAir * (1 - smoothing);

      const t = timeRef.current;

      // Fade previous frame (trail effect)
      ctx.fillStyle = 'rgba(10, 10, 20, 0.15)';
      ctx.fillRect(0, 0, width, height);

      // Draw layers from outside in
      const hueBase = (t * 20) % 360;

      // Layer 5: Air particles (outermost)
      drawParticles(ctx, cx, cy, maxRadius * 0.85, bands.air, t, hueBase + 180, 30);

      // Layer 4: Highs ring (counter-clockwise)
      drawRing(ctx, cx, cy, maxRadius * 0.7, bands.highs, t, -1, 12, hueBase + 120, 1.5);

      // Layer 3: Mids ring (clockwise)
      drawRing(ctx, cx, cy, maxRadius * 0.5, bands.mids, t, 1, 8, hueBase + 60, 2);

      // Layer 2: Bass ring (counter-clockwise)
      drawRing(ctx, cx, cy, maxRadius * 0.35, bands.bass, t, -0.7, 6, hueBase + 30, 3);

      // Layer 1: Sub-bass core (slow pulse)
      drawCore(ctx, cx, cy, maxRadius * 0.2, bands.subBass, t, hueBase);
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, smoothing, speed]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
}

function drawRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number,
  time: number, direction: number,
  petals: number, hue: number, lineWidth: number
) {
  const points = 128;
  const rotation = time * direction * 0.5;

  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2 + rotation;
    const distortion = energy * radius * 0.4 * Math.sin(angle * petals + time * 2);
    const r = radius + distortion;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const alpha = 0.3 + energy * 0.7;
  const [r, g, b] = hslToRgb(hue % 360, 80, 50 + energy * 30);
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  ctx.lineWidth = lineWidth + energy * 2;
  ctx.stroke();

  // Glow
  ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.5)`;
  ctx.shadowBlur = energy * 20;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number,
  _time: number, hue: number
) {
  const pulseRadius = radius * (0.8 + energy * 0.6);
  const [r, g, b] = hslToRgb(hue % 360, 90, 40 + energy * 30);

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.6 + energy * 0.4})`);
  gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${0.2 + energy * 0.2})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.fill();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number,
  time: number, hue: number, count: number
) {
  const [r, g, b] = hslToRgb(hue % 360, 70, 60);

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + time * 0.3;
    const dist = radius + Math.sin(time * 1.5 + i * 0.7) * radius * 0.15;
    const size = 1 + energy * 3;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;

    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.2 + energy * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
