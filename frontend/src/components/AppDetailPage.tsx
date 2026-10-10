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
  RefreshCw
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';
import { MaintenancePreviewModal } from './MaintenancePreviewModal';
import { BasicAuthPromptModal } from './BasicAuthPromptModal';

interface AppDetailPageProps {
  app: WebApp;
  onBack: () => void;
  onToggleStatus: (appId: string) => void;
  onOpenTerminal: (app: WebApp) => void;
  onOpenFiles: (app: WebApp) => void;
  onOpenGit: (app: WebApp) => void;
  onUpdateApp?: (updated: WebApp) => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const AppDetailPage: React.FC<AppDetailPageProps> = ({
  app,
  onBack,
  onToggleStatus,
  onOpenTerminal,
  onOpenFiles,
  onOpenGit,
  onUpdateApp,
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'monitoring' | 'overview' | 'logs' | 'routing' | 'env' | 'php' | 'security'>('monitoring');
  const [logType, setLogType] = useState<'all' | 'access' | 'error' | 'deploy'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [maskSecrets, setMaskSecrets] = useState(true);

  // PHP Extensions & Configuration Studio State
  const [phpExtensions, setPhpExtensions] = useState<Array<{ name: string; category: string; description: string; enabled: boolean; version?: string }>>([
    { name: 'redis', category: 'cache', description: 'In-memory Redis cache client & session handler', enabled: true, version: '6.0.2' },
    { name: 'imagick', category: 'media', description: 'ImageMagick image processing, format conversion & PDF rendering', enabled: true, version: '3.7.0' },
    { name: 'gd', category: 'media', description: 'GD graphics drawing, thumbnail generation & WebP/PNG resizing', enabled: true, version: '2.3.3' },
    { name: 'opcache', category: 'cache', description: 'Zend OPcache bytecode acceleration & JIT compiler engine', enabled: true, version: '8.4.2' },
    { name: 'swoole', category: 'cache', description: 'High-concurrency async coroutine event-driven runtime (Laravel Octane)', enabled: false, version: '5.1.2' },
    { name: 'pdo_mysql', category: 'database', description: 'MySQL 8 & MariaDB PDO relational database driver', enabled: true, version: '8.4.2' },
    { name: 'pdo_pgsql', category: 'database', description: 'PostgreSQL 16 PDO relational database driver', enabled: true, version: '8.4.2' },
    { name: 'pdo_sqlite', category: 'database', description: 'SQLite3 embedded file-based PDO database driver', enabled: true, version: '8.4.2' },
    { name: 'mongodb', category: 'database', description: 'MongoDB official NoSQL BSON client driver', enabled: true, version: '1.18.1' },
    { name: 'bcmath', category: 'core', description: 'Arbitrary precision mathematics for financial decimal calculations', enabled: true, version: '8.4.2' },
    { name: 'zip', category: 'core', description: 'Zip archive compression, packaging & extraction library', enabled: true, version: '1.22.3' },
    { name: 'intl', category: 'core', description: 'Internationalization & ICU Unicode collation formatting', enabled: true, version: '8.4.2' },
    { name: 'xml', category: 'core', description: 'DOM, SimpleXML, and XMLReader parsing engines', enabled: true, version: '8.4.2' },
    { name: 'curl', category: 'core', description: 'libcurl client for external HTTP/REST API outbound requests', enabled: true, version: '8.4.2' },
    { name: 'pcntl', category: 'core', description: 'Process control & signal handling for queue worker supervisors', enabled: true, version: '8.4.2' },
    { name: 'exif', category: 'media', description: 'Exchangeable Image File Format header & metadata reader', enabled: true, version: '8.4.2' },
    { name: 'sodium', category: 'security', description: 'Modern high-security cryptographic functions (libsodium)', enabled: true, version: '8.4.2' },
    { name: 'soap', category: 'core', description: 'Simple Object Access Protocol client and server provider', enabled: false, version: '8.4.2' },
    { name: 'ioncube', category: 'security', description: 'IonCube Loader for executing encoded PHP commercial software', enabled: false, version: '13.0.4' },
  ]);

  const [extensionSearch, setExtensionSearch] = useState('');
  const [extensionFilterCat, setExtensionFilterCat] = useState<string>('all');
  const [customExtensionInput, setCustomExtensionInput] = useState('');
  const [isInstallingExtension, setIsInstallingExtension] = useState(false);

  // Core php.ini directives
  const [memoryLimit, setMemoryLimit] = useState('512M');
  const [uploadMaxFilesize, setUploadMaxFilesize] = useState('100M');
  const [postMaxSize, setPostMaxSize] = useState('100M');
  const [maxExecutionTime, setMaxExecutionTime] = useState('300');
  const [maxInputVars, setMaxInputVars] = useState('5000');
  const [displayErrors, setDisplayErrors] = useState(false);
  const [opcacheEnabled, setOpcacheEnabled] = useState(true);
  const [isReloadingFpm, setIsReloadingFpm] = useState(false);

  // Reverse Proxy Specific Interactive State
  const [currentUpstream, setCurrentUpstream] = useState(app.upstreamUrl || `http://127.0.0.1:${app.port}`);
  const [isPingingUpstream, setIsPingingUpstream] = useState(false);
  const [pingStatus, setPingStatus] = useState<{ ok: boolean; latency: string; code: number } | null>(null);
  const [wsEnabled, setWsEnabled] = useState(app.proxyWebsocket ?? true);
  const [preserveHost, setPreserveHost] = useState(app.proxyPreserveHost ?? true);
  const [realIp, setRealIp] = useState(app.proxyRealIp ?? true);
  const [proxyTimeout, setProxyTimeout] = useState(app.proxyTimeoutSecs ?? 60);
  const [copiedVhost, setCopiedVhost] = useState(false);
  const [routes, setRoutes] = useState<Array<{ path: string; upstream: string; target: string; cache: string; websocket?: boolean }>>([
    { path: '/', upstream: app.upstreamUrl || (app.runtime === 'php' ? 'unix:/run/php/php8.4-fpm.sock' : `http://127.0.0.1:${app.port}`), target: app.runtime === 'proxy' ? 'Primary Upstream Target' : `${app.runtime.toUpperCase()} Primary`, cache: 'Bypass / Realtime', websocket: true },
    { path: '/api/v1/*', upstream: 'http://127.0.0.1:3000', target: 'Node.js (NestJS API)', cache: 'Bypass Cache', websocket: false },
    { path: '/ai-worker/*', upstream: 'http://127.0.0.1:8000', target: 'Python 3.12 (FastAPI ML)', cache: 'Bypass Cache', websocket: false },
    { path: '/assets/*', upstream: 'Direct Sendfile Zero-Copy', target: 'Static Media & Assets', cache: 'Browser Cache 365d', websocket: false },
  ]);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [newRoutePath, setNewRoutePath] = useState('');
  const [newRouteUpstream, setNewRouteUpstream] = useState('');
  const [newRouteTarget, setNewRouteTarget] = useState('');

  // Maintenance Mode & HTTP Basic Auth State
  const [maintenanceMode, setMaintenanceMode] = useState(app.maintenanceMode ?? false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    app.maintenanceMessage || 'Kami sedang melakukan pemeliharaan infrastruktur dan pembaruan sistem secara berkala. Layanan akan segera kembali online.'
  );
  const [maintenanceBypassIps, setMaintenanceBypassIps] = useState(app.maintenanceBypassIps || '127.0.0.1, 103.147.154.82');
  const [isPreviewMaintenanceOpen, setIsPreviewMaintenanceOpen] = useState(false);
  const [isSavingMaintenance, setIsSavingMaintenance] = useState(false);

  const [basicAuthEnabled, setBasicAuthEnabled] = useState(app.basicAuthEnabled ?? false);
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
      'Retensi Metrik Disimpan',
      `Histori telemetri aplikasi ${app.name} disimpan selama ${capped} hari (Batas maksimum 30 hari).`,
      'success'
    );
  };

  const handleToggleMaintenance = () => {
    const nextState = !maintenanceMode;
    setMaintenanceMode(nextState);
    const updated: WebApp = {
      ...app,
      maintenanceMode: nextState,
      maintenanceMessage,
      maintenanceBypassIps,
      basicAuthEnabled,
      basicAuthUser,
      basicAuthPassword,
      basicAuthRealm,
      basicAuthBypassIps,
    };
    onUpdateApp?.(updated);
    onShowToast?.(
      nextState ? 'Maintenance Mode Aktif (503)' : 'Maintenance Mode Dinonaktifkan',
      nextState 
        ? `Pengunjung akan menerima HTTP 503. IP Whitelist [${maintenanceBypassIps || 'None'}] tetap dapat mengakses.`
        : `Aplikasi ${app.name} kini kembali melayani trafik normal secara penuh.`,
      nextState ? 'info' : 'success'
    );
  };

  const handleSaveMaintenanceConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingMaintenance(true);
    setTimeout(() => {
      setIsSavingMaintenance(false);
      const updated: WebApp = {
        ...app,
        maintenanceMode,
        maintenanceMessage,
        maintenanceBypassIps,
        basicAuthEnabled,
        basicAuthUser,
        basicAuthPassword,
        basicAuthRealm,
        basicAuthBypassIps,
      };
      onUpdateApp?.(updated);
      onShowToast?.('Konfigurasi Maintenance Tersimpan', `Template vhost HTTP 503 dan IP bypass diperbarui di ${app.webServer.toUpperCase()}.`, 'success');
    }, 500);
  };

  const handleToggleBasicAuth = () => {
    const nextState = !basicAuthEnabled;
    setBasicAuthEnabled(nextState);
    const updated: WebApp = {
      ...app,
      maintenanceMode,
      maintenanceMessage,
      maintenanceBypassIps,
      basicAuthEnabled: nextState,
      basicAuthUser,
      basicAuthPassword,
      basicAuthRealm,
      basicAuthBypassIps,
    };
    onUpdateApp?.(updated);
    onShowToast?.(
      nextState ? 'HTTP Basic Auth Aktif' : 'HTTP Basic Auth Dinonaktifkan',
      nextState
        ? `Akses ke https://${app.domain} kini diproteksi password (user: ${basicAuthUser}).`
        : `Proteksi password untuk ${app.domain} telah dicabut.`,
      nextState ? 'info' : 'success'
    );
  };

  const handleGeneratePassword = () => {
    const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    let pass = '';
    for (let i = 0; i < 16; i++) {
      pass += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setBasicAuthPassword(pass);
    onShowToast?.('Password Baru Dibuat', 'Kombinasi 16-karakter acak berhasil dibuat.', 'info');
  };

  const handleSaveBasicAuthConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingBasicAuth(true);
    setTimeout(() => {
      setIsSavingBasicAuth(false);
      const updated: WebApp = {
        ...app,
        maintenanceMode,
        maintenanceMessage,
        maintenanceBypassIps,
        basicAuthEnabled,
        basicAuthUser,
        basicAuthPassword,
        basicAuthRealm,
        basicAuthBypassIps,
      };
      onUpdateApp?.(updated);
      onShowToast?.('.htpasswd & VHost Disimpan', `File otentikasi /etc/nginx/.htpasswd_${app.name} berhasil disinkronkan.`, 'success');
    }, 500);
  };

  const handleCopyCurl = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
    onShowToast?.('Perintah Copied', 'cURL command disalin ke clipboard.', 'info');
  };

  const handlePingUpstream = () => {
    setIsPingingUpstream(true);
    setTimeout(() => {
      setIsPingingUpstream(false);
      setPingStatus({
        ok: true,
        latency: (Math.random() * 2 + 1.2).toFixed(1) + 'ms',
        code: 200,
      });
    }, 600);
  };

  const handleAddCustomRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoutePath || !newRouteUpstream) return;
    setRoutes([
      ...routes,
      {
        path: newRoutePath,
        upstream: newRouteUpstream,
        target: newRouteTarget || 'Custom Upstream Route',
        cache: 'Bypass Cache',
        websocket: true,
      }
    ]);
    setNewRoutePath('');
    setNewRouteUpstream('');
    setNewRouteTarget('');
    setShowAddRoute(false);
  };

  const handleToggleExtension = (extName: string) => {
    setPhpExtensions(prev => prev.map(ext => {
      if (ext.name === extName) {
        const nextState = !ext.enabled;
        onShowToast?.(
          nextState ? 'Extension Activated' : 'Extension Deactivated',
          `Executed: ${nextState ? 'phpenmod' : 'phpdismod'} ${ext.name}. Reloading PHP-FPM pool...`,
          'success'
        );
        return { ...ext, enabled: nextState };
      }
      return ext;
    }));
  };

  const handleInstallCustomExtension = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customExtensionInput.trim()) return;
    const name = customExtensionInput.trim().toLowerCase();
    setIsInstallingExtension(true);
    onShowToast?.('PECL Compile Started', `Running: pecl install ${name} && phpenmod ${name}...`, 'info');
    setTimeout(() => {
      setIsInstallingExtension(false);
      setPhpExtensions(prev => [
        { name, category: 'core', description: `Custom PECL extension (${name}) installed & enabled in /etc/php/conf.d`, enabled: true, version: '1.0.0' },
        ...prev
      ]);
      setCustomExtensionInput('');
      onShowToast?.('Extension Installed', `Extension ${name} berhasil dikompilasi & diaktifkan di PHP ${app.version}.`, 'success');
    }, 900);
  };

  const handleSavePhpIni = (e: React.FormEvent) => {
    e.preventDefault();
    setIsReloadingFpm(true);
    setTimeout(() => {
      setIsReloadingFpm(false);
      onShowToast?.('php.ini Tersimpan', `Konfigurasi pool ${app.tenantUser} diterapkan. systemctl reload php-fpm [OK].`, 'success');
    }, 600);
  };

  const handleRestartFpmPool = () => {
    setIsReloadingFpm(true);
    setTimeout(() => {
      setIsReloadingFpm(false);
      onShowToast?.('PHP-FPM Reloaded', `Pool /run/php/php${app.version || '8.4'}-fpm.sock di-restart secara mulus.`, 'success');
    }, 500);
  };

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
              {app.runtime === 'php' ? '🐘' : app.runtime === 'nodejs' ? '⬢' : app.runtime === 'python' ? '🐍' : app.runtime === 'proxy' ? '🔀' : '⚡'}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">{app.name}</h1>
                <span className={`text-xs px-2.5 py-0.5 rounded-md font-bold uppercase tracking-wider font-mono ${
                  app.runtime === 'proxy' ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-slate-100 text-slate-700'
                }`}>
                  {app.runtime === 'proxy' ? 'Reverse Proxy' : `${app.runtime} ${app.version}`}
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
                  title="Klik untuk Toggle HTTP 503 Maintenance Mode"
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
                  title="Klik untuk Toggle HTTP Basic Auth Protection"
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
          onClick={() => setActiveTab('php')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'php'
              ? 'border-purple-600 text-purple-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>PHP & Extensions</span>
          <span className="px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 font-mono text-[10px] font-bold border border-purple-200">
            {app.runtime === 'php' ? `PHP ${app.version}` : 'PHP 8.4'}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'security'
              ? 'border-purple-600 text-purple-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Shield className="w-4 h-4 text-purple-600" />
          <span>Access & Security</span>
          {(maintenanceMode || basicAuthEnabled) && (
            <span className="flex items-center gap-1">
              {maintenanceMode && (
                <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[9px] font-bold">
                  503
                </span>
              )}
              {basicAuthEnabled && (
                <span className="px-1.5 py-0.2 rounded bg-purple-100 text-purple-800 text-[9px] font-bold">
                  Auth
                </span>
              )}
            </span>
          )}
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
            {/* Telemetry Filter Toolbar & App Retention Policy (Max 30 Days) */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Rentang Waktu:</span>
                </span>
                <div className="flex items-center bg-white rounded-lg p-0.5 border border-slate-200 text-xs">
                  {(['1h', '24h', '7d', '14d', '30d'] as const).map(range => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => {
                        setSelectedMetricsRange(range);
                        onShowToast?.('Filter Waktu Diperbarui', `Menampilkan agregasi telemetri ${range === '1h' ? '1 Jam Terakhir' : range === '24h' ? '24 Jam Terakhir' : range === '7d' ? '7 Hari Terakhir' : range === '14d' ? '14 Hari Terakhir' : '30 Hari (Maksimal App)'}.`, 'info');
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                        selectedMetricsRange === range
                          ? 'bg-blue-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {range === '1h' ? '1 Jam' : range === '24h' ? '24 Jam' : range === '7d' ? '7 Hari' : range === '14d' ? '14 Hari' : '30 Hari'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Per-App Retention Selector (Strictly max 30 days) */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
                  Retensi Metrik App:
                </span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={appMetricsRetention}
                    onChange={(e) => handleUpdateAppMetricsRetention(Number(e.target.value))}
                    className="px-2.5 py-1 text-xs font-bold bg-white border border-purple-200 text-purple-900 rounded-lg focus:outline-hidden focus:border-purple-500 shadow-2xs"
                  >
                    <option value={1}>1 Hari (24 Jam)</option>
                    <option value={3}>3 Hari</option>
                    <option value={7}>7 Hari (1 Minggu)</option>
                    <option value={14}>14 Hari (2 Minggu)</option>
                    <option value={30}>30 Hari (Batas Maksimum Panel)</option>
                  </select>
                  <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-lg border border-purple-200" title="Batas retensi metrik per-aplikasi di BarePod Panel adalah maksimal 30 hari untuk efisiensi ruang disk tenant.">
                    Max 30 Hari
                  </span>
                </div>
              </div>
            </div>

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
                    ? `Domain ${app.domain} meneruskan seluruh traffic HTTP/WebSocket secara aman ke upstream backend internal.` 
                    : `Arsitektur hybrid memungkinkan satu domain membagi traffic ke beberapa runtime (PHP-FPM, Node.js, Python, & Static).`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddRoute(!showAddRoute)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm shadow-blue-500/25"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Path Route</span>
                </button>
              </div>
            </div>

            {/* Primary Upstream Target Card (Especially prominent for Proxy Apps) */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                    <ArrowRightLeft className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Target Upstream Destination (Port / Socket / IP)</h4>
                    <p className="text-[11px] text-slate-500">Service internal yang menerima forward traffic dari {app.domain}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePingUpstream}
                    disabled={isPingingUpstream}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isPingingUpstream ? 'animate-spin' : ''}`} />
                    <span>{isPingingUpstream ? 'Pinging...' : 'Ping Test Upstream'}</span>
                  </button>

                  {pingStatus && (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{pingStatus.code} OK ({pingStatus.latency})</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Upstream URL / IP Address
                  </label>
                  <input
                    type="text"
                    value={currentUpstream}
                    onChange={(e) => setCurrentUpstream(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono text-purple-900 font-bold focus:bg-white focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Timeout Koneksi & Stream
                  </label>
                  <select
                    value={proxyTimeout}
                    onChange={(e) => setProxyTimeout(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:border-purple-500"
                  >
                    <option value={60}>60 Detik (Standar Web)</option>
                    <option value={180}>180 Detik (Long-Polling)</option>
                    <option value={300}>300 Detik (Streaming LLM / AI)</option>
                    <option value={600}>600 Detik (Heavy Export/Upload)</option>
                  </select>
                </div>
              </div>

              {/* Ingress Protocol Feature Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
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
                    <span className="text-[10px] text-slate-500 block">Teruskan domain asli ke service</span>
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

            {/* Add Custom Location Route Form (Toggleable) */}
            {showAddRoute && (
              <form onSubmit={handleAddCustomRoute} className="p-4 bg-blue-50/50 border border-blue-200 rounded-2xl space-y-3 animate-in fade-in duration-150">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-blue-900">Tambah Route Split / Forward Baru</h4>
                  <button
                    type="button"
                    onClick={() => setShowAddRoute(false)}
                    className="text-xs text-blue-600 hover:underline"
                  >
                    Batal
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Location Path URL Prefix
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="/api/v2/* atau /webhook/*"
                      value={newRoutePath}
                      onChange={(e) => setNewRoutePath(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Upstream Destination
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="http://127.0.0.1:4000"
                      value={newRouteUpstream}
                      onChange={(e) => setNewRouteUpstream(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-700 mb-1">
                      Keterangan Service
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="e.g. Express Microservice"
                        value={newRouteTarget}
                        onChange={(e) => setNewRouteTarget(e.target.value)}
                        className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg"
                      />
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                      >
                        Simpan
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Mapped Routes Table */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">LOCATION PATH</th>
                    <th className="py-3 px-4">UPSTREAM DESTINATION</th>
                    <th className="py-3 px-4">SERVICE / RUNTIME</th>
                    <th className="py-3 px-4">CACHE STRATEGY</th>
                    <th className="py-3 px-4">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routes.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4 font-bold text-blue-600">{r.path}</td>
                      <td className="py-3 px-4 text-purple-900 font-bold">{r.path === '/' ? currentUpstream : r.upstream}</td>
                      <td className="py-3 px-4 text-slate-800 font-sans">{r.target}</td>
                      <td className="py-3 px-4 text-slate-500">{r.cache}</td>
                      <td className="py-3 px-4 text-emerald-600 font-bold">Active</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Generated VHost Config Code Inspector */}
            <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden shadow-2xs">
              <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-300 text-xs font-mono">
                  <Code2 className="w-4 h-4 text-purple-400" />
                  <span>Real-Time {app.webServer.toUpperCase()} Reverse Proxy VirtualHost Config</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const snippet = `# Generated by BarePod Panel Daemon
server {
    listen 80;
    listen 443 ssl http2;
    server_name ${app.domain};

    ssl_certificate /etc/letsencrypt/live/${app.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${app.domain}/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass ${currentUpstream};
        proxy_http_version 1.1;
${wsEnabled ? `        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";\n` : ''}${preserveHost ? `        proxy_set_header Host $host;\n` : ''}${realIp ? `        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;\n` : ''}        proxy_read_timeout ${proxyTimeout}s;
    }
}`;
                    navigator.clipboard.writeText(snippet);
                    setCopiedVhost(true);
                    setTimeout(() => setCopiedVhost(false), 2000);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg text-slate-300 hover:bg-slate-800 transition-colors"
                >
                  {copiedVhost ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedVhost ? 'Tersalin' : 'Salin Konfigurasi'}</span>
                </button>
              </div>

              <pre className="p-4 text-xs font-mono text-purple-300 overflow-x-auto leading-relaxed max-h-56">
{`# Generated by BarePod Panel Daemon (${app.webServer.toUpperCase()})
server {
    listen 80;
    listen 443 ssl http2;
    server_name ${app.domain};

    ssl_certificate /etc/letsencrypt/live/${app.domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${app.domain}/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass ${currentUpstream};
        proxy_http_version 1.1;
${wsEnabled ? `        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";\n` : ''}${preserveHost ? `        proxy_set_header Host $host;\n` : ''}${realIp ? `        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;\n` : ''}        proxy_read_timeout ${proxyTimeout}s;
    }

${routes.filter(r => r.path !== '/').map(r => `    location ${r.path} {
        proxy_pass ${r.upstream};
        proxy_set_header Host $host;
    }`).join('\n\n')}
}`}
              </pre>
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

        {/* TAB: PHP EXTENSIONS & CONFIGURATION STUDIO */}
        {activeTab === 'php' && (
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* PHP-FPM Pool Info & Quick Actions */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-purple-50/70 border border-purple-200">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-purple-600" />
                    PHP FastCGI Process Manager (PHP-FPM {app.runtime === 'php' ? app.version : '8.4'})
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    ACTIVE POOL
                  </span>
                </div>
                <p className="text-xs text-purple-800 font-mono">
                  Socket: <strong>/run/php/php{app.runtime === 'php' ? app.version : '8.4'}-fpm.sock</strong> • User: <strong>{app.tenantUser}</strong> • OPcache JIT: <strong>Enabled (128M)</strong>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestartFpmPool}
                  disabled={isReloadingFpm}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-white hover:bg-purple-100 border border-purple-300 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isReloadingFpm ? 'animate-spin text-purple-600' : ''}`} />
                  <span>{isReloadingFpm ? 'Reloading...' : 'Reload PHP-FPM Pool'}</span>
                </button>
              </div>
            </div>

            {/* Quick Stats: Loaded Extensions Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Loaded Extensions</span>
                <div className="text-xl font-bold text-purple-700">
                  {phpExtensions.filter(e => e.enabled).length} <span className="text-xs font-normal text-slate-500">/ {phpExtensions.length} Available</span>
                </div>
                <span className="text-[10px] text-slate-500">Managed via phpenmod/phpdismod</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Database Drivers</span>
                <div className="text-xl font-bold text-slate-900">
                  PDO MySQL, PgSQL, Mongo
                </div>
                <span className="text-[10px] text-emerald-600 font-medium">Ready for Eloquent & Doctrine</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Cache & Acceleration</span>
                <div className="text-xl font-bold text-slate-900">
                  Redis 6.0 + OPcache
                </div>
                <span className="text-[10px] text-purple-600 font-medium">Laravel Octane / Swoole Ready</span>
              </div>

              <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <span className="text-[10px] uppercase font-bold text-slate-400">Memory Quota</span>
                <div className="text-xl font-bold text-slate-900">
                  {memoryLimit}
                </div>
                <span className="text-[10px] text-slate-500">max_execution_time: {maxExecutionTime}s</span>
              </div>
            </div>

            {/* Extensions Filter & Search + Install PECL form */}
            <div className="space-y-4 pt-2">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Cari extension (e.g. redis, imagick, swoole)..."
                      value={extensionSearch}
                      onChange={(e) => setExtensionSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg w-64 focus:outline-hidden focus:ring-2 focus:ring-purple-500/20"
                    />
                  </div>

                  <div className="flex items-center gap-1 text-xs">
                    {['all', 'database', 'cache', 'media', 'core', 'security'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setExtensionFilterCat(cat)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-colors ${
                          extensionFilterCat === cat
                            ? 'bg-purple-600 text-white shadow-2xs'
                            : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inline PECL Installer Form */}
                <form onSubmit={handleInstallCustomExtension} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    placeholder="Nama extension PECL (e.g. grpc)..."
                    value={customExtensionInput}
                    onChange={(e) => setCustomExtensionInput(e.target.value)}
                    className="px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500/20"
                  />
                  <button
                    type="submit"
                    disabled={isInstallingExtension || !customExtensionInput.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isInstallingExtension ? 'Installing...' : 'Install PECL'}</span>
                  </button>
                </form>
              </div>

              {/* Extensions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {phpExtensions
                  .filter(ext => {
                    const matchesCat = extensionFilterCat === 'all' || ext.category === extensionFilterCat;
                    const matchesSearch = ext.name.toLowerCase().includes(extensionSearch.toLowerCase()) || 
                                          ext.description.toLowerCase().includes(extensionSearch.toLowerCase());
                    return matchesCat && matchesSearch;
                  })
                  .map((ext) => (
                    <div 
                      key={ext.name}
                      className={`p-3.5 rounded-xl border transition-all ${
                        ext.enabled 
                          ? 'border-purple-200 bg-white shadow-2xs' 
                          : 'border-slate-200 bg-slate-50/60 opacity-80'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-xs text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                              {ext.name}
                            </span>
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 border border-purple-200">
                              {ext.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1 leading-snug line-clamp-2">
                            {ext.description}
                          </p>
                        </div>

                        {/* Interactive Toggle Button */}
                        <button
                          type="button"
                          onClick={() => handleToggleExtension(ext.name)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                            ext.enabled ? 'bg-purple-600' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              ext.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>Config: 20-{ext.name}.ini</span>
                        <span className={`font-bold ${ext.enabled ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {ext.enabled ? 'LOADED' : 'DISABLED'}
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Core php.ini Directives Form */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-purple-600" />
                    Core php.ini Runtime Directives
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Modifikasi parameter runtime PHP-FPM khusus untuk tenant <code>{app.tenantUser}</code> tanpa mempengaruhi website lain.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSavePhpIni}
                  disabled={isReloadingFpm}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isReloadingFpm ? 'Menyimpan...' : 'Simpan & Terapkan php.ini'}</span>
                </button>
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
                    <option value="30">30 detik</option>
                    <option value="60">60 detik</option>
                    <option value="120">120 detik</option>
                    <option value="300">300 detik (5 menit)</option>
                    <option value="600">600 detik (10 menit)</option>
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
                    <option value="5000">5000 (WooCommerce / Large Forms)</option>
                    <option value="10000">10000</option>
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

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    opcache.enable
                  </label>
                  <select
                    value={opcacheEnabled ? '1' : '0'}
                    onChange={(e) => setOpcacheEnabled(e.target.value === '1')}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:bg-white"
                  >
                    <option value="1">1 (Enabled - Maximum Speed)</option>
                    <option value="0">0 (Disabled)</option>
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <div className="text-[11px] text-slate-500 font-mono bg-slate-50 p-2 rounded-lg border border-slate-200">
                    CLI Equivalent:
                    <div className="text-purple-700 font-bold mt-0.5">php -i | grep memory_limit</div>
                  </div>
                </div>
              </div>
            </div>
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
                    Diterapkan langsung pada layer web server ({app.webServer.toUpperCase()}) tanpa membebani runtime {app.runtime.toUpperCase()}.
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
                          Alihkan pengunjung ke layar downtime pemeliharaan berkala
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
                          <strong>Mode Pemeliharaan Sedang Aktif!</strong>
                          <p className="mt-0.5 text-[11px] text-amber-800">
                            Pengunjung umum menerima HTTP 503 Service Unavailable. IP terdaftar di Whitelist tetap memiliki akses penuh ke aplikasi.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px]">
                        Website sedang beroperasi normal. Aktifkan toggle di atas jika Anda ingin melakukan migrasi database, upgrade framework, atau maintenance darurat.
                      </p>
                    )}
                  </div>

                  <form onSubmit={handleSaveMaintenanceConfig} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Pesan Pemeliharaan Kustom (Ditampilkan ke Pengunjung)
                      </label>
                      <textarea
                        rows={3}
                        value={maintenanceMessage}
                        onChange={(e) => setMaintenanceMessage(e.target.value)}
                        placeholder="Tulis pesan alasan maintenance untuk pengunjung..."
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-amber-500 focus:outline-hidden resize-none font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        IP Whitelist Bypass (Developer / Admin)
                      </label>
                      <input
                        type="text"
                        value={maintenanceBypassIps}
                        onChange={(e) => setMaintenanceBypassIps(e.target.value)}
                        placeholder="Contoh: 127.0.0.1, 103.147.154.82, 192.168.1.100"
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:border-amber-500 focus:outline-hidden"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Pisahkan dengan koma. IP di atas tidak akan terkena HTTP 503 sehingga Anda tetap bisa testing.
                      </p>
                    </div>

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setIsPreviewMaintenanceOpen(true)}
                        className="px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-colors flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-amber-600" />
                        <span>Preview Halaman 503</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSavingMaintenance}
                        className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors shadow-2xs"
                      >
                        {isSavingMaintenance ? 'Menerapkan...' : 'Simpan Pengaturan 503'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* CARD 2: HTTP BASIC AUTHENTICATION */}
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
                          Wajibkan kredensial login via dialog bawaan browser (.htpasswd)
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
                          <strong>Proteksi Password Aktif</strong>
                          <p className="mt-0.5 text-[11px] text-purple-800">
                            Setiap request ke <code className="font-mono">{app.domain}</code> akan ditantang dengan HTTP 401 Unauthorized sampai pengunjung memasukkan user & password yang sesuai.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px]">
                        Akses publik terbuka tanpa password. Sangat cocok diaktifkan untuk situs staging, API internal, atau dashboard sebelum rilis publik.
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
                            ⚡ Generate
                          </button>
                        </div>
                        <div className="relative">
                          <input
                            type={showBasicAuthPassword ? 'text' : 'password'}
                            required
                            value={basicAuthPassword}
                            onChange={(e) => setBasicAuthPassword(e.target.value)}
                            placeholder="Ketik password"
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
                        Realm Title (Pesan Dialog Browser)
                      </label>
                      <input
                        type="text"
                        value={basicAuthRealm}
                        onChange={(e) => setBasicAuthRealm(e.target.value)}
                        placeholder="Contoh: Protected Staging Area"
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

                    <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setIsTestBasicAuthOpen(true)}
                        className="px-3 py-2 text-xs font-bold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl transition-colors flex items-center gap-1.5"
                      >
                        <Key className="w-3.5 h-3.5 text-purple-600" />
                        <span>Uji Prompt Dialog (Simulator)</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSavingBasicAuth}
                        className="px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all shadow-sm shadow-purple-500/25"
                      >
                        {isSavingBasicAuth ? 'Menyimpan...' : 'Simpan .htpasswd'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>

            </div>

            {/* CARD 3: GENERATED VHOST DIRECTIVES INSPECTOR */}
            <div className="p-5 bg-slate-900 rounded-2xl text-slate-100 space-y-3 border border-slate-800 shadow-md">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-bold font-mono text-slate-200">
                    Auto-Generated VHost Rules ({app.webServer.toUpperCase()})
                  </span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">
                  /etc/{app.webServer}/conf.d/{app.domain}.conf
                </span>
              </div>

              <pre className="font-mono text-xs bg-slate-950 p-4 rounded-xl overflow-x-auto text-emerald-400 leading-relaxed border border-slate-800">
{app.webServer === 'caddy' ? (
`# --- BarePod Panel Edge Access Directives ---
${maintenanceMode ? `# Maintenance 503 Active
@maintenance not remote_ip ${maintenanceBypassIps.replace(/,/g, '') || '127.0.0.1'}
respond @maintenance 503 {
    body "<h1>503 Service Unavailable</h1><p>${maintenanceMessage}</p>"
}
` : '# Maintenance Mode: OFF'}
${basicAuthEnabled ? `# HTTP Basic Authentication Active
basicauth {
    ${basicAuthUser} $2a$14$JkE0... (bcrypt hash of password)
}
` : '# HTTP Basic Auth: OFF'}`
) : (
`# --- BarePod Panel Edge Access Directives ---
${maintenanceMode ? `# Maintenance 503 Active
error_page 503 @maintenance_page;
if ($remote_addr !~ "^(${maintenanceBypassIps.replace(/\s+/g, '').replace(/,/g, '|') || '127.0.0.1'})$") {
    return 503;
}
location @maintenance_page {
    default_type text/html;
    return 503 '<html><body><h2>Under Maintenance</h2><p>${maintenanceMessage}</p></body></html>';
}
` : '# Maintenance Mode: OFF'}
${basicAuthEnabled ? `# HTTP Basic Authentication Active
auth_basic "${basicAuthRealm}";
auth_basic_user_file /etc/nginx/.htpasswd_${app.name};
` : '# HTTP Basic Auth: OFF'}`
)}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 6: OVERVIEW & SERVER RUNTIME */}
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

    </div>
  );
};

