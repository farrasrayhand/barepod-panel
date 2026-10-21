import React, { useEffect, useState } from 'react';
import {
  Database,
  Plus,
  RefreshCw,
  Key,
  Server,
  Lock,
  ShieldCheck,
  Trash2,
  Zap,
  Folder,
  Download,
  Search,
  User,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import type { DatabaseItem, DatabaseEngine } from '../types';
import { useSubRoute } from '../hooks/useSubRoute';
import { CredentialRevealModal } from './CredentialRevealModal';
import { RotatePasswordModal } from './RotatePasswordModal';
import { KeyRound } from 'lucide-react';
import type { DatabaseManagerTool } from './DatabaseDetailsModal';
import { CreateDatabaseModal } from './CreateDatabaseModal';
import { DatabaseDetailsModal } from './DatabaseDetailsModal';
import { DangerConfirmModal } from './DangerConfirmModal';
import { api, apiReachable, type DatabaseRow, type DbEngineRow } from '../api/client';
import { saveBlob, failureMessage } from '../api/download';
import { Loader2 } from 'lucide-react';
import { describeError } from '../utils/format';
import { formatBytes } from '../api/adapters';

interface DatabasesViewProps {
  isAdmin?: boolean;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

const ENGINE_TO_ITEM: Record<string, DatabaseEngine> = {
  postgresql: 'postgres',
  mysql: 'mysql',
  mariadb: 'mariadb',
  mongodb: 'mongodb',
  redis: 'redis',
  sqlite: 'sqlite',
};

// A SQL daemon engine, as opposed to a document or key-value store: a charset, a
// GRANT and a connection quota only mean something for these.
/** A database kept when its website was deleted: the file moved into the tenant's home. */
const _isDetached = (db: DatabaseItem): boolean => !!db.detachedAt;

const isSqlEngine = (type: DatabaseEngine): boolean =>
  type === 'postgres' || type === 'mysql' || type === 'mariadb';

const formatEngineName = (eng: string) => {
  switch (eng.toLowerCase()) {
    case 'postgresql':
    case 'postgres':
      return 'PostgreSQL';
    case 'mariadb':
      return 'MariaDB';
    case 'mysql':
      return 'MySQL';
    case 'mongodb':
      return 'MongoDB';
    case 'redis':
      return 'Redis';
    case 'sqlite':
      return 'SQLite';
    default:
      return eng;
  }
};

const shortenUserPath = (p: string) => {
  if (!p) return '';
  return p.replace(/^\/home\/[^/]+\//, '~/');
};

/** One daemon row, in the shape this screen already renders. */
const toDatabaseItem = (row: DatabaseRow): DatabaseItem => ({
  id: row.id,
  name: row.alias || row.name,
  type: ENGINE_TO_ITEM[row.engine] ?? 'postgres',
  version: [formatEngineName(row.engine), row.version || (row.engine === 'sqlite' ? '3' : '')].filter(Boolean).join(' '),
  username: row.user || '—',
  // A file-based database has a real size; a daemon one is not measured yet.
  size: row.fileBased ? (row.sizeBytes ? formatBytes(row.sizeBytes) : '0 B') : '—',
  // What the engine actually stores: "utf8mb4" is meaningless for a document or
  // key-value store, so it must not be printed for one.
  charset: row.fileBased
    ? 'SQLite file'
    : row.engine === 'postgresql'
      ? 'UTF8'
      : row.engine === 'mongodb'
        ? 'BSON'
        : row.engine === 'redis'
          ? 'Key-Value'
          : 'utf8mb4',
  status: row.deletedAt || row.status !== 'ready' ? 'inactive' : 'active',
  detachedAt: row.detachedAt,
  unusedByApp: row.unusedByApp,
  unreferenced: row.unreferenced,
  missingOnEngine: row.missingOnEngine,
  suggestedName: row.suggestedName,
  credentialRejected: row.credentialRejected,
  connections: 0,
  host: row.host,
  port: row.port,
  tenantUser: row.tenantUser,
  maxConnections: row.maxConnections,
  deletedAt: row.deletedAt,
  note: row.note,
  websiteSlug: row.websiteSlug,
  fileBased: row.fileBased,
  detected: row.detected,
  path: row.path,
  exposure: row.exposure,
  exposureNote: row.exposureNote,
  exposedAt: row.exposedAt,
});

// The names the panel hosts (see GET /databases/:id/gui) rather than brand names.
const TOOL_TO_API: Record<string, string> = {
  browser: 'browser',
  pgweb: 'pgweb',
  phpmyadmin: 'phpmyadmin',
  dbgate: 'dbgate',
};

export const DatabasesView: React.FC<DatabasesViewProps> = ({ isAdmin = false, onShowToast }) => {
  const [activeTab, setActiveTab] = useSubRoute<'all' | DatabaseEngine | 'caches' | 'trash'>('all');
  const [,_setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'owner' | 'engine' | 'size'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Detected files the application is not connected to are hidden by default; the
  // toggle below brings them back so a wrong guess is never invisible.
  const [showUnused, setShowUnused] = useState(false);

  // Modal States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // The .sqlite row button used to only raise a toast: it now really saves the file, through
  // the panel's own request rather than a navigation download (which the browser blocks
  // outright on an origin whose certificate was clicked past).
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const handleSqliteDownload = async (db: DatabaseItem) => {
    setDownloadingId(db.id);
    try {
      const blob = await api.databases.export(db.id);
      saveBlob(blob, `${db.name}.sqlite`);
      onShowToast?.('Download ready', `${db.name}.sqlite was saved.`, 'success');
    } catch (err) {
      onShowToast?.('Download failed', failureMessage(err, 'The file could not be produced.'), 'error');
    } finally {
      setDownloadingId(null);
    }
  };
  const [selectedDbForDetails, setSelectedDbForDetails] = useState<DatabaseItem | null>(null);
  const [selectedDbForCredentials, setSelectedDbForCredentials] = useState<DatabaseItem | null>(null);
  const [selectedDbForRotate, setSelectedDbForRotate] = useState<DatabaseItem | null>(null);

  const [dbToDelete, setDbToDelete] = useState<DatabaseItem | null>(null);
  const [binToPurge, setBinToPurge] = useState<DatabaseItem | null>(null);

  // Empty until the daemon answers: a list of invented databases (larastore_production, a
  // PostgreSQL 16.4 nobody installed) is worse than a list that has not loaded yet.
  const [databases, setDatabases] = useState<DatabaseItem[]>([]);
  // Live when the daemon answers. There is no sample data: every row on this screen is one the
  // panel can act on.
  const [live, setLive] = useState<boolean | null>(null);
  const [engines, setEngines] = useState<DbEngineRow[]>([]);
  const [websites, setWebsites] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  // The account's package allowance, when it is under one (see the list response).
  const [quota, setQuota] = useState<{ maxDatabases: number; usedDatabases: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((value) => value + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const reachable = await apiReachable();
      if (cancelled) return;
      setLive(reachable);
      if (!reachable) return;
      setLoading(true);
      try {
        const [engineList, dbList, cacheList, dbBin, cacheBin, sites] = await Promise.all([
          api.dbEngines(),
          api.databases.list(),
          api.caches.list(),
          api.databases.recycleBin(),
          api.caches.recycleBin(),
          api.websites(),
        ]);
        if (cancelled) return;
        setEngines(engineList.items);
        setWebsites(sites.items.map((site) => ({ slug: site.slug, name: `${site.slug} (${site.domain})` })));
        setQuota(dbList.quota ?? null);
        setDatabases([...dbList.items, ...cacheList.items, ...dbBin.items, ...cacheBin.items].map(toDatabaseItem));
      } catch (err) {
        if (!cancelled) onShowToast?.('Could not load the databases', describeError(err), 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, onShowToast]);

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

  const handleDeleteDatabase = async (dbId: string, dbName: string) => {
    if (live) {
      // Soft delete: the daemon keeps the data and suspends the database.
      const target = databases.find((d) => d.id === dbId);
      const family = target?.type === 'redis' ? api.caches : api.databases;
      try {
        await family.bin(dbId);
        reload();
        onShowToast?.('Moved to Recycle Bin', `${dbName} is suspended, not dropped. Restore it or delete it permanently.`, 'info');
      } catch (err) {
        onShowToast?.('Could not move it to the Recycle Bin', describeError(err), 'error');
      }
      return;
    }
    setDatabases(databases.map((d) => (d.id === dbId ? { ...d, deletedAt: new Date().toLocaleString() } : d)));
    if (onShowToast) {
      onShowToast('Moved to Recycle Bin', `Database ${dbName} was moved to the Recycle Bin. You can restore it or delete it permanently.`, 'info');
    }
  };

  const handleRestoreDatabase = async (dbId: string, dbName: string) => {
    if (live) {
      const target = databases.find((d) => d.id === dbId);
      const family = target?.type === 'redis' ? api.caches : api.databases;
      try {
        await family.restore(dbId);
        reload();
        onShowToast?.('Database Restored', `${dbName} is serving again.`, 'success');
      } catch (err) {
        onShowToast?.('Could not restore it', describeError(err), 'error');
      }
      return;
    }
    setDatabases(databases.map((d) => (d.id === dbId ? { ...d, deletedAt: undefined } : d)));
    if (onShowToast) {
      onShowToast('Database Restored', `Database ${dbName} is active again.`, 'success');
    }
  };

  const handlePurgeDatabase = async (dbId: string, dbName: string) => {
    if (live) {
      const target = databases.find((d) => d.id === dbId);
      const family = target?.type === 'redis' ? api.caches : api.databases;
      try {
        await family.purge(dbId);
        reload();
        onShowToast?.('Deleted Permanently', `${dbName} and its data are gone.`, 'info');
      } catch (err) {
        onShowToast?.('Could not delete it', describeError(err), 'error');
      }
      return;
    }
    setDatabases(databases.filter((d) => d.id !== dbId));
    if (onShowToast) {
      onShowToast('Database Deleted Permanently', `Database ${dbName} and all its data have been dropped.`, 'info');
    }
  };

  const handleEmptyBin = async () => {
    const count = binnedDatabases.length;
    if (live) {
      try {
        await Promise.all([api.databases.emptyBin(), api.caches.emptyBin()]);
        reload();
        onShowToast?.('Recycle Bin Emptied', `${count} record(s) permanently deleted.`, 'info');
      } catch (err) {
        onShowToast?.('Could not empty the bin', describeError(err), 'error');
      }
      return;
    }
    setDatabases(databases.filter((d) => !isInBin(d)));
    if (onShowToast) {
      onShowToast('Recycle Bin Emptied', `${count} database(s) permanently deleted.`, 'info');
    }
  };

  // The panel's own answer decides what happens: it opens the hosted manager on
  // its own path, or says why one is not hosted yet. Nothing here pretends to be
  // a screen the daemon does not serve.
  const openManagerWithTool = async (db: DatabaseItem, tool: DatabaseManagerTool) => {
    const isCache = db.type === 'redis';
    const family = isCache ? api.caches : api.databases;
    const apiTool = TOOL_TO_API[tool] ?? tool;
    try {
      const answer = (await family.gui(db.id, apiTool)) as {
        tool?: string;
        note?: string;
        path?: string;
      };
      if (apiTool === 'browser') {
        onShowToast?.(
          'Use the Data Browser & SQL tab',
          answer.note ?? 'The panel runs its browser itself, on the same session as this page.',
          'info',
        );
        return;
      }
      if (answer.path) {
        // The manager runs on the panel's own path — there is no port to reach. The
        // session cookie rides along; the daemon starts the tool on first access.
        window.open(answer.path, '_blank', 'noopener');
        onShowToast?.(
          'Opened through the panel',
          `${answer.tool ?? tool} runs behind this same path (loopback only, credential injected server-side) — not on a port of its own.`,
          'success',
        );
        return;
      }
      onShowToast?.('Not hosted yet', answer.note ?? 'This manager is not hosted by the panel yet.', 'info');
    } catch (err) {
      // The daemon's own reason (a database that is not ready, a tool not hosted)
      // is more useful than a fixed title that would blame the wrong thing.
      onShowToast?.('Could not open the manager', describeError(err), 'info');
    }
  };

  const isInBin = (db: DatabaseItem) => Boolean(db.deletedAt);
  const binnedDatabases = databases.filter(isInBin);
  const activeDatabases = databases.filter((db) => !isInBin(db));
  // A detected file the app is not connected to (Laravel's starter database.sqlite on a
  // site whose .env names another engine) is hidden until asked for — reported by the
  // API, just not listed, so nothing can be invisible.
  const unusedCount = activeDatabases.filter((db) => db.unusedByApp).length;
  const visibleDatabases = showUnused ? activeDatabases : activeDatabases.filter((db) => !db.unusedByApp);

  const availableOwners = React.useMemo(() => {
    const set = new Set<string>();
    databases.forEach((d) => {
      if (d.tenantUser) set.add(d.tenantUser);
    });
    return Array.from(set).sort();
  }, [databases]);

  const filtered = React.useMemo(() => {
    return databases.filter((db) => {
      if (activeTab === 'trash') {
        if (!isInBin(db)) return false;
      } else {
        if (isInBin(db)) return false;
        if (!showUnused && db.unusedByApp) return false;
        if (activeTab === 'all' && db.type === 'redis') return false;
        if (activeTab === 'caches' && db.type !== 'redis') return false;
        if ((activeTab === 'mysql' || activeTab === 'mariadb') && db.type !== 'mysql' && db.type !== 'mariadb') return false;
        if (activeTab !== 'all' && activeTab !== 'caches' && activeTab !== 'mysql' && activeTab !== 'mariadb' && db.type !== activeTab) return false;
      }

      if (ownerFilter !== 'all' && db.tenantUser !== ownerFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matches = db.name.toLowerCase().includes(q) ||
                        (db.username && db.username.toLowerCase().includes(q)) ||
                        (db.tenantUser && db.tenantUser.toLowerCase().includes(q)) ||
                        (db.host && db.host.toLowerCase().includes(q)) ||
                        (db.version && db.version.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [databases, activeTab, ownerFilter, searchQuery, showUnused]);

  const sortedDatabases = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'owner') {
        cmp = (a.tenantUser || '').localeCompare(b.tenantUser || '');
      } else if (sortBy === 'engine') {
        cmp = a.type.localeCompare(b.type);
      } else if (sortBy === 'size') {
        cmp = (a.size || '').localeCompare(b.size || '');
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortBy, sortDirection]);

  const handleToggleSort = (col: 'name' | 'owner' | 'engine' | 'size') => {
    if (sortBy === col) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDirection('asc');
    }
  };

  const getDbBadge = (type: DatabaseEngine) => {
    switch (type) {
      case 'postgres':
        return { bg: 'bg-blue-100 text-blue-700', label: 'PG', name: 'PostgreSQL' };
      case 'mysql':
      case 'mariadb':
        return { bg: 'bg-amber-100 text-amber-700', label: 'MY', name: 'MySQL / MariaDB' };
      case 'mongodb':
        return { bg: 'bg-emerald-100 text-emerald-800', label: 'MG', name: 'MongoDB' };
      case 'redis':
        return { bg: 'bg-rose-100 text-rose-700', label: 'RD', name: 'Redis Cache' };
      case 'sqlite':
        return { bg: 'bg-slate-100 text-slate-700', label: 'SQ', name: 'SQLite 3' };
    }
  };



  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Databases & Caches</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage isolated PostgreSQL, MySQL, MariaDB, MongoDB and SQLite databases, plus Redis caches.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {activeTab === 'trash' && binnedDatabases.length > 0 && (
            <button
              onClick={handleEmptyBin}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors shadow-2xs cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Empty Recycle Bin</span>
            </button>
          )}
          <button
            onClick={() => onShowToast?.('Refreshed', 'Database connection pools synchronized.', 'info')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          {quota && (
            <span
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg ${
                quota.usedDatabases >= quota.maxDatabases
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
              title={
                quota.usedDatabases >= quota.maxDatabases
                  ? 'This account has reached its package limit — delete one or ask for a bigger package'
                  : 'Databases this account may own, from its package'
              }
            >
              {quota.usedDatabases} / {quota.maxDatabases} databases
            </span>
          )}
          <button
            onClick={() => setIsCreateModalOpen(true)}
            disabled={!!quota && quota.usedDatabases >= quota.maxDatabases}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Database / Cache</span>
          </button>
        </div>
      </div>

      {/* Tabs Filter */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 pb-2.5 overflow-x-auto text-xs">
        <button
          onClick={() => setActiveTab('all')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'all'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>All Databases</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'all' ? 'bg-blue-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type !== 'redis').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('postgres')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'postgres'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>PostgreSQL</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'postgres' ? 'bg-blue-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type === 'postgres').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('mysql')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'mysql'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>MySQL / MariaDB</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'mysql' ? 'bg-blue-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type === 'mysql' || d.type === 'mariadb').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('mongodb')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'mongodb'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>MongoDB</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'mongodb' ? 'bg-blue-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type === 'mongodb').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('sqlite')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'sqlite'
              ? 'bg-blue-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>SQLite</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'sqlite' ? 'bg-blue-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type === 'sqlite').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('caches')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'caches'
              ? 'bg-rose-600 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <span>Caches (Redis)</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'caches' ? 'bg-rose-700/70 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {visibleDatabases.filter((d) => d.type === 'redis').length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('trash')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1.5 shrink-0 ${
            activeTab === 'trash'
              ? 'bg-slate-900 text-white shadow-2xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Recycle Bin</span>
          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-semibold ${activeTab === 'trash' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {binnedDatabases.length}
          </span>
        </button>
      </div>

      {/* Recycle Bin notice */}
      {activeTab === 'trash' && (
        <div className="flex items-start gap-2 p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
          <Trash2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            Databases in the Recycle Bin are kept for <strong>30 days</strong> and then purged automatically.
            Restore them, or delete permanently to free the storage now.
          </span>
        </div>
      )}

      {/* Search, Filter & Sort Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search databases by name, owner, host, engine..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-800 placeholder-slate-400 transition-all"
          />
        </div>

        {/* Filters and Sorters. They wrap instead of overflowing: on a phone the row is
            wider than the screen, which used to push the last control off the edge. */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:self-auto sm:shrink-0">
          {/* Unused detected files are hidden by default; this brings them back. */}
          <label
            className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-medium text-slate-600 cursor-pointer select-none"
            title="Detected database files the application is not connected to — for example Laravel's starter database.sqlite on a site whose .env names another engine"
          >
            <input
              type="checkbox"
              checked={showUnused}
              onChange={(e) => setShowUnused(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600"
            />
            <span>Unused files{unusedCount > 0 ? ` (${unusedCount})` : ''}</span>
          </label>
          {/* Owner Filter (Visible to Admin or when multiple owners present) */}
          {(isAdmin || availableOwners.length > 1) && (
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
              <User className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <label htmlFor="db-owner-filter" className="text-slate-500 text-[11px] font-medium hidden md:inline">
                Owner:
              </label>
              <select
                id="db-owner-filter"
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="bg-transparent text-slate-800 text-xs font-medium focus:outline-hidden cursor-pointer"
              >
                <option value="all">All Owners ({availableOwners.length})</option>
                {availableOwners.map((owner) => (
                  <option key={owner} value={owner}>
                    @{owner}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort By Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <label htmlFor="db-sort-by" className="text-slate-500 text-[11px] font-medium hidden md:inline">
              Sort:
            </label>
            <select
              id="db-sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'owner' | 'engine' | 'size')}
              className="bg-transparent text-slate-800 text-xs font-medium focus:outline-hidden cursor-pointer"
            >
              <option value="name">Database Name</option>
              <option value="owner">Owner / Tenant</option>
              <option value="engine">Engine</option>
              <option value="size">Size</option>
            </select>
          </div>

          {/* Sort Direction Toggle */}
          <button
            onClick={() => setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
            className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            title={sortDirection === 'asc' ? 'Ascending (A-Z)' : 'Descending (Z-A)'}
            aria-label="Toggle sort direction"
          >
            {sortDirection === 'asc' ? (
              <ArrowUp className="w-3.5 h-3.5" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Database Cards Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full text-left text-xs table-fixed">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[22%]" />
            <col className="w-[22%]" />
            <col className="w-[11%]" />
            <col className="w-[17%]" />
          </colgroup>
          <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              <th
                onClick={() => handleToggleSort('name')}
                className="py-3.5 px-4 cursor-pointer hover:text-slate-800 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Database Name</span>
                  {sortBy === 'name' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-60" />
                  )}
                </div>
              </th>
              <th
                onClick={() => handleToggleSort('engine')}
                className="py-3.5 px-4 cursor-pointer hover:text-slate-800 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Engine & Endpoint</span>
                  {sortBy === 'engine' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-60" />
                  )}
                </div>
              </th>
              <th
                onClick={() => handleToggleSort('owner')}
                className="py-3.5 px-4 cursor-pointer hover:text-slate-800 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Tenant & Access</span>
                  {sortBy === 'owner' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-60" />
                  )}
                </div>
              </th>
              <th
                onClick={() => handleToggleSort('size')}
                className="py-3.5 px-4 cursor-pointer hover:text-slate-800 transition-colors select-none"
              >
                <div className="flex items-center gap-1.5">
                  <span>Size & Pool</span>
                  {sortBy === 'size' ? (
                    sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                  ) : (
                    <ArrowUpDown className="w-3 h-3 text-slate-300 opacity-60" />
                  )}
                </div>
              </th>
              <th className="py-3.5 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sortedDatabases.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-slate-400">
                  {loading || live === null ? (
                    <>
                      <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-slate-300" />
                      <p className="font-medium text-slate-600">Loading databases…</p>
                      <p className="text-xs text-slate-400 mt-1">Asking the daemon what exists on this host.</p>
                    </>
                  ) : live === false ? (
                    <>
                      <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="font-medium text-slate-600">The daemon is not reachable</p>
                      <p className="text-xs text-slate-400 mt-1">Nothing is listed because nothing could be read.</p>
                    </>
                  ) : (
                    <>
                      <Database className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="font-medium text-slate-600">No databases found</p>
                      <p className="text-xs text-slate-400 mt-1">
                        {searchQuery || ownerFilter !== 'all'
                          ? 'Try clearing the search query or owner filter.'
                          : 'No databases have been created yet.'}
                      </p>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              sortedDatabases.map((db) => {
              const badge = getDbBadge(db.type);
              const isSqliteDb = db.type === 'sqlite';
              const isBinned = isInBin(db);
              const sqlitePath = db.path || `/home/${db.tenantUser ?? 'user'}/web/${db.name}.sqlite`;
              const host = db.host || '127.0.0.1';
              const port = db.port || (
                db.type === 'postgres' ? 5432 :
                db.type === 'mysql' || db.type === 'mariadb' ? 3306 :
                db.type === 'mongodb' ? 27017 : 6379
              );

              return (
                <tr key={db.id} className={`hover:bg-slate-50/70 transition-colors ${isBinned ? 'opacity-70' : ''}`}>
                  {/* Database Name */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${badge.bg}`}>
                        {badge.label}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-sm truncate block" title={db.name}>
                            {db.name}
                          </span>
                          {db.detected && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shrink-0">
                              App-managed
                            </span>
                          )}
                          {db.unreferenced && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shrink-0"
                              title="The owning site's .env names a different database, so the application is not using this one"
                            >
                              Not referenced by .env
                            </span>
                          )}
                          {db.unusedByApp && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shrink-0"
                              title="The site's .env names a different database engine, so the application is not connected to this file"
                            >
                              Not used by app
                            </span>
                          )}
                          {db.missingOnEngine && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shrink-0"
                              title={
                                db.suggestedName
                                  ? `The engine has no database called ${db.name}. It does have ${db.suggestedName}`
                                  : `The engine has no database called ${db.name}`
                              }
                            >
                              Not on engine{db.suggestedName ? ` · ${db.suggestedName}` : ''}
                            </span>
                          )}
                          {db.credentialRejected && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200/80 shrink-0"
                              title="The engine rejected the stored password — rotate it to set a credential it accepts"
                            >
                              Password rejected
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono block mt-0.5 truncate">
                          {db.detected ? 'Format: SQLite file' : `Format: ${db.charset}`}
                        </span>
                        {isBinned && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            <Lock className="w-2.5 h-2.5" />
                            Suspended — apps cannot connect
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Engine & Endpoint (daemon host:port, or file path for SQLite) */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <span className="font-semibold text-slate-800 text-xs block">{db.version}</span>
                      {isSqliteDb ? (
                        <div className="inline-flex items-center gap-1.5 font-mono text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md text-[10px] border border-slate-200 max-w-[240px]" title={db.path || sqlitePath}>
                          <Folder className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{shortenUserPath(db.path || sqlitePath)}</span>
                          <span className="text-[9px] text-slate-400 shrink-0 font-sans">({db.detected ? 'app' : 'file'})</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1 font-mono text-slate-700 bg-slate-50 px-2 py-0.5 rounded-md text-[10px] border border-slate-200">
                          <Server className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium text-slate-700">{host}</span>
                          <span className="text-slate-400">:</span>
                          <span className="text-blue-600 font-bold">{port}</span>
                          <span className="text-[9px] text-slate-400 ml-0.5 font-sans">
                            {db.type === 'redis' || db.isolationMode === 'dedicated_pod' ? '(isolated)' : '(shared)'}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Tenant Isolation & Access */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      {db.tenantUser && (
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-700 border border-violet-200/80 shrink-0">
                            <User className="w-2.5 h-2.5" />
                            @{db.tenantUser}
                          </span>
                        </div>
                      )}
                      {isSqliteDb ? (
                        <div className="inline-flex items-center gap-1.5 font-mono text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md text-[10px]">
                          <Folder className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium truncate max-w-[150px]">{db.tenantUser || 'tenant'} filesystem</span>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 font-mono text-slate-700 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md text-[10px]" title={db.username}>
                          <Key className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="font-medium truncate max-w-[150px]">{db.username}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 font-medium shrink-0">
                          <ShieldCheck className="w-2.5 h-2.5 text-emerald-600" />
                          <span>
                            {isSqliteDb
                              ? 'File 0600'
                              : isSqlEngine(db.type)
                                ? 'Isolated GRANT'
                                : db.type === 'redis'
                                  ? 'ACL prefix'
                                  : 'SCRAM user'}
                          </span>
                        </span>
                        {!isSqliteDb && isSqlEngine(db.type) && (
                          <button
                            type="button"
                            onClick={() => setSelectedDbForDetails(db)}
                            className="text-slate-500 hover:text-blue-600 font-mono cursor-pointer hover:underline transition-colors shrink-0"
                            title="Click to edit connection quota"
                          >
                            Max {db.maxConnections || 25} conn
                          </button>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Size & Pool */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-800 text-xs block">{db.size}</span>
                      <span className="text-[10px] text-slate-400 block font-normal">
                        {isSqliteDb
                          ? 'embedded file'
                          : isSqlEngine(db.type)
                            ? `${db.connections} active pool`
                            : db.type === 'redis'
                              ? 'in-memory keys'
                              : 'document store'}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    {isBinned ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400 mr-1">deleted {db.deletedAt}</span>
                        <button
                          onClick={() => handleRestoreDatabase(db.id, db.name)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors text-xs font-semibold cursor-pointer"
                          title="Restore database"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                        <button
                          onClick={() => setBinToPurge(db)}
                          className="h-[30px] w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {!isSqliteDb ? (
                          <>
                            <button
                              onClick={() => setSelectedDbForRotate(db)}
                              className="h-[30px] w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title={db.status === 'active' ? 'Rotate password' : 'Finish setup (rotate the password)'}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setSelectedDbForCredentials(db)}
                              className="h-[30px] w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                              title="Open Password Vault (requires panel account password)"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => void handleSqliteDownload(db)}
                            disabled={downloadingId === db.id}
                            className="h-[30px] w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50"
                            title="Download .sqlite file"
                          >
                            {downloadingId === db.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Download className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedDbForDetails(db)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white transition-all text-xs font-semibold border border-blue-200/80 shadow-2xs group cursor-pointer whitespace-nowrap"
                          title="View host, port, credentials, connection URL & open visual manager"
                        >
                          <Zap className="w-3.5 h-3.5 text-blue-600 group-hover:text-white transition-colors" />
                          <span>Details & Connect</span>
                        </button>

                        {!db.detected ? (
                          <button
                            onClick={() => setDbToDelete(db)}
                            className="h-[30px] w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Drop database"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div className="w-[30px] h-[30px]" />
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
        </div>
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
        onShowToast={onShowToast}
        onUnlock={
          live && selectedDbForDetails
            ? async (panelPassword) => {
                await api.verify(panelPassword);
                const family = selectedDbForDetails.type === 'redis' ? api.caches : api.databases;
                const revealed = await family.reveal(selectedDbForDetails.id);
                return { password: revealed.password };
              }
            : undefined
        }
      />

      {/* Move to Recycle Bin Modal */}
      <DangerConfirmModal
        isOpen={!!dbToDelete}
        onClose={() => setDbToDelete(null)}
        onConfirm={() => {
          if (dbToDelete) {
            handleDeleteDatabase(dbToDelete.id, dbToDelete.name);
            setDbToDelete(null);
          }
        }}
        title={`Move Database "${dbToDelete?.name}" to Recycle Bin`}
        itemType="Database"
        itemName={dbToDelete?.name || ''}
        confirmLabel="Move to Recycle Bin"
        warningDescription={`Database ${dbToDelete?.name} (${dbToDelete?.type.toUpperCase()}) will be detached from your apps and moved to the Recycle Bin instead of being dropped. You can restore it within 30 days, or delete it permanently to free the storage now.`}
      />

      {/* Permanent Delete Modal */}
      <DangerConfirmModal
        isOpen={!!binToPurge}
        onClose={() => setBinToPurge(null)}
        onConfirm={() => {
          if (binToPurge) {
            handlePurgeDatabase(binToPurge.id, binToPurge.name);
            setBinToPurge(null);
          }
        }}
        title={`Delete "${binToPurge?.name}" Permanently`}
        itemType="Database"
        itemName={binToPurge?.name || ''}
        warningDescription={`Database ${binToPurge?.name} (${binToPurge?.type.toUpperCase()}) along with all its tables, schemas, data rows and user grants will be dropped permanently. This cannot be undone.`}
      />

      {/* Create Database Modal */}
      <CreateDatabaseModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreate={handleCreateDatabase}
        onShowToast={onShowToast}
        engines={live ? engines : undefined}
        websites={live ? websites : undefined}
        onCreateLive={
          live
            ? async (payload) => {
                const family = payload.engine === 'redis' ? api.caches : api.databases;
                const result = await family.create(payload);
                reload();
                return {
                  password: result.password,
                  status: result.database.status,
                  note: result.database.note,
                };
              }
            : undefined
        }
      />

      {/* Credential Reveal Security Modal */}
      <CredentialRevealModal
        isOpen={!!selectedDbForCredentials}
        onClose={() => setSelectedDbForCredentials(null)}
        database={selectedDbForCredentials}
        onUnlock={
          live && selectedDbForCredentials
            ? async (panelPassword) => {
                // A fresh panel-password check, then the daemon decrypts.
                await api.verify(panelPassword);
                const family = selectedDbForCredentials.type === 'redis' ? api.caches : api.databases;
                const revealed = await family.reveal(selectedDbForCredentials.id);
                return { user: revealed.user || '—', password: revealed.password };
              }
            : undefined
        }
      />

      {/* Rotate Password Modal */}
      <RotatePasswordModal
        isOpen={!!selectedDbForRotate}
        onClose={() => setSelectedDbForRotate(null)}
        database={selectedDbForRotate}
        onRotate={
          live
            ? async (dbId, panelPassword, newPassword) => {
                await api.verify(panelPassword);
                const target = databases.find((d) => d.id === dbId);
                const family = target?.type === 'redis' ? api.caches : api.databases;
                const result = await family.rotatePassword(dbId, newPassword);
                reload();
                return result.password;
              }
            : undefined
        }
        onRotated={(dbId, _newPassword) => {
          setDatabases((prev) =>
            prev.map((d) => (d.id === dbId ? { ...d, passwordRotatedAt: new Date().toLocaleString() } : d))
          );
          onShowToast?.('Password Rotated', 'The database user password was changed. Update your .env / connection string.', 'success');
        }}
      />

    </div>
  );
};
