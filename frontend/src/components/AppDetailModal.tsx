import React, { useState, useEffect } from 'react';
import { 
  X, 
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
  RefreshCw, 
  Folder, 
  FolderGit2, 
  ExternalLink, 
  CheckCircle2, 
  AlertCircle, 
  Search, 
  Download, 
  Trash2, 
  Layers, 
  Zap, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Clock, 
  Check, 
  Copy,
  Lock,
  GitBranch,
  Filter
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';
import { siteSupportsFiles, siteSupportsCI, siteSupportsShell, siteHasGit } from '../utils/siteRuntime';

interface AppDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
  onToggleStatus: (appId: string) => void;
  onOpenTerminal: (app: WebApp) => void;
  onOpenFiles: (app: WebApp) => void;
  onOpenGit: (app: WebApp) => void;
}

export const AppDetailModal: React.FC<AppDetailModalProps> = ({
  isOpen,
  onClose,
  app,
  onToggleStatus,
  onOpenTerminal,
  onOpenFiles,
  onOpenGit,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'monitoring' | 'logs' | 'routing' | 'env'>('monitoring');
  const [logType, setLogType] = useState<'all' | 'access' | 'error' | 'deploy'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);

  // Simulated live CPU & RAM metrics
  const [liveMetrics, setLiveMetrics] = useState({
    cpu: 0.8,
    memory: 42,
    latency: 14,
    requestsTotal: 18420,
    http2xx: 98.6,
    http4xx: 1.1,
    http5xx: 0.3,
  });

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setLiveMetrics(prev => ({
        ...prev,
        cpu: Number((0.4 + Math.random() * 1.5).toFixed(1)),
        memory: Math.floor(40 + Math.random() * 8),
        latency: Math.floor(12 + Math.random() * 6),
        requestsTotal: prev.requestsTotal + Math.floor(Math.random() * 3),
      }));
    }, 2500);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen || !app) return null;

  const isRunning = app.status === 'running';

  // Realistic Logs Generator based on app runtime with Visitor Client IP
  interface LogItem {
    time: string;
    type: 'access' | 'error' | 'deploy';
    ip?: string;
    country?: string;
    method?: string;
    path?: string;
    status?: number;
    latency?: string;
    size?: string;
    msg: string;
  }

  const getMockLogs = (): LogItem[] => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const commonLogs: LogItem[] = [
      { 
        time: `${timestamp} [ACCESS]`, 
        type: 'access', 
        ip: '114.124.180.52', 
        country: 'ID', 
        method: 'GET', 
        path: '/', 
        status: 200, 
        latency: '14ms', 
        size: '1.4 KB',
        msg: `GET / 200 OK - 14ms (Chrome/128 MacOS)` 
      },
      { 
        time: `${timestamp} [ACCESS]`, 
        type: 'access', 
        ip: '114.124.180.52', 
        country: 'ID', 
        method: 'GET', 
        path: '/assets/app.css', 
        status: 304, 
        latency: '2ms', 
        size: '0 B',
        msg: `GET /assets/app.css 304 Not Modified - 2ms` 
      },
      { 
        time: `${timestamp} [ACCESS]`, 
        type: 'access', 
        ip: '180.252.164.22', 
        country: 'ID', 
        method: 'POST', 
        path: '/api/v1/telemetry', 
        status: 201, 
        latency: '22ms', 
        size: '340 B',
        msg: `POST /api/v1/telemetry 201 Created - 22ms` 
      },
      { 
        time: `${timestamp} [WAF]`, 
        type: 'error', 
        ip: '198.51.100.41', 
        country: 'US', 
        method: 'GET', 
        path: '/wp-login.php', 
        status: 404, 
        latency: '3ms', 
        size: '140 B',
        msg: `GET /wp-login.php 404 Not Found - [Blocked by WAF Rule #104]` 
      },
      { 
        time: `${timestamp} [INFO]`, 
        type: 'deploy', 
        msg: `[Deploy Runner] git pull origin main - HEAD is at commit 7fa901` 
      },
      { 
        time: `${timestamp} [INFO]`, 
        type: 'deploy', 
        msg: `[Process Supervisor] Worker process PID 41289 healthy. Memory: ${app.memoryUsage}` 
      },
    ];

    if (app.runtime === 'php') {
      return [
        { time: `${timestamp} [OLS/PHP]`, type: 'access', msg: `[OLS 2.1.2] VirtualHost ${app.domain} configured with PHP ${app.version}` },
        { time: `${timestamp} [LSCache]`, type: 'access', ip: '36.72.215.19', country: 'ID', method: 'GET', path: '/shop/products', status: 200, latency: '18ms', size: '12.8 KB', msg: `LSCache HIT: uri=/shop/products - 18ms` },
        ...commonLogs,
        { time: `${timestamp} [WAF]`, type: 'error', ip: '45.155.205.8', country: 'RU', method: 'POST', path: '/xmlrpc.php', status: 403, latency: '2ms', size: '42 B', msg: `POST /xmlrpc.php 403 Forbidden - [WAF Blocked exploit]` },
      ];
    }

    if (app.runtime === 'python') {
      return [
        { time: `${timestamp} [Gunicorn]`, type: 'access', msg: `Application startup complete on http://127.0.0.1:${app.port}` },
        { time: `${timestamp} [FastAPI]`, type: 'access', ip: '103.147.154.82', country: 'SG', method: 'GET', path: '/ai/predict', status: 200, latency: '18.2ms', size: '1.2 KB', msg: `INFO: "GET /ai/predict" 200 OK (latency: 18.2ms)` },
        ...commonLogs,
      ];
    }

    // Node.js / Default
    return [
      { time: `${timestamp} [Next.js]`, type: 'access', msg: `ready - started server on 0.0.0.0:${app.port}, url: http://localhost:${app.port}` },
      ...commonLogs,
      { time: `${timestamp} [ACCESS]`, type: 'access', ip: '203.190.242.11', country: 'ID', method: 'GET', path: '/dashboard', status: 200, latency: '24ms', size: '5.1 KB', msg: `GET /dashboard 200 OK - 24ms` },
    ];
  };

  const logs = getMockLogs();
  const filteredLogs = logs.filter(log => {
    const matchesType = logType === 'all' || log.type === logType;
    const searchTarget = `${log.msg} ${log.time} ${log.ip || ''} ${log.path || ''} ${log.method || ''} ${log.status || ''}`.toLowerCase();
    return matchesType && searchTarget.includes(logSearch.toLowerCase());
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full h-[92vh] flex flex-col overflow-hidden">
        
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-sm shadow-2xs border border-blue-100">
              <Globe className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{app.name}</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                  isRunning ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  {isRunning ? 'ACTIVE' : 'STOPPED'}
                </span>
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono font-semibold">
                  {app.runtime.toUpperCase()} {app.version} • {app.framework || 'Generic'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                <a 
                  href={`https://${app.domain}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="hover:text-blue-600 hover:underline flex items-center gap-1 text-blue-600 font-semibold"
                >
                  {app.domain}
                  <ExternalLink className="w-3 h-3 text-blue-500" />
                </a>
                <span>•</span>
                <span>Tenant: <code>@{app.tenantUser}</code></span>
                <span>•</span>
                <span>Web Server: <strong>{app.webServer.toUpperCase()}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Actions */}
            <button
              onClick={() => onOpenTerminal(app)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Open Isolated Terminal"
            >
              <Terminal className="w-3.5 h-3.5 text-slate-500" />
              <span>Terminal</span>
            </button>

            <button
              onClick={() => onOpenFiles(app)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
              title="Open File Manager"
            >
              <Folder className="w-3.5 h-3.5 text-amber-500" />
              <span>Files</span>
            </button>

            {siteSupportsCI(app) && siteHasGit(app) && (
              <button
                onClick={() => onOpenGit(app)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title={`Redeploy from Git (${app.gitBranch || 'main'})`}
              >
                <FolderGit2 className="w-3.5 h-3.5 text-indigo-500" />
                <span>Git Deploy</span>
              </button>
            )}

            <button
              onClick={() => onToggleStatus(app.id)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer ${
                isRunning ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>{isRunning ? 'Restart' : 'Start'}</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-2 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 border-b border-slate-200 flex items-center gap-2 bg-white shrink-0 text-xs font-bold">
          {[
            { id: 'monitoring', label: 'Monitoring & Metrics', icon: Activity },
            { id: 'logs', label: 'Live Logs Stream', icon: FileText },
            { id: 'routing', label: 'Routing & Reverse Proxy', icon: Server },
            { id: 'env', label: 'Environment (.env)', icon: Lock },
            { id: 'overview', label: 'Overview & Config', icon: Layers },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-3.5 border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">

          {/* TAB 1: REAL-TIME MONITORING */}
          {activeTab === 'monitoring' && (
            <div className="space-y-6">
              {/* Quick Stat Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU Usage */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">CPU Usage</span>
                    <Cpu className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900">{liveMetrics.cpu}%</span>
                    <span className="text-xs text-emerald-600 font-semibold">Normal</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(liveMetrics.cpu * 20, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">Allocated: 2 vCPUs (cgroup isolated)</span>
                </div>

                {/* Memory Usage */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Memory (RAM)</span>
                    <HardDrive className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900">{liveMetrics.memory} MB</span>
                    <span className="text-xs text-slate-400">/ 512 MB</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-amber-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${(liveMetrics.memory / 512) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">RSS: {liveMetrics.memory - 4} MB • Cache: 4 MB</span>
                </div>

                {/* Request Latency */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Avg. Latency</span>
                    <Zap className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900">{liveMetrics.latency} ms</span>
                    <span className="text-xs text-emerald-600 font-semibold">Lightning Fast</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(liveMetrics.latency * 3, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">HTTP/3 & OpenLiteSpeed LSCache</span>
                </div>

                {/* Total Requests */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="text-xs font-semibold">Total Traffic</span>
                    <Globe className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-slate-900">{liveMetrics.requestsTotal.toLocaleString()}</span>
                    <span className="text-xs text-blue-600 font-semibold">reqs</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full mt-3 overflow-hidden">
                    <div className="bg-indigo-600 h-full rounded-full w-4/5" />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">In: 18.4 MB • Out: 114.2 MB</span>
                </div>
              </div>

              {/* Real-time Response Code Breakdown */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    HTTP Response Status Distribution
                  </h3>
                  <span className="text-xs text-slate-400">Live 24h rolling window</span>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                    <span className="text-xl font-bold text-emerald-700 block">{liveMetrics.http2xx}%</span>
                    <span className="text-[11px] font-semibold text-emerald-800">2xx Success Rate</span>
                  </div>
                  <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
                    <span className="text-xl font-bold text-amber-700 block">{liveMetrics.http4xx}%</span>
                    <span className="text-[11px] font-semibold text-amber-800">4xx Client Errors</span>
                  </div>
                  <div className="p-3 bg-rose-50/70 border border-rose-200 rounded-xl">
                    <span className="text-xl font-bold text-rose-700 block">{liveMetrics.http5xx}%</span>
                    <span className="text-[11px] font-semibold text-rose-800">5xx Server Errors</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LIVE LOGS STREAM */}
          {activeTab === 'logs' && (
            <div className="space-y-4">
              {/* Controls bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                {/* Filter tabs */}
                <div className="flex items-center gap-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
                  {[
                    { id: 'all', label: 'All Logs' },
                    { id: 'access', label: 'Access Logs' },
                    { id: 'error', label: 'Error / Stderr' },
                    { id: 'deploy', label: 'Build / Deploy' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setLogType(f.id as any)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-semibold transition-all cursor-pointer ${
                        logType === f.id
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Search & Actions */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filter log keywords..."
                      value={logSearch}
                      onChange={(e) => setLogSearch(e.target.value)}
                      className="pl-8 pr-3 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 w-48 font-mono"
                    />
                  </div>

                  <button
                    onClick={() => {
                      setIsRefreshingLogs(true);
                      setTimeout(() => setIsRefreshingLogs(false), 400);
                    }}
                    className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
                    title="Refresh Logs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Log Console Terminal View */}
              <div className="bg-slate-950 rounded-2xl border border-slate-800 p-4 font-mono text-xs text-slate-200 shadow-xl overflow-hidden flex flex-col h-[52vh]">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px] text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Streaming stdout / stderr for {app.name} (Port {app.port})</span>
                  </div>
                  <span>{filteredLogs.length} events logged</span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 select-text font-mono text-[11px] leading-relaxed">
                  {filteredLogs.map((item, idx) => (
                    <div 
                      key={idx} 
                      className={`py-1 px-2 rounded hover:bg-slate-900 transition-colors flex flex-wrap items-baseline gap-2 ${
                        item.type === 'error' ? 'bg-rose-950/20 text-rose-300' :
                        item.type === 'deploy' ? 'bg-purple-950/20 text-indigo-300' : 'text-slate-300'
                      }`}
                    >
                      <span className="text-slate-500 text-[10px] select-none shrink-0 font-mono">[{item.time.split(' ')[0]}]</span>

                      {/* Visitor Client IP Badge */}
                      {item.ip ? (
                        <span 
                          className="shrink-0 text-[10px] font-mono font-bold text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/50 flex items-center gap-1"
                          title={`Visitor IP: ${item.ip} (${item.country || 'Global'})`}
                        >
                          <Globe className="w-2.5 h-2.5 text-amber-400" />
                          <span>{item.ip}</span>
                          {item.country && <span className="text-amber-500 font-normal">[{item.country}]</span>}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">system</span>
                      )}

                      {/* Method & Status */}
                      {item.method && item.status && (
                        <div className="shrink-0 flex items-center gap-1 text-[10px]">
                          <span className="font-bold text-cyan-300">{item.method}</span>
                          <span className={`px-1 py-0.2 rounded font-bold ${
                            item.status < 300 ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50' :
                            item.status < 400 ? 'bg-blue-950 text-blue-300 border border-blue-800/50' :
                            'bg-rose-950 text-rose-300 border border-rose-800/50'
                          }`}>
                            {item.status}
                          </span>
                        </div>
                      )}

                      <span className="flex-1 break-all">
                        {item.path ? (
                          <>
                            <span className="text-slate-100 font-semibold">{item.path}</span>
                            {item.latency && <span className="text-slate-400 ml-2 font-mono">({item.latency} • {item.size})</span>}
                          </>
                        ) : (
                          item.msg
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ROUTING & REVERSE PROXY */}
          {activeTab === 'routing' && (
            <div className="space-y-4">
              <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Path-Based Reverse Proxy Rules (Multi-Stack Splitting)</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      A single domain <strong>{app.domain}</strong> can split URL paths across multiple languages/services at once:
                    </p>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-600 uppercase text-[10px] font-bold">
                      <tr>
                        <th className="py-2.5 px-3">URL Path Pattern</th>
                        <th className="py-2.5 px-3">Target Service / Language</th>
                        <th className="py-2.5 px-3">Internal Target Port</th>
                        <th className="py-2.5 px-3">Engine Cache</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-blue-600">/* (Root)</td>
                        <td className="py-2.5 px-3 font-sans font-semibold text-slate-800">
                          {app.framework || app.runtime.toUpperCase()} (Primary Service)
                        </td>
                        <td className="py-2.5 px-3">http://127.0.0.1:{app.port}</td>
                        <td className="py-2.5 px-3 font-sans text-emerald-600">LSCache Enabled</td>
                      </tr>
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-purple-600">/api/*</td>
                        <td className="py-2.5 px-3 font-sans text-slate-600">
                          PHP-FPM / Laravel REST API (Optional Split)
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">http://127.0.0.1:8001</td>
                        <td className="py-2.5 px-3 font-sans text-slate-400">Bypass Cache</td>
                      </tr>
                      <tr className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-bold text-amber-600">/ai/*</td>
                        <td className="py-2.5 px-3 font-sans text-slate-600">
                          Python FastAPI ML Inference (Optional Split)
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">http://127.0.0.1:5000</td>
                        <td className="py-2.5 px-3 font-sans text-slate-400">Streaming</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: ENVIRONMENT (.env) */}
          {activeTab === 'env' && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Environment Variables (.env)</h3>
                  <p className="text-xs text-slate-500">Auto-synced with file <code>{app.path || `/home/${app.tenantUser}/web/${app.name}`}/.env</code></p>
                </div>
                <button
                  onClick={() => {
                    setCopiedEnv(true);
                    setTimeout(() => setCopiedEnv(false), 1500);
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEnv ? 'Copied' : 'Copy All'}</span>
                </button>
              </div>

              <div className="bg-slate-900 rounded-xl p-4 font-mono text-xs text-slate-200 space-y-2">
                <div className="text-slate-400 select-none"># App Runtime Environment</div>
                <div>APP_NAME={app.name}</div>
                <div>APP_ENV=production</div>
                <div>APP_PORT={app.port}</div>
                <div>APP_DOMAIN={app.domain}</div>
                <div className="text-slate-400 select-none mt-2"># Tenant Isolation Credentials</div>
                <div>TENANT_USER={app.tenantUser}</div>
                <div>TENANT_HOME=/home/{app.tenantUser}</div>
                <div>DATABASE_URL=postgresql://{app.tenantUser}_user:••••••••@127.0.0.1:5432/{app.name}_db</div>
              </div>
            </div>
          )}

          {/* TAB 5: OVERVIEW & CONFIG */}
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Service Metadata</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Internal Port</span>
                    <span className="font-mono font-bold text-slate-800">{app.port}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Web Server Engine</span>
                    <span className="font-semibold text-slate-800">{app.webServer.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Runtime Version</span>
                    <span className="font-mono text-slate-800">{app.runtime} {app.version}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">SSL Certificate</span>
                    <span className="text-emerald-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Auto-renewing (Let's Encrypt / ZeroSSL)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Security & Isolation</h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Linux Tenant User</span>
                    <span className="font-mono font-bold text-slate-800">@{app.tenantUser}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Filesystem Sandbox</span>
                    <span className="font-mono text-slate-600 text-[11px]">{app.path || `/home/${app.tenantUser}/web/${app.name}`}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Cloudflare Tunnel Ingress</span>
                    <span className="font-semibold text-blue-600">{app.tunnelEnabled ? 'Enabled (Zero-NAT)' : 'Direct IP'}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Process supervisor active (Auto-restart on fail)</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Close Details
          </button>
        </div>

      </div>
    </div>
  );
};
