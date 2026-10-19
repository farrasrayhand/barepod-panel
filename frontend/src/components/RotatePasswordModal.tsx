import React, { useState } from 'react';
import { X, KeyRound, Lock, Copy, Check, Eye, EyeOff, RefreshCw, AlertCircle, ShieldAlert } from 'lucide-react';
import type { DatabaseItem } from '../types';

interface RotatePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
  onRotated: (dbId: string, newPassword: string) => void;
  /**
   * Live rotation: confirms the panel password, sets the new secret and tells the
   * engine. It returns the password that is now in effect.
   */
  onRotate?: (dbId: string, panelPassword: string, newPassword: string) => Promise<string>;
}

const generatePassword = () => 'bp_' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 6).toUpperCase();

export const RotatePasswordModal: React.FC<RotatePasswordModalProps> = ({
  isOpen,
  onClose,
  database,
  onRotated,
  onRotate,
}) => {
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState('');
  const [panelPassword, setPanelPassword] = useState('');
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(true);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<'generate' | 'custom'>('generate');

  if (!isOpen || !database) return null;

  const passwordValid = newPassword.trim().length >= 12;

  const reset = () => {
    setPanelPassword('');
    setError('');
    setVerified(false);
    setNewPassword('');
    setCopied(false);
    setMode('generate');
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!panelPassword.trim()) {
      setError('Enter your panel account password.');
      return;
    }
    if (onRotate) {
      // The daemon checks the password itself, so verification and rotation are
      // one step: there is no window where the modal claims to be unlocked.
      setBusy(true);
      setError('');
      try {
        const password = await onRotate(database.id, panelPassword, generatePassword());
        setNewPassword(password);
        setApplied(password);
        setVerified(true);
        setCopied(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'That password was not accepted.');
      } finally {
        setBusy(false);
      }
      return;
    }
    setError('');
    setVerified(true);
    setNewPassword(generatePassword());
  };

  const handleConfirm = async () => {
    // A rotated-away password is already in effect; only a custom one still has to
    // be applied, through the same call.
    if (onRotate && passwordValid && newPassword !== applied) {
      setBusy(true);
      try {
        await onRotate(database.id, panelPassword, newPassword);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'The password could not be applied.');
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    onRotated(database.id, newPassword);
    onClose();
    reset();
  };

  const copy = () => {
    navigator.clipboard?.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Rotate Database Password</h2>
              <p className="text-xs text-slate-500">{database.name} · {database.username}</p>
            </div>
          </div>
          <button onClick={() => { onClose(); reset(); }} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!verified ? (
          <form onSubmit={handleVerify} className="p-6 space-y-4">
            <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <span>Rotating the password immediately invalidates the old one. Update your application <code className="font-mono">.env</code> / connection string afterwards.</span>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Confirm with your panel password</label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="password"
                  autoFocus
                  value={panelPassword}
                  onChange={(e) => setPanelPassword(e.target.value)}
                  placeholder="Panel account password"
                  className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>
              {error && (
                <p className="text-[11px] text-rose-600 mt-1 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {error}
                </p>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" onClick={() => { onClose(); reset(); }} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50 cursor-pointer"
              >
                {busy ? 'Verifying...' : 'Continue'}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
              <span className="flex items-center gap-1.5 font-medium">
                <Check className="w-3.5 h-3.5 text-emerald-600" /> Identity verified
              </span>
              <span className="text-[10px] text-emerald-700">New password generated</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">New password</label>
                <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => { setMode('generate'); setNewPassword(generatePassword()); }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${mode === 'generate' ? 'bg-white text-slate-800 shadow-2xs' : 'text-slate-500'}`}
                  >
                    Generate
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('custom'); setNewPassword(''); }}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all ${mode === 'custom' ? 'bg-white text-slate-800 shadow-2xs' : 'text-slate-500'}`}
                  >
                    Custom
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  readOnly={mode === 'generate'}
                  autoFocus={mode === 'custom'}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={mode === 'custom' ? 'Type your own password (min. 12 chars)' : ''}
                  className={`flex-1 bg-transparent border-none outline-hidden text-xs font-mono ${mode === 'generate' ? 'font-bold text-slate-900' : 'text-slate-800'} placeholder:text-slate-400`}
                />
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="p-1 text-slate-400 hover:text-slate-600" title="Show/hide">
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  {mode === 'generate' && (
                    <button type="button" onClick={() => setNewPassword(generatePassword())} className="p-1 text-slate-400 hover:text-blue-600" title="Regenerate">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button type="button" onClick={copy} disabled={!passwordValid} className="p-1 text-slate-400 hover:text-emerald-600 disabled:opacity-40" title="Copy">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <p className={`text-[11px] mt-1 ${passwordValid ? 'text-slate-400' : 'text-rose-600'}`}>
                {passwordValid
                  ? 'Shown once — update this value in your app’s .env and restart the service.'
                  : 'Password must be at least 12 characters.'}
              </p>
            </div>

            {!database.isolationMode || database.isolationMode === 'shared_daemon' ? (
              <p className="text-[11px] text-slate-500">
                Executed as <code className="font-mono">ALTER USER {database.username} WITH PASSWORD …</code> on the shared daemon (port {database.port ?? '—'}).
              </p>
            ) : null}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={() => { onClose(); reset(); }} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!passwordValid || busy}
                className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {busy ? 'Applying...' : (mode === 'custom' || newPassword !== applied ? 'Apply New Password' : 'Done & Close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
