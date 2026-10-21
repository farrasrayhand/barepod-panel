import React, { useState } from 'react';
import { X, CloudRain, Key } from 'lucide-react';
import type { UserTunnel } from '../types';

interface AddUserTunnelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTunnel: (tunnel: UserTunnel) => void;
  tenantUsers: string[];
}

export const AddUserTunnelModal: React.FC<AddUserTunnelModalProps> = ({
  isOpen,
  onClose,
  onAddTunnel,
  tenantUsers,
}) => {
  const [tenantUser, setTenantUser] = useState(tenantUsers[0] || 'farras');
  const [tunnelName, setTunnelName] = useState('');
  const [token, setToken] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tunnelName.trim() || !token.trim()) return;

    const newTunnel: UserTunnel = {
      id: `tun-${Date.now()}`,
      tenantUser,
      tunnelName: tunnelName.trim(),
      token: token.trim(),
      status: 'connected',
      connectorVersion: '2024.9.1 (Isolated Process)',
      uptime: 'Just started',
      routes: [
        {
          hostname: `*.${tenantUser}.link`,
          service: 'http://127.0.0.1:8000',
          appName: 'Default Ingress',
          status: 'Healthy',
        }
      ],
    };

    onAddTunnel(newTunnel);
    onClose();
    setTunnelName('');
    setToken('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <CloudRain className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Connect Tenant Cloudflare Tunnel</h2>
              <p className="text-xs text-slate-500">Isolated cloudflared daemon per tenant user</p>
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
              Assign to Tenant User
            </label>
            <select
              value={tenantUser}
              onChange={(e) => setTenantUser(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            >
              {tenantUsers.map((u) => (
                <option key={u} value={u}>
                  {u} (Isolated Tenant Environment)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Tunnel Name / Label
            </label>
            <input
              type="text"
              required
              placeholder="e.g. alex-client-cloudflare or agency-zero-trust"
              value={tunnelName}
              onChange={(e) => setTunnelName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cloudflare Zero Trust Tunnel Token
            </label>
            <div className="relative">
              <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                required
                placeholder="eyJhIjoiY2ZmODljNjEyZDJlNDgx..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Token from this tenant's own Cloudflare Zero Trust dashboard.
            </p>
          </div>

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
              Launch Isolated Tunnel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
