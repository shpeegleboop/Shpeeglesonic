import { type Track } from '../stores/playerStore';

export type GroupField = 'artist' | 'album' | 'genre' | 'year' | 'format' | 'playlist';

/** One column: how it groups, and what is selected in it. */
export interface BrowseStep {
  field: GroupField;
  /**
   * null means either "nothing selected yet" or the Unknown bucket, depending
   * on position — a step is only applied as a filter when it sits above the
   * column being rendered.
   */
  value: string | null;
}

export interface BrowseGroup {
  field: GroupField;
  value: string | null;
  label: string;
  count: number;
  tracks: Track[];
}

export const GROUP_FIELDS: GroupField[] = ['artist', 'album', 'genre', 'year', 'format', 'playlist'];

export const GROUP_FIELD_LABELS: Record<GroupField, string> = {
  artist: 'Artist',
  album: 'Album',
  genre: 'Genre',
  year: 'Year',
  format: 'Format',
  playlist: 'Playlist',
};

export function isGroupField(f: unknown): f is GroupField {
  return typeof f === 'string' && (GROUP_FIELDS as string[]).includes(f);
}

/**
 * Moved from TrackList.tsx, which is no longer its caller.
 *
 * The default case is load-bearing, not defensive padding: persisted state can
 * carry a field that is no longer valid, and returning undefined here meant
 * destructuring it threw during render, which unmounts the entire React tree
 * and leaves a black window with no clue why.
 */
export function getGroupValue(track: Track, field: GroupField): { value: string | null; label: string } {
  switch (field) {
    case 'artist':
      return { value: track.artist ?? null, label: track.artist || 'Unknown Artist' };
    case 'album':
      return { value: track.album ?? null, label: track.album || 'Unknown Album' };
    case 'genre':
      return { value: track.genre ?? null, label: track.genre || 'Unknown Genre' };
    case 'year':
      return { value: track.year ? String(track.year) : null, label: track.year ? String(track.year) : 'Unknown Year' };
    case 'format':
      return { value: track.format ?? null, label: track.format ? track.format.toUpperCase() : 'Unknown Format' };
    case 'playlist':
      return { value: track.playlist_label ?? null, label: track.playlist_label || 'Not in a Playlist' };
    default:
      return { value: null, label: 'Unknown' };
  }
}

/**
 * The default drill-down chain. A column carries its own field, so changing a
 * column's grouping overrides this from that column down.
 */
const CHAIN: Record<GroupField, GroupField | null> = {
  genre: 'artist',
  year: 'artist',
  format: 'artist',
  playlist: 'artist',
  artist: 'album',
  album: null,
};

export function nextField(current: GroupField): GroupField | null {
  return CHAIN[current];
}

/**
 * Fields a column may group by: everything except those an ancestor column has
 * already pinned to a single value. Re-grouping Radiohead's tracks by artist
 * yields one group called "Radiohead", and selecting it appends another
 * identical column — forever. Excluding used fields makes that unreachable
 * rather than merely discouraged.
 */
export function availableFieldsFor(path: BrowseStep[], index: number): GroupField[] {
  const used = new Set(path.slice(0, index).map((s) => s.field));
  return GROUP_FIELDS.filter((f) => !used.has(f));
}

/**
 * The next field after column `index`, skipping any the path already uses.
 * Returns null when the chain is exhausted, which is what makes a column the
 * last one before tracks.
 */
export function nextFieldFor(path: BrowseStep[], index: number): GroupField | null {
  const used = new Set(path.slice(0, index + 1).map((s) => s.field));
  let f = nextField(path[index].field);
  while (f && used.has(f)) f = nextField(f);
  return f;
}

export function defaultPath(root: GroupField = 'artist'): BrowseStep[] {
  return [{ field: root, value: null }];
}

/**
 * Tracks visible in column `upTo`, i.e. filtered by every step ABOVE it.
 * `upTo` is a count of steps to apply, so column 0 applies none.
 */
export function filterByPath(tracks: Track[], path: BrowseStep[], upTo: number): Track[] {
  const steps = path.slice(0, upTo);
  if (steps.length === 0) return tracks;
  return tracks.filter((t) => steps.every((s) => getGroupValue(t, s.field).value === s.value));
}

/**
 * Map key for the Unknown bucket. Real values are prefixed "v:" so a group
 * genuinely named "u:unknown" can never collide with it.
 */
const UNKNOWN_KEY = 'u:unknown';

export function groupsOf(tracks: Track[], field: GroupField): BrowseGroup[] {
  const byValue = new Map<string, BrowseGroup>();
  for (const t of tracks) {
    const { value, label } = getGroupValue(t, field);
    // Keys must distinguish a null value from the literal string "null".
    const key = value === null ? UNKNOWN_KEY : 'v:' + value;
    let g = byValue.get(key);
    if (!g) {
      g = { field, value, label, count: 0, tracks: [] };
      byValue.set(key, g);
    }
    g.count += 1;
    g.tracks.push(t);
  }
  return [...byValue.values()];
}

/** Select a value in column `index`, appending the next column and dropping deeper ones. */
export function selectAt(path: BrowseStep[], index: number, value: string | null): BrowseStep[] {
  const head = path.slice(0, index);
  const current = path[index];
  const kept: BrowseStep[] = [...head, { field: current.field, value }];
  const next = nextFieldFor(kept, kept.length - 1);
  return next ? [...kept, { field: next, value: null }] : kept;
}

/** Change column `index`'s grouping. Everything below described a different chain. */
export function setFieldAt(path: BrowseStep[], index: number, field: GroupField): BrowseStep[] {
  return [...path.slice(0, index), { field, value: null }];
}

/**
 * Drop trailing steps whose selection no longer matches anything — a persisted
 * path can outlive the tracks it names, after a retag, a rescan or a deletion.
 *
 * Callers must pass the UNFILTERED library. Sanitizing against a search-filtered
 * list would silently reset the drill-down position the moment a query excluded
 * the current selection, and clearing the search would not bring it back.
 */
export function sanitizePath(path: BrowseStep[], tracks: Track[]): BrowseStep[] {
  if (path.length === 0) return defaultPath();
  // Persisted state can predate a change to GROUP_FIELDS, or have been written
  // by a caller that pushed a non-groupable sort field in. Start over rather
  // than carry a step nothing can group by.
  if (!path.every((s) => isGroupField(s.field))) return defaultPath();

  const out: BrowseStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (step.value === null) {
      out.push(step);
      break;
    }
    const visible = filterByPath(tracks, path, i);
    const exists = visible.some((t) => getGroupValue(t, step.field).value === step.value);
    if (!exists) {
      out.push({ field: step.field, value: null });
      break;
    }
    out.push(step);
  }

  // A fully-selected path still needs its trailing unselected column.
  const last = out[out.length - 1];
  if (last && last.value !== null) {
    const next = nextFieldFor(out, out.length - 1);
    if (next) out.push({ field: next, value: null });
  }
  return out.length > 0 ? out : defaultPath();
}
