import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type Track } from '../stores/playerStore';

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

  const fetchTracks = useCallback(async (sort?: string, order?: string, search?: string) => {
    try {
      const s = sort || sortBy;
      const o = order || sortOrder;
      const q = search !== undefined ? search : searchQuery;
      const result = await invoke<Track[]>('get_library_tracks', {
        sortBy: s,
        sortOrder: o,
        search: q || null,
      });
      _globalTracks = result;
      setTracks(result);
      notifyListeners();
    } catch (e) {
      console.error('Failed to fetch tracks:', e);
    }
  }, [sortBy, sortOrder, searchQuery]);

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

  const scanFolder = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const count = await invoke<number>('scan_folder', { path });
      await fetchTracks();
      await fetchFolders();
      return count;
    } catch (e) {
      console.error('Scan failed:', e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [fetchTracks, fetchFolders]);

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

  const updateSearch = useCallback((query: string) => {
    setSearchQuery(query);
    fetchTracks(sortBy, sortOrder, query);
  }, [sortBy, sortOrder, fetchTracks]);

  return {
    tracks,
    folders,
    loading,
    sortBy,
    sortOrder,
    searchQuery,
    fetchTracks,
    fetchFolders,
    scanFolder,
    removeFolder,
    updateSort,
    updateSearch,
  };
}
