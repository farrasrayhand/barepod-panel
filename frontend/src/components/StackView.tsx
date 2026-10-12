import React, { useEffect, useRef, useState } from 'react';
import { Server, Database, Code2, Hexagon, RefreshCw, Loader2, Download, CheckCircle2, Play } from 'lucide-react';
import { api, apiReachable, type StackStatus, type StackComponent, type StackJobLogLine } from '../api/client';
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
  installed: boolean;
  disabled: boolean;
  onInstall: () => void;
}> = ({ component, version, latest, installed, disabled, onInstall }) => (
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
    {installed ? ' · installed' : latest ? ' · latest' : ''}
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
  // Which runtimes have their long version list open.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const sourceRef = useRef<EventSource | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const reachable = await apiReachable();
      setLive(reachable);
      if (reachable) setStatus(await api.stack());
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

  const switchWebServer = async (engine: string) => {
    if (!live) return;
    setBusy(true);
    try {
      setStatus(await api.setStackWebServer(engine));
      onShowToast?.('Web server switched', `${engine} now owns :80 for every site.`, 'success');
    } catch (err) {
      onShowToast?.('Could not switch the web server', describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const componentsOf = (kind: StackComponent['kind']) => status?.components?.filter((c) => c.kind === kind) ?? [];

  const webBadge = (installed: boolean, running: boolean, version?: string) => (
    <span className="flex items-center gap-1.5 text-[11px]">
      <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-emerald-500' : installed ? 'bg-amber-500' : 'bg-slate-300'}`} />
      {running ? `running${version ? ' · v' + version : ''}` : installed ? 'installed, stopped' : 'not installed'}
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
                      <div className="flex items-center justify-end gap-2">
                        {!found?.installed && (
                          <button
                            onClick={() => void install(engine)}
                            disabled={busy || live !== true}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                          >
                            <Download className="w-3.5 h-3.5" /> Install
                          </button>
                        )}
                        {found?.installed && !active && (
                          <button
                            onClick={() => void switchWebServer(engine)}
                            disabled={busy || live !== true}
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
      )}

      {/* Runtimes */}
      {activeTab === 'runtime' && (
        <div className="space-y-4">
          {/* The version lists come from the repositories, so the sources are added first. */}
          {componentsOf('repo').map((component) => (
            <div key={component.name} className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Server className="w-4 h-4 text-amber-600" />
                <span className="font-semibold text-amber-900 text-sm">{component.label}</span>
                <span className="text-[11px] text-amber-800">{component.description}</span>
              </div>
              <div className="mt-3">
                <button
                  onClick={() => void install(component.name)}
                  disabled={busy || live !== true}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" /> Prepare repositories
                </button>
                <span className="ml-2 text-[11px] text-amber-800">
                  Adds Sury (PHP), deadsnakes (Python), rbenv (Ruby) and rustup (Rust); the version lists below fill from them.
                </span>
              </div>
            </div>
          ))}
          {componentsOf('runtime').map((component) => {
            const Icon = KINDS[component.kind]?.icon ?? Hexagon;
            const status_ = status?.runtimes?.[component.name];
            const installed = status_?.installed ?? [];
            const available = status_?.available ?? [];
            // For a tarball/toolchain runtime the repository cannot list versions, so the
            // component's own curated list is what can be installed.
            const offerable = available.length > 0 ? available : component.versions ?? [];
            const chosen = component.name === 'php' ? status?.php.default : status?.node.default;
            // A short list is shown whole; a long one offers its newest and keeps the rest
            // behind a click.
            const short = offerable.length <= 6;
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
                  {/* The newest is the one to install unless a project pins an older one, so it
                      is offered on its own and the rest stay one click away. */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {offerable.slice(0, short ? offerable.length : 1).map((version) => (
                      <InstallButton
                        key={version || 'any'}
                        component={component.label}
                        version={version}
                        latest
                        installed={installed.includes(version)}
                        disabled={busy || live !== true}
                        onInstall={() => void install(component.name, version || undefined)}
                      />
                    ))}
                    {!short && expanded[component.name] && offerable.slice(1).map((version) => (
                      <InstallButton
                        key={version || 'any'}
                        component={component.label}
                        version={version}
                        installed={installed.includes(version)}
                        disabled={busy || live !== true}
                        onInstall={() => void install(component.name, version || undefined)}
                      />
                    ))}
                    {!short && (
                      <button
                        onClick={() => setExpanded((prev) => ({ ...prev, [component.name]: !prev[component.name] }))}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline"
                      >
                        {expanded[component.name] ? 'Hide the other versions' : `Show ${offerable.length - 1} more versions`}
                      </button>
                    )}
                    {offerable.length === 0 && <span className="text-[11px] text-slate-400">nothing offered by this host's repositories yet</span>}
                  </div>
                </div>
                {(installed.length > 0 || chosen) && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    installed: <span className="font-mono">{installed.join(', ') || '—'}</span>
                    {chosen ? <> · chosen: <span className="font-mono">{chosen}</span></> : null}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Databases */}
      {activeTab === 'database' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                <tr>
                  <th className="py-3 px-4">Engine</th>
                  <th className="py-3 px-4">Installed</th>
                  <th className="py-3 px-4">Chosen</th>
                  <th className="py-3 px-4">State</th>
                  <th className="py-3 px-4 text-right">Install</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {componentsOf('database').map((component) => {
                  const detected = status?.databases?.find((d) => d.engine === component.name);
                  const chosen = status?.databaseVersions?.[component.name];
                  return (
                    <tr key={component.name} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {component.label}
                        <span className="block text-[10px] font-normal text-slate-400">{component.description}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        {detected?.installedVersion || (detected?.available ? '—' : 'not installed')}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">{chosen ?? '—'}</td>
                      <td className="py-3 px-4">
                        <span className="flex items-center gap-1.5 text-[11px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${detected?.running ? 'bg-emerald-500' : detected?.available ? 'bg-amber-500' : 'bg-slate-300'}`} />
                          {detected ? `${detected.mode}${detected.running ? ' · running' : ''}` : 'unknown'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {(component.versions ?? ['']).map((version) => {
                            const already =
                              version !== '' &&
                              (Boolean(detected?.installedVersion?.startsWith(version)) || chosen === version);
                            return (
                              <button
                                key={version || 'any'}
                                onClick={() => void install(component.name, version || undefined)}
                                disabled={busy || live !== true || already}
                                title={already ? `${component.label} ${version} is already installed` : undefined}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold disabled:cursor-not-allowed ${
                                  already
                                    ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                    : 'text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                                }`}
                              >
                                {already ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                                {version ? `${component.label} ${version}` : component.label}
                                {already ? ' · installed' : ''}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            One version per engine: installing records the version the panel will use (a port is one slot).
            The panel installs it on this host; the "Installed" column is probed from the engine's own binary.
          </p>
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
    </div>
  );
};
