import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '../../stores/playerStore';

interface LyricLine {
  time: number;
  text: string;
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/;

  for (const line of lrc.split('\n')) {
    const match = regex.exec(line);
    if (match) {
      const mins = parseInt(match[1]);
      const secs = parseInt(match[2]);
      const ms = parseInt(match[3].padEnd(3, '0'));
      const time = mins * 60 + secs + ms / 1000;
      const text = match[4].trim();
      if (text) lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function LyricsPanel() {
  const track = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const lyricsVisible = usePlayerStore((s) => s.lyricsVisible);
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!track || !lyricsVisible) return;

    setLyrics(null);
    setPlainLyrics(null);
    setLoading(true);

    invoke<{ synced_lyrics: string | null; plain_lyrics: string | null; source: string } | null>(
      'fetch_lyrics',
      {
        trackId: track.id,
        artist: track.artist || '',
        title: track.title || track.file_name,
        album: track.album,
        duration: track.duration_seconds,
        filePath: track.file_path,
      }
    )
      .then((result) => {
        if (result?.synced_lyrics) {
          setLyrics(parseLRC(result.synced_lyrics));
        } else if (result?.plain_lyrics) {
          setPlainLyrics(result.plain_lyrics);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [track?.id, lyricsVisible]);

  // Auto-scroll to active lyric
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime, lyrics]);

  if (!lyricsVisible) return null;

  // Find current lyric line
  let activeIndex = -1;
  if (lyrics) {
    for (let i = lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics[i].time) {
        activeIndex = i;
        break;
      }
    }
  }

  return (
    <div className="w-64 glass-panel flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-cosmic-border/30 flex items-center justify-between">
        <span className="text-xs text-gray-400 font-medium">Lyrics</span>
        <button
          onClick={() => usePlayerStore.getState().setLyricsVisible(false)}
          className="text-xs text-gray-500 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto p-4 text-center">
        {loading && <p className="text-gray-500 text-sm">Loading lyrics...</p>}

        {!loading && !lyrics && !plainLyrics && (
          <p className="text-gray-600 text-sm italic">No lyrics available</p>
        )}

        {lyrics &&
          lyrics.map((line, i) => (
            <div
              key={i}
              ref={i === activeIndex ? activeRef : undefined}
              className={`py-1.5 transition-all duration-300 cursor-pointer ${
                i === activeIndex
                  ? 'text-white text-lg font-medium text-glow'
                  : Math.abs(i - activeIndex) <= 2
                  ? 'text-gray-400 text-sm'
                  : 'text-gray-600 text-xs'
              }`}
              onClick={() => {
                invoke('seek', { position: line.time }).catch(() => {});
              }}
            >
              {line.text}
            </div>
          ))}

        {plainLyrics && (
          <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
            {plainLyrics}
          </div>
        )}
      </div>
    </div>
  );
}
