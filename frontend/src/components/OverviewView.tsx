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
  ArrowUpRight 
} from 'lucide-react';
import type { NavItem, WebApp } from '../types';

interface OverviewViewProps {
  apps: WebApp[];
  onNavigate: (tab: NavItem) => void;
  onOpenAddModal: () => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ apps, onNavigate, onOpenAddModal }) => {
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Overview & VPS Health</h1>
        <p className="text-sm text-slate-500 mt-0.5">BarePod Host Monitor • Debian 12 (Bookworm) • Linux Kernel 6.1</p>
      </div>

      {/* Metrics Row */}
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
          <span className="text-[10px] text-slate-400 mt-1.5 block">4 vCPU Cores Active</span>
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
          <span className="text-[10px] text-slate-400 mt-1.5 block">5.9 GB Available</span>
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
          <span className="text-[10px] text-slate-400 mt-1.5 block">131.6 GB Free Space</span>
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

      {/* Feature Architecture Matrix Card */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs space-y-4">
        <h2 className="text-base font-semibold text-slate-900">BarePod Panel Hybrid Engine Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-blue-600" /> Virtualmin Separation
            </div>
            <p className="text-slate-500 leading-relaxed">
              Multi-tenant Linux jails with dedicated cgroups quotas, restricted home paths, and automatic version switcher for CLI.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-emerald-600" /> CloudPanel Ease + PostgreSQL
            </div>
            <p className="text-slate-500 leading-relaxed">
              No PostgreSQL limitation! Seamless support for PostgreSQL 16+, MySQL 8, MariaDB, and ultra-fast Caddy SSL reverse proxy.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
            <div className="font-bold text-slate-800 flex items-center gap-2 mb-1">
              <CloudRain className="w-4 h-4 text-purple-600" /> Easypanel Power + Zero-NAT
            </div>
            <p className="text-slate-500 leading-relaxed">
              Container pods + 1-click Cloudflare Tunnel without port-forwarding or public IP headaches, wrapped in SumoPod minimal aesthetics.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
