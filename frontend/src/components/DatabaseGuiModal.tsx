import React, { useState } from 'react';
import { 
  X, 
  ExternalLink, 
  ShieldCheck, 
  Database, 
  CheckCircle2, 
  Layers, 
  Play, 
  Table, 
  Code, 
  Lock,
  Maximize2
} from 'lucide-react';
import type { DatabaseItem } from '../types';

interface DatabaseGuiModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
}

export const DatabaseGuiModal: React.FC<DatabaseGuiModalProps> = ({
  isOpen,
  onClose,
  database,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'tables' | 'query' | 'structure'>('tables');
  const [queryInput, setQueryInput] = useState('SELECT * FROM users LIMIT 10;');

  if (!isOpen || !database) return null;

  const getGuiToolName = (type: string) => {
    switch (type) {
      case 'postgres':
        return { name: 'DbGate & pgAdmin Studio', engine: 'PostgreSQL 16' };
      case 'mysql':
      case 'mariadb':
        return { name: 'phpMyAdmin & DbGate', engine: 'MariaDB / MySQL' };
      case 'mongodb':
        return { name: 'Mongo Express & DbGate', engine: 'MongoDB Document' };
      case 'redis':
        return { name: 'Redis Commander & GUI', engine: 'Redis In-Memory' };
      default:
        return { name: 'DbGate Web Studio', engine: 'SQL Engine' };
    }
  };

  const guiInfo = getGuiToolName(database.type);

  // Mock table schemas
  const mockTables = database.type === 'mongodb' 
    ? ['users', 'sessions', 'orders', 'audit_logs']
    : database.type === 'redis'
    ? ['sess:94812_user', 'rate_limit:ip_102', 'cache:product_list', 'token:auth_jwt']
    : ['users', 'orders', 'order_items', 'products', 'categories', 'migrations'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-5xl w-full h-[88vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{guiInfo.name}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Auto-SSO Authenticated
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Connected to: <strong className="text-slate-200">{database.name}</strong> ({guiInfo.engine}) as <strong className="text-slate-200">{database.username}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-1 rounded hidden sm:inline-block">
              Internal Proxy Port • Direct Public Access Blocked
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SSO Security Notice Banner */}
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200/80 flex items-center justify-between text-xs text-emerald-900 shrink-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>
              <strong>Zero Password Prompt SSO:</strong> Anda otomatis terautentikasi melalui session token BarePod Panel. Pengguna luar tidak bisa membuka URL database ini tanpa login ke panel terlebih dahulu.
            </span>
          </div>
          <span className="text-[10px] font-mono text-emerald-700 bg-white/80 px-2 py-0.5 rounded border border-emerald-200">
            Proxy Token: BP_SSO_9A81F
          </span>
        </div>

        {/* Embedded GUI Body */}
        <div className="flex-1 flex min-h-0 bg-slate-50">
          {/* Left Sidebar: Tables / Collections */}
          <div className="w-56 border-r border-slate-200 bg-white p-3 flex flex-col shrink-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {database.type === 'mongodb' ? 'Collections' : database.type === 'redis' ? 'Keys' : 'Tables'} ({mockTables.length})
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
                  <Table className="w-3.5 h-3.5 text-slate-400" />
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
                Data Grid (users)
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
                      rows={4}
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-none font-mono text-xs focus:ring-0"
                    />
                  </div>
                  <button className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-blue-700">
                    <Play className="w-3 h-3" />
                    <span>Run Query</span>
                  </button>
                </div>
              ) : (
                /* Data Table Preview */
                <div className="border border-slate-200 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 border-b border-slate-200 font-mono text-[11px] text-slate-600">
                      <tr>
                        <th className="py-2 px-3">id</th>
                        <th className="py-2 px-3">name</th>
                        <th className="py-2 px-3">email</th>
                        <th className="py-2 px-3">role</th>
                        <th className="py-2 px-3">created_at</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-mono">
                      <tr>
                        <td className="py-2 px-3 text-slate-400">1</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Farras Rayhand</td>
                        <td className="py-2 px-3 text-blue-600">farras@barepod.cloud</td>
                        <td className="py-2 px-3 text-emerald-700">superadmin</td>
                        <td className="py-2 px-3 text-slate-500">2026-10-10 12:00:00</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-slate-400">2</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Tenant Client</td>
                        <td className="py-2 px-3 text-blue-600">client@store.id</td>
                        <td className="py-2 px-3 text-slate-700">developer</td>
                        <td className="py-2 px-3 text-slate-500">2026-10-10 13:15:20</td>
                      </tr>
                      <tr>
                        <td className="py-2 px-3 text-slate-400">3</td>
                        <td className="py-2 px-3 font-semibold text-slate-800">Demo Customer</td>
                        <td className="py-2 px-3 text-blue-600">demo@customer.net</td>
                        <td className="py-2 px-3 text-slate-700">user</td>
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
