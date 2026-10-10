import React, { useState } from 'react';
import { X, Layers, ShieldCheck, HardDrive } from 'lucide-react';
import type { GroupPermissions, UserGroup } from '../types';
import { PERMISSION_MATRIX } from '../data/permissions';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateGroup: (group: UserGroup) => void;
}

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onCreateGroup,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxSites, setMaxSites] = useState<number | 'Unlimited'>(3);
  const [diskLimit, setDiskLimit] = useState('5 GB');
  const [maxDatabases, setMaxDatabases] = useState<number | 'Unlimited'>(3);
  const [ramLimit, setRamLimit] = useState('1.5 GB');
  const [cpuLimit, setCpuLimit] = useState('1 vCPU');
  const [allowTerminal, setAllowTerminal] = useState(true);
  const [permissions, setPermissions] = useState<GroupPermissions>({
    deployApps: true,
    fileManager: true,
    terminal: true,
    databases: true,
    backups: false,
    domains: false,
    cloudflareTunnels: false,
    monitoring: false,
    users: false,
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const newGroup: UserGroup = {
      id: `g-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || 'Custom tenant resource limits package',
      maxSites,
      diskLimit,
      maxDatabases,
      ramLimit,
      cpuLimit,
      allowTerminal: permissions.terminal,
      permissions,
      userCount: 0,
    };

    onCreateGroup(newGroup);
    onClose();
    setName('');
    setDescription('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Create Tenant Group / Package</h2>
              <p className="text-xs text-slate-500">Define resource quotas for regular user accounts</p>
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
              Group / Package Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Starter Client, Agency Pro, Reseller Tier"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description
            </label>
            <input
              type="text"
              placeholder="Short note about who this group is for..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Allowed Sites
              </label>
              <select
                value={String(maxSites)}
                onChange={(e) => setMaxSites(e.target.value === 'Unlimited' ? 'Unlimited' : Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              >
                <option value="1">1 Site (Single Domain)</option>
                <option value="3">3 Sites</option>
                <option value="5">5 Sites</option>
                <option value="15">15 Sites</option>
                <option value="Unlimited">Unlimited Sites</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Disk Quota Limit
              </label>
              <select
                value={diskLimit}
                onChange={(e) => setDiskLimit(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              >
                <option value="2 GB">2 GB Disk</option>
                <option value="5 GB">5 GB Disk</option>
                <option value="15 GB">15 GB Disk</option>
                <option value="50 GB">50 GB Disk</option>
                <option value="Unlimited">Unlimited Disk</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Databases
              </label>
              <select
                value={String(maxDatabases)}
                onChange={(e) => setMaxDatabases(e.target.value === 'Unlimited' ? 'Unlimited' : Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              >
                <option value="1">1 Database</option>
                <option value="3">3 Databases</option>
                <option value="10">10 Databases</option>
                <option value="Unlimited">Unlimited Databases</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                cgroups RAM Limit
              </label>
              <select
                value={ramLimit}
                onChange={(e) => setRamLimit(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              >
                <option value="512 MB">512 MB</option>
                <option value="1 GB">1 GB</option>
                <option value="2 GB">2 GB</option>
                <option value="4 GB">4 GB</option>
              </select>
            </div>
          </div>

          <div className="pt-1 border-t border-slate-100">
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-bold text-slate-800">Capability Permissions</span>
              <span className="text-[10px] text-slate-400 font-mono">
                {Object.values(permissions).filter(Boolean).length}/{PERMISSION_MATRIX.length}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {PERMISSION_MATRIX.map((item) => (
                <label
                  key={item.key}
                  className="flex items-start gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={permissions[item.key]}
                    onChange={(e) => setPermissions((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-[11px] leading-tight">
                    <span className="font-semibold text-slate-700 block">{item.label}</span>
                    <span className="text-slate-400">{item.desc}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
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
              Save Group Package
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
