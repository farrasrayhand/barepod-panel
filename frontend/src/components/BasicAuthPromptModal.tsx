import React, { useState } from 'react';
import { X, Lock, CheckCircle2, AlertCircle, Eye, EyeOff, ShieldCheck } from 'lucide-react';

interface BasicAuthPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  domain: string;
  expectedUser: string;
  expectedPass: string;
  realm?: string;
}

export const BasicAuthPromptModal: React.FC<BasicAuthPromptModalProps> = ({
  isOpen,
  onClose,
  domain,
  expectedUser,
  expectedPass,
  realm = 'Restricted Area - BarePod Protected',
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authStatus, setAuthStatus] = useState<'idle' | 'success' | 'failed'>('idle');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() === expectedUser.trim() && password === expectedPass) {
      setAuthStatus('success');
    } else {
      setAuthStatus('failed');
    }
  };

  const handleReset = () => {
    setUsername('');
    setPassword('');
    setAuthStatus('idle');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Simulated Browser OS Auth Dialog Header */}
        <div className="bg-slate-100 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-slate-800">
                Sign in to https://{domain}
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">
                HTTP Basic Authentication Challenge
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              handleReset();
              onClose();
            }}
            className="p-1 text-slate-400 hover:text-slate-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          <div className="p-3 bg-purple-50/70 rounded-xl border border-purple-200/80 text-xs text-purple-900 space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-purple-800">
              <ShieldCheck className="w-4 h-4 text-purple-600" />
              <span>Server Realm Message:</span>
            </div>
            <p className="font-mono text-[11px] text-purple-950 pl-5">
              "{realm}"
            </p>
            <p className="text-[10px] text-purple-700 pl-5 pt-0.5">
              Your connection to this server is secured with base64-encoded Authorization header credentials.
            </p>
          </div>

          {authStatus === 'success' ? (
            <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-200 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-emerald-900">
                  200 OK — Authentication Succeeded!
                </h4>
                <p className="text-xs text-emerald-700 mt-1">
                  Credentials valid. The web server accepted the <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono">Authorization: Basic ...</code> header.
                </p>
              </div>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition-colors"
              >
                Test Again
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {authStatus === 'failed' && (
                <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block">401 Unauthorized</strong>
                    <span>Username or password does not match the active .htpasswd configuration.</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (authStatus === 'failed') setAuthStatus('idle');
                  }}
                  placeholder="e.g. admin"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-purple-500 focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (authStatus === 'failed') setAuthStatus('idle');
                    }}
                    placeholder="Enter password"
                    className="w-full px-3 py-2 pr-9 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-purple-500 focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Quick Fill Test Helper */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setUsername(expectedUser);
                    setPassword(expectedPass);
                    setAuthStatus('idle');
                  }}
                  className="text-[11px] text-purple-600 hover:text-purple-800 font-semibold hover:underline"
                >
                  Autofill Saved Credentials
                </button>
                <span className="text-[10px] text-slate-400 font-mono">
                  User: {expectedUser || 'admin'}
                </span>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleReset();
                    onClose();
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all shadow-sm shadow-purple-500/25"
                >
                  Sign In (Test Auth)
                </button>
              </div>
            </form>
          )}

        </div>

      </div>
    </div>
  );
};
