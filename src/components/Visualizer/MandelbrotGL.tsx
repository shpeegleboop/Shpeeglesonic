import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { BeatDetector } from './visualizerUtils';
import { usePlayerStore } from '../../stores/playerStore';

interface MandelbrotGLProps {
  fftRef: React.RefObject<FFTData>;
  width: number;
  height: number;
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
uniform vec2 u_center;
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

vec3 palette(float t) {
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  // Color shift driven by transients — entire palette rotates
  vec3 d = vec3(
    u_colorShift + u_time * 0.012 + u_mids * 0.2,
    u_colorShift * 0.7 + 0.33 + u_energy * 0.15 + u_highs * 0.15,
    u_colorShift * 0.4 + 0.67 + u_bass * 0.2
  );
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);

  // Rotate the view on bass hits
  float s = sin(u_angle);
  float c2 = cos(u_angle);
  uv = vec2(uv.x * c2 - uv.y * s, uv.x * s + uv.y * c2);

  vec2 c = uv / u_zoom + u_center;

  vec2 z = vec2(0.0);
  float iter = 0.0;
  float maxIter = float(u_maxIter);

  for (int i = 0; i < 512; i++) {
    if (i >= u_maxIter) break;
    if (dot(z, z) > 4.0) break;
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    iter += 1.0;
  }

  if (iter >= maxIter) {
    // Interior: pulse glow on beats
    float glow = u_pulse * 0.2;
    vec3 interiorColor = palette(u_time * 0.01 + u_colorShift) * glow;
    gl_FragColor = vec4(interiorColor, 1.0);
  } else {
    float smoothIter = iter - log2(log2(dot(z, z))) + 4.0;
    float t = smoothIter / maxIter;
    t = t + u_time * 0.005 + u_energy * 0.12;
    vec3 color = palette(t);

    // Brightness: base + energy + pulse flash
    float brightness = 0.65 + u_energy * 0.45 + u_pulse * 0.7;
    color *= brightness;

    // White-hot flash on strong pulses
    color = mix(color, vec3(1.0, 0.95, 0.9), u_pulse * 0.4);

    // Saturation boost from mids/highs
    float sat = 1.0 + u_highs * 0.4 + u_mids * 0.2;
    vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(gray, color, sat);

    // Extra color vibrancy on transients
    color = pow(color, vec3(0.9 - u_pulse * 0.15));

    gl_FragColor = vec4(color, 1.0);
  }
}
`;

export function MandelbrotGL({ fftRef, width, height }: MandelbrotGLProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<{
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    uniforms: Record<string, WebGLUniformLocation | null>;
  } | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const zoomRef = useRef(0.5);
  const zoomVelocityRef = useRef(0.01); // zoom momentum — music pulls this
  const targetIdxRef = useRef(0);
  const beatRef = useRef(new BeatDetector());
  const colorShiftRef = useRef(0);
  const angleRef = useRef(0);       // camera rotation angle
  const angleMomentumRef = useRef(0); // angular velocity from beats
  const centerOffsetRef = useRef({ x: 0, y: 0 }); // camera wobble
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
      u_center: gl.getUniformLocation(program, 'u_center'),
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

    const baseMaxIter = quality === 'low' ? 60 : quality === 'high' ? 200 : 100;

    // All targets sit ON the Mandelbrot boundary — rich fractal detail at every zoom depth
    const targets = [
      { x: -0.7435669,    y: 0.1314023 },    // Seahorse valley — classic spirals
      { x: -0.7473,       y: 0.1088 },       // Double spiral — intertwined arms
      { x: -0.74364388,   y: 0.13182590 },   // Mini Mandelbrot in seahorse — zooms into a tiny copy
      { x: -0.761574,     y: -0.0847596 },   // Spiral galaxy — arm-like structures
      { x: 0.250006,      y: 0.0000045 },    // Elephant valley cusp — trunk-like bulges
      { x: -0.235125,     y: 0.827215 },     // Period-3 bulb boundary — ornate filigree
      { x: -1.25066,      y: 0.02012 },      // Antenna branch point — dendrite branching
      { x: -0.745428,     y: 0.113009 },     // Scepter valley — delicate tendrils
    ];

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const { gl, program, uniforms } = glRef.current!;
      const data = fftRef.current;
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

      // === CAMERA POSITION WOBBLE: shifts on bass hits ===
      const offset = centerOffsetRef.current;
      if (beat.onset.bass && beat.pulse.bass > 0.3) {
        const wobbleScale = 0.0001 / Math.max(0.01, Math.pow(1.5, zoomRef.current - 5));
        offset.x += (Math.random() - 0.5) * wobbleScale;
        offset.y += (Math.random() - 0.5) * wobbleScale;
      }
      offset.x *= 0.97;
      offset.y *= 0.97;

      // === ZOOM MOMENTUM: music PULLS you into the fractal ===
      // Gentle surges — feel the beat, don't blast through
      if (beat.onset.subBass) {
        zoomVelocityRef.current += 0.02 + beat.pulse.subBass * 0.04;
      }
      if (beat.onset.bass && beat.pulse.bass > 0.15) {
        zoomVelocityRef.current += 0.03 + beat.pulse.bass * 0.06;
      }
      // Mids give smaller pulls
      if (beat.onset.mids && beat.pulse.mids > 0.25) {
        zoomVelocityRef.current += 0.01 + beat.pulse.mids * 0.02;
      }
      // Highs give tiny flutters
      if (beat.onset.highs && beat.pulse.highs > 0.3) {
        zoomVelocityRef.current += 0.005;
      }

      // Continuous energy pull — louder music = slightly faster cruise
      const energyPull = beat.energy.bass * 0.003 + beat.energy.mids * 0.001 + beat.energy.subBass * 0.002;
      zoomVelocityRef.current += energyPull;

      // Friction — coast between beats, decelerate smoothly
      zoomVelocityRef.current *= 0.93;

      // Minimum drift so it never fully stops — gentle pull even in silence
      zoomVelocityRef.current = Math.max(zoomVelocityRef.current, 0.002);
      // Cap — keep it appreciable, not breakneck
      zoomVelocityRef.current = Math.min(zoomVelocityRef.current, 0.12);

      // Apply velocity
      zoomRef.current += zoomVelocityRef.current * speed;
      const zoom = Math.pow(1.5, zoomRef.current);

      // Scale iterations with zoom depth — deeper = more detail needed
      const depthBonus = Math.min(150, Math.floor(zoomRef.current * 4));
      const maxIter = baseMaxIter + depthBonus;

      // Reset when zoomed past float precision limit
      if (zoomRef.current > 38) {
        zoomRef.current = 0.5;
        zoomVelocityRef.current = 0.008;
        targetIdxRef.current = (targetIdxRef.current + 1) % targets.length;
        offset.x = 0;
        offset.y = 0;
        angleRef.current = 0;
        angleMomentumRef.current = 0;
      }

      const target = targets[targetIdxRef.current];

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);

      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_center, target.x + offset.x, target.y + offset.y);
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
