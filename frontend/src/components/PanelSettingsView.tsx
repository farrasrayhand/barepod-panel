import { api, type CloudflareZone, type PanelTunnelStatus, type PhpDefaultsConfig } from '../api/client';
import React, { useEffect, useState } from 'react';
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
  Trash2,
  Loader2,
  Sparkles,
  ArrowUpCircle,
  ExternalLink,
  Download
} from 'lucide-react';
import type { WebServerType } from '../types';
import { useSubRoute } from '../hooks/useSubRoute';
import { describeError } from '../utils/format';
import { PhpExtensionsPanel } from './PhpExtensionsPanel';
import { CronJobsManager } from './CronJobsManager';

interface PanelSettingsViewProps {
  /** False hides controls a signed-in user may look at but not change — the daemon refuses them
   * anyway, and a form that cannot be saved is worse than no form. */
  isAdmin?: boolean;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

const isPortNumber = (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;

export const PanelSettingsView: React.FC<PanelSettingsViewProps> = ({
  isAdmin = false,
  onShowToast,
  onOpenTerminal,
}) => {
  const [activeTab, setActiveTab] = useSubRoute<'general' | 'updates' | 'cron' | 'monitoring' | 'security' | 'proxy' | 'backups' | 'notifications' | 'php_defaults' | 'maintenance'>('general');
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
  // The panel's own public hostname: readable by anyone signed in, published by an admin through
  // their Cloudflare Tunnel. Declared here because the settings fetch above loads it.
  const [panelFqdn, setPanelFqdn] = useState('');
  // Which address the panel is reached on: the public IP by default, the Cloudflare hostname once
  // "Use Cloudflare" is ticked. The server stores it so the choice survives a reload.
  const [useCloudflare, setUseCloudflare] = useState(false);
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

  // In-Panel Self-Update (OTA)
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string;
    latestVersion: string;
    hasUpdate: boolean;
    release?: {
      tag: string;
      version: string;
      publishedAt: string;
      releaseNotesUrl: string;
      changelogMarkdown: string;
      asset?: {
        arch: string;
        sha256: string;
        sizeBytes: number;
        filename: string;
      };
    };
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<Array<{ step: string; message: string; pct: number }>>([]);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  const checkUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const res = await api.checkUpdates();
      setUpdateInfo(res);
      if (res.hasUpdate) {
        onShowToast?.('Update available', `BarePod Panel ${res.release?.tag || res.latestVersion} is ready to install.`, 'info');
      } else {
        onShowToast?.('Up to date', `BarePod Panel is on the latest version (${res.currentVersion}).`, 'success');
      }
    } catch (err) {
      onShowToast?.('Check failed', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const startPanelUpdate = async () => {
    if (!updateInfo?.latestVersion || isUpdating) return;
    setIsUpdating(true);
    setUpdateModalOpen(true);
    setUpdateError(null);
    setUpdateSuccess(false);
    setUpdateLogs([{ step: 'init', message: 'Initiating in-panel update pipeline...', pct: 5 }]);

    try {
      const { jobId, streamUrl } = await api.applyUpdate(updateInfo.latestVersion);
      const evSource = new EventSource(streamUrl || api.updatesStreamUrl(jobId), { withCredentials: true });

      evSource.addEventListener('step', (e) => {
        try {
          const payload = JSON.parse(e.data);
          setUpdateLogs((prev) => [...prev, { step: payload.step, message: payload.message, pct: payload.progressPercent || 50 }]);
        } catch {}
      });

      evSource.addEventListener('done', (e) => {
        evSource.close();
        try {
          const payload = JSON.parse(e.data);
          if (payload.status === 'failed') {
            setUpdateError(payload.error || payload.message || 'Update failed');
            setIsUpdating(false);
          } else {
            setUpdateSuccess(true);
            setUpdateLogs((prev) => [...prev, { step: 'complete', message: 'Update completed! Reloading dashboard in 3 seconds...', pct: 100 }]);
            setTimeout(() => {
              window.location.reload();
            }, 3000);
          }
        } catch {
          setIsUpdating(false);
        }
      });

      evSource.onerror = () => {
        evSource.close();
        // Server restart will drop the SSE stream — this usually means success and restarting!
        setUpdateLogs((prev) => [...prev, { step: 'restart', message: 'Daemon restarted. Waiting for panel to answer...', pct: 95 }]);
        setTimeout(() => {
          window.location.reload();
        }, 4000);
      };
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Failed to trigger update');
      setIsUpdating(false);
    }
  };

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

  // One action, the way the panel's own port works. The new port is added and sshd is asked whether it
  // accepts it before anything is taken away, and only then are the old ones removed. Every failure
  // leaves the host with more access rather than less, so this cannot lock you out — and it must not
  // touch the panel's field: it did, because the refresh re-seeded a draft the operator was not editing.
  const changeSSHPort = async (port: number) => {
    if (portBusy || !isPortNumber(String(port))) return;
    setPortBusy(true);
    try {
      const current = ports?.sshPorts?.length ? ports.sshPorts : ports?.ssh ? [ports.ssh] : [];
      const stale = current.filter((existing) => existing !== port);
      const answer = await api.setSSHPort(port, false);
      let note = answer.note;
      for (const old of stale) {
        const removed = await api.setSSHPort(old, true);
        note = removed.note;
      }
      onShowToast?.('SSH port changed', note, 'success');
      setPorts(await api.systemPorts());
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
          setPanelFqdn(settings.panelFqdn || '');
          setUseCloudflare(Boolean(settings.useCloudflare));
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

  // Global PHP Extensions Blueprint & Tuning Settings
  const [phpConfig, setPhpConfig] = useState<PhpDefaultsConfig>({
    memoryLimit: '256M',
    uploadMaxSize: '64M',
    postMaxSize: '64M',
    maxExecutionTime: 60,
    maxInputTime: 60,
    maxInputVars: 3000,
    opcacheEnable: true,
    opcacheMemoryConsumption: 128,
    opcacheMaxAcceleratedFiles: 10000,
    opcacheValidateTimestamps: true,
    opcacheRevalidateFreq: 2,
    recommendedExtensions: [
      'curl', 'mbstring', 'openssl', 'pdo_mysql', 'pdo_pgsql', 'gd', 'zip', 'intl', 'bcmath', 'redis', 'opcache',
    ],
  });
  const [installedPhpVersions, setInstalledPhpVersions] = useState<string[]>([]);
  const [selectedInspectVersion, setSelectedInspectVersion] = useState<string>('');
  const [isLoadingPhpDefaults, setIsLoadingPhpDefaults] = useState(false);
  const [isSavingPhpDefaults, setIsSavingPhpDefaults] = useState(false);

  const loadPhpDefaults = async () => {
    setIsLoadingPhpDefaults(true);
    try {
      const res = await api.phpDefaults();
      if (res?.config) {
        setPhpConfig(res.config);
      }
      if (res?.installedVersions?.length) {
        setInstalledPhpVersions(res.installedVersions);
        setSelectedInspectVersion((prev) => (prev && res.installedVersions.includes(prev) ? prev : res.installedVersions[0]));
      }
    } catch (err) {
      console.error('Failed to load php defaults:', err);
    } finally {
      setIsLoadingPhpDefaults(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'php_defaults') {
      void loadPhpDefaults();
    }
  }, [activeTab]);

  const handleSavePhpDefaults = async (applyToHost: boolean) => {
    setIsSavingPhpDefaults(true);
    try {
      await api.savePhpDefaults(phpConfig, applyToHost);
      onShowToast?.(
        applyToHost ? 'Blueprint Applied to All Versions' : 'Blueprint Preset Saved',
        applyToHost
          ? 'Saved preset and generated 99-barepod-tuning.ini across all installed PHP versions on host.'
          : 'Global PHP tuning preset saved to panel store.',
        'success'
      );
    } catch (err) {
      onShowToast?.('Failed to save PHP defaults', describeError(err), 'error');
    } finally {
      setIsSavingPhpDefaults(false);
    }
  };

  // Monitoring & Telemetry Retention Settings
  const [serverMetricsRetentionDays, setServerMetricsRetentionDays] = useState(90);
  const [metricsSampleIntervalSecs, setMetricsSampleIntervalSecs] = useState(15);
  const [enableSmartHourlySnapshot, setEnableSmartHourlySnapshot] = useState(true);
  const [appDefaultRetentionDays, setAppDefaultRetentionDays] = useState(30); // Max 30 days
  const [autoPruneSchedule, setAutoPruneSchedule] = useState('0 3 * * *');
  const [isPruning, setIsPruning] = useState(false);

  // 1. General Settings
  const [panelPort, setPanelPort] = useState(8443);
  // The panel's own hostname as detected from the admin's Cloudflare account: whether publishing is
  // possible, and the zones (domains) to pick from.
  const [panelTunnel, setPanelTunnel] = useState<PanelTunnelStatus | null>(null);
  const [panelZones, setPanelZones] = useState<CloudflareZone[]>([]);
  const [panelZone, setPanelZone] = useState('');
  const [panelSubdomain, setPanelSubdomain] = useState('panel');
  const [panelPublishing, setPanelPublishing] = useState(false);
  const [defaultWebServer, setDefaultWebServer] = useState<WebServerType>('openlitespeed');
  const [timezone, setTimezone] = useState('Asia/Jakarta');
  const [language, setLanguage] = useState('id');
  const [autoUpdate, setAutoUpdate] = useState(true);

  // Detection for the panel's own domain. Admin only: the panel may only ever be published through
  // the administrator's Cloudflare account, so the zone picker is filled from that account.
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void (async () => {
      try {
        const status = await api.panelTunnelStatus();
        if (!alive) return;
        setPanelTunnel(status);
        setPanelFqdn(status.fqdn || '');
        if (status.configured) {
          const res = await api.tunnelZones();
          if (alive && res.zones && Array.isArray(res.zones)) {
            setPanelZones(res.zones);
            if (res.zones.length > 0) setPanelZone(res.zones[0].name);
          }
        }
      } catch {
        // Not an admin, or the daemon refused: the field stays a plain text input.
      }
    })();
    return () => { alive = false; };
  }, [isAdmin]);

  // The hostname the publish button sends: the picked zone with the subdomain in front of it.
  const computedPanelFqdn = panelZone && panelZone !== 'custom'
    ? (panelSubdomain.trim() ? `${panelSubdomain.trim().toLowerCase()}.${panelZone}` : panelZone)
    : panelFqdn.trim().toLowerCase();

  const publishPanel = async () => {
    const hostname = computedPanelFqdn;
    if (!hostname || panelPublishing) return;
    setPanelPublishing(true);
    try {
      const status = await api.publishPanelTunnel(hostname);
      setPanelTunnel(status);
      setPanelFqdn(status.fqdn);
      setUseCloudflare(true);
      onShowToast?.('Panel published', `Reachable at https://${status.fqdn} through Cloudflare.`, 'success');
    } catch (err) {
      onShowToast?.('Publish failed', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setPanelPublishing(false);
    }
  };

  const unpublishPanel = async () => {
    if (panelPublishing) return;
    setPanelPublishing(true);
    try {
      const status = await api.unpublishPanelTunnel();
      setPanelTunnel(status);
      setPanelFqdn('');
      setUseCloudflare(false);
      onShowToast?.('Panel unpublished', 'The Cloudflare hostname was removed.', 'info');
    } catch (err) {
      onShowToast?.('Unpublish failed', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setPanelPublishing(false);
    }
  };

  // Ticking "Use Cloudflare" switches the panel's address to the tunnel hostname; unticking it takes
  // the hostname out of Cloudflare and falls back to the public address.
  const toggleCloudflare = async (next: boolean) => {
    if (panelPublishing) return;
    setUseCloudflare(next);
    try {
      if (!next && panelTunnel?.fqdn) {
        const status = await api.unpublishPanelTunnel();
        setPanelTunnel(status);
        setPanelFqdn('');
      } else {
        await api.savePanelSettings({ useCloudflare: next });
      }
      onShowToast?.(
        next ? 'Cloudflare enabled' : 'Cloudflare disabled',
        next
          ? 'Pick a domain below, then publish. The panel keeps answering on its IP too.'
          : 'The panel is reached at its public address.',
        'info',
      );
    } catch (err) {
      setUseCloudflare(!next);
      onShowToast?.('Could not change', err instanceof Error ? err.message : 'unknown error', 'error');
    }
  };

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

      {/* Main Container with Top Navigation Tabs */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        
        {/* Settings Navigation Tabs Header */}
        <div className="border-b border-slate-200 bg-slate-50/70 px-4 pt-2 flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'general', label: 'General & Defaults', icon: Settings },
            { id: 'updates', label: 'System & Updates', icon: ArrowUpCircle },
            { id: 'cron', label: 'Cron & Scheduled Tasks', icon: Clock },
            { id: 'monitoring', label: 'Monitoring Policy', icon: Activity },
            { id: 'security', label: 'Security & Auth', icon: ShieldCheck },
            { id: 'proxy', label: 'Reverse Proxy & SSL', icon: Globe },
            { id: 'backups', label: 'Backup Policy', icon: HardDrive },
            { id: 'notifications', label: 'Alerts & Webhooks', icon: Bell },
            { id: 'php_defaults', label: 'PHP Tuning & Exts', icon: Cpu },
            { id: 'maintenance', label: 'System & Cleanup', icon: Trash2 },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-3 px-3.5 border-b-2 flex items-center gap-2 text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'border-blue-600 text-blue-700 font-bold bg-white -mb-px rounded-t-lg border-t border-x border-slate-200 shadow-2xs'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/60 rounded-t-lg'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Form */}
        <div className="p-6 md:p-8">
          
          {/* 1. GENERAL SETTINGS */}
          {activeTab === 'general' && (
            <div className="space-y-6 w-full">
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

              <div className="space-y-4">

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      Panel FQDN Domain
                    </label>
                    {isAdmin && panelTunnel?.configured && (
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={useCloudflare}
                          onChange={(e) => void toggleCloudflare(e.target.checked)}
                          className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300"
                        />
                        Use Cloudflare
                      </label>
                    )}
                  </div>

                  {isAdmin && useCloudflare && panelTunnel?.configured ? (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          value={panelSubdomain}
                          onChange={(e) => setPanelSubdomain(e.target.value)}
                          placeholder="panel"
                          className="w-36 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                        />
                        {panelZones.length > 0 ? (
                          <select
                            value={panelZone}
                            onChange={(e) => setPanelZone(e.target.value)}
                            className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                          >
                            {panelZones.map((z) => (
                              <option key={z.id} value={z.name}>{z.name}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="flex-1 px-3 py-2 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg">
                            No zones found in this Cloudflare account
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void publishPanel()}
                          disabled={panelPublishing || !computedPanelFqdn}
                          className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors"
                        >
                          {panelPublishing ? 'Publishing…' : 'Publish via Cloudflare'}
                        </button>
                        {panelTunnel?.fqdn && (
                          <button
                            type="button"
                            onClick={() => void unpublishPanel()}
                            disabled={panelPublishing}
                            className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors"
                          >
                            Unpublish
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={panelFqdn}
                      disabled
                      placeholder="Using the public IP (no domain)"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono opacity-60"
                    />
                  )}

                  <p className="text-[10px] text-slate-400 mt-1">
                    {!isAdmin
                      ? 'Only an administrator can change this.'
                      : !panelTunnel?.configured
                        ? 'Cloudflare not configured yet. The panel is reached at its public address — add your API token on the Cloudflare Tunnel page to use a domain.'
                        : !useCloudflare
                          ? 'Reached at its public address. Tick “Use Cloudflare” to answer on a domain instead — the IP keeps working.'
                          : panelTunnel.fqdn
                            ? `Published via Cloudflare: https://${panelTunnel.fqdn}. The panel still answers on its IP.`
                            : `Pick a domain from the account and publish. Target: ${panelTunnel.service}.`}
                  </p>
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
                  <p className="text-[10px] text-slate-400 mt-1">The web server is a host-level choice now — set it on the <strong>Stack</strong> page (nginx or Caddy).</p>

              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Panel (HTTPS) port</label>
                  <div className="flex gap-2">
                    <input
                      value={panelPortDraft}
                      onChange={(e) => setPanelPortDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                      inputMode="numeric"
                      placeholder={ports?.panel ? String(ports.panel) : '8443'}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => void changePanelPort()}
                      disabled={portBusy || !isPortNumber(panelPortDraft)}
                      className="px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg shrink-0"
                    >
                      Change
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Now {ports?.panel || '-'}. Type a port to change it: digits only, 1024-65535, and you open the panel there.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">SSH port</label>
                  <div className="flex gap-2">
                    <input
                      value={sshPortDraft}
                      onChange={(e) => setSshPortDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                      inputMode="numeric"
                      placeholder="2222"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => void changeSSHPort(Number(sshPortDraft))}
                      disabled={portBusy || !isPortNumber(sshPortDraft)}
                      className="px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg shrink-0"
                    >
                      Change
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Now {(ports?.sshPorts?.length ? ports.sshPorts : ports?.ssh ? [ports.ssh] : []).join(', ') || '-'}. Changing it adds the
                    new port and asks sshd whether it accepts it, then removes the old one.
                  </p>
                </div>
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
                    <p className="text-[10px] text-slate-400 mt-1">Not applied: nothing reads this yet — this host runs WITA (UTC+8), not WIB.</p>
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
                    <p className="text-[10px] text-slate-400 mt-1">Not applied: nothing reads this yet.</p>
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
                    Not applied: the panel schedules no patches yet.
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* SYSTEM & IN-PANEL UPDATES */}
          {activeTab === 'updates' && (
            <div className="space-y-6 w-full">
              <div className="flex items-start justify-between flex-wrap gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-blue-600" />
                    System & In-Panel Updates (OTA)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Upgrade BarePod Panel daemon and frontend assets directly from official releases with zero tenant website downtime.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void checkUpdates()}
                  disabled={checkingUpdate || isUpdating}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                  {checkingUpdate ? 'Checking for updates…' : 'Check for Updates'}
                </button>
              </div>

              {/* Version & Status Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-slate-200 bg-white">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-1">Installed Version</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-mono font-bold text-slate-800">
                      {updateInfo?.currentVersion ? `v${updateInfo.currentVersion}` : 'Checking…'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                      Active
                    </span>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-white">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-1">Latest Release</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-mono font-bold text-slate-800">
                      {updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : 'Checking…'}
                    </span>
                    {updateInfo?.hasUpdate ? (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 text-blue-700 border border-blue-200 animate-pulse">
                        Update Available
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                        Up to date
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-white">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-1">Release Channel</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">Official GitHub Releases</span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-purple-50 text-purple-700 border border-purple-200">
                      Stable
                    </span>
                  </div>
                </div>
              </div>

              {/* Update Banner & Action */}
              {updateInfo?.hasUpdate && updateInfo.release && (
                <div className="p-5 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/70 to-indigo-50/60 shadow-2xs space-y-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
                        <h3 className="text-sm font-bold text-blue-950">
                          BarePod Panel {updateInfo.release.tag} is Ready to Install
                        </h3>
                      </div>
                      <p className="text-xs text-blue-700 mt-1">
                        Zero tenant website downtime guarantee. The daemon swaps binaries atomically and restarts in ~2s.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void startPanelUpdate()}
                      disabled={isUpdating || !isAdmin}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      {isUpdating ? 'Updating Panel…' : 'Install Update Now'}
                    </button>
                  </div>

                  {/* Release Notes Preview */}
                  {updateInfo.release.changelogMarkdown && (
                    <div className="p-4 rounded-xl bg-white/90 border border-blue-100 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 border-b border-slate-100 pb-2">
                        <span>Release Notes ({updateInfo.release.tag})</span>
                        {updateInfo.release.releaseNotesUrl && (
                          <a
                            href={updateInfo.release.releaseNotesUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1"
                          >
                            View on GitHub <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      <div className="text-xs text-slate-700 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                        {updateInfo.release.changelogMarkdown}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Safety & Architecture Notice */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Atomic Swap & Watchdog Auto-Rollback Guard
                </span>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  BarePod uses atomic directory replacement to avoid Linux <code>ETXTBSY</code> errors. Your panel database is snapshotted before binary extraction. If the updated daemon fails to pass health checks or schema migrations upon restart, the supervisor rolls back to <code>barepod.bak</code> automatically.
                </p>
              </div>

              {/* Live Update Progress Console Modal */}
              {updateModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
                  <div className="bg-white w-full max-w-lg rounded-2xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isUpdating && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                        {updateSuccess && <Check className="w-4 h-4 text-emerald-600" />}
                        {updateError && <AlertTriangle className="w-4 h-4 text-rose-600" />}
                        <h3 className="text-xs font-bold text-slate-900">
                          {isUpdating ? 'Applying Panel Update…' : updateSuccess ? 'Update Complete!' : 'Update Interrupted'}
                        </h3>
                      </div>
                      {!isUpdating && (
                        <button
                          type="button"
                          onClick={() => setUpdateModalOpen(false)}
                          className="text-slate-400 hover:text-slate-600 text-xs font-bold px-2 py-1 rounded"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="p-5 space-y-4">
                      {/* Log Stream Terminal */}
                      <div className="p-3.5 bg-slate-950 rounded-xl font-mono text-[11px] text-slate-300 space-y-1.5 max-h-56 overflow-y-auto">
                        {updateLogs.map((log, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <span className="text-slate-500 select-none">›</span>
                            <span className={log.step === 'complete' ? 'text-emerald-400 font-bold' : log.step === 'failed' ? 'text-rose-400 font-bold' : 'text-slate-200'}>
                              {log.message}
                            </span>
                          </div>
                        ))}
                        {isUpdating && (
                          <div className="flex items-center gap-2 text-blue-400 animate-pulse">
                            <span className="select-none">›</span>
                            <span>Working on pipeline...</span>
                          </div>
                        )}
                      </div>

                      {updateError && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                          <b>Error:</b> {updateError}
                        </div>
                      )}

                      {updateSuccess && (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
                          Panel updated successfully! Refreshing dashboard automatically...
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

          {/* CRON & SCHEDULED TASKS */}
          {activeTab === 'cron' && (
            <div className="p-6">
              <CronJobsManager onShowToast={onShowToast} />
            </div>
          )}

          {/* MONITORING & TELEMETRY RETENTION SETTINGS */}

          {activeTab === 'monitoring' && (
            <div className="space-y-6 w-full">
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
                        Website-level monitoring is capped at <strong>30 days</strong> to avoid disk exhaustion in tenant home partitions (<code className="font-mono text-purple-800">/home/[user]/web/</code>).
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
            <div className="space-y-6 w-full">
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
            <div className="space-y-6 w-full">
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
            <div className="space-y-6 w-full">
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
            <div className="space-y-6 w-full">
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
            <div className="space-y-6 w-full">
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


          {/* 7. PHP RUNTIMES & EXTENSIONS BLUEPRINT */}
          {activeTab === 'php_defaults' && (
            <div className="space-y-6 w-full">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-slate-900">PHP Tuning Blueprint & Extension Preset</h2>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">
                      Global Admin Preset
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
                    Set the default baseline tuning directives and recommended extension preset for all installed PHP versions on this host.
                    Newly created PHP apps inherit these values by default, and tenants can still freely override their own parameters via the Project Settings menu.
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleSavePhpDefaults(false)}
                    disabled={isSavingPhpDefaults || isLoadingPhpDefaults}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingPhpDefaults ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    <span>Save Preset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSavePhpDefaults(true)}
                    disabled={isSavingPhpDefaults || isLoadingPhpDefaults}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
                  >
                    {isSavingPhpDefaults ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    <span>Apply Tuning to All Versions</span>
                  </button>
                </div>
              </div>

              {/* Core php.ini Tuning Directive Limits */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-purple-600" />
                      Default php.ini Directive Limits
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Resource caps and memory bounds applied as the baseline template.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">memory_limit</label>
                    <input
                      type="text"
                      value={phpConfig.memoryLimit}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, memoryLimit: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="256M"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Baseline RAM per worker (e.g. 256M, 512M)</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">upload_max_filesize</label>
                    <input
                      type="text"
                      value={phpConfig.uploadMaxSize}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, uploadMaxSize: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="64M"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Maximum single file upload size</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">post_max_size</label>
                    <input
                      type="text"
                      value={phpConfig.postMaxSize}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, postMaxSize: e.target.value }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="64M"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Must be equal or greater than upload_max_filesize</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">max_execution_time (seconds)</label>
                    <input
                      type="number"
                      value={phpConfig.maxExecutionTime}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, maxExecutionTime: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="60"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Execution timeout (e.g. 60, 120, 300)</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">max_input_time (seconds)</label>
                    <input
                      type="number"
                      value={phpConfig.maxInputTime}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, maxInputTime: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="60"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Time allowed to parse POST / uploads</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">max_input_vars</label>
                    <input
                      type="number"
                      value={phpConfig.maxInputVars}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, maxInputVars: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                      placeholder="3000"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Max form inputs (3000 for WordPress / modern apps)</span>
                  </div>
                </div>
              </div>

              {/* OPcache Performance Tuning */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      OPcache Bytecode Accelerator Tuning
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      High-throughput bytecode caching directives applied across PHP runtimes.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs font-bold text-slate-700">OPcache Enabled</span>
                    <input
                      type="checkbox"
                      checked={phpConfig.opcacheEnable}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, opcacheEnable: e.target.checked }))}
                      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">opcache.memory_consumption (MB)</label>
                    <input
                      type="number"
                      value={phpConfig.opcacheMemoryConsumption}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, opcacheMemoryConsumption: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Shared memory allocation (128 - 512 MB)</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">opcache.max_accelerated_files</label>
                    <input
                      type="number"
                      value={phpConfig.opcacheMaxAcceleratedFiles}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, opcacheMaxAcceleratedFiles: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">File hash slots (10000 - 40000)</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">opcache.revalidate_freq (s)</label>
                    <input
                      type="number"
                      value={phpConfig.opcacheRevalidateFreq}
                      onChange={(e) => setPhpConfig((prev) => ({ ...prev, opcacheRevalidateFreq: Number(e.target.value) }))}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono font-semibold"
                    />
                    <span className="text-[10px] text-slate-400 mt-1 block">Revalidation check interval in seconds</span>
                  </div>

                  <div className="flex flex-col justify-center">
                    <label className="flex items-center gap-2 cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        checked={phpConfig.opcacheValidateTimestamps}
                        onChange={(e) => setPhpConfig((prev) => ({ ...prev, opcacheValidateTimestamps: e.target.checked }))}
                        className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
                      />
                      <span className="text-xs font-bold text-slate-700">validate_timestamps</span>
                    </label>
                    <span className="text-[10px] text-slate-400 mt-1">Check file changes on disk for updates</span>
                  </div>
                </div>
              </div>

              {/* Recommended Extensions Blueprint & Version Inspector */}
              <div className="p-5 rounded-xl border border-slate-200 bg-white space-y-4 shadow-2xs">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 flex-wrap gap-2">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-600" />
                      Installed Version Inspector & Extensions
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Inspect active extensions and modules across any installed PHP runtime on this host.
                    </p>
                  </div>

                  {installedPhpVersions.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-500 mr-1">Inspect Version:</span>
                      {installedPhpVersions.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSelectedInspectVersion(v)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                            selectedInspectVersion === v
                              ? 'bg-purple-600 text-white shadow-xs'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          PHP {v}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recommended Blueprint Chips */}
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-[11px] font-bold text-slate-700 block mb-1.5">
                    Recommended Core Extension Blueprint:
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {phpConfig.recommendedExtensions.map((ext) => (
                      <span
                        key={ext}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-white border border-slate-200 text-purple-700 shadow-2xs"
                      >
                        <Check className="w-3 h-3 text-emerald-600" />
                        {ext}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Real Live Extension Switcher for Selected PHP Version */}
                {selectedInspectVersion && (
                  <PhpExtensionsPanel
                    version={selectedInspectVersion}
                    title={`PHP ${selectedInspectVersion} Active Host Modules`}
                    onShowToast={onShowToast}
                  />
                )}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
