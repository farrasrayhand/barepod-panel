import React, { useState } from 'react';
import { 
  Database, 
  Plus, 
  RefreshCw, 
  Copy, 
  Check, 
  ExternalLink, 
  Key, 
  Server,
  Lock,
  Eye,
  ShieldCheck
} from 'lucide-react';
import type { DatabaseItem, DatabaseEngine } from '../types';
import { CredentialRevealModal } from './CredentialRevealModal';
import { DatabaseGuiModal } from './DatabaseGuiModal';

export const DatabasesView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'all' | DatabaseEngine>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal States
  const [selectedDbForCredentials, setSelectedDbForCredentials] = useState<DatabaseItem | null>(null);
  const [selectedDbForGui, setSelectedDbForGui] = useState<DatabaseItem | null>(null);

  const [databases] = useState<DatabaseItem[]>([
    {
      id: 'db-1',
      name: 'larastore_production',
      type: 'postgres',
      version: 'PostgreSQL 16.4',
      username: 'larastore_user',
      size: '142 MB',
      charset: 'UTF8',
      status: 'active',
      connections: 8,
    },
    {
      id: 'db-2',
      name: 'analytics_warehouse',
      type: 'postgres',
      version: 'PostgreSQL 16.4',
      username: 'analytics_admin',
      size: '1.2 GB',
      charset: 'UTF8',
      status: 'active',
      connections: 14,
    },
    {
      id: 'db-3',
      name: 'app_user_documents',
      type: 'mongodb',
      version: 'MongoDB 7.0.8',
      username: 'mongo_admin',
      size: '420 MB',
      charset: 'BSON',
      status: 'active',
      connections: 22,
    },
    {
      id: 'db-4',
      name: 'session_cache_store',
      type: 'redis',
      version: 'Redis 7.2.4',
      username: 'default (auth key)',
      size: '18 MB (RAM)',
      charset: 'In-Memory',
      status: 'active',
      connections: 45,
    },
    {
      id: 'db-5',
      name: 'wordpress_blog',
      type: 'mysql',
      version: 'MariaDB 11.2',
      username: 'wp_farras',
      size: '64 MB',
      charset: 'utf8mb4',
      status: 'active',
      connections: 3,
    },
    {
      id: 'db-6',
      name: 'legacy_pos_system',
      type: 'mysql',
      version: 'MySQL 8.0.36',
      username: 'pos_svc',
      size: '310 MB',
      charset: 'utf8mb4',
      status: 'active',
      connections: 6,
    },
  ]);

  const filtered = databases.filter(
    (db) => activeTab === 'all' || db.type === activeTab
  );

  const getDbBadge = (type: DatabaseEngine) => {
    switch (type) {
      case 'postgres':
        return { bg: 'bg-blue-100 text-blue-700', label: 'PG', name: 'PostgreSQL 16' };
      case 'mysql':
      case 'mariadb':
        return { bg: 'bg-amber-100 text-amber-700', label: 'MY', name: 'MariaDB/MySQL' };
      case 'mongodb':
        return { bg: 'bg-emerald-100 text-emerald-800', label: 'MG', name: 'MongoDB 7' };
      case 'redis':
        return { bg: 'bg-rose-100 text-rose-700', label: 'RD', name: 'Redis Cache' };
    }
  };

  const handleCopyUri = (db: DatabaseItem) => {
    let uri = '';
    switch (db.type) {
      case 'postgres':
        uri = `postgresql://${db.username}:••••••••@127.0.0.1:5432/${db.name}`;
        break;
      case 'mysql':
      case 'mariadb':
        uri = `mysql://${db.username}:••••••••@127.0.0.1:3306/${db.name}`;
        break;
      case 'mongodb':
        uri = `mongodb://${db.username}:••••••••@127.0.0.1:27017/${db.name}?authSource=admin`;
        break;
      case 'redis':
        uri = `redis://:••••••••@127.0.0.1:6379/0`;
        break;
    }
    navigator.clipboard?.writeText(uri);
    setCopiedId(db.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Databases & Caches</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800">
              PostgreSQL • MySQL • MongoDB • Redis
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Built-in Single Sign-On Web GUI (DbGate/pgAdmin/phpMyAdmin) & Protected Password Credentials
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs">
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25">
            <Plus className="w-4 h-4" />
            <span>Create Database</span>
          </button>
        </div>
      </div>

      {/* Security Features Highlight Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 bg-emerald-50/70 border border-emerald-200/70 rounded-xl flex items-start gap-3 text-xs text-emerald-900">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Zero-Login Database Web GUI (SSO):</span>
            <p className="text-emerald-700 mt-0.5">
              Akses Web GUI (DbGate / phpMyAdmin / pgAdmin) terlindungi dan hanya bisa dibuka setelah login ke Panel. Saat dibuka, sesi otomatis login ke database tanpa perlu input user/password lagi!
            </p>
          </div>
        </div>

        <div className="p-4 bg-amber-50/70 border border-amber-200/70 rounded-xl flex items-start gap-3 text-xs text-amber-900">
          <Lock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold">Protected Password Decryption:</span>
            <p className="text-amber-800 mt-0.5">
              Semua password database terenkripsi & di-masking. Untuk melihat password plain text, pengguna wajib memasukkan password akun panel terlebih dahulu.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs Filter */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'all'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          All ({databases.length})
        </button>
        <button
          onClick={() => setActiveTab('postgres')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'postgres'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🐘 PostgreSQL</span>
        </button>
        <button
          onClick={() => setActiveTab('mysql')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'mysql'
              ? 'bg-amber-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🐬 MySQL / MariaDB</span>
        </button>
        <button
          onClick={() => setActiveTab('mongodb')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'mongodb'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🍃 MongoDB</span>
        </button>
        <button
          onClick={() => setActiveTab('redis')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'redis'
              ? 'bg-rose-600 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span>🔴 Redis Cache</span>
        </button>
      </div>

      {/* Database Cards Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              <th className="py-3.5 px-4">Database Name</th>
              <th className="py-3.5 px-4">Engine / Version</th>
              <th className="py-3.5 px-4">Username & Access</th>
              <th className="py-3.5 px-4">Size & Pool</th>
              <th className="py-3.5 px-4">Password Protection</th>
              <th className="py-3.5 px-4 text-right">Web GUI & Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((db) => {
              const badge = getDbBadge(db.type);
              return (
                <tr key={db.id} className="hover:bg-slate-50/70 transition-colors">
                  {/* Database Name */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${badge.bg}`}>
                        {badge.label}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-900 text-sm block">{db.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">Format: {db.charset}</span>
                      </div>
                    </div>
                  </td>

                  {/* Engine */}
                  <td className="py-3.5 px-4">
                    <span className="font-medium text-slate-700">{db.version}</span>
                    <span className="block text-[10px] text-slate-400">
                      {badge.name}
                    </span>
                  </td>

                  {/* Username */}
                  <td className="py-3.5 px-4">
                    <div className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      <Key className="w-3 h-3 text-slate-400" />
                      <span>{db.username}</span>
                    </div>
                  </td>

                  {/* Size & Connections */}
                  <td className="py-3.5 px-4">
                    <span className="font-medium text-slate-800">{db.size}</span>
                    <span className="block text-[10px] text-slate-400">{db.connections} active connections</span>
                  </td>

                  {/* Password Protection & Decrypt Trigger */}
                  <td className="py-3.5 px-4">
                    <button
                      onClick={() => setSelectedDbForCredentials(db)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 transition-colors font-medium text-xs group"
                      title="Masukkan password panel untuk melihat password database"
                    >
                      <Lock className="w-3.5 h-3.5 text-amber-600 group-hover:hidden" />
                      <Eye className="w-3.5 h-3.5 text-amber-700 hidden group-hover:inline" />
                      <span>•••••••• (Click to Reveal)</span>
                    </button>
                  </td>

                  {/* Actions & Launch Builtin GUI */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Copy URI */}
                      <button
                        onClick={() => handleCopyUri(db)}
                        className="p-1.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="Copy masked URI"
                      >
                        {copiedId === db.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>

                      {/* Launch Builtin Web GUI with SSO */}
                      <button
                        onClick={() => setSelectedDbForGui(db)}
                        className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors inline-flex items-center gap-1.5 text-[11px] font-semibold border border-blue-200"
                        title="Launch Web GUI without re-login (SSO)"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>Open GUI (SSO)</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Credential Reveal Security Modal */}
      <CredentialRevealModal
        isOpen={!!selectedDbForCredentials}
        onClose={() => setSelectedDbForCredentials(null)}
        database={selectedDbForCredentials}
      />

      {/* Database Web GUI SSO Modal */}
      <DatabaseGuiModal
        isOpen={!!selectedDbForGui}
        onClose={() => setSelectedDbForGui(null)}
        database={selectedDbForGui}
      />
    </div>
  );
};
