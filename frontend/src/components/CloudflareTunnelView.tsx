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
  Radio
} from 'lucide-react';

export const CloudflareTunnelView: React.FC = () => {
  const [token, setToken] = useState('eyJhIjoiY2ZmODljNjEyZDJlNDgxMmE5ZjY3YTZlNGMxMmI2YTciLCJ0IjoiZGI3MmE4MTAtYTVlOC00NGI3LThkYzEtY2MwMjI5ZGFkZTdlIiwicyI6Ik1ERTFaVGxtTXprdE1XTXdPUzAwTnpjeUxUbGhPR0V0TkdRMU5qSTRNV1JpT0RWaiJ9');
  const [status, setStatus] = useState<'connected' | 'configuring'>('connected');
  const [isSaved, setIsSaved] = useState(false);

  const ingressRules = [
    { hostname: 'larastore.id', service: 'http://127.0.0.1:8001', tenant: 'farras', status: 'Healthy' },
    { hostname: 'api.mycompany.com', service: 'http://127.0.0.1:3000', tenant: 'tenant_clientA', status: 'Healthy' },
    { hostname: 'ai-agent.barepod.cloud', service: 'http://127.0.0.1:8080', tenant: 'tenant_clientB', status: 'Healthy' },
  ];

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cloudflare Tunnel (Zero-NAT)</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <Radio className="w-3 h-3 text-emerald-600 animate-pulse" /> Live Ingress
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Expose isolated websites and Docker containers to the internet without port forwarding or public static IP
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs">
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Sync Cloudflare</span>
          </button>
        </div>
      </div>

      {/* Tunnel Connection Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <CloudRain className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-slate-900">cloudflared Daemon</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                  CONNECTED
                </span>
              </div>
              <span className="text-xs text-slate-400">Tunnel ID: barepod-main-vps-tunnel • Connector v2024.9.1</span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-400 block">Uptime</span>
            <span className="text-xs font-semibold text-slate-800">14 Days, 6 Hours</span>
          </div>
        </div>

        {/* Token Form */}
        <form onSubmit={handleSaveToken} className="space-y-3">
          <label className="block text-xs font-semibold text-slate-700">
            Cloudflare Tunnel Token
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste Cloudflare Zero Trust Tunnel token..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20"
            >
              {isSaved ? <CheckCircle2 className="w-4 h-4 text-emerald-200" /> : <Zap className="w-4 h-4" />}
              <span>{isSaved ? 'Updated!' : 'Update Token'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Dapatkan token dari Cloudflare Zero Trust Dashboard → Networks → Tunnels. Cukup sekali paste, seluruh domain baru otomatis terhubung!
          </p>
        </form>
      </div>

      {/* Ingress Rules Mapping Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Active Ingress Routing Rules</h2>
            <p className="text-xs text-slate-400">Incoming domain traffic forwarded directly to tenant container ports</p>
          </div>
          <span className="text-xs text-slate-500 font-medium">{ingressRules.length} Active Routes</span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              <th className="py-3 px-4">Public Hostname (Cloudflare)</th>
              <th className="py-3 px-4">Routing Target</th>
              <th className="py-3 px-4">Tenant Owner</th>
              <th className="py-3 px-4">Health Status</th>
              <th className="py-3 px-4 text-right">Edge Protection</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ingressRules.map((rule, idx) => (
              <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-slate-800">{rule.hostname}</span>
                  </div>
                </td>
                <td className="py-3 px-4 font-mono text-slate-600">
                  <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px]">{rule.service}</span>
                </td>
                <td className="py-3 px-4 text-slate-600">
                  <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[11px] font-medium">
                    {rule.tenant}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {rule.status}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                    WAF + SSL Pro
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
