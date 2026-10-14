import React, { useState } from 'react';
import { X, KeyRound, Copy, Check, AlertTriangle, Eye, EyeOff, Sparkles, CheckCircle2 } from 'lucide-react';
import type { ApiUser } from '../api/client';

interface ResetPasswordModalProps {
  isOpen: boolean;
  user: ApiUser | null;
  onClose: () => void;
  /** Resets the password for the account (random if no parameter passed, or custom). Resolves with the password or status text. */
  onReset: (customPassword?: string) => Promise<string | null>;
}

export const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ isOpen, user, onClose, onReset }) => {
  const [mode, setMode] = useState<'custom' | 'random'>('custom');
  const [customPassword, setCustomPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resultPassword, setResultPassword] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setMode('custom');
      setCustomPassword('');
      setShowPassword(false);
      setBusy(false);
      setResultPassword(null);
      setSuccessMessage(null);
      setError(null);
      setCopied(false);
    }
  }, [isOpen]);

  if (!isOpen || !user) return null;

  const generateSuggestion = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*';
    let pass = 'Bp#';
    for (let i = 0; i < 11; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCustomPassword(pass);
    setShowPassword(true);
    setError(null);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (mode === 'custom' && customPassword.trim().length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const passToSend = mode === 'custom' ? customPassword.trim() : undefined;
      const res = await onReset(passToSend);
      if (res) {
        setResultPassword(mode === 'custom' ? customPassword.trim() : res);
        setSuccessMessage(`Password for ${user.username} has been updated. All active sessions have been revoked.`);
      } else {
        setError('Could not update password. Please check backend logs.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!resultPassword) return;
    try {
      await navigator.clipboard.writeText(resultPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Change / Reset Password</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs text-slate-600 font-mono font-medium">{user.username}</span>
                <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.2 rounded font-medium">
                  {user.groupName || user.role}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {resultPassword ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs text-emerald-900">
                  <p className="font-semibold">Password updated successfully</p>
                  <p className="text-[11px] text-emerald-800 mt-0.5">{successMessage}</p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                  New Password ({mode === 'custom' ? 'Custom' : 'Generated'})
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 text-xs font-mono bg-slate-900 text-emerald-300 rounded-lg break-all select-all">
                    {resultPassword}
                  </code>
                  <button
                    onClick={copy}
                    className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 transition-colors"
                    title="Copy Password"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Copy this password and share it securely with the user.
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Mode Switcher */}
              <div className="flex p-1 bg-slate-100 rounded-xl gap-1">
                <button
                  type="button"
                  onClick={() => { setMode('custom'); setError(null); }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    mode === 'custom'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Set Custom Password
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('random'); setError(null); }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    mode === 'random'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Auto-Generate Random
                </button>
              </div>

              {mode === 'custom' ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-slate-700">Custom Password</label>
                      <button
                        type="button"
                        onClick={generateSuggestion}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" /> Suggest strong
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={customPassword}
                        onChange={(e) => {
                          setCustomPassword(e.target.value);
                          if (error) setError(null);
                        }}
                        placeholder="Enter new password (min. 8 characters)"
                        className="w-full px-3 py-2 pr-10 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
                      <span>Minimum 8 characters</span>
                      <span className={customPassword.length >= 8 ? 'text-emerald-600 font-medium' : 'text-slate-400'}>
                        {customPassword.length} chars
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px]">
                    The panel will generate a cryptographically strong 14-character token and revoke all existing sessions for <strong className="font-mono">{user.username}</strong>.
                  </p>
                </div>
              )}

              {error && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || (mode === 'custom' && customPassword.trim().length < 8)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {busy ? 'Saving…' : mode === 'custom' ? 'Set Custom Password' : 'Generate & Reset'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
