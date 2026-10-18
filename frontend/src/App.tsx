import { useState, useEffect, useRef, useCallback } from 'react';
import { Server, Sparkles, X } from 'lucide-react';
import type { NavItem, WebApp, UpdateInfo } from './types';
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
import { DeployLogPanel } from './components/DeployLogPanel';
import { Footer } from './components/Footer';
import { ProfileView } from './components/ProfileView';
import { DomainsView } from './components/DomainsView';
import { HostFilesView } from './components/HostFilesView';
import { StackView } from './components/StackView';
import { BackupMigrationView } from './components/BackupMigrationView';
import { ToastContainer } from './components/Toast';
import type { ToastMessage } from './components/Toast';
import { LoginView } from './components/LoginView';
import { useSession } from './hooks/useSession';
import { useIsDesktop } from './hooks/useIsDesktop';
import { api } from './api/client';
import { toWebApp, formatBytes } from './api/adapters';
import { siteSupportsShell, siteShellNote } from './utils/siteRuntime';
import { isNewerVersion } from './version';

// Identity used only while the daemon is unreachable (simulation mode).
const MOCK_USER = { username: 'farras', role: 'admin' as const };

const TAB_PATHS: Record<NavItem, string> = {
  overview: '/overview',
  monitoring: '/monitoring',
  web: '/web',
  pods: '/pods',
  databases: '/databases',
  domains: '/domains',
  tunnels: '/tunnels',
  terminal: '/terminal',
  users: '/users',
  stack: '/stack',
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
  if (clean === '/login') return { tab: 'web' };
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'web' || parts[0] === 'apps' || parts[0] === 'websites') {
    return {
      tab: 'web',
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
  return { tab: 'web', unmatchedPath: clean };
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
  // Below `lg` the sidebar is an overlay drawer rather than a column. This is its open state,
  // and `isDesktop` is the breakpoint that decides which job the header's menu button has.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isDesktop = useIsDesktop();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  // The deploy whose log is on screen: POST /websites answers 202, so the only honest
  // progress is the daemon's own stream (see DeployLogPanel).
  const [deployWatch, setDeployWatch] = useState<{ slug: string; deployId?: string } | null>(null);
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

  // An open drawer covers the page, so it needs a way out that is not a mis-tap: Escape, and
  // the page behind it must stop scrolling.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  // Navigate to an explicit path (menu endpoint or app detail deep-link)
  const navigatePath = (path: string) => {
    // Any navigation closes the drawer: picking a destination is how a phone leaves it.
    setMobileNavOpen(false);
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
    if (path !== '/' && path !== TAB_PATHS.overview && path !== TAB_PATHS.web) setRedirectTo(path);
    window.history.replaceState(null, '', '/login');
    setRoute(parseRoute('/login'));
  }, [signedOut]);

  const handleSignIn = async (username: string, password: string, totpCode?: string) => {
    const ok = await session.signIn(username, password, totpCode);
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

  const showToast = useCallback((title: string, message?: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, title, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Periodic background check for panel updates (Admin only)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!isAdmin || session.mode !== 'live') return;
    let mounted = true;

    const check = async () => {
      try {
        const res = await api.checkUpdates();
        if (!mounted || !res) return;
        if (res.hasUpdate && res.latestVersion && isNewerVersion(res.latestVersion, res.currentVersion)) {
          const info: UpdateInfo = {
            hasUpdate: true,
            latestVersion: res.latestVersion,
            currentVersion: res.currentVersion,
            releaseTag: res.release?.tag,
            changelogMarkdown: res.release?.changelogMarkdown,
            publishedAt: res.release?.publishedAt,
          };
          setUpdateInfo(info);

          // If this version hasn't been toasted this session, show a friendly toast
          const toastKey = `notified_update_${res.latestVersion}`;
          if (!sessionStorage.getItem(toastKey)) {
            sessionStorage.setItem(toastKey, '1');
            showToast(
              'Update Available',
              `BarePod Panel v${res.latestVersion} is ready to install. Click Settings > Updates to view details.`,
              'info'
            );
          }
        } else {
          setUpdateInfo(null);
        }
      } catch {
        // Silently ignore background update check errors
      }
    };

    // Initial check after 2 seconds to not block primary dashboard data
    const initTimer = setTimeout(check, 2000);
    // Periodically check every 30 minutes
    const interval = setInterval(check, 30 * 60 * 1000);

    return () => {
      mounted = false;
      clearTimeout(initTimer);
      clearInterval(interval);
    };
  }, [isAdmin, session.mode, showToast]);

  const isBannerVisible = Boolean(
    isAdmin &&
    updateInfo?.hasUpdate &&
    !bannerDismissed &&
    !sessionStorage.getItem(`dismissed_banner_${updateInfo?.latestVersion}`)
  );

  const dismissBanner = () => {
    setBannerDismissed(true);
    if (updateInfo?.latestVersion) {
      sessionStorage.setItem(`dismissed_banner_${updateInfo.latestVersion}`, '1');
    }
  };

  // First run: a fresh host has no runtimes or databases yet, so offer to install them in one go
  // (recommended versions, the admin picks) instead of leaving a blank Stack page.
  const [stackPrompt, setStackPrompt] = useState(false);
  useEffect(() => {
    if (!isAdmin || session.mode !== 'live') return;
    if (localStorage.getItem('barepod_stack_prompt_done') === '1') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const s = await api.stack();
        if (cancelled) return;
        const anyRuntime = Object.values(s.runtimes ?? {}).some((r) => (r.installed?.length ?? 0) > 0);
        const anyDatabase = (s.databases ?? []).some((d) => Boolean(d.installedVersion));
        if (!anyRuntime && !anyDatabase) setStackPrompt(true);
        else localStorage.setItem('barepod_stack_prompt_done', '1');
      } catch {
        // The Stack page stays reachable from the menu.
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isAdmin, session.mode]);

  const closeStackPrompt = (openPicker: boolean) => {
    localStorage.setItem('barepod_stack_prompt_done', '1');
    setStackPrompt(false);
    if (openPicker) {
      sessionStorage.setItem('barepod_open_bundle', '1');
      navigatePath(TAB_PATHS.stack);
    }
  };

  // Protect admin-only routes from regular users navigating directly via URL
  useEffect(() => {
    if (session.mode !== 'live' || !session.user) return;
    if (route.tab === 'users' && !isAdmin && !session.can('users')) {
      showToast('Access restricted', 'Your account does not have permission to manage users.', 'info');
      setCurrentTab('web');
    } else if (route.tab === 'settings' && !isAdmin) {
      showToast('Access restricted', 'Panel settings are restricted to administrators.', 'info');
      setCurrentTab('web');
    }
  }, [route.tab, session.mode, session.user, isAdmin, session.can]);

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

  const handleAddApp = async (newApp: Partial<WebApp>, archive?: File): Promise<void> => {
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
    // Live: the wizard used to update local state and call nothing, which is how a
    // screen can look like a deploy while the daemon never hears about it.
    if (session.mode === 'live' && session.user) {
      const slug = created.name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
      try {
        const result = await api.createWebsite({
          slug,
          domain: created.domain,
          tenantUser: created.tenantUser,
          runtime: created.runtime,
          version: newApp.version,
          framework: created.framework,
          frameworkVersion: newApp.frameworkVersion,
          webServer: created.webServer,
          port: newApp.port,
          tunnelEnabled: created.tunnelEnabled,
          upstreamUrl: newApp.upstreamUrl,
          proxyWebsocket: newApp.proxyWebsocket,
          proxyPreserveHost: newApp.proxyPreserveHost,
          proxyRealIp: newApp.proxyRealIp,
          proxyTimeoutSecs: newApp.proxyTimeoutSecs,
          source: {
            kind: created.runtime === 'proxy' ? 'default' : (newApp.sourceKind ?? (newApp.gitRepo ? 'github' : 'existing')),
            repo: created.runtime === 'proxy' ? undefined : newApp.gitRepo,
            branch: created.runtime === 'proxy' ? undefined : newApp.gitBranch,
          },
          database:
            created.runtime !== 'proxy' && newApp.dbAutoProvision && newApp.dbEngine
              ? { engine: newApp.dbEngine, name: newApp.dbName, user: newApp.dbUser }
              : undefined,
          cache: created.runtime !== 'proxy' && newApp.cacheAutoProvision ? { engine: 'redis' } : undefined,
          autoEnv: created.runtime !== 'proxy' ? newApp.autoEnv : false,
          env: created.runtime !== 'proxy' ? newApp.env : undefined,
          deployScript: created.runtime === 'proxy' ? undefined : newApp.buildScript,
        });
        // An "Upload Archive" source has to actually arrive: the bytes go to the site,
        // then the pipeline runs again so it builds with the code present (the create
        // ran before anything was uploaded).
        if (archive) {
          await api.uploadFiles(slug, '', [archive]);
          const again = await api.redeploy(slug);
          showToast('Archive uploaded', `${archive.name} sent to ${slug}; rebuilding (job ${again.deployId}).`, 'success');
          setDeployWatch({ slug, deployId: again.deployId });
          setAppsLoaded(true);
          return;
        }
        showToast('Deploy started', `${slug} — ${result.mode}. Its log is streaming below.`, 'success');
        setDeployWatch({ slug, deployId: result.deployId });
      } catch (err) {
        showToast('Deploy refused', err instanceof Error ? err.message : 'The daemon refused.', 'error');
        throw err;
      }
      return;
    }

    setApps([created, ...apps]);
    showToast(
      created.runtime === 'proxy' ? 'Reverse Proxy Live' : 'App Deployed Successfully',
      `${created.name} (${created.runtime === 'proxy' ? created.upstreamUrl : created.runtime.toUpperCase()}) is active.`
    );
  };

  const handleToggleAppStatus = async (appId: string) => {
    const target = apps.find(a => a.id === appId || a.name === appId);
    if (!target) return;
    const isCurrentlyRunning = target.status === 'running';
    const nextAction: 'start' | 'stop' = isCurrentlyRunning ? 'stop' : 'start';
    const nextStatus = isCurrentlyRunning ? 'stopped' : 'running';

    // Optimistic UI update
    setApps(prev => prev.map(a => (a.id === appId || a.name === appId) ? {
      ...a,
      status: nextStatus,
      memoryUsage: nextStatus === 'running' ? a.memoryUsage : '0 MB',
    } : a));

    try {
      if (session.mode === 'live') {
        const res = await api.websiteAction(target.name, nextAction);
        const resolvedStatus = (res.status as any) || nextStatus;
        showToast(
          nextAction === 'start' ? 'Service Started' : 'Service Stopped',
          `Application ${target.name} is now ${resolvedStatus}.`,
          'success'
        );
        setApps(prev => prev.map(a => (a.id === appId || a.name === appId) ? {
          ...a,
          status: resolvedStatus,
          memoryUsage: resolvedStatus === 'running' ? a.memoryUsage : '0 MB',
        } : a));
      } else {
        showToast(
          nextAction === 'start' ? 'Service Started' : 'Service Stopped',
          `Application ${target.name} is now ${nextStatus} (simulation).`,
          'info'
        );
      }
    } catch (err: any) {
      // Revert optimistic update on failure
      setApps(prev => prev.map(a => (a.id === appId || a.name === appId) ? {
        ...a,
        status: target.status,
      } : a));
      showToast(
        `Failed to ${nextAction} service`,
        err?.message || `Could not ${nextAction} ${target.name}`,
        'error'
      );
    }
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

  const handleDeleteApp = async (slug: string, options?: { databases?: 'keep' | 'delete' }) => {
    try {
      if (session.mode === 'live') {
        await api.deleteWebsite(slug, options);
      }
      setApps((prev) => prev.filter((a) => a.name !== slug && a.id !== slug));
      showToast('Website Deleted', `Website ${slug} has been permanently deleted.`, 'success');
      if (route.appSlug === slug) {
        navigatePath(TAB_PATHS.web);
      }
    } catch (err: any) {
      showToast('Could not delete website', err.message || String(err), 'error');
      throw err;
    }
  };

  if (session.mode === 'checking') {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-100">
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
        totpRequired={session.totpRequired}
        redirectTo={redirectTo ?? undefined}
      />
    );
  }

  if (loggedOut) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-slate-100 p-4">
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
    <div className="flex h-dvh bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* On a phone the sidebar overlays the page, so a backdrop gives it a way out by tapping
          away. Hidden at `lg`, where the sidebar is a column again. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={navigate}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        isAdmin={isAdmin}
        can={session.can}
        updateInfo={updateInfo}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <Header
          onToggleSidebar={() => {
            // One button, two jobs: collapse the column on a desktop, open the drawer below it.
            if (isDesktop) setSidebarCollapsed(!sidebarCollapsed);
            else setMobileNavOpen(true);
          }}
          onOpenTerminal={() => navigate('terminal')}
          activeTab={currentTab}
          onNavigatePath={navigatePath}
          currentUser={session.user}
          isAdmin={isAdmin}
          updateInfo={updateInfo}
          onLogout={() => {
            if (session.mode === 'live') {
              void session.signOut();
            } else {
              setLoggedOut(true);
            }
          }}
        />

        {/* Update Notification Banner */}
        {isBannerVisible && (
          <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 text-white px-4 py-2 text-xs flex items-center justify-between shadow-xs border-b border-blue-500/30 shrink-0 animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1 rounded-md bg-white/10 shrink-0 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              </span>
              <span className="truncate">
                <strong>Update Available:</strong> BarePod Panel <strong>v{updateInfo!.latestVersion}</strong> is ready to install (current: v{updateInfo!.currentVersion}).
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <button
                onClick={() => navigatePath('/settings/updates')}
                className="px-3 py-1 bg-white text-blue-700 font-bold rounded-md hover:bg-blue-50 transition-colors shadow-2xs cursor-pointer"
              >
                Update Now
              </button>
              <button
                onClick={dismissBanner}
                className="p-1 hover:bg-white/20 rounded transition-colors text-white/80 hover:text-white cursor-pointer"
                title="Dismiss notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Dynamic Views */}
        <main ref={mainRef} data-scroll-root className="flex-1 overflow-y-auto">
          {currentTab === 'overview' && (
            <OverviewView
              apps={apps}
              onNavigate={navigate}
              onSelectApp={(slug) => navigatePath(`/web/${encodeURIComponent(slug)}`)}
              onOpenAddModal={() => setIsAddModalOpen(true)}
            />
          )}

          {currentTab === 'files' && (
            <HostFilesView 
              isAdmin={isAdmin} 
              currentUser={session.user} 
              onShowToast={showToast} 
            />
          )}
          {currentTab === 'stack' && isAdmin && <StackView onShowToast={showToast} />}

          {currentTab === 'monitoring' && (
            <ServerMonitoringView
              isAdmin={isAdmin}
              onShowToast={showToast}
              onOpenTerminal={() => navigate('terminal')}
            />
          )}

          {currentTab === 'web' && (
            <AppsView
              apps={apps}
              appsLoaded={appsLoaded}
              isAdmin={isAdmin}
              onWatchDeploy={(slug, deployId) => setDeployWatch({ slug, deployId })}
              selectedAppSlug={route.appSlug ?? null}
              appSubTab={route.appSubTab}
              onSelectApp={(slug) => navigatePath(`/web/${encodeURIComponent(slug)}`)}
              onSubTabChange={(sub) => {
                if (route.appSlug) navigatePath(`/web/${encodeURIComponent(route.appSlug)}/${sub}`);
              }}
              onOpenAppFiles={(app) => navigatePath(`/web/${encodeURIComponent(app.name)}/files`)}
              onBack={() => navigatePath(TAB_PATHS.web)}
              onOpenAddModal={() => setIsAddModalOpen(true)}
              onOpenAppTerminal={handleOpenAppTerminal}
              onToggleAppStatus={handleToggleAppStatus}
              onUpdateApp={handleUpdateApp}
              onDeleteApp={handleDeleteApp}
              onShowToast={showToast}
            />
          )}

          {currentTab === 'pods' && (
            <PodsView
              isAdmin={isAdmin}
              onShowToast={showToast}
              onOpenTerminal={(podId) => {
                // A pod's shell must land on that container, not on a website.
                openShellOn({ kind: 'pod', id: podId });
              }}
            />
          )}

          {currentTab === 'databases' && (
            <DatabasesView isAdmin={isAdmin} onShowToast={showToast} />
          )}

          {currentTab === 'tunnels' && (
            <CloudflareTunnelView onShowToast={showToast} currentUser={currentUser.username} />
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
              currentUsername={session.user?.username ?? MOCK_USER.username}
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
            <ProfileView
              onShowToast={showToast}
              onNavigatePath={navigatePath}
              currentUser={session.user}
              permissions={session.permissions}
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
              isAdmin={isAdmin}
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
        currentUsername={currentUser.username}
        isAdmin={isAdmin}
        existingApps={apps}
      />

      {/* The deploy's own log, straight from the daemon (see POST /websites: 202). */}
      {deployWatch && (
        <DeployLogPanel
          slug={deployWatch.slug}
          deployId={deployWatch.deployId}
          onClose={() => setDeployWatch(null)}
          onFinished={(job) => {
            showToast(
              job.status === 'success' ? 'Website deployed' : 'Deploy failed',
              job.status === 'success'
                ? `${deployWatch.slug} is live (${job.mode}).`
                : `${deployWatch.slug}: see the log for the daemon's reason.`,
              job.status === 'success' ? 'success' : 'error',
            );
            void (async () => {
              try {
                const { items } = await api.websites();
                setApps(items.map((site) => toWebApp(site)));
                setAppsLoaded(true);
              } catch {
                // The list refreshes on the next load anyway.
              }
            })();
          }}
        />
      )}

      {stackPrompt && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-900">Set up your server stack</h3>
            </div>
            <div className="p-5 text-sm text-slate-600 space-y-2">
              <p>BarePod is installed. Pick the web servers, runtimes and databases you want on this server.</p>
              <p className="text-xs text-slate-500">Recommended versions are preselected; you can untick anything you do not need. This can also be done later from the Stack page.</p>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => closeStackPrompt(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                Later
              </button>
              <button
                onClick={() => closeStackPrompt(true)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-xs"
              >
                Choose components
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Toast Notifications */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
      />
    </div>
  );
}

export default App;
