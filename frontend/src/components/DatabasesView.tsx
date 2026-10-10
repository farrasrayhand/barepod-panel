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
import { useSubRoute } from '../hooks/useSubRoute';
import { CredentialRevealModal } from './CredentialRevealModal';
import { RotatePasswordModal } from './RotatePasswordModal';
import { KeyRound } from 'lucide-react';
import { DatabaseGuiModal } from './DatabaseGuiModal';
import type { DatabaseManagerTool } from './DatabaseGuiModal';
import { CreateDatabaseModal } from './CreateDatabaseModal';
import { DatabaseDetailsModal } from './DatabaseDetailsModal';
import { DangerConfirmModal } from './DangerConfirmModal';

interface DatabasesViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const DatabasesView: React.FC<DatabasesViewProps> = ({ onShowToast }) => {
  const [activeTab, setActiveTab] = useSubRoute<'all' | DatabaseEngine | 'caches'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDbForDetails, setSelectedDbForDetails] = useState<DatabaseItem | null>(null);
  const [selectedDbForCredentials, setSelectedDbForCredentials] = useState<DatabaseItem | null>(null);
  const [selectedDbForRotate, setSelectedDbForRotate] = useState<DatabaseItem | null>(null);
  const [selectedDbForGui, setSelectedDbForGui] = useState<DatabaseItem | null>(null);
  const [selectedToolForGui, setSelectedToolForGui] = useState<DatabaseManagerTool>('dbgate');
  const [dbToDelete, setDbToDelete] = useState<DatabaseItem | null>(null);

  const [databases, setDatabases] = useState<DatabaseItem[]>([
    {
      id: 'db-1',
      name: 'larastore_production',
      type: 'postgres',
      version: 'PostgreSQL 16.4',
      port: 5432,
      host: '127.0.0.1',
      username: 'larastore_user',
      size: '142 MB',
      charset: 'UTF8',
      status: 'active',
      connections: 8,
      maxConnections: 25,
      isolationMode: 'shared_daemon',
    },
    {
      id: 'db-2',
      name: 'analytics_warehouse',
      type: 'postgres',
      version: 'PostgreSQL 16.4',
      port: 5432,
      host: '127.0.0.1',
      username: 'analytics_admin',
      size: '1.2 GB',
      charset: 'UTF8',
      status: 'active',
      connections: 14,
      maxConnections: 50,
      isolationMode: 'shared_daemon',
    },
    {
      id: 'db-3',
      name: 'app_user_documents',
      type: 'mongodb',
      version: 'MongoDB 7.0.8',
      port: 27017,
      host: '127.0.0.1',
      username: 'mongo_admin',
      size: '420 MB',
      charset: 'BSON',
      status: 'active',
      connections: 22,
      maxConnections: 50,
      isolationMode: 'shared_daemon',
    },
    {
      id: 'db-4',
      name: 'session_cache_store',
      type: 'redis',
      version: 'Redis 7.2.4',
      port: 6379,
      host: '127.0.0.1',
      username: 'default (auth key)',
      size: '18 MB (RAM)',
      charset: 'Key-Value (db 0)',
      status: 'active',
      connections: 45,
      maxConnections: 100,
      isolationMode: 'shared_daemon',
    },
    {
      id: 'db-5',
      name: 'wordpress_blog',
      type: 'mysql',
      version: 'MariaDB 11.2',
      port: 3308,
      host: '127.0.0.1',
      username: 'wp_farras',
      size: '64 MB',
      charset: 'utf8mb4',
      status: 'active',
      connections: 3,
      maxConnections: 25,
      isolationMode: 'shared_daemon',
    },
    {
      id: 'db-6',
      name: 'legacy_pos_system',
      type: 'mysql',
      version: 'MySQL 8.0.36',
      port: 3307,
      host: '127.0.0.1',
      username: 'pos_svc',
      size: '310 MB',
      charset: 'utf8mb4',
      status: 'active',
      connections: 6,
      maxConnections: 25,
      isolationMode: 'shared_daemon',
    },
  ]);

  const handleCreateDatabase = (newDb: DatabaseItem) => {
    setDatabases([newDb, ...databases]);
    if (onShowToast) {
      onShowToast('Database Created', `Database ${newDb.name} (${newDb.type.toUpperCase()}) successfully provisioned.`, 'success');
    }
  };

  const handleUpdateDatabase = (updated: DatabaseItem) => {
    setDatabases(databases.map(d => d.id === updated.id ? updated : d));
    setSelectedDbForDetails(updated);
    if (onShowToast) {
      onShowToast(
        'Max Connection Quota Updated', 
        `Connection limit for ${updated.username} changed to ${updated.maxConnections || 25} connections (ALTER ROLE/USER executed).`, 
        'success'
      );
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
    (db) =>
      (activeTab === 'all' ? db.type !== 'redis' : activeTab === 'caches' ? db.type === 'redis' : db.type === activeTab)
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
      case 'sqlite':
        return { bg: 'bg-slate-100 text-slate-700', label: 'SQ', name: 'SQLite 3' };
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
      case 'sqlite':
        uri = `sqlite:///home/${db.tenantUser ?? 'user'}/apps/${db.name}.sqlite`;
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
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Databases & Caches</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage isolated PostgreSQL, MySQL, MariaDB, MongoDB and SQLite databases, plus Redis caches.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => onShowToast?.('Refreshed', 'Database connection pools synchronized.', 'info')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Database</span>
          </button>
        </div>
      </div>

      {/* Tabs Filter */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          All Databases ({databases.filter((d) => d.type !== 'redis').length})
        </button>
        <button
          onClick={() => setActiveTab('postgres')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'postgres'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>PostgreSQL</span>
        </button>
        <button
          onClick={() => setActiveTab('mysql')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'mysql'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>MySQL / MariaDB</span>
        </button>
        <button
          onClick={() => setActiveTab('mongodb')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'mongodb'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>MongoDB</span>
        </button>
        <button
          onClick={() => setActiveTab('sqlite')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'sqlite'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>SQLite</span>
        </button>
        <button
          onClick={() => setActiveTab('caches')}
          className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
            activeTab === 'caches'
              ? 'bg-rose-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>Caches (Redis) ({databases.filter((d) => d.type === 'redis').length})</span>
        </button>
      </div>

      {/* Database Cards Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              <th className="py-3.5 px-4">Database Name</th>
              <th className="py-3.5 px-4">Engine & Shared Daemon</th>
              <th className="py-3.5 px-4">Tenant User & Isolation Scope</th>
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

                  {/* Engine & Shared Port */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <span className="font-semibold text-slate-800 block">{db.version}</span>
                      <div className="inline-flex items-center gap-1.5 font-mono text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[10px] border border-slate-200/60">
                        <Server className="w-3 h-3 text-slate-400" />
                        <span className="font-semibold text-slate-800">{host}</span>
                        <span className="text-slate-400">:</span>
                        <span className="text-blue-600 font-bold">{port}</span>
                        <span className="text-[9px] text-slate-400">(Shared)</span>
                      </div>
                    </div>
                  </td>

                  {/* Tenant Isolation & Access */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-[11px]">
                        <Key className="w-3 h-3 text-slate-400" />
                        <span className="font-semibold">{db.username}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className="inline-flex items-center gap-0.5 text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200 font-semibold">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          <span>Isolated GRANT</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedDbForDetails(db)}
                          className="text-slate-500 hover:text-blue-600 font-mono cursor-pointer hover:underline decoration-dotted transition-colors"
                          title="Click to edit connection quota"
                        >
                          Max {db.maxConnections || 25} conn
                        </button>
                      </div>
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
                        onClick={() => setSelectedDbForRotate(db)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                        title="Rotate password"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setSelectedDbForCredentials(db)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                        title="Open Password Vault (requires panel account password)"
                      >
                        <Lock className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => setSelectedDbForDetails(db)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs font-semibold border border-blue-200/80 shadow-2xs group cursor-pointer"
                        title="View host, port, credentials, connection URL & open visual manager"
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
        onUpdateDatabase={handleUpdateDatabase}
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
        title={`Drop Database "${dbToDelete?.name}"`}
        itemType="Database"
        itemName={dbToDelete?.name || ''}
        warningDescription={`Database ${dbToDelete?.name} (${dbToDelete?.type.toUpperCase()}) along with all its tables, schemas, data rows, and user grants will be permanently deleted.`}
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

      {/* Rotate Password Modal */}
      <RotatePasswordModal
        isOpen={!!selectedDbForRotate}
        onClose={() => setSelectedDbForRotate(null)}
        database={selectedDbForRotate}
        onRotated={(dbId, _newPassword) => {
          setDatabases((prev) =>
            prev.map((d) => (d.id === dbId ? { ...d, passwordRotatedAt: new Date().toLocaleString() } : d))
          );
          onShowToast?.('Password Rotated', 'The database user password was changed. Update your .env / connection string.', 'success');
        }}
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
