import { describe, it, expect, beforeEach } from 'vitest';
import {
  columnScrollKey, getScrollOffset, setScrollOffset, clearScrollMemory,
} from './scrollMemory';

beforeEach(() => clearScrollMemory());

describe('columnScrollKey', () => {
  it('identifies a column by what it shows, not where it sits', () => {
    // Same field, different parent selection — must not share an offset, or
    // browsing to another artist would inherit the previous one's scroll.
    const a = columnScrollKey('album', [{ field: 'artist', value: 'Radiohead' }]);
    const b = columnScrollKey('album', [{ field: 'artist', value: 'Khruangbin' }]);
    expect(a).not.toBe(b);
  });

  it('is stable for the same content', () => {
    const above = [{ field: 'artist', value: 'Radiohead' }];
    expect(columnScrollKey('album', above)).toBe(columnScrollKey('album', [...above]));
  });

  it('distinguishes the Unknown bucket from a group literally named that', () => {
    const unknown = columnScrollKey('album', [{ field: 'artist', value: null }]);
    const named = columnScrollKey('album', [{ field: 'artist', value: '∅' }]);
    expect(unknown).not.toBe(named);
  });

  it('distinguishes the root column of different fields', () => {
    expect(columnScrollKey('artist', [])).not.toBe(columnScrollKey('genre', []));
  });
});

describe('offsets', () => {
  it('round-trips an offset', () => {
    setScrollOffset('k', 1234);
    expect(getScrollOffset('k')).toBe(1234);
  });

  it('reports 0 for a column never scrolled', () => {
    expect(getScrollOffset('never-seen')).toBe(0);
  });

  // TrackList is also used by PlaylistView, which passes no key.
  it('is inert without a key', () => {
    setScrollOffset(undefined, 500);
    expect(getScrollOffset(undefined)).toBe(0);
  });
});
