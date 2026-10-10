import React from 'react';
import { 
  LayoutDashboard, 
  Layers, 
  Database, 
  Terminal, 
  Globe, 
  CloudRain, 
  Users, 
  Settings, 
  Box, 
  ChevronRight,
  ShieldCheck,
  Activity,
  Server
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavItem } from '../types';

interface SidebarProps {
  currentTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  collapsed: boolean;
}

interface NavGroupItem {
  id: NavItem;
  label: string;
  icon: LucideIcon;
  badge?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, collapsed }) => {
  const serviceItems: NavGroupItem[] = [
    { id: 'apps', label: 'Apps (Services)', icon: Layers, badge: '4 Active' },
    { id: 'pods', label: 'Pods (Containers)', icon: Box, badge: '2 Pods' },
    { id: 'databases', label: 'Database (PG/MySQL)', icon: Database, badge: 'Postgres & MySQL' },
  ];

  const infraItems: NavGroupItem[] = [
    { id: 'overview', label: 'Dashboard & VPS', icon: LayoutDashboard },
    { id: 'monitoring', label: 'Server Monitoring', icon: Activity, badge: 'Live Metrics' },
    { id: 'domains', label: 'Domains & SSL', icon: Globe },
    { id: 'tunnels', label: 'Cloudflare Tunnels', icon: CloudRain, badge: 'Zero-NAT' },
  ];

  const devItems: NavGroupItem[] = [
    { id: 'terminal', label: 'Isolated Web Terminal', icon: Terminal, badge: 'Auto CLI' },
    { id: 'users', label: 'Tenants & Multi-User', icon: Users },
    { id: 'settings', label: 'Panel Settings', icon: Settings },
  ];

  const renderNavGroup = (title: string, items: NavGroupItem[]) => (
    <div className="mb-6">
      {!collapsed && (
        <div className="px-4 mb-2 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          {title}
        </div>
      )}
      <div className="space-y-1 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? 'bg-blue-50 text-blue-600 font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 font-normal'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
              {!collapsed && (
                <div className="flex items-center justify-between flex-1 truncate">
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <aside
      className={`h-screen border-r border-slate-200 bg-white flex flex-col transition-all duration-300 z-20 shrink-0 ${
        collapsed ? 'w-18' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center px-4 border-b border-slate-100 gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/20 shrink-0">
          <Server className="w-5 h-5" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-lg text-slate-900 tracking-tight">BarePod</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-amber-100 text-amber-800">
                PRO
              </span>
            </div>
            <span className="text-[11px] text-slate-400">Web & Pod Management</span>
          </div>
        )}
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {renderNavGroup('Services', serviceItems)}
        {renderNavGroup('Infrastructure', infraItems)}
        {renderNavGroup('Developer & Security', devItems)}
      </div>

      {/* Bottom Tenant Info */}
      {!collapsed && (
        <div className="p-3 border-t border-slate-100 bg-slate-50/70 m-2 rounded-xl">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Tenant Jail Active
            </span>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1 rounded font-mono">
              cgroups v2
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            Isolated CLI, PostgreSQL & Cloudflare Tunnel ready.
          </div>
        </div>
      )}
    </aside>
  );
};
