import { describe, it, expect } from 'vitest';
import {
  nextField, defaultPath, filterByPath, groupsOf,
  selectAt, setFieldAt, sanitizePath,
} from './browsePath';
import type { Track } from '../stores/playerStore';

function track(fields: Partial<Track>): Track {
  return {
    id: 1, file_path: 'D:\\Music\\a.flac', file_name: 'a.flac',
    title: null, artist: null, album_artist: null, album: null, genre: null,
    year: null, track_number: null, disc_number: null, bpm: null,
    duration_seconds: null, format: null, bitrate: null, sample_rate: null,
    bit_depth: null, channels: null, has_album_art: false, art_path: null,
    album_art_color: null, play_count: 0, favorited: false, dup_flag: false,
    ...fields,
  };
}

const LIB: Track[] = [
  track({ id: 1, artist: 'Radiohead', album: 'OK Computer', title: 'Airbag', genre: 'Rock' }),
  track({ id: 2, artist: 'Radiohead', album: 'OK Computer', title: 'Lucky', genre: 'Rock' }),
  track({ id: 3, artist: 'Radiohead', album: 'Kid A', title: 'Idioteque', genre: 'Rock' }),
  track({ id: 4, artist: 'Khruangbin', album: 'Con Todo El Mundo', title: 'Maria', genre: 'Funk' }),
  track({ id: 5, artist: null, album: null, title: 'untagged thing' }),
];

describe('nextField', () => {
  it('walks the default chain down to a leaf', () => {
    expect(nextField('genre')).toBe('artist');
    expect(nextField('year')).toBe('artist');
    expect(nextField('format')).toBe('artist');
    expect(nextField('playlist')).toBe('artist');
    expect(nextField('artist')).toBe('album');
  });

  it('terminates at album', () => {
    expect(nextField('album')).toBeNull();
  });
});

describe('defaultPath', () => {
  it('starts with one unselected column', () => {
    expect(defaultPath('artist')).toEqual([{ field: 'artist', value: null }]);
  });
});

describe('filterByPath', () => {
  it('narrows across successive steps', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'OK Computer' },
    ];
    expect(filterByPath(LIB, path, 0).length).toBe(5); // nothing applied yet
    expect(filterByPath(LIB, path, 1).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(filterByPath(LIB, path, 2).map((t) => t.id)).toEqual([1, 2]);
  });

  // The subtle one: a null selection means the Unknown bucket, and must match
  // ONLY genuinely-null fields. Treating null as "no filter" would make the
  // Unknown column show the entire library.
  it('treats a null value as the Unknown bucket, not as "no filter"', () => {
    const path = [{ field: 'artist' as const, value: null }];
    expect(filterByPath(LIB, path, 1).map((t) => t.id)).toEqual([5]);
  });

  it('ignores steps beyond upTo', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    expect(filterByPath(LIB, path, 1).length).toBe(3);
  });
});

describe('groupsOf', () => {
  it('counts each group and buckets untagged tracks', () => {
    const groups = groupsOf(LIB, 'artist');
    const byLabel = Object.fromEntries(groups.map((g) => [g.label, g.count]));
    expect(byLabel['Radiohead']).toBe(3);
    expect(byLabel['Khruangbin']).toBe(1);
    expect(byLabel['Unknown Artist']).toBe(1);
  });

  it('gives the Unknown bucket a null value so it can be selected', () => {
    const unknown = groupsOf(LIB, 'artist').find((g) => g.label === 'Unknown Artist');
    expect(unknown?.value).toBeNull();
  });

  // A group literally named "null" must not collide with the Unknown bucket.
  it('keeps a group named "null" separate from the Unknown bucket', () => {
    const lib = [track({ id: 9, artist: 'null' }), track({ id: 10, artist: null })];
    const groups = groupsOf(lib, 'artist');
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.value === 'null')?.count).toBe(1);
    expect(groups.find((g) => g.value === null)?.count).toBe(1);
  });
});

describe('selectAt', () => {
  it('appends the next column from the default chain', () => {
    const path = selectAt(defaultPath('artist'), 0, 'Radiohead');
    expect(path).toEqual([
      { field: 'artist', value: 'Radiohead' },
      { field: 'album', value: null },
    ]);
  });

  it('does not append past a leaf field', () => {
    const path = selectAt([{ field: 'album', value: null }], 0, 'Kid A');
    expect(path).toEqual([{ field: 'album', value: 'Kid A' }]);
  });

  it('discards deeper columns when an earlier one changes', () => {
    const deep = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    expect(selectAt(deep, 0, 'Khruangbin')).toEqual([
      { field: 'artist', value: 'Khruangbin' },
      { field: 'album', value: null },
    ]);
  });
});

describe('setFieldAt', () => {
  it('rewrites the column field and drops everything below it', () => {
    const deep = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    expect(setFieldAt(deep, 0, 'genre')).toEqual([{ field: 'genre', value: null }]);
  });
});

describe('sanitizePath', () => {
  it('keeps a path whose selections still exist', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'OK Computer' },
    ];
    expect(sanitizePath(path, LIB)).toEqual(path);
  });

  // A persisted path can outlive the tracks it names — retagged or deleted.
  it('truncates at the first selection that matches nothing', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Deleted Album' },
    ];
    expect(sanitizePath(path, LIB)).toEqual([
      { field: 'artist', value: 'Radiohead' },
      { field: 'album', value: null },
    ]);
  });

  it('falls back to a default path when the root no longer matches', () => {
    const path = [{ field: 'artist' as const, value: 'Nobody' }];
    expect(sanitizePath(path, LIB)).toEqual([{ field: 'artist', value: null }]);
  });

  it('never returns an empty path', () => {
    expect(sanitizePath([], LIB)).toEqual([{ field: 'artist', value: null }]);
  });

  it('appends the trailing unselected column for a fully-selected path', () => {
    const path = [{ field: 'artist' as const, value: 'Radiohead' }];
    expect(sanitizePath(path, LIB)).toEqual([
      { field: 'artist', value: 'Radiohead' },
      { field: 'album', value: null },
    ]);
  });

  // Guards the bug this design nearly shipped with: sanitizing against a
  // search-filtered list would wipe the drill-down position mid-search.
  it('keeps a valid path even when a filtered view would not contain it', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    // LIB is the unfiltered library; a search showing only Khruangbin must not
    // be what this is called with, and against the full library the path holds.
    expect(sanitizePath(path, LIB)).toEqual(path);
  });
});
