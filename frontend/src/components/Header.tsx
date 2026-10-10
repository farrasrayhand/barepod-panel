import React from 'react';
import { 
  Menu, 
  Sun, 
  User as UserIcon, 
  CloudRain, 
  Activity, 
  Search, 
  Terminal,
  ExternalLink
} from 'lucide-react';
import type { NavItem } from '../types';

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenTerminal: () => void;
  activeTab: NavItem;
}

export const Header: React.FC<HeaderProps> = ({ 
  onToggleSidebar, 
  onOpenTerminal,
  activeTab
}) => {
  return (
    <header className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between sticky top-0 z-10">
      {/* Left section: Toggle & Breadcrumb */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          title="Toggle Navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-400 font-medium">BarePod</span>
          <span className="text-slate-300">/</span>
          <span className="text-slate-800 font-semibold capitalize">
            {activeTab === 'apps' ? 'Apps (Services)' : activeTab}
          </span>
        </div>
      </div>

      {/* Middle section: Server & Tunnel Status */}
      <div className="hidden lg:flex items-center gap-3">
        {/* Cloudflare Tunnel Status Badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <CloudRain className="w-3.5 h-3.5 text-blue-500" />
          <span className="font-medium">Cloudflare Tunnel:</span>
          <span className="font-semibold text-emerald-600">Connected (Zero-NAT)</span>
        </div>

        {/* Server Metrics Summary */}
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200/80 text-xs text-slate-600">
          <Activity className="w-3.5 h-3.5 text-slate-400" />
          <span>RAM: <strong className="text-slate-800">2.1 / 8 GB</strong></span>
          <span className="text-slate-300">•</span>
          <span>CPU: <strong className="text-slate-800">8%</strong></span>
        </div>
      </div>

      {/* Right section: Quick Terminal, Theme, User */}
      <div className="flex items-center gap-3">
        {/* Quick Launch Isolated Terminal */}
        <button
          onClick={onOpenTerminal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 text-xs font-medium transition-colors shadow-xs"
        >
          <Terminal className="w-3.5 h-3.5 text-emerald-400" />
          <span>Web Terminal</span>
        </button>

        {/* User Profile Pill */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-xs border border-blue-200">
            FR
          </div>
          <div className="hidden sm:flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-800 leading-tight">farras</span>
            <span className="text-[10px] text-slate-400 leading-tight">Tenant: Root/Admin</span>
          </div>
        </div>
      </div>
    </header>
  );
};
