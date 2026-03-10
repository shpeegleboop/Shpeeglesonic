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
