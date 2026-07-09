import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface PaintSplashProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  life: number; // 1 → 0
}

/**
 * Beat-driven action painting: every onset flings a splash of paint onto the
 * canvas — a central blob plus radiating droplets that fly, land, and slowly
 * dry into the background. Bass throws big low splats, highs flick fine
 * spatter near the top. The canvas fades like paint sinking into black paper.
 */
export function PaintSplash({ fftRef, lastUpdateRef, width, height }: PaintSplashProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const dropletsRef = useRef<Droplet[]>([]);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const maxDroplets = quality === 'low' ? 150 : quality === 'high' ? 600 : 320;

    ctx.fillStyle = 'rgb(10, 10, 20)';
    ctx.fillRect(0, 0, width, height);

    // Irregular blob — a wobbly polygon so no two splats look alike
    const drawBlob = (x: number, y: number, r: number, fill: string) => {
      const lobes = 7 + Math.floor(Math.random() * 5);
      const phase = Math.random() * Math.PI * 2;
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const wobble = 1 + 0.35 * Math.sin(a * lobes + phase) + 0.15 * Math.sin(a * 3 + phase * 2);
        const px = x + Math.cos(a) * r * wobble;
        const py = y + Math.sin(a) * r * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    const spawnDroplets = (x: number, y: number, power: number, hue: number, count: number, spread = Math.PI * 2, baseAngle = 0) => {
      const droplets = dropletsRef.current;
      for (let i = 0; i < count && droplets.length < maxDroplets; i++) {
        const a = baseAngle + (Math.random() - 0.5) * spread;
        const v = (1 + Math.random() * 4) * (1 + power * 2.5);
        droplets.push({
          x,
          y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - power * 2,
          size: 1 + Math.random() * 3.5 * (0.5 + power),
          hue: (hue + Math.random() * 50 - 25 + 360) % 360,
          life: 1,
        });
      }
    };

    // Every splash picks its own palette — sometimes on-theme, often wild
    const pickHue = (bandHue: number) =>
      Math.random() < 0.45 ? Math.random() * 360 : (bandHue + Math.random() * 40 - 20 + 360) % 360;

    const splash = (x: number, y: number, power: number, bandHue: number) => {
      const hue = pickHue(bandHue);
      const hue2 = (hue + 120 + Math.random() * 120) % 360; // clashing second color
      const [r, g, b] = hslToRgb(hue, 90, 55 + power * 15);
      const [r2, g2, b2] = hslToRgb(hue2, 92, 65);
      const radius = 8 + power * 46;
      const style = Math.random();

      if (style < 0.4) {
        // Classic splat: blob + lighter core
        drawBlob(x, y, radius, `rgba(${r}, ${g}, ${b}, ${0.5 + power * 0.35})`);
        drawBlob(x, y, radius * 0.45, `rgba(${r2}, ${g2}, ${b2}, ${0.4 + power * 0.3})`);
        spawnDroplets(x, y, power, hue, Math.floor(6 + power * 22));
      } else if (style < 0.62) {
        // Streaks: paint flung hard in a few directions
        const streaks = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < streaks; i++) {
          const a = Math.random() * Math.PI * 2;
          const len = radius * (1.2 + Math.random() * 2.2);
          const w = 2 + power * 7 * Math.random();
          const sHue = Math.random() < 0.5 ? hue : hue2;
          const [sr, sg, sb] = hslToRgb(sHue, 90, 58);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a);
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${0.45 + power * 0.3})`;
          ctx.beginPath();
          ctx.ellipse(len / 2, 0, len / 2, w, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          spawnDroplets(x + Math.cos(a) * len, y + Math.sin(a) * len, power * 0.8, sHue, 4, 1.2, a);
        }
        drawBlob(x, y, radius * 0.5, `rgba(${r}, ${g}, ${b}, ${0.55 + power * 0.3})`);
      } else if (style < 0.82) {
        // Ring splatter: a broken circle of paint, like a dropped can
        const ringR = radius * (1.2 + Math.random());
        const segs = 8 + Math.floor(Math.random() * 8);
        for (let i = 0; i < segs; i++) {
          if (Math.random() < 0.25) continue; // gaps make it read as splatter
          const a0 = (i / segs) * Math.PI * 2;
          const sHue = Math.random() < 0.5 ? hue : hue2;
          const [sr, sg, sb] = hslToRgb(sHue, 88, 58);
          ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, ${0.5 + power * 0.3})`;
          ctx.lineWidth = 2 + power * 8 * Math.random();
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(x, y, ringR * (0.92 + Math.random() * 0.16), a0, a0 + (Math.PI * 2) / segs * 0.7);
          ctx.stroke();
        }
        drawBlob(x, y, radius * 0.4, `rgba(${r2}, ${g2}, ${b2}, ${0.5 + power * 0.3})`);
        spawnDroplets(x, y, power, hue2, Math.floor(4 + power * 14));
      } else {
        // Brush swipe: a curved stroke that tapers, dripping at the end
        const a = Math.random() * Math.PI * 2;
        const len = radius * (2 + Math.random() * 2.5);
        const segs = 14;
        const curve = (Math.random() - 0.5) * 1.6;
        for (let i = 0; i < segs; i++) {
          const f = i / segs;
          const sx = x + Math.cos(a + curve * f) * len * f;
          const sy = y + Math.sin(a + curve * f) * len * f;
          const w = (1 - f) * (4 + power * 14) + 1;
          const sHue = (hue + f * 60) % 360;
          const [sr, sg, sb] = hslToRgb(sHue, 90, 55 + f * 15);
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${(0.55 + power * 0.3) * (1 - f * 0.4)})`;
          ctx.beginPath();
          ctx.arc(sx, sy, w, 0, Math.PI * 2);
          ctx.fill();
        }
        spawnDroplets(x + Math.cos(a + curve) * len, y + Math.sin(a + curve) * len, power, hue, 6, 1.4, a + curve);
      }
    };

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      // Paint slowly dries into the dark
      ctx.fillStyle = 'rgba(10, 10, 20, 0.02)';
      ctx.fillRect(0, 0, width, height);

      const hueBase = (t * 18) % 360;

      // Band onsets throw paint: bass low and huge, mids center, highs fine and top
      if (beat.onset.subBass || beat.onset.bass) {
        const power = Math.min(1, beat.pulse.bass * 0.6 + beat.pulse.subBass * 0.6);
        splash(
          width * (0.15 + Math.random() * 0.7),
          height * (0.55 + Math.random() * 0.35),
          power,
          hueBase
        );
      }
      if (beat.onset.mids) {
        splash(
          width * (0.1 + Math.random() * 0.8),
          height * (0.25 + Math.random() * 0.5),
          beat.pulse.mids * 0.7,
          (hueBase + 90) % 360
        );
      }
      if (beat.onset.highs || beat.onset.air) {
        const power = Math.max(beat.pulse.highs, beat.pulse.air) * 0.45;
        splash(
          width * (0.1 + Math.random() * 0.8),
          height * (0.05 + Math.random() * 0.35),
          power,
          (hueBase + 190) % 360
        );
      }

      // Quiet music still drips a little
      if (data.rms > 0.02 && Math.random() < data.rms * sensitivity * 0.5) {
        splash(Math.random() * width, Math.random() * height, data.rms * 0.3, (hueBase + Math.random() * 360) % 360);
      }

      // Animate flying droplets
      const droplets = dropletsRef.current;
      for (let i = droplets.length - 1; i >= 0; i--) {
        const d = droplets[i];
        d.x += d.vx * speed;
        d.y += d.vy * speed;
        d.vy += 0.12 * speed; // gravity
        d.vx *= 0.985;
        d.life -= 0.02 * speed;

        if (d.life <= 0 || d.y > height + 20) {
          // Droplet lands — leaves a permanent little dot
          if (d.y <= height + 20) {
            const [r, g, b] = hslToRgb(d.hue, 80, 50);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.size * 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
          droplets.splice(i, 1);
          continue;
        }

        const [r, g, b] = hslToRgb(d.hue, 85, 60);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.7 * d.life})`;
        ctx.beginPath();
        // Stretch droplets along their velocity for a flung look
        const stretch = Math.min(3, 1 + Math.hypot(d.vx, d.vy) * 0.15);
        ctx.ellipse(d.x, d.y, d.size * stretch, d.size, Math.atan2(d.vy, d.vx), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
