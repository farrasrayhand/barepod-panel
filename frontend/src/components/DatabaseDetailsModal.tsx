import React, { useState } from 'react';
import { 
  X, 
  Database, 
  Key, 
  Server, 
  Copy, 
  Check, 
  Lock, 
  Eye, 
  EyeOff, 
  ExternalLink, 
  Zap, 
  ShieldCheck, 
  Code2, 
  Sparkles,
  Link2,
  Terminal,
  Layers
} from 'lucide-react';
import type { DatabaseItem } from '../types';
import type { DatabaseManagerTool } from './DatabaseGuiModal';

interface DatabaseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
  onOpenGui: (db: DatabaseItem, tool: DatabaseManagerTool) => void;
}

export const DatabaseDetailsModal: React.FC<DatabaseDetailsModalProps> = ({
  isOpen,
  onClose,
  database,
  onOpenGui,
}) => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [panelPassword, setPanelPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'params' | 'env'>('params');

  if (!isOpen || !database) return null;

  const mockPasswords: Record<string, string> = {
    'db-1': 'bp_pg_98f!aA72#xK',
    'db-2': 'analytics_sec_89Qv$L1',
    'db-3': 'mongo_cl_4412$zP9@w',
    'db-4': 'rd_cache_k9921_xOp8#',
    'db-5': 'wp_mysql_pass_8829#',
    'db-6': 'pos_legacy_pwd_771@',
  };

  const plainPassword = mockPasswords[database.id] || 'barepod_secret_key_889#';
  const effectivePassword = isUnlocked ? plainPassword : '••••••••••••';

  const host = database.host || '127.0.0.1';
  const port = database.port || (
    database.type === 'postgres' ? 5432 :
    database.type === 'mysql' || database.type === 'mariadb' ? 3306 :
    database.type === 'mongodb' ? 27017 : 6379
  );

  // Generate Direct Connection URL String
  const getConnectionUrl = (includePlainPassword: boolean = false) => {
    const pwd = includePlainPassword && isUnlocked ? plainPassword : (isUnlocked ? plainPassword : '<password>');
    switch (database.type) {
      case 'postgres':
        return `postgresql://${database.username}:${pwd}@${host}:${port}/${database.name}?sslmode=prefer`;
      case 'mysql':
      case 'mariadb':
        return `mysql://${database.username}:${pwd}@${host}:${port}/${database.name}`;
      case 'mongodb':
        return `mongodb://${database.username}:${pwd}@${host}:${port}/${database.name}?authSource=admin`;
      case 'redis':
        return `redis://:${pwd}@${host}:${port}/0`;
    }
  };

  // Generate .env snippet
  const getEnvSnippet = (includePlainPassword: boolean = false) => {
    const pwd = includePlainPassword && isUnlocked ? plainPassword : (isUnlocked ? plainPassword : 'YOUR_PASSWORD');
    switch (database.type) {
      case 'postgres':
        return `# PostgreSQL Configuration
DATABASE_URL="postgresql://${database.username}:${pwd}@${host}:${port}/${database.name}?schema=public"
DB_CONNECTION=pgsql
DB_HOST=${host}
DB_PORT=${port}
DB_DATABASE=${database.name}
DB_USERNAME=${database.username}
DB_PASSWORD=${pwd}`;
      case 'mysql':
      case 'mariadb':
        return `# MySQL / MariaDB Configuration
DATABASE_URL="mysql://${database.username}:${pwd}@${host}:${port}/${database.name}"
DB_CONNECTION=mysql
DB_HOST=${host}
DB_PORT=${port}
DB_DATABASE=${database.name}
DB_USERNAME=${database.username}
DB_PASSWORD=${pwd}`;
      case 'mongodb':
        return `# MongoDB Connection
MONGODB_URI="mongodb://${database.username}:${pwd}@${host}:${port}/${database.name}?authSource=admin"
MONGO_INITDB_DATABASE=${database.name}`;
      case 'redis':
        return `# Redis In-Memory Store
REDIS_URL="redis://:${pwd}@${host}:${port}/0"
REDIS_HOST=${host}
REDIS_PORT=${port}
REDIS_PASSWORD=${pwd}`;
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleUnlockPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!panelPassword.trim()) {
      setErrorMsg('Masukkan password akun panel Anda.');
      return;
    }
    // Simulation unlocks password
    setIsUnlocked(true);
    setShowPasswordText(true);
    setErrorMsg('');
  };

  const getBadge = () => {
    switch (database.type) {
      case 'postgres':
        return { bg: 'bg-blue-100 text-blue-700', label: '🐘 PostgreSQL', port: 5432 };
      case 'mysql':
      case 'mariadb':
        return { bg: 'bg-amber-100 text-amber-700', label: '🐬 MySQL/MariaDB', port: 3306 };
      case 'mongodb':
        return { bg: 'bg-emerald-100 text-emerald-800', label: '🍃 MongoDB', port: 27017 };
      case 'redis':
        return { bg: 'bg-rose-100 text-rose-700', label: '🔴 Redis Cache', port: 6379 };
    }
  };

  const badge = getBadge();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-2xs ${badge.bg}`}>
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{database.name}</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
                <span className="text-xs text-slate-400 font-mono">({database.charset})</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {database.version} • {badge.label} • {database.size}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Direct SSO Web GUI Launcher Section */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-blue-300 text-xs font-semibold uppercase tracking-wider">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Direct Web GUI Access (Zero Re-Login SSO)</span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Buka visual database manager langsung tanpa perlu input user & password lagi:
                </p>
              </div>

              {/* GUI Action Buttons tailored to DB type */}
              <div className="flex items-center gap-2 shrink-0">
                {database.type === 'postgres' && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'pgadmin');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span>🐘 Open pgAdmin</span>
                  </button>
                )}

                {(database.type === 'mysql' || database.type === 'mariadb') && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'phpmyadmin');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span>🐬 Open phpMyAdmin</span>
                  </button>
                )}

                {database.type === 'mongodb' && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'mongoexpress');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span>🍃 Open Mongo Express</span>
                  </button>
                )}

                {database.type === 'redis' && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'rediscommander');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <span>🔴 Open Redis Commander</span>
                  </button>
                )}

                {/* Universal DbGate Studio */}
                <button
                  onClick={() => {
                    onClose();
                    onOpenGui(database, 'dbgate');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Open DbGate</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quick Connection URL Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800">Connection URL (Direct String)</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">
                Gunakan URL ini di .env / Prisma / App tanpa input manual
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-700 truncate select-all">
                {getConnectionUrl(true)}
              </div>
              <button
                onClick={() => handleCopy(getConnectionUrl(true), 'conn_url')}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs shrink-0"
              >
                {copiedKey === 'conn_url' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-200" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy URL</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Detailed Connection Parameters Grid */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5">
              Connection Parameters (Host, Port, User & Credentials)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {/* Host */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Host / Server</span>
                  <span className="font-mono font-semibold text-slate-800 text-xs">{host}</span>
                </div>
                <button
                  onClick={() => handleCopy(host, 'host')}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  title="Copy host"
                >
                  {copiedKey === 'host' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Port */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Port</span>
                  <span className="font-mono font-semibold text-slate-800 text-xs">{port}</span>
                </div>
                <button
                  onClick={() => handleCopy(String(port), 'port')}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  title="Copy port"
                >
                  {copiedKey === 'port' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Database Name */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Database Name</span>
                  <span className="font-mono font-semibold text-slate-800 text-xs">{database.name}</span>
                </div>
                <button
                  onClick={() => handleCopy(database.name, 'dbname')}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  title="Copy database name"
                >
                  {copiedKey === 'dbname' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Username */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Username</span>
                  <span className="font-mono font-semibold text-slate-800 text-xs">{database.username}</span>
                </div>
                <button
                  onClick={() => handleCopy(database.username, 'user')}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg"
                  title="Copy username"
                >
                  {copiedKey === 'user' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Password Protection & Decrypt Row */}
            <div className="mt-3 p-3.5 bg-amber-50/60 border border-amber-200/80 rounded-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                      Database Password
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs font-semibold text-slate-800">
                    {isUnlocked 
                      ? (showPasswordText ? plainPassword : '••••••••••••••••')
                      : '•••••••••••• (Encrypted in Vault)'}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isUnlocked ? (
                    <>
                      <button
                        onClick={() => setShowPasswordText(!showPasswordText)}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1"
                      >
                        {showPasswordText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showPasswordText ? 'Hide' : 'Show'}</span>
                      </button>
                      <button
                        onClick={() => handleCopy(plainPassword, 'pwd')}
                        className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors flex items-center gap-1"
                      >
                        {copiedKey === 'pwd' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'pwd' ? 'Copied' : 'Copy'}</span>
                      </button>
                    </>
                  ) : (
                    <form onSubmit={handleUnlockPassword} className="flex items-center gap-1.5 w-full sm:w-auto">
                      <input
                        type="password"
                        placeholder="Password panel..."
                        value={panelPassword}
                        onChange={(e) => setPanelPassword(e.target.value)}
                        className="px-2.5 py-1 text-xs bg-white border border-amber-300 rounded-lg focus:outline-hidden focus:border-amber-500 w-36"
                      />
                      <button
                        type="submit"
                        className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors whitespace-nowrap shadow-2xs"
                      >
                        Unlock
                      </button>
                    </form>
                  )}
                </div>
              </div>
              {errorMsg && (
                <p className="text-[10px] text-rose-600 mt-1 font-semibold">{errorMsg}</p>
              )}
            </div>
          </div>

          {/* Quick .env Code Snippet Tab */}
          <div className="bg-slate-900 rounded-xl p-4 text-slate-200 space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <Code2 className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs font-bold text-slate-200">.env File Integration Example</span>
              </div>
              <button
                onClick={() => handleCopy(getEnvSnippet(true), 'env_snippet')}
                className="px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center gap-1"
              >
                {copiedKey === 'env_snippet' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copiedKey === 'env_snippet' ? 'Copied .env' : 'Copy .env'}</span>
              </button>
            </div>
            <pre className="text-[11px] font-mono text-slate-300 overflow-x-auto p-1 leading-relaxed selection:bg-blue-600 selection:text-white">
              {getEnvSnippet(true)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Protected by BarePod Internal Proxy & Linux Security Vault</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
