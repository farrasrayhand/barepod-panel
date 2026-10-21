import React, { useState } from 'react';
import { Server, Lock, AlertCircle, KeyRound, Copy, Check, X, User, Terminal } from 'lucide-react';

interface LoginViewProps {
  onSignIn: (username: string, password: string, totpCode?: string) => Promise<boolean>;
  error: string;
  busy: boolean;
  /** The daemon accepted the password and wants the authenticator code for this account. */
  totpRequired?: boolean;
  /** Path the browser asked for; kept in the URL so signing in lands there. */
  redirectTo?: string;
}

/**
 * Sign-in screen for the real daemon.
 *
 * The panel has no built-in account: the operator creates one with
 * `barepod admin create` at install time. There is no offline/simulation
 * escape here — without a daemon there is nothing truthful to show.
 */
export const LoginView: React.FC<LoginViewProps> = ({ onSignIn, error, busy, totpRequired = false, redirectTo }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCmd(id);
      setTimeout(() => setCopiedCmd(null), 2000);
    } catch {
      // Fallback
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username || !password) return;
    if (totpRequired && totpCode.length !== 6) return;
    await onSignIn(username, password, totpRequired ? totpCode : undefined);
  };

  const inputClass =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8 w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-sm shadow-blue-500/25">
            <Server className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Sign in to BarePod</h1>
          <p className="text-xs text-slate-500">Enter your panel account.</p>
          {redirectTo && (
            <p className="text-[11px] text-slate-500">
              Signing in takes you back to <code className="px-1 py-0.5 rounded bg-slate-100 font-mono">{redirectTo}</code>
              .
            </p>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
            <input
              className={inputClass}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-slate-700">Password</label>
              <button
                type="button"
                onClick={() => setShowForgotModal(true)}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
            </div>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>

          {totpRequired && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Authentication code</label>
              <input
                className={`${inputClass} font-mono tracking-[0.3em]`}
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                autoFocus
              />
              <p className="text-[10px] text-slate-400 mt-1">
                The 6-digit code from your authenticator app.
              </p>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password || (totpRequired && totpCode.length !== 6)}
            className="w-full px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer shadow-xs"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

      </div>

      {/* Forgot Password / Reset Instructions Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-start sm:items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Reset Account Password</h3>
                  <p className="text-[10px] text-slate-500">Host Terminal / SSH Verification</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Notice for Regular Users */}
              <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-md bg-amber-200/60 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="font-semibold block text-amber-950">Regular Users / Tenants</strong>
                  Please contact your server administrator to reset your account password.
                </div>
              </div>

              {/* Notice for Admin SSH Terminal */}
              <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 leading-relaxed flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-md bg-blue-200/60 text-blue-800 flex items-center justify-center shrink-0 mt-0.5">
                  <Terminal className="w-3.5 h-3.5" />
                </div>
                <div>
                  <strong className="font-semibold block text-blue-950">Server Administrators</strong>
                  Root operators can reset any account password directly via the server terminal using the CLI instructions below:
                </div>
              </div>

              <div className="space-y-3.5 text-xs text-slate-700">
                <div className="space-y-1.5">
                  <span className="font-bold flex items-center gap-1.5 text-slate-900 text-[11px]">
                    <span className="w-4 h-4 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">1</span>
                    Connect to your server via SSH:
                  </span>
                  <div className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] flex items-center justify-between">
                    <code>ssh root@your-server-ip</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard('ssh root@your-server-ip', 'ssh')}
                      className="text-slate-400 hover:text-white transition p-1 cursor-pointer"
                      title="Copy command"
                    >
                      {copiedCmd === 'ssh' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="font-bold flex items-center gap-1.5 text-slate-900 text-[11px]">
                    <span className="w-4 h-4 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">2</span>
                    Run the password reset command:
                  </span>
                  <div className="p-2.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] flex items-center justify-between">
                    <code>barepod admin passwd {username || '<username>'}</code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(`barepod admin passwd ${username || 'admin'}`, 'reset')}
                      className="text-slate-400 hover:text-white transition p-1 cursor-pointer"
                      title="Copy command"
                    >
                      {copiedCmd === 'reset' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 pl-5.5">
                    Or specify your new password directly:
                    <code className="block mt-1 font-mono text-slate-700 bg-slate-100 p-1.5 rounded text-[10px]">
                      barepod admin passwd --password "YourNewPassword" {username || 'admin'}
                    </code>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <span className="font-bold flex items-center gap-1.5 text-slate-900 text-[11px]">
                    <span className="w-4 h-4 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px]">3</span>
                    Sign in to panel:
                  </span>
                  <p className="text-[11px] text-slate-600 pl-5.5">
                    Once the command completes, return to this page and sign in with your updated credentials.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowForgotModal(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
