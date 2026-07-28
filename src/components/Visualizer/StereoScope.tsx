import { useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { FFTData } from '../../hooks/useFFTData';
import { usePlayerStore } from '../../stores/playerStore';

/** Vertical layout, as fractions of canvas height. Shared by the renderer and
 *  the click hit-test so the seekable strip is exactly the drawn strip. */
const SCOPE_FRAC = 0.42;
const OVERVIEW_FRAC = 0.18;

interface Overview {
  left: Uint8Array;
  right: Uint8Array;
}

/** Decoding a whole track costs real time, so keep it per path for the session.
 *  Bounded because a long shuffle would otherwise accumulate every track. */
const overviewCache = new Map<string, Overview>();
const OVERVIEW_CACHE_MAX = 24;

interface StereoScopeProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

/**
 * Stereo Scope: classic L/R channel oscilloscope over a scrolling spectrogram.
 * Top 55%: left channel (purple) and right channel (cyan) waveform traces.
 * Bottom 45%: frequency-vs-time heatmap scrolling right-to-left, log-scaled
 * so bass detail gets room.
 */
/** Decode a base64 i8 waveform. Only runs while this mode is mounted. */
function decodeWave(b64: string | undefined): number[] {
  if (!b64) return [];
  const bin = atob(b64);
  const out: number[] = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const v = bin.charCodeAt(i);
    out[i] = v > 127 ? v - 256 : v;
  }
  return out;
}

export function StereoScope({ fftRef, lastUpdateRef, width, height }: StereoScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overviewRef = useRef<Overview | null>(null);

  // A selector, so this only re-renders when the track actually changes.
  // Subscribing to the whole store here would re-render at the 15Hz currentTime
  // tick, and the playhead is read inside the render loop instead precisely to
  // avoid that.
  const trackPath = usePlayerStore((s) => s.currentTrack?.file_path ?? null);

  useEffect(() => {
    overviewRef.current = null;
    if (!trackPath) return;

    const cached = overviewCache.get(trackPath);
    if (cached) {
      overviewRef.current = cached;
      return;
    }

    let cancelled = false;
    invoke<{ left: number[]; right: number[] }>('get_waveform_overview', {
      path: trackPath,
      buckets: 2000,
    })
      .then((r) => {
        if (cancelled) return;
        const ov: Overview = { left: Uint8Array.from(r.left), right: Uint8Array.from(r.right) };
        if (overviewCache.size >= OVERVIEW_CACHE_MAX) overviewCache.clear();
        overviewCache.set(trackPath, ov);
        overviewRef.current = ov;
      })
      // Nothing to recover from — the strip simply stays empty for formats or
      // files the decode cannot handle.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [trackPath]);

  /** Click the overview strip to seek. Anywhere else falls through, so the
   *  fullscreen overlay's click-to-exit still works everywhere it used to. */
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const yFrac = (e.clientY - rect.top) / rect.height;
    if (yFrac < SCOPE_FRAC || yFrac > SCOPE_FRAC + OVERVIEW_FRAC) return;

    const duration = usePlayerStore.getState().duration;
    if (!duration) return;
    e.stopPropagation();

    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seconds = frac * duration;
    invoke('seek', { position: seconds })
      .then(() => usePlayerStore.getState().setCurrentTime(seconds))
      .catch((err) => console.error('Seek failed:', err));
  };
  const scrollCarryRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    const scopeH = Math.floor(height * SCOPE_FRAC);
    const overviewH = Math.floor(height * OVERVIEW_FRAC);
    const overviewY = scopeH;
    const specH = height - scopeH - overviewH;

    // Persistent offscreen buffer for the scrolling spectrogram
    const spec = document.createElement('canvas');
    spec.width = width;
    spec.height = specH;
    const specCtx = spec.getContext('2d', { alpha: false })!;
    specCtx.fillStyle = 'rgb(8, 8, 16)';
    specCtx.fillRect(0, 0, width, specH);
    specCanvasRef.current = spec;

    // Spectrogram column painted via ImageData (one blit per column, not
    // per-pixel fillRects). Color map: dark → violet → magenta → white-hot.
    const column = specCtx.createImageData(1, specH);

    // Log frequency mapping: y position in the spectrogram → bin index.
    // Precomputed per row for the column painter.
    const binForRow: number[] = [];
    for (let y = 0; y < specH; y++) {
      const f = 1 - y / specH; // bottom = low frequency
      binForRow[y] = Math.min(1023, Math.floor(Math.pow(f, 2.6) * 700));
    }

    const drawTrace = (wave: number[], centerY: number, amp: number, color: string, glow: string) => {
      ctx.beginPath();
      const n = wave.length || 2;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * width;
        const y = centerY - ((wave[i] ?? 0) / 127) * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      // Glow pass (additive, wide) then core line
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 6;
      ctx.strokeStyle = glow;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    };

    let lastFrameTs = 0;

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const now = performance.now();
      const frameMs = lastFrameTs > 0 ? Math.min(50, now - lastFrameTs) : 16.67;
      lastFrameTs = now;
      const dtN = frameMs / 16.67;

      const data = fftRef.current;
      // Date.now(), not performance.now(): lastUpdateRef is an epoch timestamp,
      // and subtracting it from time-since-page-load gave a hugely negative
      // number, so `stale` was never true and the scope never went flat on
      // pause — it just held its last trace.
      const stale = Date.now() - (lastUpdateRef.current ?? 0) > 250;
      const waveL = !stale ? decodeWave(data?.wave_l) : [];
      const waveR = !stale ? decodeWave(data?.wave_r) : [];
      const bins = !stale && data?.bins ? data.bins : [];

      // ── Scope area ──
      ctx.fillStyle = 'rgb(10, 10, 20)';
      ctx.fillRect(0, 0, width, scopeH);

      const lCenter = Math.floor(scopeH * 0.27);
      const rCenter = Math.floor(scopeH * 0.77);
      const amp = scopeH * 0.21;

      // Faint center lines + channel labels
      ctx.strokeStyle = 'rgba(120, 120, 160, 0.18)';
      ctx.lineWidth = 1;
      for (const cy of [lCenter, rCenter]) {
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(width, cy);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(160, 160, 200, 0.5)';
      ctx.font = `${Math.max(10, Math.floor(height * 0.014))}px monospace`;
      ctx.fillText('L', 8, lCenter - 8);
      ctx.fillText('R', 8, rCenter - 8);

      drawTrace(waveL, lCenter, amp, 'rgb(196, 120, 255)', 'rgb(168, 85, 247)');
      drawTrace(waveR, rCenter, amp, 'rgb(110, 231, 249)', 'rgb(34, 211, 238)');

      // Divider
      ctx.fillStyle = 'rgba(120, 120, 160, 0.25)';
      ctx.fillRect(0, scopeH - 1, width, 1);

      // ── Whole-song overview ──
      // Peak envelope for the entire track, L above R, with a playhead that
      // walks it. Read from the store here rather than as a prop so the 15Hz
      // currentTime tick never re-runs this effect.
      ctx.fillStyle = 'rgb(8, 8, 16)';
      ctx.fillRect(0, overviewY, width, overviewH);

      const ov = overviewRef.current;
      const st = usePlayerStore.getState();
      const playFrac =
        st.duration > 0 ? Math.max(0, Math.min(1, st.currentTime / st.duration)) : 0;
      const playX = Math.floor(playFrac * width);

      if (ov && ov.left.length > 0) {
        const halfH = overviewH / 2;
        const lMid = overviewY + halfH * 0.5;
        const rMid = overviewY + halfH * 1.5;
        const amp = halfH * 0.46;
        const n = ov.left.length;

        for (let x = 0; x < width; x++) {
          // Each column covers a span of buckets, so take the peak across it —
          // sampling one bucket per column would drop transients on long songs.
          const b0 = Math.floor((x / width) * n);
          const b1 = Math.max(b0 + 1, Math.floor(((x + 1) / width) * n));
          let lPeak = 0;
          let rPeak = 0;
          for (let b = b0; b < b1 && b < n; b++) {
            if (ov.left[b] > lPeak) lPeak = ov.left[b];
            if (ov.right[b] > rPeak) rPeak = ov.right[b];
          }
          const played = x <= playX;
          const lh = Math.max(1, (lPeak / 255) * amp);
          const rh = Math.max(1, (rPeak / 255) * amp);
          ctx.fillStyle = played ? 'rgb(196, 120, 255)' : 'rgba(196, 120, 255, 0.28)';
          ctx.fillRect(x, lMid - lh, 1, lh * 2);
          ctx.fillStyle = played ? 'rgb(110, 231, 249)' : 'rgba(110, 231, 249, 0.28)';
          ctx.fillRect(x, rMid - rh, 1, rh * 2);
        }
      }

      // Playhead — drawn even before the envelope arrives, so the strip still
      // reads as a progress bar while the decode is in flight.
      if (st.duration > 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(playX, overviewY, 1, overviewH);
      }

      ctx.fillStyle = 'rgba(120, 120, 160, 0.25)';
      ctx.fillRect(0, overviewY + overviewH - 1, width, 1);

      // ── Spectrogram area ──
      const specCanvas = specCanvasRef.current!;
      const sctx = specCtx;
      // Scroll speed normalized to real time (~120 px/s at any refresh rate)
      scrollCarryRef.current += 2 * dtN;
      const shift = Math.floor(scrollCarryRef.current);
      if (shift > 0) {
        scrollCarryRef.current -= shift;
        sctx.drawImage(specCanvas, -shift, 0);
        // Paint the new columns on the right
        const px = column.data;
        for (let y = 0; y < specH; y++) {
          const v = (bins[binForRow[y]] ?? 0) / 255;
          const i = y * 4;
          if (v < 0.02) {
            px[i] = 8; px[i + 1] = 8; px[i + 2] = 16;
          } else {
            px[i] = Math.min(255, v * 340 + v * v * 120);
            px[i + 1] = v * v * 190;
            px[i + 2] = Math.min(255, 60 + v * 300);
          }
          px[i + 3] = 255;
        }
        for (let col = 0; col < shift; col++) {
          sctx.putImageData(column, width - 1 - col, 0);
        }
      }
      ctx.drawImage(specCanvas, 0, overviewY + overviewH);
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      onClick={handleClick}
      className="block w-full h-full"
    />
  );
}
