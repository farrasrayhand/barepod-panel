import React from 'react';
import { 
  Users, 
  Plus, 
  ShieldCheck, 
  HardDrive, 
  Layers, 
  Key, 
  Terminal,
  MoreVertical 
} from 'lucide-react';
import type { TenantUser } from '../types';

export const UsersView: React.FC = () => {
  const tenants: TenantUser[] = [
    {
      id: 'u-1',
      username: 'farras',
      email: 'farras@barepod.cloud',
      role: 'admin',
      sitesCount: 2,
      diskUsage: '1.4 GB',
      diskLimit: 'Unlimited',
      status: 'active',
    },
    {
      id: 'u-2',
      username: 'tenant_alex',
      email: 'alex@clientdomain.com',
      role: 'client',
      sitesCount: 1,
      diskUsage: '450 MB',
      diskLimit: '5 GB',
      status: 'active',
    },
    {
      id: 'u-3',
      username: 'tenant_clientB',
      email: 'team@agencypartner.id',
      role: 'developer',
      sitesCount: 1,
      diskUsage: '820 MB',
      diskLimit: '10 GB',
      status: 'active',
    },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Tenants & Multi-User</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Secure Tenant Jail
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Strict Linux user isolation: tenants only see their own files, databases, and CLI processes
          </p>
        </div>

        <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25">
          <Plus className="w-4 h-4" />
          <span>Add Tenant User</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              <th className="py-3.5 px-4">Tenant Username</th>
              <th className="py-3.5 px-4">Role / Access</th>
              <th className="py-3.5 px-4">Sites Attached</th>
              <th className="py-3.5 px-4">Disk Quota</th>
              <th className="py-3.5 px-4">Status</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tenants.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs">
                      {t.username.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="font-semibold text-slate-900 text-sm block">{t.username}</span>
                      <span className="text-[10px] text-slate-400 font-mono">/home/{t.username}</span>
                    </div>
                  </div>
                </td>

                <td className="py-3.5 px-4">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                    t.role === 'admin' 
                      ? 'bg-purple-100 text-purple-700' 
                      : t.role === 'developer'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-700'
                  }`}>
                    {t.role.toUpperCase()}
                  </span>
                </td>

                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                    <Layers className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.sitesCount} Isolated Apps</span>
                  </div>
                </td>

                <td className="py-3.5 px-4">
                  <div className="flex items-center gap-1.5 text-slate-700">
                    <HardDrive className="w-3.5 h-3.5 text-slate-400" />
                    <span>{t.diskUsage} / {t.diskLimit}</span>
                  </div>
                </td>

                <td className="py-3.5 px-4">
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Active
                  </span>
                </td>

                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="p-1 rounded text-slate-400 hover:text-slate-700">
                      <Key className="w-4 h-4" />
                    </button>
                    <button className="p-1 rounded text-slate-400 hover:text-slate-700">
                      <Terminal className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
