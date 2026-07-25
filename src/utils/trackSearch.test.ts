import { describe, it, expect } from 'vitest';
import { matchesQuery } from './trackSearch';
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

describe('matchesQuery', () => {
  it('matches an empty query against everything', () => {
    expect(matchesQuery(track({}), '')).toBe(true);
    expect(matchesQuery(track({}), '   ')).toBe(true);
  });

  // Parity with get_tracks' SQL: title, artist, album, genre — and nothing else.
  it('matches each of the four searchable columns', () => {
    expect(matchesQuery(track({ title: 'Sunrise' }), 'sunr')).toBe(true);
    expect(matchesQuery(track({ artist: 'Supertask' }), 'task')).toBe(true);
    expect(matchesQuery(track({ album: 'Fever Dream' }), 'dream')).toBe(true);
    expect(matchesQuery(track({ genre: 'Neurofunk' }), 'funk')).toBe(true);
  });

  it('does not match columns the SQL leaves out', () => {
    expect(matchesQuery(track({ file_name: 'sunrise.flac' }), 'sunrise')).toBe(false);
    expect(matchesQuery(track({ album_artist: 'Various' }), 'various')).toBe(false);
  });

  it('is case-insensitive in both directions', () => {
    expect(matchesQuery(track({ artist: 'SUPERTASK' }), 'supertask')).toBe(true);
    expect(matchesQuery(track({ artist: 'supertask' }), 'SUPERTASK')).toBe(true);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(matchesQuery(track({ title: 'Sunrise' }), '  sunrise  ')).toBe(true);
  });

  it('returns false when nothing matches, and tolerates all-null fields', () => {
    expect(matchesQuery(track({ title: 'Sunrise' }), 'moonset')).toBe(false);
    expect(matchesQuery(track({}), 'anything')).toBe(false);
  });
});
