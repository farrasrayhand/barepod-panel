import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  User,
  Mail,
  ShieldCheck,
  KeyRound,
  Monitor,
  Check,
  Smartphone,
  LogOut,
  Eye,
  EyeOff,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Trash2,
  GitBranch,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { PERMISSION_MATRIX } from '../data/permissions';
import { api, apiReachable } from '../api/client';
import { describeDevice, describeError, timeAgo } from '../utils/format';

import type { PanelUser, UserGitProvider } from '../api/client';

interface ProfileViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onNavigatePath?: (path: string) => void;
  currentUser?: PanelUser | null;
  permissions?: Record<string, boolean>;
}

interface SessionItem {
  id: string;
  device: string;
  ip: string;
  lastActive: string;
  current?: boolean;
}

// Shown only while no daemon answers.
const MOCK_SESSIONS: SessionItem[] = [
  { id: 's1', device: 'Chrome · macOS', ip: '103.147.154.82', lastActive: 'Active now', current: true },
  { id: 's2', device: 'Safari · iPhone', ip: '114.124.180.52', lastActive: '2 hours ago' },
  { id: 's3', device: 'CLI · barepod-mcp', ip: '45.33.32.156', lastActive: 'Yesterday' },
];

export const ProfileView: React.FC<ProfileViewProps> = ({ onShowToast, onNavigatePath, currentUser, permissions }) => {
  const [,setPasswordBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [sessions, setSessions] = useState<SessionItem[]>(MOCK_SESSIONS);
  const [sessionsLive, setSessionsLive] = useState<boolean | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  // Git Providers (GitHub PAT & Auto-Discovery)
  const [gitProviders, setGitProviders] = useState<UserGitProvider[]>([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [githubPat, setGithubPat] = useState('');
  const [gitConnecting, setGitConnecting] = useState(false);

  const loadGitProviders = useCallback(async () => {
    try {
      setGitLoading(true);
      const res = await api.userGitProviders();
      setGitProviders(res.items || []);
    } catch {
      // gracefully ignore if offline
    } finally {
      setGitLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGitProviders();
  }, [loadGitProviders]);

  const handleConnectGitHub = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = githubPat.trim();
    if (!token) return;
    try {
      setGitConnecting(true);
      const testRes = await api.testUserGitProvider({ provider: 'github', token });
      if (!testRes.valid) {
        onShowToast?.('Invalid GitHub Token', testRes.message || 'Authentication failed', 'error');
        return;
      }
      await api.createUserGitProvider({
        provider: 'github',
        name: `GitHub (@${testRes.username || 'user'})`,
        username: testRes.username,
        token,
      });
      setGithubPat('');
      onShowToast?.('GitHub Connected', `Connected as @${testRes.username}. Repositories are now auto-discovered!`, 'success');
      await loadGitProviders();
    } catch (err) {
      onShowToast?.('Connection failed', describeError(err), 'error');
    } finally {
      setGitConnecting(false);
    }
  };

  const handleDisconnectGit = async (id: string, name: string) => {
    try {
      await api.deleteUserGitProvider(id);
      onShowToast?.('Disconnected', `Removed ${name} connection.`, 'info');
      await loadGitProviders();
    } catch (err) {
      onShowToast?.('Disconnect failed', describeError(err), 'error');
    }
  };

  // --- Two-factor authentication (TOTP) ---
  // The daemon's TOTP endpoints are per account (requireAuth, not an admin capability), so every
  // user must be able to enrol from Profile. This card used to be a disabled placeholder, which is
  // why a regular account could not switch 2FA on even though Settings → Security could.
  const [totpLive, setTotpLive] = useState<boolean | null>(null);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpQr, setTotpQr] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [copiedTotp, setCopiedTotp] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const reachable = await apiReachable();
      if (!alive) return;
      setTotpLive(reachable);
      if (!reachable) return;
      try {
        const status = await api.totpStatus();
        if (alive) setTotpEnabled(status.enabled);
      } catch {
        // A status read that failed must not claim 2FA is off; the card says it is unavailable.
        if (alive) setTotpLive(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const startTotpSetup = async () => {
    setTotpBusy(true);
    try {
      const setup = await api.totpSetup();
      setTotpSetup(setup);
      setTotpCode('');
      try {
        setTotpQr(
          await QRCode.toDataURL(setup.otpauthUrl, {
            width: 200,
            margin: 2,
            color: { dark: '#0f172a', light: '#ffffff' },
          }),
        );
      } catch {
        setTotpQr('');
      }
    } catch (err) {
      onShowToast?.('Could not start 2FA setup', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmTotp = async () => {
    if (totpCode.length !== 6 || totpBusy) return;
    setTotpBusy(true);
    try {
      const res = await api.totpEnable(totpCode);
      setTotpEnabled(res.enabled);
      setTotpSetup(null);
      setTotpQr('');
      setTotpCode('');
      onShowToast?.('2FA enabled', 'Signing in now also needs a code from your authenticator.', 'success');
    } catch (err) {
      onShowToast?.('Could not enable 2FA', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const disableTotp = async () => {
    if (totpCode.length !== 6 || totpBusy) return;
    setTotpBusy(true);
    try {
      const res = await api.totpDisable(totpCode);
      setTotpEnabled(res.enabled);
      setTotpCode('');
      onShowToast?.('2FA disabled', 'This account signs in with its password only.', 'info');
    } catch (err) {
      onShowToast?.('Could not disable 2FA', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const copyTotpSecret = async () => {
    if (!totpSetup) return;
    try {
      await navigator.clipboard.writeText(totpSetup.secret);
      setCopiedTotp(true);
      setTimeout(() => setCopiedTotp(false), 1500);
    } catch {
      // Clipboard denied: the secret is on screen to type in.
    }
  };

  // Real sessions when the daemon answers, the prototype's list otherwise.
  const loadSessions = useCallback(async () => {
    const reachable = await apiReachable();
    setSessionsLive(reachable);
    if (!reachable) return;
    try {
      const { items, currentId } = await api.sessions();
      setSessions(
        items.map((row) => ({
          id: row.id,
          device: describeDevice(row.userAgent),
          ip: row.ip,
          lastActive: timeAgo(row.lastSeenAt),
          current: row.id === currentId,
        })),
      );
    } catch (err) {
      onShowToast?.('Could not load sessions', describeError(err), 'error');
    }
  }, [onShowToast]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const revokeSession = async (id: string, device: string) => {
    if (sessionsLive) {
      setSessionsBusy(true);
      try {
        await api.revokeSession(id);
        await loadSessions();
        onShowToast?.('Session revoked', `Signed out ${device}.`, 'info');
      } catch (err) {
        onShowToast?.('Could not revoke the session', describeError(err), 'error');
      } finally {
        setSessionsBusy(false);
      }
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    onShowToast?.('Session Revoked', `Signed out ${device}.`, 'info');
  };

  const [sessionPage, setSessionPage] = useState<number>(1);
  const SESSIONS_PER_PAGE = 8;

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return 0;
    });
  }, [sessions]);

  const totalSessionPages = Math.max(1, Math.ceil(sortedSessions.length / SESSIONS_PER_PAGE));
  const currentSessionPage = Math.min(sessionPage, totalSessionPages);
  const paginatedSessions = sortedSessions.slice(
    (currentSessionPage - 1) * SESSIONS_PER_PAGE,
    currentSessionPage * SESSIONS_PER_PAGE
  );

  const revokeAllOtherSessions = async () => {
    const otherSessions = sessions.filter((s) => !s.current);
    if (!otherSessions.length) return;
    if (!window.confirm(`Revoke all ${otherSessions.length} other session(s)? All other logged-in devices will be signed out.`)) return;

    setSessionsBusy(true);
    try {
      if (sessionsLive) {
        await Promise.allSettled(otherSessions.map((s) => api.revokeSession(s.id)));
        await loadSessions();
        onShowToast?.('Sessions Revoked', `Successfully revoked ${otherSessions.length} other session(s).`, 'success');
      } else {
        setSessions((prev) => prev.filter((s) => s.current));
        onShowToast?.('Sessions Revoked', 'Cleared all other sessions.', 'info');
      }
      setSessionPage(1);
    } catch (err) {
      onShowToast?.('Could not revoke sessions', describeError(err), 'error');
    } finally {
      setSessionsBusy(false);
    }
  };

  // This used to report "Your panel password has been changed." without calling anything —
  // it calls the daemon now, and a refusal is shown as the daemon worded it.
  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setPasswordBusy(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      onShowToast?.(
        'Password changed',
        result.signedOutEverywhere
          ? 'Your panel password is updated. Every session was signed out — reload to sign in again.'
          : 'Your panel password is updated.',
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not change the password', err instanceof Error ? err.message : 'The daemon refused.', 'error');
    } finally {
      setPasswordBusy(false);
    }
  };

  const username = currentUser?.username ?? 'farras';
  const email = currentUser?.email || `${username}@barepod.cloud`;
  const initials = username.slice(0, 2).toUpperCase();
  const isAdmin = currentUser?.role === 'admin';
  const roleLabel = isAdmin ? 'Root / Admin' : 'User';
  const groupLabel = currentUser?.groupName || (isAdmin ? 'Unlimited' : 'Basic');
  const homeDir = `/home/${username}`;

  const grantedPermissions = PERMISSION_MATRIX.filter((item) => {
    if (isAdmin) return true;
    return Boolean(permissions?.[item.key]);
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Profile &amp; Account</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your panel identity, credentials, sessions and permissions.</p>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-200 shrink-0 uppercase">
          {initials}
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-slate-900">{username}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${isAdmin ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
              {roleLabel}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" /> {email}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" /> Package: {groupLabel}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">{homeDir}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Password */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Change Password</h2>
          </div>
          <form onSubmit={updatePassword} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">New password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-9 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
            >
              Update Password
            </button>
          </form>
        </div>

        {/* Security */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Security</h2>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <span className="text-xs">
                <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-slate-500" /> Two-factor authentication (TOTP)
                </span>
                <span className="text-slate-500 block mt-0.5">
                  {totpLive === false
                    ? 'Requires a live daemon — this browser is not connected to one.'
                    : totpEnabled
                      ? 'Enabled — signing in also needs the current code from your authenticator.'
                      : 'Add a second step to sign-in with Google Authenticator, Authy, 1Password, or any TOTP app.'}
                </span>
              </span>
              <span
                className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  totpEnabled
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}
              >
                {totpEnabled ? 'Enabled' : 'Off'}
              </span>
            </div>

            {totpSetup ? (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-center gap-3 p-3 rounded-lg bg-white border border-slate-200">
                  {totpQr ? (
                    <img
                      src={totpQr}
                      alt="2FA TOTP QR code"
                      className="w-32 h-32 rounded-lg border border-slate-200 bg-white"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 text-center px-2">
                      QR unavailable — use the secret
                    </div>
                  )}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <p className="text-[11px] text-slate-600">
                      Scan the QR code, or enter this secret manually:
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2 py-1.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] break-all select-all">
                        {totpSetup.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyTotpSecret()}
                        className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shrink-0 cursor-pointer transition"
                      >
                        {copiedTotp ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="123456"
                    className="w-32 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono tracking-[0.25em] text-center font-bold text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => void confirmTotp()}
                    disabled={totpCode.length !== 6 || totpBusy}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg cursor-pointer transition shadow-xs flex items-center gap-1.5"
                  >
                    {totpBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Confirm &amp; enable 2FA</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTotpSetup(null);
                      setTotpQr('');
                      setTotpCode('');
                    }}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : totpEnabled ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Code to disable"
                  className="w-36 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono tracking-[0.2em]"
                />
                <button
                  type="button"
                  onClick={() => void disableTotp()}
                  disabled={totpCode.length !== 6 || totpBusy}
                  className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-40 rounded-lg cursor-pointer"
                >
                  {totpBusy ? 'Disabling…' : 'Disable 2FA'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void startTotpSetup()}
                disabled={totpLive !== true || totpBusy}
                className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg cursor-pointer flex items-center gap-1.5"
              >
                {totpBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{totpBusy ? 'Starting…' : 'Set up 2FA'}</span>
              </button>
            )}
          </div>

          <button
            onClick={() => onNavigatePath?.('/api')}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" /> API Tokens &amp; MCP
            </span>
            <span className="text-[10px] font-mono text-slate-400">2 active</span>
          </button>
        </div>
      </div>

      {/* Connected Git Accounts (GitHub PAT) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Connected Git Accounts</h2>
            <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
              CI/CD &amp; Auto-Deploy
            </span>
          </div>
          {gitLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>

        <p className="text-xs text-slate-500">
          Connect your GitHub Personal Access Token (PAT) once. BarePod will auto-discover your repositories and branches in the Add Website wizard and enable zero-config auto-deploy.
        </p>

        {gitProviders.length > 0 ? (
          <div className="space-y-3">
            {gitProviders.map((gp) => (
              <div
                key={gp.id}
                className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 bg-slate-50/70"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                    GH
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800">{gp.name}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Connected
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Auto-discovery enabled · Added {timeAgo(gp.createdAt)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleDisconnectGit(gp.id, gp.name)}
                  className="px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        ) : (
          <form onSubmit={handleConnectGitHub} className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">GitHub Personal Access Token (classic or fine-grained)</label>
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,read:user,admin:repo_hook&description=BarePod+Panel"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
                >
                  Generate Token <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx or github_pat_..."
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                  required
                />
                <button
                  type="submit"
                  disabled={gitConnecting || !githubPat.trim()}
                  className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  {gitConnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
                  <span>Connect GitHub</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">
                Token is securely stored in BarePod Vault using AES-256-GCM encryption and is never returned in plaintext.
              </p>
            </div>
          </form>
        )}
      </div>

      {/* Active sessions */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-bold text-slate-900">Active Sessions</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
              {sessions.length}
            </span>
            {sessionsLive === true && (
              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">Live</span>
            )}
            {sessionsLive === false && (
              <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
                Simulation (mock data)
              </span>
            )}
            {sessionsBusy && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
          </div>

          {sessions.filter((s) => !s.current).length > 0 && (
            <button
              onClick={revokeAllOtherSessions}
              disabled={sessionsBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Revoke Other Sessions ({sessions.filter((s) => !s.current).length})</span>
            </button>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {paginatedSessions.map((session) => (
            <div key={session.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors">
              <div className="text-xs min-w-0">
                <span className="font-semibold text-slate-800 flex items-center gap-2">
                  {session.device}
                  {session.current && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">This device</span>
                  )}
                </span>
                <span className="text-slate-400 font-mono text-[11px]">{session.ip} · {session.lastActive}</span>
              </div>
              {session.current ? (
                <span className="text-[10px] text-slate-400 font-medium px-2">—</span>
              ) : (
                <button
                  onClick={() => revokeSession(session.id, session.device)}
                  disabled={sessionsBusy}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <LogOut className="w-3 h-3" /> Revoke
                </button>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="px-5 py-6 text-center text-xs text-slate-400">No other active sessions.</div>
          )}
        </div>

        {/* Pagination Controls */}
        {totalSessionPages > 1 && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-500 font-medium">
              Showing <strong className="text-slate-800">{(currentSessionPage - 1) * SESSIONS_PER_PAGE + 1}</strong>–<strong className="text-slate-800">{Math.min(currentSessionPage * SESSIONS_PER_PAGE, sortedSessions.length)}</strong> of <strong className="text-slate-800">{sortedSessions.length}</strong> sessions
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
                disabled={currentSessionPage <= 1}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Prev</span>
              </button>
              <span className="text-[11px] font-mono text-slate-600 px-1.5">
                {currentSessionPage} / {totalSessionPages}
              </span>
              <button
                onClick={() => setSessionPage((p) => Math.min(totalSessionPages, p + 1))}
                disabled={currentSessionPage >= totalSessionPages}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Permissions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-bold text-slate-900">Effective Permissions</h2>
          <span className="text-[10px] font-mono text-slate-400">
            {grantedPermissions.length}/{PERMISSION_MATRIX.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {grantedPermissions.map((item) => (
            <span
              key={item.key}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-semibold"
            >
              <Check className="w-3 h-3" /> {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
