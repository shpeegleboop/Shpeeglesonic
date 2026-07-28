import { usePlayerStore } from '../../stores/playerStore';
import { type BrowseField, FIELD_LABELS, isLeafField } from '../../utils/browsePath';
import { FieldDropdown } from './FieldDropdown';
import { ArrowUpIcon, ArrowDownIcon } from '../Icons';

interface ColumnHeaderProps {
  field: BrowseField;
  fields: BrowseField[];
  onSetField: (f: BrowseField) => void;
}

/**
 * A column's field picker, shared by group and track columns.
 *
 * The direction toggle only appears on a leaf column: group columns are always
 * sorted by label, so a direction control there would suggest an ordering the
 * user cannot actually change.
 */
export function ColumnHeader({ field, fields, onSetField }: ColumnHeaderProps) {
  const order = usePlayerStore((s) => s.browseSortOrder);
  const setOrder = usePlayerStore((s) => s.setBrowseSortOrder);

  return (
    <div className="p-2 border-b border-cosmic-border/30 flex items-center gap-1">
      <FieldDropdown
        value={field}
        options={fields.map((f) => ({ value: f, label: FIELD_LABELS[f] }))}
        onChange={(v) => onSetField(v as BrowseField)}
        ariaLabel="Group by"
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
