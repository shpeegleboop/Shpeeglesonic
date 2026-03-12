import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface RadialSpiralProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

export function RadialSpiral({ fftRef, lastUpdateRef, width, height }: RadialSpiralProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const rotBoostRef = useRef(0);
  const morphRef = useRef(0); // morphing wave phase that kicks on beats
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Offscreen for mirror compositing
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenRef.current;
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(cx, cy) * 0.9;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      const t = timeRef.current;

      // Rotation boost on bass
      if (beat.onset.bass || beat.onset.subBass) {
        rotBoostRef.current = Math.min(rotBoostRef.current + 1.0, 3.0);
        morphRef.current += 0.5; // morph phase jumps on beat
      }
      rotBoostRef.current *= 0.93;
      morphRef.current *= 0.97; // slow morph decay

      const rotSpeed = 0.5 + rotBoostRef.current;
      const radiusPulse = 1.0 + beat.pulse.combined * 0.35;
      const morph = morphRef.current;

      // Trail fade — slow for rich pattern buildup
      ctx.fillStyle = 'rgba(10, 10, 20, 0.08)';
      ctx.fillRect(0, 0, width, height);

      const hueBase = (t * 22) % 360;

      // === OFFSCREEN: clear for mirrored elements ===
      offCtx.clearRect(0, 0, width, height);

      // === Outer layers drawn to offscreen for mirroring ===

      // Air particles — 60 particles, burst on highs
      drawParticles(offCtx, cx, cy, maxR * 0.82 * radiusPulse, beat.energy.air, beat.pulse.air, t, hueBase + 180, 60);

      // Highs: 16-petal ring, CCW, thin + sparkly
      drawMorphRing(offCtx, cx, cy, maxR * 0.72 * radiusPulse, beat.energy.highs, beat.pulse.highs, t, -rotSpeed * 1.4, 16, hueBase + 150, 1.0, morph);

      // Upper mids: 12-petal ring, CW
      drawMorphRing(offCtx, cx, cy, maxR * 0.58 * radiusPulse, beat.energy.highs * 0.5 + beat.energy.mids * 0.5, beat.pulse.mids, t, rotSpeed * 1.1, 12, hueBase + 100, 1.3, morph);

      // Mids: 8-petal ring, CCW
      drawMorphRing(offCtx, cx, cy, maxR * 0.45 * radiusPulse, beat.energy.mids, beat.pulse.mids, t, -rotSpeed * 0.8, 8, hueBase + 60, 1.8, morph);

      // Bass: 6-petal ring, CW, thicc
      drawMorphRing(offCtx, cx, cy, maxR * 0.32 * radiusPulse, beat.energy.bass, beat.pulse.bass, t, rotSpeed * 0.6, 6, hueBase + 20, 2.5, morph);

      // === COMPOSITE offscreen with 4-fold mirror ===
      ctx.globalAlpha = 0.65;
      ctx.drawImage(offscreen, 0, 0);

      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(0, height);
      ctx.scale(1, -1);
      ctx.globalAlpha = 0.45;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(width, height);
      ctx.scale(-1, -1);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.globalAlpha = 1.0;

      // === Centered elements on main canvas (no mirror) ===

      // CN symmetry curves pulsing from core
      drawSymmetryCurves(ctx, cx, cy, maxR * 0.08, maxR * 0.28, beat, t, hueBase, morph);

      // Sub-bass core — big throb
      drawCore(ctx, cx, cy, maxR * 0.15, beat.energy.subBass, beat.pulse.subBass, t, hueBase);
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
}

function drawMorphRing(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number, pulse: number,
  time: number, direction: number,
  petals: number, hue: number, baseLineWidth: number,
  morph: number
) {
  const points = 180;
  const rotation = time * direction;

  // Distortion: base energy + pulse spike + morph wobble
  const distortionAmp = (energy * 0.4 + pulse * 0.6) * radius;
  // Morph adds a secondary frequency that shifts the petal shape
  const morphAmp = morph * radius * 0.15;
  const lineWidth = baseLineWidth + energy * 2 + pulse * 5;

  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2 + rotation;
    const primary = distortionAmp * Math.sin(angle * petals + time * 2.5);
    // Secondary morphing harmonic — creates wiggling, shifting petal shapes
    const secondary = morphAmp * Math.sin(angle * (petals + 2) + time * 4);
    // Tertiary pulse ripple
    const ripple = pulse * radius * 0.08 * Math.sin(angle * petals * 2 + time * 6);
    const r = radius + primary + secondary + ripple;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  const lightness = 48 + energy * 22 + pulse * 25;
  const alpha = 0.25 + energy * 0.4 + pulse * 0.35;
  const [r, g, b] = hslToRgb(hue % 360, 80 + pulse * 20, Math.min(95, lightness));
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  // Glow
  if (pulse > 0.15) {
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, 0.4 + pulse * 0.5)})`;
    ctx.shadowBlur = energy * 12 + pulse * 35;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function drawSymmetryCurves(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  innerR: number, outerR: number,
  beat: BeatDetector, t: number, hue: number, morph: number
) {
  const layers = [
    { n: 2,  energy: beat.energy.subBass, pulse: beat.pulse.subBass, hueOff: 0,   speed: 0.3,  width: 2.2 },
    { n: 3,  energy: beat.energy.bass,    pulse: beat.pulse.bass,    hueOff: 40,  speed: -0.5, width: 1.8 },
    { n: 4,  energy: beat.energy.bass,    pulse: beat.pulse.bass,    hueOff: 80,  speed: 0.6,  width: 1.5 },
    { n: 6,  energy: beat.energy.mids,    pulse: beat.pulse.mids,    hueOff: 120, speed: -0.7, width: 1.1 },
    { n: 8,  energy: beat.energy.highs,   pulse: beat.pulse.highs,   hueOff: 200, speed: 0.9,  width: 0.8 },
    { n: 12, energy: beat.energy.air,     pulse: beat.pulse.air,     hueOff: 270, speed: -1.1, width: 0.6 },
  ];

  const range = outerR - innerR;
  const bassPulse = beat.pulse.subBass * 0.5 + beat.pulse.bass * 0.5;
  const scale = 1.0 + bassPulse * 0.8;

  for (const layer of layers) {
    const amp = (layer.energy * 0.6 + layer.pulse * 0.9) * range * scale;
    if (amp < 0.5) continue;

    const rotation = t * layer.speed;
    const morphWave = morph * range * 0.1;
    const points = Math.max(72, layer.n * 16);
    const layerHue = (hue + layer.hueOff) % 360;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const theta = (i / points) * Math.PI * 2;
      const rose = Math.cos(layer.n * (theta + rotation));
      const morphDistort = morphWave * Math.sin((layer.n + 1) * theta + t * 3);
      const r = innerR * scale + Math.abs(rose) * amp + morphDistort;
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    const lightness = 45 + layer.energy * 28 + layer.pulse * 25;
    const alpha = 0.2 + layer.energy * 0.4 + layer.pulse * 0.4;
    const [r, g, b] = hslToRgb(layerHue, 85 + layer.pulse * 15, Math.min(92, lightness));
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.85, alpha)})`;
    ctx.lineWidth = layer.width + layer.pulse * 2.5;
    ctx.stroke();

    if (layer.pulse > 0.2) {
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(0.8, layer.pulse * 0.6)})`;
      ctx.shadowBlur = layer.pulse * 22;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number, pulse: number,
  _time: number, hue: number
) {
  const pulseRadius = radius * (0.5 + energy * 1.0 + pulse * 1.2);
  const lightness = 42 + energy * 30 + pulse * 28;
  const [r, g, b] = hslToRgb(hue % 360, 92, Math.min(92, lightness));

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.7 + pulse * 0.3})`);
  gradient.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, ${0.3 + energy * 0.25})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.fill();

  if (pulse > 0.4) {
    const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius * 0.5);
    flashGrad.addColorStop(0, `rgba(255, 255, 255, ${(pulse - 0.4) * 0.8})`);
    flashGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = flashGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseRadius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number, pulse: number,
  time: number, hue: number, count: number
) {
  const [r, g, b] = hslToRgb(hue % 360, 70, 58 + pulse * 28);

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + time * 0.35;
    const dist = radius + Math.sin(time * 1.8 + i * 0.8) * radius * 0.12;
    const burstDist = dist + pulse * radius * 0.18;
    const size = 1 + energy * 3 + pulse * 4;
    const x = cx + Math.cos(angle) * burstDist;
    const y = cy + Math.sin(angle) * burstDist;

    const alpha = 0.15 + energy * 0.4 + pulse * 0.45;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, alpha)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}
