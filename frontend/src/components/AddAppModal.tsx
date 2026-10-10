import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Layers,
  Globe,
  Terminal,
  CloudRain,
  ShieldCheck,
  Database,
  Check,
  Server,
  Zap,
  ArrowRightLeft,
  Wifi,
  Copy,
  Code2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  RefreshCw,
  Upload,
  Download,
  FolderOpen,
  Lock,
  GitBranch,
  KeyRound,
} from 'lucide-react';
import type { RuntimeType, WebApp, WebServerType, DatabaseEngine } from '../types';
import { runtimeIcon, dbIcon } from '../utils/brandIcons';
import { AVAILABLE_ENGINE_VERSIONS, ENGINE_LABELS } from '../data/databaseEngines';
import { getProvisionPlan } from '../data/frameworkProvision';

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddApp: (newApp: Partial<WebApp>) => void;
}

type WizardStep = 'basics' | 'engine' | 'source' | 'database' | 'upstream' | 'review';
type SourceKind = 'scaffold' | 'github' | 'upload' | 'existing';

const stepsForMode = (mode: 'standard' | 'proxy' | 'static'): { id: WizardStep; label: string }[] => {
  if (mode === 'proxy') {
    return [
      { id: 'basics', label: 'Basics' },
      { id: 'upstream', label: 'Upstream' },
      { id: 'review', label: 'Review' },
    ];
  }
  if (mode === 'static') {
    return [
      { id: 'basics', label: 'Basics' },
      { id: 'engine', label: 'Engine' },
      { id: 'source', label: 'Source' },
      { id: 'review', label: 'Review' },
    ];
  }
  return [
    { id: 'basics', label: 'Basics' },
    { id: 'engine', label: 'Engine & Runtime' },
    { id: 'source', label: 'Source' },
    { id: 'database', label: 'Database & Cache' },
    { id: 'review', label: 'Review' },
  ];
};

const defaultPortFor = (runtime: RuntimeType): number =>
  runtime === 'php' ? 8001 : runtime === 'python' ? 5000 : runtime === 'nodejs' ? 3000 : runtime === 'static' ? 80 : 8080;

/** Accepts a bare FQDN like api.example.com (no scheme, no spaces, at least one dot). */
const isValidDomain = (value: string): boolean =>
  /^([a-z0-9](?:-*[a-z0-9])*)(?:\.([a-z0-9](?:-*[a-z0-9])*))+$/i.test(value);

export const AddAppModal: React.FC<AddAppModalProps> = ({ isOpen, onClose, onAddApp }) => {
  const [appMode, setAppMode] = useState<'standard' | 'proxy' | 'static'>('standard');
  const [stepIndex, setStepIndex] = useState(0);

  // Basics
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [tenantUser, setTenantUser] = useState('farras');
  const [tunnelEnabled, setTunnelEnabled] = useState(true);

  // Engine & runtime
  const [webServer, setWebServer] = useState<WebServerType>('openlitespeed');
  const [runtime, setRuntime] = useState<RuntimeType>('php');
  const [framework, setFramework] = useState('Laravel 12');
  const [version, setVersion] = useState('8.4');

  // Source
  const [sourceKind, setSourceKind] = useState<SourceKind>('scaffold');
  const [gitRepo, setGitRepo] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [uploadFile, setUploadFile] = useState<string | null>(null);
  const [dirCheck, setDirCheck] = useState<'idle' | 'checking' | 'ok' | 'missing'>('idle');
  const KNOWN_EXISTING_APPS = ['flask-sentiment-api', 'larastore-commerce', 'billing-backend-api', 'fastapi-ai-service', 'legacy-news-portal', 'internal-n8n-proxy'];
  const existingPath = `/home/${tenantUser}/apps/${name || '<website>'}`;
  const checkExistingDir = () => {
    setDirCheck('checking');
    setTimeout(() => setDirCheck(KNOWN_EXISTING_APPS.includes(name.trim()) ? 'ok' : 'missing'), 600);
  };

  // Database
  const [createDb, setCreateDb] = useState(true);
  const [dbType, setDbType] = useState<DatabaseEngine>('postgres');
  const [dbVersionIndex, setDbVersionIndex] = useState(0);
  const [dbName, setDbName] = useState('');
  const [dbUser, setDbUser] = useState('');
  const [dbPassword, setDbPassword] = useState('bp_' + Math.random().toString(36).slice(2, 12));
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [maxConnections, setMaxConnections] = useState(25);
  const [autoEnv, setAutoEnv] = useState(true);

  // Proxy
  const [upstreamUrl, setUpstreamUrl] = useState('http://127.0.0.1:8080');
  const [proxyWebsocket, setProxyWebsocket] = useState(true);
  const [proxyPreserveHost, setProxyPreserveHost] = useState(true);
  const [proxyRealIp, setProxyRealIp] = useState(true);
  const [proxyTimeoutSecs, setProxyTimeoutSecs] = useState(60);
  const [clientMaxBodyMB] = useState(100);

  const [copiedConfig, setCopiedConfig] = useState(false);

  const runtimeConfigs: Record<RuntimeType, { versions: string[]; frameworks: string[] }> = useMemo(
    () => ({
      php: {
        versions: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
        frameworks: [
          'Generic (bring your own code)',
          'Laravel 13',
          'Laravel 12',
          'Symfony 8',
          'Symfony 7',
          'CodeIgniter 4',
          'CakePHP 5',
          'Slim 4',
          'Laminas',
          'Yii 2',
          'WordPress',
          'WooCommerce',
          'Drupal 11',
          'Drupal 10',
          'Joomla 6',
          'Contao 4',
          'Neos 9',
          'TYPO3 14',
          'Nextcloud 34',
          'OwnCloud 12',
          'Moodle 5',
          'Matomo 5',
          'Mautic 7',
          'Magento 2',
          'PrestaShop 1.7',
          'Shopware 6',
          'WHMCS',
        ],
      },
      python: {
        versions: ['3.12', '3.11', '3.10'],
        frameworks: ['Flask', 'FastAPI', 'Django', 'Generic (bring your own code)'],
      },
      nodejs: {
        versions: ['22 LTS', '20 LTS', '18'],
        frameworks: ['Next.js', 'Nuxt', 'Astro', 'Express', 'NestJS', 'Generic (bring your own code)'],
      },
      go: { versions: ['1.23', '1.22'], frameworks: ['Gin', 'Fiber', 'Standard HTTP', 'Generic (bring your own code)'] },
      rust: { versions: ['1.81', '1.80'], frameworks: ['Axum', 'Actix-web', 'Generic (bring your own code)'] },
      ruby: { versions: ['3.3', '3.2'], frameworks: ['Ruby on Rails', 'Sinatra', 'Generic (bring your own code)'] },
      docker: { versions: ['Latest'], frameworks: ['Custom Containerfile'] },
      static: { versions: ['HTML5'], frameworks: ['Static Web App', 'Vite Dist', 'Astro Static'] },
      proxy: { versions: ['v1.0'], frameworks: ['Reverse Proxy Forwarder'] },
    }),
    [],
  );

  const steps = stepsForMode(appMode);
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)];
  const currentStepId = currentStep?.id ?? 'basics';

  // Only templates with an automated download are offered (plus the Generic option)
  const availableFrameworks = useMemo(() => {
    const list = runtimeConfigs[runtime].frameworks.filter(
      (fw) => /generic|custom/i.test(fw) || getProvisionPlan(runtime, fw).mode === 'download',
    );
    return list.length ? list : ['Generic (bring your own code)'];
  }, [runtime, runtimeConfigs]);

  const dbVersions = AVAILABLE_ENGINE_VERSIONS[dbType] ?? [];
  const activeDbVersion = dbVersions[Math.min(dbVersionIndex, dbVersions.length - 1)];
  const isSqlite = dbType === 'sqlite';

  const plan = getProvisionPlan(runtime, framework);
  const isGenericFramework = /generic|custom/i.test(framework);
  const effectiveSource: SourceKind = appMode === 'static' && sourceKind === 'scaffold' ? 'upload' : sourceKind;
  const domainValid = isValidDomain(domain.trim());

  // Templates without an automated download can't use the Scaffold source
  useEffect(() => {
    if (plan.mode !== 'download' && sourceKind === 'scaffold') setSourceKind('github');
  }, [plan.mode, sourceKind]);

  // Keep the selected template inside the available list
  useEffect(() => {
    if (!availableFrameworks.includes(framework)) setFramework(availableFrameworks[0]);
  }, [availableFrameworks, framework]);

  const sourceValid =
    effectiveSource === 'scaffold'
      ? plan.mode === 'download'
      : effectiveSource === 'github'
        ? gitRepo.trim() !== ''
        : effectiveSource === 'upload'
          ? uploadFile !== null
          : dirCheck === 'ok';

  const sourceValidForMode = appMode === 'proxy' ? true : sourceValid;

  const handleModeSwitch = (mode: 'standard' | 'proxy' | 'static') => {
    setAppMode(mode);
    setStepIndex(0);
    if (mode === 'proxy') {
      setRuntime('proxy');
      setVersion('v1.0');
      setWebServer('nginx');
      setCreateDb(false);
    } else if (mode === 'static') {
      setRuntime('static');
      setVersion('HTML5');
      setFramework('Static Web App');
      setWebServer('caddy');
      setCreateDb(false);
    } else {
      setRuntime('php');
      setVersion('8.4');
      setFramework('Laravel 12');
      setWebServer('openlitespeed');
      setCreateDb(true);
    }
  };

  const handleRuntimeChange = (next: RuntimeType) => {
    setRuntime(next);
    const cfg = runtimeConfigs[next];
    setVersion(cfg.versions[0] || 'latest');
    setFramework(cfg.frameworks[0] || 'Generic (bring your own code)');
    if (next === 'php') setWebServer('openlitespeed');
    else if (next === 'python') setWebServer('nginx');
    else if (next === 'nodejs') setWebServer('caddy');
  };

  const envPreview = useMemo(() => {
    if (!createDb) return '';
    const base = `APP_ENV=production\nAPP_URL=https://${domain || 'example.com'}\n`;
    if (isSqlite) {
      return `${base}\n# SQLite (file-based, no daemon)\nDB_CONNECTION=sqlite\nDB_DATABASE=/home/${tenantUser}/apps/${name || 'website'}/${dbName || 'database'}.sqlite`;
    }
    const host = '127.0.0.1';
    const port = activeDbVersion?.port ?? 0;
    if (dbType === 'postgres') {
      return `${base}\nDB_CONNECTION=pgsql\nDB_HOST=${host}\nDB_PORT=${port}\nDB_DATABASE=${dbName}\nDB_USERNAME=${dbUser}\nDB_PASSWORD=${dbPassword}`;
    }
    if (dbType === 'mysql' || dbType === 'mariadb') {
      return `${base}\nDB_CONNECTION=mysql\nDB_HOST=${host}\nDB_PORT=${port}\nDB_DATABASE=${dbName}\nDB_USERNAME=${dbUser}\nDB_PASSWORD=${dbPassword}`;
    }
    if (dbType === 'mongodb') {
      return `${base}\nMONGODB_URI="mongodb://${dbUser}:${dbPassword}@${host}:${port}/${dbName}?authSource=admin"`;
    }
    return `${base}\nREDIS_HOST=${host}\nREDIS_PORT=${port}\nREDIS_PASSWORD=${dbPassword}`;
  }, [createDb, dbType, dbName, dbUser, dbPassword, domain, name, tenantUser, isSqlite, activeDbVersion]);

  const getGeneratedConfig = () => {
    const dName = domain || 'example.com';
    const upTarget = appMode === 'proxy' ? upstreamUrl || 'http://127.0.0.1:8080' : `http://127.0.0.1:${defaultPortFor(runtime)}`;

    if (webServer === 'caddy') {
      return `${dName} {
    tls {
        issuer lets_encrypt
    }
    reverse_proxy ${upTarget.replace(/^https?:\/\//, '')} {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}`;
    }

    if (webServer === 'openlitespeed') {
      return `extprocessor ${name || 'website'}_proxy {
    type proxy
    address ${upTarget.replace(/^https?:\/\//, '')}
    maxConns 200
    initTimeout 60
    retryTimeout 0
}

context / {
    type proxy
    handler ${name || 'website'}_proxy
    addDefaultCharset off
}`;
    }

    if (webServer === 'apache') {
      const cleanUp = upTarget.replace(/^https?:\/\//, '');
      return `<VirtualHost *:80 *:443>
    ServerName ${dName}
    ProxyPreserveHost ${proxyPreserveHost ? 'On' : 'Off'}
    ProxyRequests Off
    Timeout ${proxyTimeoutSecs}

    <Location />
${proxyWebsocket ? `        RewriteEngine On
        RewriteCond %{HTTP:Upgrade} websocket [NC]
        RewriteCond %{HTTP:Connection} upgrade [NC]
        RewriteRule ^/?(.*) "ws://${cleanUp}/$1" [P,L]
` : ''}        ProxyPass ${upTarget}/
        ProxyPassReverse ${upTarget}/
    </Location>
</VirtualHost>`;
    }

    return `server {
    listen 80;
    listen 443 ssl http2;
    server_name ${dName};

    ssl_certificate /etc/letsencrypt/live/${dName}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${dName}/privkey.pem;

    client_max_body_size ${clientMaxBodyMB}M;

    location / {
        proxy_pass ${upTarget};
        proxy_http_version 1.1;
${proxyWebsocket ? '        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection "upgrade";\n' : ''}${proxyPreserveHost ? '        proxy_set_header Host $host;\n' : ''}${proxyRealIp ? '        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n' : ''}        proxy_read_timeout ${proxyTimeoutSecs}s;
    }
}`;
  };

  if (!isOpen) return null;

  const canContinue =
    (currentStepId !== 'basics' || (name.trim() !== '' && domainValid)) &&
    (currentStepId !== 'source' || sourceValidForMode);

  const next = () => setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  const handleDeploy = () => {
    const resolvedPort = appMode === 'proxy'
      ? Number((upstreamUrl.match(/:(\d+)/) || [])[1] || 8080)
      : defaultPortFor(runtime);

    const buildScript =
      effectiveSource === 'github'
        ? `git pull origin ${gitBranch || 'main'}\n${plan.steps.join('\n')}`
        : plan.steps.join('\n');

    onAddApp({
      name,
      domain,
      runtime,
      version,
      framework,
      webServer,
      tenantUser,
      tunnelEnabled,
      ssl: true,
      port: resolvedPort,
      memoryUsage: '36 MB',
      cpuUsage: '0.1%',
      status: 'running',
      upstreamUrl: appMode === 'proxy' ? upstreamUrl : undefined,
      proxyWebsocket,
      proxyPreserveHost,
      proxyRealIp,
      proxyTimeoutSecs,
      dbAutoProvision: createDb,
      dbEngine: createDb ? dbType : undefined,
      dbName: createDb ? dbName || `${name}_db` : undefined,
      dbUser: createDb ? dbUser : undefined,
      autoEnv,
      provisionMode: effectiveSource === 'scaffold' ? 'download' : 'generic',
      automationSteps: plan.steps.length ? plan.steps : undefined,
      gitRepo: effectiveSource === 'github' ? gitRepo : undefined,
      gitBranch: effectiveSource === 'github' ? gitBranch : undefined,
      autoDeploy: effectiveSource === 'github' ? autoDeploy : undefined,
      buildScript: buildScript || undefined,
    });

    onClose();
    resetForm();
  };

  const resetForm = () => {
    setStepIndex(0);
    setName('');
    setDomain('');
  };

  const inputClass =
    'w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500';
  const cardChoice = (active: boolean) =>
    active ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/15' : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Deploy New Website</h2>
              <p className="text-xs text-slate-500">Guided setup — engine, runtime, source, database and automation.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-3 border-b border-slate-100 flex items-center gap-1.5 overflow-x-auto shrink-0">
          {steps.map((s, i) => {
            const state = i === stepIndex ? 'active' : i < stepIndex ? 'done' : 'todo';
            return (
              <button
                key={s.id}
                onClick={() => i <= stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  state === 'active'
                    ? 'bg-blue-600 text-white'
                    : state === 'done'
                      ? 'bg-blue-50 text-blue-700 cursor-pointer'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${state === 'active' ? 'bg-white/20' : state === 'done' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* STEP: BASICS */}
          {currentStepId === 'basics' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'standard' as const, label: 'Full Web App', sub: 'PHP · Python · Node', icon: Zap },
                  { id: 'proxy' as const, label: 'Reverse Proxy', sub: 'Forward port / IP', icon: ArrowRightLeft },
                  { id: 'static' as const, label: 'Static / SPA', sub: 'HTML · Vite · Astro', icon: Globe },
                ].map((mode) => {
                  const Icon = mode.icon;
                  const active = appMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => handleModeSwitch(mode.id)}
                      className={`flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl border text-center transition-all ${cardChoice(active)}`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold leading-tight">{mode.label}</span>
                      <span className="text-[10px] text-slate-400 leading-tight">{mode.sub}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Website Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. larastore-commerce" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Domain (FQDN)</label>
                  <input
                    type="text"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    placeholder="app.example.com"
                    className={`${inputClass} ${
                      domain.trim() !== '' && !domainValid ? 'border-rose-400 focus:border-rose-500 bg-rose-50/40' : ''
                    }`}
                  />
                  {domain.trim() !== '' && !domainValid && (
                    <p className="text-[11px] text-rose-600 mt-1">
                      Enter a valid domain without a scheme, e.g. <code className="font-mono">app.example.com</code>
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Isolated Tenant User</label>
                  <select value={tenantUser} onChange={(e) => setTenantUser(e.target.value)} className={inputClass}>
                    <option value="farras">farras (Root Tenant)</option>
                    <option value="tenant_alex">tenant_alex (Isolated Jail)</option>
                    <option value="tenant_clientB">tenant_clientB (Isolated Jail)</option>
                  </select>
                </div>
                <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                  <input type="checkbox" checked={tunnelEnabled} onChange={(e) => setTunnelEnabled(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-blue-600" />
                  <span className="text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-blue-500" /> Cloudflare Tunnel (Zero-NAT)
                    </span>
                    <span className="text-slate-500 block mt-0.5">Publish the domain without a public IP or port forwarding.</span>
                  </span>
                </label>
              </div>
            </>
          )}

          {/* STEP: ENGINE & RUNTIME */}
          {currentStepId === 'engine' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Web Server Engine</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'openlitespeed' as WebServerType, label: 'OpenLiteSpeed', desc: 'LSCache + PHP/WP' },
                    { id: 'nginx' as WebServerType, label: 'Nginx', desc: 'High concurrency' },
                    { id: 'caddy' as WebServerType, label: 'Caddy', desc: 'Auto HTTPS & HTTP/3' },
                    { id: 'apache' as WebServerType, label: 'Apache 2.4', desc: '.htaccess compat' },
                  ].map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => setWebServer(ws.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${cardChoice(webServer === ws.id)}`}
                    >
                      <span className="text-xs font-bold block">{ws.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{ws.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {appMode === 'standard' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Language & Runtime</label>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { id: 'python' as RuntimeType, label: 'Python' },
                        { id: 'php' as RuntimeType, label: 'PHP' },
                        { id: 'nodejs' as RuntimeType, label: 'Node.js' },
                        { id: 'go' as RuntimeType, label: 'Golang' },
                        { id: 'rust' as RuntimeType, label: 'Rust' },
                        { id: 'ruby' as RuntimeType, label: 'Ruby' },
                      ].map((item) => {
                        const RuntimeIcon = runtimeIcon[item.id] ?? Code2;
                        const active = runtime === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleRuntimeChange(item.id)}
                            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${cardChoice(active)}`}
                          >
                            <RuntimeIcon className="w-4 h-4" />
                            <span className="text-[11px]">{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Framework / Template</label>
                      <select value={framework} onChange={(e) => setFramework(e.target.value)} className={inputClass}>
                        {availableFrameworks.map((fw) => (
                          <option key={fw} value={fw}>{fw}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Runtime Version <span className="text-slate-400 font-normal">({runtime.toUpperCase()})</span>
                      </label>
                      <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass}>
                        {runtimeConfigs[runtime].versions.map((ver) => (
                          <option key={ver} value={ver}>{ver}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {isGenericFramework ? (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600 flex items-start gap-2">
                      <FolderOpen className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <span>Bring your own code — choose GitHub, Upload or Existing files in the next step.</span>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs space-y-1.5">
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Download className="w-3.5 h-3.5 text-slate-500" />
                        {plan.mode === 'download' ? 'This template will be downloaded' : 'No automatic download'}
                      </span>
                      {plan.install && <code className="block font-mono text-[11px] text-blue-700 bg-white border border-slate-200 rounded px-2 py-1">{plan.install}</code>}
                      <p className="text-[11px] text-slate-500">{plan.note}</p>
                    </div>
                  )}
                </>
              )}

              {appMode === 'static' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Static Template</label>
                    <select value={framework} onChange={(e) => setFramework(e.target.value)} className={inputClass}>
                      {runtimeConfigs.static.frameworks.map((fw) => (
                        <option key={fw} value={fw}>{fw}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Build Tool Version</label>
                    <select value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass}>
                      {runtimeConfigs.static.versions.map((ver) => (
                        <option key={ver} value={ver}>{ver}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP: SOURCE */}
          {currentStepId === 'source' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ...(plan.mode === 'download'
                    ? [{ id: 'scaffold' as SourceKind, label: 'Scaffold / Download', icon: Download }]
                    : []),
                  { id: 'github' as SourceKind, label: 'GitHub Repository', icon: GitBranch },
                  { id: 'upload' as SourceKind, label: 'Upload Archive', icon: Upload },
                  { id: 'existing' as SourceKind, label: 'Existing Files', icon: FolderOpen },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = effectiveSource === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSourceKind(opt.id)}
                      className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border transition-all ${cardChoice(active)}`}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-[11px] font-bold leading-tight">{opt.label}</span>
                    </button>
                  );
                })}
              </div>

              {effectiveSource === 'scaffold' && (
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs space-y-1.5">
                  <p className="text-slate-600">
                    The panel downloads <strong>{framework}</strong> ({version}) into <code className="font-mono">/home/{tenantUser}/apps/{name || '<website>'}</code>.
                  </p>
                  {plan.install ? (
                    <code className="block font-mono text-[11px] text-blue-700 bg-white border border-slate-200 rounded px-2 py-1">{plan.install}</code>
                  ) : (
                    <p className="text-amber-700">No automated download for this template — use GitHub or Upload instead.</p>
                  )}
                </div>
              )}

              {effectiveSource === 'github' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Repository URL</label>
                    <input type="text" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} placeholder="https://github.com/user/repo" className={inputClass} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Branch</label>
                      <input type="text" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} className={inputClass} />
                    </div>
                    <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                      <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                      <span className="font-semibold text-slate-700">Auto-deploy on push (webhook)</span>
                    </label>
                  </div>
                </div>
              )}

              {effectiveSource === 'upload' && (
                <div className="p-5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 text-center space-y-2">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-600">Drop a <code className="font-mono">.zip</code> / <code className="font-mono">.tar.gz</code> archive (or upload it later in File Manager).</p>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadFile ? uploadFile : 'Choose archive'}</span>
                    <input
                      type="file"
                      accept=".zip,.tar,.gz,.tgz"
                      className="hidden"
                      onChange={(e) => setUploadFile(e.target.files?.[0]?.name ?? null)}
                    />
                  </label>
                  <p className="text-[10px] text-slate-400">The archive is extracted into the website directory on deploy.</p>
                </div>
              )}

              {effectiveSource === 'existing' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Existing directory</label>
                    <div className="flex items-center gap-2">
                      <input type="text" value={existingPath} readOnly className={`${inputClass} font-mono text-slate-500`} />
                      <button
                        type="button"
                        onClick={checkExistingDir}
                        disabled={dirCheck === 'checking' || !name.trim()}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap disabled:opacity-40"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${dirCheck === 'checking' ? 'animate-spin' : ''}`} />
                        <span>Check</span>
                      </button>
                    </div>
                  </div>

                  {dirCheck === 'ok' && (
                    <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-start gap-2">
                      <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span>Directory found. Only dependencies and build steps will run.</span>
                    </div>
                  )}

                  {dirCheck === 'missing' && (
                    <div className="p-3 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-800 flex items-start gap-2">
                      <X className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <span>
                        Directory not found at <code className="font-mono">{existingPath}</code>. Deploy cannot continue — upload your code, use a GitHub repository, or scaffold a template instead.
                      </span>
                    </div>
                  )}

                  {dirCheck === 'idle' && (
                    <p className="text-[11px] text-slate-400">Run the check to confirm the directory exists before continuing.</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* STEP: DATABASE & CACHE */}
          {currentStepId === 'database' && (
            <>
              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                <input type="checkbox" checked={createDb} onChange={(e) => setCreateDb(e.target.checked)} className="mt-0.5 rounded border-slate-300 text-blue-600" />
                <span className="text-xs">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-slate-700" /> Auto-provision database / cache
                  </span>
                  <span className="text-slate-500 block mt-0.5">Creates the database, a dedicated user with the password below, and writes it into .env.</span>
                </span>
              </label>

              {createDb && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {(['postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlite'] as DatabaseEngine[]).map((engineId) => {
                      const DbIcon = dbIcon[engineId] ?? Database;
                      return (
                        <button
                          key={engineId}
                          type="button"
                          onClick={() => { setDbType(engineId); setDbVersionIndex(0); }}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] transition-all ${cardChoice(dbType === engineId)}`}
                        >
                          <DbIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{ENGINE_LABELS[engineId]}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Version &amp; Port</label>
                      <select value={dbVersionIndex} onChange={(e) => setDbVersionIndex(Number(e.target.value))} className={`${inputClass} font-mono`}>
                        {dbVersions.map((opt, i) => (
                          <option key={opt.version} value={i}>{opt.label} — {opt.statusText}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Database Name</label>
                      <input type="text" value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder={`${name || 'website'}_db`} className={`${inputClass} font-mono`} />
                    </div>
                  </div>

                  {!isSqlite && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                        <input type="text" value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder={`${tenantUser}_user`} className={`${inputClass} font-mono`} />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                        <div className="relative">
                          <input
                            type={showDbPassword ? 'text' : 'password'}
                            value={dbPassword}
                            onChange={(e) => setDbPassword(e.target.value)}
                            className={`${inputClass} pr-14 font-mono`}
                          />
                          <div className="absolute right-2 top-1.5 flex items-center gap-1">
                            <button type="button" onClick={() => setShowDbPassword((v) => !v)} className="p-1 text-slate-400 hover:text-slate-600" title="Show/hide">
                              {showDbPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button type="button" onClick={() => setDbPassword('bp_' + Math.random().toString(36).slice(2, 14))} className="p-1 text-slate-400 hover:text-blue-600" title="Generate">
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Max Connections</label>
                        <select value={maxConnections} onChange={(e) => setMaxConnections(Number(e.target.value))} className={inputClass}>
                          <option value={15}>15</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {isSqlite && (
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 text-xs text-slate-600 flex items-start gap-2">
                      <KeyRound className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                      <span>SQLite is file-based (no daemon, no credentials). The database file is created inside the website directory and referenced from .env.</span>
                    </div>
                  )}

                  <label className="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={autoEnv} onChange={(e) => setAutoEnv(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                    <span className="font-semibold">Generate <code className="font-mono">.env</code> automatically from this database</span>
                  </label>

                  {autoEnv && envPreview && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Generated .env preview</label>
                      <pre className="p-3 bg-slate-950 text-emerald-300 font-mono text-[11px] rounded-xl border border-slate-800 overflow-x-auto leading-relaxed">{envPreview}</pre>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* STEP: UPSTREAM (proxy mode) */}
          {currentStepId === 'upstream' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Upstream URL / IP</label>
                <input type="text" value={upstreamUrl} onChange={(e) => setUpstreamUrl(e.target.value)} className={`${inputClass} font-mono`} />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[
                    { label: '3000 (Node/Next)', val: 'http://127.0.0.1:3000' },
                    { label: '8080 (FastAPI/Go)', val: 'http://127.0.0.1:8080' },
                    { label: '5000 (Flask/Py)', val: 'http://127.0.0.1:5000' },
                    { label: '5678 (n8n Pod)', val: 'http://127.0.0.1:5678' },
                    { label: '9000 (Portainer)', val: 'http://127.0.0.1:9000' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setUpstreamUrl(preset.val)}
                      className="px-2 py-1 text-[10px] font-mono rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyWebsocket} onChange={(e) => setProxyWebsocket(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5 text-slate-500" /> WebSocket upgrade</span>
                </label>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyPreserveHost} onChange={(e) => setProxyPreserveHost(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700">Preserve Host header</span>
                </label>
                <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer text-xs">
                  <input type="checkbox" checked={proxyRealIp} onChange={(e) => setProxyRealIp(e.target.checked)} className="rounded border-slate-300 text-blue-600" />
                  <span className="font-semibold text-slate-700">Forward client IP</span>
                </label>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Timeout</label>
                  <select value={proxyTimeoutSecs} onChange={(e) => setProxyTimeoutSecs(Number(e.target.value))} className={inputClass}>
                    <option value={60}>60s (standard)</option>
                    <option value={180}>180s (long-polling)</option>
                    <option value={300}>300s (streaming)</option>
                    <option value={600}>600s (heavy export)</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* STEP: REVIEW */}
          {currentStepId === 'review' && (
            <>
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                {[
                  ['Type', appMode === 'proxy' ? 'Reverse proxy' : appMode === 'static' ? 'Static / SPA' : 'Full web app'],
                  ['Name', name || '—'],
                  ['Domain', domain || '—'],
                  ['Tenant user', tenantUser],
                  ...(appMode !== 'proxy'
                    ? ([
                        ['Web server', webServer.toUpperCase()],
                        ['Runtime', `${runtime.toUpperCase()} ${version}`],
                        ['Framework', framework],
                        ['Source', effectiveSource === 'scaffold' ? 'Scaffold / download' : effectiveSource === 'github' ? `GitHub ${gitRepo || '(repo)'} @ ${gitBranch}` : effectiveSource === 'upload' ? `Upload ${uploadFile ?? '(archive)'}` : 'Existing files'],
                      ] as [string, string][])
                    : ([['Upstream', upstreamUrl]] as [string, string][])),
                  ...(appMode === 'standard'
                    ? ([['Database', createDb ? `${ENGINE_LABELS[dbType]}${isSqlite ? '' : ` :${activeDbVersion?.port}`} → ${dbName || `${name}_db`}` : 'None']] as [string, string][])
                    : []),
                  ['Cloudflare Tunnel', tunnelEnabled ? 'Enabled' : 'Disabled'],
                ].map(([label, value]) => (
                  <div key={label} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span className="text-slate-400">{label}</span>
                    <span className="font-semibold text-slate-800 text-right truncate">{value}</span>
                  </div>
                ))}
              </div>

              {appMode === 'standard' && plan.steps.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 text-xs space-y-1.5">
                  <span className="font-semibold text-slate-800 block">Post-deploy automation</span>
                  {plan.steps.map((step) => (
                    <div key={step} className="flex items-center gap-2 text-slate-600">
                      <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <code className="font-mono text-[11px] truncate">{step}</code>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-300 text-xs font-mono">
                    <Code2 className="w-4 h-4 text-purple-400" />
                    <span>{webServer.toUpperCase()} VirtualHost preview</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(getGeneratedConfig());
                      setCopiedConfig(true);
                      setTimeout(() => setCopiedConfig(false), 2000);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg text-slate-300 hover:bg-slate-800"
                  >
                    {copiedConfig ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedConfig ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-purple-300 overflow-x-auto leading-relaxed max-h-48">{getGeneratedConfig()}</pre>
              </div>

              <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                Everything runs inside the <code className="font-mono">{tenantUser}</code> jail with cgroup v2 quotas.
              </p>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={back}
            disabled={stepIndex === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Back</span>
          </button>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">
              Cancel
            </button>
            {currentStepId === 'review' ? (
              <button
                type="button"
                onClick={handleDeploy}
                disabled={!sourceValidForMode}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Server className="w-3.5 h-3.5" />
                <span>Deploy Website</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={next}
                disabled={!canContinue}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40"
              >
                <span>Continue</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
