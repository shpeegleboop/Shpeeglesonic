import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../../stores/playerStore';

interface AlbumArtProps {
  track: Track;
  size?: 'sm' | 'md' | 'lg';
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
  };

  return (
    <div className={`${sizeClasses[size]} rounded-lg overflow-hidden flex-shrink-0 relative`}>
      {artUrl ? (
        <img src={artUrl} alt="Album art" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 flex items-center justify-center">
          <span className={size === 'sm' ? 'text-lg' : 'text-5xl'}>♫</span>
        </div>
      )}
      {/* Glow effect for large sizes */}
      {size !== 'sm' && artUrl && (
        <div className="absolute inset-0 rounded-lg" style={{
          boxShadow: '0 0 40px rgba(168, 85, 247, 0.2), 0 0 80px rgba(168, 85, 247, 0.1)',
        }} />
      )}
    </div>
  );
}
