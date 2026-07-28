import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDownIcon } from '../Icons';

export interface FieldOption {
  value: string;
  label: string;
}

interface FieldDropdownProps {
  value: string;
  options: FieldOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}

// Matches GroupContextMenu's item styling so menus and dropdowns read as one
// family.
const ITEM_CLASS =
  'px-3 py-1.5 text-sm hover:bg-neon-purple/20 cursor-pointer transition-colors text-gray-200 hover:text-white';

/**
 * Replaces the native <select>, which WebView2 renders with white system
 * chrome that ignores the app's theme.
 *
 * The popup MUST portal to document.body: glass-surface/glass-panel use
 * backdrop-filter, which makes them the containing block for fixed
 * descendants, and their overflow-hidden then clips the popup invisible. The
 * Now Playing sidebar is exactly such a container.
 */
export function FieldDropdown({ value, options, onChange, ariaLabel }: FieldDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Flip above when there isn't room below.
      const height = Math.min(options.length * 32 + 8, 320);
      const below = window.innerHeight - r.bottom;
      setPos({
        left: r.left,
        top: below < height ? Math.max(4, r.top - height - 4) : r.bottom + 4,
        width: r.width,
      });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={ariaLabel}
        className="flex-1 min-w-0 flex items-center justify-between gap-1 bg-cosmic-bg/50 border border-cosmic-border/30 rounded text-xs text-gray-300 py-1 px-1.5 hover:border-neon-purple/40 focus:outline-none focus:border-neon-purple/40 transition-colors"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <ChevronDownIcon size={10} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popRef}
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              minWidth: Math.max(pos.width, 140),
              zIndex: 9999,
            }}
            className="bg-cosmic-surface border border-cosmic-border/60 rounded-lg shadow-xl shadow-black/50 py-1 backdrop-blur-xl max-h-80 overflow-y-auto"
          >
            {options.map((opt) => (
              <div
                key={opt.value}
                className={`${ITEM_CLASS} ${opt.value === value ? 'text-neon-purple' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
