import React, { useState, useEffect } from 'react';
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
  Check,
  RefreshCw,
  Lock,
  ArrowLeft,
  ArrowRight,
  Maximize2,
  Copy,
  Folder,
  Terminal,
  FileCode,
  Search,
  HardDrive,
  Key,
  Leaf
} from 'lucide-react';
import type { DatabaseItem } from '../types';
import { guiToolIcon } from '../utils/brandIcons';

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
  initialTool = 'phpmyadmin',
}) => {
  const [currentTool, setCurrentTool] = useState<DatabaseManagerTool>(initialTool);
  const [activeTab, setActiveTab] = useState<'structure' | 'sql' | 'browse' | 'export'>('structure');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [queryInput, setQueryInput] = useState('SELECT * FROM wp_posts LIMIT 10;');
  const [queryExecuted, setQueryExecuted] = useState(false);
  const [selectedTable, setSelectedTable] = useState<string>('wp_posts');
  const ToolIcon = guiToolIcon[currentTool] ?? Database;

  useEffect(() => {
    if (initialTool) {
      setCurrentTool(initialTool);
    }
  }, [initialTool]);

  useEffect(() => {
    if (database) {
      if (database.type === 'mysql' || database.type === 'mariadb') {
        setSelectedTable('wp_posts');
        setQueryInput(`SELECT * FROM wp_posts LIMIT 10;`);
      } else if (database.type === 'postgres') {
        setSelectedTable('users');
        setQueryInput(`SELECT * FROM users ORDER BY id DESC LIMIT 10;`);
      } else if (database.type === 'mongodb') {
        setSelectedTable('users');
        setQueryInput(`db.users.find().limit(10);`);
      } else if (database.type === 'redis') {
        setSelectedTable('sess:94812_user');
        setQueryInput(`GET sess:94812_user`);
      }
    }
  }, [database, currentTool]);

  if (!isOpen || !database) return null;

  // Generate Simulated In-Panel Host URL
  const getSimulatedUrl = () => {
    const ssoToken = `bp_sso_${database.id}_${Math.random().toString(36).substring(2, 8)}`;
    switch (currentTool) {
      case 'phpmyadmin':
        return `https://panel.barepod.cloud:8443/phpmyadmin/index.php?route=/database/structure&server=1&db=${database.name}&sso_token=${ssoToken}`;
      case 'pgadmin':
        return `https://panel.barepod.cloud:8443/pgadmin4/browser/?server=1&db=${database.name}&sso_token=${ssoToken}`;
      case 'dbgate':
        return `https://panel.barepod.cloud:8443/dbgate/?conn=internal_sock&db=${database.name}&sso_token=${ssoToken}`;
      case 'mongoexpress':
        return `https://panel.barepod.cloud:8443/mongo-express/db/${database.name}?sso_token=${ssoToken}`;
      case 'rediscommander':
        return `https://panel.barepod.cloud:8443/redis-commander/?db=0&sso_token=${ssoToken}`;
    }
  };

  const simulatedUrl = getSimulatedUrl();

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  const handleCopyUrl = () => {
    navigator.clipboard?.writeText(simulatedUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 1800);
  };

  const handleRunQuery = () => {
    setQueryExecuted(true);
    setTimeout(() => setQueryExecuted(false), 3000);
  };

  // Mock Tables for Realistic UI
  const getTablesForCurrentDb = () => {
    if (database.type === 'mysql' || database.type === 'mariadb') {
      return [
        { name: 'wp_posts', rows: 342, size: '240 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
        { name: 'wp_users', rows: 4, size: '16 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
        { name: 'wp_options', rows: 284, size: '180 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
        { name: 'wp_comments', rows: 18, size: '32 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
        { name: 'wp_postmeta', rows: 1240, size: '480 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
        { name: 'wp_terms', rows: 22, size: '16 KB', engine: 'InnoDB', collation: 'utf8mb4_unicode_ci' },
      ];
    }
    if (database.type === 'postgres') {
      return [
        { name: 'users', rows: 120, size: '48 KB', engine: 'Heap', collation: 'en_US.utf8' },
        { name: 'orders', rows: 840, size: '320 KB', engine: 'Heap', collation: 'en_US.utf8' },
        { name: 'order_items', rows: 2100, size: '540 KB', engine: 'Heap', collation: 'en_US.utf8' },
        { name: 'products', rows: 95, size: '64 KB', engine: 'Heap', collation: 'en_US.utf8' },
        { name: 'categories', rows: 12, size: '16 KB', engine: 'Heap', collation: 'en_US.utf8' },
        { name: 'schema_migrations', rows: 24, size: '8 KB', engine: 'Heap', collation: 'en_US.utf8' },
      ];
    }
    if (database.type === 'mongodb') {
      return [
        { name: 'users', rows: 850, size: '210 KB', engine: 'WiredTiger', collation: 'BSON' },
        { name: 'sessions', rows: 42, size: '36 KB', engine: 'WiredTiger', collation: 'BSON' },
        { name: 'audit_logs', rows: 14200, size: '2.4 MB', engine: 'WiredTiger', collation: 'BSON' },
        { name: 'user_tokens', rows: 110, size: '28 KB', engine: 'WiredTiger', collation: 'BSON' },
      ];
    }
    // Redis Key Browser
    return [
      { name: 'sess:94812_user', rows: 1, size: '820 B', engine: 'Key (String)', collation: 'TTL: 3500s' },
      { name: 'sess:94813_guest', rows: 1, size: '410 B', engine: 'Key (String)', collation: 'TTL: 1200s' },
      { name: 'cache:product_list', rows: 1, size: '14 KB', engine: 'Key (String)', collation: 'TTL: 86400s' },
      { name: 'rate_limit:ip_102', rows: 1, size: '32 B', engine: 'Key (Integer)', collation: 'TTL: 42s' },
      { name: 'token:auth_jwt_99', rows: 1, size: '256 B', engine: 'Key (String)', collation: 'TTL: 1800s' },
    ];
  };

  const tables = getTablesForCurrentDb();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl max-w-6xl w-full h-[94vh] flex flex-col overflow-hidden">
        
        {/* Simulated Browser Chrome Top Header */}
        <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0 select-none">
          {/* Window Control Buttons */}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 transition-colors cursor-pointer" title="Close" />
            <button className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 transition-colors" title="Minimize" />
            <button className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 transition-colors" title="Maximize" />
            
            {/* Active Browser Tab Pill */}
            <div className="ml-3 flex items-center gap-2 px-3 py-1 bg-slate-900 border border-slate-700/80 rounded-t-lg text-xs text-slate-200 font-medium">
              <span>{<ToolIcon className="w-4 h-4" />}</span>
              <span className="capitalize">{currentTool}</span>
              <span className="text-slate-500">—</span>
              <span className="text-blue-400 font-mono font-semibold truncate max-w-[120px]">{database.name}</span>
            </div>
          </div>

          {/* Quick Manager Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-900 px-2 py-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-[10px] text-slate-400 font-semibold uppercase">Engine GUI:</span>
            {(database.type === 'mysql' || database.type === 'mariadb') && (
              <button
                onClick={() => setCurrentTool('phpmyadmin')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  currentTool === 'phpmyadmin' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                phpMyAdmin
              </button>
            )}
            {database.type === 'postgres' && (
              <button
                onClick={() => setCurrentTool('pgadmin')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  currentTool === 'pgadmin' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                pgAdmin
              </button>
            )}
            {database.type === 'redis' && (
              <button
                onClick={() => setCurrentTool('rediscommander')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  currentTool === 'rediscommander' ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Redis Commander
              </button>
            )}
            {database.type === 'mongodb' && (
              <button
                onClick={() => setCurrentTool('mongoexpress')}
                className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                  currentTool === 'mongoexpress' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Mongo Express
              </button>
            )}
            <button
              onClick={() => setCurrentTool('dbgate')}
              className={`px-2 py-0.5 rounded text-[11px] font-bold transition-colors ${
                currentTool === 'dbgate' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              DbGate
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Realistic Browser Address Bar & Navigation Controls */}
        <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 text-slate-400">
            <button className="p-1 rounded hover:bg-slate-800 hover:text-white transition-colors" title="Back">
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button className="p-1 rounded hover:bg-slate-800 hover:text-white transition-colors" title="Forward">
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={handleRefresh}
              className={`p-1 rounded hover:bg-slate-800 hover:text-white transition-colors ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} 
              title="Reload Page"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Full URL Address Input with SSL Lock */}
          <div className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs font-mono text-slate-300">
            <Lock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="truncate select-all">{simulatedUrl}</span>
            <button
              onClick={handleCopyUrl}
              className="ml-auto text-[11px] text-slate-400 hover:text-white shrink-0 flex items-center gap-1"
              title="Copy URL"
            >
              {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedUrl ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {/* Open in New Tab Button */}
          <button
            onClick={() => {
              window.open(simulatedUrl, '_blank');
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs shrink-0 cursor-pointer"
            title="Open directly in a new browser tab"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Open in New Tab</span>
          </button>
        </div>

        {/* In-Browser Web Viewport (Realistic High-Fidelity UI of phpMyAdmin / pgAdmin / DbGate) */}
        <div className="flex-1 flex flex-col min-h-0 bg-white text-slate-800 overflow-hidden">
          
          {/* Authentic phpMyAdmin Header Style */}
          {currentTool === 'phpmyadmin' && (
            <div className="bg-[#f0f0f0] border-b border-[#d8d8d8] text-xs">
              {/* Top Navigation */}
              <div className="px-4 py-2 border-b border-[#e2e2e2] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1.5 font-bold text-slate-900">
                    <span className="text-xl"><ToolIcon className="w-6 h-6" /></span>
                    <span className="text-sm font-sans tracking-tight">phpMyAdmin <span className="text-xs text-slate-500 font-normal">5.2.1</span></span>
                  </div>
                  <div className="h-4 w-px bg-slate-300" />
                  <div className="flex items-center gap-1.5 text-slate-600 font-mono text-[11px]">
                    <Server className="w-3 h-3 text-slate-400" />
                    <span>Server: 127.0.0.1:3306</span>
                    <span>&gt;&gt;</span>
                    <Database className="w-3 h-3 text-amber-600" />
                    <span className="font-bold text-slate-900">{database.name}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" /> SSO Autologin Active
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">User: {database.username}@127.0.0.1</span>
                </div>
              </div>

              {/* phpMyAdmin Tabs Bar */}
              <div className="px-4 flex items-center gap-1 pt-1 font-sans text-xs font-semibold overflow-x-auto">
                {[
                  { id: 'structure', label: 'Structure' },
                  { id: 'sql', label: 'SQL' },
                  { id: 'browse', label: 'Browse' },
                  { id: 'search', label: 'Search' },
                  { id: 'export', label: 'Export' },
                  { id: 'import', label: 'Import' },
                  { id: 'operations', label: 'Operations' },
                  { id: 'privileges', label: 'Privileges' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    className={`px-3 py-1.5 rounded-t-md transition-colors border-t border-x ${
                      activeTab === t.id
                        ? 'bg-white border-[#d8d8d8] text-blue-700 font-bold -mb-px'
                        : 'bg-transparent border-transparent text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Authentic pgAdmin Header Style */}
          {currentTool === 'pgadmin' && (
            <div className="bg-[#24436c] text-white border-b border-[#1b3454] px-4 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-xl"><ToolIcon className="w-6 h-6" /></span>
                <div>
                  <span className="font-bold text-sm tracking-tight">pgAdmin 4 Web</span>
                  <span className="text-[10px] text-blue-200 block font-mono">PostgreSQL 16 Engine • Database: {database.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> SSO Autologin Active
                </span>
                <span className="text-[11px] text-blue-100 font-mono">User: {database.username}</span>
              </div>
            </div>
          )}

          {/* Authentic Redis Commander Header Style */}
          {currentTool === 'rediscommander' && (
            <div className="bg-[#a81c1c] text-white border-b border-[#871616] px-4 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-xl"><ToolIcon className="w-6 h-6" /></span>
                <div>
                  <span className="font-bold text-sm tracking-tight">Redis Commander Web</span>
                  <span className="text-[10px] text-rose-200 block font-mono">127.0.0.1:6379 • Database: db 0 (Key-Value)</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-white/20 text-white text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-300" /> SSO Active (db0)
                </span>
              </div>
            </div>
          )}

          {/* Authentic DbGate Header Style */}
          {currentTool === 'dbgate' && (
            <div className="bg-[#382bf0] text-white border-b border-[#2d22c7] px-4 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-xl"><ToolIcon className="w-6 h-6" /></span>
                <div>
                  <span className="font-bold text-sm tracking-tight">DbGate Universal Studio</span>
                  <span className="text-[10px] text-indigo-200 block font-mono">Connected to {database.name} via SSO Proxy</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> SSO Connected
                </span>
              </div>
            </div>
          )}

          {/* Authentic Mongo Express Header Style */}
          {currentTool === 'mongoexpress' && (
            <div className="bg-[#116149] text-white border-b border-[#0d4a38] px-4 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <span className="text-xl"><ToolIcon className="w-6 h-6" /></span>
                <div>
                  <span className="font-bold text-sm tracking-tight">Mongo Express Web</span>
                  <span className="text-[10px] text-emerald-200 block font-mono">MongoDB 7 • Database: {database.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-white/20 text-white text-[10px] font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-300" /> SSO Active
                </span>
              </div>
            </div>
          )}

          {/* Main Workspace Area (Left Tree Sidebar + Right Content View) */}
          <div className="flex-1 flex min-h-0 bg-[#f9fafb]">
            
            {/* Left Tree Explorer */}
            <div className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0">
              <div className="p-3 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <span>{database.type === 'redis' ? 'Keys Explorer (db 0)' : database.type === 'mongodb' ? 'Collections' : 'Database Tables'}</span>
                <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-mono">{tables.length}</span>
              </div>
              <div className="p-2 space-y-1 overflow-y-auto flex-1 font-mono text-xs">
                {tables.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => {
                      setSelectedTable(t.name);
                      if (database.type === 'redis') {
                        setQueryInput(`GET ${t.name}`);
                      } else if (database.type === 'mongodb') {
                        setQueryInput(`db.${t.name}.find().limit(10);`);
                      } else {
                        setQueryInput(`SELECT * FROM ${t.name} LIMIT 10;`);
                      }
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between transition-colors ${
                      selectedTable === t.name
                        ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {database.type === 'redis' ? (
                        <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <Table className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="truncate">{t.name}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-sans">{t.rows}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Right Main Table & SQL Workspace */}
            <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
              {/* SSO Auto-Login Notice Banner */}
              <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between text-xs text-emerald-900">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <p className="leading-snug">
                    <strong>SSO auto-login successful:</strong> session authenticated to database <strong>{database.name}</strong> as user <strong>{database.username}</strong> through the BarePod internal reverse proxy.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-emerald-700 bg-white px-2 py-0.5 rounded border border-emerald-200 shrink-0">
                  Proxy Token Verified
                </span>
              </div>

              {/* SQL Query Console Box */}
              <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <Terminal className="w-4 h-4 text-slate-500" />
                    <span>Run Query / Command on {database.name}</span>
                  </div>
                  <button
                    onClick={handleRunQuery}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs font-bold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Execute (Ctrl+Enter)</span>
                  </button>
                </div>
                <div className="bg-slate-900 rounded-lg p-2.5 font-mono text-xs">
                  <textarea
                    rows={2}
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    className="w-full bg-transparent text-emerald-400 focus:outline-hidden resize-none font-mono text-xs"
                  />
                </div>
                {queryExecuted && (
                  <div className="text-[11px] text-emerald-700 font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Query executed in 2.8ms — Returned rows for {selectedTable}.</span>
                  </div>
                )}
              </div>

              {/* Data Table View */}
              <div className="flex-1 p-5 overflow-auto">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Structure & Data Preview: <span className="font-mono text-blue-600">{selectedTable}</span>
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Showing records for {database.type.toUpperCase()} database instance
                    </p>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">Format: {database.charset}</span>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-600 uppercase text-[10px] font-bold">
                      <tr>
                        <th className="py-2.5 px-3">#</th>
                        <th className="py-2.5 px-3">Field / Column Name</th>
                        <th className="py-2.5 px-3">Data Type / Value Preview</th>
                        <th className="py-2.5 px-3">Collation / Engine</th>
                        <th className="py-2.5 px-3 text-right">Attributes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {database.type === 'redis' ? (
                        <>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">1</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">key_name</td>
                            <td className="py-2.5 px-3 text-blue-600 font-bold">{selectedTable}</td>
                            <td className="py-2.5 px-3 text-slate-500">String Key</td>
                            <td className="py-2.5 px-3 text-right text-emerald-600">Active (TTL 3600s)</td>
                          </tr>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">2</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">payload_data</td>
                            <td className="py-2.5 px-3 text-slate-700">&#123; "user_id": 104, "role": "admin", "token": "jwt_..." &#125;</td>
                            <td className="py-2.5 px-3 text-slate-500">JSON Payload</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">Binary Safe</td>
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">1</td>
                            <td className="py-2.5 px-3 font-bold text-blue-600">id</td>
                            <td className="py-2.5 px-3 text-slate-700">bigint(20) unsigned</td>
                            <td className="py-2.5 px-3 text-slate-500">PRIMARY KEY</td>
                            <td className="py-2.5 px-3 text-right text-emerald-600 font-bold">AUTO_INCREMENT</td>
                          </tr>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">2</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">{database.type === 'mysql' ? 'post_title' : 'title / name'}</td>
                            <td className="py-2.5 px-3 text-slate-700">varchar(255)</td>
                            <td className="py-2.5 px-3 text-slate-500">{database.charset}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">NOT NULL</td>
                          </tr>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">3</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">{database.type === 'mysql' ? 'post_content' : 'description / body'}</td>
                            <td className="py-2.5 px-3 text-slate-700">longtext</td>
                            <td className="py-2.5 px-3 text-slate-500">{database.charset}</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">NULLABLE</td>
                          </tr>
                          <tr className="hover:bg-slate-50">
                            <td className="py-2.5 px-3 text-slate-400">4</td>
                            <td className="py-2.5 px-3 font-bold text-slate-800">created_at</td>
                            <td className="py-2.5 px-3 text-slate-700">timestamp</td>
                            <td className="py-2.5 px-3 text-slate-500">CURRENT_TIMESTAMP</td>
                            <td className="py-2.5 px-3 text-right text-slate-500">DEFAULT NOW()</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 shrink-0">
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>BarePod SSO Security Protocol: port 127.0.0.1 is blocked from outside access. Only reachable through the internal panel.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
          >
            Close Simulator
          </button>
        </div>
      </div>
    </div>
  );
};
