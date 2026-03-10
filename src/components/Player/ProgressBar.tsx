import { useRef, useState } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { formatDuration } from '../../utils/formatters';

export function ProgressBar() {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const player = useAudioPlayer();
  const barRef = useRef<HTMLDivElement>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const getTimeFromEvent = (e: React.MouseEvent) => {
    if (!barRef.current || !duration) return 0;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return pct * duration;
  };

  return (
    <div className="w-full">
      <div
        ref={barRef}
        className="relative h-6 flex items-center cursor-pointer group"
        onClick={(e) => player.seek(getTimeFromEvent(e))}
        onMouseMove={(e) => setHoverTime(getTimeFromEvent(e))}
        onMouseLeave={() => setHoverTime(null)}
      >
        <div className="w-full h-1 rounded-full bg-cosmic-border group-hover:h-1.5 transition-all">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-pink transition-none relative"
            style={{ width: `${progress}%` }}
          >
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {hoverTime !== null && (
          <div
            className="absolute -top-6 bg-cosmic-panel px-1.5 py-0.5 rounded text-xs font-mono text-gray-300 pointer-events-none"
            style={{
              left: `${(hoverTime / (duration || 1)) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            {formatDuration(hoverTime)}
          </div>
        )}
      </div>

      <div className="flex justify-between text-xs font-mono text-gray-500 mt-0.5">
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  );
}
