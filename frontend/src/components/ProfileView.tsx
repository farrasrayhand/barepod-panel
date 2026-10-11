import React, { useCallback, useEffect, useState } from 'react';
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
} from 'lucide-react';
import { PERMISSION_MATRIX } from '../data/permissions';
import { api, apiReachable } from '../api/client';
import { describeDevice, describeError, timeAgo } from '../utils/format';

interface ProfileViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onNavigatePath?: (path: string) => void;
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

export const ProfileView: React.FC<ProfileViewProps> = ({ onShowToast, onNavigatePath }) => {
  const [twoFactor, setTwoFactor] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const [sessions, setSessions] = useState<SessionItem[]>(MOCK_SESSIONS);
  const [sessionsLive, setSessionsLive] = useState<boolean | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);

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

  const updatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) return;
    setCurrentPassword('');
    setNewPassword('');
    onShowToast?.('Password Updated', 'Your panel password has been changed.', 'success');
  };

  const grantedPermissions = PERMISSION_MATRIX.filter((item) => item.key !== 'users' || true);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Profile &amp; Account</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your panel identity, credentials, sessions and permissions.</p>
      </div>

      {/* Identity */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-lg border border-blue-200 shrink-0">
          FR
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-slate-900">farras</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">Root / Admin</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">Active</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" /> farras@barepod.cloud
            </span>
            <span className="inline-flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" /> Tenant group: Superadmin (Root)
            </span>
          </div>
          <p className="text-[11px] text-slate-400 font-mono">/home/farras · member since 2026-09-22</p>
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

          <label className="flex items-start justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/60 cursor-pointer">
            <span className="text-xs">
              <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-slate-500" /> Two-factor authentication (TOTP)
              </span>
              <span className="text-slate-500 block mt-0.5">Require a 6-digit code from an authenticator app at sign-in.</span>
            </span>
            <input
              type="checkbox"
              checked={twoFactor}
              onChange={(e) => {
                setTwoFactor(e.target.checked);
                onShowToast?.(
                  e.target.checked ? '2FA Enabled' : '2FA Disabled',
                  e.target.checked ? 'Scan the QR code in your authenticator app.' : 'Two-factor authentication turned off.',
                  e.target.checked ? 'success' : 'info',
                );
              }}
              className="mt-0.5 w-4 h-4 rounded text-blue-600 border-slate-300"
            />
          </label>

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

      {/* Active sessions */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Monitor className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-bold text-slate-900">Active Sessions</h2>
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
        <div className="divide-y divide-slate-100">
          {sessions.map((session) => (
            <div key={session.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="text-xs min-w-0">
                <span className="font-semibold text-slate-800 flex items-center gap-2">
                  {session.device}
                  {session.current && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">This device</span>
                  )}
                </span>
                <span className="text-slate-400 font-mono text-[11px]">{session.ip} · {session.lastActive}</span>
              </div>
              {session.current ? (
                <span className="text-[10px] text-slate-400">—</span>
              ) : (
                <button
                  onClick={() => revokeSession(session.id, session.device)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
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
