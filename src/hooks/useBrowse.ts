import { useMemo } from 'react';
import { usePlayerStore, type Track } from '../stores/playerStore';
import {
  type GroupField, type BrowseGroup, type BrowseStep,
  availableFieldsFor, filterByPath, groupsOf, nextFieldFor,
  sanitizePath, selectAt, setFieldAt,
} from '../utils/browsePath';

export interface BrowseColumnModel {
  index: number;
  field: GroupField;
  selected: string | null;
  groups: BrowseGroup[];
  /** Grouping fields this column may offer — excludes ones pinned above it. */
  fields: GroupField[];
  /** True when this column shows tracks rather than group headings. */
  isLeaf: boolean;
  leafTracks: Track[];
}

export interface BrowseModel {
  path: BrowseStep[];
  columns: BrowseColumnModel[];
  select: (index: number, value: string | null) => void;
  setField: (index: number, field: GroupField) => void;
  popTo: (index: number) => void;
}

/**
 * Derives the visible columns from the shared browsePath. The Library tab
 * renders every column; the Now Playing sidebar renders only the deepest.
 *
 * @param tracks    search-filtered list, used for grouping and leaf contents
 * @param allTracks unfiltered library, used ONLY to sanitize the path — see below
 */
export function useBrowse(tracks: Track[], allTracks: Track[]): BrowseModel {
  const rawPath = usePlayerStore((s) => s.browsePath);
  const setBrowsePath = usePlayerStore((s) => s.setBrowsePath);

  // Sanitize against the UNFILTERED library, never the search-filtered list.
  // Searching for something that excludes the current album must not silently
  // reset your position — the path has to survive so clearing the search
  // restores the view. `allTracks` exists on useLibrary for exactly this.
  const path = useMemo(() => sanitizePath(rawPath, allTracks), [rawPath, allTracks]);

  const columns = useMemo<BrowseColumnModel[]>(() => {
    // Every path step is a grouping column. The track list is a SEPARATE,
    // derived column appended at the end — it is not a step. Deriving it this
    // way is what keeps the whole tree visible: picking an album adds a third
    // column instead of turning the album column into a track list.
    const cols: BrowseColumnModel[] = path.map((step, i) => ({
      index: i,
      field: step.field,
      selected: step.value,
      groups: groupsOf(filterByPath(tracks, path, i), step.field),
      fields: availableFieldsFor(path, i),
      isLeaf: false,
      leafTracks: [],
    }));

    const lastIndex = path.length - 1;
    const last = path[lastIndex];
    // Tracks appear once the deepest column has a selection and the chain has
    // nothing left to group by.
    if (last && last.value !== null && nextFieldFor(path, lastIndex) === null) {
      cols.push({
        index: path.length,
        field: last.field,
        selected: null,
        groups: [],
        fields: [],
        isLeaf: true,
        leafTracks: filterByPath(tracks, path, path.length),
      });
    }

    return cols;
  }, [tracks, path]);

  return {
    path,
    columns,
    select: (index, value) => setBrowsePath(selectAt(path, index, value)),
    setField: (index, field) => setBrowsePath(setFieldAt(path, index, field)),
    popTo: (index) =>
      setBrowsePath(path.slice(0, index + 1).map((s, i) => (i === index ? { ...s, value: null } : s))),
  };
}
