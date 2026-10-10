import React, { useState } from 'react';
import { 
  Settings, 
  ShieldCheck, 
  Globe, 
  HardDrive, 
  Bell, 
  Database, 
  Key, 
  Lock, 
  RotateCw, 
  Save, 
  Check, 
  Copy, 
  Server, 
  AlertTriangle, 
  CloudRain, 
  Sliders, 
  Eye, 
  EyeOff, 
  Mail, 
  MessageSquare, 
  Send,
  Zap,
  Terminal,
  RefreshCw
} from 'lucide-react';
import type { WebServerType } from '../types';

interface PanelSettingsViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

export const PanelSettingsView: React.FC<PanelSettingsViewProps> = ({
  onShowToast,
  onOpenTerminal,
}) => {
  const [activeTab, setActiveTab] = useState<'general' | 'security' | 'proxy' | 'backups' | 'notifications' | 'databases'>('general');
  const [isSaving, setIsSaving] = useState(false);

  // 1. General Settings
  const [panelPort, setPanelPort] = useState(8443);
  const [panelDomain, setPanelDomain] = useState('panel.barepod.cloud');
  const [defaultWebServer, setDefaultWebServer] = useState<WebServerType>('openlitespeed');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [language, setLanguage] = useState('id');
  const [autoUpdate, setAutoUpdate] = useState(true);

  // 2. Security Settings
  const [forceHttps, setForceHttps] = useState(true);
  const [enable2FA, setEnable2FA] = useState(false);
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [maxLoginAttempts, setMaxLoginAttempts] = useState(5);
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState(24);
  const [jwtSecretMasked, setJwtSecretMasked] = useState(true);

  // 3. Proxy & SSL
  const [httpPort, setHttpPort] = useState(80);
  const [httpsPort, setHttpsPort] = useState(443);
  const [enableHttp3, setEnableHttp3] = useState(true);
  const [enableBrotli, setEnableBrotli] = useState(true);
  const [letsEncryptEmail, setLetsEncryptEmail] = useState('admin@barepod.cloud');
  const [restoreCloudflareIp, setRestoreCloudflareIp] = useState(true);

  // 4. Backups
  const [backupSchedule, setBackupSchedule] = useState<'daily' | 'weekly' | 'disabled'>('daily');
  const [backupRetentionDays, setBackupRetentionDays] = useState(14);
  const [backupStorageType, setBackupStorageType] = useState<'local' | 's3' | 'r2' | 'gcs'>('local');
  const [backupPath, setBackupPath] = useState('/var/backups/barepod');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);

  // 5. Notifications
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [smtpHost, setSmtpHost] = useState('smtp.mailgun.org');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpUser, setSmtpUser] = useState('postmaster@barepod.cloud');
  const [smtpPassword, setSmtpPassword] = useState('••••••••••••');

  // 6. Databases
  const [pgPort, setPgPort] = useState(5432);
  const [mysqlPort, setMysqlPort] = useState(3306);
  const [redisPort, setRedisPort] = useState(6379);
  const [ssoSessionMinutes, setSsoSessionMinutes] = useState(120);

  const handleSaveAll = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      onShowToast?.('Settings Saved', 'Panel configuration updated successfully. Daemon reloaded.', 'success');
    }, 700);
  };

  const handleTestBackup = () => {
    setIsBackingUp(true);
    onShowToast?.('Backup Initiated', 'Creating snapshot of databases and web configurations...', 'info');
    setTimeout(() => {
      setIsBackingUp(false);
      onShowToast?.('Backup Completed', 'Snapshot saved to /var/backups/barepod/snapshot_20261010_1910.tar.gz (1.2 GB)', 'success');
    }, 2500);
  };

  const handleTestNotification = () => {
    onShowToast?.('Test Notification Sent', 'Verification ping sent to configured alert channel.', 'success');
  };

  const handleRestartDaemon = () => {
    onShowToast?.('Daemon Restarting', 'systemctl restart barepod-daemon executed.', 'info');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Panel Settings & System</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-100 text-blue-800">
              v1.0.4 Release
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Global panel daemon port, security policies, backup destinations, reverse proxy, and system alerts
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRestartDaemon}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs"
          >
            <RotateCw className="w-3.5 h-3.5 text-slate-500" />
            <span>Restart Daemon</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-500/25 transition-all"
          >
            {isSaving ? <RotateCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaving ? 'Menyimpan...' : 'Simpan Semua'}</span>
          </button>
        </div>
      </div>

      {/* Main Container with Sidebar Navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden flex flex-col md:flex-row min-h-[580px]">
        
        {/* Settings Navigation Tabs */}
        <div className="w-full md:w-64 border-r border-slate-200 bg-slate-50/50 p-3 space-y-1 shrink-0">
          <button
            onClick={() => setActiveTab('general')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'general'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>General & Defaults</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'security'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Security & Authentication</span>
          </button>

          <button
            onClick={() => setActiveTab('proxy')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'proxy'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Reverse Proxy & SSL</span>
          </button>

          <button
            onClick={() => setActiveTab('backups')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'backups'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Backup & Snapshots</span>
          </button>

          <button
            onClick={() => setActiveTab('notifications')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'notifications'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>Notifications & Alerts</span>
          </button>

          <button
            onClick={() => setActiveTab('databases')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'databases'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Database Defaults</span>
          </button>
        </div>

        {/* Tab Content Form */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          
          {/* 1. GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">General Panel Preferences</h2>
                <p className="text-xs text-slate-500 mt-0.5">Konfigurasi port daemon, domain panel, dan default web server.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Panel Port
                  </label>
                  <input
                    type="number"
                    value={panelPort}
                    onChange={(e) => setPanelPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 8443 (HTTPS secure)</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Panel FQDN Domain
                  </label>
                  <input
                    type="text"
                    value={panelDomain}
                    onChange={(e) => setPanelDomain(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Domain untuk mengakses dashboard</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Default Web Server Engine untuk Aplikasi Baru
                </label>
                <select
                  value={defaultWebServer}
                  onChange={(e) => setDefaultWebServer(e.target.value as WebServerType)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-semibold focus:border-blue-500"
                >
                  <option value="openlitespeed">OpenLiteSpeed (Rekomendasi - LSCache & Tercepat untuk PHP)</option>
                  <option value="nginx">Nginx (Standar Industri & Reverse Proxy Unggul)</option>
                  <option value="caddy">Caddy (Otomatis HTTPS & HTTP/3 Modern)</option>
                  <option value="apache">Apache 2.4 (Maksimal Kompatibilitas .htaccess)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Server Timezone
                  </label>
                  <select
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value="Asia/Jakarta">Asia/Jakarta (WIB - UTC+7)</option>
                    <option value="Asia/Makassar">Asia/Makassar (WITA - UTC+8)</option>
                    <option value="Asia/Jayapura">Asia/Jayapura (WIT - UTC+9)</option>
                    <option value="UTC">UTC (Universal Time)</option>
                    <option value="Asia/Singapore">Asia/Singapore (SGT - UTC+8)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Bahasa Antarmuka
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="en">English (US)</option>
                  </select>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="autoUpdateCheck"
                  checked={autoUpdate}
                  onChange={(e) => setAutoUpdate(e.target.checked)}
                  className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
                />
                <div>
                  <label htmlFor="autoUpdateCheck" className="text-xs font-bold text-slate-900 cursor-pointer block">
                    Automatic Core & Security Patches
                  </label>
                  <p className="text-[11px] text-slate-500">
                    Otomatis mengunduh patch keamanan dan pembaharuan kernel cgroups pada jam 03:00 WIB.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 2. SECURITY & AUTH */}
          {activeTab === 'security' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">Security & Access Control</h2>
                <p className="text-xs text-slate-500 mt-0.5">Kebijakan autentikasi panel, proteksi brute-force, dan restriksi IP.</p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Two-Factor Authentication (2FA TOTP)</h3>
                    <p className="text-[11px] text-slate-500">Wajibkan Google Authenticator / Authy untuk login akun Admin.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEnable2FA(!enable2FA);
                      onShowToast?.(
                        !enable2FA ? '2FA Diaktifkan' : '2FA Dinonaktifkan',
                        !enable2FA ? 'Scan QR Code dengan Google Authenticator.' : 'Autentikasi 2FA dimatikan.',
                        'info'
                      );
                    }}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      enable2FA ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                    }`}
                  >
                    {enable2FA ? '2FA Aktif' : 'Aktifkan 2FA'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Batas Percobaan Login (Fail2ban)
                  </label>
                  <input
                    type="number"
                    value={maxLoginAttempts}
                    onChange={(e) => setMaxLoginAttempts(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Blokir IP selama 30 menit jika gagal 5x.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Masa Berlaku Sesi Admin
                  </label>
                  <select
                    value={sessionTimeoutHours}
                    onChange={(e) => setSessionTimeoutHours(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value={12}>12 Jam</option>
                    <option value={24}>24 Jam (1 Hari)</option>
                    <option value={72}>3 Hari</option>
                    <option value={168}>7 Hari</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Whitelist IP untuk Akses Panel Admin
                </label>
                <textarea
                  rows={3}
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder="Contoh: 192.168.1.100&#10;103.45.12.0/24&#10;(Kosongkan jika ingin mengizinkan dari semua IP)"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Hanya IP di atas yang diizinkan membuka port panel admin.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">JWT Secret Signature Key</span>
                  <button
                    type="button"
                    onClick={() => setJwtSecretMasked(!jwtSecretMasked)}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {jwtSecretMasked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    <span>{jwtSecretMasked ? 'Reveal' : 'Mask'}</span>
                  </button>
                </div>
                <input
                  type={jwtSecretMasked ? "password" : "text"}
                  readOnly
                  value="barepod_jwt_sec_9941a87b20f4c01e5491aa"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono text-slate-700"
                />
              </div>
            </div>
          )}

          {/* 3. REVERSE PROXY & SSL */}
          {activeTab === 'proxy' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">Reverse Proxy & SSL Protocols</h2>
                <p className="text-xs text-slate-500 mt-0.5">Pengaturan port ingress publik, HTTP/3, Let's Encrypt email, dan Cloudflare IP restore.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    HTTP Public Port
                  </label>
                  <input
                    type="number"
                    value={httpPort}
                    onChange={(e) => setHttpPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 80</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    HTTPS Public Port
                  </label>
                  <input
                    type="number"
                    value={httpsPort}
                    onChange={(e) => setHttpsPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 443</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Let's Encrypt Admin Contact Email
                </label>
                <input
                  type="email"
                  value={letsEncryptEmail}
                  onChange={(e) => setLetsEncryptEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Digunakan untuk notifikasi pembaharuan sertifikat SSL TLS otomatis.
                </p>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="http3Check"
                    checked={enableHttp3}
                    onChange={(e) => setEnableHttp3(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
                  />
                  <div>
                    <label htmlFor="http3Check" className="text-xs font-bold text-slate-900 cursor-pointer block">
                      HTTP/3 (QUIC Protocol via UDP)
                    </label>
                    <p className="text-[11px] text-slate-500">Meningkatkan kecepatan koneksi mobile dengan handshake 0-RTT.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="brotliCheck"
                    checked={enableBrotli}
                    onChange={(e) => setEnableBrotli(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
                  />
                  <div>
                    <label htmlFor="brotliCheck" className="text-xs font-bold text-slate-900 cursor-pointer block">
                      Brotli & Gzip Compression
                    </label>
                    <p className="text-[11px] text-slate-500">Kompresi dinamis otomatis untuk file CSS, JS, HTML, dan SVG.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="cfRealIpCheck"
                    checked={restoreCloudflareIp}
                    onChange={(e) => setRestoreCloudflareIp(e.target.checked)}
                    className="mt-0.5 w-4 h-4 text-blue-600 rounded border-slate-300"
                  />
                  <div>
                    <label htmlFor="cfRealIpCheck" className="text-xs font-bold text-slate-900 cursor-pointer block">
                      Restore Cloudflare Real IP (CF-Connecting-IP)
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Mengembalikan IP asli pengunjung website di log Nginx/OLS saat menggunakan proxy Cloudflare CDN.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. BACKUPS & SNAPSHOTS */}
          {activeTab === 'backups' && (
            <div className="space-y-6 max-w-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Automated Backups & Storage</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Cadangkan seluruh website, basis data, dan konfigurasi panel.</p>
                </div>
                <button
                  type="button"
                  onClick={handleTestBackup}
                  disabled={isBackingUp}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors shadow-2xs"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                  <span>{isBackingUp ? 'Memproses Snapshot...' : 'Create Snapshot Now'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Jadwal Backup Otomatis
                  </label>
                  <select
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  >
                    <option value="daily">Harian (Setiap 02:00 WIB)</option>
                    <option value="weekly">Mingguan (Setiap Minggu)</option>
                    <option value="disabled">Nonaktifkan Otomatis</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Masa Retensi Backup
                  </label>
                  <select
                    value={backupRetentionDays}
                    onChange={(e) => setBackupRetentionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value={7}>Simpan 7 Hari Terakhir</option>
                    <option value={14}>Simpan 14 Hari Terakhir</option>
                    <option value={30}>Simpan 30 Hari Terakhir</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Penyimpanan Target (Destination)
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(['local', 's3', 'r2'] as const).map(dest => (
                    <button
                      key={dest}
                      type="button"
                      onClick={() => setBackupStorageType(dest)}
                      className={`p-3 rounded-xl border text-left text-xs font-bold capitalize transition-all ${
                        backupStorageType === dest
                          ? 'border-blue-600 bg-blue-50 text-blue-900 ring-1 ring-blue-600'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {dest === 'local' && '📁 Local VPS Disk'}
                      {dest === 's3' && '☁️ AWS S3 Compatible'}
                      {dest === 'r2' && '⚡ Cloudflare R2'}
                    </button>
                  ))}
                </div>
              </div>

              {backupStorageType === 'local' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Direktori Backup Lokal Host
                  </label>
                  <input
                    type="text"
                    value={backupPath}
                    onChange={(e) => setBackupPath(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              ) : (
                <div className="space-y-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Bucket Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. my-panel-backups"
                      value={s3Bucket}
                      onChange={(e) => setS3Bucket(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Endpoint URL
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. https://<account_id>.r2.cloudflarestorage.com"
                      value={s3Endpoint}
                      onChange={(e) => setS3Endpoint(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 5. NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="space-y-6 max-w-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Notifications & Alert Channels</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Dapatkan peringatan instan saat CPU &gt; 90%, disk penuh, atau ada serangan brute force.</p>
                </div>
                <button
                  type="button"
                  onClick={handleTestNotification}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Ping</span>
                </button>
              </div>

              {/* Telegram Bot */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">✈️</span>
                    <h3 className="text-xs font-bold text-slate-900">Telegram Bot Notifications</h3>
                  </div>
                  <input
                    type="checkbox"
                    checked={telegramEnabled}
                    onChange={(e) => setTelegramEnabled(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300"
                  />
                </div>
                {telegramEnabled && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Bot Token</label>
                      <input
                        type="text"
                        placeholder="123456789:ABCDef..."
                        value={telegramBotToken}
                        onChange={(e) => setTelegramBotToken(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-600 mb-1">Chat ID</label>
                      <input
                        type="text"
                        placeholder="-100123456789"
                        value={telegramChatId}
                        onChange={(e) => setTelegramChatId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Discord Webhook */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🎮</span>
                  <h3 className="text-xs font-bold text-slate-900">Discord Channel Webhook</h3>
                </div>
                <input
                  type="text"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={discordWebhookUrl}
                  onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                />
              </div>

              {/* SMTP Email */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-slate-600" />
                  <h3 className="text-xs font-bold text-slate-900">SMTP Server untuk Email Notifikasi</h3>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">SMTP Host</label>
                    <input
                      type="text"
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 mb-1">Port</label>
                    <input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. DATABASES */}
          {activeTab === 'databases' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">Database Engine Default Ports</h2>
                <p className="text-xs text-slate-500 mt-0.5">Port listening lokal untuk engine PostgreSQL, MariaDB, dan Redis.</p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">PostgreSQL</label>
                  <input
                    type="number"
                    value={pgPort}
                    onChange={(e) => setPgPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 5432</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">MariaDB / MySQL</label>
                  <input
                    type="number"
                    value={mysqlPort}
                    onChange={(e) => setMysqlPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 3306</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Redis</label>
                  <input
                    type="number"
                    value={redisPort}
                    onChange={(e) => setRedisPort(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Default: 6379</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Masa Berlaku Sesi Web GUI SSO (phpMyAdmin / DbGate)
                </label>
                <select
                  value={ssoSessionMinutes}
                  onChange={(e) => setSsoSessionMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                >
                  <option value={60}>60 Menit (1 Jam)</option>
                  <option value={120}>120 Menit (2 Jam)</option>
                  <option value={360}>360 Menit (6 Jam)</option>
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Otomatis me-logout autologin SSO jika tidak ada aktivitas pengguna.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
