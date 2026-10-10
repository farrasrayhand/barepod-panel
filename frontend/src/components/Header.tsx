import React, { useEffect, useRef, useState } from 'react';
import { Menu, User, ShieldCheck, Settings, LogOut, KeyRound, ChevronDown } from 'lucide-react';
import type { NavItem } from '../types';

interface HeaderProps {
  onToggleSidebar: () => void;
  onOpenTerminal?: () => void;
  activeTab: NavItem;
  onNavigatePath?: (path: string) => void;
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  activeTab,
  onNavigatePath,
  onLogout,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, []);

  const go = (path: string) => {
    setMenuOpen(false);
    onNavigatePath?.(path);
  };

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
            {activeTab === 'apps'
              ? 'Websites'
              : activeTab === 'api'
                ? 'API & MCP'
                : activeTab === 'profile'
                  ? 'Profile'
                  : activeTab}
          </span>
        </div>
      </div>

      {/* Right section: User Profile menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          title="Account menu"
        >
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-xs border border-blue-200">
            FR
          </div>
          <div className="hidden sm:flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-800 leading-tight">farras</span>
            <span className="text-[10px] text-slate-400 leading-tight">Tenant: Root/Admin</span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
        </button>

        {menuOpen && (
          <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl border border-slate-200 shadow-xl py-1.5 z-30 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-xs border border-blue-200">
                FR
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold text-slate-800 block truncate">farras</span>
                <span className="text-[10px] text-slate-400 block truncate">farras@barepod.cloud</span>
              </div>
            </div>

            <button
              onClick={() => go('/profile')}
              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
            >
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Profile &amp; Account</span>
            </button>

            <button
              onClick={() => go('/settings/security')}
              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>Security &amp; 2FA</span>
            </button>

            <button
              onClick={() => go('/api')}
              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>API Tokens &amp; MCP</span>
            </button>

            <button
              onClick={() => go('/settings/general')}
              className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
            >
              <Settings className="w-3.5 h-3.5 text-slate-400" />
              <span>Panel Settings</span>
            </button>

            <div className="my-1 border-t border-slate-100" />

            <button
              onClick={() => {
                setMenuOpen(false);
                onLogout?.();
              }}
              className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
