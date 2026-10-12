import React, { useEffect, useState } from 'react';
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
  Layers,
  Trash2,
  Download,
  Loader2,
  FileText,
  Globe,
  Table,
  Play,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import type { DatabaseItem } from '../types';
import { api } from '../api/client';
import { describeAddress } from '../utils/address';
import { saveBlob, failureMessage } from '../api/download';
import { GuardCard } from './GuardCard';

// The names the daemon hosts (see GET /databases/:id/gui): its own browser,
// pgweb for PostgreSQL, phpMyAdmin for MySQL/MariaDB, and dbgate as the plan.
export type DatabaseManagerTool = 'browser' | 'pgweb' | 'phpmyadmin' | 'dbgate';

// Identifiers are quoted per engine: MySQL/MariaDB use backticks, SQLite and
// PostgreSQL double quotes. A double-quoted name is a *string literal* on MySQL by
// default, which is why `SELECT * FROM "notes"` was a syntax error there.
const quoteIdent = (type: DatabaseItem['type'], name: string): string =>
  type === 'mysql' || type === 'mariadb'
    ? '`' + name.replace(/`/g, '``') + '`'
    : '"' + name.replace(/"/g, '""') + '"';

interface DatabaseDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  database: DatabaseItem | null;
  onOpenGui: (db: DatabaseItem, tool: DatabaseManagerTool) => void;
  onDelete?: (db: DatabaseItem) => void;
  onUpdateDatabase?: (updated: DatabaseItem) => void;
  onUnlock?: (panelPassword: string) => Promise<{ password: string }>;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

/**
 * The lockout names engines its own way: PostgreSQL's log source is `postgresql`, and MySQL and
 * MariaDB share one source called `mariadb` (they share a log). A record's own type is not that
 * name, so the banned list can only be filtered once the two are mapped.
 */
function guardEngineFor(type: string): string | undefined {
  switch (type) {
    case 'postgres':
      return 'postgresql';
    case 'mysql':
    case 'mariadb':
      return 'mariadb';
    case 'mongodb':
      return 'mongodb';
    case 'redis':
      return 'redis';
  }
  return undefined;
}

export const DatabaseDetailsModal: React.FC<DatabaseDetailsModalProps> = ({
  isOpen,
  onClose,
  database,
  onOpenGui,
  onDelete,
  onUpdateDatabase,
  onUnlock,
  onShowToast,
}) => {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelPassword, setPanelPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'params' | 'env'>('params');
  const [isEditingMaxConn, setIsEditingMaxConn] = useState(false);
  const [selectedMaxConn, setSelectedMaxConn] = useState<number>(database?.maxConnections || 25);
  const [autoLockSeconds, setAutoLockSeconds] = useState(60);
  const [exporting, setExporting] = useState(false);

  // Export goes through the panel's own request rather than an <a download>: the browser's
  // download stack refuses to run on an origin whose certificate was clicked past, which is
  // why the old link failed with "Failed - Network error" while the rest of the page worked.
  const handleExport = async () => {
    if (!database || exporting) return;
    setExporting(true);
    setErrorMsg('');
    try {
      const blob = await family.export(database.id);
      saveBlob(blob, `${database.name}.${database.type === 'sqlite' ? 'sqlite' : 'sql'}`);
    } catch (err) {
      setErrorMsg(failureMessage(err, 'The dump could not be produced.'));
    } finally {
      setExporting(false);
    }
  };

  // Data Browser & Navigation Tab States
  const [dataTabActive, setDataTabActive] = useState<'overview' | 'security' | 'data' | 'logs'>('overview');

  // The engine's own log, and the exposure switch. Both are the daemon's answer rather than a
  // local guess: opening a port is refused while the lockout cannot keep brute-force out.
  // The daemon's answer is the only definition of this shape: deriving it from the client means
  // the view cannot drift from what the endpoint actually sends.
  type DatabaseLog = Awaited<ReturnType<typeof api.databases.log>>;

  const [logs, setLogs] = useState<DatabaseLog | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  // One key's shape, for the cache browser below: the endpoint existed and nothing called it, so a
  // key's type and TTL could not be seen anywhere in the panel.
  const [keyDetail, setKeyDetail] = useState<{ key: string; type?: string; ttl?: number; value?: string; note?: string } | null>(null);
  const [keyLoading, setKeyLoading] = useState('');
  const [exposure, setExposure] = useState<'public' | 'private'>(
    database?.exposure === 'public' ? 'public' : 'private',
  );
  const [exposureNote, setExposureNote] = useState(database?.exposureNote || '');
  const [exposureBusy, setExposureBusy] = useState(false);
  const [guard, setGuard] = useState<{ enforcing: boolean; reason: string } | null>(null);
  // The panel-wide external address, when the operator has set one.
  const [externalAddress, setExternalAddress] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const status = await api.guard();
        if (alive) setGuard({ enforcing: status.enforcing, reason: status.reason || '' });
      } catch {
        // A panel that cannot report the lockout cannot be assumed to have one.
        if (alive) setGuard({ enforcing: false, reason: 'the lockout status could not be read' });
      }
      try {
        const settings = await api.panelSettings();
        if (alive) setExternalAddress(settings.externalAddress || '');
      } catch {
        // A panel that cannot read the setting simply names the address it is being used on.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const loadLogs = async () => {
    if (!database || logsLoading) return;
    setLogsLoading(true);
    try {
      setLogs(await family.log(database.id));
    } catch (err) {
      setLogs({ engine: database.type, source: '', note: failureMessage(err, 'the log could not be read'), lines: [], audit: [] });
    } finally {
      setLogsLoading(false);
    }
  };

  const openKey = async (name: string) => {
    if (!database || keyLoading) return;
    setKeyLoading(name);
    try {
      setKeyDetail(await family.key(database.id, name));
    } catch (err) {
      setKeyDetail({ key: name, note: failureMessage(err, 'the key could not be read') });
    } finally {
      setKeyLoading('');
    }
  };

  const changeExposure = async (next: 'public' | 'private') => {
    if (!database || exposureBusy) return;
    setExposureBusy(true);
    setErrorMsg('');
    try {
      const result = await family.setExposure(database.id, next);
      setExposure(next);
      setExposureNote(result.note);
      if (onUpdateDatabase) {
        onUpdateDatabase({
          ...database,
          exposure: next,
          exposureNote: result.note,
        });
      }
      onShowToast?.(
        next === 'public' ? 'Public Access Enabled' : 'Private Access Restored',
        result.note || (next === 'public' ? 'Port opened to external clients.' : 'Port restricted to loopback.'),
        'success'
      );
    } catch (err) {
      const msg = failureMessage(err, 'the exposure could not be changed');
      setErrorMsg(msg);
      onShowToast?.('Failed to change exposure', msg, 'error');
    } finally {
      setExposureBusy(false);
    }
  };
  const [tableList, setTableList] = useState<string[]>([]);
  const [redisKeys, setRedisKeys] = useState<{ keys: string[]; count: number } | null>(null);
  const [loadingTables, setLoadingTables] = useState(false);
  const [tablesError, setTablesError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sqlQuery, setSqlQuery] = useState<string>('');
  const [queryRunning, setQueryRunning] = useState(false);
  const [queryResult, setQueryResult] = useState<{
    columns: string[];
    rows: (string | null)[][];
    affected: number;
    truncated: boolean;
  } | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [showSqlEditor, setShowSqlEditor] = useState(false);

  React.useEffect(() => {
    if (database) {
      setSelectedMaxConn(database.maxConnections || 25);
      setIsEditingMaxConn(false);
      setIsUnlocked(false);
      setShowPasswordText(false);
      setPanelPassword('');
      setAutoLockSeconds(60);
      setRevealedPassword(null);
      setBusy(false);
      setDataTabActive('overview');
      setTableList([]);
      setRedisKeys(null);
      setSelectedTable(null);
      setSqlQuery('');
      setQueryResult(null);
      setQueryError(null);
      setTablesError(null);
      setShowSqlEditor(false);
      setExposure(database.exposure === 'public' ? 'public' : 'private');
      setExposureNote(database.exposureNote || '');
      // Another database's log must not survive the switch: without this the panel renders the
      // previous engine's lines while the new ones are still being fetched, which is how a
      // SQLite database came to be shown a PostgreSQL log.
      setLogs(null);
      setLogsLoading(false);
      setKeyDetail(null);
      setKeyLoading('');
    }
  }, [database]);

  const loadTables = async () => {
    if (!database) return;
    setLoadingTables(true);
    setTablesError(null);
    try {
      const family = database.type === 'redis' ? api.caches : api.databases;
      const res = await family.tables(database.id);
      if (res.tables) {
        setTableList(res.tables);
        if (res.tables.length > 0 && !selectedTable) {
          const first = res.tables[0];
          setSelectedTable(first);
          const initialSql = `SELECT * FROM ${quoteIdent(database.type, first)} LIMIT 50;`;
          setSqlQuery(initialSql);
          runQuery(initialSql);
        }
      }
      if (res.keys) {
        setRedisKeys({ keys: res.keys, count: res.keyCount ?? res.keys.length });
      }
    } catch (err: any) {
      setTablesError(err?.message || 'Could not load tables from daemon');
    } finally {
      setLoadingTables(false);
    }
  };

  const runQuery = async (queryToRun?: string) => {
    const q = (queryToRun ?? sqlQuery).trim();
    if (!q || !database) return;
    setQueryRunning(true);
    setQueryError(null);
    try {
      const family = database.type === 'redis' ? api.caches : api.databases;
      const res = await family.query(database.id, q);
      setQueryResult(res);
    } catch (err: any) {
      setQueryError(err?.message || 'Query failed');
      setQueryResult(null);
    } finally {
      setQueryRunning(false);
    }
  };

  // Password Vault auto-lock: re-encrypt credential after 60 seconds unlocked
  React.useEffect(() => {
    if (!isUnlocked) return;
    setAutoLockSeconds(60);
    const timer = setInterval(() => {
      setAutoLockSeconds(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isUnlocked]);

  React.useEffect(() => {
    if (isUnlocked && autoLockSeconds === 0) {
      setIsUnlocked(false);
      setShowPasswordText(false);
      setPanelPassword('');
      setAutoLockSeconds(60);
      setRevealedPassword(null);
    }
  }, [isUnlocked, autoLockSeconds]);

  if (!isOpen || !database) return null;

  // A cache is the same record with a different engine and lives under its own family of
  // endpoints: asking /databases for a cache answers "No such record", which is what the Logs
  // tab used to show for a record the panel was displaying.
  const family = database.type === 'redis' ? api.caches : api.databases;

  // The in-panel tab stays only where no manager can open the record. PostgreSQL, MySQL and
  // MariaDB open pgweb / phpMyAdmin (host binaries, so loopback is reachable); SQLite (a file
  // DbGate mounts) and MongoDB (a document store it speaks) open DbGate. Redis keeps the key
  // inspector, and the daemon's own refusal is why: asking for DbGate on a cache answers
  // "dbgate is not hosted here yet (DbGate runs as a container and cannot reach Redis, which
  // listens on the host's loopback only … use the panel's own browser)". Being started on
  // demand does not change that — what decides reachability is the container's network, not
  // when it starts. So this tab is the only way to see inside a cache, not a duplicate of one.
  const showsDataTab = database.type === 'redis';
  // A logical dump exists for the SQL engines (SQLite's is a copy of its file).
  const canExport =
    database.type === 'sqlite' ||
    database.type === 'postgres' ||
    database.type === 'mysql' ||
    database.type === 'mariadb';
  const createTableTemplate = (() => {
    const name = `notes_${Date.now().toString().slice(-4)}`;
    switch (database.type) {
      case 'postgres':
        return `CREATE TABLE IF NOT EXISTS "${name}" (\n  id serial PRIMARY KEY,\n  title text NOT NULL,\n  created_at timestamptz DEFAULT now()\n);`;
      case 'mysql':
      case 'mariadb':
        return `CREATE TABLE IF NOT EXISTS \`${name}\` (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  title VARCHAR(255) NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
      default:
        return `CREATE TABLE IF NOT EXISTS "${name}" (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  title TEXT NOT NULL,\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`;
    }
  })();

  const mockPasswords: Record<string, string> = {
    'db-1': 'bp_pg_98f!aA72#xK',
    'db-2': 'analytics_sec_89Qv$L1',
    'db-3': 'mongo_cl_4412$zP9@w',
    'db-4': 'rd_cache_k9921_xOp8#',
    'db-5': 'wp_mysql_pass_8829#',
    'db-6': 'pos_legacy_pwd_771@',
  };

  const plainPassword = revealedPassword ?? mockPasswords[database.id] ?? 'barepod_secret_key_889#';
  const effectivePassword = isUnlocked ? plainPassword : '••••••••••••';

  const isPublic = exposure === 'public';
  // The operator's answer wins where it applies — when the database is public, because that is when a
  // client outside this host has to reach it and the daemon cannot know the address. A private
  // database keeps its own host, because loopback is exactly what private means.
  const effectiveHost = isPublic && externalAddress
    ? externalAddress
    : isPublic
      ? (typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : (database.host || '127.0.0.1'))
      : (database.host || '127.0.0.1');

  const host = effectiveHost;
  const addressKind = describeAddress(host);
  const port = database.port || (
    database.type === 'postgres' ? 5432 :
    database.type === 'mysql' || database.type === 'mariadb' ? 3306 :
    database.type === 'mongodb' ? 27017 :
    database.type === 'sqlite' ? 0 : 6379
  );

  // Generate Direct Connection URL String
  const getConnectionUrl = (includePlainPassword: boolean = false) => {
    const pwd = includePlainPassword && isUnlocked ? plainPassword : (isUnlocked ? plainPassword : '<password>');
    switch (database.type) {
      case 'postgres':
        return `postgresql://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}?sslmode=prefer`;
      case 'mysql':
      case 'mariadb':
        return `mysql://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}`;
      case 'mongodb':
        return `mongodb://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}?authSource=admin`;
      case 'redis':
        return `redis://:${pwd}@${effectiveHost}:${port}/0`;
      case 'sqlite':
        return `sqlite:///home/${database.tenantUser ?? 'user'}/apps/${database.name}.sqlite`;
    }
  };

  // Generate .env snippet
  const getEnvSnippet = (includePlainPassword: boolean = false) => {
    const pwd = includePlainPassword && isUnlocked ? plainPassword : (isUnlocked ? plainPassword : 'YOUR_PASSWORD');
    switch (database.type) {
      case 'postgres':
        return `# PostgreSQL Configuration
# Both shapes are given on purpose, not by accident: DATABASE_URL is for anything that takes one
# connection URL, and the individual variables are what a Laravel-style framework reads. A PHP site
# is given both by the daemon; a Node or Python site is given DATABASE_URL.
DATABASE_URL="postgresql://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}?schema=public"
DB_CONNECTION=pgsql
DB_HOST=${effectiveHost}
DB_PORT=${port}
DB_DATABASE=${database.name}
DB_USERNAME=${database.username}
DB_PASSWORD=${pwd}`;
      case 'mysql':
      case 'mariadb':
        return `# MySQL / MariaDB Configuration
# Two shapes, two consumers: DATABASE_URL for a tool that takes one URL, and the individual
# variables for a Laravel-style framework. A PHP site is given both; other runtimes only the URL.
DATABASE_URL="mysql://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}"
DB_CONNECTION=mysql
DB_HOST=${effectiveHost}
DB_PORT=${port}
DB_DATABASE=${database.name}
DB_USERNAME=${database.username}
DB_PASSWORD=${pwd}`;
      case 'mongodb':
        return `# MongoDB Connection
# The URI is what an application uses. MONGO_INITDB_DATABASE is only for the official image's first
# start — it does not configure an application.
MONGODB_URI="mongodb://${database.username}:${pwd}@${effectiveHost}:${port}/${database.name}?authSource=admin"
MONGO_INITDB_DATABASE=${database.name}`;
      case 'redis':
        return `# Redis In-Memory Store
REDIS_URL="redis://:${pwd}@${host}:${port}/0"
REDIS_HOST=${host}
REDIS_PORT=${port}
REDIS_PASSWORD=${pwd}`;
      case 'sqlite':
        return `# SQLite (file-based, no daemon)
DB_CONNECTION=sqlite
DB_DATABASE=/home/${database.tenantUser ?? 'user'}/apps/${database.name}.sqlite`;
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const handleUnlockPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!panelPassword.trim()) {
      setErrorMsg('Enter your panel account password.');
      return;
    }
    if (onUnlock) {
      setBusy(true);
      setErrorMsg('');
      try {
        const res = await onUnlock(panelPassword);
        setRevealedPassword(res.password);
        setIsUnlocked(true);
        setShowPasswordText(true);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'That password was not accepted.');
      } finally {
        setBusy(false);
      }
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
        return { bg: 'bg-blue-100 text-blue-700', label: 'PostgreSQL', port: 5432 };
      case 'mysql':
      case 'mariadb':
        return { bg: 'bg-amber-100 text-amber-700', label: 'MySQL/MariaDB', port: 3306 };
      case 'mongodb':
        return { bg: 'bg-emerald-100 text-emerald-800', label: 'MongoDB', port: 27017 };
      case 'redis':
        return { bg: 'bg-rose-100 text-rose-700', label: 'Redis Cache', port: 6379 };
      case 'sqlite':
        return { bg: 'bg-slate-100 text-slate-700', label: 'SQLite', port: 0 };
    }
  };

  const badge = getBadge();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className={`bg-white rounded-2xl border border-slate-200 shadow-2xl ${dataTabActive === 'data' || dataTabActive === 'security' ? 'max-w-4xl' : 'max-w-3xl'} w-full overflow-hidden flex flex-col max-h-[92vh] transition-all duration-200`}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-2xs ${badge.bg}`}>
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-slate-900">{database.name}</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
                {database.type !== 'sqlite' && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${
                      exposure === 'public'
                        ? 'bg-amber-50 text-amber-800 border-amber-300'
                        : 'bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    {exposure === 'public' ? (
                      <>
                        <Globe className="w-3 h-3 text-amber-600" />
                        <span>Public Access</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3 h-3 text-slate-500" />
                        <span>Private (Loopback)</span>
                      </>
                    )}
                  </span>
                )}
                {database.detected ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Detected (app-managed)
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 font-mono">({database.charset})</span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {database.detected && database.path ? database.path : `${database.version} • ${badge.label} • ${database.size}`}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 bg-slate-50 border-b border-slate-200 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDataTabActive('overview')}
            className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              dataTabActive === 'overview'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Connection & Credentials</span>
          </button>

          {/* Shown for a cache too, now that the lockout really covers it: Redis writes no refusals
              to its log at all, so its refusals are read from Redis's own ACL LOG — verified by
              banning an address that failed AUTH six times against a cache. */}
          {database.type !== 'sqlite' && (
            <button
              type="button"
              onClick={() => setDataTabActive('security')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                dataTabActive === 'security'
                  ? 'border-blue-600 text-blue-600 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Security & Anti-Bruteforce</span>
              {exposure === 'public' && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Public access active" />
              )}
            </button>
          )}

          {showsDataTab && (
            <button
              type="button"
              onClick={() => {
                setDataTabActive('data');
                if (tableList.length === 0 && !redisKeys && !tablesError) {
                  loadTables();
                }
              }}
              className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
                dataTabActive === 'data'
                  ? 'border-blue-600 text-blue-600 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Keys</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setDataTabActive('logs');
              void loadLogs();
            }}
            className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              dataTabActive === 'logs'
                ? 'border-blue-600 text-blue-600 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Logs</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {dataTabActive === 'logs' ? (
            <div className="space-y-4">
              {/* Engine Log Card */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-slate-600" />
                    <div>
                      <h3 className="text-xs font-bold text-slate-800">
                        {database.type === 'sqlite' ? 'SQLite Engine Information' : 'Engine Service Output (Live Tail)'}
                      </h3>
                      <p className="text-[11px] text-slate-500 font-mono truncate max-w-md">
                        {logsLoading ? 'Reading…' : logs?.source || 'no source'}
                        {logs?.note ? ` · ${logs.note}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadLogs()}
                    disabled={logsLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin text-blue-600' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>

                <div className="p-3">
                  {database.type === 'sqlite' ? (
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1.5">
                      <div className="flex items-center gap-2 font-semibold text-slate-800">
                        <Lock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Embedded In-Process Database</span>
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        SQLite operates directly inside your application process via filesystem I/O without a background service daemon, network port, or central log file.
                      </p>
                      <p className="text-[11px] font-mono text-slate-600">
                        File path: {database.path || `/home/${database.tenantUser ?? 'user'}/apps/${database.name}.sqlite`}
                      </p>
                    </div>
                  ) : (
                    <pre className="text-[11px] leading-relaxed bg-slate-900 text-slate-100 rounded-lg p-3 overflow-auto max-h-56 whitespace-pre-wrap font-mono selection:bg-blue-600">
                      {logs?.lines && logs.lines.length > 0 ? logs.lines.join('\n') : logs?.note || 'No log lines found.'}
                    </pre>
                  )}
                </div>
              </div>

              {/* Panel Action Audit Trail */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Panel Audit Trail</h4>
                      <p className="text-[10px] text-slate-400">Security and administrative actions performed on this database</p>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {logs?.audit ? `${logs.audit.length} event(s)` : '0 events'}
                  </span>
                </div>

                <div className="max-h-56 overflow-y-auto">
                  {logs?.audit && logs.audit.length > 0 ? (
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 sticky top-0">
                        <tr>
                          <th className="py-2 px-3">Timestamp</th>
                          <th className="py-2 px-3">Action</th>
                          <th className="py-2 px-3">Details</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                        {logs.audit.map((entry, index) => {
                          const timeStr = (entry.at || entry.ts || '').replace('T', ' ').slice(0, 19);
                          return (
                            <tr key={`${entry.id ?? index}-${timeStr}`} className="hover:bg-slate-50/60">
                              <td className="py-2 px-3 text-slate-400 whitespace-nowrap">{timeStr}</td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-sans font-bold ${
                                  entry.action.includes('exposure')
                                    ? 'bg-amber-100 text-amber-800'
                                    : entry.action.includes('export')
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}>
                                  {entry.action}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-600 truncate max-w-xs" title={entry.detail}>
                                {entry.detail}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-400">
                      Nothing recorded about this database yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : dataTabActive === 'security' ? (
            <div className="space-y-5">
              {/* Card 1 only where the switch can do something. For a cache it cannot: an installed
                  Redis listens where its own configuration says, and the panel does not rewrite that
                  file, so Public is not offered and the card would be a dead switch. What protects a
                  cache is said instead — the parts that are true of it. */}
              {database.type === 'redis' ? (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/60 flex items-center gap-3">
                    <div className="p-2 rounded-xl border bg-slate-100 text-slate-700 border-slate-200">
                      <Lock className="w-4 h-4 text-slate-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">How this cache is protected</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Port {port}, and no switch to open it — there is nothing here that needs one.
                      </p>
                    </div>
                  </div>
                  <ul className="px-5 py-4 text-xs text-slate-600 space-y-1.5 list-disc list-inside">
                    <li>
                      It listens on <code>127.0.0.1</code> (and the container gateway, so a manager in a
                      container can open it) — not on the network; the panel's firewall keeps every other
                      interface out.
                    </li>
                    <li>
                      <code>default</code> is off: nothing authenticates to it without credentials, and each
                      record has its own account, scoped to its own key prefix.
                    </li>
                    <li>
                      Refused logins are read from Redis's own ACL log by the lockout below, so an address
                      that keeps failing is kept out of the host — verified by banning one.
                    </li>
                  </ul>
                </div>
              ) : (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl border ${exposure === 'public' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                      {exposure === 'public' ? <Globe className="w-4 h-4 text-amber-600" /> : <Lock className="w-4 h-4 text-slate-600" />}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Network Exposure & Firewall Access</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Controls whether port {port} answers on external interfaces or is locked to loopback.
                      </p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1.5 self-start sm:self-auto ${
                    exposure === 'public'
                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  }`}>
                    {exposure === 'public' ? <Globe className="w-3.5 h-3.5 text-amber-600" /> : <Lock className="w-3.5 h-3.5 text-emerald-600" />}
                    <span>Currently {exposure === 'public' ? 'Public' : 'Private'}</span>
                  </span>
                </div>

                <div className="p-5 space-y-4">
                  {guard && !guard.enforcing && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Public exposure requires Anti-Bruteforce Guard:</span>
                        <p className="mt-0.5 text-amber-800">
                          {guard.reason || 'The brute-force lockout must be actively enforcing in the kernel before external access can be granted.'}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Option 1: Private */}
                    <div
                      onClick={() => {
                        if (exposure !== 'private' && !exposureBusy) void changeExposure('private');
                      }}
                      className={`p-4 rounded-xl border-2 transition-all cursor-pointer relative ${
                        exposure === 'private'
                          ? 'border-emerald-600 bg-emerald-50/30 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Lock className={`w-4 h-4 ${exposure === 'private' ? 'text-emerald-700' : 'text-slate-500'}`} />
                          <span className="font-bold text-sm text-slate-900">Private (Loopback Only)</span>
                        </div>
                        {exposure === 'private' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-700" /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {exposureNote ? (
                          exposureNote
                        ) : (
                          <>
                            Nothing outside this host can reach port <strong>{port}</strong> as it stands.
                            The engine may be bound to <code>127.0.0.1</code> by its own configuration, or the
                            panel's firewall may be dropping every other interface — the panel does not guess
                            which: use the switch and it reports exactly what it did here.
                          </>
                        )}
                      </p>
                      <ul className="text-[11px] text-slate-500 mt-2 space-y-1 list-disc list-inside">
                        <li>Immune to external port scans and automated internet attacks</li>
                        <li>Accessible by local applications and SSH port forwarding tunnels</li>
                      </ul>
                      {exposure !== 'private' && (
                        <button
                          type="button"
                          disabled={exposureBusy}
                          className="mt-3 w-full py-1.5 px-3 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
                        >
                          {exposureBusy ? 'Updating…' : 'Switch to Private'}
                        </button>
                      )}
                    </div>

                    {/* Option 2: Public */}
                    <div
                      onClick={() => {
                        if (exposure !== 'public' && !exposureBusy && guard?.enforcing !== false) void changeExposure('public');
                      }}
                      className={`p-4 rounded-xl border-2 transition-all relative ${
                        guard?.enforcing === false
                          ? 'opacity-60 cursor-not-allowed border-slate-200 bg-slate-50'
                          : exposure === 'public'
                            ? 'border-amber-500 bg-amber-50/30 shadow-xs cursor-pointer'
                            : 'border-slate-200 hover:border-slate-300 bg-white cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Globe className={`w-4 h-4 ${exposure === 'public' ? 'text-amber-600' : 'text-slate-500'}`} />
                          <span className="font-bold text-sm text-slate-900">Public (Open to Outside)</span>
                        </div>
                        {exposure === 'public' && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1">
                            <Check className="w-3 h-3 text-amber-700" /> Active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Port <strong>{port}</strong> is opened to the host's other interfaces. Where the
                        engine has its own authorisation — PostgreSQL's <code>pg_hba</code>, a MariaDB
                        account that may connect from anywhere — the panel changes that with it; for a
                        containerised engine the panel's firewall is the whole control, and the note above
                        says which was done.
                      </p>
                      <ul className="text-[11px] text-slate-500 mt-2 space-y-1 list-disc list-inside">
                        <li>Reachable from machines that can route to this host</li>
                        <li>Protected by the kernel-level brute-force watchdog</li>
                      </ul>
                      {exposure !== 'public' && (
                        <button
                          type="button"
                          disabled={exposureBusy || guard?.enforcing === false}
                          className="mt-3 w-full py-1.5 px-3 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 transition-colors cursor-pointer"
                        >
                          {exposureBusy ? 'Updating…' : 'Switch to Public'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* The daemon writes a note only when the switch is used, so a record nobody has
                      touched has none — and silence there read as "is this one protected at all?".
                      The default describes what is true of it instead. */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    <span className="text-slate-400 font-sans font-semibold uppercase text-[10px] block mb-1">
                      {exposureNote ? 'Daemon Execution Note:' : 'Current state:'}
                    </span>
                    {exposureNote ||
                      `Nothing outside this host can reach port ${port}, and the daemon has not had to change anything for this record: that is the engine's own configuration plus the panel's firewall. Use the switch above, and it reports exactly what it did.`}
                  </div>
                </div>
              </div>
              )}

              <GuardCard onShowToast={onShowToast} variant="bans" engine={guardEngineFor(database.type)} />
            </div>
          ) : dataTabActive === 'overview' ? (
            <>
          {/* Direct SSO Web GUI Launcher Section */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-md border border-indigo-900/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-blue-300 text-xs font-semibold uppercase tracking-wider">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Database Web Studio (Zero Re-Login SSO)</span>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Open the visual database manager without entering user & password again:
                </p>
              </div>

              {/* GUI Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {database.type === 'postgres' && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'pgweb');
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open pgweb</span>
                  </button>
                )}

                {(database.type === 'mysql' || database.type === 'mariadb') && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenGui(database, 'phpmyadmin');
                    }}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open phpMyAdmin</span>
                  </button>
                )}

                {/* DbGate is offered for a cache too: the engine may be bound to the container
                    gateway as well as loopback, and the daemon decides by measuring whether a
                    container can open it — when it cannot, it says why and the attempt is audited
                    as a refusal. */}
                <button
                  onClick={() => {
                    onClose();
                    onOpenGui(database, 'dbgate');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  <span>Open DbGate</span>
                </button>
              </div>
            </div>
          </div>

          {/* Quick Tools & Network Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
            {/* Export tool */}
            <div className="flex items-center gap-2">
              {canExport ? (
                <button
                  type="button"
                  onClick={() => void handleExport()}
                  disabled={exporting}
                  className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                  title="Download a logical dump (pg_dump / mysqldump, or the .sqlite file)"
                >
                  {exporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-blue-600" />
                  )}
                  <span>{exporting ? 'Exporting…' : `Export ${database.type === 'sqlite' ? '.sqlite' : '.sql'}`}</span>
                </button>
              ) : null}
            </div>

            {/* Network Access & Firewall status indicator. Not shown for a cache: the panel has no
                exposure switch for one (an installed Redis binds 127.0.0.1 by its own config, which
                the panel does not rewrite), so a "Private (Loopback Only)" badge with a Settings
                link would lead to a screen that offers nothing. Hiding the tab alone was not
                enough — this badge was the way back into it. */}
            {database.type !== 'sqlite' && database.type !== 'redis' && (
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <span className="text-[11px] text-slate-500 font-medium">Network Access:</span>
                <button
                  type="button"
                  onClick={() => setDataTabActive('security')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
                    exposure === 'public'
                      ? 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  {exposure === 'public' ? (
                    <>
                      <Globe className="w-3.5 h-3.5 text-amber-600" />
                      <span>Public (Port Open)</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Private (Loopback Only)</span>
                    </>
                  )}
                  <span className="text-[10px] text-blue-600 font-bold underline ml-1">Settings</span>
                </button>
              </div>
            )}
          </div>

          {/* Quick Connection URL Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-800">Connection URL (Direct String)</span>
              </div>
              <span className="text-[10px] text-slate-400 font-medium">
                Use this URL in .env / Prisma / your app without manual input
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
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Host / Server</span>
                    {database.type !== 'sqlite' && (
                      <span
                        title={
                          addressKind.tone === 'private'
                            ? 'A private address (RFC1918) — reachable only inside its own network, not from the internet.'
                            : addressKind.tone === 'loopback'
                              ? 'Reachable on this host only.'
                              : 'A publicly routable address.'
                        }
                        className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                          addressKind.tone === 'public'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : addressKind.tone === 'private'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {addressKind.label}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-semibold text-slate-800 text-xs">{host}</span>
                  {isPublic && database.type !== 'sqlite' && (
                    <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                      {externalAddress ? 'The address set in Panel Settings. ' : ''}
                      For a direct TCP connection: a domain proxied by a CDN carries only HTTP(S) on its
                      own ports, so it cannot be a database address — use a public IP, an unproxied name,
                      or a port forward.
                    </p>
                  )}
                </div>
                <button
                  onClick={() => handleCopy(host, 'host')}
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
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
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    {database.type === 'redis' ? 'DB Index (Numeric)' : 'Database Name'}
                  </span>
                  <span className="font-mono font-semibold text-slate-800 text-xs">
                    {database.type === 'redis' ? '0 (db0 Key-Value)' : database.name}
                  </span>
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

            {/* Password Protection & Decrypt Row (not applicable to file-based SQLite) */}
            {database.type !== 'sqlite' && (
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
                      <span
                        className="px-2 py-1 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg flex items-center gap-1 whitespace-nowrap"
                        title="Credentials re-lock automatically"
                      >
                        <Lock className="w-3 h-3" />
                        Auto-lock {autoLockSeconds}s
                      </span>
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
                        disabled={busy}
                        className="px-3 py-1 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors whitespace-nowrap shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? 'Verifying...' : 'Unlock'}
                      </button>
                    </form>
                  )}
                </div>
              </div>
              {errorMsg && (
                <p className="text-[10px] text-rose-600 mt-1 font-semibold">{errorMsg}</p>
              )}
            </div>
            )}

            {database.type === 'sqlite' && (
              <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 flex items-start gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                <span>SQLite is a file-based embedded database — there are no credentials or network daemon. Access is controlled by file ownership and permissions (0600, tenant user).</span>
              </div>
            )}

            {/* Tenant Isolation & Security Scope Card */}
            <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-bold text-slate-800">
                    Tenant Security & Isolation Scope
                  </span>
                </div>
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold">
                  Isolated Per-User
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] font-mono">
                <div className="p-2 bg-white rounded border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-sans block">Execution Mode</span>
                  <span className="text-slate-800 font-semibold">
                    {database.type === 'sqlite' ? 'Embedded file (no daemon)' : `Shared Daemon (Port ${port})`}
                  </span>
                </div>
                <div className="p-2 bg-white rounded border border-slate-200">
                  {/* The engine-side name, not the account: the account is the username the
                      form asked for, and the two are easy to confuse (a prefix like
                      admin_gg is the database's name, gg is its user). */}
                  <span className="text-[10px] text-slate-400 font-sans block">
                    Database Name {database.username && <>· user <b>{database.username}</b></>}
                  </span>
                  <span
                    className="text-slate-800 font-semibold truncate block"
                    title={`GRANT ALL ON ${database.name}.* — the engine-side database name (your account prefixes it)`}
                  >
                    {database.name}
                  </span>
                </div>
                {isEditingMaxConn ? (
                  <div className="p-2 bg-white rounded border border-blue-300 ring-1 ring-blue-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-blue-600 font-sans font-bold">Edit Connection Quota</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingMaxConn(false)}
                        className="text-[10px] text-slate-400 hover:text-slate-600 font-sans cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <select
                        value={selectedMaxConn}
                        onChange={(e) => setSelectedMaxConn(Number(e.target.value))}
                        className="text-[11px] font-mono px-1.5 py-0.5 border border-slate-300 rounded bg-slate-50 flex-1 focus:outline-hidden"
                      >
                        <option value={15}>15 conn (Micro)</option>
                        <option value={25}>25 conn (Standard)</option>
                        <option value={50}>50 conn (High)</option>
                        <option value={100}>100 conn (Heavy)</option>
                        <option value={250}>250 conn (Max)</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateDatabase?.({ ...database, maxConnections: selectedMaxConn });
                          setIsEditingMaxConn(false);
                        }}
                        className="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-sans font-semibold hover:bg-blue-700 cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 bg-white rounded border border-slate-200">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-sans block">Max Connection Pool</span>
                      <button
                        type="button"
                        onClick={() => setIsEditingMaxConn(true)}
                        className="text-[10px] font-sans text-blue-600 hover:text-blue-800 font-semibold hover:underline cursor-pointer"
                      >
                        Edit
                      </button>
                    </div>
                    <span className="text-slate-800 font-semibold block mt-0.5">
                      {database.maxConnections || 25} connections quota
                    </span>
                  </div>
                )}
              </div>
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
          </>
          ) : (
            <div className="space-y-4">
              {/* Header toolbar */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-800">
                      {database.type === 'sqlite'
                        ? 'SQLite In-Process Browser & Query'
                        : database.type === 'redis'
                        ? 'Redis Prefix Key Browser'
                        : `${badge.label} Data Access`}
                    </h3>
                    <span className="text-[10px] px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-600 rounded font-mono font-semibold">
                      same-origin /api/v1/
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {database.type === 'sqlite'
                      ? 'Reads the file directly in-process via daemon driver — no open network ports or credentials needed.'
                      : database.type === 'redis'
                      ? 'Scoped to prefix ~' + database.name + ':* — zero tenant cross-contamination.'
                      : 'Daemon engine — accessed safely behind the panel session proxy.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadTables}
                  disabled={loadingTables}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Reload tables"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingTables ? 'animate-spin text-blue-600' : ''}`} />
                  <span>{loadingTables ? 'Loading...' : 'Refresh'}</span>
                </button>
              </div>

              {/* Error banner if loading tables failed */}
              {tablesError && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Notice: {tablesError}</p>
                    {database.type !== 'sqlite' && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        Use the Web GUI launcher in Overview or connect your favorite DB client using the credentials shown in Connection & Credentials.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* SQLite: a friendly grid — click a table and its rows appear; SQL is optional. */}
              {database.type === 'sqlite' && (
                <div className="space-y-4">
                  {/* Table selector pills */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                        Tables ({tableList.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSqlEditor((shown) => !shown)}
                        className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                      >
                        {showSqlEditor ? 'Hide SQL' : 'Show SQL'}
                      </button>
                    </div>

                    {tableList.length === 0 ? (
                      <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-500">
                        No user tables found yet. Run a <code className="font-mono text-slate-700">CREATE TABLE</code> statement below, or browse the Web GUI manager.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {tableList.map((tbl) => (
                          <button
                            key={tbl}
                            type="button"
                            onClick={() => {
                              setSelectedTable(tbl);
                              const q = `SELECT * FROM ${quoteIdent(database.type, tbl)} LIMIT 50;`;
                              setSqlQuery(q);
                              runQuery(q);
                            }}
                            className={`px-3 py-1 text-xs font-mono rounded-lg border transition-all cursor-pointer flex items-center gap-1.5 ${
                              selectedTable === tbl
                                ? 'bg-blue-50 border-blue-300 text-blue-700 font-bold shadow-2xs'
                                : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <Table className="w-3 h-3 text-slate-400" />
                            <span>{tbl}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* SQL is optional: the tables above already open as a plain grid. */}
                  {showSqlEditor && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-blue-600" />
                        <span>SQL (optional)</span>
                      </label>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSqlQuery(createTableTemplate)}
                          className="px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
                          title="Insert a CREATE TABLE template"
                        >
                          CREATE TABLE
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedTable) {
                              const q = `SELECT * FROM ${quoteIdent(database.type, selectedTable)} LIMIT 50;`;
                              setSqlQuery(q);
                              runQuery(q);
                            }
                          }}
                          className="px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
                        >
                          SELECT 50
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedTable) {
                              const q = `SELECT COUNT(*) AS total FROM ${quoteIdent(database.type, selectedTable)};`;
                              setSqlQuery(q);
                              runQuery(q);
                            }
                          }}
                          className="px-2 py-0.5 text-[10px] font-mono text-slate-600 hover:bg-slate-100 rounded border border-slate-200 cursor-pointer"
                        >
                          COUNT(*)
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <textarea
                        value={sqlQuery}
                        onChange={(e) => setSqlQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            runQuery();
                          }
                        }}
                        placeholder="SELECT * FROM table LIMIT 50;"
                        rows={3}
                        className="w-full font-mono text-xs p-3 bg-slate-900 text-slate-100 rounded-xl border border-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 selection:bg-blue-600"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400">
                        Audit: database.query is logged. Results capped at 500 rows.
                      </span>
                      <button
                        type="button"
                        onClick={() => runQuery()}
                        disabled={queryRunning || !sqlQuery.trim()}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Play className={`w-3.5 h-3.5 ${queryRunning ? 'animate-spin' : ''}`} />
                        <span>{queryRunning ? 'Executing...' : 'Run Query'}</span>
                      </button>
                    </div>
                  </div>
                  )}

                  {/* Query Error */}
                  {queryError && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <pre className="font-mono text-[11px] whitespace-pre-wrap">{queryError}</pre>
                    </div>
                  )}

                  {/* Query Results Grid */}
                  {queryResult && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-700">
                            {queryResult.affected > 0
                              ? `${queryResult.affected} row(s) affected`
                              : `${queryResult.rows.length} row(s) returned`}
                          </span>
                          {queryResult.truncated && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded">
                              Truncated (500 max)
                            </span>
                          )}
                        </div>
                        {queryResult.columns.length > 0 && (
                          <span className="text-[11px] font-mono text-slate-400">
                            {queryResult.columns.length} columns
                          </span>
                        )}
                      </div>

                      {queryResult.columns.length > 0 ? (
                        <div className="border border-slate-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto overflow-x-auto shadow-2xs bg-white">
                          <table className="w-full text-xs text-left border-collapse">
                            <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200 sticky top-0">
                              <tr>
                                {queryResult.columns.map((col, idx) => (
                                  <th key={idx} className="px-3 py-2 font-mono border-r border-slate-200 last:border-r-0 whitespace-nowrap">
                                    {col}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                              {queryResult.rows.length === 0 ? (
                                <tr>
                                  <td colSpan={queryResult.columns.length} className="px-3 py-6 text-center text-slate-400 italic">
                                    Query returned zero rows.
                                  </td>
                                </tr>
                              ) : (
                                queryResult.rows.map((row, rIdx) => (
                                  <tr key={rIdx} className="hover:bg-slate-50/70">
                                    {row.map((val, cIdx) => (
                                      <td key={cIdx} className="px-3 py-1.5 border-r border-slate-100 last:border-r-0 whitespace-nowrap text-slate-800">
                                        {val === null ? (
                                          <span className="text-slate-400 italic text-[10px]">NULL</span>
                                        ) : (
                                          val
                                        )}
                                      </td>
                                    ))}
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                          Statement executed successfully. ({queryResult.affected} rows affected)
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Redis: Key viewer */}
              {database.type === 'redis' && (
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-700 block">
                        Redis Key Store ({redisKeys ? redisKeys.count : '...'} keys)
                      </span>
                      <span className="text-[11px] text-slate-500 font-mono">
                        Prefix: ~{database.name}:*
                      </span>
                    </div>
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-700 text-[10px] font-bold rounded">
                      ACL Tenant User
                    </span>
                  </div>

                  {redisKeys && redisKeys.keys.length > 0 ? (
                    <div className="border border-slate-200 rounded-xl p-3 bg-white space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">
                        Sample Keys:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {redisKeys.keys.map((k, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => void openKey(k)}
                            disabled={keyLoading === k}
                            title="Read this key's type and TTL"
                            className="px-2.5 py-1 bg-slate-100 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-slate-800 font-mono text-xs rounded-md transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {keyLoading === k ? '…' : k}
                          </button>
                        ))}
                      </div>
                      {keyDetail && (
                        <div className="p-2.5 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] break-all">
                          <span className="text-slate-400">{keyDetail.key}</span>
                          {keyDetail.type ? <span className="text-amber-300"> · {keyDetail.type}</span> : null}
                          {typeof keyDetail.ttl === 'number' ? (
                            <span className="text-slate-400"> · TTL {keyDetail.ttl}s</span>
                          ) : null}
                          <div className="mt-1 whitespace-pre-wrap text-slate-200">
                            {keyDetail.value ?? keyDetail.note ?? ''}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center text-xs text-slate-500">
                      No keys found in this cache prefix yet. Once your application writes data using REDIS_URL, keys will appear here.
                    </div>
                  )}
                </div>
              )}

              {/* MongoDB: no hosted manager and no in-panel driver yet */}
              {database.type === 'mongodb' && (
                <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-2xl text-center space-y-3">
                  <Database className="w-8 h-8 text-slate-400 mx-auto" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">
                      {badge.label} Visual Management
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                      For security and strict privilege scoping, server engines run through the Web GUI manager or direct connection strings without arbitrary root queries.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setDataTabActive('overview')}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-2xs cursor-pointer"
                    >
                      View Credentials & Launch GUI
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Protected by BarePod Internal Proxy & Linux Security Vault</span>
          </div>
          <div className="flex items-center gap-2">
            {onDelete && !database.detected && (
              <button
                onClick={() => onDelete(database)}
                className="px-3 py-1.5 text-xs font-semibold text-rose-600 hover:text-white hover:bg-rose-600 border border-rose-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Drop database permanently"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Drop Database</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
