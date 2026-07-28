import { type Track } from '../stores/playerStore';

/** Fields you can break the library down by — each opens another column. */
export type GroupField = 'artist' | 'album' | 'genre' | 'year' | 'format' | 'playlist';

/**
 * Fields that end a chain. Nothing can be nested under "duration" or "BPM", so
 * choosing one shows the tracks themselves, ordered by that field. They are all
 * the same track list wearing a different ordering.
 */
export type LeafField = 'title' | 'bpm' | 'duration' | 'date_added' | 'sample_rate';

export type BrowseField = GroupField | LeafField;

/** One column: how it groups, and what is selected in it. */
export interface BrowseStep {
  field: BrowseField;
  /**
   * For a grouping column: the selected value, or null for "nothing picked
   * yet". A null that sits ABOVE the column being rendered means the Unknown
   * bucket. Leaf columns always carry null — they have nothing to select.
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
export const LEAF_FIELDS: LeafField[] = ['title', 'bpm', 'duration', 'date_added', 'sample_rate'];

export const FIELD_LABELS: Record<BrowseField, string> = {
  artist: 'Artist',
  album: 'Album',
  genre: 'Genre',
  year: 'Year',
  format: 'Format',
  playlist: 'Playlist',
  title: 'Track Title',
  bpm: 'BPM',
  duration: 'Duration',
  date_added: 'Date Added',
  sample_rate: 'Sample Rate',
};

export function isGroupField(f: unknown): f is GroupField {
  return typeof f === 'string' && (GROUP_FIELDS as string[]).includes(f);
}

export function isLeafField(f: unknown): f is LeafField {
  return typeof f === 'string' && (LEAF_FIELDS as string[]).includes(f);
}

export function isBrowseField(f: unknown): f is BrowseField {
  return isGroupField(f) || isLeafField(f);
}

/**
 * The default case is load-bearing, not defensive padding: persisted state can
 * carry a field that is no longer valid, and returning undefined here meant
 * destructuring it threw during render, which unmounts the entire React tree
 * and leaves a black window with no clue why.
 */
export function getGroupValue(track: Track, field: BrowseField): { value: string | null; label: string } {
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
 * What a column offers next, in preference order. The first entry not already
 * used above wins, so genre -> artist -> album -> tracks, and if artist is
 * already pinned then genre goes straight to album.
 */
const PREFERRED_AFTER: Record<GroupField, BrowseField[]> = {
  genre: ['artist', 'album', 'title'],
  year: ['artist', 'album', 'title'],
  format: ['artist', 'album', 'title'],
  playlist: ['artist', 'album', 'title'],
  artist: ['album', 'title'],
  album: ['title'],
};

/**
 * The field for the column after `index`, skipping any the path already uses.
 * Null when `index` is a leaf — nothing follows a track list.
 */
export function nextFieldFor(path: BrowseStep[], index: number): BrowseField | null {
  const step = path[index];
  if (!step || isLeafField(step.field)) return null;
  const used = new Set(path.slice(0, index + 1).map((s) => s.field));
  return PREFERRED_AFTER[step.field as GroupField].find((f) => !used.has(f)) ?? null;
}

/**
 * Fields a column may group by: grouping fields not already pinned by an
 * ancestor, plus every leaf field. Excluding used grouping fields is what makes
 * artist > artist > artist unreachable rather than merely discouraged — it
 * yields one group and clicking it appends another identical column forever.
 */
export function availableFieldsFor(path: BrowseStep[], index: number): BrowseField[] {
  const used = new Set(path.slice(0, index).map((s) => s.field));
  return [...GROUP_FIELDS.filter((f) => !used.has(f)), ...LEAF_FIELDS];
}

export function defaultPath(root: BrowseField = 'artist'): BrowseStep[] {
  return [{ field: root, value: null }];
}

/**
 * Tracks visible in column `upTo`, i.e. filtered by every step ABOVE it.
 * `upTo` is a count of steps to apply, so column 0 applies none.
 */
export function filterByPath(tracks: Track[], path: BrowseStep[], upTo: number): Track[] {
  const steps = path.slice(0, upTo).filter((s) => isGroupField(s.field));
  if (steps.length === 0) return tracks;
  return tracks.filter((t) => steps.every((s) => getGroupValue(t, s.field).value === s.value));
}

/** Map key for the Unknown bucket. Real values are prefixed so a group
 *  genuinely named "u:unknown" can never collide with it. */
const UNKNOWN_KEY = 'u:unknown';

export function groupsOf(tracks: Track[], field: BrowseField): BrowseGroup[] {
  if (!isGroupField(field)) return [];
  const byValue = new Map<string, BrowseGroup>();
  for (const t of tracks) {
    const { value, label } = getGroupValue(t, field);
    const key = value === null ? UNKNOWN_KEY : 'v:' + value;
    let g = byValue.get(key);
    if (!g) {
      g = { field, value, label, count: 0, tracks: [] };
      byValue.set(key, g);
    }
    g.count += 1;
    g.tracks.push(t);
  }

  // Sorted explicitly rather than inheriting the incoming track order, which is
  // whatever SQL returned and would put artists in title order.
  return [...byValue.values()].sort((a, b) => {
    if (a.value === null) return 1; // Unknown always last
    if (b.value === null) return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/** 0 means "we never read it" for every numeric field here — no track has a
 *  real duration, BPM or sample rate of zero — so it is absent data, not a low
 *  value, and must not lead an ascending sort. */
const numeric = (n: number | null | undefined): number | null => (n ? n : null);

function leafKey(t: Track, field: LeafField): string | number | null {
  switch (field) {
    case 'title':
      return (t.title ?? t.file_name ?? '').toLowerCase();
    case 'bpm':
      return numeric(t.bpm);
    case 'duration':
      return numeric(t.duration_seconds);
    case 'sample_rate':
      return numeric(t.sample_rate);
    case 'date_added':
      return t.date_added ?? null;
  }
}

/** Order a track list by a leaf field. Untagged tracks sink to the bottom
 *  regardless of direction — they are absent data, not a low value. */
export function sortTracks(tracks: Track[], field: LeafField, order: 'asc' | 'desc'): Track[] {
  const dir = order === 'desc' ? -1 : 1;
  return [...tracks].sort((a, b) => {
    const ka = leafKey(a, field);
    const kb = leafKey(b, field);
    const aMissing = ka === null || ka === undefined || ka === '';
    const bMissing = kb === null || kb === undefined || kb === '';
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;
    if (typeof ka === 'number' && typeof kb === 'number') return (ka - kb) * dir;
    return String(ka).localeCompare(String(kb), undefined, { numeric: true }) * dir;
  });
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
export function setFieldAt(path: BrowseStep[], index: number, field: BrowseField): BrowseStep[] {
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
  // Persisted state can predate a change to the field lists, or have been
  // written by a caller that pushed something unusable in.
  if (!path.every((s) => isBrowseField(s.field))) return defaultPath();

  const out: BrowseStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (isLeafField(step.field)) {
      out.push({ field: step.field, value: null });
      break;
    }
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

  // A fully-selected grouping column still needs its trailing column.
  const last = out[out.length - 1];
  if (last && !isLeafField(last.field) && last.value !== null) {
    const next = nextFieldFor(out, out.length - 1);
    if (next) out.push({ field: next, value: null });
  }
  return out.length > 0 ? out : defaultPath();
}
