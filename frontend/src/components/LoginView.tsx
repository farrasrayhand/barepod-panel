import React, { useState } from 'react';
import { Server, Lock, AlertCircle, FlaskConical } from 'lucide-react';

interface LoginViewProps {
  onSignIn: (username: string, password: string) => Promise<boolean>;
  onSimulate: () => void;
  error: string;
  busy: boolean;
  mode: 'checking' | 'live' | 'mock';
  /** Path the browser asked for; kept in the URL so signing in lands there. */
  redirectTo?: string;
}

/**
 * Sign-in screen for the real daemon.
 *
 * The panel has no built-in account: the operator creates one with
 * `barepod admin create` at install time. When the daemon is not running the
 * prototype can continue with its simulation instead.
 */
export const LoginView: React.FC<LoginViewProps> = ({ onSignIn, onSimulate, error, busy, mode, redirectTo }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!username || !password) return;
    await onSignIn(username, password);
  };

  const inputClass =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8 w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-sm shadow-blue-500/25">
            <Server className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-900">Sign in to BarePod</h1>
          <p className="text-xs text-slate-500">
            {mode === 'checking' ? 'Looking for the daemon…' : 'Enter your panel account.'}
          </p>
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="w-full px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>{busy ? 'Signing in…' : 'Sign in'}</span>
          </button>
        </form>

        <div className="pt-3 border-t border-slate-100 space-y-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            No account yet? Create one on the server:
            <code className="block mt-1 px-2 py-1 rounded bg-slate-900 text-slate-100 font-mono text-[11px]">
              barepod admin create --username &lt;you&gt;
            </code>
          </p>
          <button
            type="button"
            onClick={onSimulate}
            className="w-full px-4 py-2 text-xs font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Continue in simulation mode</span>
          </button>
          <p className="text-[10px] text-slate-400 text-center">
            Simulation mode uses the frontend's mock data and never touches a server.
          </p>
        </div>
      </div>
    </div>
  );
};
