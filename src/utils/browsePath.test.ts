import { describe, it, expect } from 'vitest';
import {
  nextFieldFor, availableFieldsFor, defaultPath, filterByPath, groupsOf,
  getGroupValue, selectAt, setFieldAt, sanitizePath, sortTracks,
  isLeafField, isGroupField, isPicked,
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

  // A PICKED null is the Unknown bucket and must match ONLY genuinely null
  // fields. Treating it as "no filter" would make the Unknown column show the
  // entire library.
  it('treats a picked null as the Unknown bucket, not as "no filter"', () => {
    const path = [{ field: 'artist' as const, value: null, picked: true }];
    expect(filterByPath(LIB, path, 1).map((t) => t.id)).toEqual([5]);
  });

  // An unpicked step is an open column with nothing chosen in it. It filters
  // nothing — which is also how a path saved before `picked` existed reads,
  // since that encoding had no way to express a selected Unknown.
  it('ignores a null that was never picked', () => {
    expect(filterByPath(LIB, [{ field: 'artist', value: null }], 1)).toHaveLength(5);
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
      { field: 'artist', value: 'Radiohead', picked: true },
      { field: 'album', value: null },
    ]);
  });

  it('appends the track list after the last grouping field', () => {
    expect(selectAt([{ field: 'album', value: null }], 0, 'Kid A')).toEqual([
      { field: 'album', value: 'Kid A', picked: true },
      { field: 'title', value: null },
    ]);
  });

  it('discards deeper columns when an earlier one changes', () => {
    const deep = [
      { field: 'artist' as const, value: 'Radiohead' },
      { field: 'album' as const, value: 'Kid A' },
    ];
    expect(selectAt(deep, 0, 'Khruangbin')).toEqual([
      { field: 'artist', value: 'Khruangbin', picked: true },
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

// The Unknown bucket is a real group — the tracks with no artist tag at all —
// and selecting it has to survive sanitizePath. It did not: null meant both
// "Unknown selected" and "nothing selected", so the selection was read as an
// empty column and truncated away the instant it was made. Clicking
// "Unknown Artist" appeared to do nothing.
describe('the Unknown bucket is selectable', () => {
  it('marks a picked step even when the value is null', () => {
    const next = selectAt(defaultPath('artist'), 0, null);
    expect(next[0]).toEqual({ field: 'artist', value: null, picked: true });
  });

  it('opens a column for it, like any other group', () => {
    const next = selectAt(defaultPath('artist'), 0, null);
    expect(next).toHaveLength(2);
    expect(next[1].field).toBe('album');
  });

  it('survives sanitizePath instead of being truncated away', () => {
    const path = selectAt(defaultPath('artist'), 0, null);
    expect(sanitizePath(path, LIB)).toEqual(path);
  });

  it('filters to exactly the untagged tracks', () => {
    const path = selectAt(defaultPath('artist'), 0, null);
    const visible = filterByPath(LIB, path, 1);
    expect(visible.map((t) => t.id)).toEqual([5]);
  });

  // Untagged tracks are their own Unknown Album underneath Unknown Artist.
  it('drills further into Unknown Album', () => {
    const artistStep = selectAt(defaultPath('artist'), 0, null);
    const albumStep = selectAt(artistStep, 1, null);
    expect(sanitizePath(albumStep, LIB)).toEqual(albumStep);
    expect(filterByPath(LIB, albumStep, 2).map((t) => t.id)).toEqual([5]);
  });

  // If nothing is untagged the selection names a group that is not there, and
  // it should reset like any other stale selection.
  it('resets when no untagged tracks remain', () => {
    const tagged = LIB.filter((t) => t.artist !== null);
    const path = selectAt(defaultPath('artist'), 0, null);
    expect(sanitizePath(path, tagged)).toEqual([{ field: 'artist', value: null }]);
  });
});

describe('isPicked reads paths saved before the flag existed', () => {
  it('treats a real value as picked', () => {
    expect(isPicked({ field: 'artist', value: 'Radiohead' })).toBe(true);
  });

  // The old encoding had no way to say "Unknown selected", so a bare null from
  // an older build always meant an empty column.
  it('treats a bare null as nothing selected', () => {
    expect(isPicked({ field: 'artist', value: null })).toBe(false);
  });

  it('lets an explicit flag override both', () => {
    expect(isPicked({ field: 'artist', value: null, picked: true })).toBe(true);
    expect(isPicked({ field: 'artist', value: 'Radiohead', picked: false })).toBe(false);
  });
});

// Inside one album, "sort by track title" has to mean the order the artist put
// them in. This list also feeds the queue, so alphabetical ordering here is the
// difference between playing an album and playing it scrambled.
describe('sortTracks in album order', () => {
  const ALBUM: Track[] = [
    track({ id: 1, title: 'Because', track_number: 8 }),
    track({ id: 2, title: 'Come Together', track_number: 1 }),
    track({ id: 3, title: 'Something', track_number: 2 }),
  ];

  it('uses track number instead of the alphabet when an album is pinned', () => {
    expect(sortTracks(ALBUM, 'title', 'asc', true).map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('still sorts alphabetically when no album is pinned', () => {
    expect(sortTracks(ALBUM, 'title', 'asc', false).map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('reverses with the sort direction', () => {
    expect(sortTracks(ALBUM, 'title', 'desc', true).map((t) => t.id)).toEqual([1, 3, 2]);
  });

  // A double album must not interleave disc 2 into disc 1.
  it('orders by disc before track number', () => {
    const multi: Track[] = [
      track({ id: 1, title: 'd2t1', disc_number: 2, track_number: 1 }),
      track({ id: 2, title: 'd1t2', disc_number: 1, track_number: 2 }),
      track({ id: 3, title: 'd1t1', disc_number: 1, track_number: 1 }),
    ];
    expect(sortTracks(multi, 'title', 'asc', true).map((t) => t.id)).toEqual([3, 2, 1]);
  });

  // Single-disc releases routinely leave the disc tag empty. Treating that as
  // absent rather than disc 1 would sort them after a tagged disc 2.
  it('treats a missing disc number as disc 1', () => {
    const mixed: Track[] = [
      track({ id: 1, title: 'later disc', disc_number: 2, track_number: 1 }),
      track({ id: 2, title: 'untagged disc', disc_number: null, track_number: 5 }),
    ];
    expect(sortTracks(mixed, 'title', 'asc', true).map((t) => t.id)).toEqual([2, 1]);
  });

  // Same rule as every other absent value in this module.
  it('sinks untracked files below numbered ones, in both directions', () => {
    const partial: Track[] = [
      track({ id: 1, title: 'aaa no number' }),
      track({ id: 2, title: 'zzz numbered', track_number: 3 }),
    ];
    expect(sortTracks(partial, 'title', 'asc', true).map((t) => t.id)).toEqual([2, 1]);
    expect(sortTracks(partial, 'title', 'desc', true).map((t) => t.id)).toEqual([2, 1]);
  });

  it('falls back to the title when nothing carries a track number', () => {
    const untagged: Track[] = [
      track({ id: 1, title: 'beta' }),
      track({ id: 2, title: 'alpha' }),
    ];
    expect(sortTracks(untagged, 'title', 'asc', true).map((t) => t.id)).toEqual([2, 1]);
  });

  // Ordering by BPM inside an album is an explicit request for BPM order.
  it('leaves the other leaf fields alone', () => {
    const byBpm: Track[] = [
      track({ id: 1, bpm: 170, track_number: 1 }),
      track({ id: 2, bpm: 90, track_number: 2 }),
    ];
    expect(sortTracks(byBpm, 'bpm', 'asc', true).map((t) => t.id)).toEqual([2, 1]);
  });
});
