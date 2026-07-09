import { usePlayerStore, ViewMode } from '../../stores/playerStore';
import { LibraryIcon, MusicNoteIcon, SettingsIcon, WaveIcon } from '../Icons';

const tabs: { id: ViewMode; label: string; Icon: typeof LibraryIcon }[] = [
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  { id: 'nowPlaying', label: 'Now Playing', Icon: MusicNoteIcon },
  { id: 'visualizer', label: 'Visualizer', Icon: WaveIcon },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function TopNav() {
  const currentView = usePlayerStore((s) => s.currentView);
  const setCurrentView = usePlayerStore((s) => s.setCurrentView);
  const visualizerFullscreen = usePlayerStore((s) => s.visualizerFullscreen);

  if (visualizerFullscreen) return null;

  return (
    <nav className="flex items-center h-11 px-3 glass-surface border-b border-cosmic-border/50 gap-1 select-none flex-shrink-0">
      <span className="brand-gradient font-bold text-sm mr-4 tracking-[0.2em]">
        SHPEEGLESONIC
      </span>

      <div className="flex gap-1">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setCurrentView(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              currentView === id
                ? 'bg-neon-purple/20 text-neon-purple shadow-[0_0_12px_rgba(168,85,247,0.2)] border border-neon-purple/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1" />
    </nav>
  );
}
