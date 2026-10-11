import { useState, useEffect, useRef } from 'react';
import { Server } from 'lucide-react';
import type { NavItem, WebApp } from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { AppsView } from './components/AppsView';
import { AddAppModal } from './components/AddAppModal';
import { WebTerminalView } from './components/WebTerminalView';
import { DatabasesView } from './components/DatabasesView';
import { CloudflareTunnelView } from './components/CloudflareTunnelView';
import { PodsView, BAREPOD_DEMO_PODS } from './components/PodsView';
import { UsersView } from './components/UsersView';
import { OverviewView } from './components/OverviewView';
import { ServerMonitoringView } from './components/ServerMonitoringView';
import { PanelSettingsView } from './components/PanelSettingsView';
import { ApiMcpView } from './components/ApiMcpView';
import { Footer } from './components/Footer';
import { ProfileView } from './components/ProfileView';
import { DomainsView } from './components/DomainsView';
import { HostFilesView } from './components/HostFilesView';
import { BackupMigrationView } from './components/BackupMigrationView';
import { ToastContainer } from './components/Toast';
import type { ToastMessage } from './components/Toast';
import { LoginView } from './components/LoginView';
import { useSession } from './hooks/useSession';
import { api } from './api/client';
import { toWebApp, formatBytes } from './api/adapters';
import { siteSupportsShell, siteShellNote } from './utils/siteRuntime';

// Identity used only while the daemon is unreachable (simulation mode).
const MOCK_USER = { username: 'farras', role: 'admin' as const };

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
  api: '/api',
  profile: '/profile',
  files: '/files',
  backup: '/backup',
};

interface AppRoute {
  tab: NavItem;
  appSlug?: string;
  appSubTab?: string;
  /** Set when the requested path is not a panel route. */
  unmatchedPath?: string;
}

const parseRoute = (pathname: string): AppRoute => {
  const clean = pathname.replace(/\/+$/, '') || '/';
  // A bare "/" is the default landing page: Overview, not the website list.
  if (clean === '/') return { tab: 'overview' };
  // /login is the signed-out address; it is not a panel page but it is valid,
  // so refreshing there must not be reported as a missing page.
  if (clean === '/login') return { tab: 'apps' };
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'apps') {
    return {
      tab: 'apps',
      appSlug: parts[1] ? decodeURIComponent(parts[1]) : undefined,
      appSubTab: parts[2] ? decodeURIComponent(parts[2]) : undefined,
    };
  }
  const match = (Object.keys(TAB_PATHS) as NavItem[]).find((tab) => TAB_PATHS[tab] === `/${parts[0]}`);
  if (match) {
    return { tab: match, appSubTab: parts[1] ? decodeURIComponent(parts[1]) : undefined };
  }
  // Unknown path: fall back to Websites, but say so — the caller corrects the
  // URL instead of leaving an address that does not match what is on screen.
  return { tab: 'apps', unmatchedPath: clean };
};

// Realistic sample web apps used while the daemon is not running.
const MOCK_APPS: WebApp[] = [
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
];

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));
  const currentTab = route.tab;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [loggedOut, setLoggedOut] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);
  const [terminalTarget, setTerminalTarget] = useState<{ kind: 'site' | 'pod'; id: string } | null>(null);

  // Session: the daemon answers (live) or the prototype stays on mock data.
  const session = useSession();
  const currentUser = session.user ?? MOCK_USER;
  const isAdmin = currentUser.role === 'admin';

  // Every menu change starts at the top of the page — without this, a component
  // that focuses an input (the terminal, the host console) drags the view down
  // and the next page looks like it opened in the middle.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [route.tab, route.appSlug, route.appSubTab]);

  // Navigate to an explicit path (menu endpoint or app detail deep-link)
  const navigatePath = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setRoute(parseRoute(path));
  };

  const setCurrentTab = (tab: NavItem) => navigatePath(TAB_PATHS[tab]);

  // Menu navigation. The Terminal menu always starts from the session picker;
  // opening a shell from a website or pod goes through openShellOn instead, so
  // that shortcut keeps its target.
  const navigate = (tab: NavItem) => {
    if (tab === 'terminal') setTerminalTarget(null);
    setCurrentTab(tab);
  };

  /** Open the Terminal page already attached to a website or container. */
  const openShellOn = (target: { kind: 'site' | 'pod'; id: string }) => {
    setTerminalTarget(target);
    setCurrentTab('terminal');
  };

  // Signed out, the address bar says so: the URL becomes /login instead of
  // showing a login form under a protected path. Where you were heading is
  // remembered, so signing in still takes you there.
  const signedOut = session.mode === 'live' && !session.user;
  useEffect(() => {
    if (!signedOut) return;
    const path = window.location.pathname + window.location.search;
    if (path === '/login') return;
    if (path !== '/' && path !== TAB_PATHS.overview && path !== TAB_PATHS.apps) setRedirectTo(path);
    window.history.replaceState(null, '', '/login');
    setRoute(parseRoute('/login'));
  }, [signedOut]);

  const handleSignIn = async (username: string, password: string) => {
    const ok = await session.signIn(username, password);
    if (ok) {
      const target = redirectTo ?? TAB_PATHS.overview;
      setRedirectTo(null);
      window.history.replaceState(null, '', target);
      setRoute(parseRoute(target));
    }
    return ok;
  };

  // Normalize bare "/" to the default menu endpoint (Overview) — but only once we
  // know the visitor is signed in. Without the guard, a fresh visit rewrote the
  // address even while the login screen was on display.
  useEffect(() => {
    if (session.mode === 'checking') return;
    if (signedOut) return;
    if (window.location.pathname === '/') {
      window.history.replaceState(null, '', TAB_PATHS.overview);
    }
  }, [session.mode, signedOut]);

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

  // A path that is not a panel route is corrected to a real one, so the address
  // bar always matches what is on screen instead of silently rendering Websites
  // under an unknown URL.
  useEffect(() => {
    if (!route.unmatchedPath) return;
    // While signed out the login screen owns the address bar.
    if (signedOut) return;
    const fallback = TAB_PATHS[route.tab];
    window.history.replaceState(null, '', fallback);
    setRoute(parseRoute(fallback));
    showToast('Page not found', `"${route.unmatchedPath}" is not a panel page.`, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.unmatchedPath]);

  // Realistic sample web apps with OpenLiteSpeed, Nginx, Caddy, Apache & Flask, Laravel, Next.js
  // The prototype data; restored whenever the daemon is not driving the UI.
  const [apps, setApps] = useState<WebApp[]>(MOCK_APPS);
  /**
   * True once the website list is final (mock data, or the daemon's answer).
   * Deep links are only validated after that, otherwise a live slug would be
   * checked against the prototype list and wrongly rejected.
   */
  const [appsLoaded, setAppsLoaded] = useState(false);

  // Live mode: replace the mock list with the daemon's websites (with their
  // service metrics). Simulation mode keeps the mock array untouched.
  useEffect(() => {
    if (session.mode === 'mock') {
      // Back to the prototype data, so the two modes never mix.
      setApps(MOCK_APPS);
      setAppsLoaded(true);
      return;
    }
    if (session.mode !== 'live' || !session.user) return;
    let cancelled = false;

    (async () => {
      try {
        const { items } = await api.websites();
        const mapped = await Promise.all(
          items.map(async (site) => {
            try {
              const series = await api.siteMetrics(site.slug, '5m');
              return toWebApp(site, series.latest);
            } catch {
              return toWebApp(site);
            }
          }),
        );
        if (!cancelled) {
          setApps(mapped);
          setAppsLoaded(true);
        }
      } catch {
        // Keep whatever is on screen; deep links are not validated against a
        // list we could not load.
        if (!cancelled) setAppsLoaded(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session.mode, session.user]);

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
    if (!siteSupportsShell(app)) {
      showToast(
        'No shell on this website',
        siteShellNote(app),
        'info',
      );
      return;
    }
    openShellOn({ kind: 'site', id: app.id });
    showToast('Terminal Session Loaded', `Switched environment context to ${app.name} (${app.runtime.toUpperCase()} ${app.version}).`, 'info');
  };

  const handleUpdateApp = (updated: WebApp) => {
    setApps(apps.map(a => a.id === updated.id ? updated : a));
  };

  if (session.mode === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <Server className="w-5 h-5 animate-pulse text-blue-600" />
          <span>Looking for the BarePod daemon…</span>
        </div>
      </div>
    );
  }

  if (signedOut) {
    return (
      <LoginView
        onSignIn={handleSignIn}
        onSimulate={session.useSimulation}
        error={session.error}
        busy={session.busy}
        mode={session.mode}
        redirectTo={redirectTo ?? undefined}
      />
    );
  }

  if (loggedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-8 w-full max-w-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center mx-auto shadow-sm shadow-blue-500/25">
            <Server className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Signed out</h1>
            <p className="text-xs text-slate-500 mt-1">You have been signed out of BarePod Panel.</p>
          </div>
          <button
            onClick={() => setLoggedOut(false)}
            className="w-full px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Return to the panel
          </button>
          <p className="text-[10px] text-slate-400">Authentication is simulated in this mode.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={navigate}
        collapsed={sidebarCollapsed}
        isAdmin={isAdmin}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
          onOpenTerminal={() => navigate('terminal')}
          activeTab={currentTab}
          onNavigatePath={navigatePath}
          onLogout={() => {
            if (session.mode === 'live') {
              void session.signOut();
            } else {
              setLoggedOut(true);
            }
          }}
        />

        {/* Dynamic Views */}
        <main ref={mainRef} data-scroll-root className="flex-1 overflow-y-auto">
          {currentTab === 'overview' && (
            <OverviewView
              apps={apps}
              onNavigate={navigate}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentTab === 'files' && isAdmin && <HostFilesView onShowToast={showToast} />}

          {currentTab === 'files' && !isAdmin && (
            <div className="p-8 max-w-3xl mx-auto">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-2">
                <h2 className="text-sm font-bold text-slate-900">Administrators only</h2>
                <p className="text-xs text-slate-500">
                  The host file browser spans every account, so it is limited to administrators. Your own files live in
                  the File Manager of each website.
                </p>
              </div>
            </div>
          )}

          {currentTab === 'monitoring' && (
            <ServerMonitoringView
              isAdmin={isAdmin}
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
            />
          )}

          {currentTab === 'apps' && (
            <AppsView
              apps={apps}
              appsLoaded={appsLoaded}
              selectedAppSlug={route.appSlug ?? null}
              appSubTab={route.appSubTab}
              onSelectApp={(slug) => navigatePath(`/apps/${encodeURIComponent(slug)}`)}
              onSubTabChange={(sub) => {
                if (route.appSlug) navigatePath(`/apps/${encodeURIComponent(route.appSlug)}/${sub}`);
              }}
              onOpenAppFiles={(app) => navigatePath(`/apps/${encodeURIComponent(app.name)}/files`)}
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
              onOpenTerminal={(podId) => {
                // A pod's shell must land on that container, not on a website.
                openShellOn({ kind: 'pod', id: podId });
              }}
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
              pods={BAREPOD_DEMO_PODS}
              target={terminalTarget}
              liveMode={session.mode === 'live'}
              isAdmin={isAdmin}
              onSelectTarget={(next) => {
                setTerminalTarget(next);
                const label = next.kind === 'pod'
                  ? BAREPOD_DEMO_PODS.find((p) => p.id === next.id)?.name
                  : apps.find((a) => a.id === next.id)?.name;
                if (label) {
                  showToast(
                    next.kind === 'pod' ? 'Container Shell Loaded' : 'CLI Environment Switched',
                    next.kind === 'pod' ? `Exec session attached to ${label}.` : `Active context: ${label}`,
                    'info',
                  );
                }
              }}
              onOpenHostConsole={() => navigate('monitoring')}
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

          {currentTab === 'api' && (
            <ApiMcpView onShowToast={showToast} />
          )}

          {currentTab === 'profile' && (
            <ProfileView onShowToast={showToast} onNavigatePath={navigatePath} />
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

          <Footer daemonVersion={session.daemonVersion} />
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
