import React, { useState } from 'react';
import { X, KeyRound, Copy, Check, AlertTriangle } from 'lucide-react';
import type { ApiUser } from '../api/client';

interface ResetPasswordModalProps {
  isOpen: boolean;
  user: ApiUser | null;
  onClose: () => void;
  /** Generates a new password for the account and resolves with it (once). */
  onReset: () => Promise<string | null>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ isOpen, user, onClose, onReset }) => {
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setBusy(false);
      setPassword(null);
      setError(null);
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen || !user) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await onReset();
      if (result) setPassword(result);
      else setError('The daemon did not return a new password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Reset password</h2>
              <p className="text-xs text-slate-500 font-mono">{user.username}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {password ? (
            <>
              <p className="text-xs text-slate-600">
                The new password is shown <strong>once</strong> — copy it now and hand it to the account owner. Every session
                for this account was signed out.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs font-mono bg-slate-900 text-emerald-300 rounded-lg break-all">
                  {password}
                </code>
                <button
                  onClick={copy}
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                  title="Copy"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px]">
                  A new random password is generated and <strong>every session for {user.username}</strong> is revoked. The
                  password cannot be shown again after you close this.
                </p>
              </div>
              {error && <p className="text-[11px] text-rose-600">{error}</p>}
            </>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
              {password ? 'Done' : 'Cancel'}
            </button>
            {!password && (
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm shadow-amber-500/20 disabled:opacity-60"
              >
                {busy ? 'Generating…' : 'Generate a new password'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
