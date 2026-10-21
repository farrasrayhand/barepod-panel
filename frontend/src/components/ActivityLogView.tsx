import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search, ShieldCheck, User, Filter } from 'lucide-react';
import { api, type AuditEntry } from '../api/client';
import { describeAudit, timeAgo } from '../utils/format';

interface ActivityLogViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

const LIMITS = [100, 250, 500];

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({ onShowToast }) => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [everything, setEverything] = useState(false);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(250);
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('all');

  const load = useCallback(async (nextLimit = limit) => {
    setLoading(true);
    try {
      const res = await api.audit(nextLimit);
      setEntries(res.items || []);
      setEverything(Boolean(res.everything));
    } catch (err) {
      onShowToast?.('Could not load activity', err instanceof Error ? err.message : 'Request failed', 'error');
    } finally {
      setLoading(false);
    }
  }, [limit, onShowToast]);

  useEffect(() => {
    void load(limit);
  }, [load, limit]);

  const actions = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.action))).sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (action !== 'all' && entry.action !== action) return false;
      if (!q) return true;
      return [entry.action, entry.target, entry.detail, entry.ip, entry.username, entry.userId]
        .some((value) => (value || '').toLowerCase().includes(q));
    });
  }, [entries, action, query]);

  const level = (entry: AuditEntry) => {
    if (entry.action === 'system.capacity_exceeded' || /delete|revoke|refused|failed/.test(entry.action)) {
      return 'bg-rose-50 text-rose-700 border-rose-200';
    }
    if (/stop|restart|update|save|create|add/.test(entry.action)) {
      return 'bg-amber-50 text-amber-700 border-amber-200';
    }
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            Activity Log
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {everything
              ? 'Every account on this panel, newest first.'
              : 'Only activity from your own account, newest first.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold border border-slate-200 bg-white text-slate-600">
            {everything ? <ShieldCheck className="w-3.5 h-3.5 text-blue-600" /> : <User className="w-3.5 h-3.5 text-slate-500" />}
            {everything ? 'Admin scope' : 'Your account only'}
          </span>
          <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-mono border border-slate-200 bg-white text-slate-500">
            {visible.length} / {entries.length} events
          </span>
          <button
            type="button"
            onClick={() => void load(limit)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search action, target, user, IP, or detail..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
              className="px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-hidden focus:border-blue-500 max-w-56"
            >
              <option value="all">All actions</option>
              {actions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className="px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-hidden focus:border-blue-500"
            >
              {LIMITS.map((value) => <option key={value} value={value}>Newest {value}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading activity…
          </div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center">
            <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-semibold text-slate-600">No activity matches this filter.</p>
            <p className="text-[11px] text-slate-400 mt-1">New actions appear here as soon as they are audited.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">When</th>
                  {everything && <th className="px-4 py-3 font-semibold">User</th>}
                  <th className="px-4 py-3 font-semibold">Activity</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70 align-top">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono text-[11px] text-slate-700">{new Date(entry.at).toLocaleString()}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{timeAgo(entry.at)}</div>
                    </td>
                    {everything && (
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                          <User className="w-3 h-3 text-slate-400" />
                          {entry.username || 'system'}
                        </span>
                      </td>
                    )}
                    <td className="px-4 py-3 max-w-[28rem]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-mono font-bold ${level(entry)}`}>
                          {entry.action}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        {describeAudit(entry.action, entry.target || '', entry.detail || '', entry.username || '')}
                      </p>
                      {entry.detail && (
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5 break-all">{entry.detail}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">{entry.target || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px] whitespace-nowrap">{entry.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400 flex items-center justify-between">
          <span>Showing {visible.length} of {entries.length} loaded entries.</span>
          <span>Entries are immutable and retained in the panel database.</span>
        </div>
      </div>
    </div>
  );
};
