import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { siteSupportsShell, siteSupportsFiles, siteSupportsCI, siteHasGit, siteShellNote, siteFilesNote, siteCINote, siteTabSupport, type SiteTabSupport } from '../utils/siteRuntime';
import { 
  ArrowLeft, 
  Activity, 
  Terminal, 
  FileText, 
  Cpu, 
  HardDrive, 
  Globe, 
  Server, 
  CloudRain, 
  ShieldCheck, 
  Play, 
  Square, 
  RotateCw, 
  Folder, 
  FolderGit2, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle, 
  Info,
  Search, 
  Download, 
  Trash2, 
  Layers, 
  Pencil,
  Zap, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Clock, 
  Check, 
  Copy,
  Lock,
  GitBranch,
  Filter,
  Eye,
  EyeOff,
  ArrowRightLeft,
  Wifi,
  Code2,
  Plus,
  Sliders,
  Settings,
  Boxes,
  FileCode,
  ToggleLeft,
  ToggleRight,
  Package,
  Shield,
  AlertTriangle,
  Key,
  RefreshCw,
  Save,
  Radio,
  Sparkles,
  Sun,
  Moon,
  MapPin,
  ChevronDown,
  ChevronRight,
  Archive,
  HelpCircle,
  Loader2,
  X
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';
import { PhpExtensionsPanel } from './PhpExtensionsPanel';
import { WORLD_MAP_PATH } from '../data/worldMapPath';
import { runtimeIcon, frameworkIcon } from '../utils/brandIcons';
import { FileManagerModal } from './FileManagerModal';
import { MaintenancePreviewModal } from './MaintenancePreviewModal';
import { BasicAuthPromptModal } from './BasicAuthPromptModal';
import { DangerConfirmModal } from './DangerConfirmModal';
import { api, apiReachable, subscribeDeploy, type ApiDomain, type ApiWebsiteTelemetry, type ApiTelemetryNode, type ApiWebsiteGitStatus, type ApiDeployKey, type DeployJob, type DetectedFramework, type CloudflareZone, type TunnelStatusResponse, type DomainValidationResult } from '../api/client';
import { describeError } from '../utils/format';

export type AppDetailTab =
  | 'monitoring'
  | 'overview'
  | 'logs'
  | 'map'
  | 'domains'
  | 'routing'
  | 'files'
  | 'env'
  | 'php'
  | 'runtime'
  | 'security'
  | 'deploy'
  // Group aliases accepted from a URL; normalised to a concrete view below.
  | 'observability';

type TabGroupId = 'overview' | 'runtime' | 'gateway' | 'deploy' | 'files' | 'observability' | 'domains' | 'security';

interface TabGroupDef {
  id: TabGroupId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  views: AppDetailTab[];
  accent: 'blue' | 'purple' | 'amber' | 'emerald';
  subTabs?: { view: AppDetailTab; label: string }[];
}

const OBSERVABILITY_TABS: { view: AppDetailTab; label: string }[] = [
  { view: 'monitoring', label: 'Metrics' },
  { view: 'logs', label: 'Logs' },
  { view: 'map', label: 'Traffic Map' },
];

/**
 * An old bookmark keeps working. The URL still carries the concrete view id
 * (`monitoring`, `logs`, `env`, `routing`, …), which is what the content blocks use;
 * group-only names such as `observability` resolve to the view that renders them.
 */
function normalizeDetailTab(tab: string | undefined, proxy: boolean): AppDetailTab {
  switch (tab) {
    case 'observability':
      return 'monitoring';
    case 'php':
      return proxy ? 'routing' : 'runtime';
    case 'overview':
      return proxy ? 'routing' : 'overview';
    case 'routing':
      // A normal site has no routing view until the path-route API exists.
      return proxy ? 'routing' : 'runtime';
    case undefined:
    case '':
      return proxy ? 'routing' : 'overview';
    default:
      // A proxy has no runtime, files, env or deploy view; an old deep link to one must not
      // render a form the site type cannot use.
      if (proxy && (tab === 'runtime' || tab === 'files' || tab === 'env' || tab === 'deploy')) {
        return 'routing';
      }
      return tab as AppDetailTab;
  }
}

/**
 * The visual grouping of the detail page. Ten flat peers became seven groups for a
 * normal site and four for a proxy; the underlying view ids are unchanged so the
 * existing content conditions and deep links keep working.
 */
function tabGroupsFor(app: WebApp, support: SiteTabSupport): TabGroupDef[] {
  if (app.runtime === 'proxy') {
    return [
      { id: 'gateway', label: 'Gateway & Upstream', icon: Zap, views: ['routing'], accent: 'purple' },
      {
        id: 'observability', label: 'Observability', icon: Activity,
        views: ['monitoring', 'logs', 'map'], accent: 'blue', subTabs: OBSERVABILITY_TABS,
      },
      { id: 'domains', label: 'Domains & SSL', icon: Globe, views: ['domains'], accent: 'emerald' },
      { id: 'security', label: 'Access & Security', icon: Shield, views: ['security'], accent: 'purple' },
    ];
  }

  const deployViews: AppDetailTab[] = support.env ? ['deploy', 'env'] : ['deploy'];
  const groups: TabGroupDef[] = [
    { id: 'overview', label: 'Overview', icon: Server, views: ['overview'], accent: 'blue' },
    // Routing/path-splitting has no backend yet (`/websites/:slug/routes` is planned), so a normal
    // site does not get a mock tab. A proxy keeps its real Gateway view below.
    { id: 'runtime', label: 'Runtime', icon: Layers, views: ['runtime'], accent: 'purple' },
    {
      id: 'deploy', label: 'Deploy', icon: FolderGit2,
      views: deployViews, accent: 'blue',
      subTabs: support.env
        ? [
            { view: 'deploy', label: 'Build & Deploy' },
            { view: 'env', label: 'Environment (.env)' },
          ]
        : undefined,
    },
  ];
  if (support.files) {
    groups.push({ id: 'files', label: 'Files', icon: Folder, views: ['files'], accent: 'amber' });
  }
  groups.push(
    {
      id: 'observability', label: 'Observability', icon: Activity,
      views: ['monitoring', 'logs', 'map'], accent: 'blue', subTabs: OBSERVABILITY_TABS,
    },
    { id: 'domains', label: 'Domains & SSL', icon: Globe, views: ['domains'], accent: 'emerald' },
    { id: 'security', label: 'Access & Security', icon: Shield, views: ['security'], accent: 'purple' },
  );
  return groups;
}

const GROUP_ACCENT: Record<TabGroupDef['accent'], { active: string; icon: string }> = {
  blue: { active: 'border-blue-600 text-blue-700 font-bold', icon: 'text-blue-600' },
  purple: { active: 'border-purple-600 text-purple-700 font-bold', icon: 'text-purple-600' },
  amber: { active: 'border-amber-600 text-amber-700 font-bold', icon: 'text-amber-600' },
  emerald: { active: 'border-emerald-600 text-emerald-700 font-bold', icon: 'text-emerald-600' },
};

/**
 * One rendered-vhost inspector, shared by Runtime (normal sites) and Gateway (proxy).
 * It used to appear twice — a daemon-rendered copy under Security and a locally generated
 * one under Routing — which disagreed as soon as the real config changed.
 */
const VhostPreviewCard: React.FC<{
  engine: string;
  filename: string;
  config: string;
  loading: boolean;
  onRefresh: () => void;
}> = ({ engine, filename, config, loading, onRefresh }) => (
  <div className="p-5 bg-slate-900 rounded-2xl text-slate-100 space-y-3 border border-slate-800 shadow-md">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
        <span className="text-xs font-bold font-mono text-slate-200">
          Live VHost Configuration ({engine.toUpperCase()})
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="text-[10px] text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 font-mono transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh Preview</span>
        </button>
        <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">{filename}</span>
      </div>
    </div>

    <pre className="font-mono text-xs bg-slate-950 p-4 rounded-xl overflow-x-auto text-emerald-400 leading-relaxed border border-slate-800 max-h-96">
      {config || '# Loading live configuration from daemon...'}
    </pre>
  </div>
);

interface AppDetailPageProps {
  app: WebApp;
  onBack: () => void;
  onToggleStatus: (appId: string) => void;
  onOpenTerminal: (app: WebApp) => void;
  onOpenGit: (app: WebApp) => void;
  onUpdateApp?: (updated: WebApp) => void;
  onDeleteApp?: (slug: string, options?: { databases?: 'keep' | 'delete' }) => Promise<void> | void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onWatchDeploy?: (slug: string, deployId?: string) => void;
  activeTab?: AppDetailTab;
  onTabChange?: (tab: AppDetailTab) => void;
}

export const AppDetailPage: React.FC<AppDetailPageProps> = ({
  app,
  onBack,
  onToggleStatus,
  onOpenTerminal,
  onOpenGit,
  onUpdateApp,
  onDeleteApp,
  onShowToast,
  onWatchDeploy,
  activeTab: activeTabProp,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<AppDetailTab>(app.runtime === 'proxy' ? 'routing' : 'overview');
  // Normalise before every content check so `observability`/`php` URLs render the right view.
  const activeTab: AppDetailTab = normalizeDetailTab(activeTabProp ?? internalTab, app.runtime === 'proxy');
  const setActiveTab = (tab: AppDetailTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };

  // Delete Website Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteDatabasesOption, setDeleteDatabasesOption] = useState<'keep' | 'delete'>('keep');
  const [isDeletingApp, setIsDeletingApp] = useState(false);
  const [associatedDbs, setAssociatedDbs] = useState<{ id: string; name: string; alias: string; engine: string }[]>([]);

  useEffect(() => {
    if (!showDeleteModal) {
      setAssociatedDbs([]);
      return;
    }
    api.databases.list()
      .then((res) => {
        const slug = app.name || app.id;
        const matched = (res.items || []).filter(
          (d) => (d.websiteSlug === slug || d.websiteSlug === app.name) && !d.deletedAt
        );
        setAssociatedDbs(matched);
      })
      .catch(() => setAssociatedDbs([]));
  }, [showDeleteModal, app.name, app.id]);

  const tabSupport = siteTabSupport(app);
  const tabGroups = tabGroupsFor(app, tabSupport);
  const activeGroup = tabGroups.find((group) => group.views.includes(activeTab)) ?? tabGroups[0];
  // Each group remembers the sub-tab it was left on, so switching groups does not reset the view.
  const lastViewRef = useRef<Partial<Record<TabGroupId, AppDetailTab>>>({});
  useEffect(() => {
    lastViewRef.current[activeGroup.id] = activeTab;
  }, [activeTab, activeGroup.id]);
  const openTabGroup = (group: TabGroupDef) => {
    const remembered = lastViewRef.current[group.id];
    setActiveTab(remembered && group.views.includes(remembered) ? remembered : group.views[0]);
  };

  // Read the real .env when the tab opens, not on mount: most visits never look at it.
  useEffect(() => {
    if (activeTab !== 'env') return;
    let alive = true;
    setEnvLoading(true);
    api.websiteEnv(app.name)
      .then((res) => {
        if (alive) setEnvFile(res);
      })
      .catch(() => {
        if (alive) setEnvFile(null);
      })
      .finally(() => {
        if (alive) setEnvLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeTab, app.name]);

  // Tabs that do not exist for this site type are hidden, so a deep link to one
  // (or a stale tab) falls back to the primary tab instead of rendering an empty pane.
  React.useEffect(() => {
    const unavailable =
      (app.runtime === 'proxy' && (activeTab === 'php' || activeTab === 'runtime' || activeTab === 'files' || activeTab === 'env' || activeTab === 'deploy')) ||
      (activeTab === 'files' && !tabSupport.files) ||
      (activeTab === 'env' && !tabSupport.env) ||
      (activeTab === 'deploy' && !tabSupport.deploy);

    if (unavailable) {
      const fallbackTab: AppDetailTab = app.runtime === 'proxy' ? 'routing' : 'overview';
      setInternalTab(fallbackTab);
      onTabChange?.(fallbackTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, app.runtime, app.id]);
  const [logType, setLogType] = useState<'all' | 'access' | 'error' | 'deploy'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [logFormat, setLogFormat] = useState<'structured' | 'raw'>('structured');
  const [logTheme, setLogTheme] = useState<'light' | 'dark'>('light'); // Default to light mode as requested!
  const [wrapLogText, setWrapLogText] = useState(false);
  const [expandedLogIdx, setExpandedLogIdx] = useState<number | null>(null);
  const [selectedCountryFilter, setSelectedCountryFilter] = useState<string | null>(null);
  const [hoveredMapPin, setHoveredMapPin] = useState<{ country: string; name: string; flag: string; city: string; ip: string; reqs: number; latency: string; isp: string; x: number; y: number } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  // The site's real .env, read from the daemon (secret values arrive masked). The tab
  // used to render a fabricated file, which is how the panel could claim an application
  // used PostgreSQL while it ran on SQLite.
  const [envFile, setEnvFile] = useState<{ path: string; exists: boolean; masked?: boolean; content?: string; note?: string } | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  // Revealing the secrets needs elevated mode — the same gate the credential vault uses.
  const [envRevealOpen, setEnvRevealOpen] = useState(false);
  const [envPassword, setEnvPassword] = useState('');
  const [envRevealBusy, setEnvRevealBusy] = useState(false);
  const [telemetry, setTelemetry] = useState<ApiWebsiteTelemetry | null>(null);
  const [realLogs, setRealLogs] = useState<LogItem[] | null>(null);
  const [realNodes, setRealNodes] = useState<ApiTelemetryNode[] | null>(null);
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);

  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await api.websiteTelemetry(app.name);
      if (res) {
        setTelemetry(res);
        if (res.logs && res.logs.length > 0) {
          setRealLogs(res.logs as LogItem[]);
        }
        if (res.nodes && res.nodes.length > 0) {
          setRealNodes(res.nodes);
        }
      }
    } catch {
      // Fallback
    }
  }, [app.name]);

  useEffect(() => {
    fetchTelemetry();
  }, [fetchTelemetry]);

  // Connect live SSE stream when tab is 'monitoring', 'map', or 'logs'
  useEffect(() => {
    if (activeTab !== 'monitoring' && activeTab !== 'map' && activeTab !== 'logs') return;
    let es: EventSource | null = null;
    try {
      const streamUrl = api.websiteTelemetryStreamUrl(app.name);
      es = new EventSource(streamUrl);
      es.onopen = () => setIsLiveStreaming(true);
      es.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const snap = JSON.parse(e.data) as ApiWebsiteTelemetry;
          setTelemetry(snap);
          if (snap.logs && snap.logs.length > 0) setRealLogs(snap.logs as LogItem[]);
          if (snap.nodes && snap.nodes.length > 0) setRealNodes(snap.nodes);
        } catch { /* ignore */ }
      });
      es.addEventListener('hit', (e: MessageEvent) => {
        try {
          const item = JSON.parse(e.data) as LogItem;
          setRealLogs(prev => [item, ...(prev || []).slice(0, 499)]);
          setTelemetry(prev => prev ? { ...prev, totalRequests: (prev.totalRequests || 0) + 1 } : null);
        } catch { /* ignore */ }
      });
      es.addEventListener('nodes', (e: MessageEvent) => {
        try {
          const nodes = JSON.parse(e.data) as ApiTelemetryNode[];
          if (nodes && nodes.length > 0) setRealNodes(nodes);
        } catch { /* ignore */ }
      });
      es.onerror = () => {
        setIsLiveStreaming(false);
      };
    } catch {
      setIsLiveStreaming(false);
    }
    return () => {
      if (es) {
        es.close();
        setIsLiveStreaming(false);
      }
    };
  }, [app.name, activeTab]);

  // Periodic background telemetry poll when activeTab is 'monitoring'
  useEffect(() => {
    if (activeTab !== 'monitoring') return;
    const interval = setInterval(() => {
      fetchTelemetry();
    }, 4000);
    return () => clearInterval(interval);
  }, [activeTab, fetchTelemetry]);

  // Persistent Deploy & Build Script per App
  const getDefaultBuildScript = (runtime?: string, hasGit = false, branch = 'main') => {
    const gitPull = hasGit ? `git pull origin ${branch}\n` : '';
    if (runtime === 'php') {
      // Plain PHP sites are the common case: the steps below are guarded by the daemon (composer and
      // artisan run only when the file exists), and php-fpm is reloaded by the daemon itself after the
      // pool is written — a hardcoded "systemctl reload php8.4-fpm" failed on hosts with another
      // version or without that unit.
      return `${gitPull}composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache`;
    } else if (runtime === 'python') {
      return `${gitPull}source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart gunicorn`;
    } else if (runtime === 'nodejs') {
      return `${gitPull}pnpm install --frozen-lockfile
pnpm run build
pm2 reload app --update-env`;
    } else if (runtime === 'go') {
      return `${gitPull}go build -o bin/server main.go
systemctl reload app`;
    } else if (runtime === 'static') {
      return hasGit ? `git pull origin ${branch}` : `# Static website — assets served directly by web server`;
    }
    return `${gitPull}npm install
npm run build`;
  };

  const [gitRepo, setGitRepo] = useState(app.gitRepo || '');
  const [gitBranch, setGitBranch] = useState(app.gitBranch || 'main');
  const [autoDeploy, setAutoDeploy] = useState(app.autoDeploy !== false);

  const initialHasGit = Boolean(
    (app.gitRepo && app.gitRepo.trim() !== '') ||
    app.sourceKind === 'github'
  );
  const [buildScript, setBuildScript] = useState(() => {
    if (app.buildScript && app.buildScript.trim() !== '') {
      if (!initialHasGit && app.buildScript.trim().startsWith('git pull')) {
        const cleaned = app.buildScript.replace(/^git pull[^\n]*\n?/m, '').trim();
        return cleaned || getDefaultBuildScript(app.runtime, false, app.gitBranch);
      }
      return app.buildScript;
    }
    return getDefaultBuildScript(app.runtime, initialHasGit, app.gitBranch);
  });

  const [isSavingDeployScript, setIsSavingDeployScript] = useState(false);
  const [isDeployingNow, setIsDeployingNow] = useState(false);
  const [copiedDeployWebhook, setCopiedDeployWebhook] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  // Vercel-style: the source card is visible, the shell/build details are one click away.
  const [showAdvancedDeploy, setShowAdvancedDeploy] = useState(false);
  const [isLoadingDeployLogs, setIsLoadingDeployLogs] = useState(false);
  const deployLogContainerRef = useRef<HTMLDivElement>(null);

  const loadDeployLogs = useCallback((force = false) => {
    if (!force && deployLogs.length > 0) return () => {};
    setIsLoadingDeployLogs(true);
    let cancelled = false;
    let receivedAny = false;

    const stop = subscribeDeploy(
      app.name,
      undefined,
      (line) => {
        if (cancelled) return;
        receivedAny = true;
        setIsLoadingDeployLogs(false);
        setDeployLogs((prev) => {
          const formatted = `[${line.stream}] ${line.line}`;
          return prev.includes(formatted) ? prev : [...prev, formatted];
        });
      },
      (job) => {
        if (cancelled) return;
        setIsLoadingDeployLogs(false);
        if (job.status === 'failed' && job.error) {
          setDeployLogs((prev) => {
            const failLine = `[FAIL] ${job.error}`;
            return prev.includes(failLine) ? prev : [...prev, failLine];
          });
        }
      },
      () => {
        if (cancelled) return;
        setIsLoadingDeployLogs(false);
      }
    );

    const safetyTimer = setTimeout(() => {
      if (!cancelled && !receivedAny) {
        setIsLoadingDeployLogs(false);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      stop();
    };
  }, [app.name, deployLogs.length]);

  // Deployment history: the daemon keeps the newest ten jobs per site (commit, author, duration,
  // status). The Deploy tab shows it below the live log so past runs stay inspectable.
  const [deployHistory, setDeployHistory] = useState<DeployJob[]>([]);
  const [isLoadingDeployHistory, setIsLoadingDeployHistory] = useState(false);

  const loadDeployHistory = useCallback(() => {
    setIsLoadingDeployHistory(true);
    api.deployHistory(app.name, 10)
      .then((res) => setDeployHistory(res.items || []))
      .catch(() => setDeployHistory([]))
      .finally(() => setIsLoadingDeployHistory(false));
  }, [app.name]);

  // Replay a past job's persisted log in the same terminal the live stream uses.
  const handleViewDeployLog = async (job: DeployJob) => {
    // The log terminal lives on the Deploy view; from Overview the click must bring it into view.
    setActiveTab('deploy');
    setDeployLogs([`[${new Date().toLocaleTimeString()}] Loading log for deploy ${job.id} (${job.status})...`]);
    try {
      const res = await api.deployJob(app.name, job.id);
      setDeployLogs(res.log.map((l) => `[${l.stream}] ${l.line}`));
    } catch (err) {
      setDeployLogs([`[FAIL] Could not load the log: ${err instanceof Error ? err.message : 'unknown error'}`]);
    }
    // Wait for the Deploy view to render before looking for its terminal element.
    setTimeout(() => {
      document.getElementById('deploy-log-terminal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  // Auto-fetch the deployment timeline for Deploy *and* Overview (the summary shows the last run);
  // the live log stream itself only matters on the Deploy tab.
  useEffect(() => {
    if (activeTab === 'deploy' || activeTab === 'overview') {
      loadDeployHistory();
    }
    if (activeTab === 'deploy') {
      const cleanup = loadDeployLogs();
      return cleanup;
    }
  }, [activeTab, loadDeployLogs, loadDeployHistory]);

  // Auto-scroll the log box itself, never the page. scrollIntoView on a child element scrolls
  // every scrollable ancestor, which is why opening /web/<slug>/deploy directly used to land at
  // the bottom of the whole page as soon as the replayed log arrived.
  useEffect(() => {
    const box = deployLogContainerRef.current;
    if (box && deployLogs.length > 0) {
      box.scrollTop = box.scrollHeight;
    }
  }, [deployLogs.length]);

  const [gitStatus, setGitStatus] = useState<ApiWebsiteGitStatus | null>(null);
  const [loadingGitStatus, setLoadingGitStatus] = useState(false);
  const [deployKeyInfo, setDeployKeyInfo] = useState<ApiDeployKey | null>(null);
  const [copiedDeployKey, setCopiedDeployKey] = useState(false);
  const [isRotatingDeployKey, setIsRotatingDeployKey] = useState(false);
  const [showConnectGit, setShowConnectGit] = useState(false);

  const isGitConnected = Boolean(
    (gitRepo && gitRepo.trim() !== '') || 
    (app.gitRepo && app.gitRepo.trim() !== '') || 
    app.sourceKind === 'github' ||
    (gitStatus && gitStatus.detected && Boolean(gitStatus.repo?.trim()))
  );

  const handleBranchChange = (newBranch: string) => {
    setGitBranch(newBranch);
    const trimmed = newBranch.trim();
    if (trimmed && buildScript.includes('git pull origin')) {
      setBuildScript((prev) => prev.replace(/^git pull origin\s+[^\s\n]+/m, `git pull origin ${trimmed}`));
    }
  };

  const handleToggleGitPull = () => {
    const targetBranch = gitBranch.trim() || app.gitBranch || gitStatus?.branch || 'main';
    const pullLine = `git pull origin ${targetBranch}`;
    if (buildScript.includes('git pull')) {
      const stripped = buildScript.replace(/^git pull[^\n]*\n?/m, '').trim();
      setBuildScript(stripped);
      onShowToast?.('Git Pull Removed', 'Removed "git pull" step from build script.', 'info');
    } else {
      const added = `${pullLine}\n${buildScript.trim()}`.trim();
      setBuildScript(added);
      onShowToast?.('Git Pull Added', `Added "${pullLine}" at the beginning of the script.`, 'info');
    }
  };

  useEffect(() => {
    setGitRepo(app.gitRepo || '');
    setGitBranch(app.gitBranch || 'main');
    if (app.autoDeploy !== undefined) setAutoDeploy(app.autoDeploy);

    setLoadingGitStatus(true);
    api.websiteGitStatus(app.name)
      .then((res) => {
        setGitStatus(res);
        if (res.repo) setGitRepo(res.repo);
        if (res.branch) setGitBranch(res.branch);
        setAutoDeploy(res.autoDeploy);
        const hasGitNow = Boolean(res.repo?.trim() || app.sourceKind === 'github');
        if (res.deployScript && res.deployScript.trim() !== '') {
          if (!hasGitNow && res.deployScript.trim().startsWith('git pull')) {
            const cleaned = res.deployScript.replace(/^git pull[^\n]*\n?/m, '').trim();
            setBuildScript(cleaned || getDefaultBuildScript(app.runtime, false, res.branch || 'main'));
          } else {
            setBuildScript(res.deployScript);
          }
        } else if (!app.buildScript) {
          setBuildScript(getDefaultBuildScript(app.runtime, hasGitNow, res.branch || 'main'));
        } else {
          setBuildScript(app.buildScript);
        }
        if (res.deployKey) setDeployKeyInfo(res.deployKey);
      })
      .catch(() => {
        api.websiteDeployKey(app.name).then(k => setDeployKeyInfo(k)).catch(() => {});
      })
      .finally(() => setLoadingGitStatus(false));
  }, [app.name, app.gitRepo, app.gitBranch, app.autoDeploy, app.buildScript, app.sourceKind, app.runtime]);

  // Detected framework metadata from live host inspection
  const [detectedFramework, setDetectedFramework] = useState<DetectedFramework | null>(null);
  const [showEditFrameworkModal, setShowEditFrameworkModal] = useState(false);
  const [selectedCustomFw, setSelectedCustomFw] = useState('');
  const [isUpdatingFramework, setIsUpdatingFramework] = useState(false);

  useEffect(() => {
    api.detectWebsiteFramework(app.name)
      .then((res) => {
        if (res.ok && res.framework) {
          setDetectedFramework(res.framework);
          const fwKey = res.framework.name.toLowerCase();
          
          // Auto-set build script if empty or if still the generic default
          setBuildScript((prev) => {
            const trimmed = prev.trim();
            const targetBranch = gitBranch.trim() || app.gitBranch || 'main';
            const genericDefault = getDefaultBuildScript(app.runtime, isGitConnected, targetBranch).trim();
            const genericNoGit = getDefaultBuildScript(app.runtime, false, targetBranch).trim();
            const isDefault = !app.buildScript || trimmed === '' || trimmed === genericDefault || trimmed === genericNoGit;
            
            if (isDefault && fwKey === 'laravel') {
              const gitPull = isGitConnected ? `git pull origin ${targetBranch}\n` : '';
              return `${gitPull}composer install --no-dev --optimize-autoloader --quiet
if ! grep -q "^APP_KEY=.\\+" .env 2>/dev/null; then php artisan key:generate --force; fi
[ -e public/storage ] || php artisan storage:link
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm 2>/dev/null || systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php8.2-fpm 2>/dev/null || true`;
            }
            return prev;
          });
        }
      })
      .catch(() => {});
  }, [app.name]);

  const handleUpdateFramework = async (targetFw: string) => {
    setIsUpdatingFramework(true);
    try {
      const res = await api.updateWebsiteFramework(app.name, targetFw);
      if (res.ok) {
        onShowToast?.('Framework Updated', `Framework updated to ${res.framework}`, 'success');
        app.framework = res.framework;
        setShowEditFrameworkModal(false);
      }
    } catch (err: any) {
      onShowToast?.('Error', err?.message || 'Could not update framework', 'error');
    } finally {
      setIsUpdatingFramework(false);
    }
  };

  const effectiveFwName = (detectedFramework?.name || gitStatus?.framework?.name || app.framework || '').toLowerCase();
  const effectiveFwVer = detectedFramework?.frameworkVersion || app.frameworkVersion || '';
  const effectiveFwTitle = detectedFramework?.title || gitStatus?.framework?.title || (app.framework && app.framework.toLowerCase() !== 'generic' ? app.framework : '');
  
  // Clean, descriptive framework label (e.g. "Laravel 12" or "Laravel 12 (v12.70.0)")
  const effectiveFrameworkLabel = detectedFramework?.title
    ? (detectedFramework.frameworkVersion && !detectedFramework.title.includes(detectedFramework.frameworkVersion)
        ? `${detectedFramework.title} (${detectedFramework.frameworkVersion})`
        : detectedFramework.title)
    : app.framework
    ? (effectiveFwVer ? `${app.framework} ${effectiveFwVer}` : app.framework)
    : '';

  const minPhpRequirement = detectedFramework?.minPhpVersion || (
    effectiveFwName.includes('laravel')
      ? (effectiveFrameworkLabel.includes('12') || effectiveFrameworkLabel.includes('11') || effectiveFwVer.startsWith('12') || effectiveFwVer.startsWith('11') ? '8.2' : effectiveFrameworkLabel.includes('10') || effectiveFwVer.startsWith('10') ? '8.1' : '8.1')
      : undefined
  );

  const isVersionCompatible = (v: string) => {
    if (app.runtime !== 'php') return true;
    if (detectedFramework?.compatiblePhp && detectedFramework.compatiblePhp.length > 0) {
      return detectedFramework.compatiblePhp.includes(v);
    }
    if (minPhpRequirement) {
      return parseFloat(v) >= parseFloat(minPhpRequirement);
    }
    return true;
  };

  const getRuntimeTabTitle = () => 'Runtime Settings';

  // Extension counts come from the panel below, which reads them from the host.
  const [extensionCounts, setExtensionCounts] = useState({ enabled: 0, total: 0 });

  // Core php.ini directives
  const [memoryLimit, setMemoryLimit] = useState('512M');
  const [uploadMaxFilesize, setUploadMaxFilesize] = useState('100M');
  const [postMaxSize, setPostMaxSize] = useState('100M');
  const [maxExecutionTime, setMaxExecutionTime] = useState('300');
  const [maxInputVars, setMaxInputVars] = useState('5000');
  const [displayErrors, setDisplayErrors] = useState(false);
  const [opcacheEnabled, setOpcacheEnabled] = useState(true);
  const [isReloadingFpm, setIsReloadingFpm] = useState(false);
  const [phpMaxChildren, setPhpMaxChildren] = useState(5);
  const [phpIdleTimeout, setPhpIdleTimeout] = useState('10s');
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Polyglot Studio States
  const [runtimeConfigData, setRuntimeConfigData] = useState<any>(null);
  const [isLoadingRuntimeConfig, setIsLoadingRuntimeConfig] = useState(false);
  const [isSavingRuntimeConfig, setIsSavingRuntimeConfig] = useState(false);
  const [isSwitchingVersion, setIsSwitchingVersion] = useState(false);

  // Node.js
  const [nodePkgManager, setNodePkgManager] = useState('npm');
  const [nodeScript, setNodeScript] = useState('start');
  const [nodeMemLimitMb, setNodeMemLimitMb] = useState(0);
  const [nodeDetectedScripts, setNodeDetectedScripts] = useState<string[]>(['start', 'dev', 'build']);

  // Python
  const [pythonWsgi, setPythonWsgi] = useState('gunicorn');
  const [pythonWorkers, setPythonWorkers] = useState(2);
  const [pythonThreads, setPythonThreads] = useState(1);
  const [pythonTimeout, setPythonTimeout] = useState(60);
  const [pythonVenvExists, setPythonVenvExists] = useState(false);
  const [pythonVenvPath, setPythonVenvPath] = useState('');

  // Ruby
  const [rubyAppServer, setRubyAppServer] = useState('puma');
  const [rubyWorkers, setRubyWorkers] = useState(2);
  const [rubyThreads, setRubyThreads] = useState(5);

  // Go / Rust
  const [binaryPath, setBinaryPath] = useState(app.runtime === 'rust' ? './target/release/app' : './bin/app');
  const [binaryArgs, setBinaryArgs] = useState('');

  // Static
  const [spaFallback, setSpaFallback] = useState(true);
  const [docRoot, setDocRoot] = useState('public');

  // Reverse Proxy Specific Interactive State
  const [currentUpstream, setCurrentUpstream] = useState(app.upstreamUrl || `http://127.0.0.1:${app.port}`);
  const [isPingingUpstream, setIsPingingUpstream] = useState(false);
  const [pingStatus, setPingStatus] = useState<{
    ok: boolean;
    latency: string;
    code: number;
    target?: string;
    error?: string;
  } | null>(null);
  const [wsEnabled, setWsEnabled] = useState(app.proxyWebsocket ?? true);
  const [preserveHost, setPreserveHost] = useState(app.proxyPreserveHost ?? true);
  const [realIp, setRealIp] = useState(app.proxyRealIp ?? true);
  const [proxyTimeout, setProxyTimeout] = useState(app.proxyTimeoutSecs ?? 60);
  // Maintenance Mode & HTTP Basic Auth State
  const [maintenanceMode, setMaintenanceMode] = useState(app.maintenanceMode ?? false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    app.maintenanceMessage || 'We are performing routine infrastructure maintenance and system updates. Service will be back online shortly.'
  );
  const [maintenanceBypassIps, setMaintenanceBypassIps] = useState(app.maintenanceBypassIps || '');
  const [isPreviewMaintenanceOpen, setIsPreviewMaintenanceOpen] = useState(false);
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);

  const [basicAuthEnabled, setBasicAuthEnabled] = useState(app.basicAuthEnabled ?? false);
  const [antiBruteforce, setAntiBruteforce] = useState(app.antiBruteforce ?? true);
  const [antiBruteforceMaxAttempts, setAntiBruteforceMaxAttempts] = useState(app.antiBruteforceMaxAttempts ?? 5);
  const [antiBruteforceBanMinutes, setAntiBruteforceBanMinutes] = useState(app.antiBruteforceBanMinutes ?? 15);
  const [basicAuthUser, setBasicAuthUser] = useState(app.basicAuthUser || 'admin');
  const [basicAuthPassword, setBasicAuthPassword] = useState(app.basicAuthPassword || 'BarePod$ecure2026!');
  const [basicAuthRealm, setBasicAuthRealm] = useState(app.basicAuthRealm || 'Restricted Area - BarePod Protected');
  const [basicAuthBypassIps, setBasicAuthBypassIps] = useState(app.basicAuthBypassIps || '');
  const [showBasicAuthPassword, setShowBasicAuthPassword] = useState(false);
  const [isTestBasicAuthOpen, setIsTestBasicAuthOpen] = useState(false);
  const [isSavingBasicAuth, setIsSavingBasicAuth] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  // App Metrics Retention (Policy: Maximum 30 Days)
  const [appMetricsRetention, setAppMetricsRetention] = useState(Math.min(30, app.metricsRetentionDays || 30));
  const [selectedMetricsRange, setSelectedMetricsRange] = useState<'1h' | '24h' | '7d' | '14d' | '30d'>('24h');

  const handleUpdateAppMetricsRetention = (days: number) => {
    const capped = Math.min(30, Math.max(1, days));
    setAppMetricsRetention(capped);
    const updated: WebApp = {
      ...app,
      metricsRetentionDays: capped,
    };
    onUpdateApp?.(updated);
    onShowToast?.(
      'Metric Retention Saved',
      `${app.name} telemetry history is retained for ${capped} days (30-day maximum).`,
      'success'
    );
  };

  const [ipRestrictionMode, setIpRestrictionMode] = useState<'none' | 'allowlist' | 'denylist'>('none');
  const [ipRestrictionList, setIpRestrictionList] = useState('');
  const [isSavingIpRestriction, setIsSavingIpRestriction] = useState(false);
  const [vhostPreviewConfig, setVhostPreviewConfig] = useState<string>('');
  const [isLoadingVhost, setIsLoadingVhost] = useState(false);

  const loadSecurityConfig = useCallback(async () => {
    try {
      const sec = await api.websiteSecurity(app.name);
      if (sec) {
        setMaintenanceMode(sec.maintenanceMode);
        if (sec.maintenanceMessage) setMaintenanceMessage(sec.maintenanceMessage);
        if (sec.maintenanceBypassIps) setMaintenanceBypassIps(sec.maintenanceBypassIps);
        setBasicAuthEnabled(sec.basicAuthEnabled);
        if (sec.basicAuthUser) setBasicAuthUser(sec.basicAuthUser);
        if (sec.basicAuthRealm) setBasicAuthRealm(sec.basicAuthRealm);
        if (sec.basicAuthBypassIps) setBasicAuthBypassIps(sec.basicAuthBypassIps);
        if (sec.ipRestrictionMode === 'allowlist' || sec.ipRestrictionMode === 'denylist') {
          setIpRestrictionMode(sec.ipRestrictionMode);
        } else {
          setIpRestrictionMode('none');
        }
        if (sec.ipRestrictionList) setIpRestrictionList(sec.ipRestrictionList);
        setAntiBruteforce(sec.antiBruteforceEnabled);
        if (sec.antiBruteforceMax) setAntiBruteforceMaxAttempts(sec.antiBruteforceMax);
        if (sec.antiBruteforceBanMins) setAntiBruteforceBanMinutes(sec.antiBruteforceBanMins);
      }
    } catch {
      // Fallback to local state if server offline
    }
  }, [app.name]);

  const loadVhostPreview = useCallback(async () => {
    setIsLoadingVhost(true);
    try {
      const res = await api.vhostPreview(app.name, app.webServer);
      if (res?.config) {
        setVhostPreviewConfig(res.config);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoadingVhost(false);
    }
  }, [app.name, app.webServer]);

  useEffect(() => {
    loadSecurityConfig();
    loadVhostPreview();
  }, [loadSecurityConfig, loadVhostPreview]);

  const handleToggleMaintenance = async () => {
    const nextState = !maintenanceMode;
    setMaintenanceMode(nextState);
    try {
      const res = await api.toggleMaintenance(app.name);
      setMaintenanceMode(res.maintenanceMode);
      onShowToast?.(
        res.maintenanceMode ? 'Maintenance Mode Enabled (503)' : 'Maintenance Mode Disabled',
        res.maintenanceMode
          ? `Visitors receive HTTP 503. Whitelisted IPs [${maintenanceBypassIps || 'None'}] retain access.`
          : `${app.name} is now serving normal traffic again.`,
        res.maintenanceMode ? 'info' : 'success'
      );
      loadVhostPreview();
    } catch (err: any) {
      setMaintenanceMode(!nextState);
      onShowToast?.('Failed to toggle maintenance mode', err.message || 'Unknown error', 'error');
    }
  };

  const handleSaveMaintenanceConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMaintenance(true);
    try {
      const updated = await api.updateWebsiteSecurity(app.name, {
        maintenanceMode,
        maintenanceTitle: 'System Maintenance',
        maintenanceMessage,
        maintenanceBypassIps,
      });
      setMaintenanceMode(updated.maintenanceMode);
      setMaintenanceMessage(updated.maintenanceMessage);
      setMaintenanceBypassIps(updated.maintenanceBypassIps);
      onShowToast?.('Maintenance Configuration Saved', `HTTP 503 vhost template and IP bypass updated on ${app.webServer.toUpperCase()}.`, 'success');
      loadVhostPreview();
    } catch (err: any) {
      onShowToast?.('Failed to save maintenance settings', err.message || 'Unknown error', 'error');
    } finally {
      setIsSavingMaintenance(false);
    }
  };

  const handleToggleBasicAuth = async () => {
    const nextState = !basicAuthEnabled;

    // If enabling and user already entered a password in the form, persist credentials automatically
    if (nextState && basicAuthPassword && basicAuthPassword.trim() !== '') {
      setIsSavingBasicAuth(true);
      setBasicAuthEnabled(true);
      try {
        const updated = await api.updateWebsiteSecurity(app.name, {
          basicAuthEnabled: true,
          basicAuthUser: basicAuthUser || 'admin',
          basicAuthPassword: basicAuthPassword.trim(),
          basicAuthRealm: basicAuthRealm || 'Restricted Area',
          basicAuthBypassIps,
        });
        setBasicAuthEnabled(updated.basicAuthEnabled);
        setBasicAuthUser(updated.basicAuthUser);
        setBasicAuthRealm(updated.basicAuthRealm);
        onShowToast?.(
          'HTTP Basic Auth Enabled',
          `Access to https://${app.domain} is now password-protected (user: ${updated.basicAuthUser}).`,
          'info'
        );
        loadVhostPreview();
        return;
      } catch (err: any) {
        setBasicAuthEnabled(false);
        onShowToast?.('Failed to enable Basic Auth', err.message || 'Unknown error', 'error');
        return;
      } finally {
        setIsSavingBasicAuth(false);
      }
    }

    // If enabling but no password is typed or saved yet, prompt the user
    if (nextState && (!basicAuthPassword || basicAuthPassword.trim() === '')) {
      onShowToast?.('Password Required', 'Please enter or generate an Auth Password below first before enabling Basic Auth.', 'error');
      return;
    }

    setBasicAuthEnabled(nextState);
    try {
      const res = await api.toggleBasicAuth(app.name);
      setBasicAuthEnabled(res.basicAuthEnabled);
      onShowToast?.(
        res.basicAuthEnabled ? 'HTTP Basic Auth Enabled' : 'HTTP Basic Auth Disabled',
        res.basicAuthEnabled
          ? `Access to https://${app.domain} is now password-protected (user: ${basicAuthUser}).`
          : `Password protection for ${app.domain} has been removed.`,
        res.basicAuthEnabled ? 'info' : 'success'
      );
      loadVhostPreview();
    } catch (err: any) {
      setBasicAuthEnabled(!nextState);
      onShowToast?.('Failed to toggle HTTP Basic Auth', err.message || 'A password must be set first.', 'error');
    }
  };

  const handleRotateRealm = async () => {
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour12: false });
    const newRealm = `Restricted Area [${timestamp}]`;
    setBasicAuthRealm(newRealm);
    setIsSavingBasicAuth(true);
    try {
      await api.updateWebsiteSecurity(app.name, {
        basicAuthEnabled: true,
        basicAuthUser: basicAuthUser || 'admin',
        basicAuthPassword: basicAuthPassword?.trim() || undefined,
        basicAuthRealm: newRealm,
        basicAuthBypassIps,
      });
      onShowToast?.(
        'Realm Rotated & Saved',
        `Realm title updated to "${newRealm}". Browser cache invalidated — login dialog will reappear!`,
        'success'
      );
      loadVhostPreview();
    } catch (err: any) {
      onShowToast?.('Failed to rotate realm', err.message || 'Unknown error', 'error');
    } finally {
      setIsSavingBasicAuth(false);
    }
  };

  const handleToggleAntiBruteforce = async () => {
    const nextState = !antiBruteforce;
    setAntiBruteforce(nextState);
    try {
      await api.updateWebsiteSecurity(app.name, {
        antiBruteforceEnabled: nextState,
        antiBruteforceMax: antiBruteforceMaxAttempts,
        antiBruteforceBanMins: antiBruteforceBanMinutes,
        rateLimitEnabled: nextState,
        rateLimitReqPerSec: antiBruteforceMaxAttempts * 2,
        rateLimitBurst: antiBruteforceMaxAttempts * 4,
      });
      onShowToast?.(
        nextState ? 'Anti-Brute Force Enabled' : 'Anti-Brute Force Disabled',
        nextState
          ? `Failed-login throttling active: max ${antiBruteforceMaxAttempts} attempts, ${antiBruteforceBanMinutes}-min IP ban.`
          : `Login rate limiting disabled for ${app.domain}.`,
        nextState ? 'success' : 'info'
      );
      loadVhostPreview();
    } catch (err: any) {
      onShowToast?.('Failed to update anti-bruteforce', err.message || 'Unknown error', 'error');
    }
  };

  const handleGeneratePassword = () => {
    const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    let pass = '';
    for (let i = 0; i < 16; i++) {
      pass += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setBasicAuthPassword(pass);
    onShowToast?.('New Password Generated', 'A random 16-character combination was generated.', 'info');
  };

  const handleSaveBasicAuthConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingBasicAuth(true);
    try {
      const updated = await api.updateWebsiteSecurity(app.name, {
        basicAuthEnabled,
        basicAuthUser,
        basicAuthPassword: basicAuthPassword || undefined,
        basicAuthRealm,
        basicAuthBypassIps,
      });
      setBasicAuthEnabled(updated.basicAuthEnabled);
      setBasicAuthUser(updated.basicAuthUser);
      setBasicAuthRealm(updated.basicAuthRealm);
      onShowToast?.('.htpasswd & VHost Saved', `Auth credentials and webserver directives synced successfully.`, 'success');
      loadVhostPreview();
    } catch (err: any) {
      onShowToast?.('Failed to save Basic Auth settings', err.message || 'Unknown error', 'error');
    } finally {
      setIsSavingBasicAuth(false);
    }
  };

  const handleSaveIpRestriction = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingIpRestriction(true);
    try {
      const updated = await api.updateWebsiteSecurity(app.name, {
        ipRestrictionMode,
        ipRestrictionList,
      });
      if (updated.ipRestrictionMode === 'allowlist' || updated.ipRestrictionMode === 'denylist') {
        setIpRestrictionMode(updated.ipRestrictionMode);
      } else {
        setIpRestrictionMode('none');
      }
      setIpRestrictionList(updated.ipRestrictionList);
      onShowToast?.('IP Access Rules Saved', `Access restriction updated and reloaded on ${app.webServer.toUpperCase()}.`, 'success');
      loadVhostPreview();
    } catch (err: any) {
      onShowToast?.('Failed to save IP access rules', err.message || 'Unknown error', 'error');
    } finally {
      setIsSavingIpRestriction(false);
    }
  };

  const handleCopyCurl = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
    onShowToast?.('Command Copied', 'cURL command copied to clipboard.', 'info');
  };

  // A real request from the daemon to this site's upstream/loopback port. The old version invented
  // a 200 and a random latency, which made a dead upstream look healthy.
  const handlePingUpstream = async () => {
    setIsPingingUpstream(true);
    setPingStatus(null);
    try {
      const res = await api.pingWebsite(app.name);
      setPingStatus({
        ok: res.ok,
        latency: `${res.latencyMs}ms`,
        code: res.statusCode ?? 0,
        target: res.target,
        error: res.error,
      });
      onShowToast?.(
        res.ok ? 'Upstream reachable' : 'Upstream unreachable',
        res.ok
          ? `${res.target} answered ${res.statusCode} in ${res.latencyMs}ms.`
          : res.error || `No response from ${res.target}.`,
        res.ok ? 'success' : 'error',
      );
    } catch (err) {
      setPingStatus({ ok: false, latency: '—', code: 0, error: err instanceof Error ? err.message : 'Unknown error' });
      onShowToast?.('Ping failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsPingingUpstream(false);
    }
  };

  const [isSavingGateway, setIsSavingGateway] = useState(false);

  // Gateway settings the daemon actually owns today: the upstream URL and WebSocket passthrough.
  // The remaining controls in that card are display-only and say so.
  const handleSaveGateway = async () => {
    setIsSavingGateway(true);
    try {
      await api.updateRuntimeConfig(app.name, {
        upstreamUrl: currentUpstream.trim(),
        websocket: wsEnabled,
      });
      onUpdateApp?.({ ...app, upstreamUrl: currentUpstream.trim() });
      onShowToast?.('Gateway saved', 'Upstream target and WebSocket behaviour applied to the vhost.', 'success');
      void loadVhostPreview();
    } catch (err) {
      onShowToast?.('Could not save gateway', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSavingGateway(false);
    }
  };

  const handleCopyDeployWebhook = () => {
    const url = gitStatus?.webhookUrl || `${window.location.origin}/api/v1/webhooks/deploy/${app.name}?token=${app.deployHookToken || ''}`;
    navigator.clipboard.writeText(url);
    setCopiedDeployWebhook(true);
    setTimeout(() => setCopiedDeployWebhook(false), 2000);
    onShowToast?.('Webhook Copied', 'Deploy webhook URL copied to clipboard. Add it to your Git repository webhooks.', 'info');
  };

  const handleCopyDeployKeyInPage = () => {
    if (!deployKeyInfo?.publicKey) return;
    navigator.clipboard.writeText(deployKeyInfo.publicKey);
    setCopiedDeployKey(true);
    setTimeout(() => setCopiedDeployKey(false), 2000);
    onShowToast?.('Deploy Key Copied', 'ED25519 Public Key copied to clipboard. Add it to your repository deploy keys.', 'info');
  };

  const handleApplyPresetInDetail = (preset: 'laravel' | 'wordpress' | 'php' | 'nextjs' | 'vite' | 'express' | 'fastapi' | 'django' | 'go' | 'static') => {
    const isGit = isGitConnected;
    const targetBranch = gitBranch.trim() || app.gitBranch || gitStatus?.branch || 'main';
    const gitPull = isGit ? `git pull origin ${targetBranch}\n` : '';
    let script = '';
    let presetLabel = preset.toUpperCase();

    if (preset === 'laravel') {
      presetLabel = 'Laravel';
      script = `${gitPull}composer install --no-dev --optimize-autoloader --quiet
if ! grep -q "^APP_KEY=.\\+" .env 2>/dev/null; then php artisan key:generate --force; fi
[ -e public/storage ] || php artisan storage:link
php artisan migrate --force
php artisan optimize:clear
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm 2>/dev/null || systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php8.2-fpm 2>/dev/null || true`;
    } else if (preset === 'wordpress') {
      presetLabel = 'WordPress';
      script = `${gitPull}# WordPress maintenance and cache refresh
wp core update-db --quiet 2>/dev/null || true
wp rewrite flush --quiet 2>/dev/null || true
systemctl reload php8.4-fpm 2>/dev/null || systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php8.2-fpm 2>/dev/null || true`;
    } else if (preset === 'php') {
      presetLabel = 'Generic PHP';
      script = `${gitPull}composer install --no-dev --optimize-autoloader --quiet
systemctl reload php8.4-fpm 2>/dev/null || systemctl reload php8.3-fpm 2>/dev/null || systemctl reload php8.2-fpm 2>/dev/null || true`;
    } else if (preset === 'nextjs') {
      presetLabel = 'Next.js / Nuxt (SSR)';
      script = `${gitPull}pnpm install --frozen-lockfile 2>/dev/null || npm install
pnpm run build 2>/dev/null || npm run build
pm2 reload ${app.name} --update-env 2>/dev/null || pm2 restart ${app.name} 2>/dev/null || pm2 start npm --name "${app.name}" -- start`;
    } else if (preset === 'vite') {
      presetLabel = 'Vite / React / Vue (SPA)';
      script = `${gitPull}pnpm install --frozen-lockfile 2>/dev/null || npm install
pnpm run build 2>/dev/null || npm run build
# Static build output generated in dist/`;
    } else if (preset === 'express') {
      presetLabel = 'Node.js / Express / NestJS';
      script = `${gitPull}npm install --production
npm run build 2>/dev/null || true
pm2 reload ${app.name} --update-env 2>/dev/null || pm2 restart ${app.name} 2>/dev/null || pm2 start index.js --name "${app.name}"`;
    } else if (preset === 'fastapi') {
      presetLabel = 'Python / FastAPI / Flask';
      script = `${gitPull}source venv/bin/activate 2>/dev/null || python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl reload gunicorn-${app.name} 2>/dev/null || systemctl restart gunicorn 2>/dev/null || true`;
    } else if (preset === 'django') {
      presetLabel = 'Python / Django';
      script = `${gitPull}source venv/bin/activate 2>/dev/null || python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt --quiet
python manage.py migrate --noinput
python manage.py collectstatic --noinput
systemctl reload gunicorn-${app.name} 2>/dev/null || systemctl restart gunicorn 2>/dev/null || true`;
    } else if (preset === 'go') {
      presetLabel = 'Go Application';
      script = `${gitPull}go build -o bin/server main.go
systemctl reload ${app.name} 2>/dev/null || systemctl restart ${app.name} 2>/dev/null || true`;
    } else if (preset === 'static') {
      presetLabel = 'Static HTML / Web';
      script = isGit ? `git pull origin ${targetBranch}\n# Static website — HTML/CSS/JS served directly by web server` : `# Static website — HTML/CSS/JS served directly by web server`;
    }

    setBuildScript(script);
    onShowToast?.(
      'Preset Applied',
      `${presetLabel} template loaded ${isGit ? '(with git pull)' : '(without git pull)'}. Click "Save Script" to persist.`,
      'info'
    );
  };

  const handleSaveDeployScript = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingDeployScript(true);
    try {
      await api.updateWebsiteGit(app.name, {
        repo: gitRepo,
        branch: gitBranch,
        autoDeploy,
        deployScript: buildScript,
      });
      // When the toggle moved, ask the daemon to resolve the actual path: it registers a GitHub
      // webhook when the panel has a public address and the tenant's PAT allows it, otherwise it
      // stays on commit polling. Saving silently would leave the UI claiming "webhook".
      let autoNote = '';
      const wasAutoDeploy = gitStatus?.autoDeploy ?? app.autoDeploy;
      if (wasAutoDeploy !== autoDeploy) {
        try {
          const resolved = await api.setWebsiteAutoDeploy(app.name, {
            enabled: autoDeploy,
            mode: 'auto',
            pollIntervalSec: gitStatus?.autoDeployPollSec || 300,
          });
          autoNote = resolved.mode === 'webhook'
            ? ' GitHub webhook registered.'
            : resolved.mode === 'poll'
              ? ' Using commit polling.'
              : '';
        } catch (autoErr) {
          autoNote = ` Auto-deploy mode could not be resolved: ${autoErr instanceof Error ? autoErr.message : 'unknown error'}.`;
        }
      }
      const updated: WebApp = {
        ...app,
        gitRepo,
        gitBranch,
        autoDeploy,
        buildScript,
      };
      onUpdateApp?.(updated);
      onShowToast?.('Settings Saved', `Git configuration and deploy script for '${app.name}' saved to server.${autoNote}`, 'success');
      api.websiteGitStatus(app.name).then(res => setGitStatus(res)).catch(() => {});
      loadDeployHistory();
    } catch (err) {
      onShowToast?.('Save Failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSavingDeployScript(false);
    }
  };

  const [isCheckingGit, setIsCheckingGit] = useState(false);

  // On-demand equivalent of one watcher tick. It reads the remote now, so an operator does not
  // have to wait up to the poll interval to see whether the site is behind.
  const handleCheckGitNow = async () => {
    setIsCheckingGit(true);
    try {
      const res = await api.checkWebsiteGit(app.name);
      if (res.status === 'up_to_date') {
        onShowToast?.('Already up to date', `Local commit ${res.local.slice(0, 7)} matches the remote branch.`, 'info');
      } else {
        onShowToast?.('Deployment started', `Remote ${res.remote.slice(0, 7)} differs from ${res.local.slice(0, 7)}.`, 'success');
        setActiveTab('deploy');
        loadDeployLogs(true);
        loadDeployHistory();
      }
      api.websiteGitStatus(app.name).then((status) => setGitStatus(status)).catch(() => {});
    } catch (err) {
      onShowToast?.('Git check failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsCheckingGit(false);
    }
  };

  const [isSavingAutoDeployMode, setIsSavingAutoDeployMode] = useState(false);

  // Changing the mode is an explicit operator choice: "auto" may still resolve to polling when
  // GitHub cannot be reached, and the badge reports what actually happened. "none" is a real
  // choice too — auto-deploy off, deploy only when the operator asks.
  const handleAutoDeployModeChange = async (mode: 'auto' | 'webhook' | 'poll' | 'none') => {
    setIsSavingAutoDeployMode(true);
    try {
      const res = mode === 'none'
        ? await api.setWebsiteAutoDeploy(app.name, { enabled: false })
        : await api.setWebsiteAutoDeploy(app.name, {
            enabled: true,
            mode,
            pollIntervalSec: gitStatus?.autoDeployPollSec || 300,
          });

      setAutoDeploy(res.enabled);
      if (mode === 'none') {
        onShowToast?.(
          'Auto-deploy disabled',
          res.message || 'Pushes will not deploy this site until a mode is chosen again.',
          'info',
        );
      } else {
        onShowToast?.(
          'Auto-deploy mode saved',
          res.mode === 'webhook' ? 'GitHub webhook is registered.' : res.message || 'Using commit polling.',
          res.mode === 'webhook' ? 'success' : 'info',
        );
      }
      api.websiteGitStatus(app.name).then((status) => setGitStatus(status)).catch(() => {});
    } catch (err) {
      onShowToast?.('Could not change auto-deploy mode', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSavingAutoDeployMode(false);
    }
  };

  const handleRotateDeployKeyInPage = async () => {
    if (!confirm('Rotate Deploy Key? The old key will immediately stop working and you will need to update the public key in your git repository settings.')) return;
    setIsRotatingDeployKey(true);
    try {
      const res = await api.rotateWebsiteDeployKey(app.name);
      setDeployKeyInfo(res);
      onShowToast?.('Deploy Key Rotated', 'New ED25519 deploy key generated.', 'success');
    } catch (err) {
      onShowToast?.('Rotation Failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsRotatingDeployKey(false);
    }
  };

  const [deployError, setDeployError] = useState<string>('');

  const handleTriggerDirectDeploy = async () => {
    setIsDeployingNow(true);
    setDeployError('');
    setActiveTab('deploy');
    const nowStr = new Date().toLocaleTimeString();
    setDeployLogs([`[${nowStr}] Triggering deployment pipeline for '${app.name}' on server...`]);

    try {
      const res = await api.redeploy(app.name);
      setDeployLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] Pipeline started (Job: ${res.deployId}, Mode: ${res.mode}).`,
        `[${new Date().toLocaleTimeString()}] Streaming live server deployment progress...`,
      ]);

      subscribeDeploy(
        app.name,
        res.deployId,
        (line) => {
          setDeployLogs(prev => [...prev, `[${line.stream}] ${line.line}`]);
        },
        (job) => {
          setIsDeployingNow(false);
          if (job.status === 'success') {
            setDeployError('');
            onShowToast?.('Deployment Successful', `Website '${app.name}' deployed successfully.`, 'success');
            onUpdateApp?.({ ...app, status: 'running', deployStatus: 'ready' });
          } else {
            const err = job.error || 'Deploy job reported a failure.';
            setDeployError(err);
            setDeployLogs(prev => [...prev, `[FAIL] ${err}`]);
            onShowToast?.('Deployment Failed', err, 'error');
            onUpdateApp?.({ ...app, status: 'error', deployStatus: 'failed' });
          }
        }
      );
    } catch (err) {
      setIsDeployingNow(false);
      const msg = err instanceof Error ? err.message : 'Unknown deployment error';
      setDeployError(msg);
      setDeployLogs(prev => [...prev, `[FAIL] Failed to trigger redeploy: ${msg}`]);
      onShowToast?.('Deployment Error', msg, 'error');
      onUpdateApp?.({ ...app, status: 'error', deployStatus: 'failed' });
    }
  };

  const handleResetToAdminDefault = () => {
    onShowToast?.(
      'Reset to Admin Blueprint',
      "This app's extension configuration was restored to the global admin default. PHP-FPM pool reloaded.",
      'info'
    );
  };

  const loadRuntimeConfig = useCallback(async () => {
    setIsLoadingRuntimeConfig(true);
    try {
      if (await apiReachable()) {
        const res = await api.runtimeConfig(app.name);
        setRuntimeConfigData(res);
        const c = res.config || {};
        if (app.runtime === 'php') {
          if (c.memoryLimit) setMemoryLimit(c.memoryLimit);
          if (c.uploadMaxSize) setUploadMaxFilesize(c.uploadMaxSize);
          if (c.postMaxSize) setPostMaxSize(c.postMaxSize);
          if (c.maxExecutionTime !== undefined) setMaxExecutionTime(String(c.maxExecutionTime));
          if (c.maxInputVars !== undefined) setMaxInputVars(String(c.maxInputVars));
          if (c.maxChildren !== undefined) setPhpMaxChildren(c.maxChildren);
          if (c.processIdleTimeout) setPhpIdleTimeout(c.processIdleTimeout);
        } else if (app.runtime === 'nodejs') {
          if (c.packageManager) setNodePkgManager(c.packageManager);
          const sc = c.script || c.startScript;
          if (sc) setNodeScript(sc);
          if (c.memoryLimitMb !== undefined) setNodeMemLimitMb(c.memoryLimitMb);
          if (c.detectedScripts && c.detectedScripts.length > 0) setNodeDetectedScripts(c.detectedScripts);
        } else if (app.runtime === 'python') {
          const ws = c.wsgiServer || c.runner;
          if (ws) setPythonWsgi(ws);
          if (c.workers !== undefined) setPythonWorkers(c.workers);
          if (c.threads !== undefined) setPythonThreads(c.threads);
          if (c.timeout !== undefined) setPythonTimeout(c.timeout);
          if (c.venvExists !== undefined) setPythonVenvExists(c.venvExists);
          if (c.venvPath) setPythonVenvPath(c.venvPath);
        } else if (app.runtime === 'ruby') {
          if (c.appServer) setRubyAppServer(c.appServer);
          if (c.workers !== undefined) setRubyWorkers(c.workers);
          if (c.threads !== undefined) setRubyThreads(c.threads);
        } else if (app.runtime === 'go' || app.runtime === 'rust') {
          if (c.binaryPath) setBinaryPath(c.binaryPath);
          if (c.args) setBinaryArgs(c.args);
        } else if (app.runtime === 'static') {
          if (c.spaFallback !== undefined) setSpaFallback(c.spaFallback);
          if (c.docRoot) setDocRoot(c.docRoot);
        } else if (app.runtime === 'proxy') {
          if (c.upstreamUrl) setCurrentUpstream(c.upstreamUrl);
          if (c.websocket !== undefined) setWsEnabled(c.websocket);
        }
      }
    } catch (err) {
      console.warn('Failed to load runtime config:', err);
    } finally {
      setIsLoadingRuntimeConfig(false);
    }
  }, [app.name, app.runtime]);

  useEffect(() => {
    loadRuntimeConfig();
  }, [loadRuntimeConfig]);

  const availableVersions = useMemo(() => {
    if (app.runtime === 'php') {
      const fromApi = runtimeConfigData?.config?.installedVersions;
      if (fromApi && fromApi.length > 0) return fromApi;
      return ['8.1', '8.2', '8.3', '8.4'];
    }
    if (app.runtime === 'nodejs') return ['18', '20', '22'];
    if (app.runtime === 'python') return ['3.10', '3.11', '3.12'];
    if (app.runtime === 'ruby') return ['3.1', '3.2', '3.3'];
    if (app.runtime === 'go') return ['1.21', '1.22', '1.23'];
    return [];
  }, [app.runtime, runtimeConfigData]);

  const handleSwitchVersion = async (newVersion: string) => {
    if (!newVersion || newVersion === app.version) return;
    if (!confirm(`Switch ${app.name} from ${app.runtime.toUpperCase()} ${app.version || ''} to ${app.runtime.toUpperCase()} ${newVersion}?\n\nThe server service will be reloaded with the new version.`)) return;
    setIsSwitchingVersion(true);
    try {
      await api.updateRuntime(app.name, { version: newVersion });
      const updatedApp: WebApp = { ...app, version: newVersion };
      onUpdateApp?.(updatedApp);
      onShowToast?.('Runtime Version Switched', `${app.name} is now running on ${app.runtime.toUpperCase()} ${newVersion}.`, 'success');
      loadRuntimeConfig();
    } catch (err) {
      onShowToast?.('Switch Failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSwitchingVersion(false);
    }
  };

  const [isSwitchingWebServer, setIsSwitchingWebServer] = useState(false);

  const handleSwitchWebServer = async (newEngine: WebServerType) => {
    if (!newEngine || newEngine.toLowerCase() === (app.webServer || '').toLowerCase()) return;
    if (!confirm(`Switch web server for ${app.name} from ${app.webServer.toUpperCase()} to ${newEngine.toUpperCase()}?\n\nA new virtual host configuration will be generated and validated.`)) return;
    setIsSwitchingWebServer(true);
    try {
      await api.updateRuntime(app.name, { engine: newEngine.toLowerCase() });
      const updatedApp: WebApp = { ...app, webServer: newEngine.toLowerCase() as WebServerType };
      onUpdateApp?.(updatedApp);
      onShowToast?.('Web Server Switched', `${app.name} is now served by ${newEngine.toUpperCase()}.`, 'success');
    } catch (err) {
      onShowToast?.('Switch Failed', describeError(err), 'error');
    } finally {
      setIsSwitchingWebServer(false);
    }
  };

  const handleSaveRuntimeConfig = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingRuntimeConfig(true);
    setIsReloadingFpm(true);
    try {
      let payload: Record<string, any> = {};
      if (app.runtime === 'php') {
        payload = {
          memoryLimit,
          uploadMaxSize: uploadMaxFilesize,
          postMaxSize,
          maxExecutionTime: parseInt(maxExecutionTime, 10) || 60,
          maxInputVars: parseInt(maxInputVars, 10) || 3000,
          maxChildren: phpMaxChildren,
          processIdleTimeout: phpIdleTimeout,
        };
      } else if (app.runtime === 'nodejs') {
        payload = {
          packageManager: nodePkgManager,
          script: nodeScript,
          startScript: nodeScript,
          memoryLimitMb: nodeMemLimitMb,
        };
      } else if (app.runtime === 'python') {
        payload = {
          wsgiServer: pythonWsgi,
          runner: pythonWsgi,
          workers: pythonWorkers,
          threads: pythonThreads,
          timeout: pythonTimeout,
        };
      } else if (app.runtime === 'ruby') {
        payload = {
          appServer: rubyAppServer,
          workers: rubyWorkers,
          threads: rubyThreads,
        };
      } else if (app.runtime === 'go' || app.runtime === 'rust') {
        payload = {
          binaryPath,
          args: binaryArgs,
        };
      } else if (app.runtime === 'static') {
        payload = {
          spaFallback,
          docRoot,
        };
      }

      if (await apiReachable()) {
        const res = await api.updateRuntimeConfig(app.name, payload);
        onShowToast?.(
          'Runtime Configuration Saved',
          app.runtime === 'php'
            ? `PHP-FPM pool reloaded for ${app.tenantUser}.`
            : `Systemd drop-in updated and service restarted successfully (${res.mode || 'live'}).`,
          'success'
        );
      } else {
        onShowToast?.('Runtime Saved', `Configuration updated (simulation mode).`, 'success');
      }
      await loadRuntimeConfig();
    } catch (err) {
      onShowToast?.('Could not save runtime configuration', describeError(err), 'error');
    } finally {
      setIsSavingRuntimeConfig(false);
      setIsReloadingFpm(false);
    }
  };

  const handleRestorePhpBaseline = async () => {
    try {
      if (await apiReachable()) {
        const globalRes = await api.phpDefaults();
        if (globalRes && globalRes.config) {
          const bp = globalRes.config;
          setMemoryLimit(bp.memoryLimit);
          setUploadMaxFilesize(bp.uploadMaxSize);
          setPostMaxSize(bp.postMaxSize);
          setMaxExecutionTime(String(bp.maxExecutionTime));
          setMaxInputVars(String(bp.maxInputVars));
          onShowToast?.('Global Blueprint Loaded', 'Values reset to host default blueprint. Click "Save & Apply" to write.', 'info');
        }
      }
    } catch (err) {
      onShowToast?.('Failed to load blueprint', describeError(err), 'error');
    }
  };

  const handleRestartService = async () => {
    setIsReloadingFpm(true);
    try {
      if (await apiReachable()) {
        if (app.runtime === 'php') {
          const res = await api.reloadPhpFpm(app.name);
          onShowToast?.('PHP-FPM Reloaded', `Pool ${res.pool} reloaded (${res.mode}).`, 'success');
        } else {
          await api.websiteAction(app.name, 'restart');
          onShowToast?.('Service Restarted', `Process supervisor restarted barepod-app@${app.name}.service.`, 'success');
        }
      } else {
        onShowToast?.('Service Restarted', `Service restarted for ${app.name} (simulation).`, 'success');
      }
    } catch (err) {
      onShowToast?.('Could not restart service', describeError(err), 'error');
    } finally {
      setIsReloadingFpm(false);
    }
  };

  const handleSavePhpIni = handleSaveRuntimeConfig;
  const handleRestartFpmPool = handleRestartService;

  const phpVersion = app.runtime === 'php' ? app.version : '8.4';
  const AppIcon = frameworkIcon(app.framework) ?? runtimeIcon[app.runtime] ?? Server;

  const isDeployFailed = app.status === 'error' || app.deployStatus === 'failed';
  const isBuilding = app.status === 'building' || app.deployStatus === 'building' || app.deployStatus === 'pending' || isDeployingNow;
  const isRunning = app.status === 'running' && !isDeployFailed;
  const isSuspended = app.status === 'suspended';
  const appPath = app.path || `/home/${app.tenantUser}/web/${app.name}`;
  // The WebApp object and the daemon's git status come from different payloads: a site created
  // before the wizard recorded sourceKind can have a real `.git` (gitStatus.detected/repo) while
  // app.gitRepo is still empty. Controls must look at both, or they render read-only on a site
  // whose webhook is demonstrably active.
  const hasGitRepository = Boolean(
    siteHasGit(app) || gitStatus?.detected || gitStatus?.repo?.trim(),
  );

  // Derived real CPU & RAM metrics from server
  const parseMetricNumber = (val?: string): number => {
    if (!val || val === '—') return 0;
    const n = parseFloat(val.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const currentCpu = isRunning ? parseMetricNumber(app.cpuUsage) : 0;
  const currentMem = isRunning ? parseMetricNumber(app.memoryUsage) : 0;

  // Poll latest deployment job on mount to detect status honestly
  useEffect(() => {
    let cancelled = false;
    api.latestDeploy(app.name)
      .then((job: any) => {
        if (cancelled || !job) return;
        if (job.status === 'failed') {
          setDeployError(job.error || 'Deployment failed');
          if (app.deployStatus !== 'failed' || app.status !== 'error') {
            onUpdateApp?.({ ...app, status: 'error', deployStatus: 'failed' });
          }
        } else if (job.status === 'success') {
          setDeployError('');
          if (app.deployStatus === 'failed') {
            onUpdateApp?.({ ...app, status: 'running', deployStatus: 'ready' });
          }
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [app.name]);

  // Domains & SSL Subtab State
  const [siteDomains, setSiteDomains] = useState<ApiDomain[]>([]);
  const [allPanelDomains, setAllPanelDomains] = useState<ApiDomain[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [newAliasDomain, setNewAliasDomain] = useState('');
  const [addingAlias, setAddingAlias] = useState(false);
  const [issuingSslId, setIssuingSslId] = useState<string | null>(null);

  // Cloudflare Tunnel & Zones state for Domains tab
  const [tunnelStatus, setTunnelStatus] = useState<TunnelStatusResponse | null>(null);
  const [cfZones, setCfZones] = useState<CloudflareZone[]>([]);
  const [loadingCf, setLoadingCf] = useState(false);
  const [copiedServerIp, setCopiedServerIp] = useState(false);

  // Add Alias state & validation
  const [aliasDnsMode, setAliasDnsMode] = useState<'cloudflare' | 'direct'>('direct');
  const [aliasCfZone, setAliasCfZone] = useState('');
  const [aliasSubdomain, setAliasSubdomain] = useState('');
  const [aliasValidation, setAliasValidation] = useState<DomainValidationResult | null>(null);
  const [isValidatingAlias, setIsValidatingAlias] = useState(false);

  // Edit Domain modal state & validation
  const [editingDomain, setEditingDomain] = useState<ApiDomain | null>(null);
  const [editDnsMode, setEditDnsMode] = useState<'cloudflare' | 'direct'>('direct');
  const [editCfZone, setEditCfZone] = useState('');
  const [editSubdomain, setEditSubdomain] = useState('');
  const [newDomainInput, setNewDomainInput] = useState('');
  const [isUpdatingDomain, setIsUpdatingDomain] = useState(false);
  const [editValidation, setEditValidation] = useState<DomainValidationResult | null>(null);
  const [isValidatingEdit, setIsValidatingEdit] = useState(false);

  // DNS Setup Instructions Modal state
  const [dnsModalDomain, setDnsModalDomain] = useState<ApiDomain | null>(null);

  const serverIp = typeof window !== 'undefined' ? window.location.hostname : '';
  const isTunnelAutoSync = Boolean(
    tunnelStatus?.hasToken &&
    tunnelStatus?.status === 'connected' &&
    tunnelStatus?.hasApiToken &&
    cfZones.length > 0
  );
  const isTunnelConfigured = isTunnelAutoSync;

  const fetchCloudflareData = useCallback(async () => {
    if (!app?.tenantUser) return;
    try {
      setLoadingCf(true);
      const [statusRes, zonesRes] = await Promise.allSettled([
        api.tunnelStatus(app.tenantUser),
        api.tunnelZones(app.tenantUser),
      ]);
      if (statusRes.status === 'fulfilled') {
        setTunnelStatus(statusRes.value);
      }
      if (zonesRes.status === 'fulfilled' && zonesRes.value.zones && Array.isArray(zonesRes.value.zones)) {
        setCfZones(zonesRes.value.zones);
        if (zonesRes.value.zones.length > 0) {
          setAliasCfZone(zonesRes.value.zones[0].name);
          setEditCfZone(zonesRes.value.zones[0].name);
          setAliasDnsMode('cloudflare');
        }
      }
    } catch (err) {
      console.warn('Failed to load Cloudflare status for domains:', err);
    } finally {
      setLoadingCf(false);
    }
  }, [app?.tenantUser]);

  useEffect(() => {
    fetchCloudflareData();
  }, [fetchCloudflareData]);

  const isDomainCloudflare = (domName: string) => {
    if (!isTunnelConfigured) return false;
    const lower = (domName || '').toLowerCase();
    if (tunnelStatus?.routes?.some((r) => r.hostname?.toLowerCase() === lower)) {
      return true;
    }
    return cfZones.some((z) => lower === z.name.toLowerCase() || lower.endsWith('.' + z.name.toLowerCase()));
  };

  const fetchSiteDomains = async () => {
    try {
      setLoadingDomains(true);
      const res = await api.domains();
      const all = res.items || [];
      setAllPanelDomains(all);
      const list = all.filter((d) => d.websiteSlug === app.name);
      setSiteDomains(list);
    } catch (err: any) {
      console.warn('Failed to load domains for site', err);
    } finally {
      setLoadingDomains(false);
    }
  };

  useEffect(() => {
    fetchSiteDomains();
  }, [app.name]);

  const effectiveAliasDomain = (isTunnelAutoSync && aliasDnsMode === 'cloudflare' && aliasCfZone && aliasCfZone !== 'custom')
    ? (aliasSubdomain.trim() ? `${aliasSubdomain.trim()}.${aliasCfZone}`.toLowerCase() : aliasCfZone.toLowerCase())
    : newAliasDomain.trim().toLowerCase();

  const aliasCollision = useMemo(() => {
    if (!effectiveAliasDomain) return null;
    const lower = effectiveAliasDomain.toLowerCase();
    if (app.domain.toLowerCase() === lower) {
      return { type: 'this_site_primary', message: `Domain "${lower}" is already the primary domain of this website.` };
    }
    const inThisSite = siteDomains.find((d) => d.domain.toLowerCase() === lower);
    if (inThisSite) {
      return { type: 'this_site_alias', message: `Domain "${lower}" is already attached to this website.` };
    }
    const inOther = allPanelDomains.find((d) => d.domain.toLowerCase() === lower);
    if (inOther) {
      return { type: 'other_site', message: `Domain "${lower}" is already used by website "${inOther.websiteSlug}".` };
    }
    if (isTunnelAutoSync && tunnelStatus?.routes) {
      const route = tunnelStatus.routes.find((r) => r.hostname?.toLowerCase() === lower && r.appName !== app.name);
      if (route) {
        return { type: 'other_route', message: `Domain "${lower}" is already routed to "${route.appName || route.service}" in Cloudflare Tunnel.` };
      }
    }
    return null;
  }, [effectiveAliasDomain, app.domain, app.name, siteDomains, allPanelDomains, isTunnelAutoSync, tunnelStatus]);

  const effectiveEditDomain = useMemo(() => {
    if (!editingDomain) return '';
    return (isTunnelAutoSync && editDnsMode === 'cloudflare' && editCfZone && editCfZone !== 'custom')
      ? (editSubdomain.trim() ? `${editSubdomain.trim()}.${editCfZone}`.toLowerCase() : editCfZone.toLowerCase())
      : newDomainInput.trim().toLowerCase();
  }, [editingDomain, isTunnelAutoSync, editDnsMode, editCfZone, editSubdomain, newDomainInput]);

  const editCollision = useMemo(() => {
    if (!editingDomain || !effectiveEditDomain) return null;
    const lower = effectiveEditDomain.toLowerCase();
    if (lower === editingDomain.domain.toLowerCase()) return null;

    const inOther = allPanelDomains.find((d) => d.domain.toLowerCase() === lower && d.id !== editingDomain.id);
    if (inOther) {
      return { type: 'other_site', message: `Domain "${lower}" is already used by website "${inOther.websiteSlug}".` };
    }
    if (isTunnelConfigured && tunnelStatus?.routes) {
      const route = tunnelStatus.routes.find((r) => r.hostname?.toLowerCase() === lower && r.appName !== app.name);
      if (route) {
        return { type: 'other_route', message: `Domain "${lower}" is already routed to "${route.appName || route.service}" in Cloudflare Tunnel.` };
      }
    }
    return null;
  }, [editingDomain, effectiveEditDomain, allPanelDomains, isTunnelConfigured, tunnelStatus, app.name]);

  // Live validation for alias domain (only when Cloudflare mode is active)
  useEffect(() => {
    if (!isTunnelAutoSync || aliasDnsMode !== 'cloudflare' || !effectiveAliasDomain || effectiveAliasDomain.indexOf('.') === -1 || aliasCollision) {
      setAliasValidation(null);
      setIsValidatingAlias(false);
      return;
    }
    setIsValidatingAlias(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.validateDomain(effectiveAliasDomain, app.tenantUser);
        setAliasValidation(res);
      } catch (e) {
        console.warn('Validate domain error', e);
      } finally {
        setIsValidatingAlias(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [effectiveAliasDomain, aliasCollision, app.tenantUser, isTunnelAutoSync, aliasDnsMode]);

  // Live validation for edit domain (only when Cloudflare mode is active)
  useEffect(() => {
    if (!isTunnelAutoSync || editDnsMode !== 'cloudflare' || !editingDomain || !effectiveEditDomain || effectiveEditDomain.indexOf('.') === -1 || effectiveEditDomain === editingDomain.domain.toLowerCase() || editCollision) {
      setEditValidation(null);
      setIsValidatingEdit(false);
      return;
    }
    setIsValidatingEdit(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.validateDomain(effectiveEditDomain, app.tenantUser);
        setEditValidation(res);
      } catch (e) {
        console.warn('Validate domain error', e);
      } finally {
        setIsValidatingEdit(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [editingDomain, effectiveEditDomain, editCollision, app.tenantUser, isTunnelAutoSync, editDnsMode]);

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveAliasDomain || aliasCollision) return;
    try {
      setAddingAlias(true);
      await api.addDomain({ websiteSlug: app.name, domain: effectiveAliasDomain });
      if (isTunnelConfigured && aliasDnsMode === 'cloudflare') {
        try {
          await api.addTunnelRoute(effectiveAliasDomain, "http://127.0.0.1:80", app.name, false, app.tenantUser);
        } catch (routeErr) {
          console.warn('Auto route add error:', routeErr);
        }
      }
      onShowToast?.('Alias Domain Added', `Successfully added ${effectiveAliasDomain} to ${app.name}`, 'success');
      setNewAliasDomain('');
      setAliasSubdomain('');
      await fetchSiteDomains();
      await fetchCloudflareData();
    } catch (err: any) {
      onShowToast?.('Error Adding Domain', err?.message || 'Failed to add alias domain', 'error');
    } finally {
      setAddingAlias(false);
    }
  };

  const handleDeleteAlias = async (dom: ApiDomain) => {
    if (!window.confirm(`Are you sure you want to remove alias domain "${dom.domain}"?`)) return;
    try {
      await api.deleteDomain(dom.id);
      onShowToast?.('Domain Removed', `Removed ${dom.domain} from website`, 'success');
      fetchSiteDomains();
      fetchCloudflareData();
    } catch (err: any) {
      onShowToast?.('Error Removing Domain', err?.message || 'Failed to remove alias', 'error');
    }
  };

  const handleOpenEditDomain = (dom: ApiDomain) => {
    setEditingDomain(dom);
    setNewDomainInput(dom.domain);

    let matchedZone = '';
    let sub = '';
    if (isTunnelAutoSync) {
      const lower = dom.domain.toLowerCase();
      for (const z of cfZones) {
        const zLower = z.name.toLowerCase();
        if (lower === zLower) {
          matchedZone = z.name;
          sub = '';
          break;
        } else if (lower.endsWith('.' + zLower)) {
          matchedZone = z.name;
          sub = dom.domain.slice(0, -(z.name.length + 1));
          break;
        }
      }
    }

    if (matchedZone) {
      setEditDnsMode('cloudflare');
      setEditCfZone(matchedZone);
      setEditSubdomain(sub);
    } else {
      setEditDnsMode('direct');
      if (cfZones.length > 0) {
        setEditCfZone(cfZones[0].name);
      }
      setEditSubdomain('');
    }
  };

  const handleSaveDomainEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDomain) return;
    const cleaned = (isTunnelAutoSync && editDnsMode === 'cloudflare' && editCfZone && editCfZone !== 'custom')
      ? (editSubdomain.trim() ? `${editSubdomain.trim()}.${editCfZone}`.toLowerCase() : editCfZone.toLowerCase())
      : newDomainInput.trim().toLowerCase();

    if (!cleaned || editCollision) return;
    if (cleaned === editingDomain.domain.toLowerCase()) {
      setEditingDomain(null);
      return;
    }
    setIsUpdatingDomain(true);
    try {
      await api.updateDomain(editingDomain.id, cleaned);
      if (isTunnelConfigured && editDnsMode === 'cloudflare') {
        try {
          await api.addTunnelRoute(cleaned, "http://127.0.0.1:80", app.name, false, app.tenantUser);
        } catch (routeErr) {
          console.warn('Auto route add on edit error:', routeErr);
        }
      }
      onShowToast?.('Domain Updated', `Domain successfully changed from ${editingDomain.domain} to ${cleaned}`, 'success');
      setEditingDomain(null);
      await fetchSiteDomains();
      await fetchCloudflareData();
      if (editingDomain.isPrimary && app) {
        onUpdateApp?.({ ...app, domain: cleaned });
      }
    } catch (err: any) {
      onShowToast?.('Failed to Update Domain', err?.message || 'Error occurred while updating domain', 'error');
    } finally {
      setIsUpdatingDomain(false);
    }
  };

  const [togglingForceHttpsId, setTogglingForceHttpsId] = useState<string | null>(null);

  const handleToggleForceHttps = async (dom: ApiDomain) => {
    if (!dom.sslEnabled) {
      onShowToast?.('SSL Certificate Required', `Cannot enable HTTPS redirect: no active SSL certificate for ${dom.domain}`, 'info');
      return;
    }
    const oldVal = Boolean(dom.forceHttps);
    const nextVal = !oldVal;

    // 1. Optimistic UI update: instantly flip toggle
    setSiteDomains((prev) =>
      prev.map((d) => (d.id === dom.id ? { ...d, forceHttps: nextVal } : d))
    );
    setTogglingForceHttpsId(dom.id);

    try {
      await api.toggleSsl(dom.id, {
        forceHTTPS: nextVal,
        hsts: dom.hstsEnabled,
        autoRenew: dom.autoRenew,
      });
      onShowToast?.('HTTPS Redirect Updated', `HTTPS 301 Redirect is now ${nextVal ? 'ON (Active)' : 'OFF'} for ${dom.domain}`, 'success');
      await fetchSiteDomains();
    } catch (err: any) {
      // Revert optimistic update on failure
      setSiteDomains((prev) =>
        prev.map((d) => (d.id === dom.id ? { ...d, forceHttps: oldVal } : d))
      );
      onShowToast?.('Error', err?.message || 'Failed to update SSL settings', 'error');
    } finally {
      setTogglingForceHttpsId(null);
    }
  };

  // SSL Issue Modal State
  const [sslModalDomain, setSslModalDomain] = useState<ApiDomain | null>(null);
  const [sslModalProvider, setSslModalProvider] = useState<'auto' | 'letsencrypt' | 'self_signed'>('auto');
  const [sslModalEmail, setSslModalEmail] = useState('');
  const [sslModalForceHttps, setSslModalForceHttps] = useState(true);
  const [sslModalHsts, setSslModalHsts] = useState(false);

  const handleOpenSslModal = (dom: ApiDomain) => {
    setSslModalDomain(dom);
    setSslModalProvider(dom.sslProvider === 'self_signed' ? 'self_signed' : dom.sslProvider === 'letsencrypt' ? 'letsencrypt' : 'auto');
    setSslModalForceHttps(dom.forceHttps ?? true);
    setSslModalHsts(dom.hstsEnabled ?? false);
    setSslModalEmail('');
  };

  const handleIssueSslModalSubmit = async () => {
    if (!sslModalDomain) return;
    try {
      setIssuingSslId(sslModalDomain.id);
      const res = await api.issueSsl(sslModalDomain.id, {
        provider: sslModalProvider,
        email: sslModalEmail.trim() || undefined,
        forceHTTPS: sslModalForceHttps,
        hsts: sslModalHsts,
      });
      const providerLabel = res.provider === 'letsencrypt' ? "Let's Encrypt" : "Self-Signed";
      if (res.warning) {
        onShowToast?.('SSL Issued with Notice', res.warning, 'info');
      } else {
        onShowToast?.('SSL Certificate Active', `${providerLabel} certificate successfully installed for ${sslModalDomain.domain}`, 'success');
      }
      setSslModalDomain(null);
      fetchSiteDomains();
      onUpdateApp?.({ ...app, ssl: true });
    } catch (err: any) {
      onShowToast?.('SSL Issuance Failed', err?.message || 'Failed to issue certificate', 'error');
    } finally {
      setIssuingSslId(null);
    }
  };

  // Real Traffic Logs & Telemetry
  interface LogItem {
    time: string;
    type: 'access' | 'error' | 'deploy';
    ip?: string;
    country?: string;
    isp?: string;
    method?: string;
    path?: string;
    status?: number;
    latency?: string;
    size?: string;
    userAgent?: string;
    msg: string;
    rawLine?: string;
  }

  const logs: LogItem[] = realLogs || (telemetry?.logs as LogItem[] | undefined) || [];
  const isRealData = logs.length > 0;
  const uniqueVisitorIps = Array.from(new Set(logs.filter(l => l.ip).map(l => l.ip as string)));
  const visitorCountryNodes = realNodes && realNodes.length > 0 ? realNodes : (telemetry?.nodes ?? []);

  // Compute live traffic metrics from real logs / telemetry
  const isReverseProxy = !!app.upstreamUrl || (app.runtime as string) === 'reverse_proxy' || (app.runtime as string) === 'proxy';
  const totalRequests = telemetry?.totalRequests ?? logs.filter(l => l.type === 'access').length;
  const count2xx = logs.filter(l => l.type === 'access' && l.status && l.status >= 200 && l.status < 300).length;
  const count4xx = logs.filter(l => l.type === 'access' && l.status && l.status >= 400 && l.status < 500).length;
  const count5xx = logs.filter(l => (l.type === 'access' && l.status && l.status >= 500) || l.type === 'error').length;
  const accessTotal = logs.filter(l => l.type === 'access').length || 1;
  const pct2xx = logs.length > 0 ? Math.round((count2xx / accessTotal) * 100) : (isRunning ? 100 : 0);
  const pct4xx = logs.length > 0 ? Math.round((count4xx / accessTotal) * 100) : 0;
  const pct5xx = logs.length > 0 ? Math.round((count5xx / accessTotal) * 100) : 0;
  const latestLatency = useMemo(() => {
    const logWithLat = logs.find(l => l.type === 'access' && l.latency && l.latency !== '—');
    if (logWithLat?.latency) return logWithLat.latency;
    return isRunning ? '< 1 ms' : '—';
  }, [logs, isRunning]);
  const responseLatency = latestLatency;

  const filteredLogs = logs.filter(log => {
    const matchesType = logType === 'all' || log.type === logType;
    const searchTarget = `${log.msg} ${log.time} ${log.ip || ''} ${log.country || ''} ${log.isp || ''} ${log.path || ''} ${log.method || ''} ${log.status || ''} ${log.rawLine || ''}`.toLowerCase();
    const matchesSearch = !logSearch || searchTarget.includes(logSearch.toLowerCase());
    const matchesCountry = !selectedCountryFilter || log.country === selectedCountryFilter;
    return matchesType && matchesSearch && matchesCountry;
  });

  const handleCopyEnv = () => {
    if (!envFile?.content) return;
    navigator.clipboard.writeText(envFile.content);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  // Confirm the panel password once, then the daemon stops masking this file for five
  // minutes. Nothing is revealed without that check.
  const revealEnv = async () => {
    if (!envPassword.trim() || envRevealBusy) return;
    setEnvRevealBusy(true);
    try {
      await api.verify(envPassword);
      setEnvFile(await api.websiteEnv(app.name, true));
      setEnvRevealOpen(false);
      setEnvPassword('');
      onShowToast?.('Secrets revealed', 'Elevated mode is active; the .env is unmasked for five minutes.', 'success');
    } catch (err) {
      onShowToast?.('Could not reveal the secrets', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setEnvRevealBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      
      {/* Top Breadcrumb & Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs group cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to All Websites</span>
          </button>
          
          <span className="text-slate-300 font-mono">/</span>
          
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-500">Apps</span>
            <span className="text-slate-300 font-mono">/</span>
            <span className="text-sm font-bold text-slate-900 font-mono">{app.name}</span>
          </div>
        </div>

        {/* Global App Status Pill */}
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
            isSuspended
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : isDeployFailed
                ? 'bg-rose-50 text-rose-700 border-rose-200 shadow-2xs'
                : isBuilding
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : isRunning
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            <span className={`w-2 h-2 rounded-full shrink-0 aspect-square inline-block ${
              isSuspended
                ? 'bg-amber-500'
                : isDeployFailed
                  ? 'bg-rose-600 animate-pulse'
                  : isBuilding
                    ? 'bg-blue-500 animate-pulse'
                    : isRunning
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-slate-400'
            }`} />
            {isSuspended
              ? 'Owner Suspended'
              : isDeployFailed
                ? 'Deploy Failed'
                : isBuilding
                  ? 'Deploying...'
                  : isRunning
                    ? 'Online & Running'
                    : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Prominent Deployment Failure Alert Banner with Retry Button */}
      {isDeployFailed && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0 shadow-xs">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-rose-950">Deployment Pipeline Failed</h4>
                <span className="text-[10px] font-bold bg-rose-200/80 text-rose-900 px-2 py-0.5 rounded font-mono">
                  ACTION REQUIRED
                </span>
              </div>
              <p className="text-xs text-rose-700 mt-0.5 font-mono break-all">
                {deployError || 'The last build/deploy step failed to complete.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setActiveTab('deploy');
                onWatchDeploy?.(app.name);
                setTimeout(() => {
                  document.getElementById('deploy-log-terminal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 100);
              }}
              className="px-3.5 py-2 text-xs font-bold text-rose-900 bg-white border border-rose-300 rounded-xl hover:bg-rose-100 transition-colors cursor-pointer shadow-2xs flex items-center gap-1.5"
            >
              <Terminal className="w-3.5 h-3.5 text-rose-700" />
              <span>View Build Logs</span>
            </button>
            <button
              type="button"
              onClick={handleTriggerDirectDeploy}
              disabled={isDeployingNow}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
              <span>{isDeployingNow ? 'Deploying...' : 'Retry Deploy Now'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Header Card with App Identity & Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-2xs border border-blue-100">
              <AppIcon className="w-7 h-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{app.name}</h1>
                <span className={`text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider font-mono ${
                  app.runtime === 'proxy' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-slate-100 text-slate-700'
                }`}>
                  {app.runtime === 'proxy' ? 'Reverse Proxy' : `${app.runtime} ${app.version}`}
                </span>
                {app.runtime !== 'proxy' && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomFw(effectiveFrameworkLabel || app.framework || '');
                      setShowEditFrameworkModal(true);
                    }}
                    title="Click to edit or re-detect framework"
                    className="group inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-md font-bold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-mono transition-colors cursor-pointer"
                  >
                    <span>{effectiveFrameworkLabel || app.framework || 'Generic'}</span>
                    <Pencil className="w-3 h-3 text-purple-400 group-hover:text-purple-600" />
                  </button>
                )}
                <span className="text-xs px-2.5 py-0.5 rounded-md font-bold bg-amber-50 text-amber-800 border border-amber-200">
                  {app.webServer.toUpperCase()}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-slate-500">
                <a
                  href={`https://${app.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono font-bold text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>https://{app.domain}</span>
                  <ArrowUpRight className="w-3 h-3" />
                </a>
                <span>•</span>
                <span>Owner: <strong className="text-slate-700 font-mono">{app.tenantUser}</strong></span>
                <span>•</span>
                {app.runtime === 'proxy' ? (
                  <span>Upstream: <strong className="text-purple-700 font-mono">{currentUpstream}</strong></span>
                ) : (
                  <span>Path: <strong className="text-slate-700 font-mono">{appPath}</strong></span>
                )}
                <span>•</span>
                <button
                  type="button"
                  onClick={handleToggleMaintenance}
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                    maintenanceMode 
                      ? 'bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200' 
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Click to toggle HTTP 503 Maintenance Mode"
                >
                  <AlertTriangle className={`w-3 h-3 ${maintenanceMode ? 'text-amber-600' : 'text-slate-400'}`} />
                  <span>503 Maintenance: {maintenanceMode ? 'ON' : 'OFF'}</span>
                </button>
                <span>•</span>
                <button
                  type="button"
                  onClick={handleToggleBasicAuth}
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold transition-all cursor-pointer shadow-2xs ${
                    basicAuthEnabled
                      ? 'bg-purple-100 text-purple-800 border border-purple-300 hover:bg-purple-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  title="Click to toggle HTTP Basic Auth Protection"
                >
                  <Lock className={`w-3 h-3 ${basicAuthEnabled ? 'text-purple-600' : 'text-slate-400'}`} />
                  <span>Basic Auth: {basicAuthEnabled ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://${app.domain}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              <span>Open Web</span>
            </a>

            {siteSupportsShell(app) && (
              <button
                onClick={() => onOpenTerminal(app)}
                title={siteShellNote(app)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <Terminal className="w-3.5 h-3.5 text-blue-600" />
                <span>Terminal CLI</span>
              </button>
            )}

            {siteSupportsFiles(app) && (
              <button
                onClick={() => setActiveTab('files')}
                title={siteFilesNote(app)}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
              >
                <Folder className="w-3.5 h-3.5 text-amber-600" />
                <span>File Manager</span>
              </button>
            )}

            {siteSupportsCI(app) && (siteHasGit(app) || gitStatus?.detected) && (
              <button
                onClick={() => {
                  // One Git surface: the Deploy tab. This button used to open a second modal with
                  // the same repository/branch/build settings.
                  if (tabSupport.deploy) setActiveTab('deploy');
                  else onOpenGit(app);
                }}
                title={`Open Deploy settings for Git Push-to-Deploy (${gitBranch || app.gitBranch || 'main'})`}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 transition-colors shadow-2xs"
              >
                <FolderGit2 className="w-3.5 h-3.5 text-purple-600" />
                <span>Git CI/CD</span>
                {autoDeploy && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Auto-deploy active" />
                )}
              </button>
            )}

            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl opacity-70 cursor-not-allowed"
              title="Not applied: the Backup & Migration module is not built yet."
            >
              <Archive className="w-3.5 h-3.5 text-slate-400" />
              <span>Backup (.bpod)</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">Not applied</span>
            </button>

            {app.runtime !== 'proxy' ? (
              <>
                {/* View Build Logs Button */}
                <button
                  type="button"
                  onClick={() => {
                    onWatchDeploy?.(app.name);
                    setActiveTab('deploy');
                    setTimeout(() => {
                      document.getElementById('deploy-log-terminal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 100);
                  }}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                  title="View live build logs and deployment output"
                >
                  <Terminal className="w-3.5 h-3.5 text-slate-600" />
                  <span>Build Logs</span>
                </button>

                {/* Direct Redeploy / Retry Button in Header Quick Actions */}
                <button
                  onClick={handleTriggerDirectDeploy}
                  disabled={isDeployingNow}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs cursor-pointer ${
                    isDeployFailed
                      ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-500/25 ring-2 ring-rose-400/50'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                  title={isDeployFailed ? 'Retry failed deployment pipeline' : 'Trigger website build and redeploy'}
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : isDeployFailed ? 'text-white' : 'text-blue-600'}`} />
                  <span>{isDeployingNow ? 'Deploying...' : isDeployFailed ? 'Retry Deploy' : 'Redeploy'}</span>
                </button>

                <button
                  onClick={async () => {
                    if (isTogglingStatus) return;
                    setIsTogglingStatus(true);
                    try {
                      await onToggleStatus(app.id);
                    } finally {
                      setIsTogglingStatus(false);
                    }
                  }}
                  disabled={isSuspended || isTogglingStatus}
                  title={isSuspended ? 'Owner suspended — activate the account first' : undefined}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-sm cursor-pointer ${
                    isSuspended
                      ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                      : isTogglingStatus
                        ? 'bg-slate-100 text-slate-500 border border-slate-200 cursor-wait'
                        : isRunning
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-500/25'
                  }`}
                >
                  {isTogglingStatus ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isRunning ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isTogglingStatus
                      ? (isRunning ? 'Stopping...' : 'Starting...')
                      : (isRunning ? 'Stop App' : 'Start App')}
                  </span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handlePingUpstream}
                disabled={isPingingUpstream}
                title="Test connection to upstream host"
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 cursor-pointer"
              >
                <RotateCw className={`w-3.5 h-3.5 text-purple-600 ${isPingingUpstream ? 'animate-spin' : ''}`} />
                <span>{isPingingUpstream ? 'Testing...' : 'Test Upstream'}</span>
              </button>
            )}

            {/* Delete App Button in Header */}
            <button
              type="button"
              onClick={() => {
                setDeleteDatabasesOption('keep');
                setShowDeleteModal(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-2xs bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer"
              title={`Delete website ${app.name}`}
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Delete App</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs — grouped; the concrete view ids stay the same so old URLs work. */}
      <div className="border-b border-slate-200 bg-white px-4 rounded-t-2xl">
        <div className="flex items-center gap-1 overflow-x-auto text-xs font-semibold">
          {tabGroups.map((group) => {
            const Icon = group.icon;
            const isActive = activeGroup.id === group.id;
            const accent = GROUP_ACCENT[group.accent];
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => openTabGroup(group)}
                className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
                  isActive ? accent.active : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? accent.icon : ''}`} />
                <span>{group.label}</span>
                {group.id === 'runtime' && app.runtime !== 'proxy' && (
                  <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono text-[10px] font-bold border border-purple-200">
                    v{app.version || (app.runtime === 'php' ? '8.4' : '1.0')}
                  </span>
                )}
                {group.id === 'deploy' && (
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                      siteHasGit(app) || gitStatus?.detected
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {siteHasGit(app) || gitStatus?.detected ? gitBranch || 'Git' : 'Local'}
                  </span>
                )}
                {group.id === 'observability' && (
                  <>
                    <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                      {filteredLogs.length}
                    </span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </>
                )}
                {group.id === 'domains' && siteDomains.length > 1 && (
                  <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-mono text-[10px] font-bold">
                    {siteDomains.length}
                  </span>
                )}
                {group.id === 'security' && (maintenanceMode || basicAuthEnabled) && (
                  <span className="flex items-center gap-1">
                    {maintenanceMode && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">503</span>
                    )}
                    {basicAuthEnabled && (
                      <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 text-[9px] font-bold">Auth</span>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeGroup.subTabs && activeGroup.subTabs.filter((sub) => activeGroup.views.includes(sub.view)).length > 1 && (
          <div className="flex items-center gap-1 pb-2 -mt-0.5 overflow-x-auto">
            {activeGroup.subTabs
              .filter((sub) => activeGroup.views.includes(sub.view))
              .map((sub) => (
                <button
                  key={sub.view}
                  type="button"
                  onClick={() => setActiveTab(sub.view)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                    activeTab === sub.view
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {sub.label}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Main Tab Content View */}
      <div className="bg-white rounded-b-2xl border border-t-0 border-slate-200 p-6 shadow-2xs">

        {/* TAB: OVERVIEW — the summary a group bar now opens on, instead of dropping the
            operator into a configuration form. */}
        {activeTab === 'overview' && (
          <div className="space-y-5 animate-in fade-in duration-200">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Status</span>
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isRunning ? 'bg-emerald-500' : isDeployFailed ? 'bg-rose-500' : 'bg-slate-400'
                    }`}
                  />
                  <span className="text-sm font-bold text-slate-900 capitalize">{app.status}</span>
                </div>
                <p className="text-xs text-slate-600 truncate" title={app.domain}>{app.domain}</p>
                <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                  {app.ssl && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">SSL</span>}
                  {app.tunnelEnabled && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Tunnel</span>}
                  <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{app.tenantUser}</span>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Runtime</span>
                <div className="text-sm font-bold text-slate-900">
                  {app.runtime.toUpperCase()} {app.version ? `v${app.version}` : ''}
                </div>
                <p className="text-xs text-slate-600 truncate">{app.framework || 'No framework'}</p>
                <p className="text-[11px] text-slate-500">Web server: {app.webServer}</p>
                <button
                  type="button"
                  onClick={() => setActiveTab('runtime')}
                  className="text-[11px] font-bold text-purple-700 hover:underline cursor-pointer"
                >
                  Open runtime settings →
                </button>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Deployment</span>
                {siteHasGit(app) || gitStatus?.detected ? (
                  <>
                    <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                      <GitBranch className="w-3.5 h-3.5 text-slate-500" />
                      <span className="truncate">{gitBranch || 'main'}</span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {!autoDeploy
                        ? 'Auto-deploy off'
                        : gitStatus?.autoDeployMode === 'webhook'
                          ? 'Webhook auto-deploy'
                          : gitStatus?.autoDeployMode === 'poll'
                            ? 'Polling auto-deploy'
                            : 'Manual webhook only'}
                    </p>
                    {deployHistory[0] ? (
                      <p className="text-[11px] text-slate-600">
                        Last:{' '}
                        <span className={deployHistory[0].status === 'success' ? 'text-emerald-700 font-bold' : deployHistory[0].status === 'failed' ? 'text-rose-700 font-bold' : 'text-amber-700 font-bold'}>
                          {deployHistory[0].status}
                        </span>{' '}
                        · {deployHistory[0].commit ? deployHistory[0].commit.slice(0, 7) : '—'} ·{' '}
                        {deployHistory[0].createdAt ? new Date(deployHistory[0].createdAt).toLocaleString() : ''}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400">No deployment yet</p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-slate-500">Local files — no Git repository connected.</p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('deploy')}
                    className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer"
                  >
                    Open deploy →
                  </button>
                  {(siteHasGit(app) || gitStatus?.detected) && (
                    <button
                      type="button"
                      onClick={() => void handleCheckGitNow()}
                      disabled={isCheckingGit}
                      className="text-[11px] font-bold text-purple-700 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {isCheckingGit ? 'Checking…' : 'Check Git now'}
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <span className="text-[10px] uppercase tracking-wider font-bold text-slate-500">Domains &amp; SSL</span>
                <div className="text-sm font-bold text-slate-900">
                  {siteDomains.length || 1} domain{(siteDomains.length || 1) === 1 ? '' : 's'}
                </div>
                <p className="text-xs text-slate-600 truncate">
                  {siteDomains.find((d) => d.isPrimary)?.domain || app.domain}
                </p>
                <p className="text-[11px] text-slate-500">
                  {siteDomains.filter((d) => d.sslEnabled).length} with SSL
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('domains')}
                  className="text-[11px] font-bold text-emerald-700 hover:underline cursor-pointer"
                >
                  Manage domains →
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-slate-600" /> Recent deployments
                </h4>
                <button
                  type="button"
                  onClick={() => setActiveTab('deploy')}
                  className="text-[11px] font-bold text-blue-700 hover:underline cursor-pointer"
                >
                  View all
                </button>
              </div>
              {deployHistory.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">No deployments recorded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {deployHistory.slice(0, 3).map((job) => (
                    <div key={job.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-slate-800">
                          {job.commit ? job.commit.slice(0, 7) : '—'}{' '}
                          <span className="font-sans text-slate-600 truncate">{job.commitMessage || job.currentStep}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {job.trigger || 'manual'} · {job.createdAt ? new Date(job.createdAt).toLocaleString() : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            job.status === 'success'
                              ? 'bg-emerald-100 text-emerald-800'
                              : job.status === 'failed'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {job.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleViewDeployLog(job)}
                          className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          Log
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: LIVE MONITORING & TELEMETRY */}
        {activeTab === 'monitoring' && (
          <div className="space-y-6">
            {/* Telemetry Filter Toolbar & App Retention Policy (Max 30 Days) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Time Range:</span>
                </span>
                <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 text-xs">
                  {(['1h', '24h', '7d', '14d', '30d'] as const).map(range => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => {
                        setSelectedMetricsRange(range);
                        onShowToast?.('Time Filter Updated', `Showing telemetry aggregation for ${range === '1h' ? 'the last 1 hour' : range === '24h' ? 'the last 24 hours' : range === '7d' ? 'the last 7 days' : range === '14d' ? 'the last 14 days' : '30 days (App maximum)'}.`, 'info');
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        selectedMetricsRange === range
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {range === '1h' ? '1 Hour' : range === '24h' ? '24 Hours' : range === '7d' ? '7 Days' : range === '14d' ? '14 Days' : '30 Days'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-App Retention Selector (Strictly max 30 days) */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                  App Metric Retention:
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={appMetricsRetention}
                    onChange={(e) => handleUpdateAppMetricsRetention(Number(e.target.value))}
                    className="px-2.5 py-1 text-xs font-bold bg-white border border-purple-200 text-purple-900 rounded-lg focus:outline-hidden focus:border-purple-500 shadow-2xs"
                  >
                    <option value={1}>1 Day (24 Hours)</option>
                    <option value={3}>3 Days</option>
                    <option value={7}>7 Days (1 Week)</option>
                    <option value={14}>14 Days (2 Weeks)</option>
                    <option value={30}>30 Days (Panel Maximum)</option>
                  </select>
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-lg border border-purple-200" title="Per-app metric retention in BarePod Panel is capped at 30 days to save tenant disk space.">
                    Max 30 Days
                  </span>
                </div>
              </div>
            </div>

            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {isReverseProxy ? (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">INGRESS PROXY ENGINE</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-extrabold text-blue-700 uppercase tracking-tight">{app.webServer || 'Nginx'}</span>
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">Zero-Overhead</span>
                  </div>
                  <div className="text-[10px] text-slate-500 block mt-2 font-mono truncate">
                    Direct socket passthrough
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">CPU USAGE</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-extrabold text-slate-900">{currentCpu}%</span>
                    <span className="text-[10px] text-emerald-600 font-bold">Quota: 1 vCPU</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, currentCpu * 20)}%` }} />
                  </div>
                </div>
              )}

              {isReverseProxy ? (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">TARGET UPSTREAM</span>
                  <div className="flex items-baseline justify-between min-w-0">
                    <span className="text-base font-extrabold text-slate-900 font-mono truncate" title={app.upstreamUrl}>
                      {app.upstreamUrl?.replace(/^https?:\/\//, '') || 'Upstream Socket'}
                    </span>
                    <span className="text-[10px] text-emerald-600 font-bold shrink-0 ml-1">Connected</span>
                  </div>
                  <div className="text-[10px] text-slate-500 block mt-2 font-mono truncate">
                    {app.upstreamUrl?.startsWith('https') ? 'HTTPS (TLS Passthrough)' : 'HTTP (Plain Socket)'}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">MEMORY (RAM)</span>
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-extrabold text-slate-900">{currentMem} MB</span>
                    <span className="text-[10px] text-slate-400">Limit: 512 MB</span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, (currentMem / 512) * 100)}%` }} />
                  </div>
                </div>
              )}

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">RESPONSE LATENCY</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900 font-mono">{responseLatency}</span>
                  <span className="text-[10px] text-emerald-600 font-bold">P99 Edge</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-2 font-mono">
                  {isReverseProxy ? 'Upstream socket roundtrip' : 'Application socket'}
                </span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">TOTAL REQUESTS</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900 font-mono">{totalRequests.toLocaleString()}</span>
                  <span className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live Stream
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-2 font-mono">{isRunning ? 'Active Ingress' : 'Service Idle'}</span>
              </div>
            </div>

            {/* HTTP Status Code Distribution */}
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  HTTP Traffic Distribution
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">Edge Ingress Telemetry</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">2xx Success</span>
                    <span className="text-sm font-bold text-emerald-600">{pct2xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-emerald-500 h-1.5" style={{ width: `${pct2xx}%` }} />
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">4xx Client Errors</span>
                    <span className="text-sm font-bold text-amber-600">{pct4xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-amber-500 h-1.5" style={{ width: `${Math.min(100, pct4xx * 5)}%` }} />
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">5xx Server Errors</span>
                    <span className="text-sm font-bold text-rose-600">{pct5xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-rose-500 h-1.5" style={{ width: `${Math.min(100, pct5xx * 5)}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Health Probes & SSL Status */}
            {(() => {
              const primaryDom = siteDomains.find(d => d.isPrimary) || siteDomains.find(d => d.domain === app.domain) || siteDomains[0];
              const isSslActive = primaryDom ? primaryDom.sslEnabled : app.ssl;
              const isSelfSigned = primaryDom?.sslProvider === 'self_signed';
              const isLetsEncrypt = primaryDom?.sslProvider === 'letsencrypt';
              const issuerDisplay = primaryDom?.sslIssuer || (isSelfSigned ? 'BarePod Self-Signed CA' : isLetsEncrypt ? "Let's Encrypt Public Authority" : 'Internal SSL');
              const expiresDisplay = primaryDom?.sslExpiresAt ? new Date(primaryDom.sslExpiresAt).toLocaleDateString() : null;

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className={`p-4 rounded-xl border bg-white space-y-2 ${isSslActive ? (isSelfSigned ? 'border-purple-200' : 'border-emerald-200') : 'border-amber-200 bg-amber-50/20'}`}>
                    <div className="flex items-center justify-between">
                      <div className={`flex items-center gap-2 font-bold text-xs ${isSslActive ? (isSelfSigned ? 'text-purple-700' : 'text-emerald-700') : 'text-amber-800'}`}>
                        {isSslActive ? (
                          <>
                            <ShieldCheck className={`w-4 h-4 ${isSelfSigned ? 'text-purple-600' : 'text-emerald-600'}`} />
                            <span>{isLetsEncrypt ? "SSL/TLS: Let's Encrypt (ACME Auto)" : isSelfSigned ? "SSL/TLS: Self-Signed Certificate" : "SSL/TLS: Active Certificate"}</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-4 h-4 text-amber-600" />
                            <span>SSL/TLS: Not Issued (HTTP Only)</span>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('domains');
                          if (primaryDom) {
                            handleOpenSslModal(primaryDom);
                          }
                        }}
                        className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <span>{isSslActive ? 'Configure SSL' : 'Issue SSL'}</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>

                    <p className="text-xs text-slate-500">
                      {isSslActive
                        ? isSelfSigned
                          ? `Domain ${app.domain} is protected by a self-signed TLS certificate (suitable for local dev/staging).`
                          : `Domain ${app.domain} is protected by TLS 1.3 encryption with automatic 90-day renewals.`
                        : `Domain ${app.domain} is currently serving unencrypted plain HTTP. Issue a certificate to enable HTTPS.`}
                    </p>

                    <div className="text-[11px] font-mono pt-1">
                      {isSslActive ? (
                        <span className="text-slate-500">Issuer: {issuerDisplay}{expiresDisplay ? ` • Valid until: ${expiresDisplay}` : ''}</span>
                      ) : (
                        <span className="text-amber-700 font-semibold font-sans">HTTPS Redirection is disabled until SSL is installed</span>
                      )}
                    </div>
                  </div>

                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                    <div className="flex items-center gap-2 text-blue-700 font-bold text-xs">
                      <CloudRain className={`w-4 h-4 ${app.tunnelEnabled ? 'text-blue-600' : 'text-slate-400'}`} />
                      <span>{app.tunnelEnabled ? 'Cloudflare Zero-NAT Tunnel' : 'Direct Edge Ingress (No Tunnel)'}</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {app.tunnelEnabled
                        ? `Isolated tunnel ingress active for tenant user ${app.tenantUser}.`
                        : `Direct reverse proxy ingress active on port ${app.port}.`}
                    </p>
                    <div className="text-[11px] font-mono pt-1">
                      {app.tunnelEnabled ? (
                        <span className="text-emerald-600 font-semibold">Status: Connected • Zero-NAT Ingress Active</span>
                      ) : (
                        <span className="text-slate-400">Tunnel: Inactive • Direct Web Server Routing</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 2: STREAMING LOGS CONSOLE */}
        {activeTab === 'logs' && (
          <div className="space-y-4">
            {/* Real-IP Ingress Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-900">
              <div className="flex items-center gap-2 font-mono">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">Real-IP Ingress Active:</span>
                <span className="text-emerald-700">
                  The visitor's real IP is restored directly from the <code>CF-Connecting-IP</code> & <code>X-Forwarded-For</code> headers (Zero-NAT bypass, not the Docker/Proxy IP 127.0.0.1).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] bg-emerald-100/80 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                  {uniqueVisitorIps.length} Unique Visitor IPs
                </span>
              </div>
            </div>


            {/* Filter Toolbar (Clean & Search-Driven) */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* Search Bar (Search IP, Path, Status, Messages) */}
                <div className="relative flex-1 max-w-lg">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search IP (e.g. 114.124), path, status code, user agent, ISP..."
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white font-mono transition-colors"
                  />
                  {logSearch && (
                    <button
                      onClick={() => setLogSearch('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs font-bold cursor-pointer"
                      title="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Right controls: View Mode, Wrap, Theme Toggle, Refresh, Auto-scroll */}
                <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto shrink-0">
                  {/* View Mode Switch */}
                  <div className="flex items-center bg-slate-100 p-0.5 rounded-lg text-xs font-medium border border-slate-200/80">
                    <button
                      onClick={() => setLogFormat('structured')}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                        logFormat === 'structured'
                          ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Column Table
                    </button>
                    <button
                      onClick={() => setLogFormat('raw')}
                      className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                        logFormat === 'raw'
                          ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Raw Log
                    </button>
                  </div>

                  {/* Wrap Text Toggle (Avoids Text Cut-off) */}
                  <button
                    type="button"
                    onClick={() => setWrapLogText(!wrapLogText)}
                    className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border font-medium transition-colors cursor-pointer ${
                      wrapLogText 
                        ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold' 
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                    title="Wrap text so paths and user-agents are not cut off"
                  >
                    <span>Wrap Text</span>
                    {wrapLogText && <span className="text-[10px]">✓</span>}
                  </button>

                  {/* Light / Dark Mode Toggle */}
                  <button
                    type="button"
                    onClick={() => setLogTheme(logTheme === 'light' ? 'dark' : 'light')}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer font-medium"
                    title={`Switch console theme to ${logTheme === 'light' ? 'Dark Console' : 'Light Mode'}`}
                  >
                    {logTheme === 'light' ? (
                      <>
                        <Moon className="w-3 h-3 text-slate-500" />
                        <span>Dark</span>
                      </>
                    ) : (
                      <>
                        <Sun className="w-3 h-3 text-amber-500" />
                        <span>Light</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={async () => {
                      setIsRefreshingLogs(true);
                      await fetchTelemetry();
                      setIsRefreshingLogs(false);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer font-medium"
                    title="Refresh logs from web server"
                  >
                    <RotateCw className={`w-3 h-3 text-slate-500 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>

                  <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none pl-1">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                      className="rounded text-blue-600 border-slate-300"
                    />
                    <span>Auto-scroll</span>
                  </label>
                </div>
              </div>

              {/* Log Category Tabs */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 overflow-x-auto">
                {(['all', 'access', 'error', 'deploy'] as const).map(type => (
                  <button
                    key={type}
                    onClick={() => setLogType(type)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      logType === type
                        ? 'bg-blue-600 text-white font-bold shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {type === 'all' ? 'All Logs' : type === 'access' ? 'Access Logs' : type === 'error' ? 'Errors / WAF' : 'Deploy Logs'}
                  </button>
                ))}
              </div>
            </div>

            {/* Terminal Window (Styled in Clean Light Mode by Default or Dark Mode) */}
            <div className={`font-mono text-xs rounded-xl p-3 sm:p-4 min-h-[380px] max-h-[580px] overflow-y-auto overflow-x-auto border transition-colors shadow-2xs ${
              logTheme === 'light'
                ? 'bg-white text-slate-800 border-slate-200'
                : 'bg-slate-950 text-slate-100 border-slate-800 shadow-inner'
            }`}>
              <div className="w-full">
                {/* Terminal Table Header for Structured View */}
                {logFormat === 'structured' && (
                  <div className={`flex items-center gap-2 pb-2 mb-2 border-b text-[10px] font-bold uppercase tracking-wider select-none px-2.5 py-1.5 rounded-lg w-full ${
                    logTheme === 'light' ? 'border-slate-200 text-slate-500 bg-slate-50' : 'border-slate-800 text-slate-400 bg-slate-900/60'
                  }`}>
                    <div className="w-[65px] shrink-0">TIME</div>
                    <div className="w-[185px] shrink-0">VISITOR IP & ISP</div>
                    <div className="w-[80px] shrink-0">STATUS</div>
                    <div className="flex-1 min-w-0">REQUEST PATH</div>
                    <div className="w-[110px] shrink-0 text-right">METRICS</div>
                    <div className="w-[60px] shrink-0 text-right">ACTION</div>
                  </div>
                )}

                {filteredLogs.map((log, idx) => (
                  logFormat === 'structured' ? (
                    <div key={idx} className="flex flex-col mb-1.5 w-full">
                      <div 
                        onClick={() => setExpandedLogIdx(expandedLogIdx === idx ? null : idx)}
                        className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg border transition-all cursor-pointer w-full ${
                          expandedLogIdx === idx
                            ? (logTheme === 'light' ? 'bg-blue-50/90 border-blue-200 shadow-2xs' : 'bg-slate-900 border-slate-700 shadow-2xs')
                            : (logTheme === 'light' ? 'hover:bg-slate-50 border-transparent hover:border-slate-200' : 'hover:bg-slate-900/80 border-transparent hover:border-slate-800')
                        }`}
                      >
                        {/* Time */}
                        <div className={`w-[65px] shrink-0 text-[11px] font-mono ${
                          logTheme === 'light' ? 'text-slate-400 font-semibold' : 'text-slate-500'
                        }`}>
                          {log.time}
                        </div>

                        {/* Visitor Client IP Badge */}
                        <div className="w-[185px] shrink-0 flex items-center gap-1 overflow-hidden min-w-0">
                          {log.ip ? (
                            <span 
                              className={`inline-flex items-center gap-1 font-mono font-bold text-[10px] px-1.5 py-0.5 rounded shadow-2xs max-w-full overflow-hidden border ${
                                logTheme === 'light'
                                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                              }`}
                              title={`Visitor IP: ${log.ip} | ISP: ${log.isp || 'Unknown'} | Country: ${log.country || 'Global'}`}
                            >
                              <Globe className={`w-3 h-3 shrink-0 ${logTheme === 'light' ? 'text-amber-600' : 'text-amber-400'}`} />
                              <span className="truncate tracking-tight font-mono text-[10px]">
                                {log.ip.length > 20 ? `${log.ip.slice(0, 9)}…${log.ip.slice(-5)}` : log.ip}
                              </span>
                              <span className={`text-[9px] px-1 rounded uppercase font-semibold border shrink-0 ${
                                logTheme === 'light'
                                  ? 'bg-amber-200/80 text-amber-900 border-amber-300'
                                  : 'bg-amber-950/80 text-amber-200 border-amber-800/40'
                              }`}>
                                {log.country || 'ID'}
                              </span>
                            </span>
                          ) : (
                            <span className={`font-mono text-[10px] px-1 ${
                              logTheme === 'light' ? 'text-slate-400' : 'text-slate-600'
                            }`}>
                              [daemon]
                            </span>
                          )}
                        </div>

                        {/* Method & Status */}
                        <div className="w-[80px] shrink-0 flex items-center gap-1">
                          {log.method ? (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                              log.method === 'GET'
                                ? (logTheme === 'light' ? 'bg-cyan-50 text-cyan-800 border-cyan-300' : 'bg-cyan-950 text-cyan-300 border-cyan-800/50')
                                : (logTheme === 'light' ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'bg-indigo-950 text-indigo-300 border-indigo-800/50')
                            }`}>
                              {log.method}
                            </span>
                          ) : null}

                          {log.status ? (
                            <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded font-mono border ${
                              log.status < 300 
                                ? (logTheme === 'light' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-emerald-950 text-emerald-300 border-emerald-800/50')
                                : log.status < 400 
                                ? (logTheme === 'light' ? 'bg-blue-50 text-blue-800 border-blue-300' : 'bg-blue-950 text-blue-300 border-blue-800/50')
                                : log.status < 500 
                                ? (logTheme === 'light' ? 'bg-amber-50 text-amber-900 border-amber-300' : 'bg-amber-950 text-amber-300 border-amber-800/50')
                                : (logTheme === 'light' ? 'bg-rose-50 text-rose-800 border-rose-300' : 'bg-rose-950 text-rose-300 border-rose-800/50')
                            }`}>
                              {log.status}
                            </span>
                          ) : null}
                        </div>

                        {/* Path Request (Takes all remaining width) */}
                        <div className="flex-1 min-w-0 overflow-hidden">
                          <span 
                            className={`text-[11px] font-mono font-bold truncate block ${
                              logTheme === 'light' ? 'text-slate-900' : 'text-slate-100'
                            }`}
                            title={log.path || log.msg}
                          >
                            {log.path || log.msg}
                          </span>
                        </div>

                        {/* Latency & Payload Metrics */}
                        <div className="w-[110px] shrink-0 text-right">
                          {log.latency ? (
                            <span className={`font-mono font-semibold px-1.5 py-0.5 rounded text-[10px] border inline-block ${
                              logTheme === 'light'
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-cyan-950/70 text-cyan-300 border-cyan-800/50'
                            }`}>
                              {log.latency} • {log.size}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">—</span>
                          )}
                        </div>

                        {/* Detail Inspector Toggle */}
                        <div className="w-[60px] shrink-0 text-right">
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded font-semibold transition-colors ${
                            expandedLogIdx === idx
                              ? 'bg-blue-600 text-white'
                              : (logTheme === 'light' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                          }`}>
                            <span>{expandedLogIdx === idx ? 'Close' : 'Details'}</span>
                            {expandedLogIdx === idx ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Request Inspector Drawer */}
                      {expandedLogIdx === idx && (
                        <div className={`p-3.5 my-1.5 rounded-xl border space-y-3 text-xs animate-in fade-in duration-150 w-full box-border max-w-full ${
                          logTheme === 'light' ? 'bg-slate-50/90 border-blue-200 text-slate-800 shadow-2xs' : 'bg-slate-900/90 border-slate-700 text-slate-200 shadow-2xs'
                        }`}>
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                            <span className="font-bold flex items-center gap-1.5 text-blue-600 text-xs">
                              <Search className="w-3.5 h-3.5" />
                              Full Request Details #{idx + 1} ({log.time})
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(log.rawLine || log.msg);
                                onShowToast?.('Log Copied', 'Raw log line copied to clipboard.', 'success');
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer shadow-2xs"
                            >
                              <Copy className="w-3 h-3 text-slate-500" />
                              <span>Copy Raw Log</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0 w-full">
                            <div className="min-w-0">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                                Full Request Path / Target:
                              </span>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-slate-900 font-mono font-bold select-all break-all shadow-2xs text-[11px]">
                                {log.path || log.msg}
                              </div>
                            </div>
                            <div className="min-w-0">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                                Full Client Info (User-Agent):
                              </span>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-slate-700 select-all break-all text-[11px] leading-relaxed shadow-2xs">
                                {log.userAgent || 'Internal System Daemon'}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 pt-2 text-[11px] border-t border-slate-200/50 min-w-0 w-full">
                            {log.ip && (
                              <div className="flex items-center gap-1.5 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs min-w-0">
                                <span className="text-slate-500 font-medium shrink-0">Real Visitor IP:</span>
                                <code className="text-amber-800 font-bold font-mono select-all truncate">{log.ip}</code>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(log.ip || '');
                                    onShowToast?.('IP Copied', `Copied ${log.ip} to clipboard`, 'success');
                                  }}
                                  className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer ml-0.5"
                                  title="Copy IP"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                                <span className="text-slate-400 text-[10px] shrink-0">({log.country || 'Global'} • {log.isp || 'ISP'})</span>
                              </div>
                            )}
                            {log.latency && (
                              <div className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">Latency: </span>
                                <code className="text-emerald-700 font-bold">{log.latency}</code>
                              </div>
                            )}
                            {log.size && (
                              <div className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">Payload: </span>
                                <code className="text-slate-800 font-semibold">{log.size}</code>
                              </div>
                            )}
                            {log.status && (
                              <div className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">HTTP Status: </span>
                                <code className="text-blue-700 font-bold">{log.status}</code>
                              </div>
                            )}
                            {log.method && (
                              <div className="bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
                                <span className="text-slate-500 font-medium">Method: </span>
                                <code className="text-purple-700 font-bold">{log.method}</code>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Raw Combined Log View */
                    <div 
                      key={idx} 
                      className={`font-mono text-[11px] p-2 rounded transition-colors break-all flex flex-wrap items-baseline gap-1.5 mb-1 ${
                        logTheme === 'light'
                          ? 'text-slate-800 hover:bg-slate-100 border border-transparent hover:border-slate-200'
                          : 'text-slate-300 hover:bg-slate-900 border border-transparent hover:border-slate-800'
                      }`}
                    >
                      {log.ip ? (
                        <span className={`font-bold px-1.5 py-0.2 rounded border ${
                          logTheme === 'light' ? 'bg-amber-100 text-amber-900 border-amber-300' : 'text-amber-300 bg-amber-950/60 border-amber-800/50'
                        }`}>
                          {log.ip}
                        </span>
                      ) : (
                        <span className={logTheme === 'light' ? 'text-slate-500' : 'text-slate-600'}>127.0.0.1</span>
                      )}
                      <span className={logTheme === 'light' ? 'text-slate-400' : 'text-slate-500'}>- - [{log.time}]</span>
                      {log.method && (
                        <span className={`font-bold ${logTheme === 'light' ? 'text-blue-700' : 'text-cyan-300'}`}>
                          "{log.method} {log.path || '/'} HTTP/2.0"
                        </span>
                      )}
                      {log.status && (
                        <span className={`font-bold ${log.status < 400 ? (logTheme === 'light' ? 'text-emerald-700' : 'text-emerald-400') : (logTheme === 'light' ? 'text-rose-700' : 'text-rose-400')}`}>
                          {log.status}
                        </span>
                      )}
                      {log.size && <span className={logTheme === 'light' ? 'text-slate-500' : 'text-slate-400'}>{log.size}</span>}
                      {log.userAgent && <span className={logTheme === 'light' ? 'text-slate-600' : 'text-slate-500'}>"{log.userAgent}"</span>}
                      {log.ip && (
                        <span className={`text-[10px] ${logTheme === 'light' ? 'text-emerald-700' : 'text-emerald-400'}`}>
                          (CF-Connecting-IP: {log.ip}, Country: {log.country}, {log.latency})
                        </span>
                      )}
                      {!log.ip && <span className={logTheme === 'light' ? 'text-purple-700' : 'text-purple-300'}>{log.msg}</span>}
                    </div>
                  )
                ))}

                {filteredLogs.length === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    No log lines match the current search or selected country filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}


        {/* TAB 2b: WORLD TRAFFIC MAP */}
        {activeTab === 'map' && (
          <div className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3.5 animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        <span>Global Visitor Distribution Map (Live Geo Ingress)</span>
                        {isRealData ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-mono font-bold rounded">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Live Telemetry Stream
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-600 font-mono font-semibold rounded">
                            Awaiting Traffic
                          </span>
                        )}
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        {isRealData
                          ? `Ingesting live access hits from web server log (${telemetry?.logPath || 'active vhost log'}). Geo-located dynamically.`
                          : `Real-time visitor origin nodes and request latency streamed directly from active web server access logs.`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedCountryFilter && (
                      <button
                        type="button"
                        onClick={() => setSelectedCountryFilter(null)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 rounded-lg font-bold transition-colors cursor-pointer"
                      >
                        <span>✕ Reset Filter ({selectedCountryFilter})</span>
                      </button>
                    )}
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200 font-semibold">
                      {visitorCountryNodes.length} Active {visitorCountryNodes.length === 1 ? 'Location' : 'Locations'} ({logs.length} Requests Recorded)
                    </span>
                  </div>
                </div>

                {/* SVG Vector World Map */}
                <div className={`relative rounded-xl border overflow-hidden p-2 transition-colors ${
                  logTheme === 'light' ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-950 border-slate-800'
                }`}>
                  <svg viewBox="0 0 1000 500" className="w-full h-auto max-h-[300px] select-none">
                    {/* Latitude and Longitude Grid Lines */}
                    <line x1="0" y1="250" x2="1000" y2="250" stroke={logTheme === 'light' ? '#e2e8f0' : '#1e293b'} strokeDasharray="4 4" strokeWidth="1" />
                    <line x1="500" y1="0" x2="500" y2="500" stroke={logTheme === 'light' ? '#e2e8f0' : '#1e293b'} strokeDasharray="4 4" strokeWidth="1" />
                    <line x1="250" y1="0" x2="250" y2="500" stroke={logTheme === 'light' ? '#f1f5f9' : '#0f172a'} strokeDasharray="4 4" strokeWidth="0.8" />
                    <line x1="750" y1="0" x2="750" y2="500" stroke={logTheme === 'light' ? '#f1f5f9' : '#0f172a'} strokeDasharray="4 4" strokeWidth="0.8" />

                    {/* World Map — Natural Earth 110m land (equirectangular, matches pin projection) */}
                    <path
                      d={WORLD_MAP_PATH}
                      fillRule="evenodd"
                      fill={logTheme === 'light' ? '#cbd5e1' : '#1e293b'}
                      stroke={logTheme === 'light' ? '#94a3b8' : '#334155'}
                      strokeWidth="0.4"
                      className="transition-colors"
                    />

                    {/* Active Visitor Pings and Beacon Markers */}
                    {visitorCountryNodes.map((node) => {
                      const isSelected = selectedCountryFilter === node.country;
                      return (
                        <g 
                          key={node.country} 
                          className="cursor-pointer group"
                          onClick={() => setSelectedCountryFilter(isSelected ? null : node.country)}
                          onMouseEnter={() => setHoveredMapPin({ ...node, name: node.countryName })}
                          onMouseLeave={() => setHoveredMapPin(null)}
                        >
                          {/* Animated Radar Pulse Circle */}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={isSelected ? '22' : '15'}
                            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                            className={`animate-ping opacity-75 ${node.isThreat ? 'fill-rose-500' : 'fill-blue-500'}`}
                          />
                          {/* Mid Glow Halo */}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r={isSelected ? '10' : '7'}
                            className={`${node.isThreat ? 'fill-rose-500/40 stroke-rose-500' : 'fill-blue-500/40 stroke-blue-500'} stroke-1.5`}
                          />
                          {/* Center Core Pin */}
                          <circle
                            cx={node.x}
                            cy={node.y}
                            r="4"
                            className={`${node.isThreat ? 'fill-rose-600' : 'fill-blue-600'} shadow-md`}
                          />
                          {/* Flag & Latency Tag */}
                          <g transform={`translate(${node.x + 9}, ${node.y - 9})`}>
                            <rect
                              x="0"
                              y="-15"
                              width="78"
                              height="21"
                              rx="5"
                              fill={logTheme === 'light' ? '#ffffff' : '#0f172a'}
                              stroke={isSelected ? '#2563eb' : (logTheme === 'light' ? '#cbd5e1' : '#334155')}
                              strokeWidth={isSelected ? '1.5' : '1'}
                              className="filter drop-shadow-xs"
                            />
                            <text
                              x="5"
                              y="1"
                              fontSize="13"
                              fontFamily="system-ui, sans-serif"
                              fontWeight="bold"
                              fill={logTheme === 'light' ? '#0f172a' : '#f8fafc'}
                            >
                              {node.flag} {node.latency}
                            </text>
                          </g>
                        </g>
                      );
                    })}
                  </svg>

                  {/* Interactive Map Hover Tooltip */}
                  {hoveredMapPin && (
                    <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-xs border border-slate-200 text-slate-800 p-2.5 rounded-xl shadow-lg text-xs font-mono max-w-xs pointer-events-none z-20 animate-in fade-in duration-100">
                      <div className="flex items-center gap-1.5 font-bold text-slate-900 border-b border-slate-100 pb-1 mb-1">
                        <MapPin className="w-3.5 h-3.5 text-blue-600" />
                        <span>{hoveredMapPin.flag} {hoveredMapPin.name}</span>
                        <span className="text-[10px] text-slate-400">({hoveredMapPin.city})</span>
                      </div>
                      <div className="space-y-0.5 text-[11px] text-slate-600">
                        <div><strong>Sample IP:</strong> <code className="text-amber-700">{hoveredMapPin.ip}</code></div>
                        <div><strong>ISP / Cloud:</strong> {hoveredMapPin.isp}</div>
                        <div><strong>Latency:</strong> <span className="text-emerald-600 font-bold">{hoveredMapPin.latency}</span></div>
                        <div className="text-[10px] text-blue-600 pt-0.5">Click a pin to filter logs by this country</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Country Quick-Filter Badges */}
                {visitorCountryNodes.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                    <span className="text-[11px] font-bold text-slate-600 mr-1 flex items-center gap-1">
                      <Filter className="w-3 h-3 text-slate-400" />
                      Filter Country:
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedCountryFilter(null)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-mono font-semibold transition-all cursor-pointer ${
                        !selectedCountryFilter
                          ? 'bg-blue-600 text-white shadow-2xs font-bold'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200'
                      }`}
                    >
                      All ({logs.length})
                    </button>
                    {visitorCountryNodes.map((n) => (
                      <button
                        key={n.country}
                        type="button"
                        onClick={() => setSelectedCountryFilter(selectedCountryFilter === n.country ? null : n.country)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-mono transition-all cursor-pointer ${
                          selectedCountryFilter === n.country
                            ? 'bg-blue-600 text-white shadow-2xs font-bold'
                            : n.isThreat
                            ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold'
                            : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
                        }`}
                        title={n.isThreat ? 'Traffic flagged as threat (WAF blocked)' : undefined}
                      >
                        <span>{n.flag}</span>
                        <span className="font-semibold">{n.country}</span>
                        <span className={`text-[10px] px-1 rounded ${
                          selectedCountryFilter === n.country ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {n.percentage}%
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-3 text-center text-xs text-slate-400 border-t border-slate-100 font-mono">
                    No active visitor locations detected in web server access logs yet.
                  </div>
                )}
              </div>

          </div>
        )}

        {/* TAB: DOMAINS & SSL MANAGEMENT */}
        {activeTab === 'domains' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header info card */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold shrink-0">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    Domains & TLS/SSL Certificates
                  </h3>
                  <p className="text-xs text-slate-500">
                    Connect multiple domains (FQDNs, www, subdomains) to this website. Zero-downtime hot-reload across your web server.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { fetchSiteDomains(); fetchCloudflareData(); }}
                disabled={loadingDomains || loadingCf}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDomains || loadingCf ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {/* DNS Routing & Ingress Status Banner */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Direct Server Public IP */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Server className="w-4 h-4 text-blue-600" />
                    <span>Direct Server Public IP (A Record)</span>
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 rounded-md">
                    Direct DNS
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  For domains routed directly to this host without Cloudflare Tunnel, create an <strong>A Record</strong> pointing to:
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <code className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-50 text-slate-900 border border-slate-200 rounded-lg flex-1">
                    {serverIp || 'Host Public IP'}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      if (serverIp) {
                        void navigator.clipboard.writeText(serverIp);
                        setCopiedServerIp(true);
                        setTimeout(() => setCopiedServerIp(false), 2000);
                      }
                    }}
                    className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                    title="Copy server IP"
                  >
                    {copiedServerIp ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedServerIp ? 'Copied' : 'Copy IP'}</span>
                  </button>
                </div>
              </div>

              {/* Card 2: Cloudflare Zero-NAT Tunnel */}
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CloudRain className="w-4 h-4 text-amber-500" />
                    <span>Cloudflare Zero-NAT Tunnel</span>
                  </span>
                  {isTunnelAutoSync ? (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-emerald-600" />
                      <span>Auto-DNS Ready</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200 rounded-md">
                      Not Configured
                    </span>
                  )}
                </div>
                {isTunnelAutoSync ? (
                  <>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Zero-NAT edge tunnel active for <strong>@{app.tenantUser}</strong> with full Cloudflare API sync. {cfZones.length} Cloudflare zone(s) available for automatic 1-click routing.
                    </p>
                    <div className="text-[11px] text-slate-600 flex items-center gap-2 pt-0.5">
                      <span className="font-semibold text-slate-700">Available Zones:</span>
                      <span className="font-mono text-emerald-700 font-bold">
                        {cfZones.map(z => z.name).join(', ')}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Cloudflare Tunnel is not configured for account <strong>@{app.tenantUser}</strong>. Traffic is routed directly through your web server ({app.webServer.toUpperCase()}) on standard ports.
                    </p>
                    <div className="text-[11px] text-slate-400">
                      Configure your tunnel under <strong>Cloudflare Tunnels</strong> to enable 1-click Zero-NAT routing.
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Add Domain Alias Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-600" />
                    Attach New Domain Alias
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Add <code>www.{app.domain}</code>, a subdomain, or an additional custom domain name.
                  </p>
                </div>

                {/* Routing Mode Switcher (only shown when Cloudflare Tunnel is fully configured) */}
                {isTunnelAutoSync && (
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-xl border border-slate-200/80">
                    <button
                      type="button"
                      onClick={() => setAliasDnsMode('cloudflare')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                        aliasDnsMode === 'cloudflare'
                          ? 'bg-white text-slate-900 shadow-2xs font-bold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <CloudRain className="w-3.5 h-3.5 text-amber-500" />
                      <span>Cloudflare Zone</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAliasDnsMode('direct')}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                        aliasDnsMode === 'direct'
                          ? 'bg-white text-slate-900 shadow-2xs font-bold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Server className="w-3.5 h-3.5 text-blue-500" />
                      <span>Direct Public IP</span>
                    </button>
                  </div>
                )}
              </div>

              <form onSubmit={handleAddAlias} className="space-y-3">
                {isTunnelAutoSync && aliasDnsMode === 'cloudflare' ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                          Select Cloudflare Zone
                        </label>
                        <select
                          value={aliasCfZone}
                          onChange={(e) => setAliasCfZone(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 text-slate-800 rounded-xl border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-mono cursor-pointer"
                        >
                          {cfZones.map((z) => (
                            <option key={z.id} value={z.name}>
                              🌐 {z.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                          Subdomain Prefix (Optional)
                        </label>
                        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 overflow-hidden focus-within:bg-white focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500">
                          <input
                            type="text"
                            value={aliasSubdomain}
                            onChange={(e) => setAliasSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                            placeholder="e.g. www, api, or store"
                            className="w-full px-3 py-2 text-xs text-slate-800 bg-transparent focus:outline-hidden font-mono"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-xs text-amber-900">
                            Resulting Domain: <strong className="font-mono text-amber-950 font-bold">{aliasSubdomain.trim() ? `${aliasSubdomain.trim()}.${aliasCfZone}` : aliasCfZone}</strong>
                          </span>
                        </div>
                        {aliasCollision ? (
                          <div className="text-[11px] text-rose-600 font-semibold flex items-center gap-1.5 mt-0.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>{aliasCollision.message}</span>
                          </div>
                        ) : isValidatingAlias ? (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <RefreshCw className="w-3 h-3 animate-spin text-amber-500" />
                            <span>Validating domain with Cloudflare...</span>
                          </div>
                        ) : aliasValidation?.cloudflareStatus?.dnsRecords?.length ? (
                          <div className="text-[11px] text-amber-700 flex items-center gap-1.5 mt-0.5">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                            <span>Cloudflare DNS: Existing record ({aliasValidation.cloudflareStatus.dnsRecords[0].type}) found. Will be managed by tunnel.</span>
                          </div>
                        ) : aliasValidation?.available ? (
                          <div className="text-[11px] text-emerald-600 font-medium flex items-center gap-1.5 mt-0.5">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Domain available in Cloudflare zone</span>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="submit"
                        disabled={addingAlias || !aliasCfZone || Boolean(aliasCollision) || isValidatingAlias}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:cursor-not-allowed"
                      >
                        {isValidatingAlias ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Validating...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            <span>{addingAlias ? 'Attaching...' : 'Add Cloudflare Alias'}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-col sm:flex-row items-center gap-3">
                      <div className="relative flex-1 w-full">
                        <input
                          type="text"
                          value={newAliasDomain}
                          onChange={(e) => setNewAliasDomain(e.target.value)}
                          placeholder="e.g. www.example.com or store.mybrand.id"
                          className={`w-full px-3.5 py-2 text-xs font-mono bg-slate-50 border rounded-xl focus:bg-white focus:outline-hidden focus:ring-2 ${
                            aliasCollision
                              ? 'border-rose-400 focus:ring-rose-500/20 focus:border-rose-500 bg-rose-50/40'
                              : 'border-slate-200 focus:ring-emerald-500/20 focus:border-emerald-500'
                          }`}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={addingAlias || !newAliasDomain.trim() || Boolean(aliasCollision) || isValidatingAlias}
                        className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0 disabled:cursor-not-allowed"
                      >
                        {isValidatingAlias ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Validating...</span>
                          </>
                        ) : (
                          <>
                            <Plus className="w-4 h-4" />
                            <span>{addingAlias ? 'Attaching...' : 'Add Domain Alias'}</span>
                          </>
                        )}
                      </button>
                    </div>

                    {aliasCollision ? (
                      <p className="text-[11px] font-semibold text-rose-600 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>{aliasCollision.message}</span>
                      </p>
                    ) : isValidatingAlias ? (
                      <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 animate-spin text-slate-400" />
                        <span>Checking domain availability...</span>
                      </p>
                    ) : aliasValidation?.cloudflareStatus?.zoneFound ? (
                      <p className="text-[11px] text-blue-600 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                        <span>Domain is managed in Cloudflare zone ({aliasValidation.cloudflareStatus.zoneName}).</span>
                      </p>
                    ) : null}
                  </div>
                )}
              </form>
            </div>

            {/* Domains List Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Active Domains ({siteDomains.length})
                </span>
                <span className="text-[11px] text-slate-400">
                  Auto-synced with active web server vhost & ingress
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {siteDomains.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    {loadingDomains ? 'Loading domain configurations...' : `Primary domain: ${app.domain}`}
                  </div>
                ) : (
                  siteDomains.map((dom) => {
                    const isCf = isDomainCloudflare(dom.domain);
                    return (
                      <div key={dom.id} className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50/50 transition-colors">
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                            dom.isPrimary ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'
                          }`}>
                            <Globe className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-900 font-mono tracking-tight">
                                {dom.domain}
                              </span>
                              {dom.isPrimary ? (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 rounded-md">
                                  Primary
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-md">
                                  Alias
                                </span>
                              )}

                              {/* DNS Routing Type Badge */}
                              {isCf ? (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 rounded-md flex items-center gap-1">
                                  <CloudRain className="w-3 h-3 text-amber-600" />
                                  <span>Cloudflare Tunnel</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 rounded-md flex items-center gap-1">
                                  <Server className="w-3 h-3 text-blue-600" />
                                  <span>Direct Public IP</span>
                                </span>
                              )}

                              {dom.sslEnabled ? (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 rounded-md flex items-center gap-1">
                                  <Lock className="w-3 h-3" />
                                  <span>TLS 1.3 ({dom.sslProvider})</span>
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-md">
                                  No SSL (HTTP Only)
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                              {dom.sslIssuer && <span>Issuer: {dom.sslIssuer}</span>}
                              {dom.sslExpiresAt && (
                                <span className="text-slate-500">
                                  Expires: {new Date(dom.sslExpiresAt).toLocaleDateString()}
                                </span>
                              )}
                              <a
                                href={`${dom.sslEnabled && dom.forceHttps ? 'https' : 'http'}://${dom.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium"
                              >
                                <span>Open in Browser</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0 self-end md:self-center">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(dom.sslEnabled && dom.forceHttps)}
                            disabled={!dom.sslEnabled || togglingForceHttpsId === dom.id}
                            onClick={() => handleToggleForceHttps(dom)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              !dom.sslEnabled
                                ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-75'
                                : togglingForceHttpsId === dom.id
                                ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-wait opacity-80'
                                : dom.forceHttps
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100 cursor-pointer'
                                : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 cursor-pointer'
                            }`}
                            title={!dom.sslEnabled ? 'Requires SSL Certificate' : 'Toggle 301 redirection from HTTP to HTTPS'}
                          >
                            <span>HTTPS Redirect:</span>
                            <div className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors duration-200 ease-in-out ${
                              dom.sslEnabled && dom.forceHttps ? 'bg-emerald-600' : 'bg-slate-300'
                            }`}>
                              <span
                                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out translate-y-0.5 ${
                                  dom.sslEnabled && dom.forceHttps ? 'translate-x-3.5' : 'translate-x-0.5'
                                }`}
                              />
                            </div>
                            <span className="font-bold text-[11px]">
                              {!dom.sslEnabled ? 'Requires SSL' : togglingForceHttpsId === dom.id ? 'Saving...' : dom.forceHttps ? 'ON' : 'OFF'}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={issuingSslId === dom.id}
                            onClick={() => handleOpenSslModal(dom)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>{issuingSslId === dom.id ? 'Issuing...' : 'Issue / Renew SSL'}</span>
                          </button>

                          {/* DNS Instructions button */}
                          <button
                            type="button"
                            onClick={() => setDnsModalDomain(dom)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            title="View DNS Setup Instructions"
                          >
                            <HelpCircle className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenEditDomain(dom)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="Edit domain and DNS routing"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>

                          {!dom.isPrimary && (
                            <button
                              type="button"
                              onClick={() => handleDeleteAlias(dom)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Remove alias domain"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2c: FILE MANAGER */}
        {activeTab === 'files' && (
          <FileManagerModal isOpen inline app={app} onClose={() => {}} />
        )}

        {/* TAB 3: REVERSE PROXY & MULTI-ENGINE PATH ROUTING */}
        {activeTab === 'routing' && (
          <div className="space-y-6">
            {/* Header Description */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-5 rounded-2xl border border-slate-200">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 tracking-tight">
                    {app.runtime === 'proxy' ? 'Dedicated Reverse Proxy Gateway Manager' : 'Hybrid Engine Reverse Proxy & Upstream Mapping'}
                  </h3>
                  <span className={`px-2 py-0.5 text-[11px] rounded font-bold ${
                    app.runtime === 'proxy' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {app.webServer.toUpperCase()} Reverse Proxy
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {app.runtime === 'proxy' 
                    ? `Domain ${app.domain} securely forwards all HTTP/WebSocket traffic to the internal backend upstream.` 
                    : `The hybrid architecture lets one domain split traffic across multiple runtimes (PHP-FPM, Node.js, Python, & Static).`}
                </p>
              </div>

            </div>

            {/* Primary Upstream Target Card (Especially prominent for Proxy Apps) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold shrink-0">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Root Gateway — Target Upstream (Route <code className="font-mono bg-slate-100 px-1 rounded">/</code>)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Default service that receives <strong>all</strong> {app.domain} traffic not matched by other Path Routes below.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Upstream URL / IP Address (target for route <code>/</code>)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={currentUpstream}
                      onChange={(e) => setCurrentUpstream(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono text-purple-900 font-bold focus:bg-white focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={handlePingUpstream}
                      disabled={isPingingUpstream}
                      title="Check upstream connectivity (test only — does not save config)"
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isPingingUpstream ? 'animate-spin' : ''}`} />
                      <span>{isPingingUpstream ? 'Pinging...' : 'Ping Test'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    The daemon sends a real HTTP request to this upstream (5s timeout) and does not save config.
                  </p>
                  {pingStatus && (
                    <div
                      className={`inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 text-xs font-mono font-bold border rounded-lg ${
                        pingStatus.ok
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                      title={pingStatus.error || pingStatus.target || ''}
                    >
                      {pingStatus.ok ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                      )}
                      <span>
                        {pingStatus.ok
                          ? `${pingStatus.code} OK (${pingStatus.latency})`
                          : `Unreachable (${pingStatus.latency})${pingStatus.error ? ` — ${pingStatus.error}` : ''}`}
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Connection & Stream Timeout
                  </label>
                  <select
                    value={proxyTimeout}
                    onChange={(e) => setProxyTimeout(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:border-purple-500"
                  >
                    <option value={60}>60 Seconds (Standard Web)</option>
                    <option value={180}>180 Seconds (Long-Polling)</option>
                    <option value={300}>300 Seconds (LLM / AI Streaming)</option>
                    <option value={600}>600 Seconds (Heavy Export/Upload)</option>
                  </select>
                </div>
              </div>

              {/* Ingress Protocol Feature Toggles */}
              <span className="block text-[11px] font-bold text-slate-600 pt-2 border-t border-slate-100">
                Proxy Route <code className="font-mono bg-slate-100 px-1 rounded">/</code> Behavior (applies globally to the root gateway)
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wsEnabled}
                    onChange={(e) => setWsEnabled(e.target.checked)}
                    className="rounded text-purple-600 border-slate-300"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-800 flex items-center gap-1">
                      <Wifi className="w-3.5 h-3.5 text-purple-600" />
                      WebSocket Upgrade
                    </span>
                    <span className="text-[10px] text-slate-500 block">HTTP 101 Switching Protocols</span>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveHost}
                    onChange={(e) => setPreserveHost(e.target.checked)}
                    className="rounded text-purple-600 border-slate-300"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-800">
                      Preserve Host Header ($host)
                    </span>
                    <span className="text-[10px] text-slate-500 block">Forward the original domain to the service</span>
                  </div>
                </label>

                <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={realIp}
                    onChange={(e) => setRealIp(e.target.checked)}
                    className="rounded text-purple-600 border-slate-300"
                  />
                  <div className="text-xs">
                    <span className="font-bold text-slate-800">
                      Forward Client IP Headers
                    </span>
                    <span className="text-[10px] text-slate-500 block">X-Real-IP, X-Forwarded-For</span>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                Only the upstream URL and WebSocket toggle are applied by the daemon today; timeout
                and header controls above are display-only until the vhost writer exposes them.
              </p>
              <button
                type="button"
                onClick={() => void handleSaveGateway()}
                disabled={isSavingGateway}
                className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl disabled:opacity-50 cursor-pointer"
              >
                {isSavingGateway ? 'Saving…' : 'Save Gateway'}
              </button>
            </div>

            <VhostPreviewCard
              engine={app.webServer}
              filename={`barepod-${app.name}.${app.webServer === 'caddy' ? 'caddy' : 'conf'}`}
              config={vhostPreviewConfig}
              loading={isLoadingVhost}
              onRefresh={() => void loadVhostPreview()}
            />
          </div>
        )}

        {/* TAB 4: ENVIRONMENT VARIABLES (.ENV) */}
        {activeTab === 'env' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  .env Configuration File
                </h3>
                <p className="text-xs text-slate-500">
                  Read from <code>{envFile?.path ?? `${appPath}/.env`}</code> — secret values are masked by the daemon.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {envFile?.exists && envFile?.masked !== false && (
                  <button
                    onClick={() => setEnvRevealOpen((v) => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-amber-50 text-amber-800 hover:bg-amber-100 rounded-lg border border-amber-200 whitespace-nowrap"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Reveal secrets
                  </button>
                )}
                <button
                  onClick={handleCopyEnv}
                  disabled={!envFile?.exists}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEnv ? 'Copied!' : 'Copy to Clipboard'}</span>
                </button>
              </div>
            </div>

            {envRevealOpen && envFile?.masked !== false && (
              <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl border border-amber-200 bg-amber-50">
                <span className="text-[11px] font-medium text-amber-900">
                  Confirm your panel password to unmask secrets (five minutes):
                </span>
                <input
                  type="password"
                  value={envPassword}
                  onChange={(e) => setEnvPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void revealEnv();
                  }}
                  placeholder="••••••••"
                  className="px-2.5 py-1.5 text-xs bg-white border border-amber-300 rounded-lg focus:outline-hidden focus:border-amber-500"
                />
                <button
                  onClick={() => void revealEnv()}
                  disabled={envRevealBusy}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {envRevealBusy ? 'Revealing…' : 'Reveal'}
                </button>
                <button
                  onClick={() => {
                    setEnvRevealOpen(false);
                    setEnvPassword('');
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-white whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            )}

            {envLoading ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                Reading .env…
              </div>
            ) : envFile?.exists ? (
              <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl border border-slate-800 overflow-x-auto leading-relaxed max-h-96">
{envFile.content ?? ''}
              </pre>
            ) : (
              <div className="p-4 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">No .env file.</p>
                <p>{envFile?.note ?? 'This site has not written one — the panel will not invent it.'}</p>
              </div>
            )}
          </div>
        )}

        {/* TAB: SERVER & RUNTIME CONFIGURATION */}
        {(activeTab === 'php' || activeTab === 'runtime') && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* ENGINE & RUNTIME SELECTION HUB */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Web Server Engine Card */}
              <div className="p-5 rounded-2xl border border-blue-200 bg-white shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-blue-600" />
                    <span className="font-bold text-xs text-slate-900 uppercase tracking-wider">Web Server Engine</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 uppercase flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                    {app.webServer.toUpperCase()} ACTIVE
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Select the high-performance HTTP web server daemon that handles traffic routing, TLS termination, and reverse proxying for this website.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(['caddy', 'nginx', 'openlitespeed', 'apache'] as WebServerType[]).map((ws) => {
                    const isActive = (app.webServer || 'caddy').toLowerCase() === ws.toLowerCase();
                    return (
                      <button
                        key={ws}
                        type="button"
                        onClick={() => handleSwitchWebServer(ws)}
                        disabled={isActive || isSwitchingWebServer}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer disabled:cursor-default ${
                          isActive
                            ? 'bg-blue-50 border-blue-500 text-blue-900 ring-2 ring-blue-500/15 font-bold shadow-2xs'
                            : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span className="capitalize">{ws === 'openlitespeed' ? 'OpenLiteSpeed' : ws.toUpperCase()}</span>
                        {isActive ? (
                          <span className="w-2 h-2 rounded-full bg-blue-600" />
                        ) : (
                          <span className="text-[10px] text-slate-400 font-normal">Switch</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {isSwitchingWebServer && (
                  <div className="flex items-center gap-2 text-[11px] text-blue-700 font-semibold animate-pulse pt-1">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
                    <span>Rebuilding virtual host with new web server...</span>
                  </div>
                )}
              </div>

              {/* Runtime & Process Pool Manager Card */}
              <div className="p-5 rounded-2xl border border-purple-200 bg-white shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <span className="font-bold text-xs text-slate-900 uppercase tracking-wider">
                      {app.runtime === 'php' ? `PHP FastCGI Pool (${app.version || '8.3'})` : `${app.runtime.toUpperCase()} Process Manager`}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    ACTIVE SUPERVISION
                  </span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Execution runtime pool & FastCGI socket manager for {app.name}. Switching versions auto-rebinds the IPC socket.
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {availableVersions.map((v: string) => {
                    const isActive = v === app.version;
                    const isCompatible = isVersionCompatible(v);

                    if (!isCompatible) {
                      return (
                        <button
                          key={v}
                          type="button"
                          disabled={true}
                          title={`Incompatible: ${effectiveFrameworkLabel || 'This framework'} requires PHP >= ${minPhpRequirement}`}
                          className="px-3 py-2 rounded-xl text-xs font-semibold border border-slate-200/70 bg-slate-100/70 text-slate-400 cursor-not-allowed flex items-center gap-1.5 opacity-60 select-none"
                        >
                          <span className="font-mono">{app.runtime.toUpperCase()} {v}</span>
                          <span className="text-[9px] px-1 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-normal">
                            Req ≥ {minPhpRequirement}
                          </span>
                        </button>
                      );
                    }

                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => handleSwitchVersion(v)}
                        disabled={isActive || isSwitchingVersion}
                        className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer disabled:cursor-default flex items-center gap-1.5 ${
                          isActive
                            ? 'bg-purple-50 border-purple-500 text-purple-900 ring-2 ring-purple-500/15 font-bold shadow-2xs'
                            : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100 text-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <span className="font-mono">{app.runtime.toUpperCase()} {v}</span>
                        {isActive ? (
                          <span className="w-2 h-2 rounded-full bg-purple-600" />
                        ) : (
                          <span className="text-[10px] text-slate-400 font-normal">Switch</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {minPhpRequirement && (
                  <div className="flex items-center gap-2 text-[11px] text-amber-800 bg-amber-50/90 border border-amber-200/90 px-3 py-1.5 rounded-xl">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      <strong>{effectiveFrameworkLabel || 'Framework'}</strong> requires <strong>PHP ≥ {minPhpRequirement}</strong>. Older PHP versions are locked to prevent fatal syntax and runtime crashes.
                    </span>
                  </div>
                )}
                {isSwitchingVersion && (
                  <div className="flex items-center gap-2 text-[11px] text-purple-700 font-semibold animate-pulse pt-1">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-600" />
                    <span>Switching {app.runtime.toUpperCase()} version and reloading pool...</span>
                  </div>
                )}

                {/* Pool & Config Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
                  {app.runtime === 'php' && (
                    <button
                      type="button"
                      onClick={handleRestorePhpBaseline}
                      disabled={isReloadingFpm || isSavingRuntimeConfig || isSwitchingVersion}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Restore Baseline</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRestartService}
                    disabled={isReloadingFpm || isSavingRuntimeConfig}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isReloadingFpm ? 'animate-spin text-purple-600' : ''}`} />
                    <span>
                      {isReloadingFpm
                        ? 'Reloading...'
                        : app.runtime === 'php'
                        ? 'Reload FPM Pool'
                        : 'Restart Service'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRuntimeConfig}
                    disabled={isReloadingFpm || isSavingRuntimeConfig}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50 cursor-pointer ml-auto"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSavingRuntimeConfig ? 'Saving...' : 'Save & Apply'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Server Jail & Host Routing Specifications */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">ISOLATED HOME DIR</span>
                <span className="text-xs font-mono font-bold text-slate-800 truncate block">{appPath}</span>
                <span className="text-[10px] text-slate-400 block pt-0.5">Linux chroot jail & cgroups v2</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">ACTIVE WEB SERVER</span>
                <span className="text-xs font-bold text-slate-800 block">{app.webServer.toUpperCase()}</span>
                <span className="text-[10px] text-slate-400 block pt-0.5">HTTP/2 & HTTP/3 ALPN Ready</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/80 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">SOCKET / SUPERVISOR</span>
                <span className="text-xs font-mono font-bold text-slate-800 truncate block">
                  {app.runtime === 'php'
                    ? `/run/php/php${app.version || '8.3'}-fpm-${app.tenantUser}.sock`
                    : `barepod-app@${app.name}.service`}
                </span>
                <span className="text-[10px] text-slate-400 block pt-0.5">
                  {runtimeConfigData?.limits?.memoryMb ? `${runtimeConfigData.limits.memoryMb}MB RAM Limit` : 'High Performance IPC Socket'}
                </span>
              </div>
            </div>

            {/* Quick Stats: Polyglot Metrics & Quota Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  {app.runtime === 'php' ? 'Loaded Extensions' : 'Runtime Engine'}
                </span>
                <div className="text-xl font-bold text-purple-700">
                  {app.runtime === 'php' ? (
                    <>
                      {extensionCounts.enabled}{' '}
                      <span className="text-xs font-normal text-slate-500">/ {extensionCounts.total}</span>
                    </>
                  ) : app.runtime === 'nodejs' ? (
                    `${nodePkgManager} run ${nodeScript}`
                  ) : app.runtime === 'python' ? (
                    pythonWsgi.toUpperCase()
                  ) : app.runtime === 'ruby' ? (
                    rubyAppServer.toUpperCase()
                  ) : app.runtime === 'go' || app.runtime === 'rust' ? (
                    'Native ELF'
                  ) : (
                    'Static Edge'
                  )}
                </div>
                <span className="text-[10px] text-slate-500">
                  {app.runtime === 'php'
                    ? 'phpenmod/phpdismod toggles'
                    : `Version ${app.version || 'Default'}`}
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  {app.runtime === 'php' ? 'Database Drivers' : 'Concurrency / Workers'}
                </span>
                <div className="text-xl font-bold text-slate-900">
                  {app.runtime === 'php' ? (
                    'PDO MySQL, PgSQL, Mongo'
                  ) : app.runtime === 'nodejs' ? (
                    'Single Thread Event Loop'
                  ) : app.runtime === 'python' ? (
                    `${pythonWorkers} workers × ${pythonThreads} th`
                  ) : app.runtime === 'ruby' ? (
                    `${rubyWorkers} workers × ${rubyThreads} th`
                  ) : app.runtime === 'go' || app.runtime === 'rust' ? (
                    'Goroutines / Async'
                  ) : (
                    'Zero-Copy Direct Sendfile'
                  )}
                </div>
                <span className="text-[10px] text-emerald-600 font-medium">
                  {app.runtime === 'php'
                    ? 'Eloquent & Doctrine ready'
                    : app.runtime === 'python'
                    ? `Keep-alive ${pythonTimeout}s`
                    : 'Systemd Isolated'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Memory Allocation</span>
                <div className="text-xl font-bold text-slate-900">
                  {app.runtime === 'php'
                    ? memoryLimit
                    : app.runtime === 'nodejs'
                    ? nodeMemLimitMb > 0
                      ? `${nodeMemLimitMb}MB`
                      : 'V8 Default (~1.4GB)'
                    : runtimeConfigData?.limits?.memoryMb
                    ? `${runtimeConfigData.limits.memoryMb}MB`
                    : 'Host Allocated'}
                </div>
                <span className="text-[10px] text-slate-500">
                  {app.runtime === 'php'
                    ? `max_exec: ${maxExecutionTime}s`
                    : app.runtime === 'nodejs'
                    ? '--max-old-space-size'
                    : 'Tenant Memory Bound'}
                </span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Tenant cgroup v2</span>
                <div className="text-xl font-bold text-slate-900">
                  {runtimeConfigData?.limits?.cpuQuotaPercent
                    ? `${runtimeConfigData.limits.cpuQuotaPercent}% CPU`
                    : '100% Shared'}
                </div>
                <span className="text-[10px] text-purple-600 font-medium">
                  TasksMax: {runtimeConfigData?.limits?.tasksMax || 256}
                </span>
              </div>
            </div>

            {/* PHP SPECIFIC EXTENSION TOGGLE PANEL */}
            {app.runtime === 'php' && (
              <PhpExtensionsPanel
                version={app.version}
                title={`PHP ${app.version} Extensions`}
                onShowToast={onShowToast}
                onCountChange={(enabled, total) => {
                  setExtensionCounts({ enabled, total });
                }}
              />
            )}

            {/* STACK-SPECIFIC CONTROL FORMS */}
            {app.runtime === 'php' && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Core php.ini & FPM Directives
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure PHP-FPM runtime parameters for tenant <code>{app.tenantUser}</code> without affecting other websites.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      memory_limit
                    </label>
                    <select
                      value={memoryLimit}
                      onChange={(e) => setMemoryLimit(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="128M">128M (Default)</option>
                      <option value="256M">256M (Medium)</option>
                      <option value="512M">512M (Recommended)</option>
                      <option value="1024M">1024M (High Load)</option>
                      <option value="2048M">2048M (Enterprise)</option>
                      <option value="-1">-1 (Unlimited)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      upload_max_filesize
                    </label>
                    <select
                      value={uploadMaxFilesize}
                      onChange={(e) => setUploadMaxFilesize(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="20M">20M</option>
                      <option value="50M">50M</option>
                      <option value="64M">64M</option>
                      <option value="100M">100M (Default)</option>
                      <option value="250M">250M</option>
                      <option value="500M">500M</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      post_max_size
                    </label>
                    <select
                      value={postMaxSize}
                      onChange={(e) => setPostMaxSize(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="25M">25M</option>
                      <option value="55M">55M</option>
                      <option value="64M">64M</option>
                      <option value="100M">100M (Default)</option>
                      <option value="255M">255M</option>
                      <option value="512M">512M</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      max_execution_time
                    </label>
                    <select
                      value={maxExecutionTime}
                      onChange={(e) => setMaxExecutionTime(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds</option>
                      <option value="120">120 seconds</option>
                      <option value="300">300 seconds (5 min)</option>
                      <option value="600">600 seconds (10 min)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      max_input_vars
                    </label>
                    <select
                      value={maxInputVars}
                      onChange={(e) => setMaxInputVars(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="1000">1000 (Default)</option>
                      <option value="2500">2500</option>
                      <option value="3000">3000 (Recommended)</option>
                      <option value="5000">5000 (WooCommerce / Large)</option>
                      <option value="10000">10000</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      pm.max_children (FPM Pool)
                    </label>
                    <select
                      value={phpMaxChildren}
                      onChange={(e) => setPhpMaxChildren(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="2">2 processes (Low RAM)</option>
                      <option value="5">5 processes (Standard)</option>
                      <option value="10">10 processes (Busy Site)</option>
                      <option value="20">20 processes (Heavy Load)</option>
                      <option value="50">50 processes (High Capacity)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      pm.process_idle_timeout
                    </label>
                    <select
                      value={phpIdleTimeout}
                      onChange={(e) => setPhpIdleTimeout(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="5s">5 seconds (Quick Pruning)</option>
                      <option value="10s">10 seconds (Default)</option>
                      <option value="30s">30 seconds (Medium)</option>
                      <option value="60s">60 seconds (Persistent)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      display_errors
                    </label>
                    <select
                      value={displayErrors ? '1' : '0'}
                      onChange={(e) => setDisplayErrors(e.target.value === '1')}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="0">Off (Recommended for Production)</option>
                      <option value="1">On (Development Debugging)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* NODE.JS PROCESS & MEMORY STUDIO */}
            {app.runtime === 'nodejs' && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Node.js Process Supervision & Memory Allocation
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure package manager, entrypoint run script, and V8 heap limits for <code>{app.name}</code>.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Package Manager
                    </label>
                    <select
                      value={nodePkgManager}
                      onChange={(e) => setNodePkgManager(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="npm">npm</option>
                      <option value="pnpm">pnpm (Recommended)</option>
                      <option value="yarn">yarn</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Start / Run Script
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={nodeScript}
                        onChange={(e) => setNodeScript(e.target.value)}
                        placeholder="start"
                        list="detected-scripts-list"
                        className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                      />
                      <datalist id="detected-scripts-list">
                        {nodeDetectedScripts.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Translates to: <code>{nodePkgManager} {nodeScript === 'start' ? 'start' : `run ${nodeScript}`} -- --port {app.port}</code>
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      V8 Memory Limit (--max-old-space-size)
                    </label>
                    <select
                      value={nodeMemLimitMb}
                      onChange={(e) => setNodeMemLimitMb(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="0">0 (V8 Default ~1.4GB)</option>
                      <option value="512">512 MB (Lightweight)</option>
                      <option value="1024">1024 MB (1 GB Standard)</option>
                      <option value="2048">2048 MB (2 GB Medium)</option>
                      <option value="4096">4096 MB (4 GB Enterprise)</option>
                    </select>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-600 space-y-1">
                  <div className="font-bold text-slate-700">Supervisor Unit Drop-in Preview:</div>
                  <div className="text-purple-700">
                    ExecStart={nodePkgManager} {nodeScript === 'start' ? 'start' : `run ${nodeScript}`} -- --port {app.port}
                  </div>
                  {nodeMemLimitMb > 0 && (
                    <div className="text-emerald-700">
                      Environment=&quot;NODE_OPTIONS=--max-old-space-size={nodeMemLimitMb}&quot;
                    </div>
                  )}
                  <div className="text-slate-400">EnvironmentFile=/home/{app.tenantUser}/web/{app.name}/.env</div>
                </div>
              </div>
            )}

            {/* PYTHON WSGI / ASGI STUDIO */}
            {app.runtime === 'python' && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Python WSGI / ASGI Process Runner & Workers
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure Gunicorn / Uvicorn server runners, concurrency, and virtual environment.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Runner Engine
                    </label>
                    <select
                      value={pythonWsgi}
                      onChange={(e) => setPythonWsgi(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="gunicorn">Gunicorn (WSGI / Django / Flask)</option>
                      <option value="uvicorn">Uvicorn (ASGI / FastAPI / Starlette)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Worker Processes
                    </label>
                    <select
                      value={pythonWorkers}
                      onChange={(e) => setPythonWorkers(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="1">1 worker</option>
                      <option value="2">2 workers (Default)</option>
                      <option value="4">4 workers (Recommended)</option>
                      <option value="8">8 workers (High Traffic)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Threads per Worker
                    </label>
                    <select
                      value={pythonThreads}
                      onChange={(e) => setPythonThreads(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="1">1 thread</option>
                      <option value="2">2 threads</option>
                      <option value="4">4 threads</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Worker Timeout
                    </label>
                    <select
                      value={pythonTimeout}
                      onChange={(e) => setPythonTimeout(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds (Standard)</option>
                      <option value="120">120 seconds</option>
                      <option value="300">300 seconds (5 min)</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${pythonVenvExists ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <span className="text-xs font-bold text-slate-800">
                      Virtualenv (.venv): {pythonVenvExists ? 'Detected' : 'Not Found in Site Root'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      ({pythonVenvPath || `/home/${app.tenantUser}/web/${app.name}/.venv`})
                    </span>
                  </div>
                  {!pythonVenvExists && (
                    <span className="text-[11px] text-amber-700 font-medium">
                      Tip: initialize via Terminal: <code>python3 -m venv .venv</code>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* RUBY APPLICATION SERVER STUDIO */}
            {app.runtime === 'ruby' && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Ruby Puma Application Server Configuration
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure Puma clustered workers, thread pools, and port binding for <code>{app.name}</code>.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Application Server
                    </label>
                    <select
                      value={rubyAppServer}
                      onChange={(e) => setRubyAppServer(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="puma">Puma (Clustered - Recommended)</option>
                      <option value="unicorn">Unicorn</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Puma Workers
                    </label>
                    <select
                      value={rubyWorkers}
                      onChange={(e) => setRubyWorkers(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="1">1 worker</option>
                      <option value="2">2 workers (Default)</option>
                      <option value="4">4 workers (Production)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Threads per Worker
                    </label>
                    <select
                      value={rubyThreads}
                      onChange={(e) => setRubyThreads(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="1">1 thread</option>
                      <option value="5">5 threads (Puma Default)</option>
                      <option value="16">16 threads (High Concurrency)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* GO / RUST COMPILED BINARY STUDIO */}
            {(app.runtime === 'go' || app.runtime === 'rust') && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Compiled Native Binary Supervision & Startup Flags
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure the executable path and arguments passed to the {app.runtime === 'go' ? 'Go' : 'Rust'} service.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Executable Binary Path
                    </label>
                    <input
                      type="text"
                      value={binaryPath}
                      onChange={(e) => setBinaryPath(e.target.value)}
                      placeholder={app.runtime === 'rust' ? './target/release/app' : './bin/app'}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Relative to <code>/home/{app.tenantUser}/web/{app.name}/</code>
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Command Line Arguments & Flags
                    </label>
                    <input
                      type="text"
                      value={binaryArgs}
                      onChange={(e) => setBinaryArgs(e.target.value)}
                      placeholder="-env=production -port=8080"
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">
                      Space-separated CLI flags passed to <code>ExecStart</code>
                    </span>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-600">
                  <div className="font-bold text-slate-700">Supervisor ExecStart:</div>
                  <div className="text-purple-700 mt-0.5">
                    {binaryPath} {binaryArgs}
                  </div>
                  <div className="text-slate-400 mt-1">Bound to internal port: 127.0.0.1:{app.port}</div>
                </div>
              </div>
            )}

            {/* STATIC & SPA STUDIO */}
            {app.runtime === 'static' && (
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Static Web & Single Page Application (SPA) Routing
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Configure client-side router fallbacks for React, Vue, Svelte, and static document roots.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                    <div>
                      <div className="text-xs font-bold text-slate-800">SPA Router Fallback (try_files /index.html)</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Rewrites unmatched HTTP 404 paths to <code>/index.html</code> for client-side routing.
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpaFallback(!spaFallback)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        spaFallback ? 'bg-purple-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          spaFallback ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Document Root Directory
                    </label>
                    <select
                      value={docRoot}
                      onChange={(e) => setDocRoot(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                    >
                      <option value="public">public (Standard)</option>
                      <option value="dist">dist (Vite / React)</option>
                      <option value="build">build (CRA / Next Export)</option>
                      <option value=".">. (Site Root)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
            <VhostPreviewCard
              engine={app.webServer}
              filename={`barepod-${app.name}.${app.webServer === 'caddy' ? 'caddy' : 'conf'}`}
              config={vhostPreviewConfig}
              loading={isLoadingVhost}
              onRefresh={() => void loadVhostPreview()}
            />
          </div>
        )}

        {/* TAB 5: ACCESS CONTROL & SECURITY (MAINTENANCE & BASIC AUTH) */}
        {activeTab === 'security' && (
          <div className="space-y-6">
            {/* Top Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50/40 to-blue-50 border border-purple-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-sm">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Edge Access Control & Traffic Protection
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Enforced directly at the web server layer ({app.webServer.toUpperCase()}) without burdening the {app.runtime.toUpperCase()} runtime.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${
                  maintenanceMode 
                    ? 'bg-amber-100 text-amber-900 border-amber-300' 
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Maintenance: {maintenanceMode ? '503 ACTIVE' : 'OFF'}</span>
                </span>
                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 ${
                  basicAuthEnabled 
                    ? 'bg-purple-100 text-purple-900 border-purple-300' 
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Basic Auth: {basicAuthEnabled ? 'PROTECTED' : 'OFF'}</span>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* CARD 1: MAINTENANCE MODE */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col justify-between">
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          Maintenance Mode (HTTP 503)
                        </h4>
                        <p className="text-xs text-slate-500">
                          Redirect visitors to a scheduled maintenance downtime page
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleMaintenance}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        maintenanceMode ? 'bg-amber-500' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          maintenanceMode ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className={`p-3 rounded-xl border text-xs ${
                    maintenanceMode 
                      ? 'bg-amber-50/80 border-amber-200 text-amber-900' 
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}>
                    {maintenanceMode ? (
                      <div className="flex items-start gap-2">
                        <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping mt-1 shrink-0" />
                        <div>
                          <strong>Maintenance Mode Is Active!</strong>
                          <p className="mt-0.5 text-[11px] text-amber-800">
                            General visitors receive HTTP 503 Service Unavailable. Whitelisted IPs retain full access to the app.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px]">
                        The website is operating normally. Turn on the toggle above to run a database migration, framework upgrade, or emergency maintenance.
                      </p>
                    )}
                  </div>

                  <form onSubmit={handleSaveMaintenanceConfig} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Custom Maintenance Message (shown to visitors)
                      </label>
                      <textarea
                        rows={3}
                        value={maintenanceMessage}
                        onChange={(e) => setMaintenanceMessage(e.target.value)}
                        placeholder="Write the maintenance message shown to visitors..."
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-amber-500 focus:outline-hidden resize-none font-medium"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-bold text-slate-700">
                          IP Whitelist Bypass (Developer / Admin)
                        </label>
                        {maintenanceBypassIps && (
                          <button
                            type="button"
                            onClick={() => setMaintenanceBypassIps('')}
                            className="text-[10px] font-bold text-rose-600 hover:text-rose-800 cursor-pointer"
                          >
                            ✕ Clear All (Block Everyone)
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={maintenanceBypassIps}
                        onChange={(e) => setMaintenanceBypassIps(e.target.value)}
                        placeholder="Leave blank to serve 503 to ALL visitors (e.g. 180.252.10.5)"
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:border-amber-500 focus:outline-hidden"
                      />
                      <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                        Comma-separated IP list. <em>Important: Do not enter <code>127.0.0.1</code> when using Cloudflare Tunnel, as tunnel traffic originates from localhost and would bypass maintenance for all visitors.</em>
                      </p>
                    </div>

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPreviewMaintenanceOpen(true)}
                        className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-amber-600" />
                        <span>Preview 503 Page</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSavingMaintenance}
                        className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-2xs"
                      >
                        {isSavingMaintenance ? 'Applying...' : 'Save 503 Settings'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* CARD 2: ANTI-BRUTE FORCE PROTECTION */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          Anti-Brute Force Protection
                        </h4>
                        <p className="text-xs text-slate-500">
                          Throttle failed logins and temporarily ban abusive IPs
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleAntiBruteforce}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        antiBruteforce ? 'bg-rose-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          antiBruteforce ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className={`p-3 rounded-xl border text-xs ${
                    antiBruteforce
                      ? 'bg-rose-50/80 border-rose-200 text-rose-900'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}>
                    {antiBruteforce ? (
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>Protection Active</strong>
                          <p className="mt-0.5 text-[11px] text-rose-800">
                            Max {antiBruteforceMaxAttempts} failed attempts trigger a {antiBruteforceBanMinutes}-minute IP ban. Mirrored to {app.webServer.toUpperCase()} rate limiting + WAF rule.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px]">
                        Login throttling is off. Enable it to protect admin panels and auth endpoints from credential-stuffing.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Max Failed Attempts
                      </label>
                      <select
                        value={antiBruteforceMaxAttempts}
                        disabled={!antiBruteforce}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setAntiBruteforceMaxAttempts(v);
                          onUpdateApp?.({ ...app, antiBruteforce, antiBruteforceMaxAttempts: v, antiBruteforceBanMinutes });
                        }}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-rose-500 focus:outline-hidden disabled:opacity-50"
                      >
                        <option value={3}>3 attempts</option>
                        <option value={5}>5 attempts</option>
                        <option value={10}>10 attempts</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Ban Duration
                      </label>
                      <select
                        value={antiBruteforceBanMinutes}
                        disabled={!antiBruteforce}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setAntiBruteforceBanMinutes(v);
                          onUpdateApp?.({ ...app, antiBruteforce, antiBruteforceMaxAttempts, antiBruteforceBanMinutes: v });
                        }}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-rose-500 focus:outline-hidden disabled:opacity-50"
                      >
                        <option value={5}>5 minutes</option>
                        <option value={15}>15 minutes</option>
                        <option value={60}>60 minutes</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* CARD 3: HTTP BASIC AUTHENTICATION */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col justify-between">
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center">
                        <Lock className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          HTTP Basic Authentication
                        </h4>
                        <p className="text-xs text-slate-500">
                          Require login credentials via the browser's built-in dialog (.htpasswd)
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleToggleBasicAuth}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        basicAuthEnabled ? 'bg-purple-600' : 'bg-slate-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          basicAuthEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className={`p-3 rounded-xl border text-xs ${
                    basicAuthEnabled 
                      ? 'bg-purple-50/80 border-purple-200 text-purple-900' 
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                  }`}>
                    {basicAuthEnabled ? (
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                        <div>
                          <strong>Password Protection Active</strong>
                          <p className="mt-0.5 text-[11px] text-purple-800">
                            Every request to <code className="font-mono">{app.domain}</code> is challenged with HTTP 401 Unauthorized until the visitor enters valid credentials.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px]">
                        Public access is open without a password. Ideal for staging sites, internal APIs, or dashboards before public release.
                      </p>
                    )}
                  </div>

                  <form onSubmit={handleSaveBasicAuthConfig} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Auth Username
                        </label>
                        <input
                          type="text"
                          required
                          value={basicAuthUser}
                          onChange={(e) => setBasicAuthUser(e.target.value)}
                          placeholder="e.g. admin"
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-purple-500 focus:outline-hidden"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-700">
                            Auth Password
                          </label>
                          <button
                            type="button"
                            onClick={handleGeneratePassword}
                            className="text-[10px] font-bold text-purple-600 hover:text-purple-800"
                          >
                            Generate
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showBasicAuthPassword ? 'text' : 'password'}
                            required
                            value={basicAuthPassword}
                            onChange={(e) => setBasicAuthPassword(e.target.value)}
                            placeholder="Type password"
                            className="w-full px-3 py-2 pr-9 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:border-purple-500 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => setShowBasicAuthPassword(!showBasicAuthPassword)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          >
                            {showBasicAuthPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Realm Title (Browser Dialog Message)
                      </label>
                      <input
                        type="text"
                        value={basicAuthRealm}
                        onChange={(e) => setBasicAuthRealm(e.target.value)}
                        placeholder="Example: Protected Staging Area"
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-purple-500 focus:outline-hidden"
                      />
                    </div>

                    {/* Quick cURL Test Snippet */}
                    <div className="p-2.5 bg-slate-900 rounded-xl text-slate-200 font-mono text-[11px] flex items-center justify-between gap-2 overflow-hidden">
                      <div className="truncate text-slate-300">
                        <span className="text-purple-400 font-bold">curl</span> -i -u "{basicAuthUser}:{basicAuthPassword ? '***' : ''}" https://{app.domain}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyCurl(`curl -i -u "${basicAuthUser}:${basicAuthPassword}" https://${app.domain}`)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-sans font-bold flex items-center gap-1 shrink-0"
                      >
                        {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCurl ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>

                    {/* Browser Credential Cache Notice & Rotate Realm Helper */}
                    <div className="p-3 bg-purple-50/70 border border-purple-200/80 rounded-xl text-[11px] text-purple-950 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center gap-1">
                          💡 Why doesn't the browser prompt for credentials again after logging in?
                        </span>
                        {basicAuthEnabled && (
                          <button
                            type="button"
                            onClick={handleRotateRealm}
                            disabled={isSavingBasicAuth}
                            className="px-2.5 py-1 text-[10px] font-bold bg-white text-purple-700 hover:bg-purple-100 border border-purple-300 rounded-lg flex items-center gap-1 shadow-2xs transition-colors cursor-pointer shrink-0"
                            title="Rotate Realm ID to force browser to re-prompt for authentication"
                          >
                            <RefreshCw className={`w-3 h-3 ${isSavingBasicAuth ? 'animate-spin' : ''}`} />
                            <span>Force Re-Login (Rotate Realm)</span>
                          </button>
                        )}
                      </div>
                      <p className="text-slate-600 leading-relaxed text-[10px]">
                        HTTP Basic Auth standard: Browsers (Chrome/Firefox/Edge) cache your credentials in memory until the browser is closed. To prompt the login dialog again during testing, click <strong>Force Re-Login</strong> above or open the site in an <strong>Incognito / Private Window</strong>.
                      </p>
                    </div>

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setIsTestBasicAuthOpen(true)}
                        className="px-3 py-2 text-xs font-bold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Key className="w-3.5 h-3.5 text-purple-600" />
                        <span>Test Prompt Dialog (Simulator)</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSavingBasicAuth}
                        className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all shadow-sm shadow-purple-500/25 cursor-pointer"
                      >
                        {isSavingBasicAuth ? 'Saving...' : 'Save .htpasswd'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* CARD 4: IP ACCESS CONTROL (ALLOWLIST / DENYLIST) */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col justify-between">
                <div className="p-5 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center">
                        <Shield className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          IP Access Control
                        </h4>
                        <p className="text-xs text-slate-500">
                          Allow or block specific client IPs or CIDR networks
                        </p>
                      </div>
                    </div>

                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                      ipRestrictionMode === 'allowlist'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                        : ipRestrictionMode === 'denylist'
                        ? 'bg-rose-100 text-rose-800 border border-rose-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}>
                      {ipRestrictionMode === 'none' ? 'Open Access' : ipRestrictionMode}
                    </span>
                  </div>

                  <form onSubmit={handleSaveIpRestriction} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        Restriction Mode
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setIpRestrictionMode('none')}
                          className={`py-1.5 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                            ipRestrictionMode === 'none'
                              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Disabled (Open)
                        </button>
                        <button
                          type="button"
                          onClick={() => setIpRestrictionMode('allowlist')}
                          className={`py-1.5 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                            ipRestrictionMode === 'allowlist'
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Allowlist Only
                        </button>
                        <button
                          type="button"
                          onClick={() => setIpRestrictionMode('denylist')}
                          className={`py-1.5 px-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                            ipRestrictionMode === 'denylist'
                              ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                              : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          Denylist (Block)
                        </button>
                      </div>
                    </div>

                    {ipRestrictionMode !== 'none' && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          {ipRestrictionMode === 'allowlist' ? 'Whitelisted IPs / CIDRs' : 'Blocked IPs / CIDRs'}
                        </label>
                        <textarea
                          rows={3}
                          value={ipRestrictionList}
                          onChange={(e) => setIpRestrictionList(e.target.value)}
                          placeholder="Example: 192.168.1.0/24, 10.0.0.1, 103.21.244.0/22"
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:border-blue-500 focus:outline-hidden resize-none"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                          Separate with commas or newlines. Enforced natively by {app.webServer.toUpperCase()}.
                        </p>
                      </div>
                    )}

                    <div className="pt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={isSavingIpRestriction}
                        className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm shadow-blue-500/25 cursor-pointer"
                      >
                        {isSavingIpRestriction ? 'Saving...' : 'Save IP Rules'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

            </div>

          </div>
        )}

        {/* TAB: DEPLOY & BUILD SCRIPT (PERSISTENT PER APP) */}
        {activeTab === 'deploy' && (
          <div className="space-y-6">
            {/* Auto-detected Git repository banner */}
            {gitStatus?.detected && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-purple-50/80 border border-purple-200 rounded-2xl shadow-2xs">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <FolderGit2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-purple-950">
                        Git Repository Auto-Detected on Server
                      </h4>
                      <span className="text-[10px] font-bold bg-purple-200/80 text-purple-900 px-2 py-0.5 rounded font-mono">
                        .git active
                      </span>
                    </div>
                    <p className="text-xs text-purple-900 mt-0.5">
                      Remote: <code className="font-mono font-bold bg-white/70 px-1.5 py-0.5 rounded border border-purple-200">{gitStatus.repo || 'origin'}</code>
                      {gitStatus.commit && (
                        <span className="ml-2">
                          (Commit: <code className="font-mono">{gitStatus.commit}</code>{gitStatus.commitMessage ? ` - ${gitStatus.commitMessage}` : ''})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-mono font-bold text-purple-900 bg-white px-3 py-1.5 rounded-xl border border-purple-200">
                    Branch: {gitStatus.branch || gitBranch}
                  </span>
                </div>
              </div>
            )}

            {/* Auto-detected Framework & Vercel-style CI/CD Banner */}
            {gitStatus?.framework && (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 bg-gradient-to-r from-indigo-50/90 via-purple-50/90 to-blue-50/90 border border-indigo-200/90 rounded-2xl shadow-2xs">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Zap className="w-5 h-5 text-amber-300" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900">
                        Auto-Detected Framework: {gitStatus.framework.title}
                      </h4>
                      <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-mono border border-indigo-200">
                        Vercel-Style CI/CD
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Runtime: <span className="font-semibold text-indigo-700">{gitStatus.framework.runtime.toUpperCase()} {gitStatus.framework.version || ''}</span> ·
                      Package Manager: <span className="font-semibold text-slate-800">{gitStatus.framework.packageManager}</span>
                      {gitStatus.framework.docRoot && <> · Web Root: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-indigo-200 text-emerald-700">/{gitStatus.framework.docRoot}</code></>}
                      {gitStatus.framework.databaseEngine && <> · Recommended DB: <span className="font-semibold text-amber-700">{gitStatus.framework.databaseEngine}</span></>}
                    </p>
                  </div>
                </div>

                {gitStatus.framework.buildCommand && (
                  <button
                    type="button"
                    onClick={() => {
                      setBuildScript(gitStatus.framework?.buildCommand || '');
                      onShowToast?.('Framework Preset Loaded', `Loaded recommended CI/CD build script for ${gitStatus.framework?.title}. Click 'Save Deploy Configuration' below to apply.`, 'success');
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs shrink-0 whitespace-nowrap transition-all cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Apply Framework Preset</span>
                  </button>
                )}
              </div>
            )}

            {/* If site has NO git repo configured and NO .git detected and user hasn't clicked connect: show clean local info card */}
            {!siteHasGit(app) && !gitStatus?.detected && !showConnectGit ? (
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                      <Folder className="w-6 h-6 text-amber-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">
                          Deployment Mode: Local File System / Application Scaffold
                        </h3>
                        <span className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">
                          {app.framework || app.runtime.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                        This website runs directly from local files in <code>{appPath}</code>.
                        You can upload files via File Manager or run commands in Web Terminal. If you want automated CI/CD, connect a Git repository below.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleTriggerDirectDeploy}
                      disabled={isDeployingNow}
                      className="px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-2 shrink-0 shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
                      <span>{isDeployingNow ? 'Deploying...' : 'Redeploy Now'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowConnectGit(true)}
                      className="px-4 py-2.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
                    >
                      <FolderGit2 className="w-4 h-4 text-purple-600" />
                      <span>Connect Git</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Top Persistence Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-blue-50/70 border border-blue-200 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                      <FolderGit2 className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">
                          Source &amp; Deployment
                        </h3>
                        <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1 font-mono">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Persistent in DB</span>
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-slate-800">{gitBranch || 'main'}</span>
                        <span className="text-slate-400">·</span>
                        <span>
                          {autoDeploy
                            ? gitStatus?.autoDeployMode === 'webhook'
                              ? 'Webhook auto-deploy'
                              : gitStatus?.autoDeployMode === 'poll'
                                ? `Polling every ${Math.max(1, Math.round((gitStatus?.autoDeployPollSec || 300) / 60))}m`
                                : 'Manual webhook only'
                            : 'Auto-deploy off'}
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="truncate">{gitRepo || 'Local files'}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleSaveDeployScript}
                      disabled={isSavingDeployScript}
                      className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                    >
                      <Save className={`w-3.5 h-3.5 ${isSavingDeployScript ? 'animate-spin' : 'text-blue-600'}`} />
                      <span>{isSavingDeployScript ? 'Saving...' : 'Save Git Config'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTriggerDirectDeploy}
                      disabled={isDeployingNow}
                      className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 disabled:opacity-50 cursor-pointer"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
                      <span>{isDeployingNow ? 'Deploying...' : 'Redeploy Now'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-slate-600">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoDeploy}
                      onChange={(e) => void handleAutoDeployModeChange(e.target.checked ? 'auto' : 'none')}
                      disabled={isSavingAutoDeployMode || !hasGitRepository}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <span className="font-bold text-slate-800">Auto-deploy</span>
                  </label>
                  <select
                    value={gitStatus?.autoDeployMode === 'webhook' ? 'webhook' : gitStatus?.autoDeployMode === 'poll' ? 'poll' : 'none'}
                    onChange={(e) => void handleAutoDeployModeChange(e.target.value as 'auto' | 'webhook' | 'poll' | 'none')}
                    disabled={isSavingAutoDeployMode || !hasGitRepository}
                    className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded-lg disabled:opacity-50"
                  >
                    <option value="none">Off — manual deploy only</option>
                    <option value="auto">Auto (webhook, fallback poll)</option>
                    <option value="webhook">Webhook only</option>
                    <option value="poll">Polling only</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleCheckGitNow()}
                    disabled={isCheckingGit || !hasGitRepository}
                    className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {isCheckingGit ? 'Checking…' : 'Check now'}
                  </button>
                  <span className="text-slate-500">
                    {gitStatus?.lastGitPollAt
                      ? `Last checked ${new Date(gitStatus.lastGitPollAt).toLocaleString()}`
                      : 'Not checked yet'}
                  </span>
                </div>

                {/* Advanced settings stay closed so the common path is just source + history. */}
                <button
                  type="button"
                  onClick={() => setShowAdvancedDeploy((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                  aria-expanded={showAdvancedDeploy}
                >
                  <span className="flex items-center gap-2 text-left">
                    <Sliders className="w-4 h-4 text-slate-500 shrink-0" />
                    <span>
                      <span className="block text-xs font-bold text-slate-900">Advanced Build &amp; Shell Settings</span>
                      <span className="block text-[11px] text-slate-500">Repository, branch, deploy key, webhook URL and build script</span>
                    </span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${showAdvancedDeploy ? 'rotate-180' : ''}`} />
                </button>

                {showAdvancedDeploy && (<>
                {/* Git Repo & Branch Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-2 p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-800">
                        Git Repository URL (GitHub / GitLab / Gitea / Custom)
                      </label>
                      {gitRepo && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm('Disconnect Git repository from this website?')) {
                              setGitRepo('');
                              setShowConnectGit(false);
                            }
                          }}
                          className="text-[11px] text-red-600 hover:underline cursor-pointer"
                        >
                          Disconnect Git
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={gitRepo}
                      onChange={(e) => setGitRepo(e.target.value)}
                      placeholder="https://github.com/username/repository.git or git@github.com:..."
                      className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white"
                    />
                    <span className="text-[11px] text-slate-500 block">
                      Upstream remote URL used for automatic pulling and resetting.
                    </span>
                  </div>

                  <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                    <label className="block text-xs font-bold text-slate-800">
                      Target Branch
                    </label>
                    <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus-within:border-blue-500 focus-within:bg-white">
                      <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        value={gitBranch}
                        onChange={(e) => handleBranchChange(e.target.value)}
                        placeholder="main"
                        className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800 font-mono text-xs font-bold"
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 block">
                      Branch checked out automatically on deploy.
                    </span>
                  </div>
                </div>

                {/* SSH Deploy Key Card */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-amber-600" />
                      <span>Dedicated SSH Deploy Key (Private Git Repositories)</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleRotateDeployKeyInPage}
                      disabled={isRotatingDeployKey}
                      className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isRotatingDeployKey ? 'animate-spin' : ''}`} />
                      <span>Rotate Key</span>
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={deployKeyInfo?.publicKey || 'Loading ED25519 deploy key...'}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={handleCopyDeployKeyInPage}
                      disabled={!deployKeyInfo?.publicKey}
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer disabled:opacity-50"
                    >
                      {copiedDeployKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedDeployKey ? 'Copied' : 'Copy Key'}</span>
                    </button>
                  </div>
                  {deployKeyInfo?.fingerprint && (
                    <p className="text-[10px] text-slate-500 font-mono">
                      Fingerprint: <span className="text-slate-700">{deployKeyInfo.fingerprint}</span> (ED25519, mode 0600 tenant-isolated)
                    </p>
                  )}
                </div>

                {/* Webhook Push-to-Deploy */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-blue-600 animate-pulse" />
                      <span className="text-xs font-bold text-slate-900">Push-to-Deploy Webhook URL</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        autoDeploy ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {!autoDeploy
                          ? 'Disabled'
                          : gitStatus?.autoDeployMode === 'webhook'
                            ? 'Webhook Active'
                            : gitStatus?.autoDeployMode === 'poll'
                              ? `Polling every ${Math.max(1, Math.round((gitStatus?.autoDeployPollSec || 300) / 60))}m`
                              : 'Manual webhook only'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={gitStatus?.webhookUrl || `${window.location.origin}/api/v1/webhooks/deploy/${app.name}?token=${app.deployHookToken || ''}`}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={handleCopyDeployWebhook}
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
                    >
                      {copiedDeployWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedDeployWebhook ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  {/* Webhook Quick Guide */}
                  <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-slate-700 space-y-1.5">
                    <span className="font-bold text-blue-950 block">Setup Instructions for Git Providers:</span>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-600">
                      <li><strong>GitHub:</strong> Repository Settings &rarr; Webhooks &rarr; Add Webhook &rarr; Paste Payload URL, Content-Type: <code>application/json</code>, Event: <em>Just the push event</em>.</li>
                      <li><strong>GitLab:</strong> Settings &rarr; Webhooks &rarr; Add new webhook &rarr; Paste URL, Trigger: <em>Push events</em>.</li>
                      <li><strong>Gitea:</strong> Settings &rarr; Webhooks &rarr; Add Gitea webhook &rarr; Paste Target URL.</li>
                    </ul>
                    <p className="text-[11px] text-blue-900 font-semibold pt-0.5">
                      {!autoDeploy
                        ? '⚠️ Auto-deploy is off: pushes will not deploy this site; use Redeploy Now or choose a mode above.'
                        : gitStatus?.autoDeployMode === 'webhook'
                          ? '✓ Webhook active: pushing to ' + gitBranch + ' calls the panel directly.'
                          : gitStatus?.autoDeployMode === 'poll'
                            ? `✓ Commit polling active (every ${Math.max(1, Math.round((gitStatus?.autoDeployPollSec || 300) / 60))} min): works on private/LAN hosts without an inbound webhook.`
                            : 'ℹ️ This site kept its pre-update setting: a manually configured webhook still works, but the panel is not polling it. Choose Auto or Polling above to enable managed auto-deploy.'}
                    </p>
                  </div>
                </div>
                  </>)}
            </>
            )}

            {showAdvancedDeploy && (<>
            {/* Build Script Editor Card */}
            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                      <Code2 className="w-4 h-4 text-slate-600" />
                      <span>Deploy & Build Script Editor</span>
                    </h4>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                        isGitConnected
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                      title={isGitConnected ? `Connected to Git repository (${gitBranch || 'main'})` : 'No remote Git repository configured for this site'}
                    >
                      {isGitConnected ? `Git: ${gitBranch || 'main'}` : 'No Git'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bash shell commands run sequentially inside the tenant sandbox on build/redeploy.
                  </p>
                </div>

                {/* Script Presets Dropdown & Git Toggle */}
                <div className="flex items-center gap-2 flex-wrap">
                  {detectedFramework && (
                    <button
                      type="button"
                      onClick={() => handleApplyPresetInDetail(detectedFramework.name as any)}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 shadow-2xs"
                      title={`Load recommended build commands for detected ${detectedFramework.title}`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      <span>Preset: {detectedFramework.title}</span>
                    </button>
                  )}

                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) {
                        handleApplyPresetInDetail(e.target.value as any);
                        e.target.value = '';
                      }
                    }}
                    className="text-xs font-semibold bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-700 py-1.5 pl-2.5 pr-7 focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                  >
                    <option value="" disabled>⚡ Load Framework Preset...</option>
                    <optgroup label="🐘 PHP">
                      <option value="laravel">Laravel (Artisan, Migrate, Cache)</option>
                      <option value="wordpress">WordPress (WP-CLI, DB, Rewrite)</option>
                      <option value="php">Generic PHP (Composer)</option>
                    </optgroup>
                    <optgroup label="🟢 Node.js">
                      <option value="nextjs">Next.js / Nuxt (Build & PM2)</option>
                      <option value="vite">Vite / React / Vue (SPA Build)</option>
                      <option value="express">Express / NestJS (API & PM2)</option>
                    </optgroup>
                    <optgroup label="🐍 Python">
                      <option value="fastapi">FastAPI / Flask (Pip & Gunicorn)</option>
                      <option value="django">Django (Migrate & Collectstatic)</option>
                    </optgroup>
                    <optgroup label="🐹 Go">
                      <option value="go">Go (Build Binary & Reload)</option>
                    </optgroup>
                    <optgroup label="🌐 Static">
                      <option value="static">Static HTML / CSS / JS</option>
                    </optgroup>
                  </select>

                  {/* Quick toggle git pull */}
                  <button
                    type="button"
                    onClick={handleToggleGitPull}
                    title={buildScript.includes('git pull') ? 'Remove "git pull" step from build script' : 'Prepend "git pull" step to build script'}
                    className={`px-2.5 py-1.5 text-xs font-semibold border rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
                      buildScript.includes('git pull')
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>{buildScript.includes('git pull') ? 'git pull: ON' : '+ git pull'}</span>
                  </button>
                </div>
              </div>

              {/* Code Terminal Textarea */}
              <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs shadow-inner">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <span>WorkingDirectory: <code>{appPath}</code></span>
                  </div>
                  <span className="text-cyan-400">/bin/bash (isolated cgroup jail)</span>
                </div>
                <textarea
                  rows={7}
                  value={buildScript}
                  onChange={(e) => setBuildScript(e.target.value)}
                  placeholder="Example:&#10;git pull origin main&#10;composer install --no-dev&#10;php artisan migrate --force&#10;systemctl reload-app"
                  className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-y font-mono text-xs focus:ring-0 leading-relaxed min-h-[140px]"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                <div className="text-[11px] text-slate-400">
                  Available environment variables: <code>$APP_NAME</code>, <code>$APP_PORT</code>, <code>$APP_DOMAIN</code>, <code>$TENANT_USER</code>.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDeployScript}
                    disabled={isSavingDeployScript}
                    className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-600" />
                    <span>{isSavingDeployScript ? 'Saving...' : 'Save Script'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTriggerDirectDeploy}
                    disabled={isDeployingNow}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
                    <span>{isDeployingNow ? 'Deploying...' : 'Save & Redeploy Now'}</span>
                  </button>
                </div>
              </div>
            </div>
            </>)}

            {/* Deployment Live Log Terminal */}
            <div id="deploy-log-terminal" className="p-5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-600" />
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Live Build & Deployment Output
                  </h4>
                  {isLoadingDeployLogs && (
                    <RefreshCw className="w-3 h-3 text-blue-500 animate-spin" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onWatchDeploy?.(app.name)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                    title="Open live log streaming monitor popup"
                  >
                    <ExternalLink className="w-3 h-3 text-blue-600" />
                    <span>Open Floating Monitor</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (deployLogs.length > 0) {
                        navigator.clipboard.writeText(deployLogs.join('\n'));
                        onShowToast?.('Logs Copied', 'Deployment build logs copied to clipboard.', 'success');
                      }
                    }}
                    disabled={deployLogs.length === 0}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Copy className="w-3 h-3 text-slate-600" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => loadDeployLogs(true)}
                    disabled={isLoadingDeployLogs}
                    className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 text-slate-600 ${isLoadingDeployLogs ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>
              <div
                ref={deployLogContainerRef}
                className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs text-slate-200 min-h-[160px] max-h-[300px] overflow-y-auto space-y-1.5 shadow-inner"
              >
                {deployLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500">
                    {isLoadingDeployLogs ? (
                      <div className="flex items-center gap-2 text-slate-400">
                        <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                        <span>Fetching build logs from server...</span>
                      </div>
                    ) : (
                      <>
                        <Terminal className="w-6 h-6 text-slate-600 mb-2" />
                        <p className="text-xs text-slate-400">No deployment logs available yet for this website.</p>
                        <button
                          type="button"
                          onClick={() => loadDeployLogs(true)}
                          className="mt-2 px-3 py-1 text-[11px] font-semibold text-blue-400 hover:text-blue-300 underline cursor-pointer"
                        >
                          Check for latest logs
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  deployLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={
                        log.includes('[OK]') || log.includes('SUCCESS')
                          ? 'text-emerald-400 font-bold'
                          : log.includes('[FAIL]') || log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                            ? 'text-rose-400 font-bold'
                            : log.includes('[CMD]')
                              ? 'text-cyan-400 font-semibold'
                              : 'text-slate-300'
                      }
                    >
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Deployment history: commit, author, trigger, duration and status per run. */}
            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-600" />
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Deployment History
                  </h4>
                  {isLoadingDeployHistory && <RefreshCw className="w-3 h-3 text-blue-500 animate-spin" />}
                </div>
                <button
                  type="button"
                  onClick={loadDeployHistory}
                  disabled={isLoadingDeployHistory}
                  className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 self-start sm:self-auto"
                >
                  <RefreshCw className={`w-3 h-3 text-slate-600 ${isLoadingDeployHistory ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {deployHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-slate-500">
                  <Clock className="w-6 h-6 text-slate-400 mb-2" />
                  <p className="text-xs">No deployments recorded yet for this website.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                        <th className="py-2 pr-3 font-bold">Commit</th>
                        <th className="py-2 pr-3 font-bold">Message</th>
                        <th className="py-2 pr-3 font-bold">Trigger</th>
                        <th className="py-2 pr-3 font-bold">Duration</th>
                        <th className="py-2 pr-3 font-bold">Status</th>
                        <th className="py-2 pr-3 font-bold">When</th>
                        <th className="py-2 font-bold text-right">Log</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deployHistory.map((job) => (
                        <tr key={job.id} className="border-b border-slate-50 hover:bg-slate-50/70">
                          <td className="py-2 pr-3 font-mono text-[11px] text-slate-700">
                            {job.commit ? job.commit.slice(0, 7) : '—'}
                          </td>
                          <td className="py-2 pr-3 text-slate-700 max-w-[280px]">
                            <div className="truncate" title={job.commitMessage || ''}>
                              {job.commitMessage || job.currentStep || '—'}
                            </div>
                            {job.commitAuthor && (
                              <div className="text-[10px] text-slate-400 truncate">{job.commitAuthor}</div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-[11px] text-slate-500 capitalize">
                            {job.trigger || 'manual'}
                          </td>
                          <td className="py-2 pr-3 text-[11px] text-slate-500">
                            {job.durationMs ? `${(job.durationMs / 1000).toFixed(1)}s` : '—'}
                          </td>
                          <td className="py-2 pr-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                job.status === 'success'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : job.status === 'failed'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {job.status}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-[11px] text-slate-500">
                            {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleViewDeployLog(job)}
                              className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
                            >
                              View Log
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Danger Zone: Only shown inside the Access & Security tab */}
        {activeTab === 'security' && (
          <div className="bg-white rounded-2xl border border-rose-200/80 p-6 shadow-xs overflow-hidden mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Danger Zone</h3>
                    <p className="text-xs text-slate-500">
                      Permanently delete website <span className="font-mono font-bold text-slate-700">{app.name}</span>, including its virtual hosts, systemd services, and configuration.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteDatabasesOption('keep');
                  setShowDeleteModal(true);
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors shadow-sm shadow-rose-500/25 cursor-pointer shrink-0 flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Website</span>
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Maintenance Preview Simulator Modal */}
      <MaintenancePreviewModal
        isOpen={isPreviewMaintenanceOpen}
        onClose={() => setIsPreviewMaintenanceOpen(false)}
        domain={app.domain}
        appName={app.name}
        message={maintenanceMessage}
        bypassIps={maintenanceBypassIps}
      />

      {/* HTTP Basic Auth Prompt Simulator Modal */}
      <BasicAuthPromptModal
        isOpen={isTestBasicAuthOpen}
        onClose={() => setIsTestBasicAuthOpen(false)}
        domain={app.domain}
        expectedUser={basicAuthUser}
        expectedPass={basicAuthPassword}
        realm={basicAuthRealm}
      />

      {/* SSL Certificate Issuance & Provider Selection Modal */}
      {sslModalDomain && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Configure SSL Certificate
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {sslModalDomain.domain}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSslModalDomain(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Issuance Provider
                </label>
                <div className="space-y-2">
                  {/* Let's Encrypt Option */}
                  <button
                    type="button"
                    onClick={() => setSslModalProvider('letsencrypt')}
                    className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                      sslModalProvider === 'letsencrypt'
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-950 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>Let's Encrypt (Production ACME)</span>
                        <span className="text-[10px] bg-emerald-200/80 text-emerald-900 font-bold px-1.5 py-0.5 rounded">
                          Trusted Public CA
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        Industry-standard TLS 1.3 certificate recognized by all modern browsers. Auto-renews every 60 days. Requires domain DNS to point to this server.
                      </p>
                    </div>
                  </button>

                  {/* Self-Signed Option */}
                  <button
                    type="button"
                    onClick={() => setSslModalProvider('self_signed')}
                    className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                      sslModalProvider === 'self_signed'
                        ? 'border-purple-500 bg-purple-50/50 text-purple-950 ring-2 ring-purple-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Lock className="w-4 h-4 text-purple-600" />
                    </div>
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>Self-Signed (Local Development / Staging)</span>
                        <span className="text-[10px] bg-purple-200/80 text-purple-900 font-bold px-1.5 py-0.5 rounded">
                          Instant TLS
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        Instant ECDSA P-256 certificate generated locally by BarePod. Ideal for testing, internal domains, or dev environments without public DNS.
                      </p>
                    </div>
                  </button>

                  {/* Auto Fallback Option */}
                  <button
                    type="button"
                    onClick={() => setSslModalProvider('auto')}
                    className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3 ${
                      sslModalProvider === 'auto'
                        ? 'border-blue-500 bg-blue-50/50 text-blue-950 ring-2 ring-blue-500/20'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 mt-0.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <span>Auto-Detect (Let's Encrypt with Fallback)</span>
                        <span className="text-[10px] bg-blue-200/80 text-blue-900 font-bold px-1.5 py-0.5 rounded">
                          Automatic
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                        Tries Let's Encrypt first. If public DNS is not pointed to this server yet, automatically issues a self-signed certificate so HTTPS works immediately.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {sslModalProvider !== 'self_signed' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Notification Email (Optional)
                  </label>
                  <input
                    type="email"
                    placeholder="admin@example.com"
                    value={sslModalEmail}
                    onChange={(e) => setSslModalEmail(e.target.value)}
                    className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden focus:border-blue-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Used by Let's Encrypt ACME to send critical certificate expiry notices.
                  </p>
                </div>
              )}

              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2.5">
                <div className="text-xs font-bold text-slate-800">Redirection & Security Settings</div>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sslModalForceHttps}
                    onChange={(e) => setSslModalForceHttps(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800">
                      Force HTTPS (HTTP 301 Permanent Redirect)
                    </span>
                    <p className="text-[10px] text-slate-500">
                      Automatically reroutes all unencrypted port 80 traffic to encrypted HTTPS port 443.
                    </p>
                  </div>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={sslModalHsts}
                    onChange={(e) => setSslModalHsts(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-slate-800">
                      Enable HSTS (Strict-Transport-Security)
                    </span>
                    <p className="text-[10px] text-slate-500">
                      Instructs browsers to always use HTTPS for 1 year.
                    </p>
                  </div>
                </label>
              </div>

              {/* Notice for domains that don't resolve */}
              {sslModalProvider === 'letsencrypt' && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] leading-relaxed">
                    <strong>DNS Requirement:</strong> Ensure an <code>A</code> or <code>AAAA</code> record for <code>{sslModalDomain.domain}</code> points to this server's public IP before submitting. If not, choose <strong>Self-Signed</strong> or <strong>Auto-Detect</strong>.
                  </p>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSslModalDomain(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleIssueSslModalSubmit}
                disabled={Boolean(issuingSslId)}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {issuingSslId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Issuing & Installing...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3.5 h-3.5" />
                    <span>Issue & Install Certificate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Domain Modal */}
      {editingDomain && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                  <Globe className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Edit Domain & DNS Routing
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {editingDomain.isPrimary ? 'Primary Domain' : 'Alias Domain'} · Current: <strong>{editingDomain.domain}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingDomain(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDomainEdit}>
              <div className="p-5 space-y-4">
                {/* DNS Routing Type (Cloudflare vs Direct Public IP) */}
                {isTunnelAutoSync ? (
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-700">
                      DNS Routing Method
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setEditDnsMode('cloudflare')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          editDnsMode === 'cloudflare'
                            ? 'bg-amber-50/70 border-amber-300 ring-2 ring-amber-500/20'
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                          <CloudRain className="w-4 h-4 text-amber-500" />
                          <span>Cloudflare Zone</span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          Select from connected Cloudflare zones
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditDnsMode('direct')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1 ${
                          editDnsMode === 'direct'
                            ? 'bg-blue-50/70 border-blue-300 ring-2 ring-blue-500/20'
                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                          <Server className="w-4 h-4 text-blue-500" />
                          <span>Direct Public IP</span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          Custom domain via direct DNS A Record
                        </span>
                      </button>
                    </div>

                    {editDnsMode === 'cloudflare' ? (
                      <div className="space-y-3 p-3.5 bg-slate-50/80 rounded-xl border border-slate-200">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Cloudflare Zone
                            </label>
                            <select
                              value={editCfZone}
                              onChange={(e) => setEditCfZone(e.target.value)}
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-slate-900 focus:outline-hidden focus:border-amber-500 font-mono cursor-pointer"
                            >
                              {cfZones.map((z) => (
                                <option key={z.id} value={z.name}>
                                  🌐 {z.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Subdomain Prefix (Optional)
                            </label>
                            <input
                              type="text"
                              value={editSubdomain}
                              onChange={(e) => setEditSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                              placeholder="e.g. api (empty for apex)"
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-slate-900 focus:outline-hidden focus:border-amber-500 font-mono"
                            />
                          </div>
                        </div>

                        <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 flex items-center justify-between text-xs">
                          <span className="text-slate-600 font-medium">New Domain:</span>
                          <span className="font-mono font-bold text-amber-900">
                            {editSubdomain.trim() ? `${editSubdomain.trim()}.${editCfZone}` : editCfZone}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400">
                          Traffic will automatically route through your Cloudflare Tunnel without opening public server ports.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Custom Domain / Hostname
                        </label>
                        <input
                          type="text"
                          required
                          value={newDomainInput}
                          onChange={(e) => setNewDomainInput(e.target.value)}
                          placeholder="example.com or sub.example.com"
                          className={`w-full text-xs bg-slate-50 border rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden font-mono ${
                            editCollision
                              ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40 text-rose-900'
                              : 'border-slate-200 focus:border-blue-500'
                          }`}
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                          Point your domain's DNS <strong>A Record</strong> to server IP: <code className="font-mono font-bold text-slate-700">{serverIp}</code>.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Domain / Hostname
                    </label>
                    <input
                      type="text"
                      required
                      value={newDomainInput}
                      onChange={(e) => setNewDomainInput(e.target.value)}
                      placeholder="example.com or sub.example.com"
                      className={`w-full text-xs bg-slate-50 border rounded-xl px-3 py-2 text-slate-900 focus:outline-hidden font-mono ${
                        editCollision
                          ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40 text-rose-900'
                          : 'border-slate-200 focus:border-blue-500'
                      }`}
                    />
                    <div className="mt-2 p-2.5 bg-blue-50/60 rounded-xl border border-blue-100 flex items-center justify-between text-xs text-blue-900">
                      <span>Server Public IP: <strong className="font-mono">{serverIp}</strong></span>
                      <span className="text-[11px] text-blue-700">Set DNS A Record to this IP</span>
                    </div>
                  </div>
                )}

                {/* Validation and Collision feedback */}
                {editCollision ? (
                  <div className="p-2.5 bg-rose-50 rounded-xl border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>{editCollision.message}</span>
                  </div>
                ) : isValidatingEdit ? (
                  <div className="p-2 bg-slate-50 rounded-xl border border-slate-200 text-slate-500 text-xs flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />
                    <span>Validating domain with Cloudflare...</span>
                  </div>
                ) : editValidation?.cloudflareStatus?.dnsRecords?.length ? (
                  <div className="p-2 bg-amber-50 rounded-xl border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Cloudflare DNS: Existing record ({editValidation.cloudflareStatus.dnsRecords[0].type}) found. Will be managed by tunnel.</span>
                  </div>
                ) : null}
              </div>

              <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingDomain(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/70 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingDomain || Boolean(editCollision) || (effectiveEditDomain === editingDomain.domain.toLowerCase()) || isValidatingEdit}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isValidatingEdit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Validating...</span>
                    </>
                  ) : isUpdatingDomain ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Updating Domain...</span>
                    </>
                  ) : (
                    <span>Save Changes</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DNS Setup Instructions Modal */}
      {dnsModalDomain && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                  <HelpCircle className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    DNS Setup Instructions
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {dnsModalDomain.domain}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDnsModalDomain(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {isDomainCloudflare(dnsModalDomain.domain) ? (
                <div className="space-y-3">
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <CloudRain className="w-4 h-4 text-amber-600" />
                      <span>Routed via Cloudflare Zero-NAT Tunnel</span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      This domain traffic is routed through your active Cloudflare Tunnel. DNS records in Cloudflare are managed automatically by BarePod.
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 font-mono text-[11px]">
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Routing Type:</span>
                      <span className="font-bold text-slate-800">Tunnel Ingress</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Public Hostname:</span>
                      <span className="font-bold text-slate-800">{dnsModalDomain.domain}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Origin Service:</span>
                      <span className="font-bold text-slate-800">http://127.0.0.1:80</span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">No TLS Verify:</span>
                      <span className="font-bold text-emerald-600">Enabled</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-slate-600 leading-relaxed">
                    Log in to your domain registrar or DNS management provider (e.g. Cloudflare, Namecheap, GoDaddy) and add or update the following DNS record:
                  </p>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 font-mono text-[11px]">
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Record Type:</span>
                      <span className="font-bold text-slate-800">A</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Name / Host:</span>
                      <span className="font-bold text-slate-800">@ (or subdomain)</span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-b border-slate-200/60">
                      <span className="text-slate-500">Points to (Target):</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-blue-600">{serverIp}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (serverIp) void navigator.clipboard.writeText(serverIp);
                          }}
                          className="p-1 hover:bg-slate-200 rounded"
                          title="Copy IP"
                        >
                          <Copy className="w-3 h-3 text-slate-500" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-slate-500">TTL:</span>
                      <span className="font-bold text-slate-800">Auto / 300</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setDnsModalDomain(null)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Website Danger Confirm Modal */}
      {showDeleteModal && (
        <DangerConfirmModal
          isOpen={showDeleteModal}
          onClose={() => setShowDeleteModal(false)}
          onConfirm={async () => {
            if (!onDeleteApp) return;
            setIsDeletingApp(true);
            try {
              await onDeleteApp(app.name, { databases: deleteDatabasesOption });
              setShowDeleteModal(false);
            } finally {
              setIsDeletingApp(false);
            }
          }}
          title={`Delete Website "${app.name}"`}
          itemType="Website"
          itemName={app.name}
          warningDescription={`This action cannot be undone. It will permanently remove all web server configurations, systemd services, site logs, and isolated process groups for ${app.domain || app.name}.`}
          confirmLabel={isDeletingApp ? 'Deleting Website...' : 'Permanently Delete Website'}
        >
          {associatedDbs.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Associated Databases ({associatedDbs.length})</span>
                <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded font-mono">
                  {associatedDbs.map(d => `${d.alias || d.name} (${d.engine})`).join(', ')}
                </span>
              </div>
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="databasesOptionDetail"
                    value="keep"
                    checked={deleteDatabasesOption === 'keep'}
                    onChange={() => setDeleteDatabasesOption('keep')}
                    className="mt-0.5 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="font-bold text-slate-800">Keep Databases (Recommended)</span>
                    <p className="text-[11px] text-slate-500">
                      Preserve all MySQL, PostgreSQL, and SQLite databases associated with this website.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 p-2.5 rounded-xl border border-rose-200 bg-rose-50/30 hover:bg-rose-50/60 cursor-pointer text-xs">
                  <input
                    type="radio"
                    name="databasesOptionDetail"
                    value="delete"
                    checked={deleteDatabasesOption === 'delete'}
                    onChange={() => setDeleteDatabasesOption('delete')}
                    className="mt-0.5 text-rose-600 focus:ring-rose-500"
                  />
                  <div>
                    <span className="font-bold text-rose-800">Delete Associated Databases</span>
                    <p className="text-[11px] text-rose-600">
                      Drop and permanently destroy {associatedDbs.map(d => `${d.alias || d.name} (${d.engine})`).join(', ')}.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}
        </DangerConfirmModal>
      )}

      {/* Framework Edit Modal */}
      {showEditFrameworkModal && (
        <div className="fixed inset-0 z-60 flex items-start sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-5 space-y-4 text-xs text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Boxes className="w-4 h-4 text-purple-600" />
                <span>Framework Profile</span>
              </div>
              <button
                type="button"
                onClick={() => setShowEditFrameworkModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer font-bold"
              >
                ✕
              </button>
            </div>

            {detectedFramework && (
              <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-xl flex items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold text-purple-800 uppercase tracking-wider block">Auto-Detected</span>
                  <span className="text-xs font-bold text-purple-900">{detectedFramework.title}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleUpdateFramework(detectedFramework.title)}
                  disabled={isUpdatingFramework}
                  className="px-2.5 py-1 text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-2xs cursor-pointer transition-colors"
                >
                  Apply Detected
                </button>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Select Framework</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {[
                  'Laravel',
                  'WordPress',
                  'Symfony',
                  'Generic PHP',
                  'Next.js',
                  'Vite (React/Vue)',
                  'Express / NestJS',
                  'FastAPI / Flask',
                  'Django',
                  'Go',
                  'Static HTML',
                  'generic (bring your own code)',
                ].map((fw) => (
                  <button
                    key={fw}
                    type="button"
                    onClick={() => setSelectedCustomFw(fw)}
                    className={`px-2.5 py-1.5 rounded-lg border text-left text-xs transition-colors cursor-pointer ${
                      selectedCustomFw === fw
                        ? 'border-purple-500 bg-purple-50 text-purple-900 font-bold'
                        : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {fw}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700">Custom Label</label>
              <input
                type="text"
                value={selectedCustomFw}
                onChange={(e) => setSelectedCustomFw(e.target.value)}
                placeholder="e.g. Laravel 12 or Custom Framework"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs font-mono focus:outline-hidden focus:border-purple-500 shadow-2xs"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  api.detectWebsiteFramework(app.name).then((res) => {
                    if (res.ok && res.framework) {
                      setDetectedFramework(res.framework);
                      setSelectedCustomFw(res.framework.title);
                      onShowToast?.('Detected', `Found ${res.framework.title}`, 'info');
                    }
                  });
                }}
                className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors flex items-center gap-1.5 text-xs font-medium"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Re-detect</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEditFrameworkModal(false)}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isUpdatingFramework}
                  onClick={() => handleUpdateFramework(selectedCustomFw)}
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-2xs cursor-pointer transition-colors text-xs"
                >
                  {isUpdatingFramework ? 'Saving...' : 'Save Framework'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

