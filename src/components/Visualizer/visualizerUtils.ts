import type React from 'react';

// Frequency band ranges (bin indices for 2048-point FFT at 44100Hz, ~21.5Hz per bin)
export const BANDS = {
  subBass: { start: 1, end: 4 },     // 20-80Hz
  bass: { start: 4, end: 12 },       // 80-250Hz
  mids: { start: 12, end: 93 },      // 250Hz-2kHz
  highs: { start: 93, end: 372 },    // 2kHz-8kHz
  air: { start: 372, end: 1024 },    // 8kHz+
};

export function getBandEnergy(bins: number[], band: { start: number; end: number }): number {
  let sum = 0;
  let count = 0;
  for (let i = band.start; i < Math.min(band.end, bins.length); i++) {
    sum += bins[i];
    count++;
  }
  return count > 0 ? sum / count / 255 : 0;
}

export function getLogBins(bins: number[], numBars: number): number[] {
  const result = new Array(numBars).fill(0);
  const maxBin = Math.min(bins.length, 1024);

  for (let i = 0; i < numBars; i++) {
    const startBin = Math.floor(Math.pow(maxBin, i / numBars));
    const endBin = Math.floor(Math.pow(maxBin, (i + 1) / numBars));
    let sum = 0;
    let count = 0;
    for (let j = startBin; j <= Math.min(endBin, maxBin - 1); j++) {
      sum += bins[j] || 0;
      count++;
    }
    result[i] = count > 0 ? sum / count : 0;
  }

  return result;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = h % 360;
  s = s / 100;
  l = l / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Get FFT data with smooth decay when no new data is arriving (e.g. between tracks).
 * Prevents jarring visual snap to zero.
 */
export function getDecayedFFT(
  fftRef: React.RefObject<{ bins: number[]; rms: number; time: number } | null>,
  lastUpdateRef: React.RefObject<number | null>
): { bins: number[]; rms: number; time: number } | null {
  const data = fftRef.current;
  if (!data) return null;

  const lastUpdate = lastUpdateRef.current ?? Date.now();
  const elapsed = Date.now() - lastUpdate;
  if (elapsed < 50) return data; // fresh data, no decay needed

  const decay = Math.pow(0.85, elapsed / 16);
  if (decay < 0.01) {
    // Fully decayed — return zeros
    return { bins: data.bins.map(() => 0), rms: 0, time: data.time };
  }
  return {
    bins: data.bins.map(b => Math.floor(b * decay)),
    rms: data.rms * decay,
    time: data.time,
  };
}

/**
 * Beat/transient detection engine.
 * Tracks per-band spectral flux and produces beat pulse values
 * that spike on transients and decay quickly.
 */
export class BeatDetector {
  // Previous frame's band energies for flux calculation
  private prevBands = { subBass: 0, bass: 0, mids: 0, highs: 0, air: 0 };

  // Rolling average of band energies for adaptive thresholding
  private avgBands = { subBass: 0, bass: 0, mids: 0, highs: 0, air: 0 };

  // Beat pulse values (spike on onset, fast decay)
  pulse = { subBass: 0, bass: 0, mids: 0, highs: 0, air: 0, combined: 0 };

  // Envelope-followed energies (fast attack, slow release)
  energy = { subBass: 0, bass: 0, mids: 0, highs: 0, air: 0 };

  // Onset flags — true on the frame a beat is detected
  onset = { subBass: false, bass: false, mids: false, highs: false, air: false, any: false };

  // Configurable thresholds
  private onsetThreshold = 1.4;  // current must be this * average to trigger
  private pulseDecay = 0.85;     // how fast pulse decays (lower = faster)
  private avgSmoothing = 0.96;   // rolling average smoothing (higher = longer memory)
  private attackSpeed = 0.5;     // envelope attack (higher = faster)
  private releaseSpeed = 0.92;   // envelope release (higher = slower)

  update(bins: number[], sensitivity: number) {
    const raw = {
      subBass: getBandEnergy(bins, BANDS.subBass) * sensitivity,
      bass: getBandEnergy(bins, BANDS.bass) * sensitivity,
      mids: getBandEnergy(bins, BANDS.mids) * sensitivity,
      highs: getBandEnergy(bins, BANDS.highs) * sensitivity,
      air: getBandEnergy(bins, BANDS.air) * sensitivity,
    };

    // Reset onset flags
    this.onset.subBass = false;
    this.onset.bass = false;
    this.onset.mids = false;
    this.onset.highs = false;
    this.onset.air = false;
    this.onset.any = false;

    const bandKeys = ['subBass', 'bass', 'mids', 'highs', 'air'] as const;

    for (const key of bandKeys) {
      // Spectral flux: positive difference from previous frame
      const flux = Math.max(0, raw[key] - this.prevBands[key]);

      // Update rolling average
      this.avgBands[key] = this.avgBands[key] * this.avgSmoothing + raw[key] * (1 - this.avgSmoothing);

      // Onset detection: current energy significantly above rolling average
      const threshold = Math.max(this.avgBands[key] * this.onsetThreshold, 0.05);
      if (flux > threshold * 0.5 && raw[key] > threshold) {
        this.onset[key] = true;
        this.onset.any = true;
        // Spike pulse to flux intensity (clamped)
        this.pulse[key] = Math.min(1.0, flux * 4 + 0.3);
      } else {
        // Decay pulse
        this.pulse[key] *= this.pulseDecay;
      }

      // Asymmetric envelope follower: fast attack, slow release
      if (raw[key] > this.energy[key]) {
        this.energy[key] = this.energy[key] * (1 - this.attackSpeed) + raw[key] * this.attackSpeed;
      } else {
        this.energy[key] = this.energy[key] * this.releaseSpeed + raw[key] * (1 - this.releaseSpeed);
      }

      this.prevBands[key] = raw[key];
    }

    // Combined pulse: weighted sum emphasizing bass
    this.pulse.combined = Math.min(1.0,
      this.pulse.subBass * 0.35 +
      this.pulse.bass * 0.3 +
      this.pulse.mids * 0.2 +
      this.pulse.highs * 0.1 +
      this.pulse.air * 0.05
    );
  }
}
