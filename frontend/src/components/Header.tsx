import React from 'react';
import { Menu } from 'lucide-react';
import type { NavItem } from '../types';

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenTerminal?: () => void;
  activeTab: NavItem;
}

export const Header: React.FC<HeaderProps> = ({ 
  onToggleSidebar, 
  activeTab
}) => {
  return (
    <header className="h-16 border-b border-slate-200 bg-white px-6 flex items-center justify-between sticky top-0 z-10">
      {/* Left section: Toggle & Breadcrumb */}
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
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

      {/* Right section: User Profile */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
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
