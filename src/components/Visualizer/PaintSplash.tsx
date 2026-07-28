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

type MarkKind = 'blob' | 'swipe' | 'ring' | 'spatter';

interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  angle: number;
  /** Stable per-mark randomness. The canvas is redrawn every frame, so a shape
   *  built from Math.random() at draw time would flicker; everything wobbly
   *  derives from this instead. */
  seed: number;
  size: number;
  age: number;
  life: number;
  /** Fraction of life spent growing to full size. */
  growFrac: number;
  hue: number;
  sat: number;
  light: number;
  alpha: number;
  driftX: number;
  driftY: number;
  spin: number;
}

interface Droplet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  life: number;
}

/** mulberry32 — small, fast, and deterministic from a mark's seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Beat-driven action painting on matte black.
 *
 * Every mark is a live object with its own growth, drift and fade, redrawn each
 * frame — not paint burned into the canvas. That is what lets a kick throw a
 * slow swelling blob while a hi-hat flicks spatter that is gone in a second.
 *
 * What the music controls:
 *  - fluxRatio (not pulse) grades hit strength. Pulse saturates at 1.0, so at
 *    high sensitivity every hit would look identical.
 *  - The balance of air+highs against bass+subBass is the song's "texture": a
 *    bright busy track paints small, fast, cool, angular marks; a bass-heavy
 *    one paints big, slow, warm, round ones.
 *  - Onset density sets the pace — a fast track paints and dries quickly.
 * The speed setting only scales motion, never spawning.
 */
export function PaintSplash({ fftRef, lastUpdateRef, width, height }: PaintSplashProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beatRef = useRef(new BeatDetector());
  const marksRef = useRef<Mark[]>([]);
  const dropletsRef = useRef<Droplet[]>([]);
  const seedRef = useRef(1);
  /** Onsets per frame, heavily smoothed — the painting's tempo. */
  const paceRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const maxMarks = quality === 'low' ? 40 : quality === 'high' ? 160 : 90;
    const maxDroplets = quality === 'low' ? 120 : quality === 'high' ? 500 : 260;

    const addMark = (m: Omit<Mark, 'age' | 'seed'>) => {
      const marks = marksRef.current;
      // Drop the oldest rather than refusing the newest — a loud passage should
      // still register, just at the cost of the fading marks behind it.
      if (marks.length >= maxMarks) marks.shift();
      marks.push({ ...m, age: 0, seed: seedRef.current++ });
    };

    const addDroplets = (
      x: number, y: number, count: number, power: number, hue: number,
      baseAngle: number, spread: number
    ) => {
      const drops = dropletsRef.current;
      for (let i = 0; i < count && drops.length < maxDroplets; i++) {
        const a = baseAngle + (Math.random() - 0.5) * spread;
        const v = (1.2 + Math.random() * 3.5) * (0.6 + power);
        drops.push({
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - power * 1.5,
          size: 1 + Math.random() * 3 * (0.4 + power),
          hue: (hue + Math.random() * 40 - 20 + 360) % 360,
          life: 1,
        });
      }
    };

    // ---- shape drawing, all deterministic from mark.seed ----

    const strokeBlob = (m: Mark, r: number, fill: string) => {
      const rand = rng(m.seed);
      // Few lobes, gentle wobble and a dense outline: more lobes than segments
      // can resolve turned these into faceted stars rather than paint.
      const lobes = 5 + Math.floor(rand() * 4);
      const phase = rand() * Math.PI * 2;
      const wob = 0.1 + rand() * 0.18;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const k = 1 + wob * Math.sin(a * lobes + phase) + wob * 0.5 * Math.sin(a * 3 + phase * 2);
        const px = m.x + Math.cos(a) * r * k;
        const py = m.y + Math.sin(a) * r * k;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    const drawMark = (m: Mark, grow: number, alpha: number) => {
      const r = m.size * grow;
      if (r < 0.5 || alpha <= 0.004) return;
      const [cr, cg, cb] = hslToRgb(m.hue, m.sat, m.light);
      const fill = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
      const rand = rng(m.seed);

      if (m.kind === 'blob') {
        strokeBlob(m, r, fill);
        // Lighter core, offset a little so it doesn't read as a bullseye
        const [lr, lg, lb] = hslToRgb((m.hue + 18) % 360, m.sat, Math.min(88, m.light + 22));
        ctx.beginPath();
        ctx.arc(m.x + (rand() - 0.5) * r * 0.4, m.y + (rand() - 0.5) * r * 0.4, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, ${alpha * 0.75})`;
        ctx.fill();
      } else if (m.kind === 'swipe') {
        const len = r * 3.2;
        const curve = (rand() - 0.5) * 1.5;
        const segs = 16;
        for (let i = 0; i < segs; i++) {
          const f = i / segs;
          const a = m.angle + m.spin + curve * f;
          const sx = m.x + Math.cos(a) * len * f;
          const sy = m.y + Math.sin(a) * len * f;
          const w = (1 - f * 0.75) * r * 0.5 + 1;
          const [sr, sg, sb] = hslToRgb((m.hue + f * 40) % 360, m.sat, m.light + f * 10);
          ctx.beginPath();
          ctx.arc(sx, sy, w, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${alpha * (1 - f * 0.35)})`;
          ctx.fill();
        }
      } else if (m.kind === 'ring') {
        const segs = 9 + Math.floor(rand() * 7);
        ctx.lineCap = 'round';
        for (let i = 0; i < segs; i++) {
          if (rand() < 0.28) continue; // gaps read as splatter, not a circle
          const a0 = (i / segs) * Math.PI * 2 + m.angle + m.spin;
          ctx.strokeStyle = fill;
          ctx.lineWidth = Math.max(1, r * (0.08 + rand() * 0.14));
          ctx.beginPath();
          ctx.arc(m.x, m.y, r * (0.9 + rand() * 0.2), a0, a0 + ((Math.PI * 2) / segs) * 0.65);
          ctx.stroke();
        }
      } else {
        // spatter: a tight cluster of dots, angular and quick
        const dots = 5 + Math.floor(rand() * 7);
        for (let i = 0; i < dots; i++) {
          const a = rand() * Math.PI * 2;
          const d = rand() * r * 1.5;
          const s = r * (0.1 + rand() * 0.22);
          ctx.beginPath();
          ctx.arc(m.x + Math.cos(a) * d, m.y + Math.sin(a) * d, s, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
        }
      }
    };

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      // Matte black, cleared outright — no partial fade, which is what left
      // grey ghosts behind everything before.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      // --- texture: how bright the song is right now ---
      const lowE = beat.energy.bass + beat.energy.subBass;
      const highE = beat.energy.highs + beat.energy.air;
      // 0 = pure bass weight, 1 = all air. Guarded so silence sits mid-scale
      // rather than swinging wildly on noise.
      const bright = Math.max(0, Math.min(1, highE / (highE + lowE + 0.02)));

      // --- pace: how fast beats are arriving, smoothed into a tempo ---
      const onsetNow = beat.onset.any ? 1 : 0;
      paceRef.current = paceRef.current * 0.99 + onsetNow * 0.01;
      // 0.6 (sparse) → 1.8 (dense). Dense music paints and dries faster.
      const pace = 0.6 + Math.min(1, paceRef.current * 14) * 1.2;

      const spawn = (
        kind: MarkKind, x: number, y: number, strength: number,
        baseHue: number, sizeBase: number, lifeBase: number
      ) => {
        // fluxRatio is unbounded, so a monster hit really does paint bigger —
        // but clamped, or one huge transient covers the canvas.
        const s = Math.max(0.25, Math.min(1.8, strength));
        addMark({
          kind,
          x, y,
          angle: Math.random() * Math.PI * 2,
          // Bright songs paint smaller and tighter; bass-heavy ones sprawl.
          size: sizeBase * (0.5 + s * 0.45) * (1.25 - bright * 0.6),
          life: (lifeBase / pace) * (0.75 + Math.random() * 0.5),
          growFrac: 0.1 + (1 - bright) * 0.25,
          hue: (baseHue + (Math.random() - 0.5) * 30 + 360) % 360,
          // Bright, busy passages get more saturated, lighter paint.
          sat: 62 + bright * 30,
          light: 40 + s * 12 + bright * 12,
          // Kept well under opaque: these overlap constantly, and at high alpha
          // a few marks merge into one flat wash instead of layered paint.
          alpha: Math.min(0.62, 0.25 + s * 0.2),
          driftX: (Math.random() - 0.5) * 0.5 * (0.4 + bright),
          driftY: (Math.random() - 0.5) * 0.4 - bright * 0.15,
          spin: 0,
        });
      };

      // Hue follows where the energy is: bass warm, mids green/teal, air violet.
      const bassHue = 8 + bright * 40;
      const midHue = 140 + bright * 60;
      const airHue = 230 + bright * 70;

      // --- low end: big, slow, round ---
      if (beat.onset.bass || beat.onset.subBass) {
        const s = Math.max(beat.fluxRatio.bass, beat.fluxRatio.subBass);
        spawn(
          bright > 0.62 ? 'ring' : 'blob',
          width * (0.12 + Math.random() * 0.76),
          height * (0.45 + Math.random() * 0.45),
          s, bassHue,
          Math.min(width, height) * 0.06,
          210
        );
        addDroplets(width * 0.5, height * 0.7, Math.floor(4 + s * 8), Math.min(1, s * 0.4), bassHue, Math.random() * 6.28, Math.PI * 2);
      }

      // --- mids: brush strokes across the middle ---
      if (beat.onset.mids) {
        spawn(
          'swipe',
          width * (0.08 + Math.random() * 0.84),
          height * (0.2 + Math.random() * 0.6),
          beat.fluxRatio.mids, midHue,
          Math.min(width, height) * 0.035,
          130
        );
      }

      // --- highs/air: fine fast spatter up top ---
      if (beat.onset.highs || beat.onset.air) {
        const s = Math.max(beat.fluxRatio.highs, beat.fluxRatio.air);
        const x = width * (0.06 + Math.random() * 0.88);
        const y = height * (0.04 + Math.random() * 0.45);
        spawn('spatter', x, y, s, airHue, Math.min(width, height) * 0.026, 70);
        addDroplets(x, y, Math.floor(3 + s * 6), Math.min(1, s * 0.3), airHue, -Math.PI / 2, Math.PI * 1.4);
      }

      // --- draw marks: grow in, hold, then a long tail so overlapping
      //     lifetimes still read as layered paint ---
      const marks = marksRef.current;
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i];
        m.age += speed;
        m.x += m.driftX * speed;
        m.y += m.driftY * speed;
        m.spin += 0.0015 * speed;

        const t = m.age / m.life;
        if (t >= 1) {
          marks.splice(i, 1);
          continue;
        }
        // Ease-out growth, so a mark lands fast and then settles.
        const g = t < m.growFrac ? 1 - Math.pow(1 - t / m.growFrac, 3) : 1;
        // Quick to full opacity, then a long cubic tail.
        const fadeIn = Math.min(1, t / 0.06);
        const tail = Math.pow(1 - t, 2.2);
        drawMark(m, g, m.alpha * fadeIn * tail);
      }

      // --- flying droplets ---
      const drops = dropletsRef.current;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.x += d.vx * speed;
        d.y += d.vy * speed;
        d.vy += 0.11 * speed;
        d.vx *= 0.985;
        d.life -= 0.016 * speed;
        if (d.life <= 0 || d.y > height + 30) {
          drops.splice(i, 1);
          continue;
        }
        const [r, g, b] = hslToRgb(d.hue, 80, 58);
        const stretch = Math.min(3, 1 + Math.hypot(d.vx, d.vy) * 0.14);
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.size * stretch, d.size, Math.atan2(d.vy, d.vx), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.75 * d.life})`;
        ctx.fill();
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
