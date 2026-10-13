import React, { useEffect, useRef, useState } from 'react';
import { Server, Database, Code2, Hexagon, RefreshCw, Loader2, Download, CheckCircle2, Play, Trash2, AlertTriangle, X, ShieldAlert } from 'lucide-react';
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
        <div className="space-y-4">
          {repositoriesCard('web', 'web server')}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
              <tr>
                <th className="py-3 px-4">Engine</th>
                <th className="py-3 px-4">State</th>
                <th className="py-3 px-4">Ingress</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(status?.webServer.supported ?? ['nginx', 'caddy']).map((engine) => {
                const found = status?.webServer.installed.find((s) => s.engine === engine);
                const active = status?.webServer.active === engine;
                return (
                  <tr key={engine} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 font-semibold text-slate-900">{engine}</td>
                    <td className="py-3 px-4">{webBadge(Boolean(found?.installed), Boolean(found?.running), found?.version)}</td>
                    <td className="py-3 px-4">
                      {active ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          <Play className="w-3 h-3" /> owns :80
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">standby</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        {/* Every version the engine's own repository carries. Choosing one
                            installs it, which is the switch. */}
                        {/* Always offered for the engine that is not the ingress, so the way
                            back is never hidden; disabled until it is installed. */}
                        {!active && (
                          <button
                            onClick={() => void switchWebServer(engine)}
                            disabled={busy || live !== true || !found?.installed}
                            title={found?.installed ? `Serve every site with ${engine}` : `Install ${engine} first`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Set as ingress
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
            One engine owns port 80 at a time: switching rewrites every site's vhost, validates it, and only then swaps the
            service. Panel vhosts live in <span className="font-mono">{status?.webServer.vhostsPath ?? '—'}</span>.
          </p>
        </div>

          {/* Version manager: every web server the panel keeps versions for, which is more
              than the two that can be the ingress. */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Version manager</span>
              <span className="text-[11px] text-slate-500">
                Every web server the panel keeps versions for. Only nginx and Caddy can own :80 — the rest run as
                backends, or are here so a version can be installed.
              </span>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Engine</th>
                  <th className="py-3 px-4">Active</th>
                  <th className="py-3 px-4">Newest</th>
                  <th className="py-3 px-4">Versions</th>
                  <th className="py-3 px-4 text-right">Switch</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(status?.webServer.managed ?? []).map((engine) => {
                  const state = status?.webServer.managedInstalled?.find((e) => e.engine === engine);
                  const versions = status?.webServer.available?.[engine] ?? [];
                  const installed = (state?.version ?? '').replace(/^v/, '');
                  // The select shows its first option when nothing is picked, so the state
                  // has to agree with what is on screen — otherwise the button reads an
                  // empty string and appears to do nothing at all.
                  const picked = pickedVersion[engine] ?? (installed || versions[0] || '');
                  return (
                    <tr key={engine} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">{engine}</td>
                      <td className="py-3 px-4 font-mono text-slate-700">{state?.installed ? installed || '—' : 'not installed'}</td>
                      <td className="py-3 px-4 font-mono text-slate-700">{status?.webServer.latest?.[engine] ?? '—'}</td>
                      <td className="py-3 px-4">
                        <select
                          value={picked}
                          onChange={(e) => setPickedVersion((prev) => ({ ...prev, [engine]: e.target.value }))}
                          className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded-lg font-mono"
                        >
                          {Array.from(new Set([installed, ...versions].filter(Boolean))).map((version) => (
                            <option key={version} value={version}>
                              {version}
                              {installed === version ? ' (installed)' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {state?.installed && picked === installed ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                if (picked && picked !== installed) void install(engine, picked);
                              }}
                              disabled={busy || live !== true || versions.length === 0}
                              title={versions.length === 0 ? "no versions listed — add this engine's repository" : `Install and switch ${engine} to ${picked}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" /> {state?.installed ? `Switch to ${picked}` : `Install ${picked}`}
                            </button>
                          )}
                          {state?.installed && installed && (
                            <button
                              onClick={() => void uninstall(engine, installed)}
                              disabled={busy || live !== true}
                              title={`Uninstall ${engine} ${installed} — refused while a project uses it`}
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

                  // Build clean dropdown options without duplicate version entries
                  const dropdownVersions = (() => {
                    const list = [...versions];
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
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">{active || '—'}</td>
                      <td className="py-3 px-4 font-mono text-slate-700">{status?.databaseLatest?.[component.name] ?? '—'}</td>
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
                          {dropdownVersions.map((version) => (
                            <option key={version} value={version}>
                              {version}
                              {isVersionActive(version) ? ' (active)' : ''}
                            </option>
                          ))}
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
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Download className="w-3 h-3" /> {active ? `Switch to ${picked}` : `Install ${picked}`}
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
              Active is the version the engine is running, probed from the engine itself. One version per engine at a
              time: switching means installing the new one and migrating — which needs a dump first while databases
              exist on it.
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
