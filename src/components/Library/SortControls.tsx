interface SortControlsProps {
  sortBy: string;
  sortOrder: string;
  onSort: (by: string, order?: string) => void;
}

const sortOptions = [
  { value: 'artist', label: 'Artist' },
  { value: 'album', label: 'Album' },
  { value: 'title', label: 'Title' },
  { value: 'genre', label: 'Genre' },
  { value: 'year', label: 'Year' },
  { value: 'bpm', label: 'BPM' },
  { value: 'duration', label: 'Duration' },
  { value: 'date_added', label: 'Date Added' },
  { value: 'format', label: 'Format' },
  { value: 'sample_rate', label: 'Sample Rate' },
];

export function SortControls({ sortBy, sortOrder, onSort }: SortControlsProps) {
  return (
    <div className="flex items-center gap-1">
      <select
        value={sortBy}
        onChange={(e) => onSort(e.target.value)}
        className="flex-1 bg-cosmic-bg/50 border border-cosmic-border/30 rounded text-xs text-gray-300 py-1 px-1.5 focus:outline-none focus:border-neon-purple/40"
      >
        {sortOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        onClick={() => onSort(sortBy, sortOrder === 'asc' ? 'desc' : 'asc')}
        className="btn-ghost text-xs px-1"
        title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
      >
        {sortOrder === 'asc' ? '↑' : '↓'}
      </button>
    </div>
  );
}
