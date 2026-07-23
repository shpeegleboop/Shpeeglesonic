import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small themed confirmation prompt for destructive actions. */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-cosmic-surface border border-cosmic-border/60 rounded-xl shadow-2xl shadow-black/50 p-5 max-w-sm w-full">
        <h3 className="text-sm font-semibold text-white mb-1">{title}</h3>
        {message && <p className="text-xs text-gray-400 mb-4">{message}</p>}
        <div className={`flex justify-end gap-2 ${message ? '' : 'mt-4'}`}>
          <button onClick={onCancel} className="btn-ghost text-sm px-4" autoFocus>
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-sm px-4 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 hover:text-red-200 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
