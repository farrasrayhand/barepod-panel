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
  Zap
} from 'lucide-react';
import type { RuntimeType, WebApp, WebServerType, DatabaseEngine } from '../types';

interface AddAppModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddApp: (newApp: Partial<WebApp>) => void;
}

export const AddAppModal: React.FC<AddAppModalProps> = ({ isOpen, onClose, onAddApp }) => {
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

  if (!isOpen) return null;

  const runtimeConfigs: Record<RuntimeType, { versions: string[]; frameworks: string[] }> = {
    php: {
      versions: ['8.4', '8.3', '8.2', '8.1'],
      frameworks: ['Laravel', 'WordPress', 'Symfony', 'Custom PHP']
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
      versions: ['v1'],
      frameworks: ['Reverse Proxy Forwarder']
    }
  };

  const handleRuntimeChange = (selectedRuntime: RuntimeType) => {
    setRuntime(selectedRuntime);
    const cfg = runtimeConfigs[selectedRuntime];
    setVersion(cfg.versions[0] || 'latest');
    setFramework(cfg.frameworks[0] || 'Standard');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !domain) return;

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

    onClose();
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
              <p className="text-xs text-slate-500">Pilih Web Server (OLS/Nginx/Caddy/Apache) & runtime framework</p>
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
          {/* App Name & Domain */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                App Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. flask-sentiment-api"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Domain Name
              </label>
              <input
                type="text"
                required
                placeholder="api.sentiment.id"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

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
                { id: 'python' as RuntimeType, label: 'Python', icon: '🐍' },
                { id: 'php' as RuntimeType, label: 'PHP', icon: '🐘' },
                { id: 'nodejs' as RuntimeType, label: 'Node.js', icon: '⚡' },
                { id: 'go' as RuntimeType, label: 'Golang', icon: '🐹' },
                { id: 'rust' as RuntimeType, label: 'Rust', icon: '🦀' },
                { id: 'ruby' as RuntimeType, label: 'Ruby', icon: '💎' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => handleRuntimeChange(item.id)}
                  className={`p-2 rounded-xl border text-center transition-all ${
                    runtime === item.id
                      ? 'border-blue-500 bg-blue-50 text-blue-800 ring-2 ring-blue-500/10 font-bold'
                      : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <span className="text-lg block">{item.icon}</span>
                  <span className="text-xs block mt-0.5">{item.label}</span>
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

          {/* Auto CLI Sandbox Banner */}
          <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200/60 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-[11px] text-blue-800 leading-relaxed">
              <strong>Isolated Virtualmin-grade Sandbox:</strong> Tenant <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold">{tenantUser}</code> akan memiliki terminal tersendiri. Menjalankan framework <strong>{framework}</strong> dengan web server <strong>{webServer.toUpperCase()}</strong> dan CLI langsung auto-linked ke <strong>{runtime.toUpperCase()} {version}</strong>.
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
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Lengkap: PostgreSQL, MySQL/MariaDB, MongoDB, dan Redis.
                  </p>
                </div>
              </label>

              {createDb && (
                <div className="mt-3 pl-6 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'mongodb' as DatabaseEngine, label: '🍃 MongoDB 7.0' },
                    { id: 'redis' as DatabaseEngine, label: '🔴 Redis 7.2' },
                    { id: 'postgres' as DatabaseEngine, label: '🐘 PostgreSQL 16' },
                    { id: 'mysql' as DatabaseEngine, label: '🐬 MariaDB 11' },
                  ].map((engine) => (
                    <button
                      type="button"
                      key={engine.id}
                      onClick={() => setDbType(engine.id)}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs text-left transition-all ${
                        dbType === engine.id
                          ? 'border-blue-600 bg-blue-50 font-bold text-blue-900'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                    >
                      {engine.label}
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
                  Ekspos domain secara instan tanpa perlu IP publik statis atau konfigurasi port di router.
                </p>
              </div>
            </label>
          </div>

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
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-500/20"
            >
              Deploy App Now
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
