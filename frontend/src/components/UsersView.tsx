import React, { useEffect, useState } from 'react';
import {
  Users,
  Plus,
  ShieldCheck,
  HardDrive,
  Layers,
  Terminal,
  Trash2,
  Database,
  Crown,
  CheckCircle2,
  XCircle,
  Pencil,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useSubRoute } from '../hooks/useSubRoute';
import { PERMISSION_MATRIX } from '../data/permissions';
import { AddUserModal } from './AddUserModal';
import { CreateGroupModal } from './CreateGroupModal';
import { DangerConfirmModal } from './DangerConfirmModal';
import {
  api,
  apiReachable,
  type ApiUser,
  type CreateUserPayload,
  type GroupPayload,
  type GroupRow,
  type UpdateUserPayload,
} from '../api/client';
import { describeError } from '../utils/format';

interface UsersViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
  /** The signed-in account — it may not change its own status or delete itself. */
  currentUsername?: string;
}

// The prototype's rows, kept only for when no daemon answers. Same shape as the API
// returns, so the tables render identically either way.
const MOCK_GROUPS: GroupRow[] = [
  {
    id: 'g-1',
    name: 'Starter Client',
    description: 'Single website package for small business landing pages',
    permissions: { deployApps: true, fileManager: true, terminal: false, databases: true, backups: false, domains: false, cloudflareTunnels: false, monitoring: false, users: false, apiTokens: false },
    limits: { cpuQuotaPercent: 100, memoryMb: 512, tasksMax: 128, diskQuotaGb: 2, inodeQuota: 0, maxSites: 1, maxDatabases: 1 },
    members: 1,
    isDefault: false,
    isSystem: false,
  },
  {
    id: 'g-2',
    name: 'Developer Pro',
    description: 'Multi-site development package with CLI terminal access',
    permissions: { deployApps: true, fileManager: true, terminal: true, databases: true, backups: true, domains: true, cloudflareTunnels: true, monitoring: true, users: false, apiTokens: true },
    limits: { cpuQuotaPercent: 200, memoryMb: 2048, tasksMax: 512, diskQuotaGb: 10, inodeQuota: 0, maxSites: 5, maxDatabases: 5 },
    members: 1,
    isDefault: false,
    isSystem: false,
  },
  {
    id: 'g-3',
    name: 'Superadmin (Root)',
    description: 'Built-in root package — unlimited resources',
    permissions: { deployApps: true, fileManager: true, terminal: true, databases: true, backups: true, domains: true, cloudflareTunnels: true, monitoring: true, users: true, apiTokens: true },
    limits: { cpuQuotaPercent: 0, memoryMb: 0, tasksMax: 0, diskQuotaGb: 0, inodeQuota: 0, maxSites: 0, maxDatabases: 0 },
    members: 1,
    isDefault: true,
    isSystem: true,
  },
];

const MOCK_USERS: ApiUser[] = [
  { id: 'u-1', username: 'farras', email: 'farras@barepod.cloud', role: 'admin', groupName: 'Superadmin (Root)', status: 'active', createdAt: '', home: '/home/farras', osExists: true, sites: { used: 2, max: 0 }, databases: { used: 3, max: 0 } },
  { id: 'u-2', username: 'tenant_alex', email: 'alex@clientdomain.com', role: 'user', groupName: 'Starter Client', status: 'active', createdAt: '', home: '/home/tenant_alex', osExists: true, sites: { used: 1, max: 1 }, databases: { used: 1, max: 1 } },
  { id: 'u-3', username: 'tenant_clientB', email: 'team@agencypartner.id', role: 'user', groupName: 'Developer Pro', status: 'active', createdAt: '', home: '/home/tenant_clientB', osExists: true, sites: { used: 1, max: 5 }, databases: { used: 2, max: 5 } },
];

const fmtCount = (n: number): string => (n > 0 ? String(n) : 'Unlimited');
const fmtGb = (gb: number): string => (gb > 0 ? `${gb} GB` : 'Unlimited');
const fmtMb = (mb: number): string => (mb <= 0 ? 'Unlimited' : mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);
const fmtCpu = (pct: number): string => (pct <= 0 ? 'Unlimited' : `${pct}%`);
const permCount = (p?: Record<string, boolean>): number => (p ? Object.values(p).filter(Boolean).length : 0);

export const UsersView: React.FC<UsersViewProps> = ({ onShowToast, onOpenTerminal, currentUsername }) => {
  const selfUsername = currentUsername ?? 'farras';
  const [activeTab, setActiveTab] = useSubRoute<'users' | 'groups'>('users');

  const [live, setLive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [users, setUsers] = useState<ApiUser[]>(MOCK_USERS);
  const [groups, setGroups] = useState<GroupRow[]>(MOCK_GROUPS);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ApiUser | null>(null);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'user' | 'group'; id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await apiReachable();
      if (cancelled) return;
      setLive(reachable);
      if (!reachable) return;
      setLoading(true);
      try {
        const [userList, groupList] = await Promise.all([api.users(), api.groups()]);
        if (cancelled) return;
        setUsers(userList.items ?? []);
        setGroups(groupList.items ?? []);
      } catch (err) {
        if (!cancelled) onShowToast?.('Could not load the tenants', describeError(err), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, onShowToast]);

  const reload = () => setReloadKey((k) => k + 1);
  const groupByName = (name: string) => groups.find((g) => g.name === name);

  const createUser = async (payload: CreateUserPayload) => {
    if (!live) {
      setUsers((prev) => [...prev, { id: `u-${Date.now()}`, username: payload.username, email: payload.email ?? '', role: payload.groupName === 'Superadmin (Root)' ? 'admin' : 'user', groupName: payload.groupName, status: 'active', createdAt: '', home: `/home/${payload.username}`, osExists: false, sites: { used: 0, max: groupByName(payload.groupName)?.limits?.maxSites ?? 0 }, databases: { used: 0, max: groupByName(payload.groupName)?.limits?.maxDatabases ?? 0 } }]);
      onShowToast?.('User Created', `Account ${payload.username} created (simulation).`, 'success');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createUser(payload);
      onShowToast?.(
        'Account created',
        created.password
          ? `Password for ${created.username}: ${created.password} — shown once, copy it now.`
          : `Account ${created.username} created and its Linux account provisioned.`,
        'success',
      );
      reload();
    } catch (err) {
      onShowToast?.('Could not create the account', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const updateUser = async (id: string, payload: UpdateUserPayload) => {
    if (!live) {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...payload } : u)));
      onShowToast?.('User Updated', 'Account updated (simulation).', 'success');
      return;
    }
    setBusy(true);
    try {
      const updated = await api.updateUser(id, payload);
      onShowToast?.('Account updated', `${updated.username} updated.`, 'success');
      reload();
    } catch (err) {
      onShowToast?.('Could not update the account', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitGroup = async (payload: GroupPayload) => {
    if (!live) {
      if (editingGroup) {
        setGroups((prev) => prev.map((g) => (g.name === payload.name ? { ...g, description: payload.description ?? g.description, permissions: payload.permissions ?? g.permissions, limits: { ...g.limits, ...(payload.limits ?? {}) } } : g)));
        onShowToast?.('Group Updated', `${payload.name} updated (simulation).`, 'success');
      } else {
        setGroups((prev) => [...prev, { id: `g-${Date.now()}`, name: payload.name, description: payload.description ?? '', permissions: payload.permissions ?? {}, limits: payload.limits ?? {}, members: 0, isDefault: false, isSystem: false }]);
        onShowToast?.('Group Created', `Package ${payload.name} created (simulation).`, 'success');
      }
      return;
    }
    setBusy(true);
    try {
      if (editingGroup) {
        await api.updateGroup(payload.name, { description: payload.description, permissions: payload.permissions, limits: payload.limits });
        onShowToast?.('Package updated', `${payload.name} updated.`, 'success');
      } else {
        await api.createGroup(payload);
        onShowToast?.('Package created', `${payload.name} created.`, 'success');
      }
      reload();
    } catch (err) {
      onShowToast?.('Could not save the package', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    const { kind, id, name } = pendingDelete;
    if (!live) {
      if (kind === 'user') setUsers((prev) => prev.filter((u) => u.id !== id));
      else setGroups((prev) => prev.filter((g) => g.id !== id));
      onShowToast?.(kind === 'user' ? 'Tenant Removed' : 'Group Deleted', `${name} removed (simulation).`, 'info');
      return;
    }
    setBusy(true);
    try {
      if (kind === 'user') await api.deleteUser(id);
      else await api.deleteGroup(name);
      onShowToast?.(kind === 'user' ? 'Tenant Removed' : 'Group Deleted', `${name} removed.`, 'success');
      reload();
    } catch (err) {
      onShowToast?.('Could not delete', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tenants & User Groups</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> cgroups v2 Quotas
            </span>
            {live === true && (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">Live</span>
            )}
            {live === false && (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">Simulation (mock data)</span>
            )}
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Admin accounts have unlimited privileges, while regular users are governed by configurable resource limit packages
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={reload}
            disabled={live !== true}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40"
            title="Reload from the daemon"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {activeTab === 'users' ? (
            <button
              onClick={() => { setEditingUser(null); setIsAddUserOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25"
            >
              <Plus className="w-4 h-4" />
              <span>Add Tenant User</span>
            </button>
          ) : (
            <button
              onClick={() => { setEditingGroup(null); setIsGroupModalOpen(true); }}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25"
            >
              <Plus className="w-4 h-4" />
              <span>Create Limit Group</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'users' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          User Accounts ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'groups' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Resource Groups / Packages ({groups.length})
        </button>
      </div>

      {/* TAB 1: USER ACCOUNTS TABLE */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="py-3.5 px-4">Username & Home</th>
                <th className="py-3.5 px-4">Role & Package</th>
                <th className="py-3.5 px-4">Sites Allowed</th>
                <th className="py-3.5 px-4">Disk Quota</th>
                <th className="py-3.5 px-4">Databases</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((t) => {
                const isAdmin = t.role === 'admin';
                const group = groupByName(t.groupName);
                return (
                  <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-full font-bold flex items-center justify-center text-xs ${
                          isAdmin ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {isAdmin ? <Crown className="w-4 h-4 text-purple-600" /> : t.username.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900 text-sm">{t.username}</span>
                            {isAdmin && (
                              <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.2 rounded">Root</span>
                            )}
                            {live === true && !t.osExists && (
                              <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded" title="No Linux account exists yet">No OS user</span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">{t.home || `/home/${t.username}`}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${
                        isAdmin ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
                      }`}>
                        {t.groupName}
                      </span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                        <Layers className="w-3.5 h-3.5 text-slate-400" />
                        <span>{t.sites.used} / <strong className={isAdmin ? 'text-purple-600' : ''}>{fmtCount(t.sites.max)}</strong> Sites</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700" title="Usage is not measured here; the quota is what the package applies.">
                        <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                        <span>— / <strong className={isAdmin ? 'text-purple-600' : ''}>{fmtGb(group?.limits?.diskQuotaGb ?? 0)}</strong></span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Database className="w-3.5 h-3.5 text-slate-400" />
                        <span>{t.databases.used} / <strong className={isAdmin ? 'text-purple-600' : ''}>{fmtCount(t.databases.max)}</strong> DBs</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {t.status === 'suspended' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Suspended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => { setEditingUser(t); setIsAddUserOpen(true); }}
                          className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                          title="Edit User"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={onOpenTerminal}
                          className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                          title="Open Terminal Session"
                        >
                          <Terminal className="w-4 h-4" />
                        </button>
                        {t.username !== selfUsername && (
                          <button
                            onClick={() => setPendingDelete({ kind: 'user', id: t.id, name: t.username })}
                            className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: GROUPS & RESOURCE LIMITS TABLE */}
      {activeTab === 'groups' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="py-3.5 px-4">Group Name</th>
                <th className="py-3.5 px-4">Max Sites</th>
                <th className="py-3.5 px-4">Disk Quota</th>
                <th className="py-3.5 px-4">Max Databases</th>
                <th className="py-3.5 px-4">RAM / CPU Limit</th>
                <th className="py-3.5 px-4">Access Permissions</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4">
                    <div>
                      <span className="font-semibold text-slate-900 text-sm flex items-center gap-1.5">
                        {g.name}
                        {g.isSystem && <span className="text-[10px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.2 rounded">built-in</span>}
                      </span>
                      <span className="text-[11px] text-slate-400">{g.description}</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{fmtCount(g.limits?.maxSites ?? 0)}</td>
                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{fmtGb(g.limits?.diskQuotaGb ?? 0)}</td>
                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">{fmtCount(g.limits?.maxDatabases ?? 0)}</td>
                  <td className="py-3.5 px-4 font-mono text-slate-700">{fmtMb(g.limits?.memoryMb ?? 0)} • {fmtCpu(g.limits?.cpuQuotaPercent ?? 0)}</td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded font-mono">
                        {permCount(g.permissions)}/{PERMISSION_MATRIX.length}
                      </span>
                      <span className="text-[10px] text-slate-400">{g.members} member(s)</span>
                      {g.permissions?.terminal ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium text-[10px]">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> terminal
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[10px]">
                          <XCircle className="w-3 h-3 text-slate-400" /> no terminal
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => { setEditingGroup(g); setIsGroupModalOpen(true); }}
                        className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        title="Edit Group Package"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!g.isSystem && (
                        <button
                          onClick={() => setPendingDelete({ kind: 'group', id: g.id, name: g.name })}
                          className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                          title="Delete Group Package"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit User Modal */}
      <AddUserModal
        isOpen={isAddUserOpen}
        onClose={() => { setIsAddUserOpen(false); setEditingUser(null); }}
        onCreate={createUser}
        onUpdate={updateUser}
        editUser={editingUser}
        groups={groups}
        selfUsername={selfUsername}
        busy={busy}
      />

      {/* Create / Edit Group Modal */}
      <CreateGroupModal
        isOpen={isGroupModalOpen}
        onClose={() => { setIsGroupModalOpen(false); setEditingGroup(null); }}
        onSubmit={submitGroup}
        editGroup={editingGroup}
        busy={busy}
      />

      <DangerConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={performDelete}
        title={pendingDelete?.kind === 'group' ? 'Delete Group Package' : 'Delete Tenant Account'}
        itemType={pendingDelete?.kind === 'group' ? 'Group' : 'Account'}
        itemName={pendingDelete?.name ?? ''}
        warningDescription={
          pendingDelete?.kind === 'group'
            ? 'The package is removed. A package that still has members, or a built-in package, is refused by the daemon.'
            : 'The panel account is removed. An account that still owns websites or databases is refused until those are moved or deleted.'
        }
        confirmLabel={pendingDelete?.kind === 'group' ? 'Delete Package' : 'Delete Account'}
      />
    </div>
  );
};
