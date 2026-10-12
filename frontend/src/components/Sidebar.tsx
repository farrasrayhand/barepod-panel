import { describeAddress } from '../utils/address';
import React, { useState } from 'react';
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
  Server,
  Copy,
  Check,
  Archive,
  Webhook
} from 'lucide-react';
import { FolderTree } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NavItem } from '../types';

interface SidebarProps {
  currentTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  collapsed: boolean;
  /** The host file browser is an administrator's tool. */
  isAdmin?: boolean;
}

interface NavGroupItem {
  id: NavItem;
  label: string;
  icon: LucideIcon;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, onSelectTab, collapsed, isAdmin = false }) => {
  const [copiedIp, setCopiedIp] = useState(false);
  // The address this panel is being used on — the only one the panel can honestly name. Behind NAT
  // the public address is not discoverable from inside, and the sidebar used to hardcode one.
  const panelAddress = typeof window !== 'undefined' ? window.location.hostname : '';
  const panelAddressKind = describeAddress(panelAddress);

  const handleCopyIp = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText('103.147.154.82');
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const serviceItems: NavGroupItem[] = [
    { id: 'apps', label: 'Websites', icon: Layers },
    { id: 'pods', label: 'Pods (Containers)', icon: Box },
    { id: 'databases', label: 'Database', icon: Database },
  ];

  const infraItems: NavGroupItem[] = [
    { id: 'monitoring', label: 'Server Monitoring', icon: Activity },
    { id: 'backup', label: 'Backup & Migration', icon: Archive },
    { id: 'domains', label: 'Domains & SSL', icon: Globe },
    { id: 'tunnels', label: 'Cloudflare Tunnels', icon: CloudRain },
  ];

  const devItems: NavGroupItem[] = [
    { id: 'terminal', label: 'Isolated Web Terminal', icon: Terminal },
    ...(isAdmin ? [{ id: 'files' as NavItem, label: 'Host Files', icon: FolderTree }] : []),
    { id: 'api', label: 'API & MCP', icon: Webhook },
    { id: 'users', label: 'Tenants & Multi-User', icon: Users },
    { id: 'settings', label: 'Panel Settings', icon: Settings },
  ];

  const renderNavGroup = (title: string, items: NavGroupItem[]) => (
    <div className="mb-6">
      {!collapsed && title && (
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
            <span className="font-bold text-lg text-slate-900 tracking-tight">BarePod</span>
            <span className="text-[11px] text-slate-400">Web & Pod Management</span>
          </div>
        )}
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-thin">
        {renderNavGroup('', [{ id: 'overview', label: 'Dashboard & VPS', icon: LayoutDashboard }])}
        {renderNavGroup('Services', serviceItems)}
        {renderNavGroup('Infrastructure', infraItems)}
        {renderNavGroup('Developer & Security', devItems)}
      </div>

      {/* Bottom Network & Cloudflare Status */}
      {!collapsed && (
        <div className="p-3 bg-slate-50/80 m-2 rounded-xl border border-slate-200/70 shadow-2xs space-y-2">
          {/* Public IP */}
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 text-slate-500 font-medium">
              <Globe className="w-3.5 h-3.5 text-blue-600" />
              <span title="The address you reached this panel on. The host does not report a public address to the panel — behind NAT there is none to report.">
                Panel address:
              </span>
            </span>
            <button
              onClick={handleCopyIp}
              className="group flex items-center gap-1 font-mono font-bold text-slate-800 text-[11px] bg-white hover:bg-blue-50 px-2 py-0.5 rounded border border-slate-200 hover:border-blue-300 transition-colors shadow-2xs"
              title="Click to copy this address"
            >
              <span>{panelAddress}</span>
              {copiedIp ? (
                <Check className="w-3 h-3 text-emerald-600" />
              ) : (
                <Copy className="w-3 h-3 text-slate-400 group-hover:text-blue-600" />
              )}
            </button>
          </div>

          {/* Cloudflare Tunnel Status */}
          <div 
            onClick={() => onSelectTab('tunnels')}
            className="flex items-center justify-between text-xs pt-1.5 border-t border-slate-200/60 cursor-pointer group"
            title="Manage Cloudflare Tunnels"
          >
            <span className="flex items-center gap-1.5 text-slate-500 group-hover:text-slate-800 font-medium transition-colors">
              <CloudRain className="w-3.5 h-3.5 text-amber-500" />
              <span>CF Tunnel:</span>
            </span>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 group-hover:bg-slate-200 transition-colors"
              title="No tunnel is configured in the daemon yet — this badge used to claim a connection that was never checked."
            >
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
              Not configured
            </span>
          </div>
        </div>
      )}
    </aside>
  );
};
