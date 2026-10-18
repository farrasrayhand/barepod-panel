import { api, type CloudflareZone, type NotificationConfig, type PanelTunnelStatus, type PhpDefaultsConfig } from '../api/client';
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
import { useSubRoute } from '../hooks/useSubRoute';
import { describeError } from '../utils/format';
import { PhpExtensionsPanel } from './PhpExtensionsPanel';
import { CronJobsManager } from './CronJobsManager';
import { isNewerVersion } from '../version';

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
  const [activeTab, setActiveTab] = useSubRoute<'general' | 'updates' | 'cron' | 'monitoring' | 'security' | 'proxy' | 'backups' | 'notifications' | 'php_defaults'>('general');
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
  const [panelFqdnSaving, setPanelFqdnSaving] = useState(false);
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
    isPatchBuild?: boolean;
    currentBinarySha?: string;
    remoteBinarySha?: string;
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

  const checkUpdates = async (silent = false) => {
    setCheckingUpdate(true);
    try {
      const res = await api.checkUpdates();
      const hasActualUpdate = res.hasUpdate && isNewerVersion(res.latestVersion, res.currentVersion);
      const normalized = { ...res, hasUpdate: hasActualUpdate };
      setUpdateInfo(normalized);
      if (!silent) {
        if (hasActualUpdate) {
          onShowToast?.('Update available', `BarePod Panel ${res.release?.tag || res.latestVersion} is ready to install.`, 'info');
        } else {
          onShowToast?.('Up to date', `BarePod Panel is on the latest version (${res.currentVersion}).`, 'success');
        }
      }
    } catch (err) {
      if (!silent) {
        onShowToast?.('Check failed', err instanceof Error ? err.message : 'unknown error', 'error');
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  // Automatically check updates when entering the updates tab or on initial load
  useEffect(() => {
    if (activeTab === 'updates' && !updateInfo && !checkingUpdate) {
      void checkUpdates(true);
    }
  }, [activeTab]);

  // After the swap the daemon restarts, so reloading on a timer lands on a port that is not
  // answering yet — an error page the operator has to refresh a second time. Poll the health
  // endpoint until the new process is serving, then reload exactly once.
  const reloadWhenDaemonIsBack = async (targetVersion: string, fromVersion: string) => {
    const target = (targetVersion || '').replace(/^v/, '');
    const from = (fromVersion || '').replace(/^v/, '');
    const versionChanges = target !== '' && target !== from;
    const deadline = Date.now() + 90_000;
    // The daemon sends "done", sleeps 1s and then restarts. Reloading before that lands on the old
    // process; waiting for a *failed* health check is unreliable when the restart is quick — which is
    // why a same-version reinstall could spin for the full 90 seconds. So: never reload before this
    // moment, then reload on the first successful health, and — when the version must change — only
    // once the new version answers.
    const notBefore = Date.now() + 2500;
    let sawRestart = false;
    for (;;) {
      try {
        const health = await api.health();
        const running = health.version.replace(/^v/, '');
        const versionReady = !versionChanges || !isNewerVersion(target, running);
        if (versionReady && (sawRestart || Date.now() >= notBefore)) break;
      } catch {
        sawRestart = true;
      }
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    window.location.reload();
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
            setIsUpdating(false);
            setUpdateSuccess(true);
            setUpdateLogs((prev) => [...prev, { step: 'complete', message: 'Update applied. Waiting for the daemon to come back…', pct: 100 }]);
            void reloadWhenDaemonIsBack(payload.newVersion || updateInfo.latestVersion, updateInfo.currentVersion);
          }
        } catch {
          setIsUpdating(false);
        }
      });

      evSource.onerror = () => {
        evSource.close();
        // The restart drops the SSE stream — this usually means the swap succeeded and the daemon
        // is coming back. Wait for it to answer instead of reloading into a port that is still down.
        setUpdateLogs((prev) => [...prev, { step: 'restart', message: 'Daemon restarting. Waiting for the panel to answer…', pct: 95 }]);
        void reloadWhenDaemonIsBack(updateInfo.latestVersion, updateInfo.currentVersion);
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
          setLetsEncryptEmail(settings.letsencryptEmail || '');
          setSessionTimeoutHours(settings.sessionTimeoutHours || 24);
          setIpWhitelist((settings.ipAllowlist || []).join('\n'));
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

  // The host's clock is not a panel setting: read it from the host and offer the host's own zones.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const clock = await api.systemTime();
        if (alive) {
          setTimezone(clock.timezone);
          setTimezoneZones(clock.zones || []);
        }
      } catch {
        // Left empty: the field then falls back to a plain text input.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const applyTimezone = async () => {
    if (timezoneSaving || !timezone.trim()) return;
    setTimezoneSaving(true);
    try {
      const res = await api.setSystemTimezone(timezone.trim());
      setTimezone(res.timezone);
      onShowToast?.(
        'Timezone applied',
        `The host now runs on ${res.timezone}.`,
        res.mode === 'dry-run' ? 'info' : 'success',
      );
    } catch (err) {
      onShowToast?.('Could not set the timezone', describeError(err), 'error');
    } finally {
      setTimezoneSaving(false);
    }
  };

  const saveSecurityPolicy = async () => {
    if (securitySaving) return;
    setSecuritySaving(true);
    try {
      const entries = ipWhitelist
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const saved = await api.savePanelSettings({ sessionTimeoutHours, ipAllowlist: entries });
      setSessionTimeoutHours(saved.sessionTimeoutHours || 24);
      setIpWhitelist((saved.ipAllowlist || []).join('\n'));
      onShowToast?.(
        'Security policy saved',
        entries.length === 0
          ? 'No IP restriction: every address may reach the panel.'
          : `Panel access limited to ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`,
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not save the security policy', describeError(err), 'error');
    } finally {
      setSecuritySaving(false);
    }
  };

  // This account's second factor, read once; enabling or disabling updates it in place.
  useEffect(() => {
    let alive = true;
    void api.totpStatus()
      .then((status) => {
        if (alive) setTotpEnabled(status.enabled);
      })
      .catch(() => {
        // The card stays "Off"; starting the setup reports the reason if it fails too.
      });
    return () => {
      alive = false;
    };
  }, []);

  const startTotpSetup = async () => {
    setTotpBusy(true);
    try {
      setTotpSetup(await api.totpSetup());
      setTotpCode('');
    } catch (err) {
      onShowToast?.('Could not start 2FA setup', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmTotp = async () => {
    if (totpCode.length !== 6 || totpBusy) return;
    setTotpBusy(true);
    try {
      const res = await api.totpEnable(totpCode);
      setTotpEnabled(res.enabled);
      setTotpSetup(null);
      setTotpCode('');
      onShowToast?.('2FA enabled', 'Signing in now also needs a code from your authenticator.', 'success');
    } catch (err) {
      onShowToast?.('Could not enable 2FA', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const disableTotp = async () => {
    if (totpCode.length !== 6 || totpBusy) return;
    setTotpBusy(true);
    try {
      const res = await api.totpDisable(totpCode);
      setTotpEnabled(res.enabled);
      setTotpCode('');
      onShowToast?.('2FA disabled', 'This account signs in with its password only.', 'info');
    } catch (err) {
      onShowToast?.('Could not disable 2FA', describeError(err), 'error');
    } finally {
      setTotpBusy(false);
    }
  };

  const copyTotpSecret = async () => {
    if (!totpSetup) return;
    try {
      await navigator.clipboard.writeText(totpSetup.secret);
      setCopiedTotp(true);
      setTimeout(() => setCopiedTotp(false), 1500);
    } catch {
      // Clipboard permission denied: the secret is on screen to type in.
    }
  };

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

  const saveLetsEncryptEmail = async () => {
    if (letsEncryptSaving) return;
    setLetsEncryptSaving(true);
    try {
      const saved = await api.savePanelSettings({ letsencryptEmail: letsEncryptEmail.trim() });
      setLetsEncryptEmail(saved.letsencryptEmail || '');
      onShowToast?.(
        saved.letsencryptEmail ? 'Contact email saved' : 'Contact email cleared',
        saved.letsencryptEmail
          ? 'New certificates will use it as the default contact.'
          : 'Cleared; certbot falls back to its own default.',
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not save', describeError(err), 'error');
    } finally {
      setLetsEncryptSaving(false);
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

  // Monitoring: the only retention the daemon really has is the job/deploy ledger (the metrics
  // sampler is an in-memory ring buffer, not a time-series database), so this tab runs that prune
  // instead of pretending to configure storage that does not exist.
  const [pruneBusy, setPruneBusy] = useState(false);
  const [pruneResult, setPruneResult] = useState<{ ok: boolean; output: string } | null>(null);

  // 1. General Settings
  const [panelPort, setPanelPort] = useState(8443);
  // The panel's own hostname as detected from the admin's Cloudflare account: whether publishing is
  // possible, and the zones (domains) to pick from.
  const [panelTunnel, setPanelTunnel] = useState<PanelTunnelStatus | null>(null);
  const [panelZones, setPanelZones] = useState<CloudflareZone[]>([]);
  const [panelZone, setPanelZone] = useState('');
  const [panelSubdomain, setPanelSubdomain] = useState('barepod');
  const [panelPublishing, setPanelPublishing] = useState(false);
  const [timezone, setTimezone] = useState('');
  const [timezoneZones, setTimezoneZones] = useState<string[]>([]);
  const [timezoneSaving, setTimezoneSaving] = useState(false);

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

  // The checkbox only chooses which address the panel should use; nothing is sent to the server
  // until the operator saves. Unticking it used to unpublish the tunnel at once, which cut off the
  // very hostname the admin was connected through. The unpublish now happens in saveDirectPanelFqdn.
  const toggleCloudflare = (next: boolean) => {
    if (panelPublishing) return;
    setUseCloudflare(next);
  };

  const saveDirectPanelFqdn = async () => {
    if (panelFqdnSaving) return;
    setPanelFqdnSaving(true);
    try {
      // Saving the direct address is what takes the panel off Cloudflare — deferred from the
      // checkbox so that unticking it never drops an in-flight session.
      if (panelTunnel?.fqdn) {
        const status = await api.unpublishPanelTunnel();
        setPanelTunnel(status);
      }
      const clean = panelFqdn.trim().toLowerCase();
      const saved = await api.savePanelSettings({ panelFqdn: clean, useCloudflare: false });
      setPanelFqdn(saved.panelFqdn || '');
      setUseCloudflare(false);
      onShowToast?.(
        saved.panelFqdn ? 'Panel domain saved' : 'Panel domain cleared',
        saved.panelFqdn
          ? `Panel domain is set to ${saved.panelFqdn}. Point your DNS A/AAAA record to this server's public IP address.`
          : 'Panel will be accessed directly via public IP.',
        'success',
      );
    } catch (err) {
      onShowToast?.('Could not save panel domain', err instanceof Error ? err.message : 'unknown error', 'error');
    } finally {
      setPanelFqdnSaving(false);
    }
  };

  // 2. Security Settings
  const [forceHttps, setForceHttps] = useState(true);
  const [sessionTimeoutHours, setSessionTimeoutHours] = useState(24);
  const [securitySaving, setSecuritySaving] = useState(false);
  // A feature this panel does not have yet: kept as the plan it is, marked so nobody relies on it.
  const [ipWhitelist, setIpWhitelist] = useState('');
  const [jwtSecretMasked, setJwtSecretMasked] = useState(true);
  // Two-factor authentication for this account (TOTP).
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [copiedTotp, setCopiedTotp] = useState(false);

  // 3. Proxy & SSL — only the Let's Encrypt contact is stored here; the ingress engine, host ports
  // and per-site certificates are owned by the Stack and Domains screens.
  const [letsEncryptEmail, setLetsEncryptEmail] = useState('');
  const [letsEncryptSaving, setLetsEncryptSaving] = useState(false);

  // 4. Backups
  const [backupSchedule, setBackupSchedule] = useState<'daily' | 'weekly' | 'disabled'>('daily');
  const [backupRetentionDays, setBackupRetentionDays] = useState(14);
  const [backupStorageType, setBackupStorageType] = useState<'local' | 's3' | 'r2' | 'gcs'>('local');
  const [backupPath, setBackupPath] = useState('/var/backups/barepod');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);

  // 5. Notifications — real now: the config is stored by the daemon and the maintenance jobs (notably
  // disk_alert) deliver through it. Secrets are write-only: the panel never reads them back.
  const [alerts, setAlerts] = useState<NotificationConfig | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsSaving, setAlertsSaving] = useState(false);
  const [alertSecrets, setAlertSecrets] = useState({ telegramBotToken: '', discordWebhookUrl: '', smtpPassword: '' });


  const handleTestBackup = () => {
    setIsBackingUp(true);
    onShowToast?.('Backup Initiated', 'Creating snapshot of databases and web configurations...', 'info');
    setTimeout(() => {
      setIsBackingUp(false);
      onShowToast?.('Backup Completed', 'Snapshot saved to /var/backups/barepod/snapshot_20261010_1910.tar.gz (1.2 GB)', 'success');
    }, 2500);
  };

  // Alerts are loaded when the tab is opened, so the panel never holds a secret it is not showing.
  useEffect(() => {
    if (activeTab !== 'notifications') return;
    let alive = true;
    setAlertsLoading(true);
    void (async () => {
      try {
        const loaded = await api.notifications();
        if (alive) setAlerts(loaded);
      } catch (err) {
        if (alive) onShowToast?.('Could not load alert settings', describeError(err), 'error');
      } finally {
        if (alive) setAlertsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeTab]);

  const saveAlerts = async () => {
    if (!alerts || alertsSaving) return;
    setAlertsSaving(true);
    try {
      const updated = await api.saveNotifications({
        telegramEnabled: alerts.telegramEnabled,
        telegramChatId: alerts.telegramChatId,
        telegramBotToken: alertSecrets.telegramBotToken || undefined,
        discordEnabled: alerts.discordEnabled,
        discordWebhookUrl: alertSecrets.discordWebhookUrl || undefined,
        smtpEnabled: alerts.smtpEnabled,
        smtpHost: alerts.smtpHost,
        smtpPort: alerts.smtpPort,
        smtpUser: alerts.smtpUser,
        smtpPassword: alertSecrets.smtpPassword || undefined,
        smtpFrom: alerts.smtpFrom,
        smtpTo: alerts.smtpTo,
        diskAlertThresholdPercent: alerts.diskAlertThresholdPercent,
      });
      setAlerts(updated);
      setAlertSecrets({ telegramBotToken: '', discordWebhookUrl: '', smtpPassword: '' });
      onShowToast?.('Alert settings saved', `Active channels: ${updated.channels.join(', ') || 'none'}`, 'success');
    } catch (err) {
      onShowToast?.('Could not save alert settings', describeError(err), 'error');
    } finally {
      setAlertsSaving(false);
    }
  };

  const handleTestNotification = async () => {
    try {
      const res = await api.testNotification();
      if (res.ok) {
        onShowToast?.('Test sent', `Delivered via ${res.channels.join(', ')}.`, 'success');
      } else {
        onShowToast?.('Test failed', (res.errors || []).join('; ') || 'delivery failed', 'error');
      }
    } catch (err) {
      onShowToast?.('Test failed', describeError(err), 'error');
    }
  };

  const handlePruneRetained = async () => {
    setPruneBusy(true);
    setPruneResult(null);
    try {
      const res = await api.runSystemCronJob('metrics_prune');
      setPruneResult({ ok: res.ok, output: res.output || 'The prune finished without output.' });
      onShowToast?.(
        res.ok ? 'Prune complete' : 'Prune failed',
        res.ok ? 'Retained job records were trimmed.' : 'See the output below.',
        res.ok ? 'success' : 'error'
      );
    } catch (err) {
      setPruneResult({ ok: false, output: describeError(err) });
      onShowToast?.('Prune failed', describeError(err), 'error');
    } finally {
      setPruneBusy(false);
    }
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
                          onChange={(e) => toggleCloudflare(e.target.checked)}
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
                          placeholder="barepod"
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
                          className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer"
                        >
                          {panelPublishing ? 'Publishing…' : 'Publish via Cloudflare'}
                        </button>
                        {panelTunnel?.fqdn && (
                          <button
                            type="button"
                            onClick={() => void unpublishPanel()}
                            disabled={panelPublishing}
                            className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-colors cursor-pointer"
                          >
                            Unpublish
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={panelFqdn}
                        onChange={(e) => setPanelFqdn(e.target.value)}
                        disabled={!isAdmin || panelFqdnSaving}
                        placeholder="panel.example.com"
                        className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                      />
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void saveDirectPanelFqdn()}
                          disabled={panelFqdnSaving}
                          className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors cursor-pointer"
                        >
                          {panelFqdnSaving ? 'Saving…' : 'Save'}
                        </button>
                      )}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-400 mt-1">
                    {!isAdmin
                      ? 'Only an administrator can change this.'
                      : useCloudflare && panelTunnel?.configured
                        ? panelTunnel.fqdn
                          ? `Published via Cloudflare Tunnel: https://${panelTunnel.fqdn}. The panel still answers on its IP.`
                          : `Pick a domain from your Cloudflare account and publish. Target: ${panelTunnel.service}.`
                        : panelFqdn
                          ? `Direct Domain active: https://${panelFqdn}:${ports?.panel || '8443'}. Point your DNS A/AAAA record to this server's public IP address.`
                          : 'Enter a domain to access the panel directly without Cloudflare. Point your domain\'s DNS A record to this server\'s public IP.'}
                  </p>
                </div>
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

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Server Timezone
                </label>
                <div className="flex gap-2">
                  {timezoneZones.length > 0 ? (
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    >
                      {timezone && !timezoneZones.includes(timezone) && (
                        <option value={timezone}>{timezone} (current)</option>
                      )}
                      {timezoneZones.map((zone) => (
                        <option key={zone} value={zone}>{zone}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      placeholder="Asia/Makassar"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => void applyTimezone()}
                    disabled={!isAdmin || timezoneSaving}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors shrink-0"
                  >
                    {timezoneSaving ? 'Applying…' : 'Apply'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Applied to the host with <code className="font-mono">timedatectl set-timezone</code> — the
                  server clock, not just the panel.
                </p>
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
                        {updateInfo.isPatchBuild ? 'Patch Build Available' : 'Update Available'}
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
              {updateInfo?.hasUpdate && updateInfo.release ? (
                <div className="p-5 rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/70 to-indigo-50/60 shadow-2xs space-y-4">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping" />
                        <h3 className="text-sm font-bold text-blue-950">
                          {updateInfo.isPatchBuild
                            ? `BarePod Panel ${updateInfo.release.tag} (New Patch Build) is Ready to Install`
                            : `BarePod Panel ${updateInfo.release.tag} is Ready to Install`}
                        </h3>
                      </div>
                      <p className="text-xs text-blue-700 mt-1">
                        {updateInfo.isPatchBuild
                          ? 'Updated binary checksum detected on GitHub. Zero tenant website downtime guarantee.'
                          : 'Zero tenant website downtime guarantee. The daemon swaps binaries atomically and restarts in ~2s.'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void startPanelUpdate()}
                      disabled={isUpdating || !isAdmin}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl transition flex items-center gap-2 cursor-pointer shadow-md shadow-blue-500/20"
                    >
                      <ArrowUpCircle className="w-4 h-4" />
                      {isUpdating ? 'Updating Panel…' : updateInfo.isPatchBuild ? 'Install Patch Update' : 'Install Update Now'}
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
              ) : updateInfo?.release ? (
                <div className="p-4 rounded-2xl border border-slate-200 bg-white flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                      <Check className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">
                        BarePod Panel is up to date (v{updateInfo.currentVersion})
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        Running official release {updateInfo.release.tag}. You can force a reinstall anytime to refresh assets.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void startPanelUpdate()}
                    disabled={isUpdating || !isAdmin}
                    className="px-4 py-2 border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Force Reinstall / Re-apply Release
                  </button>
                </div>
              ) : null}

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

          {/* MONITORING & RETENTION */}
          {activeTab === 'monitoring' && (
            <div className="space-y-6 w-full">
              <div>
                <h2 className="text-base font-bold text-slate-900">Monitoring & Retention</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  What the daemon actually keeps, and the one retention pass it can run.
                </p>
              </div>

              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Live metrics are held in memory</h3>
                    <p className="text-xs text-slate-500">Host and per-site samples behind the charts.</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The sampler keeps a bounded ring buffer in memory and never writes time-series data to
                  disk, so there is no retention window to configure here: the history starts empty again
                  when the daemon restarts. The retention below applies to what the daemon does persist.
                </p>
              </div>

              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Trash2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Retained job records</h3>
                    <p className="text-xs text-slate-500">Deploy and job history kept per website.</p>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The daemon keeps the newest deploy/job records for each website (and a smaller set for
                  stack installs). The <code className="font-mono">metrics_prune</code> job trims older
                  ones and vacuums the system journal. Its schedule lives on the Cron tab.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handlePruneRetained()}
                    disabled={pruneBusy}
                    className="px-3.5 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${pruneBusy ? 'animate-spin' : ''}`} />
                    <span>{pruneBusy ? 'Pruning…' : 'Run prune now'}</span>
                  </button>
                  <span className="text-[11px] text-slate-400">
                    Same job as Cron &rarr; "Metrics &amp; log retention prune".
                  </span>
                </div>
                {pruneResult && (
                  <pre
                    className={`p-3 rounded-lg text-[11px] font-mono whitespace-pre-wrap max-h-48 overflow-y-auto ${
                      pruneResult.ok
                        ? 'bg-slate-950 text-slate-200'
                        : 'bg-rose-50 text-rose-800 border border-rose-200'
                    }`}
                  >
                    {pruneResult.output}
                  </pre>
                )}
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

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Two-Factor Authentication (2FA TOTP)</h3>
                    <p className="text-[11px] text-slate-500">
                      A 6-digit code from an authenticator app, on top of the password, for this account.
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      totpEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {totpEnabled ? 'Enabled' : 'Off'}
                  </span>
                </div>

                {totpSetup ? (
                  <div className="space-y-3">
                    <p className="text-[11px] text-slate-600">
                      Add this secret to your authenticator (or open the link), then enter the current code
                      to confirm. It is not required until you confirm.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-2.5 py-2 rounded-lg bg-slate-900 text-slate-100 font-mono text-[11px] break-all">
                        {totpSetup.secret}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copyTotpSecret()}
                        className="px-2.5 py-2 text-[11px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shrink-0 cursor-pointer"
                      >
                        {copiedTotp ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono break-all">{totpSetup.otpauthUrl}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="123456"
                        className="w-28 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono tracking-[0.2em]"
                      />
                      <button
                        type="button"
                        onClick={() => void confirmTotp()}
                        disabled={totpCode.length !== 6 || totpBusy}
                        className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg cursor-pointer"
                      >
                        {totpBusy ? 'Confirming…' : 'Confirm & enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setTotpSetup(null);
                          setTotpCode('');
                        }}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : totpEnabled ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="Code to disable"
                      className="w-36 px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono tracking-[0.2em]"
                    />
                    <button
                      type="button"
                      onClick={() => void disableTotp()}
                      disabled={totpCode.length !== 6 || totpBusy}
                      className="px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-40 rounded-lg cursor-pointer"
                    >
                      {totpBusy ? 'Disabling…' : 'Disable 2FA'}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startTotpSetup()}
                    disabled={totpBusy}
                    className="px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg cursor-pointer"
                  >
                    {totpBusy ? 'Starting…' : 'Set up 2FA'}
                  </button>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Admin Session Lifetime
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
                <p className="text-[10px] text-slate-400 mt-1">
                  Counted from sign-in. A session older than this is deleted on its next request.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Panel IP allowlist
                </label>
                <textarea
                  rows={3}
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder={'172.19.1.100\n10.8.0.0/24\n(empty = every address may reach the panel)'}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  One address or network per line. Empty allows everyone. Loopback is always allowed and
                  <code className="font-mono"> /api/v1/health</code> stays reachable, so a bad list cannot
                  lock you out of the panel over an SSH tunnel.
                </p>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => void saveSecurityPolicy()}
                  disabled={!isAdmin || securitySaving}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-xl transition-all flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{securitySaving ? 'Saving…' : 'Save security policy'}</span>
                </button>
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

          {/* REVERSE PROXY & SSL */}
          {activeTab === 'proxy' && (
            <div className="space-y-6 w-full">
              <div>
                <h2 className="text-base font-bold text-slate-900">Reverse Proxy & SSL</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  These are host-level choices; the panel does not keep a second copy of them.
                </p>
              </div>

              <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-2xs space-y-3">
                <h3 className="text-sm font-bold text-slate-900">Where each control really lives</h3>
                <ul className="text-xs text-slate-600 space-y-2">
                  <li className="flex items-start gap-2">
                    <Globe className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <span>
                      <strong>Ingress engine, installs and switches</strong> &mdash; the
                      <strong> Stack</strong> page (nginx or Caddy). It is the only place that rewrites
                      the host's vhosts.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <span>
                      <strong>Certificates, aliases and renewals</strong> &mdash; <strong>Domains</strong>.
                      Each site's certificate is issued and toggled there, and the
                      <code className="font-mono"> ssl_renew</code> job renews what is due.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Server className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                    <span>
                      <strong>Host ports 80/443</strong> &mdash; owned by the web server's own
                      configuration, not by this panel.
                    </span>
                  </li>
                </ul>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <label className="block">
                  <span className="text-xs font-bold text-slate-800">Let's Encrypt admin contact email</span>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Used as the default contact when a certificate is issued without one in the Domains
                    dialog.
                  </p>
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={letsEncryptEmail}
                    onChange={(e) => setLetsEncryptEmail(e.target.value)}
                    disabled={!isAdmin}
                    placeholder="admin@example.com"
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-blue-500 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => void saveLetsEncryptEmail()}
                    disabled={!isAdmin || letsEncryptSaving}
                    className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-lg transition-colors shrink-0"
                  >
                    {letsEncryptSaving ? 'Saving…' : 'Save'}
                  </button>
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

          {/* 6. NOTIFICATIONS */}
          {activeTab === 'notifications' && (
            <div className="space-y-6 w-full">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">Notifications & Alert Channels</h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Where the daemon's alerts go — most visibly the disk-usage alert from the Cron tab.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleTestNotification()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Test Ping</span>
                </button>
              </div>

              {alertsLoading && !alerts ? (
                <div className="p-6 text-center text-xs text-slate-500">Loading alert settings…</div>
              ) : !alerts ? (
                <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700">
                  Alert settings could not be loaded. Sign in as an administrator and retry.
                </div>
              ) : (
                <>
                  {/* Telegram Bot */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Send className="w-5 h-5 text-blue-600" />
                        <h3 className="text-xs font-bold text-slate-900">Telegram Bot Notifications</h3>
                      </div>
                      <input
                        type="checkbox"
                        checked={alerts.telegramEnabled}
                        onChange={(e) => setAlerts({ ...alerts, telegramEnabled: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300"
                      />
                    </div>
                    {alerts.telegramEnabled && (
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-1">
                            Bot Token {alerts.telegramHasToken && <span className="text-emerald-600">· saved</span>}
                          </label>
                          <input
                            type="text"
                            placeholder={alerts.telegramHasToken ? '•••••• leave empty to keep' : '123456789:ABCDef...'}
                            value={alertSecrets.telegramBotToken}
                            onChange={(e) => setAlertSecrets((s) => ({ ...s, telegramBotToken: e.target.value }))}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-600 mb-1">Chat ID</label>
                          <input
                            type="text"
                            placeholder="-100123456789"
                            value={alerts.telegramChatId}
                            onChange={(e) => setAlerts({ ...alerts, telegramChatId: e.target.value })}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Discord Webhook */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🎮</span>
                        <h3 className="text-xs font-bold text-slate-900">Discord Channel Webhook</h3>
                      </div>
                      <input
                        type="checkbox"
                        checked={alerts.discordEnabled}
                        onChange={(e) => setAlerts({ ...alerts, discordEnabled: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300"
                      />
                    </div>
                    {alerts.discordEnabled && (
                      <input
                        type="text"
                        placeholder={alerts.discordHasWebhook ? '•••••• leave empty to keep' : 'https://discord.com/api/webhooks/...'}
                        value={alertSecrets.discordWebhookUrl}
                        onChange={(e) => setAlertSecrets((s) => ({ ...s, discordWebhookUrl: e.target.value }))}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                      />
                    )}
                  </div>

                  {/* SMTP Email */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-slate-600" />
                        <h3 className="text-xs font-bold text-slate-900">SMTP Server for Email Notifications</h3>
                      </div>
                      <input
                        type="checkbox"
                        checked={alerts.smtpEnabled}
                        onChange={(e) => setAlerts({ ...alerts, smtpEnabled: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded border-slate-300"
                      />
                    </div>
                    {alerts.smtpEnabled && (
                      <div className="space-y-3 pt-1">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">SMTP Host</label>
                            <input
                              type="text"
                              value={alerts.smtpHost}
                              onChange={(e) => setAlerts({ ...alerts, smtpHost: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">Port</label>
                            <input
                              type="number"
                              value={alerts.smtpPort}
                              onChange={(e) => setAlerts({ ...alerts, smtpPort: Number(e.target.value) })}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">Username</label>
                            <input
                              type="text"
                              value={alerts.smtpUser}
                              onChange={(e) => setAlerts({ ...alerts, smtpUser: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">
                              Password {alerts.smtpHasPassword && <span className="text-emerald-600">· saved</span>}
                            </label>
                            <input
                              type="password"
                              placeholder={alerts.smtpHasPassword ? '•••••• leave empty to keep' : ''}
                              value={alertSecrets.smtpPassword}
                              onChange={(e) => setAlertSecrets((s) => ({ ...s, smtpPassword: e.target.value }))}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">From</label>
                            <input
                              type="text"
                              value={alerts.smtpFrom}
                              onChange={(e) => setAlerts({ ...alerts, smtpFrom: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-600 mb-1">To</label>
                            <input
                              type="text"
                              value={alerts.smtpTo}
                              onChange={(e) => setAlerts({ ...alerts, smtpTo: e.target.value })}
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Disk alert threshold */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                    <h3 className="text-xs font-bold text-slate-900">Disk alert threshold</h3>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={alerts.diskAlertThresholdPercent}
                        onChange={(e) => setAlerts({ ...alerts, diskAlertThresholdPercent: Number(e.target.value) })}
                        className="w-24 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                      />
                      <span className="text-xs text-slate-500">% — the disk_alert job notifies at or above this.</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Active channels: <strong className="text-slate-600">{alerts.channels.join(', ') || 'none'}</strong>
                    </p>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void saveAlerts()}
                      disabled={alertsSaving}
                      className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 rounded-xl shadow-sm shadow-blue-500/25 transition-all cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{alertsSaving ? 'Saving…' : 'Save Alert Settings'}</span>
                    </button>
                  </div>
                </>
              )}
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
