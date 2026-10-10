import React, { useState } from 'react';
import { X, Users, ShieldCheck, Sparkles } from 'lucide-react';
import type { TenantUser, UserGroup } from '../types';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddUser: (user: TenantUser) => void;
  groups: UserGroup[];
}

export const AddUserModal: React.FC<AddUserModalProps> = ({
  isOpen,
  onClose,
  onAddUser,
  groups,
}) => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [selectedGroupId, setSelectedGroupId] = useState(groups[0]?.id || 'g-1');

  if (!isOpen) return null;

  const activeGroup = groups.find(g => g.id === selectedGroupId) || groups[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    const isAdmin = role === 'admin';
    const newUser: TenantUser = {
      id: `u-${Date.now()}`,
      username: username.toLowerCase().replace(/[^a-z0-9_]/g, ''),
      email: email.trim() || `${username.toLowerCase()}@client.net`,
      role,
      groupName: isAdmin ? 'Admin (Unlimited)' : activeGroup.name,
      sitesCount: 0,
      maxSites: isAdmin ? 'Unlimited' : activeGroup.maxSites,
      diskUsage: '0 MB',
      diskLimit: isAdmin ? 'Unlimited' : activeGroup.diskLimit,
      dbCount: 0,
      maxDatabases: isAdmin ? 'Unlimited' : activeGroup.maxDatabases,
      status: 'active',
    };

    onAddUser(newUser);
    onClose();
    setUsername('');
    setEmail('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Add New Tenant Account</h2>
              <p className="text-xs text-slate-500">Configure role & assign resource limits package</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Username (Linux System User)
            </label>
            <input
              type="text"
              required
              placeholder="e.g. agency_partner"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email Address
            </label>
            <input
              type="email"
              placeholder="partner@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Account Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('user')}
                className={`p-2.5 rounded-xl border text-xs text-left transition-all ${
                  role === 'user'
                    ? 'border-blue-600 bg-blue-50 font-bold text-blue-900 ring-2 ring-blue-500/10'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <span className="block font-semibold">Regular User</span>
                <span className="text-[10px] text-slate-500 font-normal">Dibatasi sesuai grup</span>
              </button>
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`p-2.5 rounded-xl border text-xs text-left transition-all ${
                  role === 'admin'
                    ? 'border-purple-600 bg-purple-50 font-bold text-purple-900 ring-2 ring-purple-500/10'
                    : 'border-slate-200 bg-white text-slate-700'
                }`}
              >
                <span className="block font-semibold">Administrator</span>
                <span className="text-[10px] text-purple-700 font-normal">Unlimited Resources</span>
              </button>
            </div>
          </div>

          {role === 'user' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Assign to Group / Package
              </label>
              <select
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              >
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} (Max {g.maxSites} Sites • {g.diskLimit} Disk • {g.maxDatabases} DBs)
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Resource pengguna ini akan dibatasi otomatis oleh cgroups v2 sesuai limit grup yang dipilih.
              </p>
            </div>
          ) : (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <p className="text-[11px]">
                Akun <strong>Administrator</strong> memiliki resource <strong>Unlimited</strong> tanpa batasan sites, disk, database, ataupun memori.
              </p>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20"
            >
              Create Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
