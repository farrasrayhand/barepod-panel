import React, { useState } from 'react';
import { 
  X, 
  ExternalLink, 
  ShieldCheck, 
  Database, 
  CheckCircle2, 
  Play, 
  Table, 
  Code, 
  Layers,
  Sparkles,
  Server,
  Zap,
  Check
} from 'lucide-react';
import type { DatabaseItem } from '../types';

export type DatabaseManagerTool = 'phpmyadmin' | 'pgadmin' | 'dbgate' | 'mongoexpress' | 'rediscommander';

interface DatabaseGuiModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
  initialTool?: DatabaseManagerTool;
}

export const DatabaseGuiModal: React.FC<DatabaseGuiModalProps> = ({
  isOpen,
  onClose,
  database,
  initialTool = 'dbgate',
}) => {
  const [currentTool, setCurrentTool] = useState<DatabaseManagerTool>(initialTool);
  const [activeSubTab, setActiveSubTab] = useState<'tables' | 'query' | 'structure'>('tables');
  const [queryInput, setQueryInput] = useState('SELECT * FROM users LIMIT 10;');
  const [queryOutputMsg, setQueryOutputMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialTool) {
      setCurrentTool(initialTool);
    }
  }, [initialTool]);

  if (!isOpen || !database) return null;

  const toolDetails: Record<DatabaseManagerTool, { name: string; icon: string; themeColor: string; description: string }> = {
    phpmyadmin: {
      name: 'phpMyAdmin v5.2',
      icon: '🐬',
      themeColor: 'bg-amber-600',
      description: 'Web interface for MySQL & MariaDB with full SQL query builder',
    },
    pgadmin: {
      name: 'pgAdmin 4 Web',
      icon: '🐘',
      themeColor: 'bg-blue-600',
      description: 'PostgreSQL Management tool with schemas and query analysis',
    },
    dbgate: {
      name: 'DbGate Universal Studio',
      icon: '⚡',
      themeColor: 'bg-indigo-600',
      description: 'All-in-one database manager supporting PostgreSQL, MySQL, MongoDB, & Redis',
    },
    mongoexpress: {
      name: 'Mongo Express Web',
      icon: '🍃',
      themeColor: 'bg-emerald-600',
      description: 'BSON Document database manager & JSON collection explorer',
    },
    rediscommander: {
      name: 'Redis Commander Web',
      icon: '🔴',
      themeColor: 'bg-rose-600',
      description: 'In-memory key-value inspector and memory performance monitor',
    },
  };

  const currentToolInfo = toolDetails[currentTool] || toolDetails.dbgate;

  const handleRunQuery = () => {
    setQueryOutputMsg(`Query executed in 3.4ms: 3 rows returned.`);
    setTimeout(() => setQueryOutputMsg(null), 3000);
  };

  const mockTables = database.type === 'mongodb' 
    ? ['users', 'sessions', 'orders', 'audit_logs']
    : database.type === 'redis'
    ? ['sess:94812_user', 'rate_limit:ip_102', 'cache:product_list', 'token:auth_jwt']
    : ['users', 'orders', 'order_items', 'products', 'categories', 'migrations'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full h-[90vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-3.5 bg-slate-950 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl p-1.5 bg-slate-800 rounded-xl">{currentToolInfo.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{currentToolInfo.name}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> SSO Autologin Active
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Connected to: <strong className="text-slate-200">{database.name}</strong> ({database.version}) as user <strong className="text-slate-200">{database.username}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Quick Switcher among available GUI tools */}
            <div className="hidden md:flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-xs">
              <span className="text-[10px] text-slate-500 px-2 font-medium">Switch GUI:</span>
              <button
                onClick={() => setCurrentTool('dbgate')}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  currentTool === 'dbgate' ? 'bg-indigo-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                DbGate
              </button>
              {(database.type === 'mysql' || database.type === 'mariadb') && (
                <button
                  onClick={() => setCurrentTool('phpmyadmin')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    currentTool === 'phpmyadmin' ? 'bg-amber-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  phpMyAdmin
                </button>
              )}
              {database.type === 'postgres' && (
                <button
                  onClick={() => setCurrentTool('pgadmin')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    currentTool === 'pgadmin' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  pgAdmin
                </button>
              )}
              {database.type === 'mongodb' && (
                <button
                  onClick={() => setCurrentTool('mongoexpress')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    currentTool === 'mongoexpress' ? 'bg-emerald-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Mongo Express
                </button>
              )}
              {database.type === 'redis' && (
                <button
                  onClick={() => setCurrentTool('rediscommander')}
                  className={`px-2.5 py-1 rounded text-xs transition-colors ${
                    currentTool === 'rediscommander' ? 'bg-rose-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Redis Commander
                </button>
              )}
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SSO Security Notice Banner */}
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between text-xs text-emerald-900 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>
              <strong>Built-in SSO Bridge:</strong> Anda terautentikasi otomatis ke <strong>{currentToolInfo.name}</strong> tanpa perlu input database password. Akses langsung dari internet luar diblokir demi keamanan.
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-800 bg-white px-2 py-0.5 rounded border border-emerald-200">
            Internal Reverse Proxy • Port 127.0.0.1
          </span>
        </div>

        {/* Embedded GUI Body */}
        <div className="flex-1 flex min-h-0 bg-slate-50">
          {/* Left Sidebar: Tables / Collections */}
          <div className="w-60 border-r border-slate-200 bg-white p-3 flex flex-col shrink-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2 flex items-center justify-between">
              <span>{database.type === 'mongodb' ? 'Collections' : database.type === 'redis' ? 'Keys' : 'Tables'}</span>
              <span className="bg-slate-100 text-slate-600 px-1.5 rounded text-[10px]">{mockTables.length}</span>
            </div>
            <div className="space-y-1 overflow-y-auto flex-1">
              {mockTables.map((tbl, idx) => (
                <button
                  key={idx}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 font-mono transition-colors ${
                    idx === 0 
                      ? 'bg-blue-50 text-blue-700 font-bold' 
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <Table className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{tbl}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Right Main Panel: Query & Data Explorer */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* Sub Tabs */}
            <div className="px-4 border-b border-slate-200 flex items-center gap-4 text-xs font-semibold shrink-0">
              <button
                onClick={() => setActiveSubTab('tables')}
                className={`py-3 border-b-2 transition-all ${
                  activeSubTab === 'tables' 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Browse Data (users)
              </button>
              <button
                onClick={() => setActiveSubTab('query')}
                className={`py-3 border-b-2 transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'query' 
                    ? 'border-blue-600 text-blue-600' 
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Code className="w-3.5 h-3.5" />
                <span>SQL / Query Console</span>
              </button>
            </div>

            {/* View Body */}
            <div className="flex-1 p-4 overflow-auto">
              {activeSubTab === 'query' ? (
                <div className="space-y-3">
                  <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 font-mono text-xs text-slate-200">
                    <textarea
                      rows={5}
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-none font-mono text-xs focus:ring-0 leading-relaxed"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleRunQuery}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-700 shadow-sm shadow-blue-500/20"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Execute Query</span>
                    </button>
                    {queryOutputMsg && (
                      <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 animate-in fade-in">
                        <Check className="w-3.5 h-3.5" /> {queryOutputMsg}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                /* Data Table Preview */
                <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[11px] text-slate-600">
                      <tr>
                        <th className="py-2.5 px-3">id</th>
                        <th className="py-2.5 px-3">name</th>
                        <th className="py-2.5 px-3">email</th>
                        <th className="py-2.5 px-3">role</th>
                        <th className="py-2.5 px-3">created_at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      <tr>
                        <td className="py-2 px-3 text-slate-400">1</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Farras Rayhand</td>
                        <td className="py-2 px-3 text-blue-600">farras@barepod.cloud</td>
                        <td className="py-2 px-3 text-emerald-700 font-bold">superadmin</td>
                        <td className="py-2 px-3 text-slate-500">2026-10-10 12:00:00</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-slate-400">2</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Alex Tan</td>
                        <td className="py-2 px-3 text-blue-600">alex@clientstore.id</td>
                        <td className="py-2 px-3 text-slate-700">developer</td>
                        <td className="py-2 px-3 text-slate-500">2026-10-10 13:15:20</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-slate-400">3</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Client Agency</td>
                        <td className="py-2 px-3 text-blue-600">agency@partner.net</td>
                        <td className="py-2 px-3 text-slate-700">client</td>
                        <td className="py-2 px-3 text-slate-500">2026-10-10 14:02:11</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
