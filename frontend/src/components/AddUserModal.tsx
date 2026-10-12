import React, { useState } from 'react';
import { X, Users, ShieldCheck } from 'lucide-react';
import type { ApiUser, CreateUserPayload, GroupRow, UpdateUserPayload } from '../api/client';

interface AddUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (payload: CreateUserPayload) => void;
  onUpdate: (id: string, payload: UpdateUserPayload) => void;
  editUser?: ApiUser | null;
  groups: GroupRow[];
  /** The signed-in account — the daemon refuses a self status change anyway. */
  selfUsername?: string;
  busy?: boolean;
}

export const AddUserModal: React.FC<AddUserModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  onUpdate,
  editUser,
  groups,
  selfUsername,
  busy,
}) => {
  const isEditing = Boolean(editUser);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [groupName, setGroupName] = useState('');
  const [status, setStatus] = useState<'active' | 'suspended'>('active');

  // Sync form fields whenever the modal opens (create vs edit target changes)
  React.useEffect(() => {
    if (!isOpen) return;
    if (editUser) {
      setUsername(editUser.username);
      setEmail(editUser.email);
      setGroupName(editUser.groupName);
      setStatus(editUser.status);
    } else {
      setUsername('');
      setEmail('');
      setPassword('');
      setGroupName(groups[0]?.name ?? '');
      setStatus('active');
    }
  }, [isOpen, editUser, groups]);

  if (!isOpen) return null;

  const selectedGroup = groups.find((g) => g.name === groupName) ?? groups[0];
  const makesAdmin = selectedGroup?.name === 'Superadmin (Root)';
  const isSelf = isEditing && editUser?.username === selfUsername;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (isEditing && editUser) {
      onUpdate(editUser.id, { email: email.trim(), groupName, status });
      onClose();
      return;
    }
    if (!username.trim() || !groupName) return;
    onCreate({
      username: username.trim().toLowerCase(),
      email: email.trim(),
      password: password.trim() || undefined,
      groupName,
    });
    onClose();
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
              <h2 className="text-base font-semibold text-slate-900">
                {isEditing ? 'Edit Tenant Account' : 'Add New Tenant Account'}
              </h2>
              <p className="text-xs text-slate-500">
                {isEditing
                  ? 'Update the package, status and contact of this account'
                  : 'The daemon also creates the Linux account and applies the package quota'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Username (Linux System User)</label>
            <input
              type="text"
              required
              placeholder="e.g. agency_partner"
              value={username}
              disabled={isEditing}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {isEditing && (
              <p className="text-[11px] text-slate-400 mt-1">
                The tenant Linux username cannot be changed (it would require recreating the jail user).
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              placeholder="partner@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            />
          </div>

          {!isEditing && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Password (optional)</label>
              <input
                type="text"
                placeholder="Leave empty to generate one"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                At least 12 characters. When left empty the daemon generates one and shows it once.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Assign to Group / Package</label>
            <select
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name} (Max {g.limits?.maxSites || '∞'} Sites • {g.limits?.diskQuotaGb || '∞'} GB Disk • {g.limits?.maxDatabases || '∞'} DBs)
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 mt-1">
              Resource limits come from the package. Membership of the <strong>Superadmin (Root)</strong> package is what makes an account an admin.
            </p>
          </div>

          {makesAdmin && (
            <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
              <p className="text-[11px]">
                <strong>Administrator</strong>: the Root package grants every capability and cross-tenant visibility.
              </p>
            </div>
          )}

          {isEditing && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Account Status</label>
              <select
                value={status}
                disabled={isSelf}
                onChange={(e) => setStatus(e.target.value as 'active' | 'suspended')}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 disabled:opacity-60"
              >
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              {isSelf && <p className="text-[11px] text-slate-400 mt-1">You cannot change your own status.</p>}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 disabled:opacity-60"
            >
              {isEditing ? 'Save Changes' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
