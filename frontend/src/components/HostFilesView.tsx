import React, { useEffect, useState } from 'react';
import { Server, Home, ShieldCheck, Loader2, TriangleAlert, RefreshCw } from 'lucide-react';
import { api, apiReachable, type TenantRow } from '../api/client';
import { describeError } from '../utils/format';
import { FileManagerModal } from './FileManagerModal';

type ScopeKind = 'host' | 'tenant';

interface HostFilesViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  isAdmin?: boolean;
  currentUser?: { username: string; role?: string } | null;
}

/**
 * The file browser.
 * For administrators: spans the entire host and every tenant home.
 * For regular users: strictly jailed to /home/<username>.
 */
export const HostFilesView: React.FC<HostFilesViewProps> = ({ 
  onShowToast, 
  isAdmin = false,
  currentUser 
}) => {
  const effectiveScope: ScopeKind = isAdmin ? 'host' : 'tenant';
  const effectiveTenant = isAdmin ? '' : (currentUser?.username || '');

  const [scope, setScope] = useState<ScopeKind>(effectiveScope);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [tenant, setTenant] = useState(effectiveTenant);
  const [root, setRoot] = useState('');
  const [live, setLive] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await apiReachable();
      if (cancelled) return;
      setLive(reachable);
      if (!reachable) return;
      try {
        if (isAdmin) {
          const result = await api.tenants();
          if (cancelled) return;
          setTenants(result.items);
          setRoot(result.root);
          setTenant((previous) => previous || result.items[0]?.username || '');
        } else {
          setScope('tenant');
          setTenant(currentUser?.username || '');
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, isAdmin, currentUser?.username]);

  const selected = tenants.find((item) => item.username === tenant);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {isAdmin ? 'Host Files' : 'File Manager'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isAdmin 
              ? 'Every file on the machine, including the space websites are not using. System paths stay read-only.'
              : `Manage your isolated home files at /home/${tenant || currentUser?.username}. Securely jailed to your account.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((value) => value + 1)}
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Scope selector for Admins, Jail Info for Regular Users */}
      {isAdmin ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setScope('host')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                scope === 'host'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Host root</span>
              <span className="font-mono text-[10px] opacity-70">/</span>
            </button>

            <button
              onClick={() => setScope('tenant')}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer transition-colors ${
                scope === 'tenant'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Home className="w-3.5 h-3.5" />
              <span>Tenant home</span>
              <span className="font-mono text-[10px] opacity-70">{root || '/home'}</span>
            </button>

            {scope === 'tenant' && (
              <select
                value={tenant}
                onChange={(event) => setTenant(event.target.value)}
                className="px-3 py-2 text-xs border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:border-blue-400"
              >
                {tenants.length === 0 && <option value="">No accounts</option>}
                {tenants.map((item) => (
                  <option key={item.username} value={item.username}>
                    {item.username}
                    {item.exists ? '' : ' (no home yet)'}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-start gap-2 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <p>
              You can read anything here. Writes, renames and deletes are refused for the system trees
              (<code className="font-mono">/etc</code>, <code className="font-mono">/usr</code>,{' '}
              <code className="font-mono">/boot</code>, <code className="font-mono">/var/lib</code>,{' '}
              <code className="font-mono">/proc</code>, <code className="font-mono">/sys</code>, …) and for the panel's
              own data, and every attempt is recorded in the activity log.
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              <Home className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-900 font-mono">/home/{tenant || currentUser?.username}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  User Jail Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Full read/write control over your home files, website code, and uploads.
              </p>
            </div>
          </div>
        </div>
      )}

      {live === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-xs flex items-start gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            No daemon is answering, so this screen has nothing real to show. Start it (`barepod serve`) and refresh —
            the panel never invents files.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-xs flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {live === true && isAdmin && scope === 'tenant' && tenants.length > 0 && !selected?.exists && (
        <div className="bg-slate-50 border border-slate-200 text-slate-600 rounded-xl p-4 text-xs">
          <code className="font-mono">{tenant}</code> has no home directory yet — it appears after the account owns a
          website.
        </div>
      )}

      {live === true && (isAdmin ? (scope === 'host' || (tenant && selected?.exists)) : Boolean(tenant)) && (
        <FileManagerModal
          key={`${scope}-${tenant}`}
          isOpen
          inline
          app={null}
          onClose={() => {}}
          scope={scope}
          tenant={scope === 'tenant' ? tenant : ''}
        />
      )}

      {live === null && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
          Looking for the daemon…
        </div>
      )}
    </div>
  );
};
