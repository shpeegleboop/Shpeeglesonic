import { useMemo } from 'react';
import { usePlayerStore, type Track } from '../stores/playerStore';
import {
  type BrowseField, type BrowseGroup, type BrowseStep,
  availableFieldsFor, filterByPath, groupsOf, isLeafField,
  sanitizePath, selectAt, setFieldAt, sortTracks,
} from '../utils/browsePath';

export interface BrowseColumnModel {
  index: number;
  field: BrowseField;
  selected: string | null;
  groups: BrowseGroup[];
  /** Fields this column may offer — excludes grouping fields pinned above it. */
  fields: BrowseField[];
  /** True when this column shows tracks rather than group headings. */
  isLeaf: boolean;
  leafTracks: Track[];
}

export interface BrowseModel {
  path: BrowseStep[];
  columns: BrowseColumnModel[];
  select: (index: number, value: string | null) => void;
  setField: (index: number, field: BrowseField) => void;
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
  const sortOrder = usePlayerStore((s) => s.browseSortOrder);

  // Sanitize against the UNFILTERED library, never the search-filtered list.
  // Searching for something that excludes the current album must not silently
  // reset your position — the path has to survive so clearing the search
  // restores the view. `allTracks` exists on useLibrary for exactly this.
  const path = useMemo(() => sanitizePath(rawPath, allTracks), [rawPath, allTracks]);

  const columns = useMemo<BrowseColumnModel[]>(
    () =>
      // Every step is a column. Whether it shows groups or tracks is a property
      // of its FIELD — a leaf field like Duration cannot be broken down further,
      // so that column is the track list, ordered by it.
      path.map((step, i) => {
        const visible = filterByPath(tracks, path, i);
        const leaf = isLeafField(step.field);
        return {
          index: i,
          field: step.field,
          selected: step.value,
          groups: leaf ? [] : groupsOf(visible, step.field),
          fields: availableFieldsFor(path, i),
          isLeaf: leaf,
          leafTracks: leaf && isLeafField(step.field)
            ? sortTracks(visible, step.field, sortOrder)
            : [],
        };
      }),
    [tracks, path, sortOrder]
  );

  return {
    path,
    columns,
    select: (index, value) => setBrowsePath(selectAt(path, index, value)),
    setField: (index, field) => setBrowsePath(setFieldAt(path, index, field)),
    popTo: (index) =>
      setBrowsePath(path.slice(0, index + 1).map((s, i) => (i === index ? { ...s, value: null } : s))),
  };
}
