import React, { useEffect, useRef, useState } from 'react';
import { Server, Database, Code2, Hexagon, RefreshCw, Loader2, Download, CheckCircle2, Play, Trash2, AlertTriangle, X, ShieldAlert, Globe } from 'lucide-react';
import { api, apiReachable, type StackStatus, type StackComponent, type StackJobLogLine, type StackPlanResult } from '../api/client';
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

export const StackView: React.FC<StackViewProps> = ({ onShowToast }) => {
  const [activeTab, setActiveTab] = useSubRoute<'web' | 'runtime' | 'database'>('web');
  const [status, setStatus] = useState<StackStatus | null>(null);
  const [live, setLive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLines, setJobLines] = useState<StackJobLogLine[]>([]);
  const [jobStatus, setJobStatus] = useState<string>('');
  // The version picked for each database engine (the switch acts on it).
  const [pickedVersion, setPickedVersion] = useState<Record<string, string>>({});

  // Dry-run plan modal state
  const [planModal, setPlanModal] = useState<{
    action: 'install' | 'uninstall';
    component: string;
    version: string;
    plan: StackPlanResult | null;
    loading: boolean;
  } | null>(null);

  // Which runtimes have their long version list open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const reachable = await apiReachable();
      setLive(reachable);
      if (reachable) {
        const s = await api.stack();
        setStatus(s);
        if (s.activeJobId && !sourceRef.current) {
          watchJob(s.activeJobId);
        }
      }
    } catch (err) {
      onShowToast?.('Could not read the stack', describeError(err), 'error');
    } finally {
      setLoading(false);
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

  const watchJob = (id: string) => {
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
      try {
        const job = JSON.parse((event as MessageEvent).data) as { status: string };
        setJobStatus(job.status);
        onShowToast?.(
          job.status === 'success' ? 'Install finished' : 'Install failed',
          job.status === 'success' ? 'The component is installed.' : 'See the log for the reason.',
          job.status === 'success' ? 'success' : 'error',
        );
      } catch {
        setJobStatus('done');
      }
      source.close();
      sourceRef.current = null;
      void load();
    });
    source.onerror = () => {
      source.close();
      sourceRef.current = null;
    };
  };

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

  const planAndExecute = async (action: 'install' | 'uninstall', component: string, version: string) => {
    if (!live) {
      onShowToast?.('Simulation', 'The daemon is not reachable, so nothing can be modified.', 'info');
      return;
    }
    setPlanModal({ action, component, version, plan: null, loading: true });
    try {
      const plan = await api.stackPlan(component, version);
      setPlanModal({ action, component, version, plan, loading: false });
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

  const uninstall = (component: string, version: string) => {
    void planAndExecute('uninstall', component, version);
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
      window.setTimeout(() => void load(), 2500);
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
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
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
        <button
          onClick={() => void load()}
          disabled={live !== true}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-40"
          title="Reload"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

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
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Web Server Engines (Multi-Engine Concurrency)</span>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  All 4 engines run concurrently in systemd. Edge ingress routes traffic to backend engines transparently with zero port collisions.
                </p>
              </div>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Engine</th>
                  <th className="py-3 px-4">Role & Ports</th>
                  <th className="py-3 px-4">Active</th>
                  <th className="py-3 px-4">Latest Upstream</th>
                  <th className="py-3 px-4">State</th>
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

                  return (
                    <tr key={engine} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900 capitalize">
                        {engine}
                        <span className="block text-[10px] font-normal text-slate-400">
                          {engine === 'nginx' && 'High-concurrency reverse proxy & edge ingress'}
                          {engine === 'caddy' && 'Automatic HTTPS & HTTP/3 edge ingress/backend'}
                          {engine === 'apache' && 'Apache 2.4 with native .htaccess rewrite engine'}
                          {engine === 'openlitespeed' && 'Event-driven server with native LSCache'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {engine === 'nginx' && (
                          activeIngress ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                              <Play className="w-3 h-3 text-emerald-600" /> Edge Ingress (:80, :443)
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                              Internal Backend (:8082)
                            </span>
                          )
                        )}
                        {engine === 'caddy' && (
                          activeIngress ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                              <Play className="w-3 h-3 text-emerald-600" /> Edge Ingress (:80, :443)
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                              Internal Backend (:8081)
                            </span>
                          )
                        )}
                        {engine === 'apache' && (
                          <span className="inline-flex items-center text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                            Internal Backend (:8080)
                          </span>
                        )}
                        {engine === 'openlitespeed' && (
                          <span className="inline-flex items-center text-[11px] font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded">
                            Internal Backend (:8088)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        {state?.installed ? installed || '—' : 'not installed'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        <span className="inline-flex items-center gap-1">
                          {latest || '—'}
                          {state?.installed && isUpToDate && (
                            <span className="text-[10px] text-emerald-600 font-sans font-semibold bg-emerald-50 px-1 rounded">Latest</span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${state?.running ? 'bg-emerald-500' : state?.installed ? 'bg-amber-500' : 'bg-slate-300'}`} />
                          {state?.running ? 'running' : state?.installed ? 'stopped' : 'not installed'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Install / Update button (always latest) */}
                          {!state?.installed ? (
                            <button
                              onClick={() => void install(engine, 'latest')}
                              disabled={busy || live !== true}
                              title={`Install official upstream latest ${engine}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" /> Install Latest
                            </button>
                          ) : !isUpToDate && latest ? (
                            <button
                              onClick={() => void install(engine, 'latest')}
                              disabled={busy || live !== true}
                              title={`Update ${engine} to latest upstream version (${latest})`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" /> Update to {latest}
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Up to Date
                            </span>
                          )}

                          {/* Uninstall button (only when not active ingress) */}
                          {state?.installed && !activeIngress && (
                            <button
                              onClick={() => void uninstall(engine, installed)}
                              disabled={busy || live !== true}
                              title={`Uninstall ${engine} — refused while a website is configured to use it`}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-100">
              <span className="font-semibold text-slate-700">Web Server Management:</span> All 4 engines operate concurrently without port collisions.
              Edge ingress on port 80 and 443 is served by <span className="font-semibold text-slate-700 font-mono">{status?.webServer.active}</span> with atomic zero-downtime vhost switching.
              Web servers run as system services and automatically follow official upstream latest stable releases.
            </p>
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
                        className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200"
                      >
                        <span className="font-mono">{version}</span>
                        <button
                          onClick={() => void uninstall(component.name, version)}
                          disabled={busy || live !== true}
                          title={`Uninstall ${component.label} ${version} — refused while a site or database uses it`}
                          className="p-0.5 rounded hover:bg-emerald-100 disabled:opacity-40"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
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
                  <th className="py-3 px-4">Active</th>
                  <th className="py-3 px-4">Newest</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4">Version</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {componentsOf('database').map((component) => {
                  const detected = status?.databases?.find((d) => d.engine === component.name);
                  const versions = status?.databaseAvailable?.[component.name] ?? component.versions ?? [];
                  const active = detected?.installedVersion ?? '';
                  const installedList = status?.databaseInstalled?.[component.name] ?? (active ? [active] : []);

                  // Build clean dropdown options without duplicate version entries
                  const dropdownVersions = (() => {
                    const list = [...installedList, ...versions];
                    if (active && !list.includes(active)) {
                      // Check if active matches a line already in list (e.g. active "18.6" matches major "18")
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
                    // If exact active version is not present in options, match major line (e.g. active "18.6" matches "18")
                    if (!dropdownVersions.includes(active) && (active.startsWith(v + '.') || active.split('.')[0] === v)) {
                      return true;
                    }
                    return false;
                  };

                  const currentActiveOption = dropdownVersions.find(isVersionActive);
                  const picked = pickedVersion[component.name] ?? (currentActiveOption || dropdownVersions[0] || '');
                  const isCurrent = isVersionActive(picked);

                  return (
                    <tr key={component.name} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {component.label}
                        <span className="block text-[10px] font-normal text-slate-400">{component.description}</span>
                        {installedList.length > 0 && (
                          <div className="text-[10px] text-slate-500 mt-1">
                            Installed on host: <span className="font-mono text-emerald-700 font-semibold">{installedList.join(', ')}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">{active || '—'}</td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        {(() => {
                          const latestRaw = status?.databaseLatest?.[component.name] ?? '—';
                          if (latestRaw !== '—' && active && active.startsWith(latestRaw + '.') && !latestRaw.includes('.')) {
                            return active;
                          }
                          return latestRaw;
                        })()}
                      </td>
                      <td className="py-3 px-4">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${detected?.running ? 'bg-emerald-500' : detected?.available ? 'bg-amber-500' : 'bg-slate-300'}`} />
                          {detected ? `${detected.mode}${detected.running ? ' · running' : ''}` : 'unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={picked}
                          onChange={(e) => setPickedVersion((prev) => ({ ...prev, [component.name]: e.target.value }))}
                          className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded-lg font-mono"
                        >
                          {dropdownVersions.map((version) => {
                            const isAct = isVersionActive(version);
                            const isInst = installedList.includes(version);
                            let tag = '• Repository (Download)';
                            if (isAct) {
                              tag = '• Active (Running)';
                            } else if (isInst) {
                              tag = '• Installed on host';
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
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {isCurrent ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                if (picked && !isCurrent) void planAndExecute('install', component.name, picked);
                              }}
                              disabled={busy || live !== true || !picked}
                              title={`Plan & switch database version to ${picked} — checks data safety before proceeding`}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white ${
                                installedList.includes(picked) ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'
                              } disabled:opacity-50`}
                            >
                              {installedList.includes(picked) ? (
                                <>
                                  <RefreshCw className="w-3 h-3" /> Switch to {picked} (Local)
                                </>
                              ) : (
                                <>
                                  <Download className="w-3 h-3" /> {active ? `Download & Switch to ${picked}` : `Install ${picked}`}
                                </>
                              )}
                            </button>
                          )}
                          {active && (
                            <button
                              onClick={() => void uninstall(component.name, active)}
                              disabled={busy || live !== true}
                              title={`Uninstall ${component.label} ${active} — refused while a database on it exists`}
                              className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-4 py-3 text-[11px] text-slate-500 border-t border-slate-100">
              <span className="font-semibold text-slate-700">Database Version Guide:</span> One version per engine runs on the standard port at a time.
              Versions tagged <span className="font-semibold text-slate-700 font-mono">• Active (Running)</span> are serving queries now.
              Versions tagged <span className="font-semibold text-emerald-700 font-mono">• Installed on host</span> are already present locally on server disk / images.
              Versions tagged <span className="font-semibold text-blue-700 font-mono">• Repository</span> will be downloaded from upstream repositories.
              Always export / dump SQL backups before switching database versions.
            </p>
          </div>
        </div>
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
      {/* Plan confirmation modal */}
      {planModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-slate-700" />
                <h3 className="font-bold text-sm text-slate-900">
                  {planModal.action === 'install' ? 'Plan: Switch Engine' : 'Plan: Remove Component'}
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
                  <span>Computing execution plan…</span>
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

                  {planModal.plan.warnings.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        <span>Warnings</span>
                      </div>
                      <ul className="list-disc list-inside text-amber-800 text-[11px] space-y-0.5">
                        {planModal.plan.warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {planModal.plan.uses.length > 0 && (
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-rose-900">
                        <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                        <span>Resources In Use ({planModal.plan.uses.length})</span>
                      </div>
                      <p className="text-[11px] text-rose-800">
                        The following items depend on this component:
                      </p>
                      <ul className="list-disc list-inside text-rose-900 text-[11px] font-mono">
                        {planModal.plan.uses.map((u, idx) => (
                          <li key={idx}>{u}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <span className="font-semibold text-slate-700 block mb-1.5">Execution Steps:</span>
                    <ol className="list-decimal list-inside space-y-1 text-slate-600 font-mono text-[11px] bg-slate-50 p-3 rounded-xl border border-slate-200">
                      {planModal.plan.steps.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ol>
                  </div>
                </>
              ) : (
                <div className="text-slate-500 py-4 text-center">Failed to load plan.</div>
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
                  if (m) {
                    if (m.action === 'install') void install(m.component, m.version);
                    else void executeUninstall(m.component, m.version);
                  }
                }}
                disabled={busy || live !== true || !planModal?.plan || (planModal.action === 'uninstall' && !planModal.plan.safeToRun)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white ${
                  planModal?.action === 'uninstall'
                    ? 'bg-rose-600 hover:bg-rose-700 disabled:opacity-50'
                    : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                }`}
              >
                {planModal?.action === 'install' ? 'Proceed with Switch' : 'Confirm Removal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
