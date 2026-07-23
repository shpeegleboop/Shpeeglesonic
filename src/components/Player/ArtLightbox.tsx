import { useEffect } from 'react';
import { usePlayerStore } from '../../stores/playerStore';
import { AlbumArt } from './AlbumArt';

/** Fullscreen album-art viewer — click anywhere or press Esc to close. */
export function ArtLightbox() {
  const visible = usePlayerStore((s) => s.artZoomVisible);
  const track = usePlayerStore((s) => s.currentTrack);
  const close = usePlayerStore((s) => s.setArtZoomVisible);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    // Capture phase so Esc closes the lightbox before any other handler sees it
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [visible, close]);

  if (!visible || !track) return null;

  return (
    <div
      data-testid="art-lightbox"
      className="fixed inset-0 z-[200] bg-black/85 backdrop-blur-sm flex items-center justify-center cursor-zoom-out"
      onClick={() => close(false)}
    >
      <AlbumArt track={track} size="xl" />
    </div>
  );
}
