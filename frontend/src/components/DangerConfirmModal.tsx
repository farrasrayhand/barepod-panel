import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, Trash2, ShieldAlert } from 'lucide-react';

interface DangerConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemType: string; // e.g. "Database" | "Application" | "Container Pod"
  itemName: string; // e.g. "larastore_production"
  warningDescription?: string;
  confirmLabel?: string;
  children?: React.ReactNode;
}

export const DangerConfirmModal: React.FC<DangerConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  itemType,
  itemName,
  warningDescription,
  confirmLabel = 'Delete Permanently',
  children,
}) => {
  const [confirmInput, setConfirmInput] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setConfirmInput('');
      setAcknowledged(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isMatch = confirmInput.trim() === itemName.trim();
  const canDelete = isMatch && acknowledged;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canDelete) {
      onConfirm();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-rose-200 shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header with Danger Accent */}
        <div className="px-6 py-4 bg-rose-50 border-b border-rose-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 border border-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-600 animate-bounce" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-rose-950">{title}</h2>
              <span className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider">
                Permanent Destruction Zone
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Warning Message Box */}
          <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl text-xs text-rose-900 leading-relaxed">
            <div className="flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-950 mb-1">
                  Warning: This action is PERMANENT and cannot be undone!
                </p>
                <p className="text-[11px] text-rose-800">
                  {warningDescription ||
                    `All data, tables, schema, configuration, and files related to this ${itemType.toLowerCase()} will be permanently deleted from the server.`}
                </p>
              </div>
            </div>
          </div>

          {/* Type to Confirm Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Type the {itemType.toLowerCase()} name <span className="font-mono font-bold text-rose-600 select-all px-1.5 py-0.5 bg-rose-50 rounded border border-rose-200">{itemName}</span> to confirm:
            </label>
            <input
              type="text"
              autoFocus
              required
              placeholder={`Type "${itemName}" here...`}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              className={`w-full px-3 py-2 text-xs font-mono rounded-lg border focus:outline-hidden transition-all ${
                isMatch
                  ? 'border-emerald-500 bg-emerald-50/40 text-emerald-900 font-bold focus:ring-1 focus:ring-emerald-500'
                  : 'border-slate-300 bg-slate-50 text-slate-900 focus:border-rose-500 focus:bg-white'
              }`}
            />
            {confirmInput.length > 0 && !isMatch && (
              <p className="text-[10px] text-rose-600 font-medium">
                The text you typed does not match "{itemName}".
              </p>
            )}
          </div>

          {/* Custom Form Elements / Extra Options */}
          {children}

          {/* Checkbox Acknowledgment */}
          <div className="pt-1">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-600 select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
              />
              <span className="text-[11px] leading-snug">
                I confirm that I understand all data will be permanently lost and cannot be recovered.
              </span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canDelete}
              className={`px-4 py-2 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all shadow-sm ${
                canDelete
                  ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/25 cursor-pointer'
                  : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{confirmLabel}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
