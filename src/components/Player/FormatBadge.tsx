import { formatSampleRate, formatBitDepth, formatBitrate } from '../../utils/formatters';

interface FormatBadgeProps {
  format?: string | null;
  sampleRate?: number | null;
  bitDepth?: number | null;
  bitrate?: number | null;
}

export function FormatBadge({ format, sampleRate, bitDepth, bitrate }: FormatBadgeProps) {
  const parts: string[] = [];

  if (format) parts.push(format.toUpperCase());
  if (bitDepth) parts.push(formatBitDepth(bitDepth));
  if (sampleRate) parts.push(formatSampleRate(sampleRate));
  if (bitrate) parts.push(formatBitrate(bitrate));

  if (parts.length === 0) return null;

  return (
    <div className="flex gap-1 flex-wrap">
      {parts.map((part, i) => (
        <span
          key={i}
          className="badge bg-neon-purple/10 text-neon-purple/80 border border-neon-purple/20"
        >
          {part}
        </span>
      ))}
    </div>
  );
}
