import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  RefreshCw,
  Loader2,
  Ban,
  Check,
  X,
  Save,
} from 'lucide-react';
import { api, type GuardStatus, type GuardBan } from '../api/client';

type Toast = (title: string, message: string, kind?: 'success' | 'error' | 'info') => void;

/**
 * The sources as a person reads them. On the panel's own Security page a bare list of engine names
 * read as if it belonged to the database screen — and the panel's own door belongs in that list too,
 * because it is watched the same way.
 */
const engineLabel: Record<string, string> = {
  postgresql: 'PostgreSQL',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  panel: "the panel's own login",
};

/** The ban time left, as something a person can read at a glance. */
function remaining(expiresAt: string): string {
  const left = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(left) || left <= 0) return 'expired';
  const minutes = Math.floor(left / 60000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m left`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
}

/**
 * The brute-force lockout, as the daemon really runs it: the numbers it decides with, the
 * addresses it is keeping out of the database engines, and whether it can enforce a ban at
 * all. Nothing here is simulated — the bans live in the host's own nftables set, and the
 * screen says which engine's log it is reading and which it is not.
 */
export function GuardCard({
  onShowToast,
  variant = 'full',
}: {
  onShowToast?: Toast;
  /**
   * 'full' is the settings screen, where the numbers live. 'bans' is for a record's own Security
   * tab: the same global settings repeated per database and per cache was duplication, and the
   * thresholds belong in one place — the panel's Settings → Security. What a record's tab can
   * usefully show is who has been kept out, and that is what it keeps.
   */
  variant?: 'full' | 'bans';
}) {
  const [status, setStatus] = useState<GuardStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyIP, setBusyIP] = useState('');
  const [confirming, setConfirming] = useState('');
  const [form, setForm] = useState({ maxRetry: '', findTime: '', banTime: '' });

  const load = useCallback(async () => {
    try {
      const next = await api.guard();
      setStatus(next);
      setForm({ maxRetry: String(next.maxRetry), findTime: next.findTime, banTime: next.banTime });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'the lockout could not be read');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // The card is about something happening now, so it keeps up with it.
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.saveGuardSettings({
        maxRetry: Number(form.maxRetry) || undefined,
        findTime: form.findTime || undefined,
        banTime: form.banTime || undefined,
      });
      setStatus(next);
      onShowToast?.('Lockout updated', 'The new numbers are used on the next check.', 'success');
    } catch (err) {
      onShowToast?.('Could not save', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setSaving(false);
    }
  };

  const unban = async (ip: string) => {
    setBusyIP(ip);
    try {
      setStatus(await api.unban(ip));
      setConfirming('');
      onShowToast?.('Released', `${ip} may connect again. The release was audited.`, 'success');
    } catch (err) {
      onShowToast?.('Could not release', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setBusyIP('');
    }
  };

  const enforcing = status?.enforcing === true;
  const enabled = status?.enabled === true;
  const tone = enforcing
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : enabled
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-slate-600 bg-slate-100 border-slate-200';
  const Icon = enforcing ? ShieldCheck : enabled ? ShieldAlert : ShieldOff;
  const label = loading
    ? 'Reading…'
    : enforcing
      ? 'Enforcing'
      : enabled
        ? 'Not enforcing'
        : 'Disabled';

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-5 py-4 border-b border-slate-200">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-xl border ${tone}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Brute-Force Guard</h2>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${tone}`}>{label}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {enforcing && status
                ? `Bans are dropped by the kernel in table inet ${status.table}, set ${status.set} · checked every ${status.interval}`
                : status?.reason || 'Failed logins are counted from the database engines’ own logs.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors self-start"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="px-5 py-3 text-xs text-rose-700 bg-rose-50 border-b border-rose-200">{error}</div>
      )}

      {/* The numbers the lockout decides with — only where they can be changed. In a record's own
          tab they were the same global settings repeated per database and per cache, which is why
          they live in one place now, and this says where that is rather than showing dead inputs. */}
      {variant === 'full' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 px-5 py-4 border-b border-slate-200">
            {[
              { key: 'maxRetry' as const, label: 'Failed logins allowed', hint: '1 – 100' },
              { key: 'findTime' as const, label: 'Within', hint: '10s – 24h, e.g. 10m' },
              { key: 'banTime' as const, label: 'Kept out for', hint: '1m – 720h, e.g. 1h' },
            ].map((field) => (
              <label key={field.key} className="block">
                <span className="block text-[11px] font-bold text-slate-600 uppercase tracking-wide">{field.label}</span>
                <input
                  value={form[field.key]}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                />
                <span className="block text-[11px] text-slate-400 mt-1">{field.hint}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50/50">
            <p className="text-[11px] text-slate-500">
              {Object.entries(status?.sources || {}).length === 0
                ? 'No login has been read yet.'
                : `Reading refused logins from ${Object.keys(status?.sources || {})
                    .map((engine) => engineLabel[engine] ?? engine)
                    .join(', ')}.` +
                  Object.entries(status?.sources || {})
                    .filter(([, note]) => note)
                    .map(([engine, note]) => ` ${engineLabel[engine] ?? engine}: ${note}.`)
                    .join('')}
            </p>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !status}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl shadow-sm shadow-blue-500/25 transition-all"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{saving ? 'Saving…' : 'Save'}</span>
            </button>
          </div>
        </>
      ) : (
        <p className="px-5 py-3 text-[11px] text-slate-500 border-b border-slate-200 bg-slate-50/50">
          {status
            ? `${status.maxRetry} failed logins within ${status.findTime} keep an address out for ${status.banTime}. The numbers are panel-wide — change them in Panel Settings → Security.`
            : 'Reading the lockout…'}
        </p>
      )}

      {/* What is actually being kept out. */}
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-2">
          <Ban className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-bold text-slate-700">
            Blocked addresses {status ? `(${status.bans.length})` : ''}
          </span>
        </div>
        {status && status.bans.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-bold">Address</th>
                  <th className="py-2 pr-3 font-bold">Engine</th>
                  <th className="py-2 pr-3 font-bold">Reason</th>
                  <th className="py-2 pr-3 font-bold">Time left</th>
                  <th className="py-2 font-bold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {status.bans.map((ban: GuardBan) => (
                  <tr key={ban.ip} className="border-t border-slate-100">
                    <td className="py-2 pr-3 font-mono font-semibold text-slate-800">{ban.ip}</td>
                    <td className="py-2 pr-3 text-slate-600">
                      {ban.engine || '—'}
                      {ban.user ? <span className="text-slate-400"> · {ban.user}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{ban.reason || `${ban.count} refusals`}</td>
                    <td className="py-2 pr-3 text-slate-600">{remaining(ban.expiresAt)}</td>
                    <td className="py-2 text-right">
                      {confirming === ban.ip ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-slate-500">Release?</span>
                          <button
                            type="button"
                            onClick={() => void unban(ban.ip)}
                            disabled={busyIP === ban.ip}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50"
                          >
                            {busyIP === ban.ip ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirming('')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold text-slate-600 bg-slate-100 hover:bg-slate-200"
                          >
                            <X className="w-3 h-3" />
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(ban.ip)}
                          className="px-2.5 py-1 rounded-lg font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                        >
                          Unban
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            Nothing is being kept out. Failed logins are counted per address and a ban lands here —
            in the panel and in the host's firewall — once the same address fails often enough
            inside the window.
          </p>
        )}
        {status?.lastError ? (
          <p className="mt-2 text-[11px] text-amber-700">Last check reported: {status.lastError}</p>
        ) : null}
      </div>
    </div>
  );
}
