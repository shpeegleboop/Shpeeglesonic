import { useEffect } from 'react';
import { usePlayerStore } from './stores/playerStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TopNav } from './components/Layout/TopNav';
import { Sidebar } from './components/Layout/Sidebar';
import { BottomBar } from './components/Layout/BottomBar';
import { NowPlaying } from './components/Player/NowPlaying';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { LyricsPanel } from './components/Lyrics/LyricsPanel';
import { VisualizerContainer } from './components/Visualizer/VisualizerContainer';
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
    <div className="h-screen flex flex-col bg-cosmic-bg">
      <TopNav />

      <div className="flex-1 flex overflow-hidden relative">
        {showSidebar && <Sidebar />}

        <main className="flex-1 flex overflow-hidden">
          {renderMainContent()}
          {showLyrics && <LyricsPanel />}
        </main>
      </div>

      <div className="relative">
        <BottomBar />
      </div>

      {visualizerFullscreen && <VisualizerContainer />}
      <ErrorToast />
    </div>
  );
}

export default App;
