import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, hslToRgb, getDecayedFFT, lerp } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface BangerDetectorProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

type CurveKind = 'archimedean' | 'logarithmic' | 'fermat';
const CURVES: CurveKind[] = ['archimedean', 'logarithmic', 'fermat'];

interface SpiralLayer {
  direction: 1 | -1;
  symmetry: number;
  symmetryTarget: number;
  twist: number;
  twistTarget: number;
  curve: CurveKind;
  rMin: number;
  rMax: number;
  speedFactor: number;
  hueOffset: number;
  phase: number;
  band: 'bass' | 'mids' | 'highs' | 'air';
}

/** An in-flight shockwave: birth time + the energy of the hit that caused it. */
interface Shockwave {
  t0: number;
  e: number;
}

/**
 * Tempo tracker with band folding: detected BPM is folded into [70, 140) so a
 * half-time/double-time misdetection can't double or halve the visual speed.
 */
class FoldedTempoTracker {
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
        let target = 60 / median;
        while (target < 70) target *= 2;
        while (target >= 140) target /= 2;
        this.bpm = this.bpm * 0.8 + target * 0.2;
      }
    }
    this.lastOnset = nowMs;
  }
}

/**
 * Crest meter: how spiky is this song's bass envelope over the last ~25s?
 * (peak-to-average of 250ms energy buckets). Dubstep → high crest; even
 * singer-songwriter textures → low. Scales how hard beats can slam the spiral,
 * so the mode auto-calibrates its wildness to the material.
 */
class CrestMeter {
  private buckets: number[] = [];
  private cur = 0;
  private curStart = 0;

  update(nowMs: number, energy: number) {
    if (this.curStart === 0) this.curStart = nowMs;
    this.cur = Math.max(this.cur, energy);
    if (nowMs - this.curStart >= 250) {
      this.buckets.push(this.cur);
      if (this.buckets.length > 100) this.buckets.shift();
      this.cur = 0;
      this.curStart = nowMs;
    }
  }

  /** 0.1 (even texture) .. 1.5 (massive dynamic spikes) */
  gain(): number {
    if (this.buckets.length < 8) return 0.6; // warm-up: middle of the road
    const avg = this.buckets.reduce((a, b) => a + b, 0) / this.buckets.length;
    const peak = Math.max(...this.buckets);
    const crest = peak / (avg + 0.001);
    return Math.min(1.5, Math.max(0.1, (crest - 1.2) / 3));
  }
}

/**
 * Banger Detector: the golden Rotating Spiral geometry driven by a
 * momentum-based motion engine. The spin is tempo-locked (degrees per beat,
 * BPM band-folded), and every bass hit applies a torque impulse scaled by the
 * hit's energy AND the song's crest factor — downtempo tracks that BANG send
 * the spiral lurching; even, chill textures sway gracefully. The speed slider
 * is the drama knob: it scales both base spin-per-beat and torque gain.
 */
export function BangerDetector({ fftRef, lastUpdateRef, width, height }: BangerDetectorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const beatRef = useRef(new BeatDetector());
  const tempoRef = useRef(new FoldedTempoTracker());
  const crestRef = useRef(new CrestMeter());
  const layersRef = useRef<SpiralLayer[] | null>(null);
  const lastMorphBeatRef = useRef(0);
  const spinVelRef = useRef(1); // angular velocity multiplier; friction pulls it to 1
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);
  const wavesRef = useRef<Shockwave[]>([]);
  const specSmoothRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const pointsPerArm = quality === 'low' ? 40 : quality === 'high' ? 90 : 60;

    const cx = width / 2;
    const cy = height / 2;
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
    layersRef.current.forEach((l, i) => {
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

      const now = performance.now();
      const frameMs = lastFrameTs > 0 ? Math.min(50, now - lastFrameTs) : 16.67;
      lastFrameTs = now;
      const dtN = frameMs / 16.67;
      const kdt = (k: number) => 1 - Math.pow(1 - k, dtN);

      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;
      beat.update(data.bins, sensitivity, dtN);
      const tempo = tempoRef.current;
      const crest = crestRef.current;
      crest.update(now, beat.energy.bass * 0.6 + beat.energy.subBass * 0.4);

      if (beat.onset.bass || beat.onset.subBass) {
        tempo.onOnset(now);
        // Torque: the hit slams the spin, scaled by hit energy, the song's
        // crest gain, and the drama knob (speed slider).
        const hit = Math.min(1.5, beat.pulse.bass + beat.pulse.subBass);
        spinVelRef.current = Math.min(5, spinVelRef.current + hit * 1.6 * crest.gain() * (0.3 + 0.7 * speed));
        wavesRef.current.push({ t0: now, e: hit });
        if (wavesRef.current.length > 5) wavesRef.current.shift();
      }

      // Friction: spin always relaxes back toward the tempo-locked base rate
      spinVelRef.current = 1 + (spinVelRef.current - 1) * Math.pow(0.94, dtN);
      const spinVel = spinVelRef.current;
      // How hard we're currently surging (0 = cruising) — drives extra glow
      const surge = Math.min(1, (spinVel - 1) * 0.5);

      // Shockwaves carry their hit energy: harder hits ripple bigger
      const WAVE_MS = 900;
      wavesRef.current = wavesRef.current.filter((w) => (now - w.t0) / WAVE_MS < 1.15);
      const waveSigma = maxR * 0.04;

      const BUCKETS = 48;
      const spec = specSmoothRef.current;
      const usable = Math.floor(data.bins.length * 0.7);
      for (let b = 0; b < BUCKETS; b++) {
        const start = Math.floor(Math.pow(b / BUCKETS, 1.7) * usable);
        const end = Math.max(start + 1, Math.floor(Math.pow((b + 1) / BUCKETS, 1.7) * usable));
        let s = 0;
        for (let i = start; i < end; i++) s += data.bins[i] || 0;
        const raw = (s / (end - start)) * sensitivity;
        const v = raw / (1 + raw);
        spec[b] = lerp(spec[b] ?? 0, v, kdt(0.3));
      }

      if (tempo.beatCount - lastMorphBeatRef.current >= 4) {
        lastMorphBeatRef.current = tempo.beatCount;
        const layers = layersRef.current!;
        const l = layers[Math.floor(Math.random() * layers.length)];
        l.symmetryTarget = 3 + Math.floor(Math.random() * 6);
        l.twistTarget = Math.PI * (1 + Math.random() * 3.5);
        if (Math.random() < 0.4) l.curve = CURVES[Math.floor(Math.random() * CURVES.length)];
      }

      // Tempo-locked base motion: degrees per beat, not per second. The drama
      // knob shapes the base mildly; momentum (spinVel) does the slamming.
      const bpmRate = tempo.bpm / 60;
      const dt = 0.016 * dtN * (0.45 + 0.55 * speed);
      const bassPulse = beat.pulse.subBass * 0.5 + beat.pulse.bass * 0.5;

      ctx.fillStyle = `rgba(10, 10, 20, ${1 - Math.pow(1 - 0.09, dtN)})`;
      ctx.fillRect(0, 0, width, height);

      const hueBase = (now * 0.008) % 360;
      const layers = layersRef.current!;

      for (const layer of layers) {
        layer.symmetry = lerp(layer.symmetry, layer.symmetryTarget, kdt(0.02));
        layer.twist = lerp(layer.twist, layer.twistTarget, kdt(0.02));
        layer.phase += dt * bpmRate * layer.speedFactor * layer.direction * spinVel;

        const energy = Math.min(1.5, beat.energy[layer.band]);
        const pulse = Math.min(1.5, beat.pulse[layer.band]);
        const arms = Math.round(layer.symmetry);
        const hue = (hueBase + layer.hueOffset) % 360;
        const [r, g, b] = hslToRgb(hue, 82 + pulse * 18, Math.min(92, 50 + energy * 22 + pulse * 20 + surge * 10));
        const alpha = 0.3 + energy * 0.4 + pulse * 0.3 + surge * 0.15;
        const lineWidth = 1.2 + energy * 1.8 + pulse * 3;
        const breathe = 1 + energy * 0.12 + bassPulse * 0.15;

        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';

        for (let pass = 0; pass < 2; pass++) {
          const dir = pass === 0 ? layer.direction : -layer.direction;
          const phase = pass === 0 ? layer.phase : -layer.phase;
          const passHue = pass === 0 ? hue : (hue + 24) % 360;
          const [pr, pg, pb] = pass === 0 ? [r, g, b] : hslToRgb(passHue, 82 + pulse * 18, Math.min(92, 50 + energy * 22 + pulse * 20 + surge * 10));
          ctx.strokeStyle = `rgba(${pr}, ${pg}, ${pb}, ${Math.min(0.9, alpha) * (pass === 0 ? 1 : 0.8)})`;

          for (let arm = 0; arm < arms; arm++) {
            const armOffset = (arm / arms) * Math.PI * 2;
            ctx.beginPath();
            for (let i = 0; i <= pointsPerArm; i++) {
              const frac = i / pointsPerArm;
              const theta = armOffset + phase + frac * layer.twist * dir;
              let rr = radiusOf(layer, frac) * breathe;
              {
                const pos = frac * (BUCKETS - 1);
                const b0 = Math.floor(pos);
                const t = pos - b0;
                const v = (spec[b0] ?? 0) * (1 - t) + (spec[Math.min(BUCKETS - 1, b0 + 1)] ?? 0) * t;
                rr *= 1 + v * 0.25 * (0.4 + frac);
              }
              const anchor = Math.min(1, frac * 6);
              for (let w = 0; w < wavesRef.current.length; w++) {
                const wave = wavesRef.current[w];
                const p = (now - wave.t0) / WAVE_MS;
                const d = rr - p * maxR * 1.1;
                // Ripple amplitude scales with the energy of the hit
                const amp = maxR * 0.022 * (0.4 + wave.e);
                rr += amp * Math.exp(-(d * d) / (2 * waveSigma * waveSigma)) * (1 - p * 0.6) * anchor;
              }
              const x = cx + Math.cos(theta) * rr;
              const y = cy + Math.sin(theta) * rr;
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }

          if (pulse > 0.25 && quality !== 'low') {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(0.5, pulse * 0.4 + surge * 0.1);
            ctx.lineWidth = lineWidth * 2.5;
            ctx.stroke();
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
