import React, { useState, useEffect } from 'react';
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
  Filter,
  Eye,
  EyeOff
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';

interface AppDetailPageProps {
  app: WebApp;
  onBack: () => void;
  onToggleStatus: (appId: string) => void;
  onOpenTerminal: (app: WebApp) => void;
  onOpenFiles: (app: WebApp) => void;
  onOpenGit: (app: WebApp) => void;
}

export const AppDetailPage: React.FC<AppDetailPageProps> = ({
  app,
  onBack,
  onToggleStatus,
  onOpenTerminal,
  onOpenFiles,
  onOpenGit,
}) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'overview' | 'logs' | 'routing' | 'env'>('monitoring');
  const [logType, setLogType] = useState<'all' | 'access' | 'error' | 'deploy'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [maskSecrets, setMaskSecrets] = useState(true);

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
  }, []);

  const isRunning = app.status === 'running';
  const appPath = app.path || `/home/${app.tenantUser}/apps/${app.name}`;

  // Realistic Logs Generator based on app runtime
  const getMockLogs = () => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const commonLogs = [
      { time: `${timestamp} [INFO]`, type: 'access', msg: `GET / 200 OK - 14ms (Mozilla/5.0 Chrome/128) - 1.4 KB` },
      { time: `${timestamp} [INFO]`, type: 'access', msg: `GET /assets/app.css 304 Not Modified - 2ms - 0 B` },
      { time: `${timestamp} [INFO]`, type: 'access', msg: `POST /api/v1/telemetry 201 Created - 22ms - 340 B` },
      { time: `${timestamp} [WARN]`, type: 'access', msg: `GET /wp-login.php 404 Not Found - 3ms - [Blocked by WAF Rule #104]` },
      { time: `${timestamp} [INFO]`, type: 'deploy', msg: `[Deploy Runner] git pull origin main - HEAD is at commit 7fa901` },
      { time: `${timestamp} [INFO]`, type: 'deploy', msg: `[Deploy Runner] Zero-downtime symlink swapped to release_20261010_1834` },
    ];

    if (app.runtime === 'php') {
      return [
        { time: `${timestamp} [NOTICE]`, type: 'access', msg: `[php-fpm: pool ${app.tenantUser}] child 3914 ready to handle requests` },
        ...commonLogs,
        { time: `${timestamp} [DEBUG]`, type: 'access', msg: `PHP 8.4 JIT Compiler enabled (opcache.jit_buffer_size=64M)` },
        { time: `${timestamp} [WARN]`, type: 'error', msg: `PHP Deprecated: Creation of dynamic property in /vendor/legacy/class.php on line 42` },
      ];
    } else if (app.runtime === 'nodejs') {
      return [
        { time: `${timestamp} [INFO]`, type: 'access', msg: `[NestJS] Application initialized listening on unix:/run/node/${app.name}.sock` },
        ...commonLogs,
        { time: `${timestamp} [INFO]`, type: 'access', msg: `Prisma ORM connected to PostgreSQL pool (min: 2, max: 10)` },
        { time: `${timestamp} [WARN]`, type: 'error', msg: `Rate limiter: 429 Too Many Requests from IP 198.51.100.41 on /api/auth/login` },
      ];
    } else if (app.runtime === 'python') {
      return [
        { time: `${timestamp} [INFO]`, type: 'access', msg: `[Gunicorn 22.0] Starting gunicorn workers (gevent async worker_class)` },
        ...commonLogs,
        { time: `${timestamp} [INFO]`, type: 'access', msg: `FastAPI OpenAPI documentation mounted at /docs` },
        { time: `${timestamp} [DEBUG]`, type: 'access', msg: `PyTorch model cached in GPU memory: 182 MB allocated` },
      ];
    }
    return commonLogs;
  };

  const logs = getMockLogs();
  const filteredLogs = logs.filter(log => {
    const matchesType = logType === 'all' || log.type === logType;
    const matchesSearch = log.msg.toLowerCase().includes(logSearch.toLowerCase()) || log.time.toLowerCase().includes(logSearch.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleCopyEnv = () => {
    const envContent = `APP_NAME=${app.name}
APP_ENV=production
APP_KEY=base64:X8n49f03jfa94klsm49v02kflasjfo32=
APP_DEBUG=false
APP_URL=https://${app.domain}

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=app_${app.name.replace(/[^a-zA-Z0-9]/g, '_')}
DB_USERNAME=${app.tenantUser}
DB_PASSWORD=••••••••••••••••

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

SESSION_DRIVER=redis
CACHE_STORE=redis
QUEUE_CONNECTION=redis`;
    navigator.clipboard.writeText(envContent);
    setCopiedEnv(true);
    setTimeout(() => setCopiedEnv(false), 2000);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      
      {/* Top Breadcrumb & Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs group cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-slate-500 group-hover:-translate-x-0.5 transition-transform" />
            <span>Kembali ke Semua Apps</span>
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
            isRunning 
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
              : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {isRunning ? 'Online & Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Main Header Card with App Identity & Quick Actions */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl font-bold shadow-2xs border border-blue-100">
              {app.runtime === 'php' ? '🐘' : app.runtime === 'nodejs' ? '⬢' : app.runtime === 'python' ? '🐍' : '⚡'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{app.name}</h1>
                <span className="text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider bg-slate-100 text-slate-700 font-mono">
                  {app.runtime} {app.version}
                </span>
                {app.framework && (
                  <span className="text-xs px-2.5 py-0.5 rounded-md font-bold bg-purple-50 text-purple-700 border border-purple-200">
                    {app.framework}
                  </span>
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
                <span>Tenant: <strong className="text-slate-700 font-mono">{app.tenantUser}</strong></span>
                <span>•</span>
                <span>Path: <strong className="text-slate-700 font-mono">{appPath}</strong></span>
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
              <span>Buka Web</span>
            </a>

            <button
              onClick={() => onOpenTerminal(app)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
              title="Open Web Terminal in isolated runtime"
            >
              <Terminal className="w-3.5 h-3.5 text-blue-600" />
              <span>Terminal CLI</span>
            </button>

            <button
              onClick={() => onOpenFiles(app)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <Folder className="w-3.5 h-3.5 text-amber-600" />
              <span>File Manager</span>
            </button>

            <button
              onClick={() => onOpenGit(app)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <FolderGit2 className="w-3.5 h-3.5 text-purple-600" />
              <span>Git CI/CD</span>
            </button>

            <button
              onClick={() => onToggleStatus(app.id)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-sm ${
                isRunning
                  ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-500/25'
              }`}
            >
              {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isRunning ? 'Hentikan App' : 'Jalankan App'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-4 rounded-t-2xl overflow-x-auto text-xs font-semibold">
        <button
          onClick={() => setActiveTab('monitoring')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'monitoring'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Live Telemetry & Metrics</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-0.5" />
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Streaming Logs</span>
          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
            {filteredLogs.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('routing')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'routing'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>Reverse Proxy & Multi-Engine Routing</span>
        </button>

        <button
          onClick={() => setActiveTab('env')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'env'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Lock className="w-4 h-4" />
          <span>Environment (.env)</span>
        </button>

        <button
          onClick={() => setActiveTab('overview')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>Server & Runtime Configuration</span>
        </button>
      </div>

      {/* Main Tab Content View */}
      <div className="bg-white rounded-b-2xl border border-t-0 border-slate-200 p-6 shadow-2xs">
        
        {/* TAB 1: LIVE MONITORING & TELEMETRY */}
        {activeTab === 'monitoring' && (
          <div className="space-y-6">
            {/* Live Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">CPU USAGE</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900">{liveMetrics.cpu}%</span>
                  <span className="text-[10px] text-emerald-600 font-bold">Quota: 1 vCPU</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mt-2">
                  <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${Math.min(100, liveMetrics.cpu * 20)}%` }} />
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">MEMORY (RAM)</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900">{liveMetrics.memory} MB</span>
                  <span className="text-[10px] text-slate-400">Limit: 512 MB</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden mt-2">
                  <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${(liveMetrics.memory / 512) * 100}%` }} />
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">RESPONSE LATENCY</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900">{liveMetrics.latency} ms</span>
                  <span className="text-[10px] text-emerald-600 font-bold">P99 Fast</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-2">Nginx upstream unix socket</span>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">TOTAL REQUESTS</span>
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-extrabold text-slate-900">{liveMetrics.requestsTotal.toLocaleString()}</span>
                  <span className="text-[10px] text-emerald-600 font-bold">24h Uptime</span>
                </div>
                <span className="text-[10px] text-slate-400 block mt-2">99.98% Success Rate</span>
              </div>
            </div>

            {/* HTTP Status Code Distribution */}
            <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  HTTP Traffic Distribution (24h)
                </h3>
                <span className="text-[11px] text-slate-400 font-mono">Edge Ingress Telemetry</span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">2xx Success</span>
                    <span className="text-sm font-bold text-emerald-600">{liveMetrics.http2xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-emerald-500 h-1.5" style={{ width: `${liveMetrics.http2xx}%` }} />
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">4xx Client Errors</span>
                    <span className="text-sm font-bold text-amber-600">{liveMetrics.http4xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-amber-500 h-1.5" style={{ width: `${liveMetrics.http4xx * 10}%` }} />
                  </div>
                </div>

                <div className="bg-white p-3 rounded-lg border border-slate-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500 font-medium">5xx Server Errors</span>
                    <span className="text-sm font-bold text-rose-600">{liveMetrics.http5xx}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden mt-2">
                    <div className="bg-rose-500 h-1.5" style={{ width: `${liveMetrics.http5xx * 10}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Health Probes & SSL Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>SSL/TLS Automated Let's Encrypt Certificate</span>
                </div>
                <p className="text-xs text-slate-500">
                  Domain <code>{app.domain}</code> dilindungi enkripsi TLS 1.3 dengan auto-renewal setiap 60 hari.
                </p>
                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  Issuer: Let's Encrypt Authority X3 • Valid until: 2026-12-10
                </div>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center gap-2 text-blue-700 font-bold text-xs">
                  <CloudRain className="w-4 h-4 text-blue-600" />
                  <span>Cloudflare Zero-NAT Tunnel Status</span>
                </div>
                <p className="text-xs text-slate-500">
                  Koneksi ingress tunnel terisolasi aktif untuk tenant <code>{app.tenantUser}</code>.
                </p>
                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  Tunnel ID: cf-tun-71fa80c • Direct Edge Routing Active
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STREAMING LOGS CONSOLE */}
        {activeTab === 'logs' && (
          <div className="space-y-3">
            {/* Filter Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search logs..."
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 w-56 font-mono"
                  />
                </div>

                <div className="flex items-center gap-1">
                  {(['all', 'access', 'error', 'deploy'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => setLogType(type)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium capitalize transition-colors ${
                        logType === type
                          ? 'bg-blue-600 text-white font-bold'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsRefreshingLogs(true);
                    setTimeout(() => setIsRefreshingLogs(false), 500);
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-100"
                >
                  <RotateCw className={`w-3 h-3 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
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

            {/* Terminal Window */}
            <div className="bg-slate-950 text-slate-100 font-mono text-xs rounded-xl p-4 min-h-[380px] max-h-[500px] overflow-y-auto space-y-1.5 border border-slate-800 shadow-inner">
              {filteredLogs.map((log, idx) => (
                <div key={idx} className="flex items-start gap-2 leading-relaxed hover:bg-slate-900/60 p-0.5 rounded">
                  <span className="text-slate-500 shrink-0 text-[11px]">{log.time}</span>
                  <span className={`shrink-0 text-[10px] px-1 rounded uppercase font-bold ${
                    log.type === 'error' ? 'bg-rose-950 text-rose-300' :
                    log.type === 'deploy' ? 'bg-purple-950 text-purple-300' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {log.type}
                  </span>
                  <span className={`text-[11px] ${
                    log.type === 'error' ? 'text-rose-400' :
                    log.type === 'deploy' ? 'text-purple-300' :
                    'text-slate-200'
                  }`}>
                    {log.msg}
                  </span>
                </div>
              ))}
              {filteredLogs.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  Tidak ada baris log yang sesuai dengan filter pencarian.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: REVERSE PROXY & MULTI-ENGINE PATH ROUTING */}
        {activeTab === 'routing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Hybrid Engine Reverse Proxy & Upstream Mapping
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Arsitektur hybrid BarePod Panel memungkinkan satu website menggabungkan beberapa runtime sekaligus di bawah domain yang sama.
                </p>
              </div>
              <span className="px-2 py-0.5 text-xs rounded font-bold bg-blue-100 text-blue-700">
                Primary: {app.webServer.toUpperCase()}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">LOCATION PATH</th>
                    <th className="py-2.5 px-3">UPSTREAM HANDLER</th>
                    <th className="py-2.5 px-3">TARGET RUNTIME</th>
                    <th className="py-2.5 px-3">CACHE STRATEGY</th>
                    <th className="py-2.5 px-3">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-3 px-3 font-bold text-blue-600">/ (Root)</td>
                    <td className="py-3 px-3 text-slate-700">FastCGI unix:/run/php/php8.4-fpm.sock</td>
                    <td className="py-3 px-3 text-slate-800 font-sans">PHP 8.4 ({app.framework || 'WordPress/Laravel'})</td>
                    <td className="py-3 px-3 text-slate-500">LSCache / FastCGI Microcache</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">Active (Primary)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-blue-600">/api/v1/*</td>
                    <td className="py-3 px-3 text-slate-700">proxy_pass http://127.0.0.1:3000</td>
                    <td className="py-3 px-3 text-slate-800 font-sans">Node.js (NestJS / Express API)</td>
                    <td className="py-3 px-3 text-slate-500">Bypass Cache (Realtime)</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">Active (Route Split)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-blue-600">/ai-worker/*</td>
                    <td className="py-3 px-3 text-slate-700">proxy_pass http://127.0.0.1:8000</td>
                    <td className="py-3 px-3 text-slate-800 font-sans">Python 3.12 (FastAPI ML Service)</td>
                    <td className="py-3 px-3 text-slate-500">Bypass Cache</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">Active (Route Split)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-blue-600">/assets/*, /static/*</td>
                    <td className="py-3 px-3 text-slate-700">Direct Nginx Sendfile Zero-Copy</td>
                    <td className="py-3 px-3 text-slate-800 font-sans">Static Assets</td>
                    <td className="py-3 px-3 text-slate-500">Browser Cache 365d (Immutable)</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">Active</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed">
              💡 <strong>Multi-Engine Split Terintegrasi:</strong> Anda tidak perlu membuat subdomain terpisah untuk API backend atau worker Python Anda. Cukup petakan path prefix di atas dan reverse proxy akan otomatis meneruskan traffic ke unix socket atau port backend yang bersangkutan.
            </div>
          </div>
        )}

        {/* TAB 4: ENVIRONMENT VARIABLES (.ENV) */}
        {activeTab === 'env' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  File Konfigurasi .env (Production Secrets)
                </h3>
                <p className="text-xs text-slate-500">
                  Tersimpan aman di <code>{appPath}/.env</code> dengan permission <code>0600</code> (chown {app.tenantUser}).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setMaskSecrets(!maskSecrets)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg"
                >
                  {maskSecrets ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{maskSecrets ? 'Tampilkan Secrets' : 'Sembunyikan Secrets'}</span>
                </button>

                <button
                  onClick={handleCopyEnv}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200"
                >
                  {copiedEnv ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedEnv ? 'Copied!' : 'Salin ke Clipboard'}</span>
                </button>
              </div>
            </div>

            <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl border border-slate-800 overflow-x-auto leading-relaxed max-h-96">
{`APP_NAME=${app.name}
APP_ENV=production
APP_KEY=${maskSecrets ? 'base64:••••••••••••••••••••••••••••••••••••••••' : 'base64:X8n49f03jfa94klsm49v02kflasjfo32='}
APP_DEBUG=false
APP_URL=https://${app.domain}

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=app_${app.name.replace(/[^a-zA-Z0-9]/g, '_')}
DB_USERNAME=${app.tenantUser}
DB_PASSWORD=${maskSecrets ? '••••••••••••••••••••••••' : 'secret_prod_database_pw_9921'}

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

SESSION_DRIVER=redis
CACHE_STORE=redis
QUEUE_CONNECTION=redis`}
            </pre>
          </div>
        )}

        {/* TAB 5: OVERVIEW & SERVER RUNTIME */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Runtime & Server Jail Specifications
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block">ISOLATED HOME DIR</span>
                <span className="text-xs font-mono font-bold text-slate-800">{appPath}</span>
                <span className="text-[10px] text-slate-400 block pt-1">Linux chroot & cgroups v2</span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block">ACTIVE WEB SERVER</span>
                <span className="text-xs font-bold text-slate-800">{app.webServer.toUpperCase()}</span>
                <span className="text-[10px] text-slate-400 block pt-1">HTTP/2 & HTTP/3 ALPN Ready</span>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold block">NODE/PHP FASTCGI SOCKET</span>
                <span className="text-xs font-mono font-bold text-slate-800">/run/{app.runtime}/{app.tenantUser}.sock</span>
                <span className="text-[10px] text-slate-400 block pt-1">High Performance IPC Socket</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
