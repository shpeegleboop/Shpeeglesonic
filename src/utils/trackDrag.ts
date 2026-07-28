import { type Track } from '../stores/playerStore';

export const TRACK_DRAG_MIME = 'application/x-shpeegle-tracks';

export interface TrackDragPayload {
  trackIds: number[];
  /** "OK Computer", or a track title. Written to text/plain for a
   *  human-readable representation; no drop target reads it back. */
  label: string;
}

/**
 * The slice of DataTransfer we use. Narrow so tests can stub it — vitest runs
 * in node, where DataTransfer does not exist.
 */
export interface DragLike {
  types: readonly string[] | string[];
  setData(format: string, data: string): void;
  getData(format: string): string;
  effectAllowed?: string;
}

/**
 * IDs rather than whole tracks: dragging a genre heading can be thousands of
 * rows, and serialising those into a dataTransfer string is megabytes for no
 * gain. They resolve against the unfiltered library at drop time.
 */
export function startTrackDrag(dt: DragLike, payload: TrackDragPayload): void {
  dt.setData(TRACK_DRAG_MIME, JSON.stringify(payload));
  dt.setData('text/plain', payload.label);
  // A library row in playlist view is also a reorder source, whose drop wants
  // 'move'. Permitting only 'copy' would make that drop refuse.
  dt.effectAllowed = 'copyMove';
}

/**
 * Safe to call during dragover, where getData() is blocked by the browser and
 * only `types` is readable. This is why it is separate from readTrackDrag.
 */
export function isTrackDrag(dt: Pick<DragLike, 'types'>): boolean {
  return Array.from(dt.types).includes(TRACK_DRAG_MIME);
}

/** Null rather than a throw: an exception inside a drop handler aborts the
 *  drop with no feedback to the user. */
export function readTrackDrag(dt: DragLike): TrackDragPayload | null {
  const raw = dt.getData(TRACK_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TrackDragPayload>;
    if (!parsed || !Array.isArray(parsed.trackIds)) return null;
    const trackIds = parsed.trackIds.filter((n): n is number => typeof n === 'number');
    if (trackIds.length === 0) return null;
    return { trackIds, label: typeof parsed.label === 'string' ? parsed.label : '' };
  } catch {
    return null;
  }
}

/** Preserves the dragged order, and skips ids deleted since the drag began. */
export function resolveTracks(ids: number[], all: Track[]): Track[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined);
}

/** playNext inserts directly after the current track, so applying a list in
 *  order plays it backwards. */
export function playNextOrder<T>(items: T[]): T[] {
  return [...items].reverse();
}
