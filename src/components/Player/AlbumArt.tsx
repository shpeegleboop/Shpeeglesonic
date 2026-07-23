import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../../stores/playerStore';

interface AlbumArtProps {
  track: Track;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function AlbumArt({ track, size = 'md' }: AlbumArtProps) {
  const [artUrl, setArtUrl] = useState<string | null>(null);

  useEffect(() => {
    setArtUrl(null);
    if (!track.has_album_art && !track.art_path) return;

    const loadArt = async () => {
      try {
        let path = track.art_path;
        if (!path && track.id > 0) {
          path = await invoke<string | null>('get_track_art', { trackId: track.id });
        }
        if (path) {
          const base64 = await invoke<string | null>('get_art_base64', { path });
          if (base64) setArtUrl(base64);
        }
      } catch {
        // No art available
      }
    };
    loadArt();
  }, [track.id, track.file_path]);

  const sizeClasses = {
    sm: 'w-10 h-10',
    md: 'w-48 h-48',
    lg: 'w-72 h-72',
    xl: 'w-[min(85vmin,56rem)] h-[min(85vmin,56rem)]',
  };

  return (
    <div className={`${sizeClasses[size]} rounded-lg overflow-hidden flex-shrink-0 relative ring-1 ring-white/10 ${size !== 'sm' ? 'shadow-2xl shadow-black/50' : ''}`}>
      {artUrl ? (
        <img src={artUrl} alt="Album art" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 flex items-center justify-center text-neon-purple/40">
          <svg width={size === 'sm' ? 16 : 56} height={size === 'sm' ? 16 : 56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      {/* Glow effect for large sizes */}
      {size !== 'sm' && artUrl && (
        <div className="absolute inset-0 rounded-lg pointer-events-none" style={{
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 0 40px rgba(168, 85, 247, 0.25), 0 0 80px rgba(168, 85, 247, 0.12)',
        }} />
      )}
    </div>
  );
}
