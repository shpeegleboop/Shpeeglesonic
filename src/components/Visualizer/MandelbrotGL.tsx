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

// Split a JS double into float32 hi + remainder lo for double-float precision
function splitDouble(val: number): [number, number] {
  const hi = Math.fround(val);
  const lo = val - hi;
  return [hi, lo];
}

const VERT_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG_SHADER = `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_center_hi;   // high part of center coordinate
uniform vec2 u_center_lo;   // low part (precision correction)
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

// === Double-float arithmetic ===
// A number is represented as vec2(hi, lo) where value = hi + lo
// This gives ~14 decimal digits vs ~7 for single float

vec2 ds_qts(float a, float b) {
  float s = a + b;
  return vec2(s, b - (s - a));
}

vec2 ds_ts(float a, float b) {
  float s = a + b;
  float v = s - a;
  return vec2(s, (a - (s - v)) + (b - v));
}

vec2 ds_add(vec2 a, vec2 b) {
  vec2 s = ds_ts(a.x, b.x);
  s.y += a.y + b.y;
  return ds_qts(s.x, s.y);
}

vec2 ds_sub(vec2 a, vec2 b) {
  return ds_add(a, vec2(-b.x, -b.y));
}

vec2 ds_split(float a) {
  float t = 4097.0 * a;
  float hi = t - (t - a);
  return vec2(hi, a - hi);
}

vec2 ds_tp(float a, float b) {
  float p = a * b;
  vec2 a_s = ds_split(a);
  vec2 b_s = ds_split(b);
  float e = ((a_s.x * b_s.x - p) + a_s.x * b_s.y + a_s.y * b_s.x) + a_s.y * b_s.y;
  return vec2(p, e);
}

vec2 ds_mul(vec2 a, vec2 b) {
  vec2 p = ds_tp(a.x, b.x);
  p.y += a.x * b.y + a.y * b.x;
  return ds_qts(p.x, p.y);
}

vec3 palette(float t) {
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(
    u_colorShift + u_time * 0.012 + u_mids * 0.2,
    u_colorShift * 0.7 + 0.33 + u_energy * 0.15 + u_highs * 0.15,
    u_colorShift * 0.4 + 0.67 + u_bass * 0.2
  );
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);

  // Rotate view on bass hits
  float sa = sin(u_angle);
  float ca = cos(u_angle);
  uv = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  // c = center + uv/zoom (double-float precision for center)
  float ox = uv.x / u_zoom;
  float oy = uv.y / u_zoom;
  vec2 cx = ds_add(vec2(u_center_hi.x, u_center_lo.x), vec2(ox, 0.0));
  vec2 cy = ds_add(vec2(u_center_hi.y, u_center_lo.y), vec2(oy, 0.0));

  // z = 0 (double-float)
  vec2 zx = vec2(0.0, 0.0);
  vec2 zy = vec2(0.0, 0.0);
  float iter = 0.0;
  float maxIter = float(u_maxIter);

  for (int i = 0; i < 350; i++) {
    if (i >= u_maxIter) break;
    // Escape test (hi parts sufficient)
    float r2 = zx.x * zx.x + zy.x * zy.x;
    if (r2 > 4.0) break;

    // z = z^2 + c (double-float precision)
    vec2 zx2 = ds_mul(zx, zx);
    vec2 zy2 = ds_mul(zy, zy);
    vec2 zxy = ds_mul(zx, zy);

    zx = ds_add(ds_sub(zx2, zy2), cx);
    zy = ds_add(ds_add(zxy, zxy), cy);
    iter += 1.0;
  }

  float z_r2 = zx.x * zx.x + zy.x * zy.x;

  if (iter >= maxIter) {
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
  } | null>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { antialias: false, preserveDrawingBuffer: false });
    if (!gl) {
      console.error('WebGL not available');
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
      u_center_hi: gl.getUniformLocation(program, 'u_center_hi'),
      u_center_lo: gl.getUniformLocation(program, 'u_center_lo'),
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
    };

    glRef.current = { gl, program, uniforms };

    return () => {
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  useEffect(() => {
    if (!glRef.current) return;

    // Lower base iterations — double-float math is ~6x heavier per iteration
    const baseMaxIter = quality === 'low' ? 45 : quality === 'high' ? 120 : 70;

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

      // === ZOOM MOMENTUM: music PULLS you into the fractal ===
      if (beat.onset.subBass) {
        zoomVelocityRef.current += 0.02 + beat.pulse.subBass * 0.04;
      }
      if (beat.onset.bass && beat.pulse.bass > 0.15) {
        zoomVelocityRef.current += 0.03 + beat.pulse.bass * 0.06;
      }
      if (beat.onset.mids && beat.pulse.mids > 0.25) {
        zoomVelocityRef.current += 0.01 + beat.pulse.mids * 0.02;
      }
      if (beat.onset.highs && beat.pulse.highs > 0.3) {
        zoomVelocityRef.current += 0.005;
      }

      const energyPull = beat.energy.bass * 0.003 + beat.energy.mids * 0.001 + beat.energy.subBass * 0.002;
      zoomVelocityRef.current += energyPull;

      // Friction
      zoomVelocityRef.current *= 0.93;
      zoomVelocityRef.current = Math.max(zoomVelocityRef.current, 0.002);
      zoomVelocityRef.current = Math.min(zoomVelocityRef.current, 0.12);

      zoomRef.current += zoomVelocityRef.current * speed;
      const zoom = Math.pow(1.5, zoomRef.current);

      // Scale iterations with zoom depth
      const depthBonus = Math.min(80, Math.floor(zoomRef.current * 2));
      const maxIter = baseMaxIter + depthBonus;

      // Double-float gives ~14 digits — good to about zoom level 42
      if (zoomRef.current > 42) {
        zoomRef.current = 0.5;
        zoomVelocityRef.current = 0.008;
        targetIdxRef.current = (targetIdxRef.current + 1) % targets.length;
        offset.x = 0;
        offset.y = 0;
        angleRef.current = 0;
        angleMomentumRef.current = 0;
      }

      const target = targets[targetIdxRef.current];

      // Split center coordinates for double-float precision in shader
      const cx = target.x + offset.x;
      const cy = target.y + offset.y;
      const [cxHi, cxLo] = splitDouble(cx);
      const [cyHi, cyLo] = splitDouble(cy);

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);

      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_center_hi, cxHi, cyHi);
      gl.uniform2f(uniforms.u_center_lo, cxLo, cyLo);
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

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    render();
    return () => cancelAnimationFrame(animRef.current);
  }, [width, height, sensitivity, speed, quality]);

  return <canvas ref={canvasRef} width={width} height={height} className="block" />;
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
