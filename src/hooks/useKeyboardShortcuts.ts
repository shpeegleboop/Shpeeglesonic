import { useEffect } from 'react';
import { usePlayerStore } from '../stores/playerStore';
import { useAudioPlayer } from './useAudioPlayer';

export function useKeyboardShortcuts() {
  const store = usePlayerStore();
  const player = useAudioPlayer();

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Don't trigger on input elements
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const isMeta = e.metaKey || e.ctrlKey;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.togglePlayPause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (store.currentTrack) player.seek(store.currentTime + 5);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (store.currentTrack) player.seek(Math.max(0, store.currentTime - 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.setVolume(store.volume + 5);
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.setVolume(store.volume - 5);
          break;
        case 'n':
        case 'N':
          if (!isMeta) player.playNextTrack();
          break;
        case 'p':
        case 'P':
          if (!isMeta) player.playPrevTrack();
          break;
        case 's':
        case 'S':
          if (!isMeta) store.toggleShuffle();
          break;
        case 'r':
        case 'R':
          if (!isMeta) store.cycleRepeatMode();
          break;
        case 'f':
        case 'F':
          if (!isMeta) store.setVisualizerFullscreen(!store.visualizerFullscreen);
          break;
        case 'v':
        case 'V':
          if (!isMeta) {
            const modes = ['spectrogram', 'spiral', 'mandelbrot', 'combined'] as const;
            const idx = modes.indexOf(store.visualizerMode);
            store.setVisualizerMode(modes[(idx + 1) % modes.length]);
          }
          break;
        case 'l':
        case 'L':
          if (isMeta) {
            e.preventDefault();
            store.setSidebarCollapsed(!store.sidebarCollapsed);
          } else {
            store.setLyricsVisible(!store.lyricsVisible);
          }
          break;
        case 'm':
        case 'M':
          if (!isMeta) store.toggleMute();
          break;
        case 'Escape':
          if (store.visualizerFullscreen) store.setVisualizerFullscreen(false);
          break;
        case '1':
          if (!isMeta) store.setVisualizerMode('spectrogram');
          break;
        case '2':
          if (!isMeta) store.setVisualizerMode('spiral');
          break;
        case '3':
          if (!isMeta) store.setVisualizerMode('mandelbrot');
          break;
        case '4':
          if (!isMeta) store.setVisualizerMode('combined');
          break;
      }

      // Cmd+F / Ctrl+F — focus search
      if (isMeta && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        const search = document.querySelector<HTMLInputElement>('[data-search-input]');
        search?.focus();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [store, player]);
}
