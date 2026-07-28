/**
 * Remembers where each library column was scrolled to, so switching to Now
 * Playing and back does not throw you from G back to A.
 *
 * Deliberately a module-level Map rather than store state: scroll events fire
 * continuously while dragging a 5,000-row scrollbar, and routing that through
 * zustand would re-render every subscriber and serialise the whole persisted
 * state on each frame. Nothing needs to *react* to a scroll position — it is
 * only read once on mount.
 *
 * Not persisted across restarts. Restoring a scroll offset into a library that
 * may have been rescanned since is more likely to look broken than helpful.
 */
const offsets = new Map<string, number>();

/**
 * Identifies a column by what it *shows*, not by its position. Scrolling
 * Radiohead's albums, then browsing to Khruangbin and back, restores
 * Radiohead's offset instead of applying it to a different album list.
 */
export function columnScrollKey(field: string, above: { field: string; value: string | null }[]): string {
  // Values are prefixed so the Unknown bucket cannot collide with a group
  // literally named whatever placeholder we would otherwise substitute.
  const prefix = above
    .map((s) => `${s.field}=${s.value === null ? 'u:' : 'v:' + s.value}`)
    .join('/');
  return `${field}::${prefix}`;
}

export function getScrollOffset(key: string | undefined): number {
  if (!key) return 0;
  return offsets.get(key) ?? 0;
}

export function setScrollOffset(key: string | undefined, offset: number): void {
  if (!key) return;
  offsets.set(key, offset);
}

/** Test seam — the Map outlives individual components by design. */
export function clearScrollMemory(): void {
  offsets.clear();
}
