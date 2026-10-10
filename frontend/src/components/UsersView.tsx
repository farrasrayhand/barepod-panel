import React, { useState } from 'react';
import { 
  Users, 
  Plus, 
  ShieldCheck, 
  HardDrive, 
  Layers, 
  Key, 
  Terminal,
  Trash2,
  Lock,
  Cpu,
  Database,
  Crown,
  CheckCircle2,
  XCircle,
  Pencil
} from 'lucide-react';
import type { TenantUser, UserGroup } from '../types';
import { AddUserModal } from './AddUserModal';
import { CreateGroupModal } from './CreateGroupModal';

interface UsersViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

export const UsersView: React.FC<UsersViewProps> = ({ onShowToast, onOpenTerminal }) => {
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users');
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);

  // Groups / Packages State
  const [groups, setGroups] = useState<UserGroup[]>([
    {
      id: 'g-1',
      name: 'Starter Client',
      description: 'Single website package for small business landing pages',
      maxSites: 1,
      diskLimit: '2 GB',
      maxDatabases: 1,
      ramLimit: '512 MB',
      cpuLimit: '1 vCPU',
      allowTerminal: false,
      userCount: 1,
    },
    {
      id: 'g-2',
      name: 'Developer Pro',
      description: 'Multi-site development package with CLI terminal access',
      maxSites: 5,
      diskLimit: '10 GB',
      maxDatabases: 5,
      ramLimit: '2 GB',
      cpuLimit: '2 vCPU',
      allowTerminal: true,
      userCount: 1,
    },
    {
      id: 'g-3',
      name: 'Agency Reseller',
      description: 'High capacity package for agencies managing multiple client web apps',
      maxSites: 15,
      diskLimit: '30 GB',
      maxDatabases: 15,
      ramLimit: '4 GB',
      cpuLimit: '4 vCPU',
      allowTerminal: true,
      userCount: 0,
    },
  ]);

  // Users State
  const [tenants, setTenants] = useState<TenantUser[]>([
    {
      id: 'u-1',
      username: 'farras',
      email: 'farras@barepod.cloud',
      role: 'admin',
      groupName: 'Superadmin (Root)',
      sitesCount: 2,
      maxSites: 'Unlimited',
      diskUsage: '1.4 GB',
      diskLimit: 'Unlimited',
      dbCount: 3,
      maxDatabases: 'Unlimited',
      status: 'active',
    },
    {
      id: 'u-2',
      username: 'tenant_alex',
      email: 'alex@clientdomain.com',
      role: 'user',
      groupName: 'Starter Client',
      sitesCount: 1,
      maxSites: 1,
      diskUsage: '450 MB',
      diskLimit: '2 GB',
      dbCount: 1,
      maxDatabases: 1,
      status: 'active',
    },
    {
      id: 'u-3',
      username: 'tenant_clientB',
      email: 'team@agencypartner.id',
      role: 'user',
      groupName: 'Developer Pro',
      sitesCount: 1,
      maxSites: 5,
      diskUsage: '820 MB',
      diskLimit: '10 GB',
      dbCount: 2,
      maxDatabases: 5,
      status: 'active',
    },
  ]);

  const handleAddUser = (user: TenantUser) => {
    setTenants([...tenants, user]);
    onShowToast?.('User Created', `User account ${user.username} created under group ${user.groupName}.`, 'success');
  };

  const handleCreateGroup = (group: UserGroup) => {
    setGroups([...groups, group]);
    onShowToast?.('Group Created', `Resource group ${group.name} successfully created.`, 'success');
  };

  const handleUpdateUser = (updated: TenantUser) => {
    setTenants(tenants.map(t => t.id === updated.id ? updated : t));
    onShowToast?.('User Updated', `Account ${updated.username} diperbarui (role: ${updated.role}, status: ${updated.status}).`, 'success');
  };

  const handleDeleteUser = (userId: string, username: string) => {
    if (username === 'farras') {
      onShowToast?.('Protected Account', 'Primary root administrator cannot be deleted.', 'error');
      return;
    }
    setTenants(tenants.filter(t => t.id !== userId));
    onShowToast?.('Tenant Removed', `User ${username} has been removed.`, 'info');
  };

  const handleDeleteGroup = (groupId: string, groupName: string) => {
    setGroups(groups.filter(g => g.id !== groupId));
    onShowToast?.('Group Deleted', `Group package ${groupName} was deleted.`, 'info');
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
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Admin accounts have unlimited privileges, while regular users are governed by configurable resource limit packages
          </p>
        </div>

        <div className="flex items-center gap-3">
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
              onClick={() => setIsCreateGroupOpen(true)}
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
            activeTab === 'users'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          User Accounts ({tenants.length})
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'groups'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
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
              {tenants.map((t) => {
                const isAdmin = t.role === 'admin';
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
                              <span className="text-[10px] bg-purple-100 text-purple-800 font-bold px-1.5 py-0.2 rounded">
                                Root
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 font-mono">/home/{t.username}</span>
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
                        <span>{t.sitesCount} / <strong className={isAdmin ? 'text-purple-600' : ''}>{t.maxSites}</strong> Sites</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                        <span>{t.diskUsage} / <strong className={isAdmin ? 'text-purple-600' : ''}>{t.diskLimit}</strong></span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Database className="w-3.5 h-3.5 text-slate-400" />
                        <span>{t.dbCount} / <strong className={isAdmin ? 'text-purple-600' : ''}>{t.maxDatabases}</strong> DBs</span>
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
                        {!isAdmin && (
                          <button
                            onClick={() => handleDeleteUser(t.id, t.username)}
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
                <th className="py-3.5 px-4">Terminal Access</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groups.map((g) => (
                <tr key={g.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4">
                    <div>
                      <span className="font-semibold text-slate-900 text-sm block">{g.name}</span>
                      <span className="text-[11px] text-slate-400">{g.description}</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                    {g.maxSites} Domains
                  </td>

                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                    {g.diskLimit}
                  </td>

                  <td className="py-3.5 px-4 font-mono font-medium text-slate-700">
                    {g.maxDatabases} Databases
                  </td>

                  <td className="py-3.5 px-4 font-mono text-slate-700">
                    {g.ramLimit} • {g.cpuLimit}
                  </td>

                  <td className="py-3.5 px-4">
                    {g.allowTerminal ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-medium text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        <XCircle className="w-3.5 h-3.5 text-slate-400" /> Disabled
                      </span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleDeleteGroup(g.id, g.name)}
                      className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                      title="Delete Group Package"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
        onAddUser={handleAddUser}
        onUpdateUser={handleUpdateUser}
        editUser={editingUser}
        groups={groups}
      />

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onCreateGroup={handleCreateGroup}
      />
    </div>
  );
};
