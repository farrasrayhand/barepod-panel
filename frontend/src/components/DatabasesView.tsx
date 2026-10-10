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
  ShieldCheck,
  Trash2,
  Zap,
  Globe
} from 'lucide-react';
import type { DatabaseItem, DatabaseEngine } from '../types';
import { CredentialRevealModal } from './CredentialRevealModal';
import { DatabaseGuiModal } from './DatabaseGuiModal';
import type { DatabaseManagerTool } from './DatabaseGuiModal';
import { CreateDatabaseModal } from './CreateDatabaseModal';
import { DatabaseDetailsModal } from './DatabaseDetailsModal';
import { DangerConfirmModal } from './DangerConfirmModal';

interface DatabasesViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const DatabasesView: React.FC<DatabasesViewProps> = ({ onShowToast }) => {
  const [activeTab, setActiveTab] = useState<'all' | DatabaseEngine>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDbForDetails, setSelectedDbForDetails] = useState<DatabaseItem | null>(null);
  const [selectedDbForCredentials, setSelectedDbForCredentials] = useState<DatabaseItem | null>(null);
  const [selectedDbForGui, setSelectedDbForGui] = useState<DatabaseItem | null>(null);
  const [selectedToolForGui, setSelectedToolForGui] = useState<DatabaseManagerTool>('dbgate');
  const [dbToDelete, setDbToDelete] = useState<DatabaseItem | null>(null);

  const [databases, setDatabases] = useState<DatabaseItem[]>([
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
      charset: 'Key-Value (db 0)',
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

  const handleCreateDatabase = (newDb: DatabaseItem) => {
    setDatabases([newDb, ...databases]);
    if (onShowToast) {
      onShowToast('Database Created', `Database ${newDb.name} (${newDb.type.toUpperCase()}) successfully provisioned.`, 'success');
    }
  };

  const handleDeleteDatabase = (dbId: string, dbName: string) => {
    setDatabases(databases.filter(d => d.id !== dbId));
    if (onShowToast) {
      onShowToast('Database Removed', `Database ${dbName} has been dropped.`, 'info');
    }
  };

  const openManagerWithTool = (db: DatabaseItem, tool: DatabaseManagerTool) => {
    setSelectedDbForGui(db);
    setSelectedToolForGui(tool);
  };

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
    if (onShowToast) {
      onShowToast('URI Copied', 'Masked connection URI copied to clipboard.', 'info');
    }
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
            Built-in Single Sign-On Web GUI (DbGate, pgAdmin, phpMyAdmin, Mongo Express, Redis Commander)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => onShowToast?.('Refreshed', 'Database connection pools synchronized.', 'info')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25"
          >
            <Plus className="w-4 h-4" />
            <span>Create Database</span>
          </button>
        </div>
      </div>

      {/* Prominent Built-in Database Managers Quick Launch Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-blue-600" />
            Built-in Database Managers (One-Click SSO Autologin)
          </span>
          <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-medium">
            Protected behind internal proxy
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
          {/* phpMyAdmin */}
          <button
            onClick={() => {
              const myDb = databases.find(d => d.type === 'mysql' || d.type === 'mariadb') || databases[0];
              openManagerWithTool(myDb, 'phpmyadmin');
            }}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-amber-200/80 bg-amber-50/50 hover:bg-amber-100/70 transition-all text-left group"
          >
            <span className="text-xl">🐬</span>
            <div className="truncate">
              <span className="font-bold text-xs text-amber-950 block">phpMyAdmin</span>
              <span className="text-[10px] text-amber-700 truncate block">MySQL / MariaDB</span>
            </div>
          </button>

          {/* pgAdmin 4 */}
          <button
            onClick={() => {
              const pgDb = databases.find(d => d.type === 'postgres') || databases[0];
              openManagerWithTool(pgDb, 'pgadmin');
            }}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-blue-200/80 bg-blue-50/50 hover:bg-blue-100/70 transition-all text-left group"
          >
            <span className="text-xl">🐘</span>
            <div className="truncate">
              <span className="font-bold text-xs text-blue-950 block">pgAdmin 4</span>
              <span className="text-[10px] text-blue-700 truncate block">PostgreSQL</span>
            </div>
          </button>

          {/* DbGate Studio */}
          <button
            onClick={() => openManagerWithTool(databases[0], 'dbgate')}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-indigo-200/80 bg-indigo-50/50 hover:bg-indigo-100/70 transition-all text-left group"
          >
            <span className="text-xl">⚡</span>
            <div className="truncate">
              <span className="font-bold text-xs text-indigo-950 block">DbGate Studio</span>
              <span className="text-[10px] text-indigo-700 truncate block">Universal SQL & NoSQL</span>
            </div>
          </button>

          {/* Mongo Express */}
          <button
            onClick={() => {
              const mgDb = databases.find(d => d.type === 'mongodb') || databases[0];
              openManagerWithTool(mgDb, 'mongoexpress');
            }}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-emerald-200/80 bg-emerald-50/50 hover:bg-emerald-100/70 transition-all text-left group"
          >
            <span className="text-xl">🍃</span>
            <div className="truncate">
              <span className="font-bold text-xs text-emerald-950 block">Mongo Express</span>
              <span className="text-[10px] text-emerald-700 truncate block">MongoDB Document</span>
            </div>
          </button>

          {/* Redis Commander */}
          <button
            onClick={() => {
              const rdDb = databases.find(d => d.type === 'redis') || databases[0];
              openManagerWithTool(rdDb, 'rediscommander');
            }}
            className="flex items-center gap-2 p-2.5 rounded-xl border border-rose-200/80 bg-rose-50/50 hover:bg-rose-100/70 transition-all text-left group"
          >
            <span className="text-xl">🔴</span>
            <div className="truncate">
              <span className="font-bold text-xs text-rose-950 block">Redis Commander</span>
              <span className="text-[10px] text-rose-700 truncate block">Redis Key-Value</span>
            </div>
          </button>
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
              <th className="py-3.5 px-4">Host & Port</th>
              <th className="py-3.5 px-4">Username & Access</th>
              <th className="py-3.5 px-4">Size & Pool</th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((db) => {
              const badge = getDbBadge(db.type);
              const host = db.host || '127.0.0.1';
              const port = db.port || (
                db.type === 'postgres' ? 5432 :
                db.type === 'mysql' || db.type === 'mariadb' ? 3306 :
                db.type === 'mongodb' ? 27017 : 6379
              );

              return (
                <tr key={db.id} className="hover:bg-slate-50/70 transition-colors">
                  {/* Database Name */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shadow-2xs ${badge.bg}`}>
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
                    <span className="font-semibold text-slate-800">{db.version}</span>
                    <span className="block text-[10px] text-slate-400">
                      {badge.name}
                    </span>
                  </td>

                  {/* Host & Port */}
                  <td className="py-3.5 px-4">
                    <div className="inline-flex items-center gap-1.5 font-mono text-slate-700 bg-slate-100/80 px-2.5 py-1 rounded-md text-[11px] border border-slate-200/60">
                      <Server className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-slate-800">{host}</span>
                      <span className="text-slate-400">:</span>
                      <span className="text-blue-600 font-bold">{port}</span>
                    </div>
                  </td>

                  {/* Username */}
                  <td className="py-3.5 px-4">
                    <div className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                      <Key className="w-3 h-3 text-slate-400" />
                      <span>{db.username}</span>
                    </div>
                  </td>

                  {/* Size & Connections */}
                  <td className="py-3.5 px-4">
                    <span className="font-semibold text-slate-800">{db.size}</span>
                    <span className="block text-[10px] text-slate-400">{db.connections} active pool</span>
                  </td>

                  {/* Actions: Clean Details Button + Trash */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedDbForDetails(db)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs font-semibold border border-blue-200/80 shadow-2xs group"
                        title="Lihat host, port, kredensial, URL connection & buka visual manager"
                      >
                        <Zap className="w-3.5 h-3.5 text-blue-600 group-hover:text-white transition-colors" />
                        <span>Details & Connect</span>
                      </button>

                      <button
                        onClick={() => setDbToDelete(db)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Drop database"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Database Details, Credentials & Direct URL Modal */}
      <DatabaseDetailsModal
        isOpen={!!selectedDbForDetails}
        onClose={() => setSelectedDbForDetails(null)}
        database={selectedDbForDetails}
        onOpenGui={(db, tool) => openManagerWithTool(db, tool)}
        onDelete={(db) => {
          setSelectedDbForDetails(null);
          setDbToDelete(db);
        }}
      />

      {/* Danger Confirm Delete Modal */}
      <DangerConfirmModal
        isOpen={!!dbToDelete}
        onClose={() => setDbToDelete(null)}
        onConfirm={() => {
          if (dbToDelete) {
            handleDeleteDatabase(dbToDelete.id, dbToDelete.name);
            setDbToDelete(null);
          }
        }}
        title={`Hapus / Drop Database "${dbToDelete?.name}"`}
        itemType="Database"
        itemName={dbToDelete?.name || ''}
        warningDescription={`Database ${dbToDelete?.name} (${dbToDelete?.type.toUpperCase()}) beserta seluruh tabel, skema, data rows, dan hak akses user akan dihapus secara permanen.`}
      />

      {/* Create Database Modal */}
      <CreateDatabaseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateDatabase}
      />

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
        initialTool={selectedToolForGui}
      />
    </div>
  );
};
