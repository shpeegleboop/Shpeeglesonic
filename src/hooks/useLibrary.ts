import { useState, useCallback, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { type Track, usePlayerStore } from '../stores/playerStore';
import { matchesQuery } from '../utils/trackSearch';

/** What `scan_folder` reports back. Mirrors scanner::ScanSummary. */
export interface ScanSummary {
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  missing: string[];
}

// Global library state shared across all useLibrary() instances
let _globalTracks: Track[] = [];
let _globalFolders: string[] = [];
let _listeners: Set<() => void> = new Set();

function notifyListeners() {
  _listeners.forEach((fn) => fn());
}

export function useLibrary() {
  const [tracks, setTracks] = useState<Track[]>(_globalTracks);
  const [folders, setFolders] = useState<string[]>(_globalFolders);
  const [loading, setLoading] = useState(false);
  const [sortBy, setSortBy] = useState('artist');
  const [sortOrder, setSortOrder] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');

  // Subscribe to global updates
  useEffect(() => {
    const listener = () => {
      setTracks([..._globalTracks]);
      setFolders([..._globalFolders]);
    };
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  // Rust emits null when the scan ends, which clears the progress line.
  useEffect(() => {
    const unlisten = listen<{ done: number; total: number; label: string } | null>(
      'scan-progress',
      (e) => usePlayerStore.getState().setScanProgress(e.payload)
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Always fetches the COMPLETE library. Search is applied client-side, so
  // _globalTracks must stay the unfiltered truth — every other consumer
  // (sidebar, playlist counts, duplicates modal) reads the same global.
  const fetchTracks = useCallback(async (sort?: string, order?: string) => {
    try {
      const result = await invoke<Track[]>('get_library_tracks', {
        sortBy: sort || sortBy,
        sortOrder: order || sortOrder,
        search: null,
      });
      _globalTracks = result;
      setTracks(result);
      notifyListeners();
    } catch (e) {
      console.error('Failed to fetch tracks:', e);
    }
  }, [sortBy, sortOrder]);

  const fetchFolders = useCallback(async () => {
    try {
      const result = await invoke<string[]>('get_library_folders');
      _globalFolders = result;
      setFolders(result);
      notifyListeners();
    } catch (e) {
      console.error('Failed to fetch folders:', e);
    }
  }, []);

  const runScan = useCallback(
    async (path: string, incremental: boolean) => {
      setLoading(true);
      try {
        const summary = await invoke<ScanSummary>('scan_folder', { path, incremental });
        await fetchTracks();
        await fetchFolders();
        return summary;
      } catch (e) {
        console.error('Scan failed:', e);
        throw e;
      } finally {
        setLoading(false);
        usePlayerStore.getState().setScanProgress(null);
      }
    },
    [fetchTracks, fetchFolders]
  );

  /** Full rescan — re-reads every file's tags. */
  const scanFolder = useCallback((path: string) => runScan(path, false), [runScan]);
  /** Quick scan — skips files whose size and mtime are unchanged. */
  const quickScan = useCallback((path: string) => runScan(path, true), [runScan]);

  const removeFolder = useCallback(async (path: string) => {
    try {
      await invoke('remove_library_folder', { path });
      await fetchTracks();
      await fetchFolders();
    } catch (e) {
      console.error('Remove folder failed:', e);
    }
  }, [fetchTracks, fetchFolders]);

  const updateSort = useCallback((by: string, order?: string) => {
    const newOrder = order || (by === sortBy && sortOrder === 'asc' ? 'desc' : 'asc');
    setSortBy(by);
    setSortOrder(newOrder);
    fetchTracks(by, newOrder);
  }, [sortBy, sortOrder, fetchTracks]);

  // Search is a pure view concern now: no IPC, no SQL, no debounce needed.
  // The old implementation refetched on every keystroke, which at 4000 tracks
  // meant a ~3s query plus ~2MB of JSON per character typed.
  const updateSearch = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const visibleTracks = useMemo(
    () => (searchQuery.trim() ? tracks.filter((t) => matchesQuery(t, searchQuery)) : tracks),
    [tracks, searchQuery]
  );

  return {
    tracks: visibleTracks,
    /** Unfiltered library — for consumers that must not see the search box's effect. */
    allTracks: tracks,
    folders,
    loading,
    sortBy,
    sortOrder,
    searchQuery,
    fetchTracks,
    fetchFolders,
    scanFolder,
    quickScan,
    removeFolder,
    updateSort,
    updateSearch,
  };
}
