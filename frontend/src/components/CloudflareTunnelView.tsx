import React, { useState } from 'react';
import { 
  CloudRain, 
  CheckCircle2, 
  Key, 
  RefreshCw, 
  ArrowRight, 
  ExternalLink, 
  ShieldCheck, 
  Plus, 
  Globe, 
  Zap,
  Radio,
  Lock,
  Eye,
  EyeOff,
  Trash2,
  Cpu,
  Layers,
  Sparkles,
  Server,
  UserCheck
} from 'lucide-react';
import type { UserTunnel, IngressRoute } from '../types';
import { AddUserTunnelModal } from './AddUserTunnelModal';

interface CloudflareTunnelViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const CloudflareTunnelView: React.FC<CloudflareTunnelViewProps> = ({ onShowToast }) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedTenantFilter, setSelectedTenantFilter] = useState<string>('all');
  const [visibleTokenTunnelId, setVisibleTokenTunnelId] = useState<string | null>(null);

  // New Route Modal State
  const [isAddRouteOpen, setIsAddRouteOpen] = useState(false);
  const [activeTunnelForRoute, setActiveTunnelForRoute] = useState<string | null>(null);
  const [newHostname, setNewHostname] = useState('');
  const [newTargetService, setNewTargetService] = useState('http://127.0.0.1:8000');
  const [newAppName, setNewAppName] = useState('');

  // Initial Multi-Tenant Tunnels
  const [tunnels, setTunnels] = useState<UserTunnel[]>([
    {
      id: 'tun-1',
      tenantUser: 'farras',
      tunnelName: 'farras-master-tunnel',
      token: 'eyJhIjoiY2ZmODljNjEyZDJlNDgxMmE5ZjY3YTZlNGMxMmI2YTciLCJ0IjoiZGI3MmE4MTAtYTVlOC00NGI3LThkYzEtY2MwMjI5ZGFkZTdlIiwicyI6Ik1ERTFaVGxtTXprdE1XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      connectorVersion: '2024.9.1 (PID: 41289)',
      uptime: '14 Days, 6 Hours',
      routes: [
        { hostname: 'larastore.id', service: 'http://127.0.0.1:8001', appName: 'larastore-api (OLS)', status: 'Healthy' },
        { hostname: 'api.barepod.cloud', service: 'http://127.0.0.1:8080', appName: 'barepod-core (Caddy)', status: 'Healthy' },
      ],
    },
    {
      id: 'tun-2',
      tenantUser: 'tenant_alex',
      tunnelName: 'alex-client-zero-trust',
      token: 'eyJhIjoiMWE4YmMyZDNlNGY1ZzZoN2k4ajlrMGxtMW4ybzNwNHEiLCJ0IjoiOGUxYTIzNDUtNjg3OS00OGM1LTk2OGUtYTFiMmMzZDRlNTVmIiwicyI6IlpURTNNVGttWXprdE5XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      connectorVersion: '2024.9.1 (PID: 53102)',
      uptime: '3 Days, 11 Hours',
      routes: [
        { hostname: 'shop.alexclient.com', service: 'http://127.0.0.1:3000', appName: 'alex-storefront (Nginx)', status: 'Healthy' },
      ],
    },
    {
      id: 'tun-3',
      tenantUser: 'tenant_clientB',
      tunnelName: 'agency-clientb-tunnel',
      token: 'eyJhIjoiN2I2YTVjNGQzZTJmMWcwaDlpOGprN2xtNm41bzRwM3EiLCJ0IjoiNWQxYTIzNDUtNjg3OS00OGM1LTk2OGUtYTFiMmMzZDRlNTVmIiwicyI6IllERTJaVGxtTXprdE1XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      connectorVersion: '2024.9.1 (PID: 67814)',
      uptime: '1 Day, 4 Hours',
      routes: [
        { hostname: 'analytics.clientb.io', service: 'http://127.0.0.1:5000', appName: 'flask-analytics (Apache)', status: 'Healthy' },
      ],
    },
  ]);

  const tenantUsers = ['farras', 'tenant_alex', 'tenant_clientB', 'tenant_agency1'];

  const handleAddTunnel = (newTunnel: UserTunnel) => {
    setTunnels([newTunnel, ...tunnels]);
    onShowToast?.(
      'Tenant Tunnel Activated',
      `Isolated cloudflared daemon started for ${newTunnel.tenantUser} (${newTunnel.tunnelName}).`,
      'success'
    );
  };

  const handleRestartTunnel = (tunnel: UserTunnel) => {
    onShowToast?.(
      'Daemon Restarted',
      `cloudflared process for tenant "${tunnel.tenantUser}" re-initialized successfully.`,
      'info'
    );
  };

  const handleDeleteTunnel = (tunnelId: string, tenantUser: string) => {
    setTunnels(tunnels.filter(t => t.id !== tunnelId));
    onShowToast?.(
      'Tunnel Disconnected',
      `Stopped cloudflared daemon process for tenant "${tenantUser}".`,
      'info'
    );
  };

  const handleOpenAddRoute = (tunnelId: string) => {
    setActiveTunnelForRoute(tunnelId);
    setNewHostname('');
    setNewTargetService('http://127.0.0.1:8000');
    setNewAppName('');
    setIsAddRouteOpen(true);
  };

  const handleSaveRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTunnelForRoute || !newHostname.trim()) return;

    const newRoute: IngressRoute = {
      hostname: newHostname.trim(),
      service: newTargetService.trim(),
      appName: newAppName.trim() || 'Custom Ingress',
      status: 'Healthy',
    };

    setTunnels(tunnels.map(t => {
      if (t.id === activeTunnelForRoute) {
        return {
          ...t,
          routes: [...t.routes, newRoute],
        };
      }
      return t;
    }));

    setIsAddRouteOpen(false);
    onShowToast?.(
      'Ingress Route Added',
      `${newRoute.hostname} mapped to ${newRoute.service} on isolated tenant tunnel.`,
      'success'
    );
  };

  const filteredTunnels = selectedTenantFilter === 'all'
    ? tunnels
    : tunnels.filter(t => t.tenantUser === selectedTenantFilter);

  const totalRoutes = tunnels.reduce((acc, t) => acc + t.routes.length, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cloudflare Tunnels (Zero-NAT)</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
              <Layers className="w-3 h-3 text-blue-600" /> Isolated Per User
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Setiap tenant menjalankan instance <code>cloudflared</code> terisolasi dengan akun Cloudflare Zero Trust dan domain mereka sendiri.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tenant Filter */}
          <div className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs">
            <UserCheck className="w-4 h-4 text-slate-400 mr-2" />
            <select
              value={selectedTenantFilter}
              onChange={(e) => setSelectedTenantFilter(e.target.value)}
              className="text-xs font-semibold text-slate-700 bg-transparent focus:outline-hidden"
            >
              <option value="all">All Tenants ({tunnels.length} Daemons)</option>
              {tenantUsers.map(u => (
                <option key={u} value={u}>Tenant: {u}</option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Tenant Tunnel</span>
          </button>
        </div>
      </div>

      {/* Security Architecture Explainer Banner */}
      <div className="bg-gradient-to-r from-blue-900 to-indigo-950 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 translate-x-10 -translate-y-10 w-64 h-64 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
              <span>Multi-Tenant Process & Network Isolation</span>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-white">
              Bisa! Tiap user punya tunnel Cloudflare sendiri tanpa campur aduk
            </h2>
            <p className="text-xs text-blue-100/80 leading-relaxed">
              BarePod menjalankan 1 daemon <code>cloudflared</code> terpisah per tenant user (via cgroup/container). Token Zero Trust dimasukkan oleh masing-masing user, sehingga domain klien A langsung terhubung ke akun Cloudflare pribadi klien A tanpa memerlukan akses admin root.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3 shrink-0">
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 text-center">
              <span className="text-xl font-bold block">{tunnels.length}</span>
              <span className="text-[10px] text-blue-200 uppercase font-semibold">Active Daemons</span>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 text-center">
              <span className="text-xl font-bold block">{totalRoutes}</span>
              <span className="text-[10px] text-blue-200 uppercase font-semibold">Public Hostnames</span>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-3 border border-white/10 text-center">
              <span className="text-xl font-bold block text-emerald-400">100%</span>
              <span className="text-[10px] text-blue-200 uppercase font-semibold">Zero-NAT Pass</span>
            </div>
          </div>
        </div>
      </div>

      {/* List of Isolated Tenant Tunnels */}
      <div className="space-y-6">
        {filteredTunnels.map((tunnel) => (
          <div 
            key={tunnel.id}
            className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden transition-all hover:border-slate-300"
          >
            {/* Tunnel Card Header */}
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100">
                  <CloudRain className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">{tunnel.tunnelName}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      CONNECTED
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                      Tenant: @{tunnel.tenantUser}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 font-mono">
                    <span className="flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-slate-400" />
                      {tunnel.connectorVersion}
                    </span>
                    <span>•</span>
                    <span>Uptime: {tunnel.uptime}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons for this Tunnel */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRestartTunnel(tunnel)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
                  title="Restart isolated cloudflared process"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                  <span>Restart Process</span>
                </button>

                <button
                  onClick={() => handleOpenAddRoute(tunnel.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Route</span>
                </button>

                <button
                  onClick={() => handleDeleteTunnel(tunnel.id, tunnel.tenantUser)}
                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                  title="Stop and remove tunnel"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Token Info Strip */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 flex-1 max-w-xl">
                <Key className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-slate-500 font-semibold shrink-0">Tenant Token:</span>
                <span className="font-mono text-slate-600 truncate bg-white px-2 py-0.5 rounded border border-slate-200">
                  {visibleTokenTunnelId === tunnel.id 
                    ? tunnel.token 
                    : `${tunnel.token.slice(0, 18)}••••••••••••••••••••••••${tunnel.token.slice(-8)}`}
                </span>
                <button
                  onClick={() => setVisibleTokenTunnelId(visibleTokenTunnelId === tunnel.id ? null : tunnel.id)}
                  className="p-1 text-slate-400 hover:text-slate-700"
                >
                  {visibleTokenTunnelId === tunnel.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="flex items-center gap-1 text-[11px] text-slate-400">
                <Lock className="w-3 h-3 text-emerald-500" />
                <span>Isolated to Linux sandbox <code>/home/{tunnel.tenantUser}</code></span>
              </div>
            </div>

            {/* Ingress Routing Table for this Tenant */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Ingress Domain Routes ({tunnel.routes.length})
                </h3>
                <span className="text-[11px] text-slate-400">
                  Traffic from Cloudflare Edge → Isolated Tenant App
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
                    <tr>
                      <th className="py-2.5 px-4">Public Domain (Cloudflare)</th>
                      <th className="py-2.5 px-4">Target Application</th>
                      <th className="py-2.5 px-4">Internal Service Target</th>
                      <th className="py-2.5 px-4">Health Status</th>
                      <th className="py-2.5 px-4 text-right">Edge Protection</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tunnel.routes.map((route, rIdx) => (
                      <tr key={rIdx} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-2">
                            <Globe className="w-3.5 h-3.5 text-blue-500" />
                            <a 
                              href={`https://${route.hostname}`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="font-semibold text-slate-800 hover:text-blue-600 hover:underline flex items-center gap-1"
                            >
                              {route.hostname}
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </a>
                          </div>
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-700">
                          {route.appName}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-mono">
                            {route.service}
                          </span>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {route.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-medium">
                            Cloudflare SSL + DDoS
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add User Tunnel Modal */}
      <AddUserTunnelModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddTunnel={handleAddTunnel}
        tenantUsers={tenantUsers}
      />

      {/* Add Route Modal */}
      {isAddRouteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Add Ingress Route to Tenant Tunnel</h3>
              </div>
              <button
                onClick={() => setIsAddRouteOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Public Hostname (Domain / Subdomain)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. app.mytenant.com or client.id"
                  value={newHostname}
                  onChange={(e) => setNewHostname(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Application Name / Service Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Next.js Web or WordPress OLS"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Internal Service Target
                </label>
                <input
                  type="text"
                  required
                  placeholder="http://127.0.0.1:8000"
                  value={newTargetService}
                  onChange={(e) => setNewTargetService(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Port internal container/web server milik tenant ini di localhost server.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddRouteOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20"
                >
                  Save Route
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
