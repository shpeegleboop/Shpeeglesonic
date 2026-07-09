import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT, getLogBins } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface CombinedProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

/**
 * Circular spectrum analyzer: the full spectrum wraps around a ring — bass
 * at 12 o'clock, air wrapping back around — with bars radiating outward and
 * a dim mirrored reflection pointing inward. The ring breathes with the bass,
 * beat comets orbit the outside, and a sub-bass core throbs in the middle.
 * Deliberately a hard-edged, technical look — the opposite of Spiral's flow.
 */
export function CombinedVisualizer({ fftRef, lastUpdateRef, width, height }: CombinedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const smoothRef = useRef<number[]>([]);
  const cometsRef = useRef<{ angle: number; v: number; life: number; hue: number }[]>([]);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const smoothing = usePlayerStore((s) => s.visualizerSettings.smoothing);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const numBars = quality === 'low' ? 72 : quality === 'high' ? 180 : 120;
    if (smoothRef.current.length !== numBars) {
      smoothRef.current = new Array(numBars).fill(0);
    }

    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(cx, cy) * 0.92;
    const ringR = maxR * 0.42;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      const bassPulse = beat.pulse.subBass * 0.5 + beat.pulse.bass * 0.5;

      // Launch orbit comets on beats
      if ((beat.onset.bass || beat.onset.subBass) && cometsRef.current.length < 24) {
        cometsRef.current.push({
          angle: Math.random() * Math.PI * 2,
          v: (Math.random() > 0.5 ? 1 : -1) * (0.03 + bassPulse * 0.06),
          life: 1,
          hue: (t * 18 + 40) % 360,
        });
      }

      ctx.fillStyle = 'rgba(10, 10, 20, 0.22)';
      ctx.fillRect(0, 0, width, height);

      const hueBase = (t * 18) % 360;
      const bars = getLogBins(data.bins, numBars);
      const smooth = smoothRef.current;
      const ringPulse = ringR * (1 + bassPulse * 0.1);
      const rotation = t * 0.15;

      // Spectrum ring — bars outward, dim mirror inward
      for (let i = 0; i < numBars; i++) {
        const e = Math.min(1.6, ((bars[i] / 255) * sensitivity));
        smooth[i] = smooth[i] * smoothing + e * (1 - smoothing);
        const v = smooth[i];
        if (v < 0.01) continue;

        const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2 + rotation;
        const barLen = v * maxR * 0.52;
        const hue = (hueBase + (i / numBars) * 300) % 360;
        const [r, g, b] = hslToRgb(hue, 85, 50 + v * 25);

        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Outward bar
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + v * 0.55})`;
        ctx.lineWidth = Math.max(1.5, (Math.PI * 2 * ringPulse) / numBars * 0.55);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx + cos * ringPulse, cy + sin * ringPulse);
        ctx.lineTo(cx + cos * (ringPulse + barLen), cy + sin * (ringPulse + barLen));
        ctx.stroke();

        // Inward reflection, dimmer and shorter
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.12 + v * 0.2})`;
        ctx.beginPath();
        ctx.moveTo(cx + cos * (ringPulse * 0.96), cy + sin * (ringPulse * 0.96));
        ctx.lineTo(cx + cos * (ringPulse * 0.96 - barLen * 0.35), cy + sin * (ringPulse * 0.96 - barLen * 0.35));
        ctx.stroke();

        // Peak dot
        if (v > 0.5) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(v - 0.5) * 0.9})`;
          ctx.beginPath();
          ctx.arc(cx + cos * (ringPulse + barLen), cy + sin * (ringPulse + barLen), 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Base ring
      const [rr, rg, rb] = hslToRgb(hueBase, 70, 55);
      ctx.strokeStyle = `rgba(${rr}, ${rg}, ${rb}, ${0.25 + bassPulse * 0.5})`;
      ctx.lineWidth = 1.5 + bassPulse * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, ringPulse, 0, Math.PI * 2);
      ctx.stroke();

      // Orbit comets
      const comets = cometsRef.current;
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.angle += c.v * speed;
        c.life -= 0.008 * speed;
        if (c.life <= 0) {
          comets.splice(i, 1);
          continue;
        }
        const orbitR = ringPulse + maxR * 0.38 * (1 - c.life) + 10;
        const [r, g, b] = hslToRgb(c.hue, 90, 65);
        // Tail
        for (let k = 0; k < 8; k++) {
          const ta = c.angle - c.v * k * 3;
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${c.life * 0.5 * (1 - k / 8)})`;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(ta) * orbitR, cy + Math.sin(ta) * orbitR, 2.5 * (1 - k / 10), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Bottom spectrum strip — a slice of Bars mode along the floor
      const stripBins = 48;
      const stripW = width / stripBins;
      for (let i = 0; i < stripBins; i++) {
        const src = Math.floor((i / stripBins) * numBars);
        const v = smooth[src];
        if (v < 0.02) continue;
        const barH = v * height * 0.14;
        const hue = (hueBase + (i / stripBins) * 300) % 360;
        const [r, g, b] = hslToRgb(hue, 80, 52);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.18 + v * 0.3})`;
        ctx.fillRect(i * stripW + stripW * 0.12, height - barH, stripW * 0.76, barH);
      }

      // Mini counter-rotating spiral arms inside the ring — a taste of Spiral mode
      const innerR = ringPulse * 0.85;
      for (let layer = 0; layer < 2; layer++) {
        const dir = layer === 0 ? 1 : -1;
        const e = layer === 0 ? beat.energy.mids : beat.energy.highs;
        const p = layer === 0 ? beat.pulse.mids : beat.pulse.highs;
        const [r, g, b] = hslToRgb((hueBase + 60 + layer * 140) % 360, 85, 55 + p * 25);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.2 + e * 0.4 + p * 0.3})`;
        ctx.lineWidth = 1 + e * 1.5 + p * 2;
        ctx.lineCap = 'round';
        const arms = 4;
        for (let arm = 0; arm < arms; arm++) {
          const armOffset = (arm / arms) * Math.PI * 2 + t * 0.9 * dir;
          ctx.beginPath();
          for (let i = 0; i <= 30; i++) {
            const f = i / 30;
            const theta = armOffset + f * Math.PI * 1.6 * dir;
            const rr = innerR * (0.12 + f * 0.82) * (1 + p * 0.12);
            const px = cx + Math.cos(theta) * rr;
            const py = cy + Math.sin(theta) * rr;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
      }

      // Sub-bass core
      const coreE = beat.energy.subBass * 0.6 + beat.energy.bass * 0.4;
      const coreR = ringPulse * 0.55 * (0.5 + coreE * 0.7 + bassPulse * 0.5);
      const [gr, gg, gb] = hslToRgb((hueBase + 30) % 360, 92, 50 + coreE * 30);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      grad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${0.65 + bassPulse * 0.3})`);
      grad.addColorStop(0.5, `rgba(${gr}, ${gg}, ${gb}, ${0.2 + coreE * 0.2})`);
      grad.addColorStop(1, `rgba(${gr}, ${gg}, ${gb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, smoothing, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
