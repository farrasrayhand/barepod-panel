import { useState, useEffect } from 'react';
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
import { BackupMigrationView } from './components/BackupMigrationView';
import { ToastContainer } from './components/Toast';
import type { ToastMessage } from './components/Toast';

const TAB_PATHS: Record<NavItem, string> = {
  overview: '/overview',
  monitoring: '/monitoring',
  apps: '/apps',
  pods: '/pods',
  databases: '/databases',
  domains: '/domains',
  tunnels: '/tunnels',
  terminal: '/terminal',
  users: '/users',
  settings: '/settings',
  backup: '/backup',
};

interface AppRoute {
  tab: NavItem;
  appSlug?: string;
  appSubTab?: string;
}

const parseRoute = (pathname: string): AppRoute => {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return { tab: 'apps' };
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'apps') {
    return {
      tab: 'apps',
      appSlug: parts[1] ? decodeURIComponent(parts[1]) : undefined,
      appSubTab: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    };
  }
  const match = (Object.keys(TAB_PATHS) as NavItem[]).find((tab) => TAB_PATHS[tab] === `/${parts[0]}`);
  return match ? { tab: match, appSubTab: parts[1] ? decodeURIComponent(parts[1]) : undefined } : { tab: 'apps' };
};

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));
  const currentTab = route.tab;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [terminalAppId, setTerminalAppId] = useState<string | null>(null);

  // Navigate to an explicit path (menu endpoint or app detail deep-link)
  const navigatePath = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setRoute(parseRoute(path));
  };

  const setCurrentTab = (tab: NavItem) => navigatePath(TAB_PATHS[tab]);

  // Menu navigation: opening the Terminal tab always starts from the session picker
  const navigate = (tab: NavItem) => {
    if (tab === 'terminal') setTerminalAppId(null);
    setCurrentTab(tab);
  };

  // Normalize bare "/" to the default menu endpoint on first load
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', TAB_PATHS.apps);
    }
  }, []);

  // Restore the correct route on refresh / browser back-forward
  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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
      gitRepo: 'https://github.com/farras/flask-sentiment-api',
      gitBranch: 'main',
      autoDeploy: true,
      buildScript: `git pull origin main
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart gunicorn-flask`,
      lastDeployedAt: '2026-10-10 16:40:12',
      lastDeployCommit: '7fa901a',
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
      gitRepo: 'https://github.com/farras/larastore-commerce',
      gitBranch: 'main',
      autoDeploy: true,
      buildScript: `git pull origin main
composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
systemctl reload php8.4-fpm`,
      lastDeployedAt: '2026-10-10 18:34:12',
      lastDeployCommit: 'd70a45a',
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
      basicAuthEnabled: true,
      basicAuthUser: 'admin',
      basicAuthPassword: 'BarePod$ecure2026!',
      basicAuthRealm: 'Billing Staging Environment',
      gitRepo: 'https://github.com/alex/billing-backend',
      gitBranch: 'production',
      autoDeploy: true,
      buildScript: `git pull origin production
pnpm install --frozen-lockfile
pnpm run build
pm2 reload billing-api --update-env`,
      lastDeployedAt: '2026-10-09 21:15:00',
      lastDeployCommit: 'c32981f',
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
      gitRepo: 'https://github.com/clientB/fastapi-ai-service',
      gitBranch: 'main',
      autoDeploy: true,
      buildScript: `git pull origin main
source .venv/bin/activate
pip install -r requirements.txt
systemctl reload uvicorn-ai`,
      lastDeployedAt: '2026-10-10 11:20:45',
      lastDeployCommit: 'e81903b',
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
      maintenanceMode: true,
      maintenanceMessage: 'News portal is undergoing scheduled server upgrade maintenance.',
      maintenanceBypassIps: '127.0.0.1, 103.147.154.82',
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

  const handleUpdateApp = (updated: WebApp) => {
    setApps(apps.map(a => a.id === updated.id ? updated : a));
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={navigate}
        collapsed={sidebarCollapsed}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenTerminal={() => navigate('terminal')}
          activeTab={currentTab}
        />

        {/* Dynamic Views */}
        <main className="flex-1 overflow-y-auto">
          {currentTab === 'overview' && (
            <OverviewView
              apps={apps}
              onNavigate={navigate}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentTab === 'monitoring' && (
            <ServerMonitoringView
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
            />
          )}

          {currentTab === 'apps' && (
            <AppsView
              apps={apps}
              selectedAppSlug={route.appSlug ?? null}
              appSubTab={route.appSubTab}
              onSelectApp={(slug) => navigatePath(`/apps/${encodeURIComponent(slug)}`)}
              onSubTabChange={(sub) => {
                if (route.appSlug) navigatePath(`/apps/${encodeURIComponent(route.appSlug)}/${sub}`);
              }}
              onBack={() => navigatePath(TAB_PATHS.apps)}
              onOpenAddModal={() => setIsAddModalOpen(true)}
              onOpenAppTerminal={handleOpenAppTerminal}
              onToggleAppStatus={handleToggleAppStatus}
              onUpdateApp={handleUpdateApp}
              onShowToast={showToast}
            />
          )}

          {currentTab === 'pods' && (
            <PodsView
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
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
              onOpenTerminal={() => navigate('terminal')}
            />
          )}

          {currentTab === 'domains' && (
            <DomainsView
              apps={apps}
              onShowToast={showToast}
            />
          )}

          {currentTab === 'backup' && (
            <BackupMigrationView
              apps={apps}
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
            />
          )}

          {currentTab === 'settings' && (
            <PanelSettingsView
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
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
