import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector, getDecayedFFT } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface MandelbrotGLProps {
  fftRef: React.RefObject<FFTData>;
  lastUpdateRef: React.RefObject<number>;
  width: number;
  height: number;
}

// Reference orbit texture width. Max iterations must stay below this.
// Deep boundary views genuinely need thousands of iterations: seahorse
// valley at zoom 1e8 shows nothing before ~3000 (verified against float64).
const REF_ORBIT_LEN = 4096;

const VERT_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SHADER = `
precision highp float;
uniform vec2 u_resolution;
uniform sampler2D u_refOrbit; // reference orbit Z_n in .xy, computed in JS float64
uniform float u_zoom;
uniform float u_time;
uniform float u_energy;
uniform float u_bass;
uniform float u_mids;
uniform float u_highs;
uniform float u_pulse;
uniform float u_colorShift;
uniform float u_angle;
uniform int u_maxIter;
uniform float u_userHue;   // 0..1 palette shift from the color picker
uniform int u_paletteId;   // 0 cosmic, 1 acid, 2 fire&ice, 3 electric

// === Perturbation rendering ===
// The full-precision center lives in the reference orbit (float64 in JS).
// Each pixel only iterates its tiny delta from that orbit in plain float32:
//   dz' = (2*Z_n + dz)*dz + dc
// Deltas stay small, so float32 is plenty — and unlike double-float
// (Dekker) tricks, nothing here gets optimized away by ANGLE's HLSL
// compiler, which provably breaks compensated arithmetic on Windows.

vec2 fetchRef(float n) {
  return texture2D(u_refOrbit, vec2((n + 0.5) / ${REF_ORBIT_LEN}.0, 0.5)).xy;
}

vec3 cosPal(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

vec3 palette(float t) {
  t = t + u_userHue;
  vec3 mus = vec3(u_mids * 0.2, u_energy * 0.15 + u_highs * 0.15, u_bass * 0.2);

  if (u_paletteId == 1) {
    // Acid: fast tri-frequency bands — green/magenta/yellow chaos
    return cosPal(t, vec3(0.5), vec3(0.62),
      vec3(2.0, 3.0, 4.0),
      vec3(0.0, 0.25, 0.5) + mus + vec3(u_colorShift * 0.6));
  } else if (u_paletteId == 2) {
    // Fire & Ice: molten oranges crashing into deep blues
    return cosPal(t, vec3(0.55, 0.42, 0.47), vec3(0.45, 0.48, 0.53),
      vec3(1.6, 1.0, 0.7),
      vec3(0.0, 0.15, 0.42) + mus * 0.7 + vec3(u_colorShift * 0.4));
  } else if (u_paletteId == 3) {
    // Electric: very high frequency — dozens of rainbow bands per cycle
    return cosPal(t, vec3(0.5), vec3(0.5),
      vec3(7.0, 5.0, 3.0),
      vec3(0.0, 0.33, 0.67) + mus + vec3(u_colorShift));
  }
  // Cosmic (default): the original music-driven drift
  vec3 d = vec3(
    u_colorShift + u_time * 0.012 + u_mids * 0.2,
    u_colorShift * 0.7 + 0.33 + u_energy * 0.15 + u_highs * 0.15,
    u_colorShift * 0.4 + 0.67 + u_bass * 0.2
  );
  return cosPal(t, vec3(0.5), vec3(0.5), vec3(1.0), d);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);

  // Rotate view on bass hits
  float sa = sin(u_angle);
  float ca = cos(u_angle);
  uv = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  // Pixel's offset from the reference center — tiny, safe in float32
  vec2 dc = uv / u_zoom;
  vec2 dz = vec2(0.0);
  float n = 0.0;
  float iter = 0.0;
  float maxIter = float(u_maxIter);
  float z_r2 = 0.0;
  bool escaped = false;

  for (int i = 0; i < ${REF_ORBIT_LEN}; i++) {
    if (i >= u_maxIter) break;

    // dz' = (2*Z_n + dz)*dz + dc  (complex arithmetic)
    vec2 Z = fetchRef(n);
    vec2 s = vec2(2.0 * Z.x + dz.x, 2.0 * Z.y + dz.y);
    dz = vec2(s.x * dz.x - s.y * dz.y, s.x * dz.y + s.y * dz.x) + dc;
    n += 1.0;
    iter += 1.0;

    vec2 z = fetchRef(n) + dz;
    z_r2 = dot(z, z);
    if (z_r2 > 4.0) { escaped = true; break; }

    // Rebase (Zhuoran): when the pixel orbit gets closer to the origin
    // than to the reference, restart the reference from iteration 0 with
    // the absolute value as the new delta. Handles reference escape and
    // cancellation glitches in one move.
    if (z_r2 < dot(dz, dz)) {
      dz = z;
      n = 0.0;
    }
  }

  if (!escaped) {
    // Interior: pulse glow on beats
    float glow = u_pulse * 0.2;
    vec3 interiorColor = palette(u_time * 0.01 + u_colorShift) * glow;
    gl_FragColor = vec4(interiorColor, 1.0);
  } else {
    float smoothIter = iter - log2(log2(z_r2)) + 4.0;
    float t = smoothIter / maxIter;
    t = t + u_time * 0.005 + u_energy * 0.12;
    vec3 color = palette(t);

    float brightness = 0.65 + u_energy * 0.45 + u_pulse * 0.7;
    color *= brightness;

    color = mix(color, vec3(1.0, 0.95, 0.9), u_pulse * 0.4);

    float sat = 1.0 + u_highs * 0.4 + u_mids * 0.2;
    vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(gray, color, sat);

    color = pow(color, vec3(0.9 - u_pulse * 0.15));

    gl_FragColor = vec4(color, 1.0);
  }
}
`;

export function MandelbrotGL({ fftRef, lastUpdateRef, width, height }: MandelbrotGLProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    uniforms: Record<string, WebGLUniformLocation | null>;
    probeFbo: WebGLFramebuffer | null;
    refTex: WebGLTexture | null;
  } | null>(null);
  const frameCountRef = useRef(0);
  const snapCooldownRef = useRef(0);
  const boringStreakRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const slowFramesRef = useRef(0);
  const steerRef = useRef({ x: 0, y: 0 });
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const zoomRef = useRef(0.5);
  const zoomVelocityRef = useRef(0.01);
  const targetIdxRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const colorShiftRef = useRef(0);
  const angleRef = useRef(0);
  const angleMomentumRef = useRef(0);
  const centerOffsetRef = useRef({ x: 0, y: 0 });
  const sensitivity = usePlayerStore((s) => s.visualizerSettings.sensitivity);
  const speed = usePlayerStore((s) => s.visualizerSettings.speed);
  const quality = usePlayerStore((s) => s.visualizerSettings.quality);
  const paletteName = usePlayerStore((s) => s.visualizerSettings.mandelbrotPalette ?? 'cosmic');
  const userHue = usePlayerStore((s) => s.visualizerSettings.mandelbrotHue ?? 0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
      console.error('WebGL not available');
      return;
    }

    // Float textures carry the reference orbit; universally available on
    // desktop (D3D11/ANGLE always exposes it)
    if (!gl.getExtension('OES_texture_float')) {
      console.error('OES_texture_float not available — Mandelbrot disabled');
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader link error:', gl.getProgramInfoLog(program));
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      u_resolution: gl.getUniformLocation(program, 'u_resolution'),
      u_refOrbit: gl.getUniformLocation(program, 'u_refOrbit'),
      u_zoom: gl.getUniformLocation(program, 'u_zoom'),
      u_time: gl.getUniformLocation(program, 'u_time'),
      u_energy: gl.getUniformLocation(program, 'u_energy'),
      u_bass: gl.getUniformLocation(program, 'u_bass'),
      u_mids: gl.getUniformLocation(program, 'u_mids'),
      u_highs: gl.getUniformLocation(program, 'u_highs'),
      u_pulse: gl.getUniformLocation(program, 'u_pulse'),
      u_colorShift: gl.getUniformLocation(program, 'u_colorShift'),
      u_angle: gl.getUniformLocation(program, 'u_angle'),
      u_maxIter: gl.getUniformLocation(program, 'u_maxIter'),
      u_userHue: gl.getUniformLocation(program, 'u_userHue'),
      u_paletteId: gl.getUniformLocation(program, 'u_paletteId'),
    };

    // Reference orbit texture: REF_ORBIT_LEN x 1 RGBA float, .xy = Z_n
    const refTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, refTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, REF_ORBIT_LEN, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Tiny offscreen framebuffer used to probe the frame for "boringness"
    const probeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, probeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const probeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, probeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, probeTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    glRef.current = { gl, program, uniforms, probeFbo, refTex };

    return () => {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  useEffect(() => {
    if (!glRef.current) return;

    // Perturbation math is plain float32 — roughly 6x cheaper per iteration
    // than the old double-float, so both iterations and resolution get to go up
    const baseMaxIter = quality === 'low' ? 90 : quality === 'high' ? 260 : 160;

    // Render sharp: native pixel density, and never below ~1440p-class
    // detail on medium / 4K-class on high, even when the element is smaller
    const nativeDpr = window.devicePixelRatio || 1;
    const resFloor = width > 0 ? (quality === 'high' ? 3840 : 2560) / width : 1;
    const dpr =
      quality === 'low'
        ? Math.min(nativeDpr, 1)
        : Math.min(Math.max(nativeDpr, resFloor), quality === 'high' ? 4 : 2.5);
    const paletteId = { cosmic: 0, acid: 1, fireice: 2, electric: 3 }[paletteName] ?? 0;
    const pxW = Math.floor(width * dpr);
    const pxH = Math.floor(height * dpr);
    const canvas = canvasRef.current;
    if (canvas && (canvas.width !== pxW || canvas.height !== pxH)) {
      canvas.width = pxW;
      canvas.height = pxH;
    }

    // All targets on the Mandelbrot boundary with high-precision coordinates
    // These are famous deep-zoom locations known to produce stunning spirals
    const targets = [
      { x: -0.74364388703715731, y: 0.13182590420531645 },   // Seahorse valley spiral
      { x: 0.360240443437614363, y: -0.641313061064803174 }, // Star spiral (multi-arm)
      { x: -0.7473053613369583,  y: 0.10884893967920656 },   // Double intertwined spiral
      { x: -0.743643887037158704, y: 0.131825904205311970 }, // Mini Mandelbrot in seahorse
      { x: -0.7454294354986695,  y: 0.11300929609833704 },   // Scepter valley tendrils
      { x: -0.74534, y: 0.11302 },                           // Seahorse branch spiral
    ];

    const orbit = new Float32Array(REF_ORBIT_LEN * 4);

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const { gl, program, uniforms } = glRef.current!;
      const data = getDecayedFFT(fftRef, lastUpdateRef) || { bins: new Array(1024).fill(0), rms: 0, time: 0 };
      const beat = beatRef.current;

      timeRef.current += 0.016 * speed;
      beat.update(data.bins, sensitivity);

      // === COLOR SHIFT: jumps on ANY transient ===
      if (beat.onset.any) {
        colorShiftRef.current += 0.15 + beat.pulse.combined * 0.25;
      }

      // === CAMERA ROTATION: kicks on bass ===
      if (beat.onset.bass || beat.onset.subBass) {
        const dir = Math.random() > 0.5 ? 1 : -1;
        angleMomentumRef.current += dir * (0.02 + beat.pulse.bass * 0.06);
      }
      angleMomentumRef.current *= 0.96;
      angleRef.current += angleMomentumRef.current * speed;

      // === CAMERA POSITION WOBBLE ===
      const offset = centerOffsetRef.current;
      if (beat.onset.bass && beat.pulse.bass > 0.3) {
        const wobbleScale = 0.0001 / Math.max(0.01, Math.pow(1.5, zoomRef.current - 5));
        offset.x += (Math.random() - 0.5) * wobbleScale;
        offset.y += (Math.random() - 0.5) * wobbleScale;
      }
      offset.x *= 0.97;
      offset.y *= 0.97;

      // === ZOOM MOMENTUM: music pulls you in — unhurried, savor the descent ===
      if (beat.onset.subBass) {
        zoomVelocityRef.current += 0.01 + beat.pulse.subBass * 0.02;
      }
      if (beat.onset.bass && beat.pulse.bass > 0.15) {
        zoomVelocityRef.current += 0.014 + beat.pulse.bass * 0.028;
      }
      if (beat.onset.mids && beat.pulse.mids > 0.25) {
        zoomVelocityRef.current += 0.005 + beat.pulse.mids * 0.01;
      }
      if (beat.onset.highs && beat.pulse.highs > 0.3) {
        zoomVelocityRef.current += 0.003;
      }

      const energyPull = beat.energy.bass * 0.0015 + beat.energy.mids * 0.0005 + beat.energy.subBass * 0.001;
      zoomVelocityRef.current += energyPull;

      // Friction
      zoomVelocityRef.current *= 0.93;
      zoomVelocityRef.current = Math.max(zoomVelocityRef.current, 0.0015);
      zoomVelocityRef.current = Math.min(zoomVelocityRef.current, 0.055);

      // 0.2: the descent runs 5x slower than the beat math suggests —
      // savor it, and the deep zoom lasts minutes instead of seconds
      zoomRef.current += zoomVelocityRef.current * speed * 0.2;
      const zoom = Math.pow(1.5, zoomRef.current);

      // Scale iterations aggressively with zoom depth — deep boundary
      // detail needs THOUSANDS of iterations to resolve (~3000 at zoom 1e8)
      const iterPerLevel = quality === 'low' ? 30 : quality === 'high' ? 55 : 45;
      const depthBonus = Math.floor(zoomRef.current * iterPerLevel);
      const maxIter = Math.min(4000, baseMaxIter + depthBonus);

      // Perturbation is limited only by the float64 reference orbit:
      // ~zoom level 70 (2x10^12) the center coordinate itself quantizes
      // and the view would start to jitter. Respawn at a new spot there.
      if (zoomRef.current > 70) {
        targetIdxRef.current = (targetIdxRef.current + 1) % targets.length;
        zoomRef.current = 4 + Math.random() * 5;
        zoomVelocityRef.current = 0.01;
        offset.x = 0;
        offset.y = 0;
        steerRef.current.x = 0;
        steerRef.current.y = 0;
        angleRef.current = 0;
        angleMomentumRef.current = 0;
      }

      const target = targets[targetIdxRef.current];

      // === REFERENCE ORBIT: the one place full precision matters. ===
      // Iterate the center in JS float64 and hand the orbit to the GPU.
      // ~1000 complex mults per frame — microseconds.
      const cx = target.x + offset.x + steerRef.current.x;
      const cy = target.y + offset.y + steerRef.current.y;
      let zx = 0;
      let zy = 0;
      let frozen = false;
      for (let k = 0; k <= maxIter; k++) {
        orbit[k * 4] = zx;
        orbit[k * 4 + 1] = zy;
        if (!frozen) {
          const nx = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = nx;
          // If the reference escapes, freeze the tail at a huge value:
          // pixels reaching it either escape too or have already rebased
          if (zx * zx + zy * zy > 1e6) frozen = true;
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, glRef.current!.refTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, REF_ORBIT_LEN, 1, gl.RGBA, gl.FLOAT, orbit);

      gl.viewport(0, 0, pxW, pxH);
      gl.useProgram(program);

      gl.uniform2f(uniforms.u_resolution, pxW, pxH);
      gl.uniform1i(uniforms.u_refOrbit, 0);
      gl.uniform1f(uniforms.u_zoom, zoom);
      gl.uniform1f(uniforms.u_time, timeRef.current);
      gl.uniform1f(uniforms.u_energy, Math.min(1, beat.energy.bass + beat.energy.mids * 0.5));
      gl.uniform1f(uniforms.u_bass, Math.min(1, beat.energy.bass));
      gl.uniform1f(uniforms.u_mids, Math.min(1, beat.energy.mids));
      gl.uniform1f(uniforms.u_highs, Math.min(1, beat.energy.highs));
      gl.uniform1f(uniforms.u_pulse, Math.min(1, beat.pulse.combined));
      gl.uniform1f(uniforms.u_colorShift, colorShiftRef.current % 1.0);
      gl.uniform1f(uniforms.u_angle, angleRef.current);
      gl.uniform1i(uniforms.u_maxIter, maxIter);
      gl.uniform1f(uniforms.u_userHue, userHue / 360);
      gl.uniform1i(uniforms.u_paletteId, paletteId);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const snapToNewSpot = () => {
        targetIdxRef.current = (targetIdxRef.current + 1 + Math.floor(Math.random() * (targets.length - 1))) % targets.length;
        zoomRef.current = 5 + Math.random() * 7;
        zoomVelocityRef.current = 0.01;
        offset.x = 0;
        offset.y = 0;
        steerRef.current.x = 0;
        steerRef.current.y = 0;
        angleMomentumRef.current = 0;
        boringStreakRef.current = 0;
        slowFramesRef.current = 0;
        snapCooldownRef.current = 150; // give the new view time to settle
      };

      // === PERFORMANCE GUARD: depth is the priority, but if the GPU is
      // grinding (sustained slow frames), reset to a fresh spot.
      const now = performance.now();
      if (lastFrameTsRef.current > 0) {
        const frameDt = now - lastFrameTsRef.current;
        if (frameDt > 95) slowFramesRef.current++;
        else slowFramesRef.current = Math.max(0, slowFramesRef.current - 2);
        if (slowFramesRef.current > 40 && snapCooldownRef.current === 0) {
          snapToNewSpot();
        }
      }
      lastFrameTsRef.current = now;

      // === BOREDOM PROBE: every 24 frames render a 16×16 thumbnail and
      // check color variance. Deep zooming is the priority, so only a
      // SUSTAINED monochrome view (3 probes in a row ≈ 1.2s of pure void
      // or flat plateau — no boundary in sight) triggers a snap.
      frameCountRef.current++;
      if (snapCooldownRef.current > 0) snapCooldownRef.current--;
      if (frameCountRef.current % 24 === 0 && snapCooldownRef.current === 0 && glRef.current!.probeFbo) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, glRef.current!.probeFbo);
        gl.viewport(0, 0, 16, 16);
        gl.uniform2f(uniforms.u_resolution, 16, 16);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const px = new Uint8Array(16 * 16 * 4);
        gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // Mean absolute deviation per channel across the thumbnail
        let mr = 0, mg = 0, mb = 0;
        const n = 256;
        for (let i = 0; i < n; i++) {
          mr += px[i * 4];
          mg += px[i * 4 + 1];
          mb += px[i * 4 + 2];
        }
        mr /= n; mg /= n; mb /= n;
        let dev = 0;
        for (let i = 0; i < n; i++) {
          dev += Math.abs(px[i * 4] - mr) + Math.abs(px[i * 4 + 1] - mg) + Math.abs(px[i * 4 + 2] - mb);
        }
        dev /= n;

        if (dev < 10) {
          boringStreakRef.current++;
          if (boringStreakRef.current >= 3) snapToNewSpot();
        } else {
          boringStreakRef.current = 0;

          // === INTEREST STEERING: drift toward where the detail lives ===
          // Weight each thumbnail pixel by its deviation from the mean color
          // and nudge the camera toward the centroid — the descent naturally
          // hugs the boundary filaments instead of falling into voids.
          let wsum = 0;
          let wxAcc = 0;
          let wyAcc = 0;
          for (let yy = 0; yy < 16; yy++) {
            for (let xx = 0; xx < 16; xx++) {
              const i = yy * 16 + xx;
              const wgt =
                Math.abs(px[i * 4] - mr) + Math.abs(px[i * 4 + 1] - mg) + Math.abs(px[i * 4 + 2] - mb);
              wsum += wgt;
              wxAcc += wgt * ((xx - 7.5) / 16);
              wyAcc += wgt * ((yy - 7.5) / 16);
            }
          }
          if (wsum > 0) {
            const dx = wxAcc / wsum;
            const dy = wyAcc / wsum;
            // The shader rotates the view by u_angle — map the screen-space
            // nudge back into complex-plane coordinates
            const ca = Math.cos(angleRef.current);
            const sa = Math.sin(angleRef.current);
            const gain = 0.4 / zoom;
            steerRef.current.x += (dx * ca - dy * sa) * gain;
            steerRef.current.y += (dx * sa + dy * ca) * gain;
          }
        }
      }
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality, paletteName, userHue]);

  return <canvas ref={canvasRef} width={width} height={height} className="block w-full h-full" />;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
