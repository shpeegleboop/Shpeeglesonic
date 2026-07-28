import { describe, it, expect } from 'vitest';
import {
  nextFieldFor, availableFieldsFor, defaultPath, filterByPath, groupsOf,
  getGroupValue, selectAt, setFieldAt, sanitizePath, sortTracks,
  isLeafField, isGroupField,
} from './browsePath';
import type { Track } from '../stores/playerStore';

function track(fields: Partial<Track>): Track {
  return {
    id: 1, file_path: 'D:\\Music\\a.flac', file_name: 'a.flac',
    title: null, artist: null, album_artist: null, album: null, genre: null,
    year: null, track_number: null, disc_number: null, bpm: null,
    duration_seconds: null, format: null, bitrate: null, sample_rate: null,
    bit_depth: null, channels: null, has_album_art: false, art_path: null,
    album_art_color: null, play_count: 0, favorited: false, dup_flag: false, date_added: null,
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

describe('field kinds', () => {
  it('separates fields that can be broken down from fields that cannot', () => {
    expect(isGroupField('artist')).toBe(true);
    expect(isLeafField('artist')).toBe(false);
    // Nothing nests under a duration or a BPM — these end a chain.
    for (const f of ['title', 'bpm', 'duration', 'date_added', 'sample_rate']) {
      expect(isLeafField(f)).toBe(true);
      expect(isGroupField(f)).toBe(false);
    }
  });
});

describe('nextFieldFor', () => {
  it('walks the default chain down to the track list', () => {
    expect(nextFieldFor([{ field: 'genre', value: 'Rock' }], 0)).toBe('artist');
    expect(nextFieldFor([{ field: 'artist', value: 'Radiohead' }], 0)).toBe('album');
    expect(nextFieldFor([{ field: 'album', value: 'Kid A' }], 0)).toBe('title');
  });

  it('ends at a leaf — nothing follows a track list', () => {
    for (const f of ['title', 'bpm', 'duration', 'date_added', 'sample_rate'] as const) {
      expect(nextFieldFor([{ field: f, value: null }], 0)).toBeNull();
    }
  });

  it('skips a chain field an ancestor already used', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'genre' as const, value: 'Rock' },
    ];
    expect(nextFieldFor(path, 1)).toBe('album');
  });

  it('falls through to the track list once the grouping fields are used', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    expect(nextFieldFor(path, 1)).toBe('title');
  });

  it('cannot produce a self-referential next field', () => {
    expect(nextFieldFor([{ field: 'artist', value: 'Radiohead' }], 0)).not.toBe('artist');
  });
});

describe('availableFieldsFor', () => {
  it('offers grouping and leaf fields together', () => {
    const opts = availableFieldsFor(defaultPath('artist'), 0);
    expect(opts).toContain('artist');
    expect(opts).toContain('album');
    expect(opts).toContain('title');
    expect(opts).toContain('sample_rate');
  });

  // Grouping Radiohead's tracks by artist yields one "Radiohead" group, and
  // clicking it appends another identical column forever.
  it('hides grouping fields already fixed by an ancestor column', () => {
    const path = [
      { field: 'genre' as const, value: 'Rock' },
      { field: 'artist' as const, value: null },
    ];
    const opts = availableFieldsFor(path, 1);
    expect(opts).not.toContain('genre');
    expect(opts).toContain('artist');
  });

  it('always offers leaf fields, however deep the path', () => {
    const path = [
      { field: 'genre' as const, value: 'Rock' },
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: null },
    ];
    expect(availableFieldsFor(path, 2)).toContain('duration');
  });
});

describe('filterByPath', () => {
  it('narrows across successive steps', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'OK Computer' },
    ];
    expect(filterByPath(LIB, path, 0).length).toBe(5);
    expect(filterByPath(LIB, path, 1).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(filterByPath(LIB, path, 2).map((t) => t.id)).toEqual([1, 2]);
  });

  // A null selection means the Unknown bucket, and must match ONLY genuinely
  // null fields. Treating it as "no filter" would make the Unknown column show
  // the entire library.
  it('treats a null value as the Unknown bucket, not as "no filter"', () => {
    expect(filterByPath(LIB, [{ field: 'artist', value: null }], 1).map((t) => t.id)).toEqual([5]);
  });

  it('ignores leaf steps, which carry no selection', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'title' as const, value: null },
    ];
    expect(filterByPath(LIB, path, 2).map((t) => t.id)).toEqual([1, 2, 3]);
  });
});

describe('groupsOf', () => {
  it('counts each group and buckets untagged tracks', () => {
    const byLabel = Object.fromEntries(groupsOf(LIB, 'artist').map((g) => [g.label, g.count]));
    expect(byLabel['Radiohead']).toBe(3);
    expect(byLabel['Khruangbin']).toBe(1);
    expect(byLabel['Unknown Artist']).toBe(1);
  });

  it('sorts by label with Unknown last, not by incoming track order', () => {
    const labels = groupsOf(LIB, 'artist').map((g) => g.label);
    expect(labels).toEqual(['Khruangbin', 'Radiohead', 'Unknown Artist']);
  });

  it('gives the Unknown bucket a null value so it can be selected', () => {
    expect(groupsOf(LIB, 'artist').find((g) => g.label === 'Unknown Artist')?.value).toBeNull();
  });

  it('keeps a group named "null" separate from the Unknown bucket', () => {
    const groups = groupsOf([track({ id: 9, artist: 'null' }), track({ id: 10 })], 'artist');
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.value === 'null')?.count).toBe(1);
    expect(groups.find((g) => g.value === null)?.count).toBe(1);
  });

  it('returns nothing for a leaf field, which has no groups', () => {
    expect(groupsOf(LIB, 'duration')).toEqual([]);
  });
});

describe('sortTracks', () => {
  const mixed = [
    track({ id: 1, title: 'Beta', duration_seconds: 200 }),
    track({ id: 2, title: 'alpha', duration_seconds: 100 }),
    track({ id: 3, title: 'Gamma', duration_seconds: null }),
  ];

  it('orders by title case-insensitively', () => {
    expect(sortTracks(mixed, 'title', 'asc').map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it('reverses on desc', () => {
    expect(sortTracks(mixed, 'duration', 'desc').map((t) => t.id)).toEqual([1, 2, 3]);
  });

  // Absent data is not a low value — it should not lead an ascending sort.
  it('sinks tracks missing the field to the bottom in both directions', () => {
    expect(sortTracks(mixed, 'duration', 'asc').map((t) => t.id)).toEqual([2, 1, 3]);
    expect(sortTracks(mixed, 'duration', 'desc')[2].id).toBe(3);
  });

  // A failed probe writes 0, not null. Treating it as a real value put every
  // unreadable track at the top of an ascending sample-rate sort.
  it('treats a zero numeric as absent, not as the smallest value', () => {
    const withZeros = [
      track({ id: 1, sample_rate: 44100 }),
      track({ id: 2, sample_rate: 0 }),
      track({ id: 3, sample_rate: 22050 }),
    ];
    expect(sortTracks(withZeros, 'sample_rate', 'asc').map((t) => t.id)).toEqual([3, 1, 2]);
    expect(sortTracks(withZeros, 'sample_rate', 'desc').map((t) => t.id)).toEqual([1, 3, 2]);
  });

  it('does not mutate its input', () => {
    const before = mixed.map((t) => t.id);
    sortTracks(mixed, 'title', 'desc');
    expect(mixed.map((t) => t.id)).toEqual(before);
  });
});

describe('selectAt', () => {
  it('appends the next column from the default chain', () => {
    expect(selectAt(defaultPath('artist'), 0, 'Radiohead')).toEqual([
      { field: 'artist', value: 'Radiohead' },
      { field: 'album', value: null },
    ]);
  });

  it('appends the track list after the last grouping field', () => {
    expect(selectAt([{ field: 'album', value: null }], 0, 'Kid A')).toEqual([
      { field: 'album', value: 'Kid A' },
      { field: 'title', value: null },
    ]);
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

  it('does not append a column for a field already pinned above', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'artist' as const, value: null },
    ];
    const next = selectAt(path, 1, 'Radiohead');
    expect(next[next.length - 1].field).toBe('album');
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

  it('makes a column terminal when set to a leaf field', () => {
    const deep = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: null },
    ];
    const next = setFieldAt(deep, 1, 'sample_rate');
    expect(next).toEqual([
      { field: 'artist', value: 'Radiohead' },
      { field: 'sample_rate', value: null },
    ]);
    expect(nextFieldFor(next, 1)).toBeNull();
  });
});

// Regression: updateSort used to cast any sort field to GroupField and write it
// into browsePath, getGroupValue fell through its switch returning undefined,
// and destructuring it white-screened the app on every launch.
describe('resilience to a field that is not valid at all', () => {
  const bogus = [{ field: 'nonsense', value: null }] as unknown as Parameters<typeof sanitizePath>[0];

  it('getGroupValue never returns undefined', () => {
    const f = 'nonsense' as unknown as Parameters<typeof getGroupValue>[1];
    expect(getGroupValue(LIB[0], f)).toHaveProperty('value');
  });

  it('sanitizePath discards a persisted path with an unknown field', () => {
    expect(sanitizePath(bogus, LIB)).toEqual([{ field: 'artist', value: null }]);
  });
});

describe('sanitizePath', () => {
  it('keeps a valid path and gives it a trailing track column', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'OK Computer' },
    ];
    expect(sanitizePath(path, LIB)).toEqual([...path, { field: 'title', value: null }]);
  });

  it('leaves a leaf column terminal', () => {
    const path = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'duration' as const, value: null },
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
    expect(sanitizePath([{ field: 'artist', value: 'Nobody' }], LIB)).toEqual([
      { field: 'artist', value: null },
    ]);
  });

  it('never returns an empty path', () => {
    expect(sanitizePath([], LIB)).toEqual([{ field: 'artist', value: null }]);
  });
});
