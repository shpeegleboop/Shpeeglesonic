import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { usePlayerStore, TrackInfo } from './stores/playerStore';
import { QueueSidebar } from './components/Queue/QueueSidebar';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TopNav } from './components/Layout/TopNav';
import { Sidebar } from './components/Layout/Sidebar';
import { BottomBar } from './components/Layout/BottomBar';
import { NowPlaying } from './components/Player/NowPlaying';
import { ArtLightbox } from './components/Player/ArtLightbox';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { LyricsPanel } from './components/Lyrics/LyricsPanel';
import { VisualizerContainer } from './components/Visualizer/VisualizerContainer';
import { VisualizerView } from './components/Visualizer/VisualizerView';
import { LibraryView } from './components/Library/LibraryView';

function ErrorToast() {
  const error = usePlayerStore((s) => s.playbackError);
  const setError = usePlayerStore((s) => s.setPlaybackError);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }, [error, setError]);

  if (!error) return null;

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 max-w-md">
      <div className="bg-red-900/90 border border-red-500/50 rounded-lg px-4 py-3 shadow-xl shadow-black/50 backdrop-blur-sm flex items-center gap-3">
        <span className="text-red-300 text-sm flex-1">{error}</span>
        <button onClick={() => setError(null)} className="text-red-400 hover:text-white text-xs flex-shrink-0">
          dismiss
        </button>
      </div>
    </div>
  );
}

function App() {
  const currentView = usePlayerStore((s) => s.currentView);
  const visualizerFullscreen = usePlayerStore((s) => s.visualizerFullscreen);
  const lyricsVisible = usePlayerStore((s) => s.lyricsVisible);

  useKeyboardShortcuts();

  // Fullscreen visualizer = real OS fullscreen, not just filling the window
  useEffect(() => {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().setFullscreen(visualizerFullscreen).catch(() => {});
    });
  }, [visualizerFullscreen]);

  // Restore the previous session into the audio engine on launch:
  // volume, plus the last track loaded paused at its saved position.
  const sessionRestored = useRef(false);
  useEffect(() => {
    if (sessionRestored.current) return; // StrictMode double-mounts effects in dev
    sessionRestored.current = true;

    const s = usePlayerStore.getState();
    invoke('set_volume', { volume: s.isMuted ? 0 : s.volume }).catch(() => {});

    if (s.currentTrack && !s.trackInfo) {
      invoke<TrackInfo>('load_file_paused', {
        path: s.currentTrack.file_path,
        position: s.currentTime || 0,
      })
        .then((info) => {
          const st = usePlayerStore.getState();
          st.setTrackInfo(info);
          st.setDuration(info.duration_seconds);
          st.setIsPlaying(false);
        })
        .catch((e) => {
          // File missing or unreadable — leave the UI restored; play will surface the error
          console.warn('Session restore failed:', e);
        });
    }
  }, []);

  // Suppress the WebView2 default context menu (Refresh/Print/Save as…) —
  // the app provides its own menus. Text fields keep theirs for copy/paste.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"]')) return;
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  // Prevent double-click from opening new windows in Tauri WebView
  useEffect(() => {
    const preventNav = (e: MouseEvent) => {
      if (e.detail >= 2) {
        e.preventDefault();
      }
    };
    window.addEventListener('dblclick', preventNav);
    return () => window.removeEventListener('dblclick', preventNav);
  }, []);

  const renderMainContent = () => {
    switch (currentView) {
      case 'settings':
        return <SettingsPanel />;
      case 'visualizer':
        return <VisualizerView />;
      case 'library':
        return <LibraryView />;
      case 'nowPlaying':
      default:
        return <NowPlaying />;
    }
  };

  const showSidebar = currentView === 'nowPlaying';
  const showLyrics = lyricsVisible && currentView === 'nowPlaying';

  return (
    <div className="h-screen flex flex-col">
      <TopNav />

      <div className="flex-1 flex overflow-hidden relative">
        {showSidebar && <Sidebar />}

        <main className="flex-1 flex overflow-hidden">
          {renderMainContent()}
          {showLyrics && <LyricsPanel />}
        </main>

        <QueueSidebar />
      </div>

      <div className="relative">
        <BottomBar />
      </div>

      {visualizerFullscreen && <VisualizerContainer />}
      <ArtLightbox />
      <ErrorToast />
    </div>
  );
}

export default App;
