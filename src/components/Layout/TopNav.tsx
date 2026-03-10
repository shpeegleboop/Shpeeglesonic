import { usePlayerStore, ViewMode } from '../../stores/playerStore';

const tabs: { id: ViewMode; label: string; icon: string }[] = [
  { id: 'library', label: 'Library', icon: '♫' },
  { id: 'nowPlaying', label: 'Now Playing', icon: '▶' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function TopNav() {
  const currentView = usePlayerStore((s) => s.currentView);
  const setCurrentView = usePlayerStore((s) => s.setCurrentView);
  const visualizerFullscreen = usePlayerStore((s) => s.visualizerFullscreen);

  if (visualizerFullscreen) return null;

  return (
    <nav className="flex items-center h-10 px-2 bg-cosmic-surface border-b border-cosmic-border/50 gap-1 select-none" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <span className="text-neon-purple font-bold text-sm mr-3 tracking-wider" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        SHPEEGLESONIC
      </span>

      <div className="flex gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setCurrentView(tab.id)}
            className={`px-3 py-1 rounded text-xs font-medium transition-all ${
              currentView === tab.id
                ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />
    </nav>
  );
}
