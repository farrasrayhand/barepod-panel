import React, { useEffect, useState, useMemo } from 'react';
import { 
  Server, 
  Cpu, 
  HardDrive, 
  Activity, 
  ShieldCheck, 
  Layers, 
  Database, 
  Terminal, 
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Clock,
  Box,
  AlertTriangle,
  Plus,
  ArrowRight,
  Monitor,
  LogIn,
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import type { NavItem, WebApp } from '../types';
import { api, apiReachable, type HostMetrics } from '../api/client';
import { formatBytes, formatRate, formatUptime } from '../api/adapters';
import { clockTime, describeAudit, describeDevice, timeAgo } from '../utils/format';

interface OverviewViewProps {
  apps: WebApp[];
  onNavigate: (tab: NavItem) => void;
  onSelectApp?: (slug: string) => void;
  onOpenAddModal: () => void;
}

interface ActivityLine {
  time: string;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

interface SessionLine {
  device: string;
  ip: string;
  lastActive: string;
  current: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ apps, onNavigate, onSelectApp, onOpenAddModal }) => {
  const runningApps = apps.filter((a) => a.status === 'running').length;
  const runningPct = apps.length ? Math.round((runningApps / apps.length) * 100) : 0;

  const [events, setEvents] = useState<ActivityLine[]>([]);
  const [sessions, setSessions] = useState<SessionLine[]>([]);
  const [live, setLive] = useState<boolean | null>(null);
  const [livePlatform, setLivePlatform] = useState('');
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [userCount, setUserCount] = useState<number>(1);
  const [webServerName, setWebServerName] = useState<string>('OpenLiteSpeed');
  const [sessionPage, setSessionPage] = useState<number>(1);
  const SESSIONS_PER_PAGE = 5;

  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      if (a.current && !b.current) return -1;
      if (!a.current && b.current) return 1;
      return 0;
    });
  }, [sessions]);

  const totalSessionPages = Math.max(1, Math.ceil(sortedSessions.length / SESSIONS_PER_PAGE));
  const currentSessionPage = Math.min(sessionPage, totalSessionPages);
  const paginatedSessions = sortedSessions.slice(
    (currentSessionPage - 1) * SESSIONS_PER_PAGE,
    currentSessionPage * SESSIONS_PER_PAGE
  );

  const loadData = async () => {
    const reachable = await apiReachable();
    setLive(reachable);
    if (!reachable) return;

    try {
      const [auditRes, sessionList, capsRes, metricsRes, usersRes, stackRes] = await Promise.allSettled([
        api.audit(10),
        api.sessions(),
        api.capabilities(),
        api.systemMetrics('5m'),
        api.users(),
        api.stack(),
      ]);

      if (auditRes.status === 'fulfilled') {
        const audit = auditRes.value;
        setEvents(
          audit.items.map((entry) => ({
            time: clockTime(entry.at),
            level: entry.action === 'system.capacity_exceeded'
              ? 'error'
              : /delete|revoke|stop|capacity/.test(entry.action)
                ? 'warn'
                : 'info',
            msg: `${describeAudit(entry.action, entry.target ?? '', entry.detail ?? '', entry.username ?? '')}${
              entry.ip ? ` (${entry.ip})` : ''
            }`,
          })),
        );
      }

      if (sessionList.status === 'fulfilled') {
        const sl = sessionList.value;
        setSessions(
          sl.items.map((row) => ({
            device: describeDevice(row.userAgent),
            ip: row.ip,
            lastActive: timeAgo(row.lastSeenAt),
            current: row.id === sl.currentId,
          })),
        );
      }

      if (capsRes.status === 'fulfilled') {
        const c = capsRes.value.capabilities;
        setLivePlatform(
          [c.distro || c.os, c.kernel ? `Linux ${c.kernel}` : '', c.arch].filter(Boolean).join(' • ')
        );
      }

      if (metricsRes.status === 'fulfilled' && metricsRes.value.latest) {
        setMetrics(metricsRes.value.latest);
      }

      if (usersRes.status === 'fulfilled' && usersRes.value.items) {
        setUserCount(usersRes.value.items.length);
      }

      if (stackRes.status === 'fulfilled' && stackRes.value.webServer?.active) {
        setWebServerName(stackRes.value.webServer.active.toUpperCase());
      }
    } catch {
      // keep fallback
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadData().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const interval = setInterval(() => {
      void loadData();
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Compute live human values
  const cpuPct = metrics ? Math.round(metrics.cpuPercent * 10) / 10 : 0;
  const cpuCores = metrics?.cpuCores ?? 1;
  const loadStr = metrics ? `${metrics.load1.toFixed(2)}, ${metrics.load5.toFixed(2)}, ${metrics.load15.toFixed(2)}` : '—';
  
  const ramUsedBytes = metrics?.memoryUsedBytes ?? 0;
  const ramTotalBytes = metrics?.memoryTotalBytes ?? 1;
  const ramPct = ramTotalBytes > 0 ? Math.round((ramUsedBytes / ramTotalBytes) * 100) : 0;
  const ramUsedGb = (ramUsedBytes / (1024 ** 3)).toFixed(1);
  const ramTotalGb = (ramTotalBytes / (1024 ** 3)).toFixed(1);

  const diskUsedBytes = metrics?.diskUsedBytes ?? 0;
  const diskTotalBytes = metrics?.diskTotalBytes ?? 1;
  const diskPct = diskTotalBytes > 0 ? Math.round((diskUsedBytes / diskTotalBytes) * 100) : 0;
  const diskUsedGb = (diskUsedBytes / (1024 ** 3)).toFixed(1);
  const diskTotalGb = (diskTotalBytes / (1024 ** 3)).toFixed(1);

  const netRx = metrics ? formatRate(metrics.netRxBps) : '0 B/s';
  const netTx = metrics ? formatRate(metrics.netTxBps) : '0 B/s';
  const diskRead = metrics ? formatRate(metrics.diskReadBps) : '0 B/s';
  const diskWrite = metrics ? formatRate(metrics.diskWriteBps) : '0 B/s';
  const uptimeStr = metrics ? formatUptime(metrics.uptimeSeconds) : '—';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Title & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Host Overview & System Health</h1>
            {live === true && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Telemetry
              </span>
            )}
            {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400" />}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            BarePod Node Monitor • {livePlatform || 'Linux Host Node'} • {cpuCores} vCPU Cores Active
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => onOpenAddModal()}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-blue-600" />
            <span>Deploy App</span>
          </button>
          <button
            onClick={() => onNavigate('monitoring')}
            className="flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/25 transition-all cursor-pointer"
          >
            <Activity className="w-4 h-4" />
            <span>Full Server Monitor</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Primary Telemetry Row (Live data from /api/v1/system/metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CPU */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs transition-all hover:border-blue-300">
          <div className="flex items-center justify-between text-xs font-bold tracking-wider text-slate-400">
            <span>CPU USAGE</span>
            <Cpu className="w-4 h-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{cpuPct}%</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-1.5 rounded-full transition-all duration-500 ${
                cpuPct > 80 ? 'bg-rose-500' : cpuPct > 50 ? 'bg-amber-500' : 'bg-blue-600'
              }`} 
              style={{ width: `${Math.min(100, Math.max(2, cpuPct))}%` }} 
            />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block font-medium">
            {cpuCores} Cores • Load {loadStr}
          </span>
        </div>

        {/* RAM */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs transition-all hover:border-emerald-300">
          <div className="flex items-center justify-between text-xs font-bold tracking-wider text-slate-400">
            <span>MEMORY (RAM)</span>
            <Activity className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{ramUsedGb} / {ramTotalGb} GB</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-1.5 rounded-full transition-all duration-500 ${
                ramPct > 85 ? 'bg-rose-500' : 'bg-emerald-500'
              }`} 
              style={{ width: `${Math.min(100, Math.max(2, ramPct))}%` }} 
            />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block font-medium">
            {ramPct}% Allocated • {formatBytes(ramTotalBytes - ramUsedBytes)} Free
          </span>
        </div>

        {/* Disk */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs transition-all hover:border-purple-300">
          <div className="flex items-center justify-between text-xs font-bold tracking-wider text-slate-400">
            <span>STORAGE (ROOT FS)</span>
            <HardDrive className="w-4 h-4 text-purple-500" />
          </div>
          <div className="mt-2 text-2xl font-extrabold text-slate-900">{diskUsedGb} / {diskTotalGb} GB</div>
          <div className="mt-3 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div 
              className={`h-1.5 rounded-full transition-all duration-500 ${
                diskPct > 85 ? 'bg-rose-500' : 'bg-purple-500'
              }`} 
              style={{ width: `${Math.min(100, Math.max(2, diskPct))}%` }} 
            />
          </div>
          <span className="text-[11px] text-slate-500 mt-2 block font-medium">
            {diskPct}% Used • {formatBytes(diskTotalBytes - diskUsedBytes)} Available
          </span>
        </div>

        {/* Network & Disk I/O */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs transition-all hover:border-sky-300">
          <div className="flex items-center justify-between text-xs font-bold tracking-wider text-slate-400">
            <span>NETWORK & DISK I/O</span>
            <ArrowUpRight className="w-4 h-4 text-sky-500" />
          </div>
          <div className="mt-2 text-base font-bold text-slate-900 flex items-center justify-between">
            <span className="flex items-center gap-1 text-emerald-600 font-mono text-sm">
              <ArrowDown className="w-3.5 h-3.5" />{netRx}
            </span>
            <span className="flex items-center gap-1 text-blue-600 font-mono text-sm">
              <ArrowUp className="w-3.5 h-3.5" />{netTx}
            </span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between font-mono">
            <span>Disk R: {diskRead}</span>
            <span>W: {diskWrite}</span>
          </div>
        </div>
      </div>

      {/* Secondary Highlights Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-slate-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Uptime</span>
            <span className="text-sm font-bold text-slate-900 block truncate">{uptimeStr}</span>
          </div>
        </div>

        <button
          onClick={() => onNavigate('web')}
          className="text-left bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors cursor-pointer flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0">
            <Box className="w-4 h-4 text-blue-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Websites</span>
            <span className="text-sm font-bold text-slate-900 block truncate">{runningApps} of {apps.length} Running</span>
          </div>
        </button>

        <button
          onClick={() => onNavigate('users')}
          className="text-left bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors cursor-pointer flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Tenants</span>
            <span className="text-sm font-bold text-slate-900 block truncate">{userCount} System Users</span>
          </div>
        </button>

        <button
          onClick={() => onNavigate('stack')}
          className="text-left bg-white p-4 rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-colors cursor-pointer flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-purple-600" />
          </div>
          <div className="min-w-0">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">Active Engine</span>
            <span className="text-sm font-bold text-slate-900 block truncate">{webServerName}</span>
          </div>
        </button>
      </div>

      {/* Main 2-Column Split: Balanced Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols): App Table & Sessions */}
        <div className="lg:col-span-2 space-y-6">
          {/* Websites Quick List */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">Hosted Websites</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
                  {apps.length}
                </span>
              </div>
              <button
                onClick={() => onNavigate('web')}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                <span>Manage All</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
                  <tr>
                    <th className="py-2.5 px-5">Website / Domain</th>
                    <th className="py-2.5 px-5">Runtime & Server</th>
                    <th className="py-2.5 px-5">Tenant</th>
                    <th className="py-2.5 px-5">Port</th>
                    <th className="py-2.5 px-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {apps.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No websites deployed yet. Click "Deploy App" above to get started.
                      </td>
                    </tr>
                  ) : (
                    apps.map((app) => (
                      <tr
                        key={app.id}
                        onClick={() => onSelectApp ? onSelectApp(app.name) : onNavigate('web')}
                        className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-5">
                          <span className="font-semibold text-slate-900 block">{app.name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">{app.domain}</span>
                        </td>
                        <td className="py-3 px-5">
                          <span className="text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded text-slate-700 font-semibold inline-block">
                            {app.runtime.toUpperCase()} {app.version}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1.5 uppercase font-medium">
                            {app.webServer || 'ols'}
                          </span>
                        </td>
                        <td className="py-3 px-5 font-mono text-slate-600 font-medium">{app.tenantUser}</td>
                        <td className="py-3 px-5 font-mono text-slate-500">{app.port || '—'}</td>
                        <td className="py-3 px-5 text-right">
                          <span className={`inline-flex items-center gap-1.5 font-medium px-2 py-0.5 rounded text-[11px] ${
                            app.status === 'suspended' ? 'bg-amber-50 text-amber-700' : 
                            app.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              app.status === 'suspended' ? 'bg-amber-500' : 
                              app.status === 'running' ? 'bg-emerald-500' : 'bg-slate-400'
                            }`} />
                            {app.status === 'suspended' ? 'Suspended' : app.status === 'running' ? 'Active' : 'Stopped'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Active Sessions */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-slate-700" />
                <h2 className="text-sm font-bold text-slate-900">Active Admin & User Sessions</h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-mono">
                  {sessions.length}
                </span>
              </div>
              <button
                onClick={() => onNavigate('profile')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer flex items-center gap-1"
              >
                <span>Manage Sessions</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {paginatedSessions.map((session, i) => (
                <div key={i} className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <LogIn className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-semibold text-slate-800 truncate">{session.device}</span>
                    {session.current && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded shrink-0">
                        Current Device
                      </span>
                    )}
                  </div>
                  <span className="text-slate-400 font-mono text-[11px] shrink-0">
                    {session.ip} • {session.lastActive}
                  </span>
                </div>
              ))}
              {sessions.length === 0 && (
                <p className="px-5 py-6 text-xs text-slate-400 text-center">
                  No active sessions found.
                </p>
              )}
            </div>

            {/* Pagination Controls */}
            {totalSessionPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-500 font-medium">
                  Showing <strong className="text-slate-800">{(currentSessionPage - 1) * SESSIONS_PER_PAGE + 1}</strong>–<strong className="text-slate-800">{Math.min(currentSessionPage * SESSIONS_PER_PAGE, sortedSessions.length)}</strong> of <strong className="text-slate-800">{sortedSessions.length}</strong> sessions
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
                    disabled={currentSessionPage <= 1}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev</span>
                  </button>
                  <span className="text-[11px] font-mono text-slate-600 px-1.5">
                    {currentSessionPage} / {totalSessionPages}
                  </span>
                  <button
                    onClick={() => setSessionPage((p) => Math.min(totalSessionPages, p + 1))}
                    disabled={currentSessionPage >= totalSessionPages}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-2xs"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (1 col): Recent Live Activity & System Suite */}
        <div className="space-y-6">
          {/* Recent Live Activity Feed (from /api/v1/audit) */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">Live Activity Feed</h2>
              </div>
              <button
                onClick={() => onNavigate('monitoring')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
              >
                Full Log
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[380px] overflow-y-auto">
              {events.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs">
                  <ShieldCheck className="w-6 h-6 mx-auto mb-1.5 text-slate-300" />
                  No audit activity recorded yet.
                </div>
              ) : (
                events.map((ev, i) => {
                  const color = ev.level === 'error'
                    ? 'text-rose-600 bg-rose-50 border-rose-100'
                    : ev.level === 'warn'
                    ? 'text-amber-600 bg-amber-50 border-amber-100'
                    : 'text-blue-600 bg-blue-50 border-blue-100';
                  return (
                    <div key={i} className="flex items-start gap-3 text-xs p-2 rounded-lg hover:bg-slate-50 transition-colors">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${color}`}>
                        {ev.level === 'info' ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="text-[10px] text-slate-400 font-mono block">{ev.time}</span>
                        <span className="text-slate-700 font-medium leading-relaxed block">{ev.msg}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quick Engine Management Shortcuts */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Panel Management</h3>
            <div className="space-y-2">
              <button
                onClick={() => onNavigate('stack')}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all text-left text-xs"
              >
                <div className="flex items-center gap-2.5 font-semibold text-slate-800">
                  <Server className="w-4 h-4 text-blue-600" />
                  <span>Web Stack & Switch Engines</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onNavigate('databases')}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all text-left text-xs"
              >
                <div className="flex items-center gap-2.5 font-semibold text-slate-800">
                  <Database className="w-4 h-4 text-emerald-600" />
                  <span>Databases (MySQL, PG, Mongo)</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>

              <button
                onClick={() => onNavigate('monitoring')}
                className="w-full flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-purple-200 hover:bg-purple-50/30 transition-all text-left text-xs"
              >
                <div className="flex items-center gap-2.5 font-semibold text-slate-800">
                  <Activity className="w-4 h-4 text-purple-600" />
                  <span>Host Processes & Systemd</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
