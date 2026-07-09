export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBitrate(kbps: number | null | undefined): string {
  if (!kbps) return '';
  return `${kbps}kbps`;
}

export function formatSampleRate(hz: number | null | undefined): string {
  if (!hz) return '';
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}kHz`;
  return `${hz}Hz`;
}

export function formatBitDepth(bits: number | null | undefined): string {
  if (!bits) return '';
  return `${bits}bit`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function trackDisplayTitle(track: { title?: string | null; file_name?: string }): string {
  return track.title || track.file_name || 'Unknown Title';
}

export function trackDisplayArtist(track: { artist?: string | null }): string {
  return track.artist || 'Unknown Artist';
}
