import React, { useState } from 'react';
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
  Sparkles,
  Zap,
  ArrowRightLeft,
  Wifi,
  Copy,
  Code2
} from 'lucide-react';
import type { RuntimeType, WebApp, WebServerType, DatabaseEngine } from '../types';

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddApp: (newApp: Partial<WebApp>) => void;
}

export const AddAppModal: React.FC<AddAppModalProps> = ({ isOpen, onClose, onAddApp }) => {
  // App Mode: standard app (language runtime) vs pure reverse proxy vs static site
  const [appMode, setAppMode] = useState<'standard' | 'proxy' | 'static'>('standard');

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [runtime, setRuntime] = useState<RuntimeType>('python');
  const [framework, setFramework] = useState('Flask');
  const [version, setVersion] = useState('3.12');
  const [webServer, setWebServer] = useState<WebServerType>('openlitespeed');
  const [tenantUser, setTenantUser] = useState('farras');
  const [tunnelEnabled, setTunnelEnabled] = useState(true);
  const [createDb, setCreateDb] = useState(true);
  const [dbType, setDbType] = useState<DatabaseEngine>('mongodb');

  // Reverse Proxy Specific State
  const [upstreamUrl, setUpstreamUrl] = useState('http://127.0.0.1:8080');
  const [proxyWebsocket, setProxyWebsocket] = useState(true);
  const [proxyPreserveHost, setProxyPreserveHost] = useState(true);
  const [proxyRealIp, setProxyRealIp] = useState(true);
  const [proxyTimeoutSecs, setProxyTimeoutSecs] = useState(60);
  const [clientMaxBodyMB, setClientMaxBodyMB] = useState(100);
  const [copiedConfig, setCopiedConfig] = useState(false);

  if (!isOpen) return null;

  const runtimeConfigs: Record<RuntimeType, { versions: string[]; frameworks: string[] }> = {
    php: {
      versions: ['8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
      frameworks: [
        'Generic',
        'CakePHP 5',
        'CodeIgniter 4',
        'Contao 4',
        'Drupal 10',
        'Drupal 11',
        'Joomla 6',
        'Laminas',
        'Laravel 12',
        'Laravel 13',
        'Magento 2',
        'Matomo 5',
        'Mautic 7',
        'Moodle 5',
        'Neos 9',
        'Nextcloud 34',
        'OwnCloud 12',
        'PrestaShop 1.7',
        'Shopware 6',
        'Slim 4',
        'Symfony 7',
        'Symfony 8',
        'TYPO3 14',
        'WHMCS',
        'WooCommerce',
        'WordPress',
        'Yii 2'
      ]
    },
    python: {
      versions: ['3.12', '3.11', '3.10'],
      frameworks: ['Flask', 'FastAPI', 'Django', 'Custom Python']
    },
    nodejs: {
      versions: ['22 LTS', '20 LTS', '18'],
      frameworks: ['Next.js', 'Express', 'NestJS', 'Astro', 'Custom Node']
    },
    go: {
      versions: ['1.23', '1.22'],
      frameworks: ['Gin', 'Fiber', 'Standard HTTP']
    },
    rust: {
      versions: ['1.81', '1.80'],
      frameworks: ['Axum', 'Actix-web']
    },
    ruby: {
      versions: ['3.3', '3.2'],
      frameworks: ['Ruby on Rails', 'Sinatra']
    },
    docker: {
      versions: ['Latest'],
      frameworks: ['Custom Containerfile']
    },
    static: {
      versions: ['HTML5'],
      frameworks: ['Static Web App', 'Vite Dist', 'Astro Static']
    },
    proxy: {
      versions: ['v1.0'],
      frameworks: ['Reverse Proxy Forwarder']
    }
  };

  const handleRuntimeChange = (selectedRuntime: RuntimeType) => {
    setRuntime(selectedRuntime);
    const cfg = runtimeConfigs[selectedRuntime];
    setVersion(cfg.versions[0] || 'latest');
    setFramework(cfg.frameworks[0] || 'Standard');
    if (selectedRuntime === 'php') {
      setDbType('mysql');
      setWebServer('openlitespeed');
    } else if (selectedRuntime === 'python') {
      setDbType('postgres');
      setWebServer('nginx');
    } else if (selectedRuntime === 'nodejs') {
      setDbType('mongodb');
      setWebServer('caddy');
    }
  };

  const handleModeSwitch = (mode: 'standard' | 'proxy' | 'static') => {
    setAppMode(mode);
    if (mode === 'proxy') {
      setRuntime('proxy');
      setVersion('v1.0');
      setFramework('Reverse Proxy (Upstream)');
      setWebServer('nginx'); // default best for reverse proxy
      setCreateDb(false);
    } else if (mode === 'static') {
      setRuntime('static');
      setVersion('HTML5');
      setFramework('Static Web App');
      setWebServer('caddy');
      setCreateDb(false);
    } else {
      setRuntime('python');
      setVersion('3.12');
      setFramework('Flask');
      setWebServer('openlitespeed');
      setCreateDb(true);
    }
  };

  // Extract numeric port from upstreamUrl if possible
  const getPortFromUpstream = (url: string): number => {
    try {
      const match = url.match(/:(\d+)/);
      return match ? parseInt(match[1], 10) : 8080;
    } catch {
      return 8080;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !domain) return;

    if (appMode === 'proxy') {
      const parsedPort = getPortFromUpstream(upstreamUrl);
      onAddApp({
        name,
        domain,
        runtime: 'proxy',
        version: 'v1.0',
        framework: 'Reverse Proxy (Upstream)',
        webServer,
        tenantUser,
        tunnelEnabled,
        ssl: true,
        port: parsedPort,
        upstreamUrl,
        proxyWebsocket,
        proxyPreserveHost,
        proxyRealIp,
        proxyTimeoutSecs,
        memoryUsage: '14 MB',
        cpuUsage: '0.1%',
        status: 'running',
        tunnelRoute: tunnelEnabled ? `${domain} -> ${upstreamUrl.replace(/^https?:\/\//, '')}` : undefined,
      });
    } else {
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
        port: 8000 + Math.floor(Math.random() * 900),
        memoryUsage: '36 MB',
        cpuUsage: '0.1%',
        status: 'running',
      });
    }

    onClose();
  };

  // Generated config preview string
  const getGeneratedConfig = () => {
    const dName = domain || 'example.com';
    const upTarget = upstreamUrl || 'http://127.0.0.1:8080';

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
      return `extprocessor ${name || 'app'}_proxy {
    type proxy
    address ${upTarget.replace(/^https?:\/\//, '')}
    maxConns 200
    initTimeout 60
    retryTimeout 0
}

context / {
    type proxy
    handler ${name || 'app'}_proxy
    addDefaultCharset off
}`;
    }

    if (webServer === 'apache') {
      const cleanUp = upTarget.replace(/^https?:\/\//, '');
      return `# ==============================================================================
# Apache 2.4 VirtualHost Reverse Proxy Configuration
# Domain: ${dName} | Generated by BarePod Panel Daemon
# ==============================================================================
<VirtualHost *:80 *:443>
    ServerName ${dName}
    ProxyPreserveHost ${proxyPreserveHost ? 'On' : 'Off'}
    ProxyRequests Off
    Timeout ${proxyTimeoutSecs}

    <Location />
${proxyWebsocket ? `        RewriteEngine On
        RewriteCond %{HTTP:Upgrade} websocket [NC]
        RewriteCond %{HTTP:Connection} upgrade [NC]
        RewriteRule ^/?(.*) "ws://${cleanUp}/$1" [P,L]
` : ''}${proxyRealIp ? `        RequestHeader set X-Real-IP %{REMOTE_ADDR}s
        RequestHeader set X-Forwarded-For %{REMOTE_ADDR}s
        RequestHeader set X-Forwarded-Proto %{REQUEST_SCHEME}s
` : ''}        ProxyPass ${upTarget}/
        ProxyPassReverse ${upTarget}/
    </Location>
</VirtualHost>`;
    }

    // Default Nginx
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
${proxyWebsocket ? `        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";\n` : ''}${proxyPreserveHost ? `        proxy_set_header Host $host;\n` : ''}${proxyRealIp ? `        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;\n` : ''}        proxy_read_timeout ${proxyTimeoutSecs}s;
        proxy_connect_timeout 15s;
    }
}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Deploy New App or Microservice</h2>
              <p className="text-xs text-slate-500">Choose web server (OLS/Nginx/Caddy/Apache) & runtime framework</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* App Mode Switcher */}
          <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleModeSwitch('standard')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                appMode === 'standard'
                  ? 'bg-white text-blue-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Full Web App (PHP / Python / Node)</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeSwitch('proxy')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                appMode === 'proxy'
                  ? 'bg-white text-purple-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>Reverse Proxy Only (Forward Port/IP)</span>
            </button>

            <button
              type="button"
              onClick={() => handleModeSwitch('static')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all ${
                appMode === 'static'
                  ? 'bg-white text-emerald-600 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Static HTML / SPA</span>
            </button>
          </div>

          {/* App Name & Domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {appMode === 'proxy' ? 'Proxy Identifier Name' : 'App Name'}
              </label>
              <input
                type="text"
                required
                placeholder={appMode === 'proxy' ? 'e.g. docker-n8n-proxy' : 'e.g. flask-sentiment-api'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Domain Name (FQDN)
              </label>
              <input
                type="text"
                required
                placeholder={appMode === 'proxy' ? 'api.domain.com' : 'app.sentiment.id'}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono"
              />
            </div>
          </div>

          {/* ============================================================ */}
          {/* MODE 1: REVERSE PROXY ONLY CONFIGURATION                     */}
          {/* ============================================================ */}
          {appMode === 'proxy' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Upstream Destination URL */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Target Upstream Destination (Internal Port / IP / UNIX Socket)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={upstreamUrl}
                    onChange={(e) => setUpstreamUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8080 or unix:/run/app.sock"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-purple-200 rounded-lg font-mono text-purple-900 focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                  />
                </div>
                
                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-slate-400 font-medium">Quick Presets:</span>
                  {[
                    { label: '3000 (Node/Next)', val: 'http://127.0.0.1:3000' },
                    { label: '8080 (FastAPI/Go)', val: 'http://127.0.0.1:8080' },
                    { label: '5000 (Flask/Py)', val: 'http://127.0.0.1:5000' },
                    { label: '5678 (n8n Pod)', val: 'http://127.0.0.1:5678' },
                    { label: '9000 (Portainer)', val: 'http://127.0.0.1:9000' },
                    { label: 'Remote LAN (10.0.0.5)', val: 'http://10.0.0.5:8000' },
                  ].map(p => (
                    <button
                      type="button"
                      key={p.val}
                      onClick={() => setUpstreamUrl(p.val)}
                      className="px-2 py-0.5 text-[10px] font-mono bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-md transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Web Server Engine Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Reverse Proxy Server Engine
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'nginx' as WebServerType, label: 'Nginx', desc: 'Top Recommendation (Most Stable)' },
                    { id: 'caddy' as WebServerType, label: 'Caddy', desc: 'Auto HTTPS & HTTP/3 QUIC' },
                    { id: 'openlitespeed' as WebServerType, label: 'OpenLiteSpeed', desc: 'LSCache Reverse Proxy' },
                    { id: 'apache' as WebServerType, label: 'Apache 2.4', desc: 'mod_proxy / ProxyPass' },
                  ].map((ws) => (
                    <button
                      type="button"
                      key={ws.id}
                      onClick={() => setWebServer(ws.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        webServer === ws.id
                          ? 'border-purple-600 bg-purple-50/80 text-purple-900 ring-2 ring-purple-500/15'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="text-xs font-bold block">{ws.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{ws.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Proxy Protocol & Header Features */}
              <div className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/30 space-y-3">
                <span className="text-xs font-bold text-slate-800 block">
                  Ingress & Reverse Proxy Protocol Features
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="flex items-start gap-2.5 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200">
                    <input
                      type="checkbox"
                      checked={proxyWebsocket}
                      onChange={(e) => setProxyWebsocket(e.target.checked)}
                      className="mt-0.5 rounded text-purple-600 border-slate-300"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                        <Wifi className="w-3.5 h-3.5 text-purple-600" />
                        WebSocket Upgrade
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Supports socket.io, Live Chat, Vite HMR, Streamlit, and SSE.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200">
                    <input
                      type="checkbox"
                      checked={proxyPreserveHost}
                      onChange={(e) => setProxyPreserveHost(e.target.checked)}
                      className="mt-0.5 rounded text-purple-600 border-slate-300"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800">
                        Preserve Host Header ($host)
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Forwards the client's original domain to the backend app.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200">
                    <input
                      type="checkbox"
                      checked={proxyRealIp}
                      onChange={(e) => setProxyRealIp(e.target.checked)}
                      className="mt-0.5 rounded text-purple-600 border-slate-300"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800">
                        Forward Real Client IP
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        X-Real-IP, X-Forwarded-For, & X-Forwarded-Proto.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 cursor-pointer bg-white p-2.5 rounded-lg border border-slate-200">
                    <input
                      type="checkbox"
                      checked={tunnelEnabled}
                      onChange={(e) => setTunnelEnabled(e.target.checked)}
                      className="mt-0.5 rounded text-purple-600 border-slate-300"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1">
                        <CloudRain className="w-3.5 h-3.5 text-blue-500" />
                        Cloudflare Zero-NAT Tunnel
                      </span>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Expose the domain without opening public ports 80/443.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Proxy Read Timeout
                    </label>
                    <select
                      value={proxyTimeoutSecs}
                      onChange={(e) => setProxyTimeoutSecs(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    >
                      <option value={60}>60 seconds (Standard API)</option>
                      <option value={180}>180 seconds (Long Polling)</option>
                      <option value={300}>300 seconds (AI Streaming / LLM)</option>
                      <option value={600}>600 seconds (Heavy Upload / ETL)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Client Max Body Size (Upload Limit)
                    </label>
                    <select
                      value={clientMaxBodyMB}
                      onChange={(e) => setClientMaxBodyMB(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    >
                      <option value={20}>20 MB</option>
                      <option value={100}>100 MB (Standard)</option>
                      <option value={250}>250 MB</option>
                      <option value={1024}>1024 MB (1 GB)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live VirtualHost Preview */}
              <div className="rounded-xl border border-slate-200 bg-slate-950 overflow-hidden">
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-slate-400 text-xs font-mono">
                    <Code2 className="w-3.5 h-3.5 text-purple-400" />
                    <span>Generated {webServer.toUpperCase()} Vhost Configuration</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getGeneratedConfig());
                      setCopiedConfig(true);
                      setTimeout(() => setCopiedConfig(false), 2000);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded text-slate-300 hover:bg-slate-800"
                  >
                    {copiedConfig ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedConfig ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <pre className="p-3 text-[11px] font-mono text-purple-300 overflow-x-auto leading-relaxed max-h-40">
                  {getGeneratedConfig()}
                </pre>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* MODE 2: STANDARD WEB APP (PHP / PYTHON / NODE / GO / ETC)    */}
          {/* ============================================================ */}
          {appMode === 'standard' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Web Server Engine Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Web Server & Reverse Proxy Engine
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'openlitespeed' as WebServerType, label: 'OpenLiteSpeed', desc: 'LSCache + Ultra PHP/WP' },
                    { id: 'nginx' as WebServerType, label: 'Nginx', desc: 'Standard High Concurrency' },
                    { id: 'caddy' as WebServerType, label: 'Caddy', desc: 'Auto HTTPS & HTTP/3' },
                    { id: 'apache' as WebServerType, label: 'Apache 2.4', desc: '.htaccess Compatibility' },
                  ].map((ws) => (
                    <button
                      type="button"
                      key={ws.id}
                      onClick={() => setWebServer(ws.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        webServer === ws.id
                          ? 'border-blue-600 bg-blue-50/80 text-blue-900 ring-2 ring-blue-500/15'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="text-xs font-bold block">{ws.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{ws.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Runtime Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Select Language & Runtime
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { id: 'python' as RuntimeType, label: 'Python', code: 'PY', accent: 'bg-blue-100 text-blue-700' },
                    { id: 'php' as RuntimeType, label: 'PHP', code: 'PHP', accent: 'bg-indigo-100 text-indigo-700' },
                    { id: 'nodejs' as RuntimeType, label: 'Node.js', code: 'JS', accent: 'bg-emerald-100 text-emerald-700' },
                    { id: 'go' as RuntimeType, label: 'Golang', code: 'GO', accent: 'bg-cyan-100 text-cyan-700' },
                    { id: 'rust' as RuntimeType, label: 'Rust', code: 'RS', accent: 'bg-orange-100 text-orange-700' },
                    { id: 'ruby' as RuntimeType, label: 'Ruby', code: 'RB', accent: 'bg-rose-100 text-rose-700' },
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => handleRuntimeChange(item.id)}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border transition-all ${
                        runtime === item.id
                          ? 'border-blue-500 bg-blue-50/70 text-blue-800 ring-2 ring-blue-500/10'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold ${item.accent}`}>
                        {item.code}
                      </span>
                      <span className={`text-[11px] ${runtime === item.id ? 'font-bold' : ''}`}>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Framework Template & Version */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Framework / Template
                  </label>
                  <select
                    value={framework}
                    onChange={(e) => setFramework(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                  >
                    {runtimeConfigs[runtime].frameworks.map((fw) => (
                      <option key={fw} value={fw}>
                        {fw}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Version
                  </label>
                  <select
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                  >
                    {runtimeConfigs[runtime].versions.map((ver) => (
                      <option key={ver} value={ver}>
                        {ver}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Isolated Tenant User
                  </label>
                  <select
                    value={tenantUser}
                    onChange={(e) => setTenantUser(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                  >
                    <option value="farras">farras (Root Tenant)</option>
                    <option value="tenant_alex">tenant_alex (Isolated Jail)</option>
                    <option value="tenant_clientB">tenant_clientB (Isolated Jail)</option>
                    <option value="new_tenant">+ Create New Tenant...</option>
                  </select>
                </div>
              </div>


              {/* Database & Cloudflare Tunnel Checkboxes */}
              <div className="space-y-3">
                {/* Database Engine Checkbox */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/40">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createDb}
                      onChange={(e) => setCreateDb(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="text-xs">
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-slate-700" />
                        Auto-Provision Database / Cache Instance
                      </span>
                    </div>
                  </label>

                  {createDb && (
                    <div className="mt-3 pl-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'mongodb' as DatabaseEngine, label: 'MongoDB 7.0', dot: 'bg-emerald-500' },
                        { id: 'redis' as DatabaseEngine, label: 'Redis 7.2', dot: 'bg-rose-500' },
                        { id: 'postgres' as DatabaseEngine, label: 'PostgreSQL 16', dot: 'bg-blue-500' },
                        { id: 'mysql' as DatabaseEngine, label: 'MariaDB 11', dot: 'bg-amber-500' },
                      ].map((engine) => (
                        <button
                          type="button"
                          key={engine.id}
                          onClick={() => setDbType(engine.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] text-left transition-all ${
                            dbType === engine.id
                              ? 'border-blue-600 bg-blue-50 font-bold text-blue-900'
                              : 'border-slate-200 bg-white text-slate-700'
                          }`}
                        >
                          <span className={`w-2 h-2 rounded-full ${engine.dot} shrink-0`} />
                          <span>{engine.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cloudflare Tunnel Checkbox */}
                <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tunnelEnabled}
                    onChange={(e) => setTunnelEnabled(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-blue-500" />
                      Enable Cloudflare Tunnel (Zero-NAT)
                    </span>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Publish the domain without a public IP or port forwarding.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/* MODE 3: STATIC HTML / SPA                                    */}
          {/* ============================================================ */}
          {appMode === 'static' && (
            <div className="space-y-4 animate-in fade-in duration-150">

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">
                  Web Server Engine
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'caddy' as WebServerType, label: 'Caddy', desc: 'Auto HTTPS & Zero Config' },
                    { id: 'nginx' as WebServerType, label: 'Nginx', desc: 'Gzip/Brotli High Speed' },
                    { id: 'openlitespeed' as WebServerType, label: 'OpenLiteSpeed', desc: 'HTTP/3 Ready' },
                    { id: 'apache' as WebServerType, label: 'Apache 2.4', desc: '.htaccess Rewrite' },
                  ].map((ws) => (
                    <button
                      type="button"
                      key={ws.id}
                      onClick={() => setWebServer(ws.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        webServer === ws.id
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/15'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <span className="text-xs font-bold block">{ws.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">{ws.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tunnelEnabled}
                  onChange={(e) => setTunnelEnabled(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <CloudRain className="w-3.5 h-3.5 text-blue-500" />
                    Enable Cloudflare Tunnel (Zero-NAT)
                  </span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Access the static domain globally without a public IP.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className={`px-5 py-2 text-xs font-bold text-white rounded-lg transition-all shadow-sm ${
                appMode === 'proxy'
                  ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-500/20'
                  : appMode === 'static'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                  : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20'
              }`}
            >
              {appMode === 'proxy' ? 'Deploy Reverse Proxy Gateway' : appMode === 'static' ? 'Deploy Static Site' : 'Deploy App Now'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
