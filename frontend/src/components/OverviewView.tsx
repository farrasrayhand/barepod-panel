import React from 'react';
import { 
  Server, 
  Cpu, 
  HardDrive, 
  Activity, 
  CloudRain, 
  ShieldCheck, 
  Layers, 
  Database, 
  Terminal, 
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Clock,
  Box,
  AlertTriangle,
  Plus,
  ArrowRight
} from 'lucide-react';
import type { NavItem, WebApp } from '../types';

interface OverviewViewProps {
  apps: WebApp[];
  onNavigate: (tab: NavItem) => void;
  onOpenAddModal: () => void;
}

const recentEvents = [
  { time: '18:42:10', level: 'info', msg: 'flask-sentiment-api redeployed from GitHub (commit 7fa901a).' },
  { time: '18:34:02', level: 'info', msg: 'larastore-commerce: php artisan migrate ran without errors.' },
  { time: '17:58:44', level: 'warn', msg: 'NVMe wear index 6% — still within safe limits (S.M.A.R.T. OK).' },
  { time: '16:40:12', level: 'info', msg: 'Automatic .bpod backup synced to Cloudflare R2 (142 MB).' },
  { time: '15:11:07', level: 'error', msg: 'WAF blocked 3 brute-force attempts (/wp-login.php) from 198.51.100.41.' },
];

export const OverviewView: React.FC<OverviewViewProps> = ({ apps, onNavigate, onOpenAddModal }) => {
  const runningApps = apps.filter((a) => a.status === 'running').length;
  const runningPct = apps.length ? Math.round((runningApps / apps.length) * 100) : 0;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Title & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Overview & VPS Health</h1>
          <p className="text-sm text-slate-500 mt-0.5">BarePod Host Monitor • Debian 12 (Bookworm) • Linux Kernel 6.1</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => onOpenAddModal()}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Deploy New App</span>
          </button>
          <button
            onClick={() => onNavigate('monitoring')}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/25 transition-all cursor-pointer"
          >
            <Activity className="w-4 h-4 animate-pulse" />
            <span>Open Full Server Monitor</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Host Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>CPU USAGE</span>
            <Cpu className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">12.4%</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: '12.4%' }} />
          </div>
          <span className="text-[10px] text-slate-400 mt-1.5 block">4 vCPU Cores Active • Load 0.42</span>
        </div>

        {/* RAM */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>MEMORY (RAM)</span>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">2.1 / 8.0 GB</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '26%' }} />
          </div>
          <span className="text-[10px] text-slate-400 mt-1.5 block">5.9 GB Available • Swap 0%</span>
        </div>

        {/* Disk */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>NVME STORAGE</span>
            <HardDrive className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">28.4 / 160 GB</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: '18%' }} />
          </div>
          <span className="text-[10px] text-slate-400 mt-1.5 block">131.6 GB Free • S.M.A.R.T. Healthy</span>
        </div>

        {/* Cloudflare Tunnel Status */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>CLOUDFLARE INGRESS</span>
            <CloudRain className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-emerald-600 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected
          </div>
          <div className="mt-3 text-xs text-slate-500 flex items-center justify-between">
            <span>Zero-NAT Active</span>
            <span className="font-semibold text-slate-800">3 Routes</span>
          </div>
        </div>
      </div>

      {/* Secondary Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>NETWORK I/O</span>
            <ArrowUp className="w-3.5 h-3.5 text-sky-500" />
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-sm font-bold text-slate-900">
            <span className="flex items-center gap-1 text-sky-600"><ArrowUp className="w-3.5 h-3.5" />12.8 Mbps</span>
            <span className="flex items-center gap-1 text-indigo-600"><ArrowDown className="w-3.5 h-3.5" />4.2 Mbps</span>
          </div>
          <span className="text-[10px] text-slate-400 mt-1 block">eth0 • docker0 • cloudflared0</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>UPTIME</span>
            <Clock className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">18 days 4 hours</div>
          <span className="text-[10px] text-slate-400 mt-1 block">Boot: 22 Sep 2026 • Kernel 6.1</span>
        </div>

        <button
          onClick={() => onNavigate('apps')}
          className="text-left bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>ACTIVE APPS</span>
            <Box className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">{runningApps} / {apps.length} Running</div>
          <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${runningPct}%` }} />
          </div>
        </button>

        <button
          onClick={() => onNavigate('users')}
          className="text-left bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>TENANTS & ISOLATION</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900">3 accounts • cgroups v2</div>
          <span className="text-[10px] text-slate-400 mt-1 block">All jails & quotas within limits</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Apps Quick List */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900">App Status</h2>
            </div>
            <button
              onClick={() => onNavigate('apps')}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>Manage All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
              <tr>
                <th className="py-2.5 px-5">App / Domain</th>
                <th className="py-2.5 px-5">Runtime</th>
                <th className="py-2.5 px-5">Tenant</th>
                <th className="py-2.5 px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {apps.map((app) => (
                <tr
                  key={app.id}
                  onClick={() => onNavigate('apps')}
                  className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                >
                  <td className="py-2.5 px-5">
                    <span className="font-semibold text-slate-900 block">{app.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{app.domain}</span>
                  </td>
                  <td className="py-2.5 px-5">
                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                      {app.runtime.toUpperCase()} {app.version}
                    </span>
                  </td>
                  <td className="py-2.5 px-5 font-mono text-slate-600">{app.tenantUser}</td>
                  <td className="py-2.5 px-5">
                    <span className={`inline-flex items-center gap-1.5 font-medium ${
                      app.status === 'running' ? 'text-emerald-700' : 'text-slate-500'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${app.status === 'running' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      {app.status === 'running' ? 'Active' : 'Stopped'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent Events */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-purple-600" />
            <h2 className="text-sm font-bold text-slate-900">Recent Activity</h2>
          </div>
          <div className="p-4 space-y-3">
            {recentEvents.map((ev, i) => {
              const color = ev.level === 'error'
                ? 'text-rose-600 bg-rose-50'
                : ev.level === 'warn'
                ? 'text-amber-600 bg-amber-50'
                : 'text-blue-600 bg-blue-50';
              return (
                <div key={i} className="flex items-start gap-2.5 text-xs">
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                    {ev.level === 'info' ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                  </span>
                  <div className="min-w-0">
                    <span className="text-[10px] text-slate-400 font-mono block">{ev.time}</span>
                    <span className="text-slate-600 leading-snug block">{ev.msg}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Feature Architecture Matrix Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <h2 className="text-base font-semibold text-slate-900">BarePod Panel Hybrid Engine Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <button
            onClick={() => onNavigate('users')}
            className="text-left p-4 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-blue-300 transition-colors cursor-pointer"
          >
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Multi-Tenant Isolation
            </div>
          </button>

          <button
            onClick={() => onNavigate('databases')}
            className="text-left p-4 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-blue-300 transition-colors cursor-pointer"
          >
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-emerald-600" /> Complete Database Suite
            </div>
          </button>

          <button
            onClick={() => onNavigate('tunnels')}
            className="text-left p-4 rounded-xl bg-slate-50 border border-slate-200/80 hover:border-blue-300 transition-colors cursor-pointer"
          >
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <CloudRain className="w-4 h-4 text-purple-600" /> Zero-NAT Cloud Ingress
            </div>
          </button>
        </div>
        <div className="flex items-center gap-4 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
          <span className="flex items-center gap-1.5"><Server className="w-3.5 h-3.5 text-slate-400" /> 4 Web Server Engines (OLS / Nginx / Caddy / Apache)</span>
          <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5 text-slate-400" /> Isolated PTY Web Terminal</span>
        </div>
      </div>
    </div>
  );
};
