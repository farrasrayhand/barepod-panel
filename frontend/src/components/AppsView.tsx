import React, { useState } from 'react';
import { 
  RefreshCw, 
  Plus, 
  Globe, 
  Terminal, 
  Settings, 
  Play, 
  Square, 
  ExternalLink, 
  CloudRain, 
  ShieldCheck, 
  Search,
  CheckCircle2,
  Layers,
  Server,
  Folder,
  FolderGit2,
  Activity,
  Sliders,
  ArrowRightLeft,
  AlertTriangle,
  Lock
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';
import { FileManagerModal } from './FileManagerModal';
import { GitDeploymentModal } from './GitDeploymentModal';
import { AppDetailPage, type AppDetailTab } from './AppDetailPage';

interface AppsViewProps {
  apps: WebApp[];
  selectedAppSlug?: string | null;
  appSubTab?: string;
  onSelectApp?: (slug: string) => void;
  onSubTabChange?: (tab: AppDetailTab) => void;
  onBack?: () => void;
  onOpenAddModal: () => void;
  onOpenAppTerminal: (app: WebApp) => void;
  onToggleAppStatus: (appId: string) => void;
  onUpdateApp?: (updated: WebApp) => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const AppsView: React.FC<AppsViewProps> = ({
  apps,
  selectedAppSlug,
  appSubTab,
  onSelectApp,
  onSubTabChange,
  onBack,
  onOpenAddModal,
  onOpenAppTerminal,
  onToggleAppStatus,
  onUpdateApp,
  onShowToast,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modals
  const [selectedAppForFiles, setSelectedAppForFiles] = useState<WebApp | null>(null);
  const [selectedAppForGit, setSelectedAppForGit] = useState<WebApp | null>(null);

  // Detail page is driven by the URL (/apps/<name>/<tab>) so it survives refresh
  const selectedAppForDetails = apps.find((a) => a.name === selectedAppSlug || a.id === selectedAppSlug) || null;

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const filteredApps = apps.filter((app) => {
    const matchesFilter = filterType === 'all' || app.runtime === filterType || app.webServer === filterType;
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          app.domain.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          app.tenantUser.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (app.framework && app.framework.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  const getWebServerBadge = (ws: WebServerType) => {
    switch (ws) {
      case 'openlitespeed':
        return { label: 'OLS', color: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'nginx':
        return { label: 'Nginx', color: 'bg-green-100 text-green-800 border-green-300' };
      case 'caddy':
        return { label: 'Caddy', color: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'apache':
        return { label: 'Apache', color: 'bg-rose-100 text-rose-800 border-rose-300' };
    }
  };

  const handleUpdateAppDetail = (updated: WebApp) => {
    onUpdateApp?.(updated);
    setSelectedAppForGit((prev) => (prev && prev.id === updated.id ? updated : prev));
  };

  // Dedicated Full-Page View for Selected App
  if (selectedAppForDetails) {
    return (
      <>
        <AppDetailPage
          app={selectedAppForDetails}
          activeTab={appSubTab as AppDetailTab | undefined}
          onTabChange={onSubTabChange}
          onBack={() => onBack?.()}
          onToggleStatus={onToggleAppStatus}
          onOpenTerminal={onOpenAppTerminal}
          onOpenFiles={(a) => setSelectedAppForFiles(a)}
          onOpenGit={(a) => setSelectedAppForGit(a)}
          onUpdateApp={handleUpdateAppDetail}
          onShowToast={onShowToast}
        />

        {/* File Manager Modal over App Detail Page */}
        <FileManagerModal
          isOpen={!!selectedAppForFiles}
          onClose={() => setSelectedAppForFiles(null)}
          app={selectedAppForFiles}
        />

        {/* GitHub Redeployment Modal over App Detail Page */}
        <GitDeploymentModal
          isOpen={!!selectedAppForGit}
          onClose={() => setSelectedAppForGit(null)}
          app={selectedAppForGit}
          onUpdateApp={handleUpdateAppDetail}
          onShowToast={onShowToast}
        />
      </>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Apps & Services</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage your websites with File Manager, GitHub Redeploy, OpenLiteSpeed, Nginx, Caddy, or Apache
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25"
          >
            <Plus className="w-4 h-4" />
            <span>Add App</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        {/* Runtime Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Apps' },
            { id: 'proxy', label: 'Reverse Proxy' },
            { id: 'python', label: 'Python (Flask/FastAPI)' },
            { id: 'php', label: 'PHP (WP/Laravel)' },
            { id: 'nodejs', label: 'Node.js (Next/Express)' },
            { id: 'openlitespeed', label: 'OpenLiteSpeed' },
            { id: 'nginx', label: 'Nginx' },
            { id: 'caddy', label: 'Caddy' },
            { id: 'apache', label: 'Apache' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                filterType === tab.id
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search app, framework, domain..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="py-3.5 px-4">Name / Domain</th>
                <th className="py-3.5 px-4">Framework & Runtime</th>
                <th className="py-3.5 px-4">Web Server</th>
                <th className="py-3.5 px-4">Tenant User</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 whitespace-nowrap">Route & SSL</th>
                <th className="py-3.5 px-4 text-right">App Tools & Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredApps.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <Layers className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-medium text-slate-600">No apps found</p>
                    <p className="text-xs text-slate-400 mt-1">Click "Add App" to deploy a Flask, Laravel, WordPress, or Next.js app.</p>
                  </td>
                </tr>
              ) : (
                filteredApps.map((app) => {
                  const isRunning = app.status === 'running';
                  const wsBadge = getWebServerBadge(app.webServer);

                  return (
                    <tr key={app.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* Name & Domain */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <button 
                            onClick={() => onSelectApp?.(app.name)}
                            className="text-left font-semibold text-slate-900 text-sm hover:text-blue-600 transition-colors cursor-pointer"
                          >
                            {app.name}
                          </button>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            <a 
                              href={`https://${app.domain}`} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-slate-500 hover:text-blue-600 inline-flex items-center gap-1 text-xs"
                            >
                              <span>{app.domain}</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </a>
                            {app.maintenanceMode && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300" title="HTTP 503 Maintenance Mode Active">
                                <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                                503 Maint
                              </span>
                            )}
                            {app.basicAuthEnabled && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-300" title="HTTP Basic Auth Protected">
                                <Lock className="w-2.5 h-2.5 text-purple-600" />
                                Auth
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Framework & Runtime */}
                      <td className="py-3.5 px-4">
                        {app.runtime === 'proxy' ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-bold text-purple-700 text-xs flex items-center gap-1.5">
                              <ArrowRightLeft className="w-3.5 h-3.5 text-purple-600" />
                              Reverse Proxy
                            </span>
                            <span className="text-[10px] text-purple-800 font-mono bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                              {app.upstreamUrl || `127.0.0.1:${app.port}`}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-start gap-1">
                            <span className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-blue-500" />
                              {app.framework || app.runtime.toUpperCase()}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                              {app.runtime.toUpperCase()} {app.version}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* Web Server */}
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-md border text-[11px] font-bold ${wsBadge.color}`}>
                          {wsBadge.label}
                        </span>
                      </td>

                      {/* Tenant User */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 text-slate-700 font-mono text-[11px]">
                          <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                          <span>{app.tenantUser}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${
                            isRunning ? 'bg-emerald-500 shadow-xs shadow-emerald-400' : 'bg-slate-300'
                          }`} />
                          <span className={`font-medium ${isRunning ? 'text-emerald-700' : 'text-slate-500'}`}>
                            {isRunning ? 'Active' : 'Stopped'}
                          </span>
                        </div>
                      </td>

                      {/* Routing / Tunnel */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {app.tunnelEnabled ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs">
                              <CloudRain className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span>CF Tunnel</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-slate-100 text-slate-700 border border-slate-200">
                              <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>Port {app.port}</span>
                            </span>
                          )}
                          <span 
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200"
                            title="Auto SSL Certificate Active"
                          >
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>SSL</span>
                          </span>
                        </div>
                      </td>

                      {/* App Tools & Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Manage App Detail Page Button */}
                          <button
                            onClick={() => onSelectApp?.(app.name)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors cursor-pointer mr-1"
                            title="Buka Halaman Detail & Monitoring App"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Manage</span>
                          </button>

                          {/* File Manager Button */}
                          <button
                            onClick={() => setSelectedAppForFiles(app)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                            title="Open File Manager & Code Editor"
                          >
                            <Folder className="w-4 h-4" />
                          </button>

                          {/* GitHub CI/CD & Redeploy Button */}
                          <button
                            onClick={() => setSelectedAppForGit(app)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="GitHub Push-to-Deploy & Redeploy"
                          >
                            <FolderGit2 className="w-4 h-4" />
                          </button>

                          {/* Dedicated Isolated Web Terminal */}
                          <button
                            onClick={() => onOpenAppTerminal(app)}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                            title={`Open Terminal (auto ${app.runtime} ${app.version})`}
                          >
                            <Terminal className="w-4 h-4" />
                          </button>

                          {/* Toggle Status */}
                          <button
                            onClick={() => onToggleAppStatus(app.id)}
                            className={`p-1.5 rounded-lg transition-colors ${
                              isRunning 
                                ? 'text-amber-600 hover:bg-amber-50' 
                                : 'text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={isRunning ? 'Stop App' : 'Start App'}
                          >
                            {isRunning ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* File Manager Modal */}
      <FileManagerModal
        isOpen={!!selectedAppForFiles}
        onClose={() => setSelectedAppForFiles(null)}
        app={selectedAppForFiles}
      />

      {/* GitHub Redeployment Modal */}
      <GitDeploymentModal
        isOpen={!!selectedAppForGit}
        onClose={() => setSelectedAppForGit(null)}
        app={selectedAppForGit}
        onUpdateApp={(updated) => {
          onUpdateApp?.(updated);
          setSelectedAppForGit(updated);
        }}
        onShowToast={onShowToast}
      />
    </div>
  );
};
