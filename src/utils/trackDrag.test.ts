import { describe, it, expect } from 'vitest';
import {
  TRACK_DRAG_MIME, startTrackDrag, isTrackDrag, readTrackDrag,
  resolveTracks, playNextOrder,
} from './trackDrag';
import type { Track } from '../stores/playerStore';

/** Minimal stand-in for DataTransfer, which does not exist in node. */
function stubDT() {
  const store = new Map<string, string>();
  return {
    get types() { return [...store.keys()]; },
    setData: (f: string, d: string) => { store.set(f, d); },
    getData: (f: string) => store.get(f) ?? '',
    effectAllowed: undefined as string | undefined,
  };
}

function track(fields: Partial<Track>): Track {
  return {
    id: 1, file_path: 'D:\\Music\\a.flac', file_name: 'a.flac',
    title: null, artist: null, album_artist: null, album: null, genre: null,
    year: null, track_number: null, disc_number: null, bpm: null,
    duration_seconds: null, format: null, bitrate: null, sample_rate: null,
    bit_depth: null, channels: null, has_album_art: false, art_path: null,
    album_art_color: null, play_count: 0, favorited: false, dup_flag: false,
    date_added: null,
    ...fields,
  };
}

describe('startTrackDrag / readTrackDrag', () => {
  it('round-trips a payload', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [3, 1, 2], label: 'OK Computer' });
    expect(readTrackDrag(dt)).toEqual({ trackIds: [3, 1, 2], label: 'OK Computer' });
  });

  // A dragged playlist lists no ids — dragstart cannot await, so the contents
  // are fetched at drop time. The playlist id alone has to be enough.
  it('accepts a playlist payload with no ids', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [], label: 'Late Night', playlistId: 7 });
    expect(readTrackDrag(dt)).toEqual({ trackIds: [], label: 'Late Night', playlistId: 7 });
  });

  // Otherwise a drop on the queue would silently do nothing for one of the two.
  it('keeps ids and playlistId apart', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [5, 6], label: 'two tracks' });
    expect(readTrackDrag(dt)?.playlistId).toBeUndefined();
  });

  // Some engines refuse a drag whose dataTransfer carries nothing.
  it('always writes text/plain as well', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [1], label: 'Airbag' });
    expect(dt.getData('text/plain')).toBe('Airbag');
  });

  // A row can be both a reorder source and a track source; effectAllowed has to
  // permit both or one of the two drops is refused.
  it('allows copy and move together', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [1], label: 'x' });
    expect(dt.effectAllowed).toBe('copyMove');
  });
});

describe('isTrackDrag', () => {
  // getData() is blocked during dragover — only types is readable, so this
  // must not touch getData.
  it('decides from types alone', () => {
    const dt = stubDT();
    startTrackDrag(dt, { trackIds: [1], label: 'x' });
    expect(isTrackDrag({ types: dt.types })).toBe(true);
  });

  it('ignores a plain reorder drag', () => {
    const dt = stubDT();
    dt.setData('text/plain', '4');
    expect(isTrackDrag({ types: dt.types })).toBe(false);
  });
});

describe('readTrackDrag rejects bad input', () => {
  // A throw inside a drop handler aborts the drop with no feedback.
  it('returns null on malformed JSON instead of throwing', () => {
    const dt = stubDT();
    dt.setData(TRACK_DRAG_MIME, '{not json');
    expect(readTrackDrag(dt)).toBeNull();
  });

  it('returns null when the payload has no usable ids', () => {
    const dt = stubDT();
    dt.setData(TRACK_DRAG_MIME, JSON.stringify({ trackIds: [], label: 'x' }));
    expect(readTrackDrag(dt)).toBeNull();

    const dt2 = stubDT();
    dt2.setData(TRACK_DRAG_MIME, JSON.stringify({ label: 'x' }));
    expect(readTrackDrag(dt2)).toBeNull();
  });

  it('returns null for a drag that is not ours', () => {
    const dt = stubDT();
    dt.setData('text/plain', '4');
    expect(readTrackDrag(dt)).toBeNull();
  });
});

describe('resolveTracks', () => {
  const all = [track({ id: 1 }), track({ id: 2 }), track({ id: 3 })];

  it('returns tracks in the dragged order, not library order', () => {
    expect(resolveTracks([3, 1], all).map((t) => t.id)).toEqual([3, 1]);
  });

  it('drops ids that no longer exist rather than yielding holes', () => {
    expect(resolveTracks([1, 99, 3], all).map((t) => t.id)).toEqual([1, 3]);
  });
});

describe('playNextOrder', () => {
  // playNext inserts directly after the current track, so applying a list in
  // order plays it backwards.
  it('reverses, so a dropped album plays front to back', () => {
    expect(playNextOrder([1, 2, 3])).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const xs = [1, 2, 3];
    playNextOrder(xs);
    expect(xs).toEqual([1, 2, 3]);
  });
});
