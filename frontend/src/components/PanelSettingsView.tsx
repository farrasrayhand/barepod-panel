import { api } from '../api/client';
import React, { useState } from 'react';
import { GuardCard } from './GuardCard';
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
  RefreshCw,
  Activity,
  Cpu,
  Clock,
  Trash2
} from 'lucide-react';
import type { WebServerType } from '../types';
import { useSubRoute } from '../hooks/useSubRoute';
import { MASTER_PHP_EXTENSIONS, type PhpExtensionItem } from '../data/defaultPhpExtensions';

interface PanelSettingsViewProps {
  /** False hides controls a signed-in user may look at but not change — the daemon refuses them
   * anyway, and a form that cannot be saved is worse than no form. */
  isAdmin?: boolean;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

export const PanelSettingsView: React.FC<PanelSettingsViewProps> = ({
  isAdmin = false,
  onShowToast,
  onOpenTerminal,
}) => {
  const [activeTab, setActiveTab] = useSubRoute<'general' | 'monitoring' | 'security' | 'proxy' | 'backups' | 'notifications' | 'databases' | 'php_defaults' | 'maintenance'>('general');
  const [isSaving, setIsSaving] = useState(false);
  // The address an external client should use. Unlike most of this screen it is real: the daemon
  // stores it and every connection snippet prefers it. It cannot be detected — behind NAT there is
  // no public address to find, and a domain is knowledge only the operator has.
  const [externalAddress, setExternalAddress] = useState('');
  const [externalSaving, setExternalSaving] = useState(false);
  // The addresses the lockout must never ban, one per line. Visible because a list that can silently be
  // empty is the foot-gun it exists to remove — the operator's own address is added by any sign-in, but
  // seeing that is the difference between trusting it and hoping.
  const [trustedDraft, setTrustedDraft] = useState('');
  const [trustedSaving, setTrustedSaving] = useState(false);
  // Measured, not written into the screen: the settings page used to state the engines' ports and the
  // panel's, and SSH was missing entirely.
  const [ports, setPorts] = useState<{
    panel: number;
    ssh: number;
    engines: Record<string, number>;
    sshPorts: number[];
  } | null>(null);
  // Changing a port the host listens on: admin-only, and both go through the daemon's own checks.
  const [panelPortDraft, setPanelPortDraft] = useState('');
  const [sshPortDraft, setSshPortDraft] = useState('');
  const [portBusy, setPortBusy] = useState(false);

  const changePanelPort = async () => {
    const port = Number(panelPortDraft);
    if (!port || portBusy) return;
    setPortBusy(true);
    try {
      const answer = await api.setPanelPort(port);
      onShowToast?.('Panel is moving', answer.note, 'info');
      setPanelPortDraft('');
    } catch (err) {
      onShowToast?.('Could not change the port', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setPortBusy(false);
    }
  };

  const changeSSHPort = async (port: number, remove: boolean) => {
    if (portBusy) return;
    setPortBusy(true);
    try {
      const answer = await api.setSSHPort(port, remove);
      onShowToast?.(remove ? 'SSH port removed' : 'SSH port added', answer.note, 'success');
      const measured = await api.systemPorts();
      setPorts(measured);
      setSshPortDraft('');
    } catch (err) {
      onShowToast?.('Could not change the SSH port', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setPortBusy(false);
    }
  };

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const settings = await api.panelSettings();
        if (alive) {
          setExternalAddress(settings.externalAddress || '');
          setTrustedDraft((settings.trustedAddresses || []).join('\n'));
        }
      } catch {
        // Left empty: the panel then names the address it is being used on.
      }
      try {
        const measured = await api.systemPorts();
        if (alive) setPorts(measured);
      } catch {
        // No numbers are better than numbers that are not true of this host.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const saveExternalAddress = async () => {
    setExternalSaving(true);
    try {
      const saved = await api.savePanelSettings({ externalAddress: externalAddress.trim() });
      setExternalAddress(saved.externalAddress || '');
      onShowToast?.(
        saved.externalAddress ? 'External address saved' : 'External address cleared',
        saved.externalAddress
          ? 'Connection snippets and the sidebar will use it from now on.'
          : 'The panel will name the address it is being used on.',
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not save', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setExternalSaving(false);
    }
  };

  const saveTrusted = async () => {
    setTrustedSaving(true);
    try {
      const entries = trustedDraft
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const saved = await api.savePanelSettings({ trustedAddresses: entries });
      setTrustedDraft((saved.trustedAddresses || []).join('\n'));
      onShowToast?.(
        'Never-ban list saved',
        entries.length === 0
          ? 'Empty: nothing is exempt. Your own address is added again the next time you sign in.'
          : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} will never be banned.`,
        entries.length === 0 ? 'info' : 'success',
      );
    } catch (err) {
      onShowToast?.('Could not save', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setTrustedSaving(false);
    }
  };

  // System & Docker Cleanup
  const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(true);
  const [cleanupCron, setCleanupCron] = useState('0 4 * * *');
  const [pruneSystemJunk, setPruneSystemJunk] = useState(true);
  const [systemJunkRetentionDays, setSystemJunkRetentionDays] = useState(7);
  const [pruneDocker, setPruneDocker] = useState(true);
  const [dockerPruneDanglingImages, setDockerPruneDanglingImages] = useState(true);
  const [dockerPruneStoppedContainers, setDockerPruneStoppedContainers] = useState(true);
  const [dockerPruneUnusedVolumes, setDockerPruneUnusedVolumes] = useState(false);
  const [dockerPruneBuildCache, setDockerPruneBuildCache] = useState(true);
  const [isPruningSystem, setIsPruningSystem] = useState(false);
  const [lastCleanup, setLastCleanup] = useState('Never');

  // Recommended default maintenance jobs (keeps the server healthy out of the box)
  const [cronJobs, setCronJobs] = useState([
    { id: 'metrics_prune', label: 'Metrics & log retention prune', desc: 'Trim time-series metrics and rotated logs past retention.', schedule: '0 3 * * *', enabled: true },
    { id: 'system_junk', label: 'System junk cleanup', desc: 'Clear /tmp, orphan build artifacts, and expired snapshots.', schedule: '0 4 * * *', enabled: true },
    { id: 'docker_prune', label: 'Docker system prune', desc: 'Dangling images, stopped containers, and build cache.', schedule: '30 4 * * *', enabled: true },
    { id: 'ssl_renew', label: 'SSL certificate renewal', desc: "Renew Let's Encrypt / Caddy certificates before expiry.", schedule: '0 0,12 * * *', enabled: true },
    { id: 'security_updates', label: 'Security OS updates', desc: 'Unattended security upgrades (apt unattended-upgrades).', schedule: '0 5 * * *', enabled: true },
    { id: 'logrotate', label: 'Log rotation', desc: 'Rotate and compress service logs.', schedule: '0 2 * * *', enabled: true },
    { id: 'db_maintenance', label: 'Database maintenance', desc: 'PostgreSQL VACUUM ANALYZE & MariaDB table optimize.', schedule: '0 3 * * 0', enabled: true },
    { id: 'fstrim', label: 'SSD TRIM (fstrim)', desc: 'Discard unused blocks to keep NVMe/SSD performance.', schedule: '0 2 * * 0', enabled: true },
    { id: 'smart_test', label: 'S.M.A.R.T. short self-test', desc: 'Weekly disk health self-test.', schedule: '0 1 * * 0', enabled: true },
    { id: 'service_watchdog', label: 'Service watchdog', desc: 'Restart nginx/caddy/php-fpm/docker/cloudflared if down.', schedule: '*/5 * * * *', enabled: true },
    { id: 'disk_alert', label: 'Disk & resource alerts', desc: 'Notify when disk or RAM crosses the threshold.', schedule: '*/15 * * * *', enabled: true },
  ]);

  const toggleCronJob = (id: string) => {
    setCronJobs((prev) => prev.map((job) => (job.id === id ? { ...job, enabled: !job.enabled } : job)));
  };

  const handleRunCleanupNow = () => {
    setIsPruningSystem(true);
    setTimeout(() => {
      setIsPruningSystem(false);
      const systemMb = pruneSystemJunk ? Math.floor(120 + Math.random() * 400) : 0;
      const dockerMb = pruneDocker ? Math.floor(200 + Math.random() * 900) : 0;
      setLastCleanup(new Date().toLocaleString());
      onShowToast?.(
        'Cleanup Complete',
        `Reclaimed ${systemMb} MB system junk${pruneDocker ? ` and ${dockerMb} MB Docker data` : ''}.`,
        'success'
      );
    }, 1400);
  };

  // Global PHP Extensions Blueprint Settings
  const [globalPhpExtensions, setGlobalPhpExtensions] = useState<PhpExtensionItem[]>(MASTER_PHP_EXTENSIONS);
  const [defaultPhpVersion, setDefaultPhpVersion] = useState('8.4');
  const [defaultMemoryLimit, setDefaultMemoryLimit] = useState('512M');
  const [defaultUploadMaxSize, setDefaultUploadMaxSize] = useState('100M');
  const [defaultMaxExecutionTime, setDefaultMaxExecutionTime] = useState('300');
  const [extSearchAdmin, setExtSearchAdmin] = useState('');
  const [extCatAdmin, setExtCatAdmin] = useState('all');

  // Monitoring & Telemetry Retention Settings
  const [serverMetricsRetentionDays, setServerMetricsRetentionDays] = useState(90);
  const [metricsSampleIntervalSecs, setMetricsSampleIntervalSecs] = useState(15);
  const [enableSmartHourlySnapshot, setEnableSmartHourlySnapshot] = useState(true);
  const [appDefaultRetentionDays, setAppDefaultRetentionDays] = useState(30); // Max 30 days
  const [autoPruneSchedule, setAutoPruneSchedule] = useState('0 3 * * *');
  const [isPruning, setIsPruning] = useState(false);

  // 1. General Settings
  const [panelPort, setPanelPort] = useState(8443);
  const [panelDomain, setPanelDomain] = useState('panel.barepod.cloud');
  const [defaultWebServer, setDefaultWebServer] = useState<WebServerType>('openlitespeed');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [language, setLanguage] = useState('id');
  const [autoUpdate, setAutoUpdate] = useState(true);

  // 2. Security Settings
  const [forceHttps, setForceHttps] = useState(true);
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState(24);
  // A feature this panel does not have yet: kept as the plan it is, marked so nobody relies on it.
  const [ipWhitelist, setIpWhitelist] = useState('');
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

  const handlePruneOldMetrics = () => {
    setIsPruning(true);
    onShowToast?.('Pruning Metrics Started', `Cleaning time-series metrics older than ${serverMetricsRetentionDays} days...`, 'info');
    setTimeout(() => {
      setIsPruning(false);
      onShowToast?.('Pruning Complete', `1.42 million old data points removed. 420 MB of disk space freed.`, 'success');
    }, 1100);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Panel Settings & System</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800">
              Prototype UI • Simulated
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
            <span>{isSaving ? 'Saving...' : 'Save All'}</span>
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
            onClick={() => setActiveTab('monitoring')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'monitoring'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Monitoring Policy (Retention)</span>
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
            <span>Backup Policy (Schedule)</span>
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

          <button
            onClick={() => setActiveTab('php_defaults')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'php_defaults'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>PHP Stack & Default Exts</span>
          </button>

          <button
            onClick={() => setActiveTab('maintenance')}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all text-left ${
              activeTab === 'maintenance'
                ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Trash2 className="w-4 h-4" />
            <span>System & Cleanup</span>
          </button>
        </div>

        {/* Tab Content Form */}
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          
          {/* 1. GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">General Panel Preferences</h2>
                <p className="text-xs text-slate-500 mt-0.5">Daemon port, panel domain, and default web server.</p>
              </div>

              {/* Real, unlike most of this tab: stored by the daemon, and every connection snippet
                  prefers it when a database is public. */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <label className="block">
                  <span className="text-xs font-bold text-slate-800">External address (what clients use)</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    A bare hostname or public IP — no scheme, no port. The daemon cannot detect it:
                    behind NAT there is no public address to find, and a domain proxied by a CDN cannot
                    carry a database port. Leave it empty and the panel names the address it is being
                    used on.
                  </p>
                </label>
                <div className="flex gap-2">
                  <input
                    value={externalAddress}
                    onChange={(e) => setExternalAddress(e.target.value)}
                    disabled={!isAdmin}
                    placeholder="db.example.com or 203.0.113.10"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void saveExternalAddress()}
                    disabled={!isAdmin || externalSaving}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors shrink-0"
                  >
                    {externalSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Panel Port
                  </label>
                  <input
                    type="number"
                    value={ports?.panel ?? ''}
                    readOnly
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Measured: the port the daemon was started with, not a number this screen can change.
                  </p>
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
                  <p className="text-[10px] text-slate-400 mt-1">Domain used to access the dashboard</p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Default Web Server Engine for New Apps
                </label>
                <select
                  value={defaultWebServer}
                  onChange={(e) => setDefaultWebServer(e.target.value as WebServerType)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-semibold focus:border-blue-500"
                >
                  <option value="openlitespeed">OpenLiteSpeed (Recommended - LSCache, fastest for PHP)</option>
                  <option value="nginx">Nginx (Industry standard, strong reverse proxy)</option>
                  <option value="caddy">Caddy (Automatic HTTPS & modern HTTP/3)</option>
                  <option value="apache">Apache 2.4 (Best .htaccess compatibility)</option>
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
                    Interface Language
                  </label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value="id">Indonesian</option>
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
                    Automatically downloads security patches and cgroup kernel updates at 03:00 WIB.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* MONITORING & TELEMETRY RETENTION SETTINGS */}
              <div>
                <h2 className="text-base font-bold text-slate-900">Panel &amp; SSH ports</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  The two ways in, and the two you can move from here. The engines' ports are not here
                  because the panel cannot move them: the engines are read on the Ports page instead,
                  measured, so an engine on another port shows where it really is.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1.5">
                  <span className="block text-xs font-bold text-slate-700">SSH</span>
                  <span className="block font-mono text-sm text-slate-900">
                    {(ports?.sshPorts?.length ? ports.sshPorts : ports?.ssh ? [ports.ssh] : []).join(', ') || '—'}
                  </span>
                  <span className="block text-[10px] text-slate-400">a way in, so it is shown</span>
                  {isAdmin && (
                    <div className="flex gap-1.5 pt-1">
                      <input
                        value={sshPortDraft}
                        onChange={(e) => setSshPortDraft(e.target.value)}
                        placeholder="2222"
                        className="w-20 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => void changeSSHPort(Number(sshPortDraft), false)}
                        disabled={portBusy || !sshPortDraft}
                        className="px-2 py-1 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => void changeSSHPort(Number(sshPortDraft), true)}
                        disabled={portBusy || !sshPortDraft}
                        className="px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-1.5">
                  <span className="block text-xs font-bold text-slate-700">Panel (HTTPS)</span>
                  <span className="block font-mono text-sm text-slate-900">{ports?.panel || '—'}</span>
                  <span className="block text-[10px] text-slate-400">as the daemon was started</span>
                  {isAdmin && (
                    <div className="flex gap-1.5 pt-1">
                      <input
                        value={panelPortDraft}
                        onChange={(e) => setPanelPortDraft(e.target.value)}
                        placeholder={ports?.panel ? String(ports.panel) : '8443'}
                        className="w-20 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => void changePanelPort()}
                        disabled={portBusy || !panelPortDraft}
                        className="px-2 py-1 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg"
                      >
                        Move panel
                      </button>
                    </div>
                  )}
                </div>
              </div>

          {activeTab === 'monitoring' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Monitoring & Telemetry Retention Policy
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  How long historical CPU, RAM, network, disk I/O, and S.M.A.R.T. metrics are kept in the time-series database.
                </p>
              </div>

              {/* CARD 1: SERVER METRICS RETENTION (LONG-TERM) */}
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Server Metrics Retention (Global Host)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Bare-metal / VPS hardware metrics (per-core CPU, RAM, S.M.A.R.T. disk, NIC bandwidth)
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 text-blue-800 font-mono">
                    {serverMetricsRetentionDays} Days
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Server Metrics Retention Duration
                    </label>
                    <select
                      value={serverMetricsRetentionDays}
                      onChange={(e) => setServerMetricsRetentionDays(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-blue-500"
                    >
                      <option value={7}>7 Days (1 week - minimal storage)</option>
                      <option value={14}>14 Days (2 weeks)</option>
                      <option value={30}>30 Days (1 month)</option>
                      <option value={60}>60 Days (2 months)</option>
                      <option value={90}>90 Days (3 months - recommended)</option>
                      <option value={180}>180 Days (6 months - semi-annual audit)</option>
                      <option value={365}>365 Days (1 year - long-term capacity)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Server metrics older than this limit are pruned automatically by the daemon.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Sampling Interval (Probe Frequency)
                    </label>
                    <select
                      value={metricsSampleIntervalSecs}
                      onChange={(e) => setMetricsSampleIntervalSecs(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-medium focus:bg-white focus:border-blue-500"
                    >
                      <option value={5}>Every 5 Seconds (high resolution / realtime)</option>
                      <option value={15}>Every 15 Seconds (recommended)</option>
                      <option value={60}>Every 60 Seconds (low disk I/O)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      How often metrics are written to the time-series disk buffer.
                    </p>
                  </div>
                </div>

                {/* Storage estimation banner */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-[11px] font-bold text-slate-700">Estimated TSDB Disk Usage:</span>
                    <p className="text-[11px] text-slate-500 font-mono">
                      ~{(serverMetricsRetentionDays * (metricsSampleIntervalSecs === 5 ? 14 : metricsSampleIntervalSecs === 15 ? 5.2 : 1.4)).toFixed(0)} MB 
                      (Engine: SQLite-WAL compressed TSDB in /var/lib/barepod/metrics)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePruneOldMetrics}
                    disabled={isPruning}
                    className="px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                    <span>{isPruning ? 'Cleaning...' : 'Prune Old Metrics Now'}</span>
                  </button>
                </div>
              </div>

              {/* CARD 2: APP MONITORING POLICY ENFORCEMENT (MAX 30 DAYS) */}
              <div className="p-5 rounded-2xl border border-purple-200/90 bg-purple-50/20 shadow-2xs space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        App Metrics Retention Limit (Tenant Web Apps)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Per-app storage isolation policy (Laravel, Node.js, Python, reverse proxy)
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-purple-100 text-purple-800 font-mono">
                    Max 30 Days
                  </span>
                </div>

                <div className="p-3 bg-white rounded-xl border border-purple-200 text-xs space-y-2 text-slate-700">
                  <div className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-purple-900">Panel Policy: Maximum App Retention = 30 Days</strong>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Website-level monitoring is capped at <strong>30 days</strong> to avoid disk exhaustion in tenant home partitions (<code className="font-mono text-purple-800">/home/[user]/apps/</code>).
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Default Retention for New Website Metrics
                    </label>
                    <select
                      value={appDefaultRetentionDays}
                      onChange={(e) => setAppDefaultRetentionDays(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-medium focus:border-purple-500"
                    >
                      <option value={7}>7 Days (1 week)</option>
                      <option value={14}>14 Days (2 weeks)</option>
                      <option value={30}>30 Days (panel maximum)</option>
                    </select>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Website owners can adjust this up to 30 days on the App Detail page.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Cron Auto-Cleanup Schedule
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={autoPruneSchedule}
                        onChange={(e) => setAutoPruneSchedule(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-mono text-slate-800"
                        placeholder="0 3 * * *"
                      />
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-1.5 rounded-lg whitespace-nowrap">
                        03:00 AM Daily
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      An automatic cron job prunes expired metrics without interrupting web traffic.
                    </p>
                  </div>
                </div>
              </div>

              {/* SAVE BUTTON */}
              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={isSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-500/25 transition-all flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Retention Policy</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. SECURITY & AUTH */}
          {activeTab === 'security' && (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h2 className="text-base font-bold text-slate-900">Security & Access Control</h2>
                <p className="text-xs text-slate-500 mt-0.5">Panel authentication policy, brute-force protection, and IP restrictions.</p>
              </div>

              {/* Real, unlike the rest of this screen: the daemon's brute-force lockout, which the
                  panel already enforces in the host's firewall. It lives here, in the Security tab,
                  and not above the tab container — mounted there it appeared in every tab. */}
              <GuardCard onShowToast={onShowToast} canEdit={isAdmin} />

              {/* Real, and the reason it is here: the lockout closes the door it earned — the panel's
                  port for a panel ban, SSH's for an SSH ban — and this is the list of places it must
                  never close at all. The operator's own address lands here by signing in. */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <label className="block">
                  <span className="text-xs font-bold text-slate-800">Never ban these addresses</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    One address or network per line, e.g. <code>172.19.1.100</code> or <code>10.8.0.0/24</code>.
                    Where you sign in from is added here automatically, which is what keeps a lockout from
                    taking away the way back in. Leaving it empty exempts nobody. This exempts from bans —
                    it does not restrict who may open the panel. A restriction of that kind would be a
                    different feature, and this panel does not have one yet.
                  </p>
                </label>
                <textarea
                  rows={3}
                  value={trustedDraft}
                  onChange={(e) => setTrustedDraft(e.target.value)}
                  disabled={!isAdmin}
                  placeholder={'172.19.1.100\n10.8.0.0/24'}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500 disabled:opacity-60"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    {trustedDraft.trim() === '' ? 'Nothing is exempt right now.' : 'These are exempt from every ban.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void saveTrusted()}
                    disabled={!isAdmin || trustedSaving}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors"
                  >
                    {trustedSaving ? 'Saving…' : 'Save list'}
                  </button>
                </div>
                {!isAdmin && (
                  <p className="text-[11px] text-slate-500">Only an administrator can change this list.</p>
                )}
              </div>

              {/* Everything from here to the end of this tab is the prototype's, and none of it is
                  applied by the daemon. Saying so once, above the group, is what keeps a screen from
                  promising protections nobody has. The Brute-Force Guard above is the part that is
                  real — and it is enforced in the host's firewall. */}
              <div className="p-3 rounded-xl border border-amber-200 bg-amber-50">
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  <strong>Prototype controls.</strong> The settings below are not applied by the daemon:
                  they neither restrict access nor change its behaviour. The panel's real protections on
                  this screen are the Brute-Force Guard above and the host's firewall.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Two-Factor Authentication (2FA TOTP)</h3>
                    <p className="text-[11px] text-slate-500">Require Google Authenticator / Authy for admin account logins.</p>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="Two-factor authentication is not implemented — this control does nothing yet."
                    className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-200 text-slate-500 cursor-not-allowed"
                  >
                    Not available yet
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Admin Session Lifetime (not applied)
                  </label>
                  <select
                    value={sessionTimeoutHours}
                    onChange={(e) => setSessionTimeoutHours(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value={12}>12 Hours</option>
                    <option value={24}>24 Hours (1 day)</option>
                    <option value={72}>3 Days</option>
                    <option value={168}>7 Days</option>
                  </select>
                </div>
              </div>


              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  IP Whitelist for Admin Panel Access (not implemented)
                </label>
                <textarea
                  rows={3}
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder="Example: 192.168.1.100&#10;103.45.12.0/24&#10;(Leave empty to allow all IPs)"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                />
                <p className="text-[10px] text-rose-600 font-semibold mt-1">
                  Not enforced: nothing in the daemon reads this, so it does not restrict who may open the
                  panel. Do not rely on it — the host's firewall and the panel's own lockout are the real
                  controls. The never-ban list under the lockout is a different thing: it exempts from
                  bans, it does not restrict access.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">Panel secret key (sessions — this panel does not use JWTs)</span>
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
                  value="kept in /etc/barepod/secret.key (0600) — never shown in the panel"
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
                <p className="text-xs text-slate-500 mt-0.5">Public ingress ports, HTTP/3, Let's Encrypt email, and Cloudflare IP restore.</p>
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
                  Used for automatic SSL/TLS certificate renewal notices.
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
                    <p className="text-[11px] text-slate-500">Speeds up mobile connections with 0-RTT handshakes.</p>
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
                    <p className="text-[11px] text-slate-500">Automatic dynamic compression for CSS, JS, HTML, and SVG files.</p>
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
                      Restores real visitor IPs in Nginx/OLS logs when the Cloudflare CDN proxy is used.
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
                  <p className="text-xs text-slate-500 mt-0.5">Back up all websites, databases, and panel configuration.</p>
                </div>
                <button
                  type="button"
                  onClick={handleTestBackup}
                  disabled={isBackingUp}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors shadow-2xs"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                  <span>{isBackingUp ? 'Processing Snapshot...' : 'Create Snapshot Now'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Automatic Backup Schedule
                  </label>
                  <select
                    value={backupSchedule}
                    onChange={(e) => setBackupSchedule(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-semibold"
                  >
                    <option value="daily">Daily (02:00 WIB)</option>
                    <option value="weekly">Weekly</option>
                    <option value="disabled">Disable Automatic</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Backup Retention Period
                  </label>
                  <select
                    value={backupRetentionDays}
                    onChange={(e) => setBackupRetentionDays(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                  >
                    <option value={7}>Keep Last 7 Days</option>
                    <option value={14}>Keep Last 14 Days</option>
                    <option value={30}>Keep Last 30 Days</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Target Storage (Destination)
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
                      {dest === 'local' && 'Local VPS Disk'}
                      {dest === 's3' && 'AWS S3 Compatible'}
                      {dest === 'r2' && 'Cloudflare R2'}
                    </button>
                  ))}
                </div>
              </div>

              {backupStorageType === 'local' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Local Host Backup Directory
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

          {/* 5. SYSTEM & DOCKER CLEANUP */}
          {activeTab === 'maintenance' && (
            <div className="space-y-6 max-w-3xl">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">System & Docker Cleanup</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Reclaim disk space by pruning junk files and unused Docker resources. Last run: <strong className="text-slate-600">{lastCleanup}</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunCleanupNow}
                  disabled={isPruningSystem}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg border border-purple-200 transition-colors shadow-2xs shrink-0"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isPruningSystem ? 'animate-spin' : ''}`} />
                  <span>{isPruningSystem ? 'Cleaning...' : 'Run Cleanup Now'}</span>
                </button>
              </div>

              {/* Prune sources */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pruneSystemJunk}
                      onChange={(e) => setPruneSystemJunk(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 border-slate-300"
                    />
                    <div>
                      <span className="text-sm font-bold text-slate-900 block">System junk</span>
                      <span className="text-xs text-slate-500">Rotated logs, /tmp, orphan build artifacts, expired snapshots.</span>
                    </div>
                  </label>
                  {pruneSystemJunk && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Keep files newer than</label>
                      <select
                        value={systemJunkRetentionDays}
                        onChange={(e) => setSystemJunkRetentionDays(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                      >
                        <option value={1}>1 Day</option>
                        <option value={3}>3 Days</option>
                        <option value={7}>7 Days</option>
                        <option value={30}>30 Days</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={pruneDocker}
                      onChange={(e) => setPruneDocker(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 border-slate-300"
                    />
                    <div>
                      <span className="text-sm font-bold text-slate-900 block">Docker resources</span>
                      <span className="text-xs text-slate-500">Equivalent to <code className="font-mono">docker system prune</code>.</span>
                    </div>
                  </label>
                  {pruneDocker && (
                    <>
                      <div className="grid grid-cols-1 gap-2 text-xs">
                        {[
                          { label: 'Dangling images', checked: dockerPruneDanglingImages, set: setDockerPruneDanglingImages },
                          { label: 'Stopped containers', checked: dockerPruneStoppedContainers, set: setDockerPruneStoppedContainers },
                          { label: 'Unused volumes', checked: dockerPruneUnusedVolumes, set: setDockerPruneUnusedVolumes },
                          { label: 'Build cache', checked: dockerPruneBuildCache, set: setDockerPruneBuildCache },
                        ].map((opt) => (
                          <label key={opt.label} className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50/60 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={opt.checked}
                              onChange={(e) => opt.set(e.target.checked)}
                              className="w-4 h-4 rounded text-blue-600 border-slate-300"
                            />
                            <span className="text-slate-700">{opt.label}</span>
                          </label>
                        ))}
                      </div>
                      {dockerPruneUnusedVolumes && (
                        <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
                          Unused volumes can hold persistent data (e.g. a stopped pod's database or uploaded files). Pruned volumes cannot be recovered.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Scheduler */}
              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-4">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-sm font-bold text-slate-900 block">Automatic Cleanup</span>
                    <span className="text-xs text-slate-500">Run the prune sources above on a schedule.</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCleanupEnabled}
                    onChange={(e) => setAutoCleanupEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-purple-600 border-slate-300"
                  />
                </label>
                {autoCleanupEnabled && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Cron Schedule</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={cleanupCron}
                        onChange={(e) => setCleanupCron(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono"
                      />
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-1.5 rounded-lg whitespace-nowrap">04:00 AM Daily</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Recommended default maintenance jobs */}
              <div className="rounded-2xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900">Recommended Default Cron Jobs</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Enabled by default to keep the host healthy. Toggle any job off if unneeded.</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {cronJobs.map((job) => (
                    <div key={job.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-800 block">{job.label}</span>
                        <span className="text-[11px] text-slate-500 block">{job.desc}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <code className={`text-[10px] px-2 py-1 rounded font-mono ${job.enabled ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-400'}`}>
                          {job.schedule}
                        </code>
                        <button
                          type="button"
                          onClick={() => toggleCronJob(job.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors cursor-pointer ${
                            job.enabled ? 'bg-blue-600' : 'bg-slate-200'
                          }`}
                          title={job.enabled ? 'Disable job' : 'Enable job'}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${job.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={isSaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-500/25 transition-all flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Cleanup Policy</span>
                </button>
              </div>
            </div>
          )}

          {/* 6. NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="space-y-6 max-w-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Notifications & Alert Channels</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Get instant alerts when CPU &gt; 90%, disks fill up, or brute-force attacks occur.</p>
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
                    <Send className="w-5 h-5 text-blue-600" />
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
                  <h3 className="text-xs font-bold text-slate-900">SMTP Server for Email Notifications</h3>
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
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Web GUI SSO Session Lifetime (phpMyAdmin / DbGate) — not applied yet
                </label>
                <select
                  value={ssoSessionMinutes}
                  onChange={(e) => setSsoSessionMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                >
                  <option value={60}>60 Minutes (1 hour)</option>
                  <option value={120}>120 Minutes (2 hours)</option>
                  <option value={360}>360 Minutes (6 hours)</option>
                </select>
                <p className="text-[10px] text-rose-600 font-semibold mt-1">
                  Not applied: the daemon closes an idle database manager on its own timer, and nothing
                  reads this choice yet. It is here as the plan it is.
                </p>
              </div>
            </div>
          )}

          {/* 7. PHP RUNTIMES & EXTENSIONS BLUEPRINT */}
          {activeTab === 'php_defaults' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">PHP Stack & Global Extension Blueprint</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                    Admin Defaults for All New Apps
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Set the default extensions and resource limits applied when a user creates a new PHP app.
                </p>
              </div>

              {/* Default PHP Parameters */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-4 shadow-2xs">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Default php.ini Directive Limits
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Default PHP Version</label>
                    <select
                      value={defaultPhpVersion}
                      onChange={(e) => setDefaultPhpVersion(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    >
                      <option value="8.4">PHP 8.4 (Recommended)</option>
                      <option value="8.3">PHP 8.3 LTS</option>
                      <option value="8.2">PHP 8.2</option>
                      <option value="8.1">PHP 8.1</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">memory_limit</label>
                    <input
                      type="text"
                      value={defaultMemoryLimit}
                      onChange={(e) => setDefaultMemoryLimit(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">upload_max_filesize</label>
                    <input
                      type="text"
                      value={defaultUploadMaxSize}
                      onChange={(e) => setDefaultUploadMaxSize(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">max_execution_time</label>
                    <input
                      type="text"
                      value={defaultMaxExecutionTime}
                      onChange={(e) => setDefaultMaxExecutionTime(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Master PHP & PECL Extensions Checklist */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Master Extension Catalog ({globalPhpExtensions.filter(e => e.enabled).length} Enabled by Default / {globalPhpExtensions.length} Available)
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Toggle extensions to activate automatically when a user deploys a new PHP app.
                    </p>
                  </div>

                  {/* Filter & Search */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Search extensions..."
                      value={extSearchAdmin}
                      onChange={(e) => setExtSearchAdmin(e.target.value)}
                      className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg w-40"
                    />
                    <select
                      value={extCatAdmin}
                      onChange={(e) => setExtCatAdmin(e.target.value)}
                      className="px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg capitalize"
                    >
                      {['all', 'database', 'cache', 'core', 'media', 'rpc', 'security'].map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Extensions Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {globalPhpExtensions
                    .filter(ext => {
                      const matchCat = extCatAdmin === 'all' || ext.category === extCatAdmin;
                      const matchSearch = ext.name.toLowerCase().includes(extSearchAdmin.toLowerCase()) ||
                                          ext.description.toLowerCase().includes(extSearchAdmin.toLowerCase());
                      return matchCat && matchSearch;
                    })
                    .map((ext) => (
                      <div
                        key={ext.name}
                        onClick={() => {
                          setGlobalPhpExtensions(prev => prev.map(e => e.name === ext.name ? { ...e, enabled: !e.enabled } : e));
                        }}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all select-none ${
                          ext.enabled
                            ? 'bg-white border-purple-300 ring-1 ring-purple-400/20 shadow-2xs'
                            : 'bg-slate-50 border-slate-200 opacity-60 hover:opacity-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-slate-900">{ext.name}</span>
                              {ext.isPecl && (
                                <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-purple-100 text-purple-700">
                                  PECL
                                </span>
                              )}
                              <span className="text-[9px] uppercase font-semibold px-1 py-0.2 rounded bg-slate-100 text-slate-500">
                                {ext.category}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                              {ext.description}
                            </p>
                          </div>

                          <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                            ext.enabled ? 'bg-purple-600 border-purple-600 text-white' : 'border-slate-300 bg-white'
                          }`}>
                            {ext.enabled && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
