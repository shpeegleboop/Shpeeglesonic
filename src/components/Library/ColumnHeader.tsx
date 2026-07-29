import { usePlayerStore } from '../../stores/playerStore';
import { type BrowseField, FIELD_LABELS, isLeafField } from '../../utils/browsePath';
import { FieldDropdown } from './FieldDropdown';
import { ArrowUpIcon, ArrowDownIcon } from '../Icons';

interface ColumnHeaderProps {
  field: BrowseField;
  fields: BrowseField[];
  onSetField: (f: BrowseField) => void;
  /** True when this column is showing an album in its own running order, which
   *  is no longer what "Track Title" describes. */
  albumOrder?: boolean;
}

/**
 * A column's field picker, shared by group and track columns.
 *
 * The direction toggle only appears on a leaf column: group columns are always
 * sorted by label, so a direction control there would suggest an ordering the
 * user cannot actually change.
 */
export function ColumnHeader({ field, fields, onSetField, albumOrder }: ColumnHeaderProps) {
  const order = usePlayerStore((s) => s.browseSortOrder);
  const setOrder = usePlayerStore((s) => s.setBrowseSortOrder);

  return (
    <div className="p-2 border-b border-cosmic-border/30 flex items-center gap-1">
      <FieldDropdown
        value={field}
        options={fields.map((f) => ({ value: f, label: FIELD_LABELS[f] }))}
        onChange={(v) => onSetField(v as BrowseField)}
        ariaLabel="Group by"
        // Only the button text: the menu still offers "Track Title", because
        // that is the field you would be choosing.
        displayLabel={albumOrder ? 'Tracks' : undefined}
      />
      {isLeafField(field) && (
        <button
          onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
          className="btn-ghost !p-1.5 shrink-0"
          title={order === 'asc' ? 'Ascending' : 'Descending'}
        >
          {order === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
        </button>
      )}
    </div>
  );
}
