import React, { useState } from 'react';
import { 
  CloudRain, 
  CheckCircle2, 
  Key, 
  RefreshCw, 
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
  UserCheck,
  Check,
  AlertCircle
} from 'lucide-react';
import type { IngressRoute } from '../types';

interface TenantTunnelData {
  tenantUser: string;
  tunnelName: string;
  token: string;
  status: 'connected' | 'disconnected' | 'configuring';
  daemonPid: number;
  memoryUsage: string;
  uptime: string;
  routes: IngressRoute[];
}

interface CloudflareTunnelViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const CloudflareTunnelView: React.FC<CloudflareTunnelViewProps> = ({ onShowToast }) => {
  // Simulated logged-in user (Default to tenant_alex to demonstrate that regular users configure their own tunnel)
  const [activeUser, setActiveUser] = useState<string>('tenant_alex');

  // Multi-Tenant Personal Tunnels (Isolated State per User)
  const [userTunnels, setUserTunnels] = useState<Record<string, TenantTunnelData>>({
    tenant_alex: {
      tenantUser: 'tenant_alex',
      tunnelName: 'alex-zero-trust-tunnel',
      token: 'eyJhIjoiMWE4YmMyZDNlNGY1ZzZoN2k4ajlrMGxtMW4ybzNwNHEiLCJ0IjoiOGUxYTIzNDUtNjg3OS00OGM1LTk2OGUtYTFiMmMzZDRlNTVmIiwicyI6IlpURTNNVGttWXprdE5XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      daemonPid: 53102,
      memoryUsage: '18 MB',
      uptime: '3 Days, 11 Hours',
      routes: [
        { hostname: 'shop.alexclient.com', service: 'http://127.0.0.1:3000', appName: 'alex-storefront (Nginx)', status: 'Healthy' },
        { hostname: 'api.alexclient.com', service: 'http://127.0.0.1:3001', appName: 'alex-backend (Node.js)', status: 'Healthy' },
      ],
    },
    farras: {
      tenantUser: 'farras',
      tunnelName: 'farras-root-tunnel',
      token: 'eyJhIjoiY2ZmODljNjEyZDJlNDgxMmE5ZjY3YTZlNGMxMmI2YTciLCJ0IjoiZGI3MmE4MTAtYTVlOC00NGI3LThkYzEtY2MwMjI5ZGFkZTdlIiwicyI6Ik1ERTFaVGxtTXprdE1XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      daemonPid: 41289,
      memoryUsage: '22 MB',
      uptime: '14 Days, 6 Hours',
      routes: [
        { hostname: 'larastore.id', service: 'http://127.0.0.1:8001', appName: 'larastore-commerce (OLS)', status: 'Healthy' },
        { hostname: 'sentiment.barepod.cloud', service: 'http://127.0.0.1:5000', appName: 'flask-sentiment-api (OLS)', status: 'Healthy' },
        { hostname: 'api.barepod.cloud', service: 'http://127.0.0.1:8080', appName: 'barepod-core (Caddy)', status: 'Healthy' },
      ],
    },
    tenant_clientB: {
      tenantUser: 'tenant_clientB',
      tunnelName: 'clientb-analytics-tunnel',
      token: 'eyJhIjoiN2I2YTVjNGQzZTJmMWcwaDlpOGprN2xtNm41bzRwM3EiLCJ0IjoiNWQxYTIzNDUtNjg3OS00OGM1LTk2OGUtYTFiMmMzZDRlNTVmIiwicyI6IllERTJaVGxtTXprdE1XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9',
      status: 'connected',
      daemonPid: 67814,
      memoryUsage: '16 MB',
      uptime: '1 Day, 4 Hours',
      routes: [
        { hostname: 'analytics.clientb.io', service: 'http://127.0.0.1:5000', appName: 'flask-analytics (Apache)', status: 'Healthy' },
      ],
    },
  });

  // Current tunnel data for the active logged-in user
  const currentTunnel = userTunnels[activeUser] || {
    tenantUser: activeUser,
    tunnelName: `${activeUser}-tunnel`,
    token: '',
    status: 'disconnected',
    daemonPid: 0,
    memoryUsage: '0 MB',
    uptime: 'Not Running',
    routes: [],
  };

  const [inputToken, setInputToken] = useState(currentTunnel.token);
  const [showTokenText, setShowTokenText] = useState(false);
  const [isTokenSaved, setIsTokenSaved] = useState(false);

  // New Route Modal State
  const [isAddRouteOpen, setIsAddRouteOpen] = useState(false);
  const [newHostname, setNewHostname] = useState('');
  const [newTargetService, setNewTargetService] = useState('http://127.0.0.1:3000');
  const [newAppName, setNewAppName] = useState('');

  // Handle switching active user simulation
  const handleSwitchUser = (username: string) => {
    setActiveUser(username);
    const target = userTunnels[username];
    setInputToken(target ? target.token : '');
    setShowTokenText(false);
    onShowToast?.(
      'Active User Simulation Changed',
      `Now managing the personal account and tunnel of: "${username}".`,
      'info'
    );
  };

  // Save Token
  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    setUserTunnels(prev => ({
      ...prev,
      [activeUser]: {
        ...currentTunnel,
        token: inputToken.trim(),
        status: inputToken.trim() ? 'connected' : 'disconnected',
        daemonPid: currentTunnel.daemonPid || Math.floor(50000 + Math.random() * 20000),
        uptime: currentTunnel.uptime === 'Not Running' ? 'Just started' : currentTunnel.uptime,
      }
    }));
    setIsTokenSaved(true);
    setTimeout(() => setIsTokenSaved(false), 2000);
    onShowToast?.(
      'Cloudflare Token Saved',
      `cloudflared daemon for account "${activeUser}" was updated.`,
      'success'
    );
  };

  // Restart daemon
  const handleRestartDaemon = () => {
    onShowToast?.(
      'Daemon Restarted',
      `cloudflared daemon for account "${activeUser}" was restarted.`,
      'info'
    );
  };

  // Add Route
  const handleSaveRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHostname.trim()) return;

    const newRoute: IngressRoute = {
      hostname: newHostname.trim(),
      service: newTargetService.trim(),
      appName: newAppName.trim() || 'My Web Application',
      status: 'Healthy',
    };

    setUserTunnels(prev => ({
      ...prev,
      [activeUser]: {
        ...currentTunnel,
        routes: [...currentTunnel.routes, newRoute],
      }
    }));

    setIsAddRouteOpen(false);
    setNewHostname('');
    onShowToast?.(
      'Ingress Domain Added',
      `Domain https://${newRoute.hostname} now routes to ${newRoute.service} on your account.`,
      'success'
    );
  };

  // Delete Route
  const handleDeleteRoute = (hostname: string) => {
    setUserTunnels(prev => ({
      ...prev,
      [activeUser]: {
        ...currentTunnel,
        routes: currentTunnel.routes.filter(r => r.hostname !== hostname),
      }
    }));
    onShowToast?.(
      'Ingress Domain Removed',
      `Hostname ${hostname} was removed from your tunnel.`,
      'info'
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header & User Persona Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cloudflare Tunnel (Zero-NAT)</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <Radio className="w-3 h-3 text-emerald-600 animate-pulse" /> Self-Service Tunnel
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Each tenant uses their own Cloudflare Zero Trust tunnel.
          </p>
        </div>

        {/* User Context Switcher (For Panel Owner Demonstration) */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-2 shadow-2xs">
          <UserCheck className="w-4 h-4 text-slate-500 ml-1" />
          <span className="text-xs font-semibold text-slate-600">Your Account:</span>
          <select
            value={activeUser}
            onChange={(e) => handleSwitchUser(e.target.value)}
            className="text-xs font-bold text-blue-700 bg-blue-50/80 px-2.5 py-1 rounded-lg border border-blue-200 focus:outline-hidden cursor-pointer font-mono"
          >
            <option value="tenant_alex">tenant_alex (Client Account / Regular User)</option>
            <option value="tenant_clientB">tenant_clientB (Agency Account / Regular User)</option>
            <option value="farras">farras (Superadmin / Root)</option>
          </select>
        </div>
      </div>

      {/* Tunnel summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="font-semibold text-slate-800">Personal tunnel</span>
          <span className="font-mono text-slate-500 truncate">@{activeUser}</span>
          <span className="text-slate-400 hidden sm:inline">· isolated from other tenants</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <span className="text-sm font-bold block text-slate-900 font-mono">{currentTunnel.routes.length}</span>
            <span className="text-[10px] text-slate-500 uppercase font-semibold">Active Domains</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <span className={`text-sm font-bold block font-mono ${currentTunnel.status === 'connected' ? 'text-emerald-600' : 'text-slate-500'}`}>
              {currentTunnel.status === 'connected' ? 'Live' : 'Off'}
            </span>
            <span className="text-[10px] text-slate-500 uppercase font-semibold">Tunnel Status</span>
          </div>
        </div>
      </div>

      {/* Main Personal Tunnel Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
        {/* Card Header with Status & Process Info */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100 shrink-0">
              <CloudRain className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">{currentTunnel.tunnelName}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  CONNECTED
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                  User: @{activeUser}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 font-mono">
                <span>Daemon: <code>cloudflared@{activeUser}</code></span>
                <span>•</span>
                <span>PID: {currentTunnel.daemonPid}</span>
                <span>•</span>
                <span>RAM: {currentTunnel.memoryUsage}</span>
                <span>•</span>
                <span>Uptime: {currentTunnel.uptime}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRestartDaemon}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
              title="Restart isolated daemon process"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>Restart Daemon</span>
            </button>
          </div>
        </div>

        {/* Token Configuration Box */}
        <form onSubmit={handleSaveToken} className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-800">
              Cloudflare Zero Trust Tunnel Token (Your Personal Account)
            </label>
            <span className="text-[11px] text-slate-400">
              Cloudflare Dashboard → Zero Trust → Networks → Tunnels
            </span>
          </div>

          <div className="flex gap-2.5">
            <div className="relative flex-1">
              <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showTokenText ? 'text' : 'password'}
                required
                value={inputToken}
                onChange={(e) => setInputToken(e.target.value)}
                placeholder="eyJhIjoiY2ZmODljNjEyZDJlNDgxMmE5ZjY3YTZlNGMxMmI2YTciLCJ0I..."
                className="w-full pl-9 pr-10 py-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowTokenText(!showTokenText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title={showTokenText ? 'Hide Token' : 'Show Token'}
              >
                {showTokenText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <button
              type="submit"
              className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20 shrink-0 cursor-pointer"
            >
              {isTokenSaved ? (
                <>
                  <Check className="w-4 h-4 text-emerald-200" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Update Token</span>
                </>
              )}
            </button>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            <strong>No port forwarding or public IP needed:</strong> paste the token from your own Cloudflare account and <code>cloudflared</code> connects your domains to your apps.
          </p>
        </form>
      </div>

      {/* Ingress Domain Routes Table for This User */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Your Ingress Domains</h2>
              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                {currentTunnel.routes.length} Domain
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Domains on <strong>@{activeUser}</strong> forwarded to local app ports
            </p>
          </div>

          <button
            onClick={() => setIsAddRouteOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Ingress Domain</span>
          </button>
        </div>

        {currentTunnel.routes.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Globe className="w-8 h-8 mx-auto text-slate-300 mb-2" />
            <p className="text-xs font-semibold text-slate-600">No domains routed yet.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Click "+ Add Ingress Domain" above to connect your first domain.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
              <tr>
                <th className="py-3 px-4">Public Hostname (Cloudflare)</th>
                <th className="py-3 px-4">Your App Target</th>
                <th className="py-3 px-4">Internal Target Port</th>
                <th className="py-3 px-4">Health Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentTunnel.routes.map((route, idx) => (
                <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-500" />
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
                  <td className="py-3 px-4 font-medium text-slate-700">
                    {route.appName}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-200/60">
                      {route.service}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {route.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => handleDeleteRoute(route.hostname)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="Remove this domain from the tunnel"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Route Modal for Current User */}
      {isAddRouteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Connect a Domain to Your App</h3>
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
                  Public Hostname (Your Domain / Subdomain)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. app.alexclient.com or shop.domain.id"
                  value={newHostname}
                  onChange={(e) => setNewHostname(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Make sure this hostname's CNAME already points to the tunnel in your Cloudflare dashboard.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  App Name / Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Laravel Online Store or REST API"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Internal Service Port
                </label>
                <input
                  type="text"
                  required
                  placeholder="http://127.0.0.1:3000"
                  value={newTargetService}
                  onChange={(e) => setNewTargetService(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Your app's internal port (e.g. 3000, 5000, or 8001).
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
                  Save Domain
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
