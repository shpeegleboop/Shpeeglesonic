import { describe, it, expect } from 'vitest';

/**
 * Vortex and Banger Detector both had their entire radius computation inside
 * the per-arm loop, where it ran once per arm per pass for identical results.
 * Hoisting it out, and replacing the per-arm cos/sin with an angle-addition
 * rotation, is only safe if the emitted points are unchanged.
 *
 * These reimplement the loop both ways and compare. They guard the algebra,
 * not the components — if someone later makes the radius depend on the arm
 * index, the components will diverge from this and the test will not notice.
 */

const P = 90; // pointsPerArm at high quality
const ARMS = 8; // the maximum symmetry either mode reaches
const BUCKETS = 48;
const MAX_R = 1200;
const CX = 960;
const CY = 540;
const TWIST = Math.PI * 3.2;
const PHASE = 1.234;
const DIR = -1;
const BREATHE = 1.07;
const WAVES = [0.2, 0.55, 0.9];
const SIGMA = MAX_R * 0.04;
const AMP = MAX_R * 0.022;

/** A spectrum with structure, so the weave term is not a constant. */
const SPEC = Array.from({ length: BUCKETS }, (_, i) => 0.5 + 0.45 * Math.sin(i * 0.7));

/** Logarithmic curve — the branch that carries the extra Math.exp. */
function radiusOf(frac: number): number {
  return MAX_R * 0.8 * ((Math.exp(2.2 * frac) - 1) / (Math.exp(2.2) - 1));
}

function radiusAt(frac: number): number {
  let rr = radiusOf(frac) * BREATHE;
  const pos = frac * (BUCKETS - 1);
  const b0 = Math.floor(pos);
  const t = pos - b0;
  const v = (SPEC[b0] ?? 0) * (1 - t) + (SPEC[Math.min(BUCKETS - 1, b0 + 1)] ?? 0) * t;
  rr *= 1 + v * 0.25 * (0.4 + frac);
  const anchor = Math.min(1, frac * 6);
  for (let w = 0; w < WAVES.length; w++) {
    const d = rr - WAVES[w] * MAX_R * 1.1;
    rr += AMP * Math.exp(-(d * d) / (2 * SIGMA * SIGMA)) * (1 - WAVES[w] * 0.6) * anchor;
  }
  return rr;
}

/** The shape of the loop before: radius and trig rebuilt inside every arm. */
function original(): number[] {
  const out: number[] = [];
  for (let arm = 0; arm < ARMS; arm++) {
    const armOffset = (arm / ARMS) * Math.PI * 2;
    for (let i = 0; i <= P; i++) {
      const frac = i / P;
      const theta = armOffset + PHASE + frac * TWIST * DIR;
      const rr = radiusAt(frac);
      out.push(CX + Math.cos(theta) * rr, CY + Math.sin(theta) * rr);
    }
  }
  return out;
}

/** The shape of the loop after: radius once per layer, trig once per pass. */
function optimized(): number[] {
  const radii = new Float64Array(P + 1);
  const cosBase = new Float64Array(P + 1);
  const sinBase = new Float64Array(P + 1);
  for (let i = 0; i <= P; i++) {
    const frac = i / P;
    radii[i] = radiusAt(frac);
    const a = PHASE + frac * TWIST * DIR;
    cosBase[i] = Math.cos(a);
    sinBase[i] = Math.sin(a);
  }

  const out: number[] = [];
  for (let arm = 0; arm < ARMS; arm++) {
    const armOffset = (arm / ARMS) * Math.PI * 2;
    const ca = Math.cos(armOffset);
    const sa = Math.sin(armOffset);
    for (let i = 0; i <= P; i++) {
      const rr = radii[i];
      out.push(
        CX + (cosBase[i] * ca - sinBase[i] * sa) * rr,
        CY + (sinBase[i] * ca + cosBase[i] * sa) * rr
      );
    }
  }
  return out;
}

describe('hoisted spiral geometry', () => {
  it('emits the same number of points', () => {
    expect(optimized().length).toBe(original().length);
    expect(original().length).toBe(ARMS * (P + 1) * 2);
  });

  // The rotation goes through cos(a+b) = cos a cos b - sin a sin b instead of
  // a second cos call, so this is exact in real arithmetic and off by a few
  // ULP in floating point. At a 1200px radius that is ~1e-13 of a pixel —
  // twelve orders of magnitude below the canvas subpixel grid.
  it('places every point within a billionth of a pixel of the original', () => {
    const a = original();
    const b = optimized();
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    expect(worst).toBeLessThan(1e-9);
  });

  // The hoist is only valid because nothing in the radius depends on the arm.
  // If that stops being true this fails loudly rather than drifting.
  it('gives every arm an identical radius profile', () => {
    const pts = original();
    const stride = (P + 1) * 2;
    for (let arm = 1; arm < ARMS; arm++) {
      for (let i = 0; i <= P; i++) {
        const r0 = Math.hypot(pts[i * 2] - CX, pts[i * 2 + 1] - CY);
        const rn = Math.hypot(
          pts[arm * stride + i * 2] - CX,
          pts[arm * stride + i * 2 + 1] - CY
        );
        expect(Math.abs(r0 - rn)).toBeLessThan(1e-9);
      }
    }
  });
});
