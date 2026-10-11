import React, { useState } from 'react';
import { X, Database, Key, ShieldCheck, Sparkles, Check, Server, Lock, Cpu, Folder } from 'lucide-react';
import type { DatabaseEngine, DatabaseItem } from '../types';
import { dbIcon } from '../utils/brandIcons';
import { AVAILABLE_ENGINE_VERSIONS as availableVersions } from '../data/databaseEngines';
import type { CreateDatabasePayload, DbEngineRow } from '../api/client';

interface CreateDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (db: DatabaseItem) => void;
  /** Engines as this host really has them (see GET /db-engines). */
  engines?: DbEngineRow[];
  /**
   * Live create: the daemon provisions the database and answers with what
   * happened (a generated password, or a note explaining what is missing).
   */
  onCreateLive?: (payload: CreateDatabasePayload) => Promise<{
    password?: string;
    status?: string;
    note?: string;
  }>;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  /** The websites that may own this database (SQLite must live inside one). */
  websites?: { slug: string; name: string }[];
}

export const CreateDatabaseModal: React.FC<CreateDatabaseModalProps> = ({
  isOpen,
  onClose,
  onCreate,
  engines,
  onCreateLive,
  onShowToast,
  websites,
}) => {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<DatabaseEngine>('postgres');
  const [selectedVersionIndex, setSelectedVersionIndex] = useState<number>(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('bp_sec_' + Math.random().toString(36).substring(2, 9));
  const [maxConnections, setMaxConnections] = useState<number>(25);
  const [websiteSlug, setWebsiteSlug] = useState('');

  if (!isOpen) return null;

  const API_ENGINE: Record<string, string> = {
    postgres: 'postgresql',
    mysql: 'mysql',
    mongodb: 'mongodb',
    redis: 'redis',
    sqlite: 'sqlite',
  };
  const engineRow = engines?.find(
    (row) => row.engine === (API_ENGINE[type] ?? type) && row.kind === (type === 'redis' ? 'cache' : 'database'),
  );
  const engineBlocked = engineRow ? !engineRow.available : false;
  const currentVersionList = engineRow
    ? engineRow.versions.map((version) => ({
        version,
        port: engineRow.port ?? 0,
        label: `${engineRow.label} ${version}`,
        statusText: engineRow.running ? 'running on this host' : 'installed, not running',
      }))
    : availableVersions[type] || availableVersions.postgres;
  const activeVersion = currentVersionList[selectedVersionIndex] || currentVersionList[0];

  const handleEngineChange = (engine: DatabaseEngine) => {
    setType(engine);
    setSelectedVersionIndex(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const chosen = currentVersionList[selectedVersionIndex] || currentVersionList[0];

    const newDb: DatabaseItem = {
      id: `db-${Date.now()}`,
      name: name.toLowerCase().replace(/\s+/g, '_'),
      type,
      version: chosen.version,
      port: type === 'sqlite' ? 0 : chosen.port,
      host: type === 'sqlite' ? undefined : '127.0.0.1',
      username: type === 'sqlite' ? '(file-based)' : username.trim() || `${name.toLowerCase()}_user`,
      size: '0 B',
      charset: type === 'mongodb' ? 'BSON' : type === 'sqlite' ? 'SQLite 3' : type === 'redis' ? 'In-Memory' : 'UTF8',
      status: 'active',
      connections: type === 'sqlite' ? 0 : 1,
      maxConnections: type === 'sqlite' ? undefined : maxConnections,
      isolationMode: type === 'sqlite' ? undefined : 'shared_daemon',
    };

    if (type === 'sqlite' && !websiteSlug) {
      onShowToast?.('Choose a website', 'A SQLite database is a file inside a website, so it needs one.', 'error');
      return;
    }
    if (onCreateLive) {
      setBusy(true);
      try {
        const result = await onCreateLive({
          engine: API_ENGINE[type] ?? type,
          version: chosen.version,
          alias: name.trim(),
          websiteSlug: websiteSlug || undefined,
          maxConnections: type === 'sqlite' ? undefined : maxConnections,
        });
        onCreate(newDb);
        onClose();
        setName('');
        setUsername('');
        setSelectedVersionIndex(0);
        if (result.status && result.status !== 'ready') {
          onShowToast?.('Recorded, not created', result.note ?? 'The engine is not available on this host.', 'info');
        } else if (result.password) {
          onShowToast?.('Database created', `Password (shown once): ${result.password}`, 'success');
        }
      } catch (err) {
        onShowToast?.('Could not create it', err instanceof Error ? err.message : 'The daemon refused.', 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    onCreate(newDb);
    onClose();
    setName('');
    setUsername('');
    setSelectedVersionIndex(0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Provision Database</h2>
              <p className="text-xs text-slate-500">Shared Multi-Version Engine • Isolated Per-User</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {/* Engine Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Select Database Engine Family
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'postgres' as DatabaseEngine, label: 'PostgreSQL' },
                { id: 'mysql' as DatabaseEngine, label: 'MySQL / MariaDB' },
                { id: 'mongodb' as DatabaseEngine, label: 'MongoDB' },
                { id: 'redis' as DatabaseEngine, label: 'Redis Cache' },
                { id: 'sqlite' as DatabaseEngine, label: 'SQLite (file)' },
              ].map((engine) => {
                const DbIcon = dbIcon[engine.id] ?? Database;
                const row = engines?.find((entry) => entry.engine === (API_ENGINE[engine.id] ?? engine.id));
                const blocked = row ? !row.available : false;
                const reason = blocked
                  ? row?.note || `${row?.client ?? 'The engine'} is not installed on this host`
                  : undefined;
                return (
                  <button
                    type="button"
                    key={engine.id}
                    disabled={blocked}
                    title={reason}
                    onClick={() => handleEngineChange(engine.id)}
                    className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs text-left transition-all ${
                      blocked
                        ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
                        : type === engine.id
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-bold ring-2 ring-blue-500/10'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <DbIcon className="w-4 h-4 shrink-0" />
                    <span>{engine.label}</span>
                    {blocked && <span className="ml-auto text-[10px] font-semibold">not installed</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Website (required for a file-based database) */}
          {websites && websites.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Website{type === 'sqlite' ? ' (required: the file lives inside it)' : ' (optional owner)'}
              </label>
              <select
                value={websiteSlug}
                onChange={(event) => setWebsiteSlug(event.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono text-slate-800"
              >
                <option value="">{type === 'sqlite' ? 'Choose a website…' : 'No website'}</option>
                {websites.map((site) => (
                  <option key={site.slug} value={site.slug}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Version Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {type === 'sqlite' ? 'SQLite Library Version' : 'Shared Engine Version & Dedicated Port'}
            </label>
            <select
              value={selectedVersionIndex}
              onChange={(e) => setSelectedVersionIndex(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono text-slate-800"
            >
              {currentVersionList.map((ver, idx) => (
                <option key={ver.version} value={idx}>
                  {ver.label} — [{ver.statusText}]
                </option>
              ))}
            </select>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-mono">
              {type === 'sqlite' ? (
                <>
                  <Folder className="w-3 h-3 text-slate-400" />
                  <span>File: /home/&lt;tenant&gt;/apps/&lt;website&gt;/{name || 'database'}.sqlite (no daemon)</span>
                </>
              ) : (
                <>
                  <Server className="w-3 h-3 text-slate-400" />
                  <span>Bind: 127.0.0.1:{activeVersion.port} (internal host / docker jail only)</span>
                </>
              )}
            </p>
          </div>

          {/* Database / Instance Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {type === 'redis' ? 'Redis Instance Key Namespace' : 'Database Name'}
            </label>
            <input
              type="text"
              required
              placeholder={type === 'redis' ? 'e.g. app_session_cache' : 'e.g. ecommerce_db'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
            {type === 'redis' ? (
              <p className="text-[10px] text-amber-700 mt-1 bg-amber-50 p-1.5 rounded border border-amber-200/80">
                <strong>Redis ACL Isolation:</strong> Keys are isolated under the prefix pattern <code>{name || 'app'}:*</code> and dangerous commands (FLUSHALL, CONFIG) are blocked.
              </p>
            ) : (
              <p className="text-[10px] text-slate-400 mt-1">
                Lowercase letters, numbers, and underscores (_) only. Fully separated from other apps.
              </p>
            )}
          </div>

          {/* Grid: Username & Max Connections Quota (daemon engines only) */}
          {type !== 'sqlite' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {type === 'redis' ? 'ACL User' : 'Isolated Database User'}
              </label>
              <input
                type="text"
                placeholder={type === 'redis' ? 'default' : 'Auto: name_user'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Max Connections Quota
              </label>
              <select
                value={maxConnections}
                onChange={(e) => setMaxConnections(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
              >
                <option value={15}>15 connections (Micro App)</option>
                <option value={25}>25 connections (Recommended)</option>
                <option value={50}>50 connections (High Traffic)</option>
                <option value={100}>100 connections (Heavy)</option>
              </select>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Prevents connection leaks from exhausting the daemon pool
              </span>
            </div>
          </div>
          )}

          {/* Generated Password (daemon engines only) */}
          {type !== 'sqlite' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">Auto-Generated Isolated Password</label>
              <button
                type="button"
                onClick={() => setPassword('bp_sec_' + Math.random().toString(36).substring(2, 10))}
                className="text-[10px] text-blue-600 hover:underline"
              >
                Regenerate
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={password}
                className="w-full px-3 py-2 text-xs bg-slate-100 border border-slate-200 rounded-lg font-mono text-slate-700"
              />
            </div>
          </div>
          )}

          {type === 'sqlite' && (
            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-600 flex items-start gap-2">
              <Folder className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <span>
                SQLite is a file-based embedded database: no daemon, port, user or password. Access is enforced by file ownership
                and permissions (<code className="font-mono">0600</code>, tenant user) — ideal for small sites and local development.
              </span>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-500/20"
            >
              Provision Database
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

