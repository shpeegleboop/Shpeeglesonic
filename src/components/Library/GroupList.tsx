import { useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { type BrowseColumnModel } from '../../hooks/useBrowse';
import {
  type BrowseGroup, type GroupField,
  GROUP_FIELDS, GROUP_FIELD_LABELS,
} from '../../utils/browsePath';
import { FieldDropdown } from './FieldDropdown';
import { GroupContextMenu } from './GroupContextMenu';
import { RenameGroupModal } from './RenameGroupModal';

/** RenameGroupModal only accepts fields backed by a real, editable tag. */
type RenameField = 'artist' | 'album' | 'genre';
const RENAMEABLE: GroupField[] = ['artist', 'album', 'genre'];
const isRenameable = (f: GroupField): f is RenameField => RENAMEABLE.includes(f);

interface GroupListProps {
  column: BrowseColumnModel;
  onSelect: (value: string | null) => void;
  onSetField: (field: GroupField) => void;
  onLibraryChanged: () => void;
  /** Caller owns width: fixed per-column on Library, full-width in the sidebar. */
  className?: string;
}

/**
 * One column of group headings. Virtualized because an artist column over a
 * few thousand tracks runs to hundreds of rows.
 */
export function GroupList({
  column, onSelect, onSetField, onLibraryChanged, className = '',
}: GroupListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ group: BrowseGroup; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<BrowseGroup | null>(null);

  const virtualizer = useVirtualizer({
    count: column.groups.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 20,
  });

  return (
    <div className={`flex flex-col h-full border-r border-cosmic-border/30 ${className}`}>
      <div className="p-2 border-b border-cosmic-border/30 flex">
        <FieldDropdown
          value={column.field}
          options={GROUP_FIELDS.map((f) => ({ value: f, label: GROUP_FIELD_LABELS[f] }))}
          onChange={(v) => onSetField(v as GroupField)}
          ariaLabel="Group by"
        />
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const g = column.groups[vi.index];
            if (!g) return null;
            const active = g.value === column.selected;
            return (
              <div
                key={vi.key}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%',
                  height: vi.size, transform: `translateY(${vi.start}px)`,
                }}
                onClick={() => onSelect(g.value)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ group: g, x: e.clientX, y: e.clientY });
                }}
                className={`flex items-center justify-between px-3 cursor-pointer transition-colors ${
                  active
                    ? 'bg-neon-purple/20 text-white'
                    : 'text-gray-300 hover:bg-neon-purple/10 hover:text-white'
                }`}
              >
                <span className="truncate text-sm">{g.label}</span>
                <span className="text-[11px] text-gray-500 ml-2 shrink-0">{g.count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {menu && (
        <GroupContextMenu
          label={menu.group.label}
          tracks={menu.group.tracks}
          canRename={isRenameable(column.field) && menu.group.value !== null}
          renameLabel={GROUP_FIELD_LABELS[column.field]}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menu.group)}
        />
      )}

      {renaming && isRenameable(column.field) && (
        <RenameGroupModal
          field={column.field}
          label={renaming.label}
          oldValue={renaming.value}
          trackCount={renaming.count}
          onClose={() => setRenaming(null)}
          onDone={() => {
            setRenaming(null);
            onLibraryChanged();
          }}
        />
      )}
    </div>
  );
}
