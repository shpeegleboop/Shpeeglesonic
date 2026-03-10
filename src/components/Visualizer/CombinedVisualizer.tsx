import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface CombinedProps {
  fftRef: React.RefObject<FFTData>;
  width: number;
  height: number;
}

export function CombinedVisualizer({ fftRef, width, height }: CombinedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const rotBoostRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Offscreen canvas for mirror-compositing spirals/particles
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

    // Super-sensitive multiplier for transient response
    const highSens = 1.8;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = fftRef.current;
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      // Rotation boost on beats
      if (beat.onset.bass || beat.onset.subBass) {
        rotBoostRef.current = Math.min(rotBoostRef.current + 1.2, 3.5);
      }
      rotBoostRef.current *= 0.92;
      const rotSpeed = 0.4 + rotBoostRef.current;

      // Bass-driven radius expansion for center
      const bassPulse = beat.pulse.subBass * 0.5 + beat.pulse.bass * 0.5;
      const radiusPulse = 1.0 + bassPulse * 0.35;

      // === MAIN CANVAS: trail fade ===
      ctx.fillStyle = 'rgba(10, 10, 20, 0.055)';
      ctx.fillRect(0, 0, width, height);

      const hue = (t * 18) % 360;

      // === OFFSCREEN: clear for this frame's mirrored elements ===
      offCtx.clearRect(0, 0, width, height);

      // === Draw spirals + particles to offscreen (driven by mids/highs) ===

      // Inner spirals — 8-fold, CW, mids-driven
      drawSymmetryGroup(offCtx, cx, cy, {
        innerRadius: maxR * 0.18,
        outerRadius: maxR * 0.42 * radiusPulse,
        symmetry: 8,
        rotation: t * rotSpeed * 0.6,
        spiralTightness: 3,
        energy: beat.energy.mids * highSens,
        pulse: beat.pulse.mids * highSens,
        hue: hue + 0,
        pointCount: 60,
        lineWidth: 1.2,
        waveFreq: 8,
        waveSpeed: 3,
        t,
      });

      // Middle spirals — 12-fold, CCW, highs-driven
      drawSymmetryGroup(offCtx, cx, cy, {
        innerRadius: maxR * 0.28,
        outerRadius: maxR * 0.62 * radiusPulse,
        symmetry: 12,
        rotation: -t * rotSpeed * 0.9,
        spiralTightness: 4,
        energy: beat.energy.highs * highSens,
        pulse: beat.pulse.highs * highSens,
        hue: hue + 120,
        pointCount: 65,
        lineWidth: 0.9,
        waveFreq: 14,
        waveSpeed: 3.5,
        t,
      });

      // Outer spirals — 24-fold, CW, air-driven
      drawSymmetryGroup(offCtx, cx, cy, {
        innerRadius: maxR * 0.42,
        outerRadius: maxR * 0.85 * radiusPulse,
        symmetry: 24,
        rotation: t * rotSpeed * 1.3,
        spiralTightness: 5,
        energy: beat.energy.air * highSens * 1.5,
        pulse: beat.pulse.air * highSens * 1.5,
        hue: hue + 240,
        pointCount: 45,
        lineWidth: 0.6,
        waveFreq: 18,
        waveSpeed: 5,
        t,
      });

      // Particle orbits
      drawSymmetricParticles(offCtx, cx, cy, maxR, beat, t, hue, radiusPulse, highSens);

      // === COMPOSITE offscreen onto main canvas with 4-fold mirror symmetry ===
      ctx.globalAlpha = 0.7;
      ctx.drawImage(offscreen, 0, 0);

      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(0, height);
      ctx.scale(1, -1);
      ctx.globalAlpha = 0.5;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.translate(width, height);
      ctx.scale(-1, -1);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(offscreen, 0, 0);
      ctx.restore();

      ctx.globalAlpha = 1.0;

      // === Draw centered elements directly on main canvas (no mirror needed) ===

      // Core pulse — driven by BASS/SUB-BASS
      const coreEnergy = beat.energy.subBass * 0.6 + beat.energy.bass * 0.4;
      const corePulse = beat.pulse.subBass * 0.6 + beat.pulse.bass * 0.4;
      drawCore(ctx, cx, cy, maxR * 0.14, coreEnergy, corePulse, hue);

      // CN symmetry curves pulsing from center — replaces bar spectrogram
      drawSymmetryCurves(ctx, cx, cy, maxR * 0.12, maxR * 0.35, beat, t, hue, bassPulse);

      // Beat flash overlay — bass-driven
      if (bassPulse > 0.3) {
        const flashAlpha = (bassPulse - 0.3) * 0.2;
        const [fr, fg, fb] = hslToRgb(hue, 60, 70);
        const flashGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.8);
        flashGrad.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, ${flashAlpha})`);
        flashGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = flashGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
}

interface SymmetryGroupParams {
  innerRadius: number;
  outerRadius: number;
  symmetry: number;
  rotation: number;
  spiralTightness: number;
  energy: number;
  pulse: number;
  hue: number;
  pointCount: number;
  lineWidth: number;
  waveFreq: number;
  waveSpeed: number;
  t: number;
}

function drawSymmetryGroup(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  p: SymmetryGroupParams
) {
  const { symmetry, rotation, innerRadius, outerRadius, spiralTightness,
          energy, pulse, pointCount, lineWidth, waveFreq, waveSpeed, t } = p;

  const clampedEnergy = Math.min(1.5, energy);
  const clampedPulse = Math.min(1.5, pulse);

  const angleStep = (Math.PI * 2) / symmetry;
  const waveAmp = (clampedEnergy * 0.1 + clampedPulse * 0.15) * outerRadius;

  for (let arm = 0; arm < symmetry; arm++) {
    const armAngle = arm * angleStep + rotation;
    const armHue = (p.hue + arm * (360 / symmetry) * 0.5) % 360;

    ctx.beginPath();
    for (let i = 0; i < pointCount; i++) {
      const frac = i / pointCount;
      const spiralAngle = armAngle + frac * spiralTightness;
      const baseR = innerRadius + frac * (outerRadius - innerRadius);
      const wave = waveAmp * Math.sin(frac * waveFreq + t * waveSpeed);
      const pulseWave = clampedPulse * outerRadius * 0.08 * Math.sin(frac * Math.PI * 5 + t * 7);
      const r = baseR + wave + pulseWave;

      const x = cx + Math.cos(spiralAngle) * r;
      const y = cy + Math.sin(spiralAngle) * r;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    const lightness = 45 + clampedEnergy * 25 + clampedPulse * 25;
    const saturation = 70 + clampedPulse * 30;
    const alpha = 0.2 + clampedEnergy * 0.4 + clampedPulse * 0.35;
    const [r, g, b] = hslToRgb(armHue, Math.min(100, saturation), Math.min(95, lightness));

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.9, alpha)})`;
    ctx.lineWidth = lineWidth + clampedPulse * 2.5;
    ctx.stroke();

    if (clampedPulse > 0.15) {
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(1, clampedPulse * 0.7)})`;
      ctx.shadowBlur = clampedPulse * 30;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

/**
 * CN symmetry curves pulsing from center.
 * Draws layered rose curves (rhodonea) with different symmetry orders,
 * each driven by a frequency band. Produces sacred geometry patterns.
 */
function drawSymmetryCurves(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  innerR: number, outerR: number,
  beat: BeatDetector, t: number, hue: number, bassPulse: number
) {
  // Each layer: a rose curve r = base + amp * cos(n * theta + phase)
  // n determines the symmetry order (n petals for odd n, 2n for even)
  const layers = [
    { n: 2,  energy: beat.energy.subBass, pulse: beat.pulse.subBass, hueOff: 0,   speed: 0.3,  width: 2.5 },
    { n: 3,  energy: beat.energy.bass,    pulse: beat.pulse.bass,    hueOff: 30,  speed: -0.4, width: 2.0 },
    { n: 4,  energy: beat.energy.bass,    pulse: beat.pulse.bass,    hueOff: 60,  speed: 0.5,  width: 1.8 },
    { n: 6,  energy: beat.energy.mids,    pulse: beat.pulse.mids,    hueOff: 120, speed: -0.6, width: 1.3 },
    { n: 8,  energy: beat.energy.highs,   pulse: beat.pulse.highs,   hueOff: 180, speed: 0.8,  width: 1.0 },
    { n: 12, energy: beat.energy.air,     pulse: beat.pulse.air,     hueOff: 240, speed: -1.0, width: 0.7 },
  ];

  const range = outerR - innerR;
  // Overall scale pulses with bass
  const scale = 1.0 + bassPulse * 0.7;

  for (const layer of layers) {
    const amp = (layer.energy * 0.6 + layer.pulse * 0.8) * range * scale;
    if (amp < 0.5) continue; // skip if too quiet to see

    const rotation = t * layer.speed;
    const points = Math.max(64, layer.n * 16); // more points for higher symmetry
    const layerHue = (hue + layer.hueOff) % 360;

    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const theta = (i / points) * Math.PI * 2;
      // Rose curve: petals from cos(n * theta)
      const rose = Math.cos(layer.n * (theta + rotation));
      // Radius: base circle + rose petal extension
      const r = innerR * scale + Math.abs(rose) * amp;
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    const lightness = 45 + layer.energy * 30 + layer.pulse * 25;
    const alpha = 0.2 + layer.energy * 0.4 + layer.pulse * 0.35;
    const [r, g, b] = hslToRgb(layerHue, 85 + layer.pulse * 15, Math.min(92, lightness));

    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.85, alpha)})`;
    ctx.lineWidth = layer.width + layer.pulse * 2;
    ctx.stroke();

    // Glow on pulse
    if (layer.pulse > 0.2) {
      ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${Math.min(0.8, layer.pulse * 0.6)})`;
      ctx.shadowBlur = layer.pulse * 20;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  radius: number, energy: number, pulse: number, hue: number
) {
  const pulseRadius = radius * (0.4 + energy * 1.2 + pulse * 1.4);
  const lightness = 45 + energy * 30 + pulse * 25;
  const [r, g, b] = hslToRgb(hue, 95, Math.min(95, lightness));

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius);
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.8 + pulse * 0.2})`);
  gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, ${0.35 + energy * 0.3})`);
  gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
  ctx.fill();

  // White-hot flash on strong bass
  if (pulse > 0.35) {
    const intensity = (pulse - 0.35) * 1.0;
    const whiteGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseRadius * 0.5);
    whiteGrad.addColorStop(0, `rgba(255, 255, 255, ${Math.min(0.8, intensity)})`);
    whiteGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = whiteGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, pulseRadius * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSymmetricParticles(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  maxR: number,
  beat: BeatDetector,
  t: number, hue: number, radiusPulse: number,
  highSens: number
) {
  const rings = [
    { count: 16, radius: maxR * 0.32, energy: beat.energy.mids * highSens, pulse: beat.pulse.mids * highSens, hueOff: 0, speed: 0.5 },
    { count: 24, radius: maxR * 0.52, energy: beat.energy.highs * highSens, pulse: beat.pulse.highs * highSens, hueOff: 120, speed: -0.7 },
    { count: 32, radius: maxR * 0.75, energy: beat.energy.air * highSens * 1.5, pulse: beat.pulse.air * highSens * 1.5, hueOff: 240, speed: 0.9 },
  ];

  for (const ring of rings) {
    const particleHue = (hue + ring.hueOff) % 360;
    const clampedPulse = Math.min(1.5, ring.pulse);
    const clampedEnergy = Math.min(1.5, ring.energy);
    const [r, g, b] = hslToRgb(particleHue, 70, 55 + clampedPulse * 30);

    for (let i = 0; i < ring.count; i++) {
      const baseAngle = (i / ring.count) * Math.PI * 2 + t * ring.speed;
      const dist = ring.radius * radiusPulse + Math.sin(t * 2.0 + i * 1.1) * maxR * 0.06;
      const burstDist = dist + clampedPulse * maxR * 0.12;
      const size = 1.0 + clampedEnergy * 3 + clampedPulse * 4;
      const alpha = 0.2 + clampedEnergy * 0.4 + clampedPulse * 0.4;

      const x = cx + Math.cos(baseAngle) * burstDist;
      const y = cy + Math.sin(baseAngle) * burstDist;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.95, alpha)})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
