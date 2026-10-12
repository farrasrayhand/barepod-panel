import React, { useState } from 'react';
import { X, Layers, ShieldCheck } from 'lucide-react';
import type { GroupPayload, GroupRow } from '../api/client';
import { PERMISSION_MATRIX } from '../data/permissions';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: GroupPayload) => void;
  editGroup?: GroupRow | null;
  busy?: boolean;
}

type PermMap = Record<string, boolean>;

const DEFAULT_PERMISSIONS: PermMap = {
  deployApps: true,
  fileManager: true,
  terminal: true,
  databases: true,
  backups: false,
  domains: false,
  cloudflareTunnels: false,
  monitoring: false,
  users: false,
  apiTokens: false,
};

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export const CreateGroupModal: React.FC<CreateGroupModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  editGroup,
  busy,
}) => {
  const isEditing = Boolean(editGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [maxSites, setMaxSites] = useState('3');
  const [maxDatabases, setMaxDatabases] = useState('3');
  const [diskQuotaGb, setDiskQuotaGb] = useState('5');
  const [memoryMb, setMemoryMb] = useState('1536');
  const [cpuQuotaPercent, setCpuQuotaPercent] = useState('100');
  const [tasksMax, setTasksMax] = useState('256');
  const [inodeQuota, setInodeQuota] = useState('0');
  const [permissions, setPermissions] = useState<PermMap>({ ...DEFAULT_PERMISSIONS });

  React.useEffect(() => {
    if (!isOpen) return;
    const l = editGroup?.limits ?? {};
    const str = (v: number | undefined, fallback: string) => (v === undefined ? fallback : String(v));
    setName(editGroup?.name ?? '');
    setDescription(editGroup?.description ?? '');
    setMaxSites(str(l.maxSites, '3'));
    setMaxDatabases(str(l.maxDatabases, '3'));
    setDiskQuotaGb(str(l.diskQuotaGb, '5'));
    setMemoryMb(str(l.memoryMb, '1536'));
    setCpuQuotaPercent(str(l.cpuQuotaPercent, '100'));
    setTasksMax(str(l.tasksMax, '256'));
    setInodeQuota(str(l.inodeQuota, '0'));
    setPermissions(editGroup ? { ...DEFAULT_PERMISSIONS, ...editGroup.permissions } : { ...DEFAULT_PERMISSIONS });
  }, [isOpen, editGroup]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim()) return;
    onSubmit({
      name: name.trim(),
      description: description.trim(),
      permissions,
      limits: {
        maxSites: num(maxSites),
        maxDatabases: num(maxDatabases),
        diskQuotaGb: num(diskQuotaGb),
        memoryMb: num(memoryMb),
        cpuQuotaPercent: num(cpuQuotaPercent),
        tasksMax: num(tasksMax),
        inodeQuota: num(inodeQuota),
      },
    });
    onClose();
  };

  const field = 'w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {isEditing ? 'Edit Tenant Group / Package' : 'Create Tenant Group / Package'}
              </h2>
              <p className="text-xs text-slate-500">
                {isEditing ? 'Change capabilities and resource quotas' : 'Define resource quotas and capabilities for accounts'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Group / Package Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Starter Client, Agency Pro, Reseller Tier"
              value={name}
              disabled={isEditing}
              onChange={(e) => setName(e.target.value)}
              className={`${field} disabled:opacity-60`}
            />
            {isEditing && <p className="text-[11px] text-slate-400 mt-1">A package cannot be renamed; its members refer to it by name.</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description</label>
            <input
              type="text"
              placeholder="Short note about who this group is for..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs font-bold text-slate-800">Resource Limits</span>
              <span className="text-[10px] text-slate-400 font-mono">0 = unlimited</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[11px] text-slate-500">Max Sites</span>
                <input type="number" min="0" value={maxSites} onChange={(e) => setMaxSites(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">Max Databases</span>
                <input type="number" min="0" value={maxDatabases} onChange={(e) => setMaxDatabases(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">Disk Quota (GB)</span>
                <input type="number" min="0" value={diskQuotaGb} onChange={(e) => setDiskQuotaGb(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">RAM (MB)</span>
                <input type="number" min="0" value={memoryMb} onChange={(e) => setMemoryMb(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">CPU Quota (%)</span>
                <input type="number" min="0" value={cpuQuotaPercent} onChange={(e) => setCpuQuotaPercent(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">Tasks Max</span>
                <input type="number" min="0" value={tasksMax} onChange={(e) => setTasksMax(e.target.value)} className={`${field} mt-1`} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-500">Inode Quota</span>
                <input type="number" min="0" value={inodeQuota} onChange={(e) => setInodeQuota(e.target.value)} className={`${field} mt-1`} />
              </label>
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
                    checked={Boolean(permissions[item.key])}
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
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 disabled:opacity-60"
            >
              {isEditing ? 'Save Changes' : 'Save Group Package'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
