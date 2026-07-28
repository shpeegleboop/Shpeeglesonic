import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface FireworksProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

/** Burst shapes. Which one fires is chosen by band and by how hard the hit was. */
type BurstKind = 'peony' | 'ring' | 'willow' | 'crackle' | 'palm';

interface Spark {
  x: number;
  y: number;
  px: number; // previous position — the trail is drawn as a segment
  py: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  size: number;
  hue: number;
  sat: number;
  light: number;
  life: number;
  decay: number;
  /** >0 makes a spark flicker near the end, like a crackling star. */
  twinkle: number;
}

/**
 * Fireworks: every onset detonates a shell.
 *
 * Bursts fire on the beat rather than launching first, so the explosion lands
 * with the hit instead of trailing it. What varies, and why:
 *  - Band picks the shape and where it goes off. Bass throws big slow peonies
 *    and willows low on screen, mids ring out across the middle, highs crackle
 *    small and fast up top.
 *  - fluxRatio scales spark count, speed and size. It is used instead of pulse
 *    because pulse saturates at 1.0, so at high sensitivity every hit would
 *    detonate identically.
 *  - The balance of air+highs against bass+subBass is the song's texture: a
 *    bright track burns smaller, faster, cooler and cracklier; a bass-heavy one
 *    throws fat, slow, warm shells.
 * Sparks leave trails against a true-black fade — the old blue-grey fade never
 * cleared and tinted the whole sky.
 */
export function Fireworks({ fftRef, lastUpdateRef, width, height }: FireworksProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beatRef = useRef(new BeatDetector());
  const sparksRef = useRef<Spark[]>([]);
  /** Smoothed onset density — busier music burns faster and smaller. */
  const paceRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const maxSparks = quality === 'low' ? 500 : quality === 'high' ? 2600 : 1400;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const burst = (
      kind: BurstKind,
      x: number,
      y: number,
      strength: number,
      hue: number,
      bright: number,
      scale: number
    ) => {
      const sparks = sparksRef.current;
      const s = Math.max(0.3, Math.min(2.2, strength));
      const R = Math.min(width, height);

      // Every shell gets its own character so two hits never look identical.
      let count: number;
      let vBase: number;
      let sizeBase: number;
      let grav: number;
      let drag: number;
      let decay: number;
      let spreadHue: number;
      let twinkle = 0;

      switch (kind) {
        case 'ring':
          count = Math.floor((44 + s * 46) * scale);
          vBase = R * 0.0075 * (0.85 + s * 0.5);
          sizeBase = 1.5 + s * 1.1;
          grav = 0.014;
          drag = 0.985;
          decay = 0.011;
          spreadHue = 24;
          break;
        case 'willow':
          count = Math.floor((30 + s * 34) * scale);
          vBase = R * 0.0055 * (0.7 + s * 0.4);
          sizeBase = 2.1 + s * 1.5;
          grav = 0.055; // heavy — the drooping trails are the point
          drag = 0.975;
          decay = 0.0055; // long-lived
          spreadHue = 18;
          break;
        case 'crackle':
          count = Math.floor((55 + s * 60) * scale);
          vBase = R * 0.009 * (0.9 + s * 0.7);
          sizeBase = 0.9 + s * 0.6;
          grav = 0.02;
          drag = 0.94; // burns out fast
          decay = 0.028;
          spreadHue = 50;
          twinkle = 1;
          break;
        case 'palm':
          count = Math.floor((14 + s * 14) * scale);
          vBase = R * 0.0095 * (0.9 + s * 0.6);
          sizeBase = 3 + s * 2.2;
          grav = 0.045;
          drag = 0.99;
          decay = 0.008;
          spreadHue = 12;
          break;
        default: // peony — the classic even sphere
          count = Math.floor((46 + s * 54) * scale);
          vBase = R * 0.0072 * (0.8 + s * 0.6);
          sizeBase = 1.7 + s * 1.3;
          grav = 0.03;
          drag = 0.982;
          decay = 0.0105;
          spreadHue = 30;
          break;
      }

      // Bright, busy passages burn smaller and quicker.
      sizeBase *= 1.15 - bright * 0.45;
      decay *= 0.85 + bright * 0.5;

      const ringPhase = Math.random() * Math.PI * 2;
      // A shell is either single-colour or a two-tone break.
      const hue2 = Math.random() < 0.45 ? (hue + 120 + Math.random() * 120) % 360 : hue;

      for (let i = 0; i < count; i++) {
        if (sparks.length >= maxSparks) break;
        let a: number;
        let v: number;
        if (kind === 'ring') {
          // Even angles with slight jitter, uniform speed — a clean expanding ring
          a = ringPhase + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.08;
          v = vBase * (0.94 + Math.random() * 0.12);
        } else if (kind === 'palm') {
          a = ringPhase + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
          v = vBase * (0.7 + Math.random() * 0.6);
        } else {
          a = Math.random() * Math.PI * 2;
          // sqrt keeps a sphere from bunching at the centre
          v = vBase * Math.sqrt(Math.random()) * 1.35;
        }
        const h = (Math.random() < 0.5 ? hue : hue2) + (Math.random() - 0.5) * spreadHue;
        sparks.push({
          x, y, px: x, py: y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          gravity: grav,
          drag,
          size: sizeBase * (0.7 + Math.random() * 0.7),
          hue: (h + 360) % 360,
          sat: 72 + bright * 25,
          light: 58 + s * 8,
          life: 1,
          decay: decay * (0.8 + Math.random() * 0.5),
          twinkle,
        });
      }

      // Flash at the detonation point
      const [fr, fg, fb] = hslToRgb(hue, 60, 92);
      const flashR = R * 0.02 * (0.6 + s);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, flashR);
      grad.addColorStop(0, `rgba(${fr}, ${fg}, ${fb}, 0.75)`);
      grad.addColorStop(1, `rgba(${fr}, ${fg}, ${fb}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, flashR, 0, Math.PI * 2);
      ctx.fill();
    };

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity);

      // True black, faded not cleared — the fade is what draws the trails.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.19)';
      ctx.fillRect(0, 0, width, height);

      const lowE = beat.energy.bass + beat.energy.subBass;
      const highE = beat.energy.highs + beat.energy.air;
      const bright = Math.max(0, Math.min(1, highE / (highE + lowE + 0.02)));

      paceRef.current = paceRef.current * 0.99 + (beat.onset.any ? 1 : 0) * 0.01;
      const dense = Math.min(1, paceRef.current * 14);
      // Dense music fires many small shells; sparse music fires fewer, bigger.
      const scale = 1.15 - dense * 0.45;

      // Warm at the bottom of the spectrum through to cool at the top, shifted
      // by how bright the track currently is.
      const bassHue = (10 + bright * 40) % 360;
      const midHue = (150 + bright * 60) % 360;
      const airHue = (215 + bright * 90) % 360;

      if (beat.onset.bass || beat.onset.subBass) {
        const s = Math.max(beat.fluxRatio.bass, beat.fluxRatio.subBass);
        // Harder hits earn the showier shells.
        const kind: BurstKind = s > 1.9 ? 'palm' : s > 1.2 ? 'willow' : 'peony';
        burst(
          kind,
          width * (0.18 + Math.random() * 0.64),
          height * (0.42 + Math.random() * 0.34),
          s, bassHue, bright, scale
        );
      }

      if (beat.onset.mids) {
        const s = beat.fluxRatio.mids;
        burst(
          s > 1.5 ? 'ring' : 'peony',
          width * (0.12 + Math.random() * 0.76),
          height * (0.2 + Math.random() * 0.45),
          s, midHue, bright, scale * 0.85
        );
      }

      if (beat.onset.highs || beat.onset.air) {
        const s = Math.max(beat.fluxRatio.highs, beat.fluxRatio.air);
        burst(
          'crackle',
          width * (0.08 + Math.random() * 0.84),
          height * (0.06 + Math.random() * 0.4),
          s, airHue, bright, scale * 0.8
        );
      }

      // --- sparks ---
      const sparks = sparksRef.current;
      ctx.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.px = sp.x;
        sp.py = sp.y;
        sp.x += sp.vx * speed;
        sp.y += sp.vy * speed;
        sp.vy += sp.gravity * speed;
        sp.vx *= Math.pow(sp.drag, speed);
        sp.vy *= Math.pow(sp.drag, speed);
        sp.life -= sp.decay * speed;

        if (sp.life <= 0 || sp.y > height + 40) {
          sparks.splice(i, 1);
          continue;
        }

        let a = sp.life;
        if (sp.twinkle > 0 && sp.life < 0.55) {
          // Crackling stars flicker out rather than dimming smoothly
          a *= Math.random() < 0.45 ? 0.15 : 1.3;
        }
        const [r, g, b] = hslToRgb(sp.hue, sp.sat, sp.light);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(1, a)})`;
        ctx.lineWidth = sp.size * (0.45 + sp.life * 0.75);
        ctx.beginPath();
        ctx.moveTo(sp.px, sp.py);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
