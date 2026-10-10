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
  RefreshCw,
  Save,
  Radio,
  Sparkles,
  Sun,
  Moon,
  MapPin,
  ChevronDown,
  ChevronRight,
  Archive
} from 'lucide-react';
import type { WebApp, WebServerType } from '../types';
import { MASTER_PHP_EXTENSIONS, type PhpExtensionItem } from '../data/defaultPhpExtensions';
import { WORLD_MAP_PATH } from '../data/worldMapPath';
import { MaintenancePreviewModal } from './MaintenancePreviewModal';
import { BasicAuthPromptModal } from './BasicAuthPromptModal';

export type AppDetailTab = 'monitoring' | 'overview' | 'logs' | 'routing' | 'env' | 'php' | 'security' | 'deploy';

interface AppDetailPageProps {
  app: WebApp;
  onBack: () => void;
  onToggleStatus: (appId: string) => void;
  onOpenTerminal: (app: WebApp) => void;
  onOpenFiles: (app: WebApp) => void;
  onOpenGit: (app: WebApp) => void;
  onUpdateApp?: (updated: WebApp) => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  activeTab?: AppDetailTab;
  onTabChange?: (tab: AppDetailTab) => void;
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
  activeTab: activeTabProp,
  onTabChange,
}) => {
  const [internalTab, setInternalTab] = useState<AppDetailTab>('monitoring');
  const activeTab: AppDetailTab = activeTabProp ?? internalTab;
  const setActiveTab = (tab: AppDetailTab) => {
    setInternalTab(tab);
    onTabChange?.(tab);
  };
  const [logType, setLogType] = useState<'all' | 'access' | 'error' | 'deploy'>('all');
  const [logSearch, setLogSearch] = useState('');
  const [logFormat, setLogFormat] = useState<'structured' | 'raw'>('structured');
  const [logTheme, setLogTheme] = useState<'light' | 'dark'>('light'); // Default to light mode as requested!
  const [wrapLogText, setWrapLogText] = useState(false);
  const [expandedLogIdx, setExpandedLogIdx] = useState<number | null>(null);
  const [showWorldMap, setShowWorldMap] = useState(true);
  const [selectedCountryFilter, setSelectedCountryFilter] = useState<string | null>(null);
  const [hoveredMapPin, setHoveredMapPin] = useState<{ country: string; name: string; flag: string; city: string; ip: string; reqs: number; latency: string; isp: string; x: number; y: number } | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const [maskSecrets, setMaskSecrets] = useState(true);
  const [isExportingBackup, setIsExportingBackup] = useState(false);

  const handleExportAppBackup = () => {
    setIsExportingBackup(true);
    onShowToast?.('Mengemas Snapshot App...', `Mengemas codebase ${app.name}, .env, dan vhost config...`, 'info');
    setTimeout(() => {
      const bundleData = {
        format: 'BarePod-Application-Bundle',
        version: '2.4',
        app: {
          name: app.name,
          domain: app.domain,
          runtime: app.runtime,
          version: app.version,
          framework: app.framework,
          webServer: app.webServer,
          tenantUser: app.tenantUser,
          port: app.port,
        },
        env: `APP_NAME=${app.name}\nAPP_ENV=production\nAPP_URL=https://${app.domain}\n`,
        vhostConfig: getReverseProxyConfigSnippet(),
        createdAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(bundleData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `barepod-${app.name}-${new Date().toISOString().slice(0, 10)}.bpod`;
      a.click();
      URL.revokeObjectURL(url);
      setIsExportingBackup(false);
      onShowToast?.('Backup Berhasil Diunduh', `Bundle barepod-${app.name}.bpod siap untuk migrasi antar server.`, 'success');
    }, 1200);
  };

  // Persistent Deploy & Build Script per App
  const getDefaultBuildScript = (runtime?: string) => {
    if (runtime === 'php') {
      return `git pull origin main
composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
systemctl reload php8.4-fpm`;
    } else if (runtime === 'python') {
      return `git pull origin main
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart gunicorn`;
    } else if (runtime === 'nodejs') {
      return `git pull origin main
pnpm install --frozen-lockfile
pnpm run build
pm2 reload app --update-env`;
    }
    return `git pull origin main
npm install
npm run build`;
  };

  const [gitRepo, setGitRepo] = useState(app.gitRepo || `https://github.com/${app.tenantUser}/${app.name}`);
  const [gitBranch, setGitBranch] = useState(app.gitBranch || 'main');
  const [autoDeploy, setAutoDeploy] = useState(app.autoDeploy !== false);
  const [buildScript, setBuildScript] = useState(app.buildScript || getDefaultBuildScript(app.runtime));
  const [isSavingDeployScript, setIsSavingDeployScript] = useState(false);
  const [isDeployingNow, setIsDeployingNow] = useState(false);
  const [copiedDeployWebhook, setCopiedDeployWebhook] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([
    `[SYSTEM] Deployment terakhir: ${app.lastDeployedAt || '2026-10-10 18:34:12'} (Commit: ${app.lastDeployCommit || '7fa901a'})`,
    `[SYSTEM] Webhook listener aktif pada https://${app.domain}/api/v1/webhook/${app.id}/deploy`,
    `[SYSTEM] Skrip build disimpan permanen per-aplikasi dan siap dieksekusi saat auto-redeploy.`,
  ]);

  useEffect(() => {
    if (app.gitRepo) setGitRepo(app.gitRepo);
    if (app.gitBranch) setGitBranch(app.gitBranch);
    if (app.autoDeploy !== undefined) setAutoDeploy(app.autoDeploy);
    if (app.buildScript) setBuildScript(app.buildScript);
  }, [app]);

  // PHP Extensions & Configuration Studio State (Pre-loaded with Master Extensions Catalog)
  const [phpExtensions, setPhpExtensions] = useState<PhpExtensionItem[]>(MASTER_PHP_EXTENSIONS);

  const [extensionSearch, setExtensionSearch] = useState('');
  const [extensionFilterCat, setExtensionFilterCat] = useState<string>('all');
  const [customExtensionInput, setCustomExtensionInput] = useState('');
  const [isInstallingExtension, setIsInstallingExtension] = useState(false);
  const [showCustomPeclForm, setShowCustomPeclForm] = useState(false);

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

  const handleToggleAntiBruteforce = () => {
    const nextState = !antiBruteforce;
    setAntiBruteforce(nextState);
    onUpdateApp?.({
      ...app,
      antiBruteforce: nextState,
      antiBruteforceMaxAttempts,
      antiBruteforceBanMinutes,
    });
    onShowToast?.(
      nextState ? 'Anti-Brute Force Enabled' : 'Anti-Brute Force Disabled',
      nextState
        ? `Failed-login throttling active: max ${antiBruteforceMaxAttempts} attempts, ${antiBruteforceBanMinutes}-min IP ban.`
        : `Login rate limiting disabled for ${app.domain}.`,
      nextState ? 'success' : 'info'
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

  const handleCopyDeployWebhook = () => {
    const url = `https://${app.domain}/api/v1/webhook/${app.id}/deploy?token=bp_wh_${app.tenantUser}_99a`;
    navigator.clipboard.writeText(url);
    setCopiedDeployWebhook(true);
    setTimeout(() => setCopiedDeployWebhook(false), 2000);
    onShowToast?.('Webhook Disalin', 'GitHub webhook URL telah disalin ke clipboard.', 'info');
  };

  const handleApplyPresetInDetail = (preset: 'laravel' | 'nextjs' | 'fastapi' | 'go' | 'static') => {
    const targetBranch = gitBranch || 'main';
    let script = '';
    if (preset === 'laravel') {
      script = `git pull origin ${targetBranch}
composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm`;
    } else if (preset === 'nextjs') {
      script = `git pull origin ${targetBranch}
pnpm install --frozen-lockfile
pnpm run build
pm2 reload ${app.name} --update-env`;
    } else if (preset === 'fastapi') {
      script = `git pull origin ${targetBranch}
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl reload gunicorn-${app.name}`;
    } else if (preset === 'go') {
      script = `git pull origin ${targetBranch}
go build -o bin/server main.go
systemctl reload ${app.name}`;
    } else if (preset === 'static') {
      script = `git pull origin ${targetBranch}`;
    }
    setBuildScript(script);
    onShowToast?.('Preset Diterapkan', `Template script ${preset.toUpperCase()} dimuat ke editor. Klik "Simpan Script" agar permanen.`, 'info');
  };

  const handleSaveDeployScript = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingDeployScript(true);
    setTimeout(() => {
      setIsSavingDeployScript(false);
      const updated: WebApp = {
        ...app,
        gitRepo,
        gitBranch,
        autoDeploy,
        buildScript,
      };
      onUpdateApp?.(updated);
      onShowToast?.('Build Script Tersimpan', `Deploy & Build Script untuk '${app.name}' telah disimpan secara permanen. Saat auto-redeploy terpicu, skrip ini yang akan dijalankan.`, 'success');
    }, 400);
  };

  const handleTriggerDirectDeploy = () => {
    setIsDeployingNow(true);
    const nowStr = new Date().toLocaleTimeString();
    setDeployLogs([
      `[${nowStr}] ⚡ Redeploy dipicu untuk '${app.name}'`,
      `[${nowStr}] 📦 Fetching repo ${gitRepo} (branch: ${gitBranch})...`,
      `[${nowStr}] 🔒 Validasi isolasi tenant cgroup v2 /home/${app.tenantUser}...`,
    ]);

    const updated: WebApp = {
      ...app,
      gitRepo,
      gitBranch,
      autoDeploy,
      buildScript,
      lastDeployedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
      lastDeployCommit: '8d2a10c',
    };
    onUpdateApp?.(updated);

    setTimeout(() => {
      setDeployLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🛠️ Menjalankan build script tersimpan:`,
        ...buildScript.split('\n').filter(Boolean).map(l => `    $ ${l}`),
      ]);
    }, 1000);

    setTimeout(() => {
      setDeployLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🚀 Swap zero-downtime release symlink selesai.`,
        `[${new Date().toLocaleTimeString()}] 🌐 Ingress Cloudflare status: 200 OK (${app.domain})`,
        `[${new Date().toLocaleTimeString()}] ✅ Deployment Berhasil dalam 3.4s!`,
      ]);
      setIsDeployingNow(false);
      onShowToast?.('Redeploy Berhasil', `Build & deploy selesai tanpa downtime.`, 'success');
    }, 2400);
  };

  const handleAddCustomRoute = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoutePath || !newRouteUpstream) return;
    const cleanPath = newRoutePath.startsWith('/') ? newRoutePath : `/${newRoutePath}`;
    setRoutes([
      ...routes,
      {
        path: cleanPath,
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
    onShowToast?.('Route Ditambahkan', `Route ${cleanPath} -> ${newRouteUpstream} berhasil ditambahkan ke routing table.`, 'success');
  };

  const handleDeleteRoute = (pathToDelete: string) => {
    if (pathToDelete === '/') {
      onShowToast?.('Route Utama', 'Route root (/) merupakan gateway utama dan tidak dapat dihapus.', 'info');
      return;
    }
    setRoutes(prev => prev.filter(r => r.path !== pathToDelete));
    onShowToast?.('Route Dihapus', `Route ${pathToDelete} berhasil dihapus dari routing table.`, 'success');
  };

  const getReverseProxyConfigSnippet = () => {
    const dName = app.domain;
    const upTarget = currentUpstream || 'http://127.0.0.1:8080';
    const cleanUpstream = (url: string) => url.replace(/^https?:\/\//, '');
    const cleanPath = (p: string) => p.replace(/\*$/, '');
    const upTargetClean = cleanUpstream(upTarget);
    const ws = app.webServer;
    const customRoutes = routes.filter(r => r.path !== '/');

    if (ws === 'openlitespeed') {
      const extProcessors = [
        `extprocessor upstream_root {
    type                    proxy
    address                 ${upTargetClean}
    maxConns                200
    initTimeout             ${proxyTimeout}
    retryTimeout            0
    respBuffer              0
}`
      ];

      const contexts = [
        `context / {
    type                    proxy
    handler                 upstream_root
    addDefaultCharset       off
}`
      ];

      customRoutes.forEach((r, idx) => {
        const handlerName = `upstream_route_${idx + 1}`;
        const cleanUp = cleanUpstream(r.upstream);
        const ctxPath = cleanPath(r.path);
        if (!r.upstream.startsWith('Direct')) {
          extProcessors.push(`extprocessor ${handlerName} {
    type                    proxy
    address                 ${cleanUp}
    maxConns                100
    initTimeout             ${proxyTimeout}
    retryTimeout            0
    respBuffer              0
}`);
          contexts.push(`context ${ctxPath} {
    type                    proxy
    handler                 ${handlerName}
    addDefaultCharset       off
}`);
        } else {
          contexts.push(`context ${ctxPath} {
    type                    static
    expiresByType           image/*=A31536000, text/css=A31536000, application/javascript=A31536000
}`);
        }
      });

      return `# ==============================================================================
# OpenLiteSpeed VirtualHost Reverse Proxy Configuration
# Domain: ${dName} | Generated by BarePod Panel Daemon
# ==============================================================================
docRoot                   $VH_ROOT/public_html
vhDomain                  ${dName}
adminEmails               admin@${dName}
enableGzip                1

# Upstream Backend Processors (External Processors)
${extProcessors.join('\n\n')}

# Path Context Routing
${contexts.join('\n\n')}

# WebSocket Upgrade & Header Forwarding
rewrite  {
    enable                1
    autoLoadHtaccess      1
${wsEnabled ? '    # WebSocket Upgrade Support\n    RewriteCond %{HTTP:UPGRADE} ^WebSocket$ [NC]\n    RewriteRule ^/(.*) WS://upstream_root/$1 [P,L]\n' : ''}${preserveHost ? `    # Preserve Host Header\n    RewriteRule ^/(.*) HTTP://upstream_root/$1 [P,E=Proxy-Host:${dName},L]\n` : '    RewriteRule ^/(.*) HTTP://upstream_root/$1 [P,L]\n'}}`;
    }

    if (ws === 'caddy') {
      return `# ==============================================================================
# Caddyfile Reverse Proxy Configuration
# Domain: ${dName} | Generated by BarePod Panel Daemon
# ==============================================================================
${dName} {
    tls {
        issuer lets_encrypt
    }
    encode zstd gzip

${customRoutes.map(r => `    # Route: ${r.path} -> ${r.target}
    handle ${r.path} {
        ${r.upstream.startsWith('Direct') ? 'file_server' : `reverse_proxy ${cleanUpstream(r.upstream)}`}
    }`).join('\n\n')}

    # Default Root Reverse Proxy
    handle {
        reverse_proxy ${upTargetClean} {
${preserveHost ? '            header_up Host {host}\n' : ''}${realIp ? '            header_up X-Real-IP {remote_host}\n            header_up X-Forwarded-For {remote_host}\n            header_up X-Forwarded-Proto {scheme}\n' : ''}        }
    }
}`;
    }

    if (ws === 'apache') {
      return `# ==============================================================================
# Apache 2.4 VirtualHost Reverse Proxy Configuration
# Domain: ${dName} | Generated by BarePod Panel Daemon
# ==============================================================================
<VirtualHost *:80 *:443>
    ServerName ${dName}
    ProxyPreserveHost ${preserveHost ? 'On' : 'Off'}
    ProxyRequests Off
    Timeout ${proxyTimeout}

${customRoutes.filter(r => !r.upstream.startsWith('Direct')).map(r => `    <Location ${cleanPath(r.path)}>
        ProxyPass ${r.upstream.startsWith('http') ? r.upstream : `http://${r.upstream}`}/
        ProxyPassReverse ${r.upstream.startsWith('http') ? r.upstream : `http://${r.upstream}`}/
    </Location>`).join('\n\n')}

    <Location />
        ${wsEnabled ? `RewriteEngine on
        RewriteCond %{HTTP:Upgrade} websocket [NC]
        RewriteCond %{HTTP:Connection} upgrade [NC]
        RewriteRule .* "ws://${upTargetClean}%{REQUEST_URI}" [P,L]\n` : ''}
        ProxyPass ${upTarget}/
        ProxyPassReverse ${upTarget}/
    </Location>
</VirtualHost>`;
    }

    // Default Nginx
    return `# ==============================================================================
# Nginx Reverse Proxy Configuration
# Domain: ${dName} | Generated by BarePod Panel Daemon
# ==============================================================================
server {
    listen 80;
    listen 443 ssl http2;
    server_name ${dName};

    ssl_certificate /etc/letsencrypt/live/${dName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${dName}/privkey.pem;

    client_max_body_size 100M;

    location / {
        proxy_pass ${upTarget};
        proxy_http_version 1.1;
${wsEnabled ? '        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n' : ''}${preserveHost ? '        proxy_set_header Host $host;\n' : ''}${realIp ? '        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n' : ''}        proxy_read_timeout ${proxyTimeout}s;
    }

${customRoutes.map(r => `    location ${cleanPath(r.path)} {
        ${r.upstream.startsWith('Direct') ? 'root /var/www/static;\n        expires 365d;' : `proxy_pass ${r.upstream};\n        proxy_set_header Host $host;`}
    }`).join('\n\n')}
}`;
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

  const handleResetToAdminDefault = () => {
    setPhpExtensions(MASTER_PHP_EXTENSIONS);
    onShowToast?.(
      'Reset ke Blueprint Admin',
      'Konfigurasi extension aplikasi ini dikembalikan ke default global admin. Pool PHP-FPM di-reload.',
      'info'
    );
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

  // Realistic Logs Generator with Visitor Client IP
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

  const getMockLogs = (): LogItem[] => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const dateFormatted = `${pad(now.getDate())}/Oct/${now.getFullYear()}:${timeStr} +0700`;

    const commonLogs: LogItem[] = [
      { 
        time: timeStr, 
        type: 'access', 
        ip: '114.124.180.52', 
        country: 'ID', 
        isp: 'Telkomsel',
        method: 'GET', 
        path: '/', 
        status: 200, 
        latency: '14ms', 
        size: '2.4 KB',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0',
        msg: 'GET / 200 OK - 14ms (Chrome/128 MacOS)',
        rawLine: `114.124.180.52 - - [${dateFormatted}] "GET / HTTP/2.0" 200 2410 "https://${app.domain}/" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0" (CF-Ray: 8d2b91f-CGK, Latency: 14ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '114.124.180.52', 
        country: 'ID', 
        isp: 'Telkomsel',
        method: 'GET', 
        path: '/assets/app.css', 
        status: 304, 
        latency: '2ms', 
        size: '0 B',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0',
        msg: 'GET /assets/app.css 304 Not Modified - 2ms',
        rawLine: `114.124.180.52 - - [${dateFormatted}] "GET /assets/app.css HTTP/2.0" 304 0 "https://${app.domain}/" "Mozilla/5.0 Chrome/128.0" (CF-Ray: 8d2b921-CGK, Latency: 2ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '180.252.164.22', 
        country: 'ID', 
        isp: 'Biznet Surabaya',
        method: 'POST', 
        path: '/api/v1/telemetry', 
        status: 201, 
        latency: '22ms', 
        size: '340 B',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6) Mobile/15E148',
        msg: 'POST /api/v1/telemetry 201 Created - 22ms',
        rawLine: `180.252.164.22 - - [${dateFormatted}] "POST /api/v1/telemetry HTTP/2.0" 201 340 "https://${app.domain}/cart" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6)" (CF-Ray: 8d2b924-SUB, Latency: 22ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '36.72.215.19', 
        country: 'ID', 
        isp: 'Indihome Bandung',
        method: 'GET', 
        path: '/api/v1/products', 
        status: 200, 
        latency: '18ms', 
        size: '12.8 KB',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/130.0',
        msg: 'GET /api/v1/products 200 OK - 18ms',
        rawLine: `36.72.215.19 - - [${dateFormatted}] "GET /api/v1/products HTTP/2.0" 200 12840 "https://${app.domain}/catalog" "Firefox/130.0" (CF-Ray: 8d2b928-BDO, Latency: 18ms)`
      },
      { 
        time: timeStr, 
        type: 'error', 
        ip: '198.51.100.41', 
        country: 'US', 
        isp: 'Scanner / Crawler',
        method: 'GET', 
        path: '/wp-login.php', 
        status: 404, 
        latency: '3ms', 
        size: '140 B',
        userAgent: 'Mozilla/5.0 (compatible; Shodan; +https://shodan.io)',
        msg: 'GET /wp-login.php 404 Not Found - [Blocked by WAF Rule #104]',
        rawLine: `198.51.100.41 - - [${dateFormatted}] "GET /wp-login.php HTTP/1.1" 404 140 "-" "Shodan/Bot" [CF-Blocked: WAF-Rule-104, Latency: 3ms]`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '103.147.154.82', 
        country: 'SG', 
        isp: 'MyRepublic Singapore',
        method: 'GET', 
        path: '/healthz', 
        status: 200, 
        latency: '1ms', 
        size: '18 B',
        userAgent: 'BarePod-Uptime-Monitor/2.4 (cgroup-probe)',
        msg: 'GET /healthz 200 OK - 1ms (Uptime Probe)',
        rawLine: `103.147.154.82 - - [${dateFormatted}] "GET /healthz HTTP/2.0" 200 18 "-" "BarePod-Uptime-Monitor/2.4" (CF-Ray: 8d2b930-SIN, Latency: 1ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '45.33.32.156', 
        country: 'DE', 
        isp: 'Hetzner Online Frankfurt',
        method: 'GET', 
        path: '/api/v1/health', 
        status: 200, 
        latency: '28ms', 
        size: '120 B',
        userAgent: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
        msg: 'GET /api/v1/health 200 OK - 28ms (Frankfurt Node)',
        rawLine: `45.33.32.156 - - [${dateFormatted}] "GET /api/v1/health HTTP/2.0" 200 120 "https://${app.domain}/" "Firefox/128.0" (CF-Ray: 8d2b932-FRA, Latency: 28ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '139.162.112.50', 
        country: 'JP', 
        isp: 'Linode Tokyo Datacenter',
        method: 'GET', 
        path: '/api/v1/realtime-feed', 
        status: 200, 
        latency: '36ms', 
        size: '1.8 KB',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Chrome/127.0',
        msg: 'GET /api/v1/realtime-feed 200 OK - 36ms (Tokyo Edge)',
        rawLine: `139.162.112.50 - - [${dateFormatted}] "GET /api/v1/realtime-feed HTTP/2.0" 200 1840 "https://${app.domain}/" "Safari/605.1" (CF-Ray: 8d2b935-NRT, Latency: 36ms)`
      },
      { 
        time: timeStr, 
        type: 'access', 
        ip: '13.236.40.91', 
        country: 'AU', 
        isp: 'AWS Sydney Edge',
        method: 'GET', 
        path: '/docs', 
        status: 200, 
        latency: '42ms', 
        size: '8.4 KB',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 Chrome/126.0',
        msg: 'GET /docs 200 OK - 42ms (Sydney Edge)',
        rawLine: `13.236.40.91 - - [${dateFormatted}] "GET /docs HTTP/2.0" 200 8420 "https://${app.domain}/" "Chrome/126.0" (CF-Ray: 8d2b938-SYD, Latency: 42ms)`
      },
      { 
        time: timeStr, 
        type: 'deploy', 
        msg: '[Deploy Runner] git pull origin main - HEAD is at commit 7fa901',
        rawLine: `[${dateFormatted}] [system:deploy-runner] git pull origin main - HEAD is at commit 7fa901`
      },
      { 
        time: timeStr, 
        type: 'deploy', 
        msg: '[Deploy Runner] Zero-downtime symlink swapped to release_20261010_1834',
        rawLine: `[${dateFormatted}] [system:deploy-runner] Zero-downtime symlink swapped to release_20261010_1834`
      },
    ];

    if (app.runtime === 'php') {
      return [
        { time: timeStr, type: 'access', msg: `[php-fpm: pool ${app.tenantUser}] child 3914 ready to handle requests`, rawLine: `[${dateFormatted}] [php-fpm:pool-${app.tenantUser}] child 3914 ready to handle requests` },
        { 
          time: timeStr, 
          type: 'access', 
          ip: '203.190.242.11', 
          country: 'ID', 
          isp: 'FirstMedia Medan',
          method: 'GET', 
          path: '/dashboard', 
          status: 200, 
          latency: '24ms', 
          size: '5.1 KB', 
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) Safari/605.1.15',
          msg: 'GET /dashboard 200 OK - 24ms',
          rawLine: `203.190.242.11 - - [${dateFormatted}] "GET /dashboard HTTP/2.0" 200 5210 "https://${app.domain}/" "Safari/605.1.15" (CF-Ray: 8d2b932-MES, Latency: 24ms)`
        },
        ...commonLogs,
        { time: timeStr, type: 'access', msg: 'PHP 8.4 JIT Compiler enabled (opcache.jit_buffer_size=64M)', rawLine: `[${dateFormatted}] [php-zend-engine] OPcache JIT Compiler enabled (opcache.jit_buffer_size=64M)` },
        { 
          time: timeStr, 
          type: 'error', 
          ip: '45.155.205.8', 
          country: 'RU', 
          isp: 'Suspicious IP Scanner',
          method: 'POST', 
          path: '/xmlrpc.php', 
          status: 403, 
          latency: '2ms', 
          size: '42 B', 
          userAgent: 'python-requests/2.31.0',
          msg: 'POST /xmlrpc.php 403 Forbidden - [WAF Blocked brute-force attempt]',
          rawLine: `45.155.205.8 - - [${dateFormatted}] "POST /xmlrpc.php HTTP/1.1" 403 42 "-" "python-requests/2.31.0" [CF-Blocked: WAF-Bot-Shield, Latency: 2ms]`
        },
      ];
    } else if (app.runtime === 'nodejs') {
      return [
        { time: timeStr, type: 'access', msg: `[NestJS] Application initialized listening on unix:/run/node/${app.name}.sock`, rawLine: `[${dateFormatted}] [system:node-supervisor] NestJS app listening on unix:/run/node/${app.name}.sock` },
        ...commonLogs,
        { 
          time: timeStr, 
          type: 'error', 
          ip: '198.51.100.41', 
          country: 'US', 
          isp: 'Scanner / Crawler',
          method: 'POST', 
          path: '/api/auth/login', 
          status: 429, 
          latency: '4ms', 
          size: '64 B', 
          userAgent: 'curl/8.4.0',
          msg: 'Rate limiter: 429 Too Many Requests on /api/auth/login',
          rawLine: `198.51.100.41 - - [${dateFormatted}] "POST /api/auth/login HTTP/1.1" 429 64 "-" "curl/8.4.0" (Rate-Limit-Exceeded: 30req/min)`
        },
      ];
    } else if (app.runtime === 'python') {
      return [
        { time: timeStr, type: 'access', msg: `[Gunicorn 22.0] Starting gunicorn workers (gevent async worker_class)`, rawLine: `[${dateFormatted}] [system:gunicorn] Starting gunicorn workers (gevent async worker_class)` },
        { 
          time: timeStr, 
          type: 'access', 
          ip: '103.147.154.82', 
          country: 'SG', 
          isp: 'MyRepublic SG',
          method: 'GET', 
          path: '/docs', 
          status: 200, 
          latency: '8ms', 
          size: '14.2 KB', 
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/127.0',
          msg: 'FastAPI OpenAPI documentation mounted at /docs',
          rawLine: `103.147.154.82 - - [${dateFormatted}] "GET /docs HTTP/2.0" 200 14500 "-" "Chrome/127.0" (CF-Ray: 8d2b938-SIN, Latency: 8ms)`
        },
        ...commonLogs,
      ];
    }
    return commonLogs;
  };

  const logs = getMockLogs();
  const uniqueVisitorIps = Array.from(new Set(logs.filter(l => l.ip).map(l => l.ip as string)));

  const visitorCountryNodes = [
    { country: 'ID', countryName: 'Indonesia', flag: '🇮🇩', city: 'Jakarta & Surabaya', ip: '114.124.180.52', isp: 'Telkomsel & Biznet', x: 796, y: 268, reqs: 3, percentage: 38, latency: '14ms', isThreat: false },
    { country: 'SG', countryName: 'Singapura', flag: '🇸🇬', city: 'Singapore Edge', ip: '103.147.154.82', isp: 'MyRepublic Singapore', x: 788, y: 246, reqs: 2, percentage: 25, latency: '1ms', isThreat: false },
    { country: 'US', countryName: 'Amerika Serikat', flag: '🇺🇸', city: 'Ashburn, VA', ip: '198.51.100.41', isp: 'Security Scanner', x: 285, y: 142, reqs: 1, percentage: 12, latency: '3ms', isThreat: true },
    { country: 'DE', countryName: 'Jerman', flag: '🇩🇪', city: 'Frankfurt Node', ip: '45.33.32.156', isp: 'Hetzner Online', x: 524, y: 111, reqs: 1, percentage: 12, latency: '28ms', isThreat: false },
    { country: 'JP', countryName: 'Jepang', flag: '🇯🇵', city: 'Tokyo Edge', ip: '139.162.112.50', isp: 'Linode Tokyo', x: 888, y: 151, reqs: 1, percentage: 12, latency: '36ms', isThreat: false },
    { country: 'AU', countryName: 'Australia', flag: '🇦🇺', city: 'Sydney Edge', ip: '13.236.40.91', isp: 'AWS Sydney', x: 920, y: 344, reqs: 1, percentage: 12, latency: '42ms', isThreat: false },
  ];

  const filteredLogs = logs.filter(log => {
    const matchesType = logType === 'all' || log.type === logType;
    const searchTarget = `${log.msg} ${log.time} ${log.ip || ''} ${log.country || ''} ${log.isp || ''} ${log.path || ''} ${log.method || ''} ${log.status || ''} ${log.rawLine || ''}`.toLowerCase();
    const matchesSearch = !logSearch || searchTarget.includes(logSearch.toLowerCase());
    const matchesCountry = !selectedCountryFilter || log.country === selectedCountryFilter;
    return matchesType && matchesSearch && matchesCountry;
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
              onClick={handleExportAppBackup}
              disabled={isExportingBackup}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
              title="Download portable backup archive (.bpod) for migration"
            >
              <Archive className={`w-3.5 h-3.5 text-blue-600 ${isExportingBackup ? 'animate-spin' : ''}`} />
              <span>{isExportingBackup ? 'Mengemas...' : 'Backup (.bpod)'}</span>
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
          onClick={() => setActiveTab('deploy')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'deploy'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FolderGit2 className="w-4 h-4 text-blue-600" />
          <span>Deploy & Build Script</span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
            Tersimpan
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
          <div className="space-y-4">
            {/* Real-IP Ingress Banner */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-900">
              <div className="flex items-center gap-2 font-mono">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">Real-IP Ingress Aktif:</span>
                <span className="text-emerald-700">
                  IP asli pengunjung direstorasi langsung dari header <code>CF-Connecting-IP</code> & <code>X-Forwarded-For</code> (Zero-NAT bypass, bukan IP Docker/Proxy 127.0.0.1).
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] bg-emerald-100/80 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                  {uniqueVisitorIps.length} Unique Visitor IPs
                </span>
                <button
                  type="button"
                  onClick={() => setShowWorldMap(!showWorldMap)}
                  className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] bg-white border border-emerald-300 text-emerald-800 font-bold hover:bg-emerald-50 transition-colors cursor-pointer"
                >
                  <Globe className="w-3 h-3 text-emerald-600" />
                  <span>{showWorldMap ? 'Tutup Peta' : 'Buka Peta Dunia'}</span>
                </button>
              </div>
            </div>

            {/* LIVE GLOBAL VISITOR WORLD MAP */}
            {showWorldMap && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3.5 animate-in fade-in duration-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                      <Globe className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                        <span>Peta Distribusi Pengunjung Global (Live Geo Ingress)</span>
                        <span className="px-1.5 py-0.2 text-[9px] bg-emerald-100 text-emerald-800 font-mono font-bold rounded">
                          Live Pulse
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Visualisasi real-time asal negara traffic & edge node Cloudflare yang mengakses {app.domain}
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
                      {visitorCountryNodes.length} Lokasi Aktif di 5 Benua
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
                        <div><strong>IP Sampel:</strong> <code className="text-amber-700">{hoveredMapPin.ip}</code></div>
                        <div><strong>ISP / Cloud:</strong> {hoveredMapPin.isp}</div>
                        <div><strong>Latensi:</strong> <span className="text-emerald-600 font-bold">{hoveredMapPin.latency}</span></div>
                        <div className="text-[10px] text-blue-600 pt-0.5">Klik pin untuk memfilter log ke negara ini</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Country Quick-Filter Badges */}
                <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                  <span className="text-[11px] font-bold text-slate-600 mr-1 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-slate-400" />
                    Filter Negara:
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
                    🌐 Semua ({logs.length})
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
              </div>
            )}

            {/* Filter Toolbar (Clean & Search-Driven) */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                {/* Search Bar (Search IP, Path, Status, Messages) */}
                <div className="relative flex-1 max-w-lg">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Cari IP (misal: 114.124), path, status code, user agent, ISP..."
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
                      Tabel Kolom
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
                    title="Bungkus teks agar path dan user-agent tidak terpotong"
                  >
                    <span>Bungkus Teks</span>
                    {wrapLogText && <span className="text-[10px]">✓</span>}
                  </button>

                  {/* Light / Dark Mode Toggle */}
                  <button
                    type="button"
                    onClick={() => setLogTheme(logTheme === 'light' ? 'dark' : 'light')}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer font-medium"
                    title={`Ganti tema konsol ke ${logTheme === 'light' ? 'Dark Console' : 'Light Mode'}`}
                  >
                    {logTheme === 'light' ? (
                      <>
                        <Moon className="w-3 h-3 text-slate-500" />
                        <span>Gelap</span>
                      </>
                    ) : (
                      <>
                        <Sun className="w-3 h-3 text-amber-500" />
                        <span>Terang</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => {
                      setIsRefreshingLogs(true);
                      setTimeout(() => setIsRefreshingLogs(false), 500);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors cursor-pointer font-medium"
                    title="Refresh logs"
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
                    {type === 'all' ? 'Semua Log' : type === 'access' ? 'Access Logs' : type === 'error' ? 'Errors / WAF' : 'Deploy Logs'}
                  </button>
                ))}
              </div>
            </div>

            {/* Terminal Window (Styled in Clean Light Mode by Default or Dark Mode) */}
            <div className={`font-mono text-xs rounded-xl p-4 min-h-[380px] max-h-[580px] overflow-y-auto overflow-x-auto border transition-colors shadow-2xs ${
              logTheme === 'light'
                ? 'bg-white text-slate-800 border-slate-200'
                : 'bg-slate-950 text-slate-100 border-slate-800 shadow-inner'
            }`}>
              <div className="min-w-[1080px]">
                {/* Terminal Table Header for Structured View */}
                {logFormat === 'structured' && (
                  <div className={`flex items-center gap-3 pb-2.5 mb-2 border-b text-[10px] font-bold uppercase tracking-wider select-none ${
                    logTheme === 'light' ? 'border-slate-200 text-slate-500 bg-slate-50/50 -mx-2 px-2 py-1.5 rounded-t' : 'border-slate-800 text-slate-400'
                  }`}>
                    <div className="w-[85px] shrink-0">WAKTU</div>
                    <div className="w-[170px] shrink-0">IP PENGUNJUNG</div>
                    <div className="w-[125px] shrink-0">METODE & STATUS</div>
                    <div className="w-[300px] shrink-0">PATH REQUEST</div>
                    <div className="flex-1 min-w-[320px]">LATENSI & CLIENT INFO (USER-AGENT)</div>
                    <div className="w-[70px] shrink-0 text-center">DETAIL</div>
                  </div>
                )}

                {filteredLogs.map((log, idx) => (
                  logFormat === 'structured' ? (
                    <div key={idx} className="flex flex-col mb-1">
                      <div 
                        onClick={() => setExpandedLogIdx(expandedLogIdx === idx ? null : idx)}
                        className={`flex items-center gap-3 py-2 px-2.5 rounded-lg border transition-all cursor-pointer ${
                          expandedLogIdx === idx
                            ? (logTheme === 'light' ? 'bg-blue-50/90 border-blue-200' : 'bg-slate-900 border-slate-700')
                            : (logTheme === 'light' ? 'hover:bg-slate-50 border-transparent hover:border-slate-200' : 'hover:bg-slate-900/80 border-transparent hover:border-slate-800')
                        }`}
                      >
                        {/* Waktu */}
                        <div className={`w-[85px] shrink-0 text-[11px] font-mono ${
                          logTheme === 'light' ? 'text-slate-400 font-semibold' : 'text-slate-500'
                        }`}>
                          [{log.time}]
                        </div>

                        {/* Visitor Client IP Badge */}
                        <div className="w-[170px] shrink-0 flex items-center gap-1.5 overflow-hidden">
                          {log.ip ? (
                            <span 
                              className={`inline-flex items-center gap-1.5 font-mono font-bold text-[11px] px-2 py-0.5 rounded shadow-2xs whitespace-nowrap border ${
                                logTheme === 'light'
                                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                              }`}
                              title={`Visitor IP: ${log.ip} | ISP: ${log.isp || 'Unknown'} | Country: ${log.country || 'Global'}`}
                            >
                              <Globe className={`w-3 h-3 shrink-0 ${logTheme === 'light' ? 'text-amber-600' : 'text-amber-400'}`} />
                              <span className="tracking-tight">{log.ip}</span>
                              <span className={`text-[9px] px-1 rounded uppercase font-semibold border ${
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
                              [system daemon]
                            </span>
                          )}
                        </div>

                        {/* Method & Status */}
                        <div className="w-[125px] shrink-0 flex items-center gap-1.5">
                          {log.method ? (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                              log.method === 'GET'
                                ? (logTheme === 'light' ? 'bg-cyan-50 text-cyan-800 border-cyan-300' : 'bg-cyan-950 text-cyan-300 border-cyan-800/50')
                                : (logTheme === 'light' ? 'bg-indigo-50 text-indigo-800 border-indigo-300' : 'bg-indigo-950 text-indigo-300 border-indigo-800/50')
                            }`}>
                              {log.method}
                            </span>
                          ) : (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              log.type === 'error' ? 'bg-rose-100 text-rose-800' :
                              log.type === 'deploy' ? 'bg-purple-100 text-purple-800' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {log.type}
                            </span>
                          )}

                          {log.status && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded font-mono border ${
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
                          )}
                        </div>

                        {/* Path Request (No Clipping when wrapLogText is active) */}
                        <div className={`w-[300px] shrink-0 ${wrapLogText ? 'break-all' : 'truncate'}`}>
                          <span className={`text-[11px] font-mono font-bold ${
                            logTheme === 'light' ? 'text-slate-900' : 'text-slate-100'
                          }`}>
                            {log.path || log.msg}
                          </span>
                        </div>

                        {/* Latency & Client Info (User-Agent) */}
                        <div className={`flex-1 min-w-[320px] flex items-center gap-2 text-[11px] ${wrapLogText ? 'flex-wrap' : 'overflow-hidden'}`}>
                          {log.latency && (
                            <span className={`font-mono font-semibold shrink-0 px-1.5 py-0.5 rounded text-[10px] border ${
                              logTheme === 'light'
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-cyan-950/70 text-cyan-300 border-cyan-800/50'
                            }`}>
                              {log.latency} • {log.size}
                            </span>
                          )}
                          <span 
                            className={`flex-1 text-[11px] font-sans ${wrapLogText ? 'break-all leading-relaxed' : 'truncate'} ${
                              logTheme === 'light' ? 'text-slate-600' : 'text-slate-300'
                            }`}
                            title={log.userAgent || log.msg}
                          >
                            {log.userAgent || log.msg}
                          </span>
                        </div>

                        {/* Detail Inspector Toggle */}
                        <div className="w-[70px] shrink-0 text-center">
                          <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] rounded font-semibold transition-colors ${
                            expandedLogIdx === idx
                              ? 'bg-blue-600 text-white'
                              : (logTheme === 'light' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' : 'bg-slate-800 text-slate-300 hover:bg-slate-700')
                          }`}>
                            <span>Detail</span>
                            {expandedLogIdx === idx ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          </span>
                        </div>
                      </div>

                      {/* Expanded Request Inspector Drawer */}
                      {expandedLogIdx === idx && (
                        <div className={`p-3.5 my-1.5 mx-1 rounded-xl border space-y-2.5 text-xs animate-in fade-in duration-150 ${
                          logTheme === 'light' ? 'bg-slate-50 border-blue-200 text-slate-800' : 'bg-slate-900 border-slate-700 text-slate-200'
                        }`}>
                          <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                            <span className="font-bold flex items-center gap-1.5 text-blue-600 text-xs">
                              <Search className="w-3.5 h-3.5" />
                              Detail Lengkap Request #{idx + 1} ({log.time})
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(log.rawLine || log.msg);
                                onShowToast?.('Log Disalin', 'Baris raw log berhasil disalin ke clipboard.', 'success');
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold cursor-pointer shadow-2xs"
                            >
                              <Copy className="w-3 h-3 text-slate-500" />
                              <span>Salin Raw Log</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                                Full Request Path / Target:
                              </span>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-slate-900 font-mono font-bold select-all break-all shadow-2xs">
                                {log.path || log.msg}
                              </div>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                                Full Client Info (User-Agent):
                              </span>
                              <div className="p-2.5 bg-white rounded-lg border border-slate-200 text-slate-700 select-all break-all text-[11px] leading-relaxed shadow-2xs">
                                {log.userAgent || 'Internal System Daemon'}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-4 pt-1.5 text-[11px] border-t border-slate-200/40">
                            {log.ip && (
                              <span>
                                <strong>IP Asli:</strong> <code className="text-amber-700 font-bold px-1 bg-amber-50 rounded border border-amber-200">{log.ip}</code> ({log.country} • {log.isp})
                              </span>
                            )}
                            {log.latency && <span><strong>Latensi:</strong> <code className="text-emerald-700 font-bold">{log.latency}</code></span>}
                            {log.size && <span><strong>Payload:</strong> <code>{log.size}</code></span>}
                            {log.status && <span><strong>Status HTTP:</strong> <code className="text-blue-700 font-bold">{log.status}</code></span>}
                            {log.method && <span><strong>Metode:</strong> <code className="text-purple-700 font-bold">{log.method}</code></span>}
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
                    Tidak ada baris log yang sesuai dengan filter pencarian atau negara yang dipilih.
                  </div>
                )}
              </div>
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
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold shrink-0">
                  <ArrowRightLeft className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    Root Gateway — Target Upstream (Route <code className="font-mono bg-slate-100 px-1 rounded">/</code>)
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Service default penerima <strong>semua</strong> traffic {app.domain} yang tidak di-match oleh Path Route lain di bawah.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Upstream URL / IP Address (tujuan route <code>/</code>)
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
                      title="Cek konektivitas upstream (test saja — tidak menyimpan config)"
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors whitespace-nowrap shrink-0"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isPingingUpstream ? 'animate-spin' : ''}`} />
                      <span>{isPingingUpstream ? 'Pinging...' : 'Ping Test'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Ping hanya mengetes konektivitas (tidak menyimpan config). Field di kartu ini langsung dirender ke vhost di bawah.
                  </p>
                  {pingStatus && (
                    <div className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{pingStatus.code} OK ({pingStatus.latency})</span>
                    </div>
                  )}
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
              <span className="block text-[11px] font-bold text-slate-600 pt-2 border-t border-slate-100">
                Perilaku Proxy Route <code className="font-mono bg-slate-100 px-1 rounded">/</code> (berlaku global untuk root gateway)
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
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">LOCATION PATH</th>
                    <th className="py-3 px-4">UPSTREAM DESTINATION</th>
                    <th className="py-3 px-4">SERVICE / RUNTIME</th>
                    <th className="py-3 px-4">CACHE STRATEGY</th>
                    <th className="py-3 px-4">STATUS</th>
                    <th className="py-3 px-4 text-center">AKSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {routes.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="py-3 px-4">
                        {r.path === '/' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-blue-600 text-sm">/</span>
                            <span className="px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-700 font-sans font-bold rounded">
                              Root Gateway
                            </span>
                          </div>
                        ) : (
                          <span className="font-bold text-slate-800">{r.path}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-purple-900 font-bold">
                        {r.path === '/' ? currentUpstream : r.upstream}
                      </td>
                      <td className="py-3 px-4 text-slate-800 font-sans">{r.target}</td>
                      <td className="py-3 px-4 text-slate-500">{r.cache}</td>
                      <td className="py-3 px-4 text-emerald-600 font-bold">Active</td>
                      <td className="py-3 px-4 text-center">
                        {r.path === '/' ? (
                          <span className="text-[10px] text-slate-400 font-sans italic">Default</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDeleteRoute(r.path)}
                            title={`Hapus route ${r.path}`}
                            className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors inline-flex items-center justify-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
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
                    const snippet = getReverseProxyConfigSnippet();
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
                {getReverseProxyConfigSnippet()}
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

            {/* Extensions Filter, Tenant Isolation Banner & Catalog */}
            <div className="space-y-4 pt-2">
              {/* Tenant Isolation Banner with Reset to Admin Default */}
              <div className="p-3.5 rounded-xl border border-purple-200/80 bg-gradient-to-r from-purple-50/80 to-indigo-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-purple-950 block">
                      Konfigurasi Terisolasi per Aplikasi ({app.tenantUser})
                    </span>
                    <p className="text-[11px] text-purple-800 leading-relaxed">
                      Seluruh 28+ extension bawaan dan PECL populer sudah di-index di bawah. Mengubah toggle di sini hanya berlaku untuk aplikasi ini (terisolasi dalam jail). Tidak akan mengubah default admin atau merusak aplikasi user lain.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResetToAdminDefault}
                  className="px-3 py-1.5 rounded-lg border border-purple-300 bg-white hover:bg-purple-50 text-purple-700 text-xs font-semibold whitespace-nowrap shadow-2xs transition-colors shrink-0 flex items-center gap-1.5"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Reset ke Default Admin</span>
                </button>
              </div>

              {/* Toolbar: Search, Categories & Toggle Custom PECL Form */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Cari extension (e.g. redis, swoole, grpc, imagick)..."
                      value={extensionSearch}
                      onChange={(e) => setExtensionSearch(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg w-64 focus:outline-hidden focus:ring-2 focus:ring-purple-500/20"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {['all', 'database', 'cache', 'core', 'media', 'rpc', 'security'].map((cat) => (
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

                {/* Button to toggle custom unlisted PECL package compilation */}
                <button
                  type="button"
                  onClick={() => setShowCustomPeclForm(!showCustomPeclForm)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 whitespace-nowrap ${
                    showCustomPeclForm 
                      ? 'bg-purple-100 text-purple-900 border-purple-300' 
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5 text-purple-600" />
                  <span>{showCustomPeclForm ? 'Tutup Form PECL Kustom' : '+ Install PECL Lainnya'}</span>
                </button>
              </div>

              {/* Collapsible Custom PECL Compiler Form */}
              {showCustomPeclForm && (
                <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/50 space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-950">
                      📦 Compile Paket PECL Kustom / Unlisted
                    </span>
                    <span className="text-[10px] text-purple-700 font-medium">
                      Gunakan ini hanya jika extension yang Anda butuhkan belum ada di daftar di bawah
                    </span>
                  </div>
                  <form onSubmit={handleInstallCustomExtension} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Ketik nama paket PECL (e.g. excimer, uopz, v8js)..."
                      value={customExtensionInput}
                      onChange={(e) => setCustomExtensionInput(e.target.value)}
                      className="flex-1 px-3 py-2 text-xs bg-white border border-purple-300 rounded-lg font-mono focus:outline-hidden focus:ring-2 focus:ring-purple-500/20"
                    />
                    <button
                      type="submit"
                      disabled={isInstallingExtension || !customExtensionInput.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isInstallingExtension ? 'Mengompilasi PECL...' : 'Kompilasi & Pasang'}</span>
                    </button>
                  </form>
                </div>
              )}

              {/* Master Extensions Grid */}
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
                            {ext.isPecl && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 border border-purple-200">
                                PECL
                              </span>
                            )}
                            <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
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

        {/* TAB: DEPLOY & BUILD SCRIPT (PERSISTENT PER APP) */}
        {activeTab === 'deploy' && (
          <div className="space-y-6">
            {/* Top Persistence Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-blue-50/70 border border-blue-200 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <FolderGit2 className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Deploy & Build Script Tersimpan per-Aplikasi
                    </h3>
                    <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1 font-mono">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>Persistent in DB</span>
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Skrip ini disimpan secara permanen untuk <strong>{app.name}</strong>. Setiap kali commit di-push ke GitHub atau webhook dipanggil, server otomatis mengeksekusi skrip ini di sandbox <code>{appPath}</code>.
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
                  <span>{isSavingDeployScript ? 'Menyimpan...' : 'Simpan Konfigurasi Script'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleTriggerDirectDeploy}
                  disabled={isDeployingNow}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 disabled:opacity-50 cursor-pointer"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
                  <span>{isDeployingNow ? 'Sedang Deploy...' : 'Redeploy Sekarang'}</span>
                </button>
              </div>
            </div>

            {/* Git Repo & Branch Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 p-4 bg-white rounded-xl border border-slate-200 space-y-2">
                <label className="block text-xs font-bold text-slate-800">
                  GitHub Repository URL
                </label>
                <input
                  type="text"
                  value={gitRepo}
                  onChange={(e) => setGitRepo(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white"
                />
                <span className="text-[11px] text-slate-500 block">
                  Alamat remote git upstream yang digunakan untuk penarikan kode (git pull).
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
                    onChange={(e) => setGitBranch(e.target.value)}
                    placeholder="main"
                    className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800 font-mono text-xs font-bold"
                  />
                </div>
                <span className="text-[11px] text-slate-500 block">
                  Branch yang di-checkout otomatis saat deploy.
                </span>
              </div>
            </div>

            {/* Webhook Push-to-Deploy */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Radio className="w-4 h-4 text-blue-600 animate-pulse" />
                  <span className="text-xs font-bold text-slate-900">Push-to-Deploy GitHub Webhook URL</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoDeploy}
                    onChange={(e) => setAutoDeploy(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-semibold">Aktifkan Auto Redeploy saat Git Push</span>
                </label>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={`https://${app.domain}/api/v1/webhook/${app.id}/deploy?token=bp_wh_${app.tenantUser}_99a`}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-600"
                />
                <button
                  type="button"
                  onClick={handleCopyDeployWebhook}
                  className="px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
                >
                  {copiedDeployWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedDeployWebhook ? 'Tersalin' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Salin Webhook URL di atas dan masukkan ke <strong>GitHub: Repo Settings → Webhooks → Add Webhook</strong> (Content-Type: <code>application/json</code>). Setiap push commit ke branch <code>{gitBranch}</code> akan otomatis menjalankan build script di bawah!
              </p>
            </div>

            {/* Build Script Editor Card */}
            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <Code2 className="w-4 h-4 text-slate-600" />
                    <span>Deploy & Build Script Editor</span>
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Perintah shell bash yang dijalankan berurutan di dalam tenant sandbox saat build/redeploy.
                  </p>
                </div>

                {/* Script Presets */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-amber-500" />
                    <span>Muat Preset:</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetInDetail('laravel')}
                    className="px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors"
                  >
                    Laravel 11
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetInDetail('nextjs')}
                    className="px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors"
                  >
                    Node / Next.js
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetInDetail('fastapi')}
                    className="px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors"
                  >
                    Python
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPresetInDetail('go')}
                    className="px-2.5 py-1 text-xs font-semibold bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg text-slate-700 transition-colors"
                  >
                    Go
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
                  placeholder="Contoh:&#10;git pull origin main&#10;composer install --no-dev&#10;php artisan migrate --force&#10;systemctl reload-app"
                  className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-y font-mono text-xs focus:ring-0 leading-relaxed min-h-[140px]"
                />
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1">
                <div className="text-[11px] text-slate-400">
                  Environment variables tersedia: <code>$APP_NAME</code>, <code>$APP_PORT</code>, <code>$APP_DOMAIN</code>, <code>$TENANT_USER</code>.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDeployScript}
                    disabled={isSavingDeployScript}
                    className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5 text-blue-600" />
                    <span>{isSavingDeployScript ? 'Menyimpan...' : 'Simpan Script'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTriggerDirectDeploy}
                    disabled={isDeployingNow}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isDeployingNow ? 'animate-spin' : ''}`} />
                    <span>{isDeployingNow ? 'Sedang Deploy...' : 'Simpan & Redeploy Sekarang'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Deployment Live Log Terminal */}
            <div className="p-5 bg-white rounded-2xl border border-slate-200 shadow-2xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-slate-600" />
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Live Build & Deployment Output
                  </h4>
                </div>
                <span className="text-[11px] text-emerald-600 font-semibold font-mono">
                  Zero-Downtime Atomic Symlink Active
                </span>
              </div>
              <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 font-mono text-xs text-slate-200 min-h-[140px] max-h-[220px] overflow-y-auto space-y-1.5 shadow-inner">
                {deployLogs.map((log, idx) => (
                  <div key={idx} className={log.includes('✅') ? 'text-emerald-400 font-bold' : log.includes('❌') ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                    {log}
                  </div>
                ))}
              </div>
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

