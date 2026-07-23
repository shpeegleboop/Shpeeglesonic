import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT, lerp } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface RotatingSpiralProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

type CurveKind = 'archimedean' | 'logarithmic' | 'fermat';
const CURVES: CurveKind[] = ['archimedean', 'logarithmic', 'fermat'];

interface SpiralLayer {
  direction: 1 | -1;
  symmetry: number; // current (lerped)
  symmetryTarget: number;
  twist: number; // current (lerped) — total angular sweep of one arm
  twistTarget: number;
  curve: CurveKind;
  rMin: number;
  rMax: number;
  speedFactor: number;
  hueOffset: number;
  phase: number;
  band: 'bass' | 'mids' | 'highs' | 'air';
}

/** Tempo tracker: median interval between bass onsets → BPM. */
class TempoTracker {
  private lastOnset = 0;
  private intervals: number[] = [];
  bpm = 100;
  beatCount = 0;

  onOnset(nowMs: number) {
    this.beatCount++;
    if (this.lastOnset > 0) {
      const dt = (nowMs - this.lastOnset) / 1000;
      if (dt > 0.25 && dt < 2.0) {
        this.intervals.push(dt);
        if (this.intervals.length > 12) this.intervals.shift();
        const sorted = [...this.intervals].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const target = Math.min(190, Math.max(55, 60 / median));
        this.bpm = this.bpm * 0.8 + target * 0.2;
      }
    }
    this.lastOnset = nowMs;
  }
}

/**
 * Rotating Spiral: layers of radially symmetric spiral arms — alternating
 * clockwise/counter-clockwise — drawn from different curve families
 * (archimedean, logarithmic, fermat). Rotation speed follows the detected
 * tempo, and every few beats one layer smoothly morphs its symmetry and
 * twist, so faster songs both spin faster and shape-shift more. Hypnosis
 * by design.
 */
export function RotatingSpiral({ fftRef, lastUpdateRef, width, height }: RotatingSpiralProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beatRef = useRef(new BeatDetector());
  const tempoRef = useRef(new TempoTracker());
  const layersRef = useRef<SpiralLayer[] | null>(null);
  const lastMorphBeatRef = useRef(0);
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);
  const wavesRef = useRef<number[]>([]); // birth timestamps of active shockwaves
  const specSmoothRef = useRef<number[]>([]); // temporally smoothed spectrum buckets

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const pointsPerArm = quality === 'low' ? 40 : quality === 'high' ? 90 : 60;

    const cx = width / 2;
    const cy = height / 2;
    // Reach the corners on any aspect ratio — min-dimension sizing leaves
    // dark side margins on 16:9 and worse in fullscreen.
    const maxR = Math.hypot(cx, cy) * 0.95;

    if (!layersRef.current) {
      const bands: SpiralLayer['band'][] = ['bass', 'mids', 'highs', 'air', 'mids'];
      layersRef.current = bands.map((band, i) => ({
        direction: (i % 2 === 0 ? 1 : -1) as 1 | -1,
        symmetry: 3 + i,
        symmetryTarget: 3 + i,
        twist: Math.PI * (1.5 + i * 0.6),
        twistTarget: Math.PI * (1.5 + i * 0.6),
        curve: CURVES[i % CURVES.length],
        rMin: 0,
        rMax: 0,
        speedFactor: 0.6 + i * 0.28,
        hueOffset: i * 65,
        phase: (i * Math.PI) / 3,
        band,
      }));
    }
    // Radii must track the current canvas size — they were previously baked
    // in at first mount, freezing the spiral at whatever size it started at.
    layersRef.current.forEach((l, i) => {
      // rMin is exactly 0: every arm passes through the true center, so the
      // convergence point is always inked and never reads as a hole.
      l.rMin = 0;
      l.rMax = maxR * (0.5 + i * 0.14);
    });

    const radiusOf = (layer: SpiralLayer, frac: number): number => {
      const span = layer.rMax - layer.rMin;
      switch (layer.curve) {
        case 'archimedean':
          return layer.rMin + span * frac;
        case 'logarithmic':
          return layer.rMin + span * (Math.exp(2.2 * frac) - 1) / (Math.exp(2.2) - 1);
        case 'fermat':
          return layer.rMin + span * Math.sqrt(frac);
      }
    };

    let lastFrameTs = 0;

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      // Real elapsed time — all motion/decay below is normalized to it so the
      // animation is identical (and smooth) at 60Hz, 144Hz, or a janky 90Hz.
      const now = performance.now();
      const frameMs = lastFrameTs > 0 ? Math.min(50, now - lastFrameTs) : 16.67;
      lastFrameTs = now;
      const dtN = frameMs / 16.67; // 1.0 at 60fps
      const kdt = (k: number) => 1 - Math.pow(1 - k, dtN); // lerp factor at real dt

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity, dtN);
      const tempo = tempoRef.current;
      if (beat.onset.bass || beat.onset.subBass) {
        tempo.onOnset(now);
        wavesRef.current.push(now);
        if (wavesRef.current.length > 5) wavesRef.current.shift();
      }

      // Bass shockwaves: each entry is a progress fraction (0 center, 1 edge)
      const WAVE_MS = 900;
      wavesRef.current = wavesRef.current.filter((t0) => (now - t0) / WAVE_MS < 1.15);
      const waves = wavesRef.current.map((t0) => (now - t0) / WAVE_MS);
      const waveSigma = maxR * 0.04;
      const waveAmp = maxR * 0.022;

      // Spectrum-woven arms: bucket the FFT once per frame; arm points sample
      // it by radius fraction (low freqs inner, highs at the tips)
      // Spectrum-woven arms (always on, full strength): bucket the FFT once
      // per frame; arm points sample it by radius fraction.
      const BUCKETS = 48;
      const spec = specSmoothRef.current;
      const usable = Math.floor(data.bins.length * 0.7);
      for (let b = 0; b < BUCKETS; b++) {
        const start = Math.floor(Math.pow(b / BUCKETS, 1.7) * usable);
        const end = Math.max(start + 1, Math.floor(Math.pow((b + 1) / BUCKETS, 1.7) * usable));
        let s = 0;
        for (let i = start; i < end; i++) s += data.bins[i] || 0;
        const raw = (s / (end - start)) * sensitivity;
        // Soft-clip to 0..1 so loud bins can't fling arms off-canvas, then
        // smooth over time so the weave flows instead of jittering
        const v = raw / (1 + raw);
        spec[b] = lerp(spec[b] ?? 0, v, kdt(0.3));
      }

      // Every 4 beats, one layer morphs its shape; faster tempo = more often in wall time
      if (tempo.beatCount - lastMorphBeatRef.current >= 4) {
        lastMorphBeatRef.current = tempo.beatCount;
        const layers = layersRef.current!;
        const l = layers[Math.floor(Math.random() * layers.length)];
        l.symmetryTarget = 3 + Math.floor(Math.random() * 6); // 3..8
        l.twistTarget = Math.PI * (1 + Math.random() * 3.5);
        if (Math.random() < 0.4) l.curve = CURVES[Math.floor(Math.random() * CURVES.length)];
      }

      // Rotation phase advances with tempo — the whole scene spins to the song
      const bpmRate = tempo.bpm / 60; // rotations feel tied to the beat
      const dt = 0.016 * speed * dtN;
      const bassPulse = beat.pulse.subBass * 0.5 + beat.pulse.bass * 0.5;

      // Hypnotic trails, normalized so trail length is the same at any frame rate
      ctx.fillStyle = `rgba(10, 10, 20, ${1 - Math.pow(1 - 0.09, dtN)})`;
      ctx.fillRect(0, 0, width, height);

      const hueBase = (now * 0.008) % 360;
      const layers = layersRef.current!;

      for (const layer of layers) {
        // Smooth morphing
        layer.symmetry = lerp(layer.symmetry, layer.symmetryTarget, kdt(0.02));
        layer.twist = lerp(layer.twist, layer.twistTarget, kdt(0.02));
        layer.phase += dt * bpmRate * layer.speedFactor * layer.direction * (1 + bassPulse * 0.8);

        const energy = Math.min(1.5, beat.energy[layer.band]);
        const pulse = Math.min(1.5, beat.pulse[layer.band]);
        const arms = Math.round(layer.symmetry);
        const hue = (hueBase + layer.hueOffset) % 360;
        const [r, g, b] = hslToRgb(hue, 82 + pulse * 18, Math.min(90, 50 + energy * 22 + pulse * 20));
        const alpha = 0.3 + energy * 0.4 + pulse * 0.3;
        const lineWidth = 1.2 + energy * 1.8 + pulse * 3;
        const breathe = 1 + energy * 0.12 + bassPulse * 0.15;

        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';

        // Two passes: the spiral and its mirror twin rotating the opposite
        // way — every layer is always paired, so the image stays symmetric
        // and reads as counter-rotation everywhere.
        for (let pass = 0; pass < 2; pass++) {
          const dir = pass === 0 ? layer.direction : -layer.direction;
          const phase = pass === 0 ? layer.phase : -layer.phase;
          const passHue = pass === 0 ? hue : (hue + 24) % 360;
          const [pr, pg, pb] = pass === 0 ? [r, g, b] : hslToRgb(passHue, 82 + pulse * 18, Math.min(90, 50 + energy * 22 + pulse * 20));
          ctx.strokeStyle = `rgba(${pr}, ${pg}, ${pb}, ${Math.min(0.9, alpha) * (pass === 0 ? 1 : 0.8)})`;

          for (let arm = 0; arm < arms; arm++) {
            const armOffset = (arm / arms) * Math.PI * 2;
            ctx.beginPath();
            for (let i = 0; i <= pointsPerArm; i++) {
              const frac = i / pointsPerArm;
              const theta = armOffset + phase + frac * layer.twist * dir;
              let rr = radiusOf(layer, frac) * breathe;
              // Spectrum weave: arms bulge with the live FFT along their length
              // (inter-bucket lerp keeps the curve smooth)
              {
                const pos = frac * (BUCKETS - 1);
                const b0 = Math.floor(pos);
                const t = pos - b0;
                const v = (spec[b0] ?? 0) * (1 - t) + (spec[Math.min(BUCKETS - 1, b0 + 1)] ?? 0) * t;
                rr *= 1 + v * 0.25 * (0.4 + frac);
              }
              // Center anchor: all radial displacement fades to zero at the
              // convergence point so beats never punch a hole in the middle
              const anchor = Math.min(1, frac * 6);
              // Shockwaves: gaussian bump where each ripple front crosses this radius
              for (let w = 0; w < waves.length; w++) {
                const d = rr - waves[w] * maxR * 1.1;
                rr += waveAmp * Math.exp(-(d * d) / (2 * waveSigma * waveSigma)) * (1 - waves[w] * 0.6) * anchor;
              }
              const x = cx + Math.cos(theta) * rr;
              const y = cy + Math.sin(theta) * rr;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }

          if (pulse > 0.25 && quality !== 'low') {
            // Additive wide re-stroke instead of shadowBlur: same bloom read,
            // but no Gaussian blur pass — shadowBlur caused beat-synced frame
            // spikes at high resolutions.
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(0.5, pulse * 0.4);
            ctx.lineWidth = lineWidth * 2.5;
            ctx.stroke(); // re-stroke last arm — cheap bloom
            ctx.lineWidth = lineWidth;
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
          }
        }
      }

    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}
