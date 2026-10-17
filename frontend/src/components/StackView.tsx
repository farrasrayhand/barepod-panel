import React, { useEffect, useRef, useState } from 'react';
import { Server, Database, Code2, Hexagon, RefreshCw, Loader2, Download, CheckCircle2, Play, Trash2, AlertTriangle, X, ShieldAlert, Globe, Zap, Sparkles, Package, Minus } from 'lucide-react';
import { api, apiReachable, type StackStatus, type StackComponent, type StackJobLogLine, type StackPlanResult, type ApiWebsite } from '../api/client';
import { describeError } from '../utils/format';
import { useSubRoute } from '../hooks/useSubRoute';

interface StackViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

const KINDS: Record<string, { label: string; icon: React.FC<{ className?: string }> }> = {
  runtime: { label: 'Runtimes', icon: Code2 },
  database: { label: 'Databases', icon: Database },
};

// InstallButton is one installable version. The newest of a long list is drawn on its own
// and marked, because it is the one an unopinionated install wants.
const InstallButton: React.FC<{
  component: string;
  version: string;
  latest?: boolean;
  hint?: string;
  installed: boolean;
  disabled: boolean;
  onInstall: () => void;
}> = ({ component, version, latest, hint, installed, disabled, onInstall }) => (
  <button
    onClick={onInstall}
    disabled={disabled || installed}
    title={installed ? `${component} ${version} is already installed` : undefined}
    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold disabled:cursor-not-allowed ${
      installed
        ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
        : 'text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
    }`}
  >
    {installed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
    {version ? `${component} ${version}` : component}
    {installed ? ' · installed' : latest ? ' · latest' : hint ? ` · ${hint}` : ''}
  </button>
);

// Module-level cache for instant 0ms navigation render
let cachedStackStatus: StackStatus | null = null;
let cachedWebsites: ApiWebsite[] = [];

interface BundleItem {
  key: string;
  component: string;
  label: string;
  kind: 'repo' | 'web' | 'runtime' | 'database';
  version?: string;
  note?: string;
}

export const StackView: React.FC<StackViewProps> = ({ onShowToast }) => {
  const [bundleOpen, setBundleOpen] = useState(false);
  const [bundleSel, setBundleSel] = useState<Record<string, boolean>>({});
  const [bundleRun, setBundleRun] = useState<{ total: number; index: number; current: string } | null>(null);
  const [activeTab, setActiveTab] = useSubRoute<'web' | 'runtime' | 'database'>('web');
  const [status, setStatus] = useState<StackStatus | null>(() => {
    if (cachedStackStatus) return cachedStackStatus;
    try {
      const stored = sessionStorage.getItem('barepod_stack_status');
      if (stored) {
        const parsed = JSON.parse(stored);
        cachedStackStatus = parsed;
        return parsed;
      }
    } catch {}
    return null;
  });
  const [websites, setWebsites] = useState<ApiWebsite[]>(() => cachedWebsites);
  const [live, setLive] = useState<boolean | null>(() => (cachedStackStatus ? true : null));
  const [loading, setLoading] = useState<boolean>(!status && !cachedStackStatus);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLines, setJobLines] = useState<StackJobLogLine[]>([]);
  const [jobStatus, setJobStatus] = useState<string>('');
  // The version picked for each database engine (the switch acts on it).
  const [pickedVersion, setPickedVersion] = useState<Record<string, string>>({});

  // Dry-run plan modal state (specifically for Database Migration / Engine Switch)
  const [planModal, setPlanModal] = useState<{
    component: string;
    version: string;
    plan: StackPlanResult | null;
    loading: boolean;
  } | null>(null);

  // Dedicated Uninstall confirmation modal (not the database dry-run migration plan modal)
  const [uninstallTarget, setUninstallTarget] = useState<{
    component: string;
    version: string;
    label: string;
    inUse: string[];
  } | null>(null);

  // Which runtimes have their long version list open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedPhpExtVersion, setSelectedPhpExtVersion] = useState<string>('all');
  const [repairing, setRepairing] = useState(false);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const runAutoRepair = async () => {
    setRepairing(true);
    setRepairNotice(null);
    try {
      const res = await api.stackRepair();
      const msg = res.actions?.length
        ? `Auto-repair succeeded: ${res.actions.join(', ')}`
        : 'Auto-repair complete: All database services and web engines are running normally & active.';
      setRepairNotice(msg);
      if (onShowToast) onShowToast('Auto-Repair Complete', msg, 'success');
      await load(true);
      setTimeout(() => setRepairNotice(null), 8000);
    } catch (err: any) {
      const errMsg = err.message || 'Failed to execute auto-repair.';
      setRepairNotice(errMsg);
      if (onShowToast) onShowToast('Auto-Repair Failed', errMsg, 'error');
      setTimeout(() => setRepairNotice(null), 8000);
    } finally {
      setRepairing(false);
    }
  };

  const load = async (forceRefresh = false) => {
    if (!status && !cachedStackStatus) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const reachable = await apiReachable();
      setLive(reachable);
      if (reachable) {
        const [s, sitesRes] = await Promise.all([
          api.stack(forceRefresh),
          api.websites().catch(() => ({ items: [] })),
        ]);
        setStatus(s);
        cachedStackStatus = s;
        try {
          sessionStorage.setItem('barepod_stack_status', JSON.stringify(s));
        } catch {}
        const items = sitesRes.items || [];
        setWebsites(items);
        cachedWebsites = items;
        if (s.activeJobId && !sourceRef.current) {
          watchJob(s.activeJobId);
        }
      }
    } catch (err) {
      onShowToast?.('Could not read the stack', describeError(err), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      sourceRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The host can change without this screen asking: an install started on another tab, a
  // version added to a repository, a service restarted from a shell. So the screen asks
  // again on its own rather than needing a manual refresh.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [jobLines]);

  const watchJob = (id: string, quiet = false): Promise<string> => new Promise((resolve) => {
    sourceRef.current?.close();
    setJobId(id);
    setJobLines([]);
    setJobStatus('running');
    const source = new EventSource(api.stackJobStreamUrl(id), { withCredentials: true });
    sourceRef.current = source;
    source.addEventListener('log', (event) => {
      try {
        setJobLines((prev) => [...prev, JSON.parse((event as MessageEvent).data) as StackJobLogLine]);
      } catch {
        // ignore a malformed frame
      }
    });
    source.addEventListener('done', (event) => {
      let result = 'done';
      try {
        const job = JSON.parse((event as MessageEvent).data) as { status: string };
        result = job.status;
        setJobStatus(job.status);
        if (!quiet) {
          onShowToast?.(
            job.status === 'success' ? 'Install finished' : 'Install failed',
            job.status === 'success' ? 'The component is installed.' : 'See the log for the reason.',
            job.status === 'success' ? 'success' : 'error',
          );
        }
      } catch {
        setJobStatus('done');
      }
      source.close();
      sourceRef.current = null;
      if (!quiet) void load(true);
      resolve(result);
    });
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      resolve('error');
    };
  });

  const install = async (component: string, version?: string) => {
    if (!live) {
      onShowToast?.('Simulation', 'The daemon is not reachable, so nothing can be installed.', 'info');
      return;
    }
    setBusy(true);
    try {
      const job = await api.installStackComponent(component, version);
      onShowToast?.('Installing', `${component} ${version ?? ''} — watching the log.`, 'info');
      watchJob(job.jobId);
    } catch (err) {
      onShowToast?.('Could not start the install', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  // ---- Install Stack (batch) -------------------------------------------------------------
  // Recommended, not newest: the versions most sites and frameworks are tested against.
  const RECOMMENDED: Record<string, string[]> = {
    php: ['8.3', '8.4', '8.2'],
    python: ['3.12', '3.13', '3.11'],
    ruby: ['3.3', '3.4', '3.2'],
    postgresql: ['17', '16', '18'],
    mariadb: ['11.8', '11.4', '10.11'],
    mongodb: ['8.0', '7.0'],
    redis: ['7.4', '8.0', '7.2'],
  };

  const recommendedVersion = (name: string, offerable: string[], supported: string[], labels?: Record<string, string>): string | undefined => {
    if (name === 'rust') return undefined;
    if (name === 'node') {
      const lts = offerable.find((v) => /lts/i.test(labels?.[v] ?? ''));
      if (lts) return lts;
    }
    const preferred = (RECOMMENDED[name] ?? []).find((v) => offerable.includes(v));
    return preferred ?? supported[0] ?? offerable[0];
  };

  const webInstalled = (engine: string) =>
    Boolean((status?.webServer.managedInstalled ?? status?.webServer.installed ?? []).find((e) => e.engine === engine)?.installed);

  const buildBundle = (): BundleItem[] => {
    if (!status) return [];
    const items: BundleItem[] = [];
    if ((status.repositories ?? []).some((r) => !r.present)) {
      items.push({ key: 'repositories', component: 'repositories', label: 'Package repositories', kind: 'repo', note: 'needed for the lists below' });
    }
    for (const engine of ['nginx', 'caddy', 'openlitespeed', 'apache']) {
      if (webInstalled(engine)) continue;
      items.push({
        key: `web:${engine}`,
        component: engine,
        label: engine === 'openlitespeed' ? 'OpenLiteSpeed' : engine.charAt(0).toUpperCase() + engine.slice(1),
        kind: 'web',
        version: status.webServer.latest?.[engine] || 'latest',
        note: 'web server',
      });
    }
    for (const component of componentsOf('runtime')) {
      const rt = status.runtimes?.[component.name];
      if ((rt?.installed?.length ?? 0) > 0) continue;
      const available = rt?.available ?? [];
      const offerable = available.length > 0 ? available : component.versions ?? [];
      const version = recommendedVersion(component.name, offerable, rt?.supported ?? [], rt?.labels);
      items.push({ key: `runtime:${component.name}`, component: component.name, label: component.label, kind: 'runtime', version, note: version ? 'recommended' : 'stable channel' });
    }
    for (const component of componentsOf('database')) {
      const detected = status.databases?.find((d) => d.engine === component.name);
      const installedList = status.databaseInstalled?.[component.name] ?? [];
      if (detected?.installedVersion || installedList.length > 0) continue;
      const offerable = status.databaseAvailable?.[component.name] ?? component.versions ?? [];
      const version = recommendedVersion(component.name, offerable, []);
      items.push({ key: `database:${component.name}`, component: component.name, label: component.label, kind: 'database', version, note: 'recommended' });
    }
    return items;
  };

  const getInstalledSummary = (): string[] => {
    if (!status) return [];
    const list: string[] = [];
    for (const engine of ['nginx', 'caddy', 'openlitespeed', 'apache']) {
      if (webInstalled(engine)) {
        list.push(engine === 'openlitespeed' ? 'OpenLiteSpeed' : engine.charAt(0).toUpperCase() + engine.slice(1));
      }
    }
    for (const component of componentsOf('runtime')) {
      const rt = status.runtimes?.[component.name];
      if ((rt?.installed?.length ?? 0) > 0) {
        list.push(`${component.label} (${rt!.installed.join(', ')})`);
      }
    }
    for (const component of componentsOf('database')) {
      const detected = status.databases?.find((d) => d.engine === component.name);
      const installedList = status.databaseInstalled?.[component.name] ?? [];
      if (detected?.installedVersion || installedList.length > 0) {
        const v = detected?.installedVersion || installedList[0];
        list.push(`${component.label}${v ? ` ${v}` : ''}`);
      }
    }
    return list;
  };

  const openBundle = () => {
    const items = buildBundle();
    setBundleSel(Object.fromEntries(items.map((i) => [i.key, true])));
    setBundleOpen(true);
  };

  // Arriving from the first-run prompt: open the picker once the status is in.
  useEffect(() => {
    if (!status || live !== true) return;
    if (sessionStorage.getItem('barepod_open_bundle') !== '1') return;
    sessionStorage.removeItem('barepod_open_bundle');
    openBundle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, live]);

  const runBundle = async (items: BundleItem[]) => {
    if (!live) {
      onShowToast?.('Simulation', 'The daemon is not reachable, so nothing can be installed.', 'info');
      return;
    }
    if (status?.installRunning) {
      onShowToast?.('Another install is running', `${status.installRunning} must finish first.`, 'info');
      return;
    }
    const failed: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setBundleRun({ total: items.length, index: i, current: item.label + (item.version ? ` ${item.version}` : '') });
      let result = 'error';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const job = await api.installStackComponent(item.component, item.version);
          result = await watchJob(job.jobId, true);
          break;
        } catch {
          // the queue may still be releasing the previous job
          await new Promise((r) => window.setTimeout(r, 2000));
        }
      }
      if (result !== 'success') failed.push(item.label);
    }
    setBundleRun(null);
    setBundleOpen(false);
    await load(true);
    onShowToast?.(
      failed.length === 0 ? 'Stack installed' : 'Stack install finished with errors',
      failed.length === 0 ? `${items.length} component(s) installed.` : `Failed: ${failed.join(', ')}. See the log below.`,
      failed.length === 0 ? 'success' : 'error',
    );
  };

  const planAndSwitchDatabase = async (component: string, version: string) => {
    if (!live) {
      onShowToast?.('Simulation', 'The daemon is not reachable, so nothing can be modified.', 'info');
      return;
    }
    setPlanModal({ component, version, plan: null, loading: true });
    try {
      const plan = await api.stackPlan(component, version, 'switch');
      setPlanModal({ component, version, plan, loading: false });
    } catch (err) {
      setPlanModal(null);
      onShowToast?.('Could not compute plan', describeError(err), 'error');
    }
  };

  const executeUninstall = async (component: string, version: string) => {
    setBusy(true);
    try {
      const job = await api.uninstallStackComponent(component, version);
      onShowToast?.('Removing', `${component} ${version} — watching the log.`, 'info');
      watchJob(job.jobId);
    } catch (err) {
      onShowToast?.('Could not remove it', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const promptUninstall = (component: string, version: string, label?: string) => {
    if (!live) {
      onShowToast?.('Simulation', 'The daemon is not reachable, so nothing can be modified.', 'info');
      return;
    }
    const inUse: string[] = [];
    const rt = component === 'node' ? 'nodejs' : component;
    for (const site of websites) {
      if (site.runtime === rt && (site.version === version || site.version?.startsWith(version))) {
        inUse.push(`Website "${site.slug}" (runtime ${site.runtime} ${site.version})`);
      }
      if (site.webServer === component) {
        inUse.push(`Website "${site.slug}" (web server ${site.webServer})`);
      }
    }
    if (
      (component === 'nginx' || component === 'caddy' || component === 'apache' || component === 'openlitespeed') &&
      status?.webServer.active === component
    ) {
      inUse.push(`Active Edge Ingress (${component} is routing traffic on port 80/443)`);
    }
    if (status?.databaseVersions?.[component] === version) {
      inUse.push(`Active Database Engine (${component} ${version} is running on the primary port)`);
    }
    setUninstallTarget({
      component,
      version,
      label: label || component,
      inUse,
    });
  };

  const handleConfirmUninstall = () => {
    if (!uninstallTarget) return;
    const { component, version } = uninstallTarget;
    setUninstallTarget(null);
    void executeUninstall(component, version);
  };

  const switchWebServer = async (engine: string) => {
    if (!live) return;
    setBusy(true);
    try {
      setStatus(await api.setStackWebServer(engine));
      onShowToast?.('Web server switched', `${engine} now owns :80 for every site.`, 'success');
      // The engines take a moment to settle — the one that just started is not "running" in
      // the same instant — so the table is asked again instead of showing a stale state
      // beside the new ingress.
      window.setTimeout(() => void load(true), 2500);
    } catch (err) {
      onShowToast?.('Could not switch the web server', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const componentsOf = (kind: StackComponent['kind']) => status?.components?.filter((c) => c.kind === kind) ?? [];

  // A source only needs adding once, so the card that adds them is drawn only while one is
  // still missing — and beside the versions it fills, not all in one tab.
  const missingIn = (group: string) =>
    (status?.repositories ?? []).filter((repository) => !repository.present && repository.group === group);

  const repositoriesCard = (group: string, where: string) => {
    const missing = missingIn(group);
    if (missing.length === 0) return null;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Server className="w-4 h-4 text-amber-600" />
          <span className="font-semibold text-amber-900 text-sm">Package repositories</span>
          <span className="text-[11px] text-amber-800">missing: {missing.map((r) => r.label).join(', ')}</span>
        </div>
        <div className="mt-3">
          <button
            onClick={() => void install('repositories')}
            disabled={busy || live !== true}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" /> Prepare repositories
          </button>
          <span className="ml-2 text-[11px] text-amber-800">The {where} version lists fill from these.</span>
        </div>
      </div>
    );
  };

  const webBadge = (installed: boolean, running: boolean, version?: string) => (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-500' : installed ? 'bg-amber-500' : 'bg-slate-300'}`} />
      {/* Caddy prints its version as "v2.11.7" and nginx as "1.31.6", so the "v" is added
          only when it is not already there — "vv2.11.7" was the two of them colliding. */}
      {running
        ? `running${version ? ' · ' + (version.startsWith('v') ? version : 'v' + version) : ''}`
        : installed
          ? 'installed, stopped'
          : 'not installed'}
    </span>
  );

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Stack</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
              <Server className="w-3.5 h-3.5" /> {status?.mode ?? '—'}
            </span>
            {live === true && <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">Live</span>}
            {live === false && <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">Daemon unreachable</span>}
            {(loading || refreshing) && <Loader2 className="w-4 h-4 animate-spin text-blue-500" />}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            The host-level choices: which web server serves the sites, and which runtime and database versions are installed.
            Installs run on this host and are logged below.
          </p>
          {status?.installRunning && (
            <p className="mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {status.installRunning} is installing — one install runs at a time, so another is refused until this finishes.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openBundle}
            disabled={live !== true || !status || Boolean(status?.installRunning)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-2xs"
            title="Install everything that is missing, using recommended versions"
          >
            <Package className="w-3.5 h-3.5" />
            <span>Install Stack</span>
          </button>
          <button
            onClick={() => void runAutoRepair()}
            disabled={live !== true || refreshing || repairing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:opacity-40 transition-colors shadow-2xs"
            title="Diagnose & automatically repair failed database and stack services"
          >
            <Zap className={`w-3.5 h-3.5 text-amber-600 ${repairing ? 'animate-bounce' : ''}`} />
            <span>{repairing ? 'Auto-Repairing…' : '⚡ Auto-Repair Stack'}</span>
          </button>
          <button
            onClick={() => void load(true)}
            disabled={live !== true || refreshing || repairing}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            title="Reload Stack Status"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-blue-600' : ''}`} />
          </button>
        </div>
      </div>

      {repairNotice && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{repairNotice}</span>
          </div>
          <button onClick={() => setRepairNotice(null)} className="text-amber-600 hover:text-amber-800 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        {([
          ['web', 'Web server'],
          ['runtime', 'Runtimes'],
          ['database', 'Databases'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Cold loading skeleton */}
      {!status && loading ? (
        <div className="space-y-6 animate-pulse">
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="h-5 bg-slate-200 rounded w-1/4"></div>
            <div className="h-4 bg-slate-100 rounded w-1/2"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="h-32 bg-slate-100 rounded-xl"></div>
              <div className="h-32 bg-slate-100 rounded-xl"></div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div className="h-5 bg-slate-200 rounded w-1/3"></div>
            <div className="h-48 bg-slate-100 rounded-xl"></div>
          </div>
        </div>
      ) : (
        <>
          {/* Web server */}
          {activeTab === 'web' && (
        <div className="space-y-6">
          {repositoriesCard('web', 'web server')}

          {/* Dedicated Edge Ingress Switcher Card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-600" />
                  Edge Ingress Switcher
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Directs incoming visitor traffic on public ports 80 and 443 with atomic zero-downtime vhost switching.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Current Ingress:</span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  {status?.webServer.active?.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Nginx Ingress Option */}
              <div className={`p-4 rounded-xl border transition-all ${
                status?.webServer.active === 'nginx'
                  ? 'border-blue-500 bg-blue-50/30 ring-1 ring-blue-500 shadow-xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">Nginx</span>
                      {status?.webServer.active === 'nginx' ? (
                        <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">Active Ingress (:80, :443)</span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">Internal Backend (:8082)</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      High-concurrency event-driven reverse proxy & edge ingress.
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {status?.webServer.active === 'nginx' ? 'Port 0.0.0.0:80, :443' : 'Port 127.0.0.1:8082'}
                  </span>
                  {status?.webServer.active !== 'nginx' ? (
                    <button
                      onClick={() => void switchWebServer('nginx')}
                      disabled={busy || live !== true}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Switch Ingress to Nginx
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Serving Public Traffic
                    </span>
                  )}
                </div>
              </div>

              {/* Caddy Ingress Option */}
              <div className={`p-4 rounded-xl border transition-all ${
                status?.webServer.active === 'caddy'
                  ? 'border-blue-500 bg-blue-50/30 ring-1 ring-blue-500 shadow-xs'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">Caddy</span>
                      {status?.webServer.active === 'caddy' ? (
                        <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded">Active Ingress (:80, :443)</span>
                      ) : (
                        <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">Internal Backend (:8081)</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Automatic HTTPS & modern HTTP/3 QUIC edge ingress/backend.
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-mono">
                    {status?.webServer.active === 'caddy' ? 'Port 0.0.0.0:80, :443' : 'Port 127.0.0.1:8081'}
                  </span>
                  {status?.webServer.active !== 'caddy' ? (
                    <button
                      onClick={() => void switchWebServer('caddy')}
                      disabled={busy || live !== true}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Switch Ingress to Caddy
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Serving Public Traffic
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Engine Web Servers Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-600" />
                  Installed Web Server Engines
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Web engines installed on this host. Public traffic on ports 80 and 443 is directed by the Active Ingress engine above.
                </p>
              </div>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Engine</th>
                  <th className="py-3 px-4">Role & Port</th>
                  <th className="py-3 px-4">Websites</th>
                  <th className="py-3 px-4">Installed</th>
                  <th className="py-3 px-4">Upstream</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(status?.webServer.managed ?? ['nginx', 'caddy', 'apache', 'openlitespeed']).map((engine) => {
                  const state = status?.webServer.managedInstalled?.find((e) => e.engine === engine);
                  const activeIngress = status?.webServer.active === engine;
                  const installed = (state?.version ?? '').replace(/^v/, '');
                  const latest = status?.webServer.latest?.[engine] ?? installed;
                  const isUpToDate = Boolean(installed && latest && (installed === latest || installed.startsWith(latest)));
                  const usedSites = websites.filter((site) => site.webServer === engine);
                  const isUsedBySites = usedSites.length > 0;
                  const canUninstall = Boolean(state?.installed && !activeIngress && !isUsedBySites);

                  return (
                    <tr key={engine} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-[11px] text-slate-700 shrink-0">
                            {engine === 'nginx' ? 'NG' : engine === 'caddy' ? 'CA' : engine === 'apache' ? 'AP' : 'OLS'}
                          </div>
                          <div>
                            <span className="font-semibold text-slate-900 capitalize text-sm">{engine}</span>
                            <span className="block text-[11px] text-slate-400">
                              {engine === 'nginx' && 'High-concurrency reverse proxy'}
                              {engine === 'caddy' && 'Automatic HTTPS & HTTP/3 engine'}
                              {engine === 'apache' && 'Apache 2.4 & .htaccess rewrites'}
                              {engine === 'openlitespeed' && 'Event-driven server with LSCache'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {activeIngress ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Edge Ingress (:80, :443)
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 font-mono">
                            Backend {engine === 'nginx' ? '(:8082)' : engine === 'caddy' ? '(:8081)' : engine === 'apache' ? '(:8080)' : '(:8088)'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {isUsedBySites ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              {usedSites.length} {usedSites.length === 1 ? 'site' : 'sites'}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono truncate max-w-[140px]" title={usedSites.map((s) => s.slug).join(', ')}>
                              {usedSites.map((s) => s.slug).join(', ')}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">None (Idle)</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-800 text-xs">
                        {state?.installed ? (installed ? `v${installed}` : '—') : <span className="text-slate-400 font-sans">not installed</span>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-xs text-slate-600">
                          {latest ? `v${latest}` : '—'}
                          {state?.installed && isUpToDate && (
                            <span className="text-[10px] text-emerald-700 font-sans font-semibold bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                              Latest
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className={`w-2 h-2 rounded-full ${state?.running ? 'bg-emerald-500' : state?.installed ? 'bg-amber-500' : 'bg-slate-300'}`} />
                          <span className={state?.running ? 'text-emerald-700' : state?.installed ? 'text-amber-700' : 'text-slate-400'}>
                            {state?.running ? 'Running' : state?.installed ? 'Stopped' : 'Not installed'}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Install / Update actions only */}
                          {!state?.installed ? (
                            <button
                              onClick={() => void install(engine, latest || 'latest')}
                              disabled={busy || live !== true}
                              title={`Install official upstream latest ${engine}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-xs"
                            >
                              <Download className="w-3 h-3" /> Install
                            </button>
                          ) : !isUpToDate && latest ? (
                            <button
                              onClick={() => void install(engine, latest || 'latest')}
                              disabled={busy || live !== true}
                              title={`Update ${engine} to latest upstream version (${latest})`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 shadow-xs"
                            >
                              <Download className="w-3 h-3" /> Update
                            </button>
                          ) : canUninstall ? (
                            <button
                              onClick={() => void promptUninstall(engine, installed, engine)}
                              disabled={busy || live !== true}
                              title={`Uninstall unused ${engine} — safe to remove because no website uses it`}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300 px-2">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 text-[11px] text-slate-500 border-t border-slate-100 flex items-center justify-between">
              <span>
                Public ingress traffic on port 80/443 is managed via the <strong className="text-slate-700 font-medium">Edge Ingress Switcher</strong> above.
              </span>
              <span className="font-mono text-slate-400 text-[10px]">Active Ingress: {status?.webServer.active?.toUpperCase()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Runtimes */}
      {activeTab === 'runtime' && (
        <div className="space-y-4">
          {repositoriesCard('runtime', 'runtime')}
          {componentsOf('runtime').map((component) => {
            const Icon = KINDS[component.kind]?.icon ?? Hexagon;
            const status_ = status?.runtimes?.[component.name];
            const installed = status_?.installed ?? [];
            const available = status_?.available ?? [];
            // For a tarball/toolchain runtime the repository cannot list versions, so the
            // component's own curated list is what can be installed.
            const offerable = available.length > 0 ? available : component.versions ?? [];
            const latest = status_?.latest ?? '';
            // Kept current is the daemon's answer, not a string comparison here: rustc
            // reports what "stable" points at, so a channel counts as the version it is.
            const hasLatest = status_?.upToDate ?? false;
            // The screen draws the short list first and keeps the rest — the whole repository
            // history — behind a click. PHP is the exception: every version is a real choice
            // per site, so its list is shown whole.
            const primary = (status_?.supported?.length ? status_.supported : offerable).filter((v) => offerable.includes(v));
            const rest = offerable.filter((v) => !primary.includes(v));
            const others = rest.length > 0;
            return (
              <div key={component.name} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Icon className="w-4 h-4 text-slate-400" />
                  <span className="font-semibold text-slate-900 text-sm">{component.label}</span>
                  <span className="text-[11px] text-slate-400">{component.description}</span>
                  {status_ && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${status_.perSite ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                      {status_.perSite ? 'version per site' : 'build-time toolchain'}
                    </span>
                  )}
                  {status_?.source && <span className="text-[10px] text-slate-400 font-mono">{status_.source}</span>}
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <span className="text-[11px] text-slate-500">
                    {/* Not every list comes from an apt repository: Node and Go come from their
                        vendor index, Ruby from ruby-build, Rust from rustup's channels and
                        its release feed. */}
                    {offerable.length > 0 ? `Available (${offerable.length}, newest first):` : 'Install:'}
                  </span>
                  {/* The newest is offered on its own only when the short list does not
                      already carry it — otherwise the list is the answer, and drawing both
                      showed the same version twice. */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {latest && !hasLatest && !primary.includes(latest) && (
                      <InstallButton
                        component={component.label}
                        version={latest}
                        hint={installed.length > 0 ? 'upgrade to' : 'latest'}
                        installed={false}
                        disabled={busy || live !== true}
                        // Rust is channel-based: asking for the newest release means moving
                        // `stable`, not pinning a second toolchain that holds the same
                        // version under a number as well.
                        onInstall={() => void install(component.name, component.name === 'rust' ? undefined : latest)}
                      />
                    )}
                    {primary.map((version) => (
                      <InstallButton
                        key={version || 'any'}
                        component={component.label}
                        version={version}
                        latest={version === latest}
                        hint={status_?.labels?.[version]}
                        installed={installed.includes(version)}
                        disabled={busy || live !== true}
                        onInstall={() => void install(component.name, version || undefined)}
                      />
                    ))}
                    {others && (
                      <button
                        onClick={() => setExpanded((prev) => ({ ...prev, [component.name]: !prev[component.name] }))}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline"
                      >
                        {expanded[component.name] ? 'Hide the older versions' : `Show ${rest.length} older versions`}
                      </button>
                    )}
                    {offerable.length === 0 && <span className="text-[11px] text-slate-400">nothing offered by this host's repositories yet</span>}
                  </div>
                  {others && expanded[component.name] && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {rest.map((version) => (
                        <InstallButton
                          key={version || 'any'}
                          component={component.label}
                          version={version}
                          installed={installed.includes(version)}
                          disabled={busy || live !== true}
                          onInstall={() => void install(component.name, version || undefined)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {installed.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] text-slate-500">Installed:</span>
                    {installed.map((version) => (
                      <span
                        key={version}
                        className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200"
                      >
                        <span className="font-mono">{version}</span>
                        {component.name === 'php' && (
                          <button
                            type="button"
                            onClick={() => void install('php-extensions', version)}
                            disabled={busy || live !== true}
                            title={`Sync all missing extensions for PHP ${version}`}
                            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-purple-700 bg-purple-100 hover:bg-purple-200 disabled:opacity-40 cursor-pointer font-medium"
                          >
                            <Sparkles className="w-2.5 h-2.5" />
                            <span>Exts</span>
                          </button>
                        )}
                        <button
                          onClick={() => void promptUninstall(component.name, version, component.label)}
                          disabled={busy || live !== true}
                          title={`Uninstall ${component.label} ${version} — refused while a site or database uses it`}
                          className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {component.name === 'php' && installed.length > 0 && (
                  <div className="mt-3 p-3.5 bg-purple-50/70 border border-purple-200/80 rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                          <span>Sync Missing PHP Extensions</span>
                          <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 font-mono text-[10px] font-semibold">
                            {installed.length} version{installed.length > 1 ? 's' : ''} detected
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Scans Sury repository and completes missing extensions (curl, gd, imagick, redis, swoole, etc.) for existing installed PHP without installing new PHP runtimes.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <select
                        value={selectedPhpExtVersion}
                        onChange={(e) => setSelectedPhpExtVersion(e.target.value)}
                        disabled={busy || live !== true}
                        className="bg-white border border-purple-200 text-slate-800 text-xs font-semibold rounded-lg px-2.5 py-1.5 shadow-2xs focus:ring-2 focus:ring-purple-400 focus:outline-none"
                      >
                        <option value="all">All Installed ({installed.length} versions)</option>
                        {installed.map((v) => (
                          <option key={v} value={v}>
                            Only PHP {v}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void install('php-extensions', selectedPhpExtVersion)}
                        disabled={busy || live !== true}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors shadow-2xs cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Install Extensions</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Databases */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          {repositoriesCard('database', 'database')}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Engine</th>
                  <th className="py-3 px-4">Active Status</th>
                  <th className="py-3 px-4">Upstream Latest</th>
                  <th className="py-3 px-4">Local Versions</th>
                  <th className="py-3 px-4 text-right">Switch / Install</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {componentsOf('database').map((component) => {
                  const detected = status?.databases?.find((d) => d.engine === component.name);
                  const versions = status?.databaseAvailable?.[component.name] ?? component.versions ?? [];
                  const active = detected?.installedVersion ?? '';
                  const installedList = status?.databaseInstalled?.[component.name] ?? (active ? [active] : []);

                  // Metadata & branding
                  const dbMetas: Record<string, { code: string; color: string; defaultPort: number }> = {
                    postgresql: { code: 'PG', color: 'bg-sky-50 text-sky-700 border-sky-200', defaultPort: 5432 },
                    mariadb: { code: 'MD', color: 'bg-amber-50 text-amber-700 border-amber-200', defaultPort: 3306 },
                    mysql: { code: 'MD', color: 'bg-amber-50 text-amber-700 border-amber-200', defaultPort: 3306 },
                    mongodb: { code: 'MG', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', defaultPort: 27017 },
                    redis: { code: 'RD', color: 'bg-rose-50 text-rose-700 border-rose-200', defaultPort: 6379 },
                  };
                  const meta = dbMetas[component.name] ?? { code: component.label.slice(0, 2).toUpperCase(), color: 'bg-slate-50 text-slate-700 border-slate-200', defaultPort: 0 };
                  const port = detected?.port || meta.defaultPort;

                  // Build clean dropdown options without duplicate version entries
                  const dropdownVersions = (() => {
                    const list = [...installedList, ...versions];
                    if (active && !list.includes(active)) {
                      const hasLine = list.some((v) => v === active || (active.startsWith(v + '.') && !v.includes('.')));
                      if (!hasLine) {
                        list.unshift(active);
                      }
                    }
                    return Array.from(new Set(list.filter(Boolean)));
                  })();

                  const isVersionActive = (v: string) => {
                    if (!active) return false;
                    if (v === active) return true;
                    if (!dropdownVersions.includes(active) && (active.startsWith(v + '.') || active.split('.')[0] === v)) {
                      return true;
                    }
                    return false;
                  };

                  const currentActiveOption = dropdownVersions.find(isVersionActive);
                  const picked = pickedVersion[component.name] ?? (currentActiveOption || dropdownVersions[0] || '');
                  const isCurrent = isVersionActive(picked);

                  // Latest upstream logic
                  const latestRaw = status?.databaseLatest?.[component.name] ?? '—';
                  const latest = (() => {
                    if (latestRaw !== '—' && active && active.startsWith(latestRaw + '.') && !latestRaw.includes('.')) {
                      return active;
                    }
                    return latestRaw;
                  })();
                  const isUpToDate = Boolean(active && latest !== '—' && (active === latest || active.startsWith(latest + '.') || latest.startsWith(active + '.')));

                  return (
                    <tr key={component.name} className="hover:bg-slate-50/70">
                      {/* Engine */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs border ${meta.color} shrink-0`}>
                            {meta.code}
                          </span>
                          <div>
                            <span className="font-semibold text-slate-900 text-sm">{component.label}</span>
                            <span className="block text-[11px] text-slate-400">
                              {component.description} {port ? `• Port ${port}` : ''}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Active Status */}
                      <td className="py-3 px-4">
                        {detected?.running ? (
                          <div>
                            <span className="font-mono font-semibold text-slate-900 text-xs">
                              {active ? `v${active}` : 'active'}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Running ({detected.mode})
                              </span>
                            </div>
                          </div>
                        ) : (active || installedList.length > 0) ? (
                          <div>
                            <span className="font-mono text-slate-600 text-xs">{active ? `v${active}` : '—'}</span>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                Stopped ({detected?.mode || 'host'})
                              </span>
                              <button
                                type="button"
                                onClick={() => void runAutoRepair()}
                                disabled={repairing}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 transition-colors shadow-2xs cursor-pointer"
                                title="Run automatic repair and restart this service"
                              >
                                <Zap className="w-2.5 h-2.5 text-amber-600" />
                                <span>Auto-Repair</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                            Not installed
                          </span>
                        )}
                      </td>

                      {/* Upstream Latest */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono text-xs text-slate-600">
                          {latest !== '—' ? `v${latest}` : '—'}
                          {detected?.running && isUpToDate && (
                            <span className="text-[10px] text-emerald-700 font-sans font-semibold bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded">
                              Latest
                            </span>
                          )}
                          {detected?.running && !isUpToDate && latest !== '—' && (
                            <span className="text-[10px] text-blue-700 font-sans font-semibold bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded">
                              Newer
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Local Versions on Host */}
                      <td className="py-3 px-4">
                        {installedList.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {installedList.map((ver) => {
                              const isAct = isVersionActive(ver);
                              return isAct ? (
                                <span
                                  key={ver}
                                  className="inline-flex items-center gap-1 font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-semibold text-[11px]"
                                  title="Active version serving queries (cannot be uninstalled while active)"
                                >
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  {ver}
                                </span>
                              ) : (
                                <span
                                  key={ver}
                                  className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 text-[11px]"
                                >
                                  <span>{ver}</span>
                                  <button
                                    onClick={() => void promptUninstall(component.name, ver, component.label)}
                                    disabled={busy || live !== true}
                                    title={`Uninstall unused version ${ver} from host`}
                                    className="p-0.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-40 cursor-pointer"
                                  >
                                    <Trash2 className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs italic">None</span>
                        )}
                      </td>

                      {/* Switch / Install Action */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select
                            value={picked}
                            onChange={(e) => setPickedVersion((prev) => ({ ...prev, [component.name]: e.target.value }))}
                            className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[190px]"
                          >
                            {dropdownVersions.map((version) => {
                              const isAct = isVersionActive(version);
                              const isInst = installedList.includes(version);
                              let tag = '• Repository';
                              if (isAct && detected?.running) {
                                tag = '• Active (Running)';
                              } else if (isAct && !detected?.running) {
                                tag = '• Selected (Stopped)';
                              } else if (isInst) {
                                tag = '• Local (Installed)';
                              }
                              const displayLabel = isAct && active && active !== version && (active.startsWith(version + '.') || active.split('.')[0] === version)
                                ? `${version} (v${active})`
                                : version;
                              return (
                                <option key={version} value={version}>
                                  {displayLabel} {tag}
                                </option>
                              );
                            })}
                          </select>

                          {isCurrent && detected?.running ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Active
                            </span>
                          ) : isCurrent && !detected?.running ? (
                            <button
                              type="button"
                              onClick={() => void runAutoRepair()}
                              disabled={repairing || busy || live !== true}
                              title={`Start and auto-repair ${component.label}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 whitespace-nowrap shadow-sm transition disabled:opacity-50 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" /> {repairing ? 'Starting...' : 'Start Service'}
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (picked && !isCurrent) void planAndSwitchDatabase(component.name, picked);
                              }}
                              disabled={busy || live !== true || !picked}
                              title={`Plan & switch database version to ${picked} — checks data safety before proceeding`}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white whitespace-nowrap shadow-sm transition ${
                                installedList.includes(picked) ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                              } disabled:opacity-50`}
                            >
                              {installedList.includes(picked) ? (
                                <>
                                  <RefreshCw className="w-3.5 h-3.5" /> Switch to {picked}
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5" /> {active ? `Switch to ${picked}` : `Install ${picked}`}
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 text-[11px] text-slate-500 border-t border-slate-100 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-700">Database Engine Architecture:</span> Single active version runs on the standard port at a time.
                Local versions on disk switch instantly with safe data validation.
              </div>
              <span className="font-mono text-slate-400 text-[10px]">Safe Data Migration Enforced</span>
            </div>
          </div>
        </div>
      )}
    </>
  )}

  {/* Install log */}
      {jobId && (
        <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
            <span className="text-[11px] font-semibold text-slate-300">
              Install log <span className="font-mono text-slate-500">{jobId}</span>
            </span>
            <span className={`text-[11px] font-semibold ${jobStatus === 'failed' ? 'text-rose-400' : jobStatus === 'success' ? 'text-emerald-400' : 'text-amber-300'}`}>
              {jobStatus}
            </span>
          </div>
          <div ref={logRef} className="max-h-72 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
            {jobLines.length === 0 && <div className="text-slate-500">waiting for output…</div>}
            {jobLines.map((line) => (
              <div key={line.id} className={line.stream === 'stderr' ? 'text-rose-400' : line.stream === 'step' ? 'text-sky-300' : 'text-slate-300'}>
                {line.line}
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Database Migration & Switch Plan Modal */}
      {planModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-slate-700" />
                <h3 className="font-bold text-sm text-slate-900">
                  Database Migration Plan: {planModal.component} {planModal.version}
                </h3>
              </div>
              <button
                onClick={() => setPlanModal(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {planModal.loading ? (
                <div className="py-8 flex flex-col items-center justify-center gap-2 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span>Computing database migration plan…</span>
                </div>
              ) : planModal.plan ? (
                <>
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div>
                      <span className="font-bold text-slate-900 text-sm capitalize">
                        {planModal.component} {planModal.version}
                      </span>
                      {planModal.plan.installed && (
                        <span className="block text-[11px] text-slate-500 font-mono">
                          current: {planModal.plan.installed}
                        </span>
                      )}
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        planModal.plan.safeToRun
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {planModal.plan.safeToRun ? 'Safe to proceed' : 'Caution advised'}
                    </span>
                  </div>

                  {(planModal.plan.warnings ?? []).length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Warnings</span>
                      </div>
                      <ul className="list-disc list-inside text-amber-800 text-[11px] space-y-0.5">
                        {(planModal.plan.warnings ?? []).map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {(planModal.plan.uses ?? []).length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-rose-900">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                        <span>Databases On This Engine ({(planModal.plan.uses ?? []).length})</span>
                      </div>
                      <p className="text-[11px] text-rose-800">
                        Existing databases that will be preserved and migrated:
                      </p>
                      <ul className="list-disc list-inside text-rose-900 text-[11px] font-mono">
                        {(planModal.plan.uses ?? []).map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="font-semibold text-slate-700 block mb-1.5">Migration Steps:</span>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600 font-mono text-[11px] bg-slate-50 p-3 rounded-xl border border-slate-200">
                      {(planModal.plan.steps ?? []).map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </>
              ) : (
                <div className="text-slate-500 py-4 text-center">Failed to load migration plan.</div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setPlanModal(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const m = planModal;
                  setPlanModal(null);
                  if (m) void install(m.component, m.version);
                }}
                disabled={busy || live !== true || !planModal?.plan || !planModal.plan.safeToRun}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-xs"
              >
                Proceed with Switch
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Install Stack (batch) modal */}
      {bundleOpen && (() => {
        const items = buildBundle();
        const chosen = items.filter((i) => bundleSel[i.key]);
        const groups: { kind: BundleItem['kind']; title: string }[] = [
          { kind: 'repo', title: 'Repositories' },
          { kind: 'web', title: 'Web servers' },
          { kind: 'runtime', title: 'Runtimes' },
          { kind: 'database', title: 'Databases' },
        ];
        return (
          <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-slate-700" />
                  <h3 className="font-bold text-sm text-slate-900">Install Stack</h3>
                </div>
                <div className="flex items-center gap-1">
                  {bundleRun && (
                    <button
                      onClick={() => setBundleOpen(false)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center gap-1 text-xs font-medium"
                      title="Minimize to background"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setBundleOpen(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    title={bundleRun ? "Run in background" : "Close"}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4 text-xs max-h-[60vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="py-6 text-center text-slate-500">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
                    Everything is already installed.
                  </div>
                ) : (
                  <>
                    <p className="text-slate-500">
                      Only what is missing is listed. Runtimes and databases use the recommended version, not the newest. Installs run one after another.
                    </p>
                    {groups.map((g) => {
                      const rows = items.filter((i) => i.kind === g.kind);
                      if (rows.length === 0) return null;
                      return (
                        <div key={g.kind}>
                          <div className="font-semibold text-slate-700 mb-1.5">{g.title}</div>
                          <div className="space-y-1">
                            {rows.map((item) => (
                              <label key={item.key} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(bundleSel[item.key])}
                                  disabled={Boolean(bundleRun)}
                                  onChange={(e) => setBundleSel((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                                />
                                <span className="font-medium text-slate-900">{item.label}</span>
                                <span className="font-mono text-slate-500">{item.version ?? ''}</span>
                                {item.note && <span className="ml-auto text-[10px] text-slate-400">{item.note}</span>}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {(() => {
                  const already = getInstalledSummary();
                  if (already.length === 0) return null;
                  return (
                    <div className="pt-3 border-t border-slate-100">
                      <div className="text-[11px] font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                        Already installed on this server:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {already.map((name) => (
                          <span key={name} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200/60">
                            {name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {bundleRun && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center gap-2 text-blue-900 font-semibold">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Installing {bundleRun.current} ({bundleRun.index + 1}/{bundleRun.total})
                    </div>
                    <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-600 transition-all" style={{ width: `${(bundleRun.index / bundleRun.total) * 100}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-blue-800">
                      <span>Installs continue in the background.</span>
                      <button
                        type="button"
                        onClick={() => setBundleOpen(false)}
                        className="underline font-semibold hover:text-blue-950"
                      >
                        Minimize
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
                {bundleRun ? (
                  <>
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      <span>Installing in background…</span>
                    </span>
                    <button
                      onClick={() => setBundleOpen(false)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 shadow-xs cursor-pointer"
                    >
                      Run in Background
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setBundleOpen(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void runBundle(chosen)}
                      disabled={chosen.length === 0 || live !== true}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-xs cursor-pointer"
                    >
                      Install {chosen.length} selected
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Floating background installer progress dock */}
      {bundleRun && !bundleOpen && (
        <div
          onClick={() => setBundleOpen(true)}
          className="fixed bottom-6 right-6 z-50 bg-white border border-blue-200 rounded-2xl shadow-2xl p-4 w-80 cursor-pointer hover:border-blue-400 hover:shadow-blue-500/15 transition-all animate-in slide-in-from-bottom-5"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span className="font-bold text-xs text-slate-900">Installing Stack</span>
            </div>
            <span className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
              {bundleRun.index + 1} / {bundleRun.total}
            </span>
          </div>
          <div className="text-xs font-medium text-slate-700 truncate mb-2">
            {bundleRun.current}
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{ width: `${((bundleRun.index + 1) / bundleRun.total) * 100}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2.5 text-[10px] text-slate-400">
            <span className="text-blue-600 font-medium">Click to maximize</span>
            <span>Running in background</span>
          </div>
        </div>
      )}

      {/* Dedicated Uninstall Confirmation Modal */}
      {uninstallTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-rose-600" />
                <h3 className="font-bold text-sm text-slate-900">
                  Uninstall {uninstallTarget.label} {uninstallTarget.version}
                </h3>
              </div>
              <button
                onClick={() => setUninstallTarget(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {uninstallTarget.inUse.length > 0 ? (
                <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 font-semibold text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Cannot uninstall while in use ({uninstallTarget.inUse.length})</span>
                  </div>
                  <p className="text-[11px] text-rose-800">
                    The following resources are currently configured to use {uninstallTarget.label} {uninstallTarget.version}:
                  </p>
                  <ul className="list-disc list-inside text-rose-900 text-[11px] font-mono space-y-0.5">
                    {uninstallTarget.inUse.map((u, idx) => (
                      <li key={idx}>{u}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-rose-700 pt-1 border-t border-rose-200/60">
                    Please switch or reconfigure these websites or services to another version before removing this component.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-slate-700 text-sm">
                    Are you sure you want to uninstall <strong className="text-slate-900">{uninstallTarget.label} {uninstallTarget.version}</strong> from this server?
                  </p>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="text-[11px] text-emerald-800">
                      <span className="font-semibold block text-emerald-900">Safe to remove</span>
                      No active websites, databases, or services are currently using this version.
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    This will remove the package binaries, modules, and system configurations for this version.
                  </p>
                </div>
              )}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setUninstallTarget(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition"
              >
                {uninstallTarget.inUse.length > 0 ? 'Close' : 'Cancel'}
              </button>
              {uninstallTarget.inUse.length === 0 && (
                <button
                  onClick={handleConfirmUninstall}
                  disabled={busy || live !== true}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 transition shadow-xs"
                >
                  Confirm Uninstall
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
