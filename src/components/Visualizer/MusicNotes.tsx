import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { hslToRgb, getDecayedFFT, getLogBins } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface MusicNotesProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

interface Note {
  /** Drift centre. The drawn x is this plus the sway offset, so the weave is a
   *  real displacement rather than an integrated velocity that cancels out. */
  baseX: number;
  x: number;
  y: number;
  vy: number;
  /** Slow horizontal fan, so a bin's notes stop stacking in one vertical line. */
  vx: number;
  size: number;
  hue: number;
  swayPhase: number;
  swayAmp: number;
  swayRate: number;
  rot: number;
  rotV: number;
  life: number;
  kind: 0 | 1 | 2; // quarter, eighth, beamed pair
  fate: 'explode' | 'dissipate';
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hue: number;
  life: number;
}

const NUM_BINS = 20;

/**
 * Frequency-driven notation: the spectrum is split into 20 log bins mapped
 * left (bass) to right (air). A loud bin pops a note at its pitch position —
 * spawn rate and size come purely from the audio. The speed setting only
 * changes how notes float, spin, and end: some dissolve into nothing, others
 * explode into sparks. Glyphs are drawn by hand so they render identically
 * on every platform.
 */
export function MusicNotes({ fftRef, lastUpdateRef, width, height }: MusicNotesProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const notesRef = useRef<Note[]>([]);
  const sparksRef = useRef<Spark[]>([]);
  const smoothBinsRef = useRef<number[]>(new Array(NUM_BINS).fill(0));
  // Per-bin running peak. Raw FFT magnitude is dominated by bass, so without
  // normalising each band against its own recent loudness the low bins spawn
  // nearly every note and the whole display piles into the left third.
  const peaksRef = useRef<number[]>(new Array(NUM_BINS).fill(0.05));
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const smoothing = usePlayerStore((s) => s.visualizerSettings.smoothing);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Raised alongside the longer lifetimes: notes now occupy the whole canvas
    // instead of piling up near the bottom, so the same count reads as far less
    // crowded and the cap would otherwise throttle spawning.
    const maxNotes = quality === 'low' ? 60 : quality === 'high' ? 260 : 140;
    const maxSparks = maxNotes * 4;

    const spawnNote = (bin: number, energy: number) => {
      const notes = notesRef.current;
      if (notes.length >= maxNotes) return;
      const frac = bin / (NUM_BINS - 1); // 0 = bass, 1 = air
      // Bass: big slow notes low on screen edge of spectrum; highs: small quick ones
      // Trimmed from (4 + energy * 14): at high sensitivity a bass note reached
      // a ~31px head, and overlapping glyphs that size are what read as a
      // smudge however far they travel.
      const size = (3.5 + energy * 9) * (1.2 - frac * 0.65);
      const baseX = (frac * 0.9 + 0.05) * width + (Math.random() - 0.5) * width * 0.1;
      notes.push({
        baseX,
        x: baseX,
        y: height + size * 2,
        // Fast enough that a note crosses most of the canvas within its life:
        // the old speeds carried a bass note under a fifth of the way up.
        vy: -(1.8 + energy * 2.2) * (0.85 + frac * 0.5),
        vx: (Math.random() - 0.5) * 0.8,
        size,
        hue: (frac * 260 + 250) % 360,
        swayPhase: Math.random() * Math.PI * 2,
        swayAmp: 18 + Math.random() * 46,
        swayRate: 0.5 + Math.random() * 0.7,
        rot: (Math.random() - 0.5) * 0.4,
        rotV: (Math.random() - 0.5) * 0.012,
        life: 1,
        kind: Math.random() < 0.2 ? 2 : Math.random() < 0.5 ? 1 : 0,
        fate: Math.random() < 0.45 ? 'explode' : 'dissipate',
      });
    };

    const explode = (n: Note) => {
      const sparks = sparksRef.current;
      const count = Math.min(10, Math.floor(4 + n.size * 0.5));
      for (let i = 0; i < count && sparks.length < maxSparks; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 0.8 + Math.random() * 2.4;
        sparks.push({
          x: n.x,
          y: n.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 0.4,
          size: 1 + Math.random() * n.size * 0.25,
          hue: (n.hue + Math.random() * 40 - 20 + 360) % 360,
          life: 1,
        });
      }
    };

    // A note glyph, drawn by hand. size ≈ note-head radius.
    const drawNote = (n: Note, alpha: number, scale: number) => {
      const [r, g, b] = hslToRgb(n.hue, 80, 62);
      const color = `rgba(${r}, ${g}, ${b}, ${alpha})`;
      const s = n.size * scale;
      const stemH = s * 3.4;
      const stemW = Math.max(1, s * 0.22);

      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(n.rot);
      ctx.fillStyle = color;
      if (quality !== 'low') {
        ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha * 0.7})`;
        ctx.shadowBlur = s * 0.9;
      }

      const head = (hx: number, hy: number) => {
        ctx.beginPath();
        ctx.ellipse(hx, hy, s, s * 0.72, -0.35, 0, Math.PI * 2);
        ctx.fill();
      };
      const stem = (hx: number, hy: number) => {
        ctx.fillRect(hx + s * 0.82, hy - stemH, stemW, stemH);
      };

      if (n.kind === 2) {
        const gap = s * 2.6;
        head(0, 0);
        head(gap, -s * 0.4);
        stem(0, 0);
        stem(gap, -s * 0.4);
        ctx.beginPath();
        ctx.moveTo(s * 0.82, -stemH);
        ctx.lineTo(gap + s * 0.82 + stemW, -stemH - s * 0.4);
        ctx.lineTo(gap + s * 0.82 + stemW, -stemH - s * 0.4 + s * 0.7);
        ctx.lineTo(s * 0.82, -stemH + s * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        head(0, 0);
        stem(0, 0);
        if (n.kind === 1) {
          ctx.beginPath();
          ctx.moveTo(s * 0.82 + stemW, -stemH);
          ctx.quadraticCurveTo(s * 2.6, -stemH + s * 0.9, s * 1.7, -stemH + s * 2.2);
          ctx.quadraticCurveTo(s * 2.0, -stemH + s * 1.1, s * 0.82 + stemW, -stemH + s * 0.75);
          ctx.closePath();
          ctx.fill();
        }
      }

      ctx.restore();
    };

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      timeRef.current += 0.016 * speed;
      const t = timeRef.current;

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };

      ctx.fillStyle = 'rgba(10, 10, 20, 0.28)';
      ctx.fillRect(0, 0, width, height);

      // Smooth per-bin energies (smoothing setting = calmer spawning)
      const raw = getLogBins(data.bins, NUM_BINS);
      const smooth = smoothBinsRef.current;
      for (let i = 0; i < NUM_BINS; i++) {
        const e = (raw[i] / 255) * sensitivity;
        smooth[i] = smooth[i] * smoothing + e * (1 - smoothing);
      }

      // Faint spectrum baseline at the bottom — shows where notes come from
      for (let i = 0; i < NUM_BINS; i++) {
        const frac = i / (NUM_BINS - 1);
        const e = smooth[i];
        if (e < 0.02) continue;
        const [r, g, b] = hslToRgb((frac * 260 + 250) % 360, 70, 50);
        const barH = e * height * 0.06;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + e * 0.25})`;
        const bw = (width * 0.9) / NUM_BINS;
        ctx.fillRect(width * 0.05 + i * bw + bw * 0.15, height - barH, bw * 0.7, barH);
      }

      // Frequency-driven spawning — NOT affected by the speed setting.
      // Probability comes from each bin's level relative to its OWN recent
      // peak, so a busy hi-hat contributes as readily as a kick and notes land
      // across the full width instead of stacking over the bass.
      const peaks = peaksRef.current;
      for (let i = 0; i < NUM_BINS; i++) {
        const e = smooth[i];
        // Rises instantly, falls ~26%/s. A slower release left a quiet band
        // sitting under its own stale peak for ten-plus seconds, which is why
        // the high bins stayed silent and everything piled up on the left.
        peaks[i] = Math.max(e, peaks[i] * 0.995);
        // Absolute floor first: a silent band must not spawn just because its
        // own peak decayed to nothing.
        if (e < 0.03) continue;
        const norm = e / Math.max(0.05, peaks[i]);
        if (norm < 0.3) continue;
        const p = Math.min(0.45, (norm - 0.3) * 0.6);
        if (Math.random() < p) spawnNote(i, Math.min(1.5, e));
      }

      // Animate notes — motion IS scaled by the speed setting
      const notes = notesRef.current;
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        n.y += n.vy * speed;
        n.baseX += n.vx * speed;
        // Sway as an absolute offset from the drift centre. Adding it as a
        // per-frame velocity made the displacement integrate to well under a
        // pixel, so the weave was invisible.
        n.x = n.baseX + Math.sin(t * n.swayRate + n.swayPhase) * n.swayAmp;
        n.rot += n.rotV * speed;
        // Slower decay so notes live long enough to actually climb the canvas.
        n.life -= 0.0028 * speed;

        if (n.y < -n.size * 6) {
          notes.splice(i, 1);
          continue;
        }

        if (n.life <= 0.22 && n.fate === 'explode') {
          explode(n);
          notes.splice(i, 1);
          continue;
        }
        if (n.life <= 0) {
          notes.splice(i, 1);
          continue;
        }

        const fadeIn = Math.min(1, (height + n.size * 2 - n.y) / (height * 0.06));
        // Dissipating notes swell and thin out at the end of their life
        const ending = n.fate === 'dissipate' && n.life < 0.3;
        const scale = ending ? 1 + (0.3 - n.life) * 2.2 : 1;
        const alpha = ending ? n.life * 2.4 : Math.min(0.9, n.life * 1.6);
        drawNote(n, Math.max(0, Math.min(0.9, alpha)) * fadeIn, scale);
      }

      // Animate sparks from exploded notes
      const sparks = sparksRef.current;
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx * speed;
        s.y += s.vy * speed;
        s.vy += 0.03 * speed;
        s.life -= 0.03 * speed;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const [r, g, b] = hslToRgb(s.hue, 90, 65);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.8 * s.life})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, smoothing, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
