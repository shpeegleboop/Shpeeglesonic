import { useRef, useEffect } from 'react';
import type { FFTData } from '../../hooks/useFFTData';
import { getBandEnergy, BANDS } from './visualizerUtils';
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
uniform int u_maxIter;

vec3 palette(float t) {
  // Psychedelic color palette
  vec3 a = vec3(0.5, 0.5, 0.5);
  vec3 b = vec3(0.5, 0.5, 0.5);
  vec3 c = vec3(1.0, 1.0, 1.0);
  vec3 d = vec3(0.0 + u_time * 0.01, 0.33 + u_energy * 0.1, 0.67 + u_bass * 0.1);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / min(u_resolution.x, u_resolution.y);
  vec2 c = uv / u_zoom + u_center;

  vec2 z = vec2(0.0);
  float iter = 0.0;
  float maxIter = float(u_maxIter);

  for (int i = 0; i < 300; i++) {
    if (i >= u_maxIter) break;
    if (dot(z, z) > 4.0) break;
    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    iter += 1.0;
  }

  if (iter >= maxIter) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  } else {
    // Smooth iteration count
    float smoothIter = iter - log2(log2(dot(z, z))) + 4.0;
    float t = smoothIter / maxIter;
    t = t + u_time * 0.005 + u_energy * 0.1;
    vec3 color = palette(t);
    color *= 0.7 + u_energy * 0.5;
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

    // Compile shaders
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

    // Full-screen quad
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

    const maxIter = quality === 'low' ? 60 : quality === 'high' ? 200 : 100;

    // Interesting zoom targets on the Mandelbrot set boundary
    const targets = [
      { x: -0.7435, y: 0.1314 },   // Seahorse valley
      { x: -0.1011, y: 0.9563 },   // Near top
      { x: -1.2560, y: 0.0 },      // Antenna area
    ];
    const target = targets[0];

    const render = () => {
      animRef.current = requestAnimationFrame(render);

      const { gl, program, uniforms } = glRef.current!;
      const data = fftRef.current;

      timeRef.current += 0.016 * speed;
      const energy = data.rms * sensitivity;
      const bassEnergy = getBandEnergy(data.bins, BANDS.bass) * sensitivity;

      // Zoom in slowly, bass hits accelerate zoom
      zoomRef.current += (0.001 + bassEnergy * 0.005) * speed;
      const zoom = Math.pow(1.5, zoomRef.current);

      // Reset zoom periodically
      if (zoomRef.current > 30) zoomRef.current = 0.5;

      gl.viewport(0, 0, width, height);
      gl.useProgram(program);

      gl.uniform2f(uniforms.u_resolution, width, height);
      gl.uniform2f(uniforms.u_center, target.x, target.y);
      gl.uniform1f(uniforms.u_zoom, zoom);
      gl.uniform1f(uniforms.u_time, timeRef.current);
      gl.uniform1f(uniforms.u_energy, Math.min(1, energy));
      gl.uniform1f(uniforms.u_bass, Math.min(1, bassEnergy));
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
