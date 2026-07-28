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
 * Circular spectrum analyzer, and the mode that visibly contains the others:
 * the full spectrum wraps around a ring — bass at 12 o'clock, air wrapping back
 * around — with bars radiating outward and a dim mirrored reflection inward.
 * The ring breathes with the bass and beat comets orbit outside it.
 *
 * Inside the ring is a Vortex-style core: layers of radially symmetric arms,
 * each drawn twice as counter-rotating mirror twins. Hard bass hits detonate
 * Fireworks bursts outside the ring, and Music Notes drift up the margins.
 * Bars mode runs as a strip along the floor.
 */
export function CombinedVisualizer({ fftRef, lastUpdateRef, width, height }: CombinedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const smoothRef = useRef<number[]>([]);
  const cometsRef = useRef<{ angle: number; v: number; life: number; hue: number }[]>([]);
  /** A taste of Fireworks — bursts thrown out past the ring on hard hits. */
  const sparksRef = useRef<
    { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; decay: number; size: number; hue: number }[]
  >([]);
  /** A taste of Music Notes — glyphs drifting up the edges of the frame. */
  const notesRef = useRef<
    { x: number; y: number; vy: number; size: number; hue: number; life: number; rot: number; kind: 0 | 1 }[]
  >([]);
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

      // Fade to true black — the old rgba(10,10,20,...) settled at a blue-grey
      // that never cleared, tinting the whole background.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
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

      // Vortex-style core: layers of radially symmetric arms, each drawn twice
      // as counter-rotating mirror twins. That pairing is what makes Vortex
      // read as a vortex, so it is the part worth echoing here. The frozen
      // RotatingSpiral itself is untouched — this is its character, rebuilt.
      const innerR = ringPulse * 0.88;
      const VORTEX_LAYERS = [
        { arms: 6, band: 'bass', twist: 2.3, dir: 1, hueOff: 20, curve: 0.55 },
        { arms: 8, band: 'mids', twist: 3.1, dir: -1, hueOff: 130, curve: 0.75 },
        { arms: 10, band: 'highs', twist: 3.9, dir: 1, hueOff: 235, curve: 0.95 },
      ] as const;
      const pts = quality === 'low' ? 18 : 34;

      for (const L of VORTEX_LAYERS) {
        const e = Math.min(1.5, beat.energy[L.band]);
        const p = Math.min(1.5, beat.pulse[L.band]);
        const hue = (hueBase + L.hueOff) % 360;
        const alpha = Math.min(0.85, 0.18 + e * 0.4 + p * 0.3);
        const lw = 1 + e * 1.4 + p * 2.2;
        const breathe = 1 + e * 0.1 + bassPulse * 0.14;
        ctx.lineWidth = lw;
        ctx.lineCap = 'round';

        for (let pass = 0; pass < 2; pass++) {
          const dir = pass === 0 ? L.dir : -L.dir;
          const phase = (pass === 0 ? t : -t) * 0.55 * (1 + bassPulse * 0.7);
          const [r, g, b] = hslToRgb(
            pass === 0 ? hue : (hue + 24) % 360,
            84,
            Math.min(90, 52 + e * 20 + p * 18)
          );
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha * (pass === 0 ? 1 : 0.78)})`;

          for (let arm = 0; arm < L.arms; arm++) {
            const armOffset = (arm / L.arms) * Math.PI * 2;
            ctx.beginPath();
            for (let i = 0; i <= pts; i++) {
              const f = i / pts;
              const theta = armOffset + phase + f * L.twist * dir;
              // Curved radius profile rather than linear — the arms crowd near
              // the centre and open out, which is what gives the funnel look.
              let rr = innerR * Math.pow(f, L.curve) * breathe;
              // Weave the live spectrum along each arm
              const v = smooth[Math.min(numBars - 1, Math.floor(f * (numBars - 1)))] ?? 0;
              rr *= 1 + v * 0.22 * (0.4 + f);
              const px = cx + Math.cos(theta) * rr;
              const py = cy + Math.sin(theta) * rr;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.stroke();
          }

          if (p > 0.25 && quality !== 'low') {
            // Additive wide re-stroke instead of shadowBlur — same bloom, no
            // Gaussian pass and no beat-synced frame spikes.
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = Math.min(0.4, p * 0.32);
            ctx.lineWidth = lw * 2.4;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.lineWidth = lw;
          }
        }
      }

      // --- Fireworks: hard hits detonate outside the ring ---
      const maxSparks = quality === 'low' ? 120 : quality === 'high' ? 700 : 380;
      const sparks = sparksRef.current;
      if ((beat.onset.bass || beat.onset.subBass) && beat.fluxRatio.bass > 1.3) {
        const s = Math.min(2, beat.fluxRatio.bass);
        // Detonate outside the ring so the burst frames it rather than
        // colliding with the spectrum bars.
        const ang = Math.random() * Math.PI * 2;
        const dist = ringPulse + maxR * (0.3 + Math.random() * 0.35);
        const bx = cx + Math.cos(ang) * dist;
        const by = cy + Math.sin(ang) * dist;
        const bHue = (hueBase + 200 + Math.random() * 90) % 360;
        const n = Math.floor(26 + s * 22);
        for (let i = 0; i < n && sparks.length < maxSparks; i++) {
          const a = Math.random() * Math.PI * 2;
          const v = maxR * 0.006 * Math.sqrt(Math.random()) * (0.8 + s * 0.7);
          sparks.push({
            x: bx, y: by, px: bx, py: by,
            vx: Math.cos(a) * v,
            vy: Math.sin(a) * v,
            life: 1,
            decay: 0.012 + Math.random() * 0.008,
            size: 1.1 + Math.random() * 1.6,
            hue: (bHue + (Math.random() - 0.5) * 40 + 360) % 360,
          });
        }
      }
      ctx.lineCap = 'round';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.px = sp.x;
        sp.py = sp.y;
        sp.x += sp.vx * speed;
        sp.y += sp.vy * speed;
        sp.vy += 0.045 * speed;
        sp.vx *= Math.pow(0.985, speed);
        sp.life -= sp.decay * speed;
        if (sp.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const [r, g, b] = hslToRgb(sp.hue, 88, 62);
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${sp.life})`;
        ctx.lineWidth = sp.size * (0.4 + sp.life * 0.7);
        ctx.beginPath();
        ctx.moveTo(sp.px, sp.py);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
      }

      // --- Music Notes: glyphs drifting up the left and right margins ---
      const maxNotes = quality === 'low' ? 10 : quality === 'high' ? 40 : 24;
      const notes = notesRef.current;
      // Spawn from the mid/high spectrum, kept to the margins so the ring stays
      // legible. Frequency-driven, never beat-gated.
      if (notes.length < maxNotes) {
        const bin = Math.floor(numBars * (0.35 + Math.random() * 0.6));
        const e = smooth[Math.min(numBars - 1, bin)] ?? 0;
        // Low threshold on purpose — the mid/high bins this samples sit well
        // under the bass bins, and at a higher gate notes almost never appeared.
        if (e > 0.1 && Math.random() < Math.min(0.4, (e - 0.1) * 0.7)) {
          const leftSide = Math.random() < 0.5;
          notes.push({
            x: leftSide ? width * (0.02 + Math.random() * 0.16) : width * (0.82 + Math.random() * 0.16),
            y: height + 20,
            vy: -(0.9 + e * 1.5),
            size: 4 + e * 5,
            hue: (hueBase + 150 + Math.random() * 120) % 360,
            life: 1,
            rot: (Math.random() - 0.5) * 0.5,
            kind: Math.random() < 0.5 ? 1 : 0,
          });
        }
      }
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        n.y += n.vy * speed;
        n.life -= 0.0045 * speed;
        if (n.life <= 0 || n.y < -30) {
          notes.splice(i, 1);
          continue;
        }
        const [r, g, b] = hslToRgb(n.hue, 80, 64);
        const a = Math.min(0.8, n.life * 1.5);
        const s = n.size;
        ctx.save();
        ctx.translate(n.x, n.y);
        ctx.rotate(n.rot);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s, s * 0.72, -0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(s * 0.82, -s * 3.2, Math.max(1, s * 0.22), s * 3.2);
        if (n.kind === 1) {
          ctx.beginPath();
          ctx.moveTo(s * 0.82 + s * 0.22, -s * 3.2);
          ctx.quadraticCurveTo(s * 2.4, -s * 2.4, s * 1.6, -s * 1.1);
          ctx.quadraticCurveTo(s * 1.9, -s * 2.1, s * 0.82 + s * 0.22, -s * 2.5);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // Sub-bass core
      const coreE = beat.energy.subBass * 0.6 + beat.energy.bass * 0.4;
      const coreR = ringPulse * 0.55 * (0.5 + coreE * 0.7 + bassPulse * 0.5);
      const [gr, gg, gb] = hslToRgb((hueBase + 30) % 360, 92, 50 + coreE * 30);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      // Dimmer than it was: the vortex arms now carry the centre, and at the
      // old alpha the core washed straight over them into flat white.
      grad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, ${0.36 + bassPulse * 0.22})`);
      grad.addColorStop(0.5, `rgba(${gr}, ${gg}, ${gb}, ${0.12 + coreE * 0.14})`);
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
