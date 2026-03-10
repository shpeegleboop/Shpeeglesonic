interface SearchBarProps {
  value: string;
  onChange: (query: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm">🔍</span>
      <input
        data-search-input
        type="text"
        placeholder="Search tracks..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full pl-7 pr-3 py-1.5 bg-cosmic-bg/50 border border-cosmic-border/30 rounded-md text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-neon-purple/40"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
        >
          ✕
        </button>
      )}
    </div>
  );
}
