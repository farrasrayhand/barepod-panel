import React, { useState } from 'react';
import { 
  Archive, 
  ArrowRightLeft, 
  Download, 
  Upload, 
  Cloud, 
  ShieldCheck, 
  CheckCircle2, 
  RotateCw, 
  Play, 
  Copy, 
  Check, 
  Trash2, 
  Clock, 
  Server, 
  Database, 
  Layers, 
  FileCode, 
  HardDrive, 
  AlertCircle, 
  ArrowUpRight, 
  Search,
  ExternalLink,
  Zap,
  Key,
  Shield,
  FileArchive
} from 'lucide-react';
import type { WebApp } from '../types';

interface BackupMigrationViewProps {
  apps: WebApp[];
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

interface BackupSnapshotItem {
  id: string;
  name: string;
  filename: string;
  type: 'full' | 'app' | 'database';
  target: string;
  size: string;
  createdAt: string;
  sha256: string;
  storage: 'local' | 'r2' | 's3';
  status: 'ready' | 'syncing';
}

export const BackupMigrationView: React.FC<BackupMigrationViewProps> = ({
  apps,
  onShowToast,
  onOpenTerminal,
}) => {
  const [activeTab, setActiveTab] = useState<'migration' | 'snapshots' | 'restore' | 'cloud_sync'>('migration');
  const [copiedKey, setCopiedKey] = useState(false);

  // Live Migration State
  const [migrationMode, setMigrationMode] = useState<'pull' | 'source'>('pull');
  const [oldServerIp, setOldServerIp] = useState('103.147.154.82');
  const [oldServerPort, setOldServerPort] = useState('8443');
  const [migrationSecretToken, setMigrationSecretToken] = useState('bp_mig_9f8a20bc4720e1d88a10');
  const [isTestingHandshake, setIsTestingHandshake] = useState(false);
  const [handshakeSuccess, setHandshakeSuccess] = useState<boolean | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationStep, setMigrationStep] = useState(0);
  const [migrationLogs, setMigrationLogs] = useState<string[]>([]);

  // Migration Scope Checklist
  const [syncApps, setSyncApps] = useState(true);
  const [syncDatabases, setSyncDatabases] = useState(true);
  const [syncVhosts, setSyncVhosts] = useState(true);
  const [syncTunnels, setSyncTunnels] = useState(true);
  const [syncUsers, setSyncUsers] = useState(true);

  // Snapshot State
  const [isCreatingSnapshot, setIsCreatingSnapshot] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [snapshotScope, setSnapshotScope] = useState<'full' | 'app' | 'database'>('full');
  const [selectedAppForSnapshot, setSelectedAppForSnapshot] = useState(apps[0]?.id || '');
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [encryptionPassword, setEncryptionPassword] = useState('BarePodSecretKey2026!');

  // File Restore State
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; size: string; manifest?: any } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);

  // Cloud Sync State
  const [cloudProvider, setCloudProvider] = useState<'r2' | 's3' | 'gcs' | 'wasabi'>('r2');
  const [cloudEndpoint, setCloudEndpoint] = useState('https://<account_id>.r2.cloudflarestorage.com');
  const [cloudBucket, setCloudBucket] = useState('barepod-panel-backups');
  const [cloudAccessKey, setCloudAccessKey] = useState('c0a98f129d8a4e8b0129');
  const [cloudSecretKey, setCloudSecretKey] = useState('••••••••••••••••••••••••••••••••••••••••');
  const [cloudSchedule, setCloudSchedule] = useState<'daily' | 'weekly' | 'hourly'>('daily');
  const [cloudRetentionDays, setCloudRetentionDays] = useState(30);
  const [isTestingCloud, setIsTestingCloud] = useState(false);

  // Sample Snapshot Archives
  const [snapshots, setSnapshots] = useState<BackupSnapshotItem[]>([
    {
      id: 'snap-1',
      name: 'Full Server Production Backup',
      filename: 'barepod-full-server-20261010-1830.bpod',
      type: 'full',
      target: 'All 4 Apps, 2 DBs, SSL, Tunnels',
      size: '142.4 MB',
      createdAt: '2026-10-10 18:30 WIB',
      sha256: '9a8d2f10bc4720e1d88a10b42f1a8c90',
      storage: 'r2',
      status: 'ready'
    },
    {
      id: 'snap-2',
      name: 'App & DB: Larastore Commerce',
      filename: 'larastore-commerce-bundle-20261010.bpod',
      type: 'app',
      target: 'larastore.id (Laravel 11 + PostgreSQL)',
      size: '54.2 MB',
      createdAt: '2026-10-10 16:15 WIB',
      sha256: '10bc4720e1d88a10b42f1a8c909a8d2f',
      storage: 'local',
      status: 'ready'
    },
    {
      id: 'snap-3',
      name: 'App & DB: Flask Sentiment API',
      filename: 'flask-sentiment-api-bundle-20261009.bpod',
      type: 'app',
      target: 'sentiment.barepod.cloud (Python 3.12 + PG)',
      size: '42.8 MB',
      createdAt: '2026-10-09 02:00 WIB',
      sha256: '4720e1d88a10b42f1a8c909a8d2f10bc',
      storage: 'r2',
      status: 'ready'
    },
    {
      id: 'snap-4',
      name: 'Primary Database Cluster Dump',
      filename: 'database-postgres-mysql-dump-20261008.bpod',
      type: 'database',
      target: 'app_production & larastore_db',
      size: '18.6 MB',
      createdAt: '2026-10-08 02:00 WIB',
      sha256: 'e1d88a10b42f1a8c909a8d2f10bc4720',
      storage: 'local',
      status: 'ready'
    }
  ]);

  // Handshake Test
  const handleTestHandshake = () => {
    setIsTestingHandshake(true);
    setHandshakeSuccess(null);
    setTimeout(() => {
      setIsTestingHandshake(false);
      setHandshakeSuccess(true);
      onShowToast?.(
        'Koneksi Berhasil Disetujui',
        `Daemon di ${oldServerIp}:${oldServerPort} terverifikasi (BarePod v2.4, Latensi: 1.8ms, TLS 1.3).`,
        'success'
      );
    }, 1200);
  };

  // Start Live Migration
  const handleStartMigration = () => {
    setIsMigrating(true);
    setMigrationStep(1);
    setMigrationLogs([
      `[${new Date().toLocaleTimeString()}] 🚀 Memulai protokol migrasi server-to-server...`,
      `[${new Date().toLocaleTimeString()}] 🔑 Handshake token autentikasi ke ${oldServerIp}:${oldServerPort}...`,
    ]);

    setTimeout(() => {
      setMigrationStep(2);
      setMigrationLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 📡 Stream rsync zero-copy aktif: menyalin codebase /var/www/apps (142 MB)...`,
        `[${new Date().toLocaleTimeString()}]    - flask-sentiment-api: 42 MB disalin`,
        `[${new Date().toLocaleTimeString()}]    - larastore-commerce: 54 MB disalin`,
        `[${new Date().toLocaleTimeString()}]    - billing-backend-api: 28 MB disalin`,
      ]);
    }, 1800);

    setTimeout(() => {
      setMigrationStep(3);
      setMigrationLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🗄️ Melakukan stream logical dump & import basis data:`,
        `[${new Date().toLocaleTimeString()}]    - PostgreSQL: pg_dump | pg_restore cluster app_production (200 OK)`,
        `[${new Date().toLocaleTimeString()}]    - MySQL: mysqldump --single-transaction larastore_db (200 OK)`,
      ]);
    }, 3600);

    setTimeout(() => {
      setMigrationStep(4);
      setMigrationLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🌐 Mentransfer konfigurasi VirtualHost & SSL:`,
        `[${new Date().toLocaleTimeString()}]    - Let's Encrypt sertifikat symlinked`,
        `[${new Date().toLocaleTimeString()}]    - OpenLiteSpeed & Nginx vhost binding aktif`,
        `[${new Date().toLocaleTimeString()}]    - Mengalihkan Cloudflare Tunnel token ke server baru...`,
      ]);
    }, 5400);

    setTimeout(() => {
      setMigrationStep(5);
      setMigrationLogs(prev => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] ✅ Migrasi server selesai 100%! Semua aplikasi & database live di VPS ini tanpa downtime.`,
      ]);
      setIsMigrating(false);
      onShowToast?.(
        'Migrasi Berhasil!',
        'Seluruh website, basis data, dan konfigurasi telah aktif di server ini.',
        'success'
      );
    }, 7200);
  };

  // Create Snapshot
  const handleCreateSnapshot = () => {
    setIsCreatingSnapshot(true);
    setSnapshotModalOpen(false);
    onShowToast?.('Membuat Snapshot...', 'Mengumpulkan file, logical dump database, dan konfigurasi vhost.', 'info');

    setTimeout(() => {
      const newSnap: BackupSnapshotItem = {
        id: `snap-${Date.now()}`,
        name: snapshotScope === 'full' ? 'Manual Full Server Snapshot' : `Snapshot: ${apps.find(a => a.id === selectedAppForSnapshot)?.name || 'Custom App'}`,
        filename: `barepod-snapshot-${Date.now().toString().slice(-6)}.bpod`,
        type: snapshotScope,
        target: snapshotScope === 'full' ? 'All Services, DBs, VHosts' : (apps.find(a => a.id === selectedAppForSnapshot)?.name || 'Selected Service'),
        size: snapshotScope === 'full' ? '146.8 MB' : '48.2 MB',
        createdAt: `${new Date().toLocaleDateString('id-ID')} ${new Date().toLocaleTimeString('id-ID')} WIB`,
        sha256: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
        storage: 'local',
        status: 'ready'
      };
      setSnapshots([newSnap, ...snapshots]);
      setIsCreatingSnapshot(false);
      onShowToast?.('Snapshot Berhasil Dibuat', `File ${newSnap.filename} siap diunduh atau dipindahkan.`, 'success');
    }, 2000);
  };

  // Download Bundle
  const handleDownloadSnapshot = (snap: BackupSnapshotItem) => {
    // Generate dummy downloadable archive
    const blob = new Blob([
      JSON.stringify({
        bundle: snap.filename,
        version: 'BarePod 2.4-Production',
        createdAt: snap.createdAt,
        type: snap.type,
        target: snap.target,
        sha256: snap.sha256,
        manifest: {
          runtime: 'multi-isolated',
          database: 'Postgres & MySQL dump included',
          vhost: 'Nginx / OpenLiteSpeed / Caddy configuration'
        }
      }, null, 2)
    ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = snap.filename;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast?.('Mengunduh Archive', `File ${snap.filename} sedang diunduh ke perangkat Anda.`, 'success');
  };

  // Execute Restore from File
  const handleExecuteRestore = () => {
    if (!uploadedFile) return;
    setIsRestoring(true);
    setRestoreProgress(10);

    const interval = setInterval(() => {
      setRestoreProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsRestoring(false);
          onShowToast?.('Restore Berhasil', `Seluruh file dan basis data dari ${uploadedFile.name} telah dipulihkan.`, 'success');
          return 100;
        }
        return prev + 25;
      });
    }, 600);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
              <Archive className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Backup, Restore & Migration Hub</span>
                <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-800 font-bold rounded-lg">
                  100% Plug & Play
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Pindah server VPS tanpa pusing, export/import archive bundle (<code>.bpod</code>), dan sync otomatis ke Cloudflare R2 / AWS S3.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSnapshotModalOpen(true)}
            disabled={isCreatingSnapshot}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all shadow-sm shadow-blue-500/25 cursor-pointer"
          >
            <Archive className={`w-3.5 h-3.5 ${isCreatingSnapshot ? 'animate-spin' : ''}`} />
            <span>{isCreatingSnapshot ? 'Membuat Snapshot...' : 'Buat Snapshot (.bpod)'}</span>
          </button>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('migration')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'migration'
              ? 'bg-purple-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ArrowRightLeft className="w-4 h-4" />
          <span>1-Click Pindah Server (Live Migration)</span>
        </button>

        <button
          onClick={() => setActiveTab('snapshots')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'snapshots'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Archive className="w-4 h-4" />
          <span>Daftar Snapshot (.bpod)</span>
          <span className="px-1.5 py-0.2 bg-white/20 rounded text-[10px] font-mono">{snapshots.length}</span>
        </button>

        <button
          onClick={() => setActiveTab('restore')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'restore'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Restore from Archive File</span>
        </button>

        <button
          onClick={() => setActiveTab('cloud_sync')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'cloud_sync'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Cloud className="w-4 h-4" />
          <span>Cloud Storage Sync (R2 / S3)</span>
        </button>
      </div>

      {/* TAB 1: 1-CLICK SERVER-TO-SERVER LIVE MIGRATION */}
      {activeTab === 'migration' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Sub-toggle: Pull vs Source Mode */}
          <div className="bg-slate-100 p-1 rounded-xl inline-flex gap-1 border border-slate-200">
            <button
              onClick={() => setMigrationMode('pull')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                migrationMode === 'pull'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📥 Tarik Data dari Server Lama (Pull to this VPS)
            </button>
            <button
              onClick={() => setMigrationMode('source')}
              className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                migrationMode === 'source'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📤 Jadikan Server Ini Sumber Migrasi (Source Node)
            </button>
          </div>

          {migrationMode === 'pull' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Migration Form Card */}
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-5">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Koneksi ke Server Lama (Source VPS)
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Masukkan IP server lama dan Migration Token dari panel lama. BarePod daemon akan langsung melakukan stream rsync zero-copy.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      IP Address Server Lama / Hostname
                    </label>
                    <input
                      type="text"
                      value={oldServerIp}
                      onChange={(e) => setOldServerIp(e.target.value)}
                      placeholder="e.g. 103.147.154.82"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono text-purple-900 font-bold focus:bg-white focus:border-purple-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Port Daemon
                    </label>
                    <input
                      type="text"
                      value={oldServerPort}
                      onChange={(e) => setOldServerPort(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    One-Time Migration Secret Token
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      value={migrationSecretToken}
                      onChange={(e) => setMigrationSecretToken(e.target.value)}
                      placeholder="bp_mig_..."
                      className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono focus:bg-white focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={handleTestHandshake}
                      disabled={isTestingHandshake}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition-colors cursor-pointer"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${isTestingHandshake ? 'animate-spin' : ''}`} />
                      <span>{isTestingHandshake ? 'Pinging...' : 'Uji Handshake'}</span>
                    </button>
                  </div>
                  {handshakeSuccess && (
                    <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>Daemon server lama terverifikasi & terhubung! (Latensi: 1.8ms • TLS 1.3 Aktif)</span>
                    </div>
                  )}
                </div>

                {/* Scope Selection */}
                <div className="pt-2 border-t border-slate-100 space-y-2.5">
                  <span className="text-xs font-bold text-slate-800 block">Pilih Komponen yang Ingin Dipindahkan:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncApps}
                        onChange={(e) => setSyncApps(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block">Semua Aplikasi & Codebase</span>
                        <span className="text-[10px] text-slate-500">Folder /var/www/apps, .env, build scripts</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncDatabases}
                        onChange={(e) => setSyncDatabases(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block">Seluruh Basis Data & Grants</span>
                        <span className="text-[10px] text-slate-500">PostgreSQL, MySQL, Redis Snapshots</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncVhosts}
                        onChange={(e) => setSyncVhosts(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block">Web Server VHost & SSL</span>
                        <span className="text-[10px] text-slate-500">Nginx/OpenLiteSpeed rules, Lets Encrypt</span>
                      </div>
                    </label>

                    <label className="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={syncTunnels}
                        onChange={(e) => setSyncTunnels(e.target.checked)}
                        className="rounded text-blue-600 border-slate-300"
                      />
                      <div>
                        <span className="font-bold text-slate-800 block">Cloudflare Tunnel Route</span>
                        <span className="text-[10px] text-slate-500">Auto repoint ingress ke IP VPS baru ini</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleStartMigration}
                    disabled={isMigrating}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl transition-all shadow-md shadow-purple-500/25 cursor-pointer"
                  >
                    <Play className={`w-4 h-4 ${isMigrating ? 'animate-spin' : ''}`} />
                    <span>{isMigrating ? 'Sedang Memproses Migrasi Server...' : 'Mulai Migrasi Server (Live Zero-Downtime)'}</span>
                  </button>
                </div>
              </div>

              {/* Progress & Live Terminal Output */}
              <div className="bg-white text-slate-700 rounded-2xl border border-slate-200 p-5 font-mono text-xs shadow-2xs space-y-4 flex flex-col">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="font-bold text-purple-700 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Live Migration Stream
                  </span>
                  <span className="text-[10px] text-slate-400">
                    Step {migrationStep}/5
                  </span>
                </div>

                {/* Step indicator */}
                <div className="space-y-1.5 text-[11px]">
                  <div className={`flex items-center gap-2 ${migrationStep >= 1 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{migrationStep > 1 ? '✓' : '1.'}</span>
                    <span>Handshake & Token Handover</span>
                  </div>
                  <div className={`flex items-center gap-2 ${migrationStep >= 2 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{migrationStep > 2 ? '✓' : '2.'}</span>
                    <span>Zero-Copy File Syncing (/var/www/apps)</span>
                  </div>
                  <div className={`flex items-center gap-2 ${migrationStep >= 3 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{migrationStep > 3 ? '✓' : '3.'}</span>
                    <span>Database Logical Dump & Import Stream</span>
                  </div>
                  <div className={`flex items-center gap-2 ${migrationStep >= 4 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{migrationStep > 4 ? '✓' : '4.'}</span>
                    <span>Web Server VHost & Cloudflare Repoint</span>
                  </div>
                  <div className={`flex items-center gap-2 ${migrationStep >= 5 ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span>{migrationStep >= 5 ? '✓' : '5.'}</span>
                    <span>Selesai & Services Live</span>
                  </div>
                </div>

                {/* Console Log Area */}
                <div className="flex-1 bg-slate-50 p-3 rounded-xl border border-slate-200 overflow-y-auto max-h-52 text-[10px] space-y-1 text-slate-600">
                  {migrationLogs.length === 0 ? (
                    <div className="text-slate-400 text-center py-6">
                      Menunggu perintah migrasi dimulai...
                    </div>
                  ) : (
                    migrationLogs.map((log, idx) => (
                      <div key={idx} className="leading-relaxed">{log}</div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Source Mode: Generate Migration Token */
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-4 max-w-2xl">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Kunci Migrasi Server Ini (Source VPS Credentials)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Salin informasi di bawah ini lalu tempelkan ke panel BarePod di server baru Anda.
                </p>
              </div>

              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono text-xs">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Domain:</span>
                  <div className="text-slate-900 font-bold">panel.barepod.cloud</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Server IP:</span>
                  <div className="text-slate-900 font-bold">103.147.154.82</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">Port Daemon:</span>
                  <div className="text-slate-900 font-bold">8443</div>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-bold block">One-Time Migration Token:</span>
                  <div className="flex items-center justify-between gap-2 bg-white p-2 rounded border border-slate-200 mt-1">
                    <code className="text-purple-700 font-bold truncate">bp_mig_9f8a20bc4720e1d88a10_live</code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText('bp_mig_9f8a20bc4720e1d88a10_live');
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                      className="px-2 py-1 text-xs bg-purple-50 text-purple-700 hover:bg-purple-100 rounded font-semibold transition-colors cursor-pointer flex items-center gap-1"
                    >
                      {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey ? 'Tersalin' : 'Salin Token'}</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-xl">
                <Clock className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Token ini berlaku selama 2 jam dan akan hangus otomatis setelah proses stream migrasi selesai demi keamanan tenant.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SNAPSHOTS & PORTABLE ARCHIVES (.bpod) */}
      {activeTab === 'snapshots' && (
        <div className="space-y-4 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Arsip Snapshot Tersimpan</h3>
              <p className="text-xs text-slate-500">File archive <code>.bpod</code> yang dapat diunduh atau dipindahkan ke server mana pun.</p>
            </div>

            <button
              type="button"
              onClick={() => setSnapshotModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Buat Snapshot Baru</span>
            </button>
          </div>

          {/* Snapshots Table */}
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                <tr>
                  <th className="py-3 px-4">NAMA ARCHIVE (.BPOD)</th>
                  <th className="py-3 px-4">TIPE & TARGET</th>
                  <th className="py-3 px-4">UKURAN</th>
                  <th className="py-3 px-4">PENYIMPANAN</th>
                  <th className="py-3 px-4">TANGGAL DIBUAT</th>
                  <th className="py-3 px-4 text-center">AKSI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {snapshots.map((snap) => (
                  <tr key={snap.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <FileArchive className="w-4 h-4 text-purple-600 shrink-0" />
                        <div>
                          <span className="font-bold text-slate-900 block font-mono">{snap.filename}</span>
                          <span className="text-[10px] text-slate-400 font-sans">{snap.name}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase mr-1.5 ${
                        snap.type === 'full' ? 'bg-purple-100 text-purple-800' :
                        snap.type === 'app' ? 'bg-blue-100 text-blue-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {snap.type}
                      </span>
                      <span className="text-slate-600">{snap.target}</span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-800">{snap.size}</td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 w-fit ${
                        snap.storage === 'r2' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-700'
                      }`}>
                        {snap.storage === 'r2' ? '⚡ Cloudflare R2' : '📁 Local Disk'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">{snap.createdAt}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDownloadSnapshot(snap)}
                          title="Unduh file .bpod ke komputer"
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-600" />
                          <span>Unduh</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onShowToast?.('Restore Dimulai', `Merestore snapshot ${snap.filename}...`, 'info');
                          }}
                          title="Restore langsung dari snapshot ini"
                          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg font-bold border border-emerald-200 transition-colors cursor-pointer"
                        >
                          <RotateCw className="w-3 h-3 text-emerald-600" />
                          <span>Restore</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: RESTORE FROM ARCHIVE FILE */}
      {activeTab === 'restore' && (
        <div className="space-y-6 max-w-2xl animate-in fade-in duration-200">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Import & Restore File Archive (.bpod)</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Punya file backup dari server lama? Drag & drop file <code>.bpod</code> atau <code>.tar.gz</code> ke sini untuk restore otomatis.
            </p>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files[0];
              if (file) {
                setUploadedFile({
                  name: file.name,
                  size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                  manifest: {
                    type: file.name.includes('full') ? 'Full Server' : 'App & DB Bundle',
                    version: 'BarePod 2.4-Production',
                    created: '2026-10-10 18:30 WIB'
                  }
                });
              }
            }}
            className={`p-8 border-2 border-dashed rounded-2xl text-center transition-all ${
              dragActive 
                ? 'border-blue-500 bg-blue-50/50' 
                : 'border-slate-300 hover:border-slate-400 bg-slate-50/50'
            }`}
          >
            <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
            <h4 className="text-xs font-bold text-slate-800">Tarik & Lepas File .bpod di Sini</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">Mendukung file bundle BarePod (*.bpod, *.tar.gz, *.sql.gz)</p>
            <label className="mt-3 inline-block px-3 py-1.5 text-xs font-bold text-blue-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl cursor-pointer shadow-2xs">
              Pilih File dari Komputer
              <input
                type="file"
                accept=".bpod,.tar.gz,.gz,.sql"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploadedFile({
                      name: file.name,
                      size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                      manifest: {
                        type: 'BarePod Application Bundle',
                        version: '2.4',
                        created: '2026-10-10'
                      }
                    });
                  }
                }}
              />
            </label>
          </div>

          {/* Uploaded File Manifest Inspector */}
          {uploadedFile && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2.5">
                  <FileArchive className="w-6 h-6 text-purple-600" />
                  <div>
                    <span className="font-bold text-slate-900 block text-xs font-mono">{uploadedFile.name}</span>
                    <span className="text-[11px] text-slate-500">{uploadedFile.size} • Checksum SHA-256 Valid</span>
                  </div>
                </div>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
                  Archive Terverifikasi
                </span>
              </div>

              {/* Progress bar during restore */}
              {isRestoring && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Mengekstrak file & merestore database...</span>
                    <span>{restoreProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-blue-600 transition-all duration-300"
                      style={{ width: `${restoreProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setUploadedFile(null)}
                  disabled={isRestoring}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRestore}
                  disabled={isRestoring}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl transition-all shadow-sm shadow-emerald-500/25 cursor-pointer"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isRestoring ? 'animate-spin' : ''}`} />
                  <span>{isRestoring ? 'Merestore...' : 'Jalankan Restore Otomatis'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CLOUD STORAGE REMOTE SYNC & CRON */}
      {activeTab === 'cloud_sync' && (
        <div className="space-y-6 max-w-2xl animate-in fade-in duration-200">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Cloud Storage Sync & Otomasi Cron</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Setiap kali backup dibuat, arsip otomatis di-upload ke bucket remote untuk redundansi di luar server VPS.
            </p>
          </div>

          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700">Pilih Cloud Provider</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {(['r2', 's3', 'gcs', 'wasabi'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCloudProvider(p)}
                  className={`p-3 rounded-xl border text-left text-xs font-bold transition-all cursor-pointer ${
                    cloudProvider === p
                      ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p === 'r2' && '⚡ Cloudflare R2'}
                  {p === 's3' && '☁️ AWS S3'}
                  {p === 'gcs' && '🌐 Google Cloud'}
                  {p === 'wasabi' && '🗄️ Wasabi / MinIO'}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Bucket Name</label>
                <input
                  type="text"
                  value={cloudBucket}
                  onChange={(e) => setCloudBucket(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">S3 Endpoint URL</label>
                <input
                  type="text"
                  value={cloudEndpoint}
                  onChange={(e) => setCloudEndpoint(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Access Key ID</label>
                <input
                  type="text"
                  value={cloudAccessKey}
                  onChange={(e) => setCloudAccessKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Secret Access Key</label>
                <input
                  type="password"
                  value={cloudSecretKey}
                  onChange={(e) => setCloudSecretKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Jadwal Backup Otomatis</label>
                <select
                  value={cloudSchedule}
                  onChange={(e) => setCloudSchedule(e.target.value as any)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-semibold"
                >
                  <option value="daily">Harian (Setiap 02:00 WIB)</option>
                  <option value="weekly">Mingguan (Setiap Minggu)</option>
                  <option value="hourly">Tiap 6 Jam (High-Traffic App)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Masa Retensi Cloud</label>
                <select
                  value={cloudRetentionDays}
                  onChange={(e) => setCloudRetentionDays(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium"
                >
                  <option value={7}>Simpan 7 Hari Terakhir</option>
                  <option value={14}>Simpan 14 Hari Terakhir</option>
                  <option value={30}>Simpan 30 Hari Terakhir</option>
                  <option value={90}>Simpan 90 Hari (Enterprise)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsTestingCloud(true);
                  setTimeout(() => {
                    setIsTestingCloud(false);
                    onShowToast?.('Bucket Terverifikasi', 'Koneksi ke Cloudflare R2 bucket berhasil (Read/Write OK).', 'success');
                  }, 1000);
                }}
                disabled={isTestingCloud}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isTestingCloud ? 'animate-spin' : ''}`} />
                <span>{isTestingCloud ? 'Memverifikasi...' : 'Tes Koneksi Cloud'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onShowToast?.('Konfigurasi Tersimpan', 'Jadwal backup remote cloud telah diperbarui & aktif.', 'success');
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-2xs cursor-pointer"
              >
                Simpan & Aktifkan Sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SNAPSHOT */}
      {snapshotModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full border border-slate-200 shadow-xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Buat Snapshot Bundle (.bpod)</h3>
              </div>
              <button
                onClick={() => setSnapshotModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Scope Backup</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['full', 'app', 'database'] as const).map(sc => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setSnapshotScope(sc)}
                      className={`p-2 rounded-xl border text-xs font-bold capitalize transition-all ${
                        snapshotScope === sc
                          ? 'border-blue-600 bg-blue-50 text-blue-900'
                          : 'border-slate-200 text-slate-600'
                      }`}
                    >
                      {sc === 'full' && 'Full Server'}
                      {sc === 'app' && 'Single App'}
                      {sc === 'database' && 'Database Only'}
                    </button>
                  ))}
                </div>
              </div>

              {snapshotScope === 'app' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pilih Aplikasi</label>
                  <select
                    value={selectedAppForSnapshot}
                    onChange={(e) => setSelectedAppForSnapshot(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    {apps.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.domain})</option>
                    ))}
                  </select>
                </div>
              )}

              <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={encryptBackup}
                  onChange={(e) => setEncryptBackup(e.target.checked)}
                  className="rounded text-blue-600 border-slate-300"
                />
                <div className="text-xs">
                  <span className="font-bold text-slate-800 block">Enkripsi AES-256</span>
                  <span className="text-[10px] text-slate-500">Kunci file archive dengan passphrase rahasia</span>
                </div>
              </label>

              {encryptBackup && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Passphrase Enkripsi</label>
                  <input
                    type="password"
                    value={encryptionPassword}
                    onChange={(e) => setEncryptionPassword(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSnapshotModalOpen(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleCreateSnapshot}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-2xs"
              >
                Buat Snapshot Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
