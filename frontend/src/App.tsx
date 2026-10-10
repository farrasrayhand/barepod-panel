import { useState } from 'react';
import type { NavItem, WebApp } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AppsView } from './components/AppsView';
import { AddAppModal } from './components/AddAppModal';
import { WebTerminalView } from './components/WebTerminalView';
import { DatabasesView } from './components/DatabasesView';
import { CloudflareTunnelView } from './components/CloudflareTunnelView';
import { PodsView } from './components/PodsView';
import { UsersView } from './components/UsersView';
import { OverviewView } from './components/OverviewView';
import { ServerMonitoringView } from './components/ServerMonitoringView';
import { PanelSettingsView } from './components/PanelSettingsView';
import { DomainsView } from './components/DomainsView';
import { ToastContainer } from './components/Toast';
import type { ToastMessage } from './components/Toast';

export function App() {
  const [currentTab, setCurrentTab] = useState<NavItem>('apps');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [terminalAppId, setTerminalAppId] = useState<string>('app-1');

  // Interactive Toast State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (title: string, message?: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Realistic sample web apps with OpenLiteSpeed, Nginx, Caddy, Apache & Flask, Laravel, Next.js
  const [apps, setApps] = useState<WebApp[]>([
    {
      id: 'app-1',
      name: 'flask-sentiment-api',
      domain: 'sentiment.barepod.cloud',
      runtime: 'python',
      version: '3.12',
      framework: 'Flask',
      webServer: 'openlitespeed',
      tenantUser: 'farras',
      status: 'running',
      ssl: true,
      tunnelEnabled: true,
      tunnelRoute: 'sentiment.barepod.cloud -> 127.0.0.1:5000',
      port: 5000,
      memoryUsage: '42 MB',
      cpuUsage: '0.3%',
      createdAt: '2026-10-10',
    },
    {
      id: 'app-2',
      name: 'larastore-commerce',
      domain: 'larastore.id',
      runtime: 'php',
      version: '8.4',
      framework: 'Laravel 11',
      webServer: 'openlitespeed',
      tenantUser: 'farras',
      status: 'running',
      ssl: true,
      tunnelEnabled: true,
      tunnelRoute: 'larastore.id -> 127.0.0.1:8001',
      port: 8001,
      memoryUsage: '54 MB',
      cpuUsage: '0.2%',
      createdAt: '2026-10-08',
    },
    {
      id: 'app-3',
      name: 'billing-backend-api',
      domain: 'api.mycompany.com',
      runtime: 'nodejs',
      version: '22',
      framework: 'Express + Next.js',
      webServer: 'caddy',
      tenantUser: 'tenant_alex',
      status: 'running',
      ssl: true,
      tunnelEnabled: true,
      tunnelRoute: 'api.mycompany.com -> 127.0.0.1:3000',
      port: 3000,
      memoryUsage: '92 MB',
      cpuUsage: '0.8%',
      createdAt: '2026-10-09',
    },
    {
      id: 'app-4',
      name: 'fastapi-ai-service',
      domain: 'ai.service.net',
      runtime: 'python',
      version: '3.12',
      framework: 'FastAPI',
      webServer: 'nginx',
      tenantUser: 'tenant_clientB',
      status: 'running',
      ssl: true,
      tunnelEnabled: true,
      tunnelRoute: 'ai.service.net -> 127.0.0.1:8080',
      port: 8080,
      memoryUsage: '118 MB',
      cpuUsage: '1.2%',
      createdAt: '2026-10-09',
    },
    {
      id: 'app-5',
      name: 'legacy-news-portal',
      domain: 'portal.oldmedia.co.id',
      runtime: 'php',
      version: '8.3',
      framework: 'WordPress + .htaccess',
      webServer: 'apache',
      tenantUser: 'tenant_alex',
      status: 'stopped',
      ssl: true,
      tunnelEnabled: false,
      port: 8002,
      memoryUsage: '0 MB',
      cpuUsage: '0%',
      createdAt: '2026-10-10',
    },
    {
      id: 'app-6',
      name: 'internal-n8n-proxy',
      domain: 'n8n.workflow.barepod.cloud',
      runtime: 'proxy',
      version: 'v1.0',
      framework: 'Reverse Proxy (Upstream)',
      webServer: 'nginx',
      tenantUser: 'farras',
      status: 'running',
      ssl: true,
      tunnelEnabled: true,
      tunnelRoute: 'n8n.workflow.barepod.cloud -> 127.0.0.1:5678',
      port: 5678,
      upstreamUrl: 'http://127.0.0.1:5678',
      proxyWebsocket: true,
      proxyPreserveHost: true,
      proxyRealIp: true,
      proxyTimeoutSecs: 300,
      memoryUsage: '14 MB',
      cpuUsage: '0.1%',
      createdAt: '2026-10-10',
    },
  ]);

  const handleAddApp = (newApp: Partial<WebApp>) => {
    const created: WebApp = {
      id: `app-${Date.now()}`,
      name: newApp.name || 'new-app',
      domain: newApp.domain || 'example.com',
      runtime: newApp.runtime || 'python',
      version: newApp.version || '3.12',
      framework: newApp.framework || 'Flask',
      webServer: newApp.webServer || 'openlitespeed',
      tenantUser: newApp.tenantUser || 'farras',
      status: 'running',
      ssl: true,
      tunnelEnabled: newApp.tunnelEnabled ?? true,
      tunnelRoute: newApp.tunnelRoute,
      port: newApp.port || 8010,
      memoryUsage: newApp.memoryUsage || '28 MB',
      cpuUsage: '0.1%',
      createdAt: 'Just now',
      upstreamUrl: newApp.upstreamUrl,
      proxyWebsocket: newApp.proxyWebsocket,
      proxyPreserveHost: newApp.proxyPreserveHost,
      proxyRealIp: newApp.proxyRealIp,
      proxyTimeoutSecs: newApp.proxyTimeoutSecs,
    };
    setApps([created, ...apps]);
    showToast(
      created.runtime === 'proxy' ? 'Reverse Proxy Live' : 'App Deployed Successfully',
      `${created.name} (${created.runtime === 'proxy' ? created.upstreamUrl : created.runtime.toUpperCase()}) is active.`
    );
  };

  const handleToggleAppStatus = (appId: string) => {
    setApps(apps.map(a => {
      if (a.id === appId) {
        const nextStatus = a.status === 'running' ? 'stopped' : 'running';
        showToast(
          nextStatus === 'running' ? 'Service Started' : 'Service Stopped',
          `Application ${a.name} is now ${nextStatus}.`,
          'info'
        );
        return {
          ...a,
          status: nextStatus,
          memoryUsage: nextStatus === 'running' ? '36 MB' : '0 MB',
        };
      }
      return a;
    }));
  };

  const handleOpenAppTerminal = (app: WebApp) => {
    setTerminalAppId(app.id);
    setCurrentTab('terminal');
    showToast('Terminal Session Loaded', `Switched environment context to ${app.name} (${app.runtime.toUpperCase()} ${app.version}).`, 'info');
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        collapsed={sidebarCollapsed}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenTerminal={() => setCurrentTab('terminal')}
          activeTab={currentTab}
        />

        {/* Dynamic Views */}
        <main className="flex-1 overflow-y-auto">
          {currentTab === 'overview' && (
            <OverviewView
              apps={apps}
              onNavigate={setCurrentTab}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentTab === 'monitoring' && (
            <ServerMonitoringView
              onShowToast={showToast}
              onOpenTerminal={() => setCurrentTab('terminal')}
            />
          )}

          {currentTab === 'apps' && (
            <AppsView
              apps={apps}
              onOpenAddModal={() => setIsAddModalOpen(true)}
              onOpenAppTerminal={handleOpenAppTerminal}
              onToggleAppStatus={handleToggleAppStatus}
            />
          )}

          {currentTab === 'pods' && (
            <PodsView
              onShowToast={showToast}
              onOpenTerminal={() => setCurrentTab('terminal')}
            />
          )}

          {currentTab === 'databases' && (
            <DatabasesView onShowToast={showToast} />
          )}

          {currentTab === 'tunnels' && (
            <CloudflareTunnelView onShowToast={showToast} />
          )}

          {currentTab === 'terminal' && (
            <WebTerminalView
              apps={apps}
              selectedAppId={terminalAppId}
              onSelectApp={(id) => {
                setTerminalAppId(id);
                const target = apps.find(a => a.id === id);
                if (target) {
                  showToast('CLI Environment Switched', `Active runtime: ${target.runtime.toUpperCase()} ${target.version}`, 'info');
                }
              }}
            />
          )}

          {currentTab === 'users' && (
            <UsersView
              onShowToast={showToast}
              onOpenTerminal={() => setCurrentTab('terminal')}
            />
          )}

          {currentTab === 'domains' && (
            <DomainsView
              apps={apps}
              onShowToast={showToast}
            />
          )}

          {currentTab === 'settings' && (
            <PanelSettingsView
              onShowToast={showToast}
              onOpenTerminal={() => setCurrentTab('terminal')}
            />
          )}
        </main>
      </div>

      {/* Add App Modal */}
      <AddAppModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddApp={handleAddApp}
      />

      {/* Interactive Toast Notifications */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
      />
    </div>
  );
}

export default App;
