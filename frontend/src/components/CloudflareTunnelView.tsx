import React, { useState, useEffect, useCallback } from 'react';
import { 
  CloudRain, 
  CheckCircle2, 
  Key, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  Plus, 
  Globe, 
  Zap,
  Radio,
  Lock,
  Eye,
  EyeOff,
  Cpu,
  Layers,
  Sparkles,
  Server,
  UserCheck,
  Check,
  AlertCircle,
  Loader2,
  ArrowDownToLine,
  HelpCircle,
  Pencil,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Info,
  ArrowRight,
  Unlink,
  Trash2
} from 'lucide-react';
import { api, type TunnelStatusResponse, type IngressRouteDTO, type CloudflareZone } from '../api/client';

interface CloudflareTunnelViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  currentUser?: string;
}

export const CloudflareTunnelView: React.FC<CloudflareTunnelViewProps> = ({ onShowToast, currentUser = 'admin' }) => {
  const [activeUser, setActiveUser] = useState<string>(currentUser);
  const [tunnelData, setTunnelData] = useState<TunnelStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Cloudflare Zones State
  const [zones, setZones] = useState<CloudflareZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string>(''); // zone domain or 'custom'
  const [subdomain, setSubdomain] = useState<string>('');

  // Tokens State
  const [inputToken, setInputToken] = useState('');
  const [showTokenText, setShowTokenText] = useState(false);
  const [inputApiToken, setInputApiToken] = useState('');
  const [showApiTokenText, setShowApiTokenText] = useState(false);
  const [isTokenSaving, setIsTokenSaving] = useState(false);
  const [isTokenSaved, setIsTokenSaved] = useState(false);

  // Route Modal State
  const [isAddRouteOpen, setIsAddRouteOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<IngressRouteDTO | null>(null);
  const [selectedAppSlug, setSelectedAppSlug] = useState('');
  const [newHostname, setNewHostname] = useState('');
  const [newTargetService, setNewTargetService] = useState('http://127.0.0.1:80');
  const [newAppName, setNewAppName] = useState('');
  const [noTlsVerify, setNoTlsVerify] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);

  // Unlink State
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);

  // Interactive Tutorial / Guide State
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialTab, setTutorialTab] = useState<'connector' | 'apiToken' | 'workflow'>('connector');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
    onShowToast?.('Copied to Clipboard', label, 'info');
  };

  // Fetch tunnel status from real backend
  const fetchTunnel = useCallback(async (user: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await api.tunnelStatus(user);
      setTunnelData(data);
      // The saved token is never sent back, so the field stays empty: it can be replaced, not read.
      setInputToken('');
      if (!data.hasToken) {
        setShowTutorial(true);
      }
    } catch (err: any) {
      console.error('Failed to load tunnel status:', err);
      onShowToast?.('Failed to load tunnel', err?.message || 'Could not reach server', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onShowToast]);

  const fetchZones = useCallback(async (user: string) => {
    try {
      setLoadingZones(true);
      const res = await api.tunnelZones(user);
      if (res.zones && Array.isArray(res.zones)) {
        setZones(res.zones);
      }
    } catch (err) {
      console.warn('Failed to fetch Cloudflare zones:', err);
    } finally {
      setLoadingZones(false);
    }
  }, []);

  useEffect(() => {
    fetchTunnel(activeUser);
    fetchZones(activeUser);
  }, [activeUser, fetchTunnel, fetchZones]);

  // Handle switching active user account
  const handleSwitchUser = (username: string) => {
    setActiveUser(username);
    setShowTokenText(false);
    setShowApiTokenText(false);
    setInputApiToken('');
  };

  // Helper to extract pure eyJh... token from full shell or docker commands
  const cleanTunnelToken = (val: string): string => {
    const trimmed = val.trim();
    const match = trimmed.match(/eyJh[A-Za-z0-9_-]{20,}/);
    if (match) {
      return match[0];
    }
    return trimmed;
  };

  const handleTokenInput = (val: string) => {
    const cleaned = cleanTunnelToken(val);
    if (cleaned !== val.trim() && val.trim().length > cleaned.length) {
      setInputToken(cleaned);
      onShowToast?.(
        'Token Auto-Extracted',
        'Detected full install command! Extracted pure Cloudflare tunnel token automatically.',
        'info'
      );
    } else {
      setInputToken(val);
    }
  };

  // Save Token
  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsTokenSaving(true);
    const cleanedToken = cleanTunnelToken(inputToken);

    // Client-side format validation
    if (cleanedToken && !cleanedToken.startsWith('eyJh')) {
      onShowToast?.(
        'Invalid Token Format',
        'Cloudflare Tunnel Token must be a valid base64 token from Cloudflare Zero Trust (starts with eyJh...).',
        'error'
      );
      setIsTokenSaving(false);
      return;
    }
    if (inputApiToken.trim() && inputApiToken.trim().length < 20) {
      onShowToast?.(
        'Invalid API Token Format',
        'Cloudflare API Token must be at least 20 characters long.',
        'error'
      );
      setIsTokenSaving(false);
      return;
    }

    try {
      const updated = await api.saveTunnelToken(
        cleanedToken, 
        inputApiToken.trim() || undefined, 
        activeUser
      );
      setTunnelData(updated);
      setInputToken('');
      setInputApiToken('');
      setIsTokenSaved(true);
      fetchZones(activeUser);
      setTimeout(() => setIsTokenSaved(false), 2500);
      onShowToast?.(
        'Cloudflare Configuration Saved',
        updated.autoSync 
          ? `Connected to Cloudflare! Auto-sync is active for @${activeUser}.`
          : `Connector token saved. Daemon cloudflared@${activeUser} is active.`,
        'success'
      );
    } catch (err: any) {
      onShowToast?.('Failed to save configuration', err?.message || 'Check server connection', 'error');
    } finally {
      setIsTokenSaving(false);
    }
  };

  // Restart daemon
  const handleRestartDaemon = async () => {
    setRefreshing(true);
    try {
      const updated = await api.restartTunnel(activeUser);
      setTunnelData(updated);
      onShowToast?.(
        'Daemon Restarted',
        `cloudflared daemon for @${activeUser} was restarted successfully.`,
        'success'
      );
    } catch (err: any) {
      onShowToast?.('Restart Failed', err?.message || 'Unable to restart daemon', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  // Pull existing routes from Cloudflare Dashboard
  const handleSyncFromCloudflare = async () => {
    if (!tunnelData?.hasApiToken) {
      onShowToast?.(
        'API Token Required',
        'Please enter your Cloudflare API Token in the configuration box below to enable Auto-Sync with Cloudflare.',
        'info'
      );
      return;
    }
    setSyncing(true);
    try {
      const updated = await api.syncTunnelRoutes(activeUser);
      setTunnelData(updated);
      onShowToast?.(
        'Routes Synchronized',
        `Successfully pulled ${updated.routes.length} domain routes from Cloudflare Zero Trust.`,
        'success'
      );
    } catch (err: any) {
      onShowToast?.('Sync Failed', err?.message || 'Could not sync from Cloudflare API', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const computeHostname = (sub: string, zone: string, manual: string): string => {
    if (zone === 'custom' || !zone) {
      return manual.trim().toLowerCase();
    }
    const cleanSub = sub.trim().toLowerCase();
    if (!cleanSub || cleanSub === '@') {
      return zone.toLowerCase();
    }
    return `${cleanSub}.${zone.toLowerCase()}`;
  };

  const handleOpenAddModal = () => {
    setEditingRoute(null);
    setSelectedAppSlug('');
    setNewAppName('');
    setNewTargetService('http://127.0.0.1:80');
    setNoTlsVerify(false);

    if (zones.length > 0) {
      setSelectedZone(zones[0].name);
      setSubdomain('');
      setNewHostname(zones[0].name);
    } else {
      setSelectedZone('custom');
      setSubdomain('');
      setNewHostname('');
    }

    setIsAddRouteOpen(true);
    fetchZones(activeUser);

    if (tunnelData?.availableApps && tunnelData.availableApps.length > 0) {
      handleAppSelect(tunnelData.availableApps[0].slug);
    }
  };

  const handleEditRoute = (route: IngressRouteDTO) => {
    setEditingRoute(route);
    setSelectedAppSlug('');
    setNewAppName(route.appName || '');
    setNewTargetService(route.service || 'http://127.0.0.1:80');
    setNoTlsVerify(route.service.startsWith('https://'));

    const host = route.hostname.toLowerCase();
    let matchedZone = '';
    let extractedSub = '';
    for (const z of zones) {
      const zName = z.name.toLowerCase();
      if (host === zName) {
        matchedZone = z.name;
        extractedSub = '@';
        break;
      } else if (host.endsWith('.' + zName)) {
        matchedZone = z.name;
        extractedSub = host.slice(0, -(zName.length + 1));
        break;
      }
    }

    if (matchedZone) {
      setSelectedZone(matchedZone);
      setSubdomain(extractedSub);
    } else {
      setSelectedZone('custom');
      setSubdomain('');
    }
    setNewHostname(route.hostname);
    setIsAddRouteOpen(true);
  };

  // App Selection in Route Modal
  const handleAppSelect = (slug: string) => {
    setSelectedAppSlug(slug);
    if (!slug) return;
    const found = tunnelData?.availableApps.find(a => a.slug === slug);
    if (found) {
      setNewAppName(found.slug);
      // Auto-set to Edge Ingress (port 80) by default so traffic routes through web server
      setNewTargetService(found.targetUrl || 'http://127.0.0.1:80');

      const host = (found.domain || '').toLowerCase();
      let matchedZone = '';
      let extractedSub = '';
      for (const z of zones) {
        const zName = z.name.toLowerCase();
        if (host === zName) {
          matchedZone = z.name;
          extractedSub = '@';
          break;
        } else if (host.endsWith('.' + zName)) {
          matchedZone = z.name;
          extractedSub = host.slice(0, -(zName.length + 1));
          break;
        }
      }

      if (matchedZone) {
        setSelectedZone(matchedZone);
        setSubdomain(extractedSub);
        setNewHostname(host);
      } else if (zones.length > 0) {
        const activeZ = (selectedZone && selectedZone !== 'custom') ? selectedZone : zones[0].name;
        setSelectedZone(activeZ);
        setSubdomain(found.slug);
        setNewHostname(`${found.slug}.${activeZ}`);
      } else {
        setSelectedZone('custom');
        setSubdomain('');
        setNewHostname(found.domain || '');
      }
    }
  };

  // Handle Unlink Tunnel
  const handleUnlink = async () => {
    setIsUnlinking(true);
    try {
      await api.unlinkTunnel(activeUser);
      onShowToast?.('Tunnel Unlinked', 'Cloudflare tunnel daemon stopped and credentials removed.', 'info');
      setShowUnlinkConfirm(false);
      setInputToken('');
      setInputApiToken('');
      await fetchTunnel(activeUser);
    } catch (err: any) {
      onShowToast?.('Failed to Unlink Tunnel', err?.message || 'Error occurred while unlinking tunnel', 'error');
    } finally {
      setIsUnlinking(false);
    }
  };

  // Add / Edit Route
  const handleDeleteRoute = async (route: IngressRouteDTO) => {
    const label = route.hostname || 'this ingress route';
    if (!confirm(`Delete the ingress route ${label}? It is removed from Cloudflare too.`)) return;
    try {
      await api.deleteTunnelRoute(route.id, activeUser);
      onShowToast?.('Ingress route deleted', `${label} was removed from Cloudflare.`, 'success');
      await fetchTunnel(activeUser, true);
    } catch (err) {
      onShowToast?.('Could not delete the route', err instanceof Error ? err.message : 'unknown error', 'error');
    }
  };

  const handleSaveRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHostname.trim()) return;

    const isHttpsTarget = newTargetService.trim().toLowerCase().startsWith('https://');
    const effectiveNoTls = isHttpsTarget || noTlsVerify;

    setIsSavingRoute(true);
    try {
      if (editingRoute) {
        await api.updateTunnelRoute(editingRoute.id, newHostname.trim(), newTargetService.trim(), newAppName.trim(), effectiveNoTls, activeUser);
        onShowToast?.(
          'Ingress Domain Updated',
          `Route for ${newHostname.trim()} updated to ${newTargetService.trim()}`,
          'success'
        );
      } else {
        await api.addTunnelRoute(newHostname.trim(), newTargetService.trim(), newAppName.trim(), effectiveNoTls, activeUser);
        onShowToast?.(
          'Ingress Domain Added',
          tunnelData?.autoSync
            ? `Domain https://${newHostname.trim()} automatically configured in Cloudflare Zero Trust and DNS!`
            : `Public hostname https://${newHostname.trim()} saved locally.`,
          'success'
        );
      }
      await fetchTunnel(activeUser, true);
      setIsAddRouteOpen(false);
      setEditingRoute(null);
      setNewHostname('');
      setSelectedAppSlug('');
      setNewAppName('');
    } catch (err: any) {
      onShowToast?.('Failed to Save Ingress Route', err?.message || 'Server error', 'error');
    } finally {
      setIsSavingRoute(false);
    }
  };

  const isConnected = tunnelData?.status === 'connected';
  const isConfiguring = tunnelData?.status === 'configuring';

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Account Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Cloudflare Tunnel (Zero-NAT)</h1>
            <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/60 flex items-center gap-1.5 shadow-2xs">
              <Radio className="w-3 h-3 text-emerald-600 animate-pulse" /> Self-Service Tunnel
            </span>
            {tunnelData?.autoSync && (
              <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60 flex items-center gap-1 shadow-2xs">
                <Sparkles className="w-3 h-3 text-blue-600" /> Auto-Sync Cloudflare
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Expose local apps securely through Cloudflare Zero Trust without public IPs or port forwarding.
          </p>
        </div>

        {/* User Account Switcher */}
        {tunnelData?.accounts && tunnelData.accounts.length > 0 && (
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-2 shadow-2xs">
            <UserCheck className="w-4 h-4 text-slate-500 ml-1" />
            <span className="text-xs font-semibold text-slate-600">Your Account:</span>
            <select
              value={activeUser}
              onChange={(e) => handleSwitchUser(e.target.value)}
              className="text-xs font-bold text-blue-700 bg-blue-50/80 px-2.5 py-1 rounded-lg border border-blue-200 focus:outline-hidden cursor-pointer font-mono"
            >
              {tunnelData.accounts.map((acc) => (
                <option key={acc} value={acc}>
                  {acc} {acc === currentUser ? '(Active Account)' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tunnel summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-600 min-w-0">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
          <span className="font-semibold text-slate-800">Personal tunnel</span>
          <span className="font-mono text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded border border-blue-200/50">
            @{activeUser}
          </span>
          <span className="text-slate-400 hidden sm:inline">· isolated systemd daemon</span>
          {tunnelData?.tunnelId && (
            <span className="font-mono text-[10px] text-slate-400 truncate hidden md:inline">
              (ID: {tunnelData.tunnelId.slice(0, 8)}...)
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-center min-w-[90px]">
            <span className="text-sm font-bold block text-slate-900 font-mono">
              {loading ? '...' : (tunnelData?.routes.length || 0)}
            </span>
            <span className="text-[10px] text-slate-500 uppercase font-semibold">Active Domains</span>
          </div>
          <div className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-center min-w-[90px]">
            <span className={`text-sm font-bold block font-mono ${
              isConnected ? 'text-emerald-600' : isConfiguring ? 'text-amber-500' : 'text-slate-500'
            }`}>
              {loading ? '...' : isConnected ? 'Live' : isConfiguring ? 'Starting' : 'Off'}
            </span>
            <span className="text-[10px] text-slate-500 uppercase font-semibold">Tunnel Status</span>
          </div>
        </div>
      </div>

      {/* Main Personal Tunnel Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs space-y-6">
        {/* Card Header with Status & Process Info */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${
              isConnected 
                ? 'bg-emerald-50 text-emerald-600 border-emerald-200' 
                : 'bg-slate-50 text-slate-500 border-slate-200'
            }`}>
              <CloudRain className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-900">
                  {tunnelData?.tunnelName || `${activeUser}-tunnel`}
                </span>
                
                {isConnected ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-200/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    CONNECTED
                  </span>
                ) : isConfiguring ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1 border border-amber-200/50">
                    <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
                    CONFIGURING
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 flex items-center gap-1 border border-slate-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                    DISCONNECTED
                  </span>
                )}

                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                  User: @{activeUser}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1 font-mono">
                <span>Daemon: <code>cloudflared@{activeUser}</code></span>
                <span>•</span>
                <span>PID: {tunnelData?.daemonPid || 0}</span>
                <span>•</span>
                <span>RAM: {tunnelData?.memoryUsage || '0 MB'}</span>
                <span>•</span>
                <span>Uptime: {tunnelData?.uptime || 'Not Running'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {tunnelData?.hasToken && (
              <button
                type="button"
                onClick={() => setShowUnlinkConfirm(true)}
                disabled={isUnlinking}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-600 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 hover:border-rose-300 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                title="Disconnect & Unlink this Cloudflare tunnel"
              >
                <Unlink className="w-3.5 h-3.5 text-rose-500" />
                <span>Unlink Tunnel</span>
              </button>
            )}
            <button
              onClick={handleRestartDaemon}
              disabled={refreshing || !tunnelData?.hasToken}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Restart isolated cloudflared daemon"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Restarting...' : 'Restart Daemon'}</span>
            </button>
          </div>
        </div>

        {/* Interactive Step-by-Step Tutorial / Guide */}
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50/60 to-white overflow-hidden shadow-xs transition-all">
          <button
            type="button"
            onClick={() => setShowTutorial(!showTutorial)}
            className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-blue-50/80 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <BookOpen className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">
                    Cloudflare Tunnel & API Token Setup Guide
                  </span>
                  <span className="text-[10px] font-bold text-blue-700 bg-blue-100/80 px-2 py-0.5 rounded-full border border-blue-200">
                    Step-by-Step
                  </span>
                  <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100/70 px-2 py-0.5 rounded-full border border-emerald-200">
                    Zero-NAT & Auto DNS
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  Step-by-step instructions to connect your domains to BarePod without a public IP & enable automatic DNS sync.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-600 shrink-0 ml-3">
              <span>{showTutorial ? 'Hide Guide' : 'Open Setup Guide'}</span>
              {showTutorial ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {showTutorial && (
            <div className="p-5 pt-1 border-t border-blue-100 space-y-4">
              {/* Tab Navigation */}
              <div className="flex flex-wrap gap-1.5 border-b border-slate-200/70 pb-2">
                {[
                  { id: 'connector', label: '1. Connector Token (Required)', icon: Key },
                  { id: 'apiToken', label: '2. Cloudflare API Token (Automation)', icon: Sparkles },
                  { id: 'workflow', label: '3. Deployment & Workflow', icon: Globe },
                ].map((t) => {
                  const Icon = t.icon;
                  const active = tutorialTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTutorialTab(t.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: CONNECTOR TOKEN */}
              {tutorialTab === 'connector' && (
                <div className="space-y-3 text-xs text-slate-700">
                  <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/70 flex items-start gap-2.5">
                    <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-blue-900 block">What is a Connector Token?</span>
                      <span className="text-slate-600 text-[11px] leading-relaxed">
                        This token connects the background daemon <code className="font-mono text-blue-700 bg-blue-100/50 px-1 rounded">cloudflared@{activeUser}</code> on your server securely to Cloudflare's edge network via an encrypted tunnel (Zero-NAT). Your server does not require a static public IP, open ports, or router port forwarding.
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 pl-1">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Open Cloudflare Zero Trust Dashboard:</span>
                        <div className="mt-1">
                          <a
                            href="https://one.dash.cloudflare.com"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs"
                          >
                            <span>one.dash.cloudflare.com</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Navigate to Tunnels:</span>
                        <p className="text-slate-500 mt-0.5">
                          In the left sidebar, click <strong>Networks</strong> → select <strong>Tunnels</strong> (or <strong>Access</strong> → <strong>Tunnels</strong> in older dashboards).
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Create a New Tunnel:</span>
                        <p className="text-slate-500 mt-0.5">
                          Click <strong>Add a tunnel</strong> → choose connector type <strong>Cloudflared</strong> → name your tunnel (e.g. <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">barepod-{activeUser}</code>) → click <strong>Save tunnel</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Select Operating System & Copy Command:</span>
                        <p className="text-slate-500 mt-0.5">
                          Under <em>Install and run a connector</em>, choose <strong>Debian</strong> or <strong>Docker</strong>. Cloudflare will display an installation command such as:
                        </p>
                        <div className="mt-1.5 p-2 rounded-lg bg-slate-900 text-slate-200 font-mono text-[11px] flex items-center justify-between gap-2 overflow-x-auto">
                          <span className="truncate">sudo cloudflared service install eyJh...</span>
                          <span className="text-[10px] text-blue-400 font-sans shrink-0">(Example)</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        5
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Paste into Box 1 Below:</span>
                        <p className="text-slate-500 mt-0.5">
                          Copy the entire command or just the long token string (<code className="font-mono bg-slate-100 px-1 py-0.5 rounded">eyJh...</code>), then paste it into <strong>1. Cloudflare Zero Trust Tunnel Token</strong> below. BarePod's <em>Smart-Detection</em> will automatically isolate the raw token!
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: API TOKEN */}
              {tutorialTab === 'apiToken' && (
                <div className="space-y-3 text-xs text-slate-700">
                  <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200/80 flex items-start gap-2.5">
                    <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-900 block">Why is Cloudflare API Token Strongly Recommended?</span>
                      <span className="text-slate-600 text-[11px] leading-relaxed">
                        Without an API Token, you must manually create DNS CNAME records and Public Hostnames in the Cloudflare dashboard each time you add a website. With an API Token saved, BarePod will <strong>automatically create Public Hostnames & DNS CNAME records (1-Click Sync)</strong> whenever you deploy a site!
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2.5 pl-1">
                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Open API Tokens Page:</span>
                        <div className="mt-1">
                          <a
                            href="https://dash.cloudflare.com/profile/api-tokens"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline font-semibold bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs"
                          >
                            <span>dash.cloudflare.com/profile/api-tokens</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Create Custom Token:</span>
                        <p className="text-slate-500 mt-0.5">
                          Click <strong>Create Token</strong> → scroll to the bottom template <strong>Custom Token</strong> → click <strong>Get started</strong>.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Name & Configure Permissions (3 Permissions):</span>
                        <p className="text-slate-500 mt-0.5">
                          Name your token (e.g. <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">BarePod-{activeUser}</code>). Under the <strong>Permissions</strong> section, add these 3 permission rows:
                        </p>
                        <div className="mt-2 rounded-lg border border-slate-200 overflow-hidden text-[11px]">
                          <div className="grid grid-cols-1 sm:grid-cols-3 bg-slate-100 p-2 font-bold text-slate-700 border-b border-slate-200">
                            <span>Category</span>
                            <span>Feature</span>
                            <span>Access Level</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 p-2 border-b border-slate-100 bg-white items-center">
                            <span className="font-semibold text-blue-700">Zone</span>
                            <span>DNS</span>
                            <span className="font-bold text-emerald-600">Edit</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 p-2 border-b border-slate-100 bg-slate-50/50 items-center">
                            <span className="font-semibold text-blue-700">Zone</span>
                            <span>Zone</span>
                            <span className="font-bold text-slate-700">Read</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 p-2 bg-white items-center">
                            <span className="font-semibold text-purple-700">Account</span>
                            <span>Cloudflare Tunnel</span>
                            <span className="font-bold text-emerald-600">Edit</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        4
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Set Account & Zone Resources:</span>
                        <p className="text-slate-500 mt-0.5">
                          - <strong>Account Resources:</strong> Select <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">Include → All accounts</code><br />
                          - <strong>Zone Resources:</strong> Select <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">Include → All zones from an account</code> (or choose your specific domain)
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        5
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-900">Copy & Save Token:</span>
                        <p className="text-slate-500 mt-0.5">
                          Click <strong>Continue to summary</strong> → click <strong>Create Token</strong>. Copy the displayed API token (e.g. <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">vK9...</code>) and paste it into <strong>2. Cloudflare API Token</strong> below.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: WORKFLOW */}
              {tutorialTab === 'workflow' && (
                <div className="space-y-3 text-xs text-slate-700">
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70 flex items-start gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-emerald-900 block">All Set! How Does the Workflow Work?</span>
                      <span className="text-slate-600 text-[11px] leading-relaxed">
                        Once both tokens are saved, your tunnel runs continuously in the background and website hosting in BarePod becomes completely seamless without manual DNS configuration.
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-2xs">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 font-bold flex items-center justify-center text-xs">
                        1
                      </div>
                      <span className="font-bold text-slate-900 block">Save & Start Tunnel</span>
                      <p className="text-slate-500 text-[11px] leading-relaxed">
                        Click the blue <strong>Save Configuration & Start Tunnel</strong> button below. The daemon status will immediately transition to <strong>CONNECTED</strong>.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-2xs">
                      <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-xs">
                        2
                      </div>
                      <span className="font-bold text-slate-900 block">Deploy New Websites</span>
                      <p className="text-slate-500 text-[11px] leading-relaxed">
                        Go to <strong>Websites → Add Website</strong>. Your Cloudflare domains will be detected automatically in the dropdown. Choose a subdomain and deploy!
                      </p>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-1.5 shadow-2xs">
                      <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center text-xs">
                        3
                      </div>
                      <span className="font-bold text-slate-900 block">Live with Automatic HTTPS</span>
                      <p className="text-slate-500 text-[11px] leading-relaxed">
                        Your website is immediately accessible globally with valid Cloudflare edge SSL/TLS encryption, caching, and DDoS mitigation.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Dual Configuration Box: Run Token & API Token */}
        <form onSubmit={handleSaveToken} className="space-y-4">
          {/* Step 1: Tunnel Run Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  1. Cloudflare Zero Trust Tunnel Token (Connector)
                </label>
                {tunnelData?.hasToken && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded border border-emerald-200">
                    Configured ({tunnelData.tokenMasked})
                  </span>
                )}
              </div>
              <a 
                href="https://one.dash.cloudflare.com" 
                target="_blank" 
                rel="noreferrer" 
                className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"
              >
                <span>Cloudflare Zero Trust → Networks → Tunnels</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <Key className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showTokenText ? 'text' : 'password'}
                required={!tunnelData?.hasToken}
                value={inputToken}
                onChange={(e) => handleTokenInput(e.target.value)}
                placeholder={tunnelData?.hasToken ? 'Configured. Paste a new token to replace it…' : 'Paste token or full command (e.g. sudo cloudflared service install eyJh... or docker run ...)'}
                className="w-full pl-9 pr-10 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowTokenText(!showTokenText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title={showTokenText ? 'Hide Token' : 'Show Token'}
              >
                {showTokenText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              💡 <strong>Smart detection:</strong> You can paste the raw token (<code>eyJh...</code>) or the full copy-paste command from Cloudflare (<code>sudo cloudflared service install ...</code>, <code>docker run ...</code>, or <code>cloudflared.exe ...</code>). BarePod automatically detects and extracts the token.
            </p>
          </div>

          {/* Step 2: Cloudflare API Token (Auto-Sync) */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  2. Cloudflare API Token (Optional: Automatic Route & DNS Creation)
                </label>
                {tunnelData?.hasApiToken && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded border border-emerald-200">
                    Configured ({tunnelData.apiTokenMasked})
                  </span>
                )}
              </div>
              <a 
                href="https://dash.cloudflare.com/profile/api-tokens" 
                target="_blank" 
                rel="noreferrer" 
                className="text-[11px] text-blue-600 hover:underline flex items-center gap-1"
              >
                <span>Get API Token (Zone.DNS + Account.Tunnel)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="relative">
              <Sparkles className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-blue-500" />
              <input
                type={showApiTokenText ? 'text' : 'password'}
                value={inputApiToken}
                onChange={(e) => setInputApiToken(e.target.value)}
                placeholder={tunnelData?.hasApiToken ? 'Token configured. Enter new token to overwrite...' : 'Paste Cloudflare API Token to automatically create hostnames in Cloudflare'}
                className="w-full pl-9 pr-10 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowApiTokenText(!showApiTokenText)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title={showApiTokenText ? 'Hide API Token' : 'Show API Token'}
              >
                {showApiTokenText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              <strong>1-Click Auto Sync:</strong> With your Cloudflare API Token saved, adding an ingress domain in BarePod will <strong>automatically create the Public Hostname and DNS CNAME in Cloudflare</strong> for you!
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end">
            <button
              type="submit"
              disabled={isTokenSaving}
              className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20 shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isTokenSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Connecting...</span>
                </>
              ) : isTokenSaved ? (
                <>
                  <Check className="w-4 h-4 text-emerald-200" />
                  <span>Configuration Saved!</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Save Configuration & Start Tunnel</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Ingress Domain Routes Table for This User */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Your Ingress Domains</h2>
              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                {tunnelData?.routes.length || 0} Domain
              </span>
              {tunnelData?.autoSync && (
                <span className="text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200/60 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                  <Check className="w-3 h-3 text-emerald-600" /> Auto-Sync Active
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Hostnames forwarded to local application ports on <strong>@{activeUser}</strong>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Routes that no website or the panel's own domain claims are removed automatically, in Cloudflare too.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {tunnelData?.hasApiToken && (
              <button
                onClick={handleSyncFromCloudflare}
                disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg shadow-2xs transition-all cursor-pointer disabled:opacity-50"
                title="Pull existing routes from Cloudflare Dashboard"
              >
                <ArrowDownToLine className={`w-3.5 h-3.5 text-blue-600 ${syncing ? 'animate-bounce' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync from Cloudflare'}</span>
              </button>
            )}

            <button
              onClick={handleOpenAddModal}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Ingress Domain</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-blue-600 mb-2" />
            <p className="text-xs font-semibold text-slate-600">Loading tunnel routes...</p>
          </div>
        ) : !tunnelData || tunnelData.routes.length === 0 ? (
          <div className="p-8 text-center text-slate-400 space-y-2">
            <Globe className="w-8 h-8 mx-auto text-slate-300 mb-1" />
            <p className="text-xs font-semibold text-slate-600">No domains routed yet.</p>
            <p className="text-[11px] text-slate-400 max-w-md mx-auto">
              Click "+ Add Ingress Domain" above to connect your website to your Cloudflare Zero Trust tunnel.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="min-w-[560px] w-full text-left text-xs">
            <thead className="bg-slate-50/75 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[10px]">
              <tr>
                <th className="py-3 px-4">Public Hostname (Cloudflare)</th>
                <th className="py-3 px-4">Your App Target</th>
                <th className="py-3 px-4">Internal Target Port</th>
                <th className="py-3 px-4">Health Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tunnelData.routes.map((route, idx) => (
                <tr key={route.id || idx} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-500 shrink-0" />
                      <a 
                        href={`https://${route.hostname}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="font-semibold text-slate-800 hover:text-blue-600 hover:underline flex items-center gap-1 font-mono"
                      >
                        {route.hostname}
                        <ExternalLink className="w-3 h-3 text-slate-400" />
                      </a>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-700">
                    {route.appName || 'BarePod App'}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600">
                    <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] font-mono border border-slate-200/60">
                      {route.service}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {route.status || 'Healthy'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleEditRoute(route)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                        title="Edit Ingress Route"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => void handleDeleteRoute(route)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Delete Ingress Route (also removes it in Cloudflare)"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Add / Edit Route Modal */}
      {isAddRouteOpen && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  {editingRoute ? 'Edit Ingress Route' : 'Connect a Domain to Your App'}
                </h3>
              </div>
              <button
                onClick={() => setIsAddRouteOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRoute} className="p-6 space-y-4 text-xs">
              {/* Select from existing apps helper */}
              {tunnelData?.availableApps && tunnelData.availableApps.length > 0 && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Select BarePod Website (Auto-fill Ingress)
                  </label>
                  <select
                    value={selectedAppSlug}
                    onChange={(e) => handleAppSelect(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                  >
                    <option value="">-- Choose an installed website --</option>
                    {tunnelData.availableApps.map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.slug} ({a.domain}) → {a.targetUrl || 'Edge Ingress'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block font-semibold text-slate-700">
                    Public Hostname
                  </label>
                  {zones.length > 0 && (
                    <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> {zones.length} Cloudflare Zone{zones.length > 1 ? 's' : ''} Connected
                    </span>
                  )}
                </div>

                {zones.length > 0 ? (
                  <div className="space-y-2.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Select Cloudflare Domain (Zone)
                        </label>
                        <select
                          value={selectedZone}
                          onChange={(e) => {
                            const newZone = e.target.value;
                            setSelectedZone(newZone);
                            setNewHostname(computeHostname(subdomain, newZone, newHostname));
                          }}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono text-xs cursor-pointer shadow-2xs"
                        >
                          {zones.map((z) => (
                            <option key={z.id} value={z.name}>
                              🌐 {z.name}
                            </option>
                          ))}
                          <option value="custom">✏️ Custom Domain (Manual Input)</option>
                        </select>
                      </div>

                      {selectedZone !== 'custom' ? (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Subdomain Prefix
                          </label>
                          <div className="flex items-center shadow-2xs rounded-lg overflow-hidden border border-slate-200 focus-within:border-blue-500 bg-white">
                            <input
                              type="text"
                              placeholder="subdomain (or blank / @ for apex)"
                              value={subdomain}
                              onChange={(e) => {
                                const newSub = e.target.value;
                                setSubdomain(newSub);
                                setNewHostname(computeHostname(newSub, selectedZone, newHostname));
                              }}
                              className="w-full px-3 py-2 bg-transparent focus:outline-hidden font-mono text-xs text-slate-900"
                            />
                            <span className="px-2.5 py-2 bg-slate-100/80 border-l border-slate-200 text-slate-500 text-xs font-mono font-medium whitespace-nowrap">
                              .{selectedZone}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            Full Hostname
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. app.yourdomain.com"
                            value={newHostname}
                            onChange={(e) => setNewHostname(e.target.value)}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono text-xs shadow-2xs"
                          />
                        </div>
                      )}
                    </div>

                    {selectedZone !== 'custom' && (
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-200/60">
                        <span className="flex items-center gap-1.5">
                          Target:
                          <strong className="font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/60">
                            {computeHostname(subdomain, selectedZone, newHostname) || 'Enter subdomain...'}
                          </strong>
                        </span>
                        <span className="text-[10px] text-slate-400">Leave blank for root apex domain</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="e.g. app.yourdomain.com or mywebsite.id"
                      value={newHostname}
                      onChange={(e) => setNewHostname(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono text-xs"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Tip: Add Cloudflare API Token above to automatically list your Cloudflare zones here.
                    </p>
                  </div>
                )}

                {tunnelData?.autoSync ? (
                  <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1 font-medium">
                    <Sparkles className="w-3 h-3" /> Auto-sync enabled: This route and DNS CNAME will be created automatically in Cloudflare!
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-400 mt-1">
                    Make sure this hostname is also added under Public Hostnames in your Cloudflare dashboard, or add API Token above.
                  </p>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  App Name / Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. Laravel App or FastAPI Service"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800">
                    Internal Service URL & Port
                  </label>
                  <span className="text-[10px] text-slate-400 font-medium">
                    Traffic forwarding destination
                  </span>
                </div>

                {/* Modern Preset Cards */}
                <div className={`grid grid-cols-1 ${
                  selectedAppSlug && tunnelData?.availableApps?.find(a => a.slug === selectedAppSlug)?.targetUrl && 
                  !['http://127.0.0.1:80', 'https://127.0.0.1:443'].includes(tunnelData?.availableApps?.find(a => a.slug === selectedAppSlug)?.targetUrl || '')
                    ? 'sm:grid-cols-3'
                    : 'sm:grid-cols-2'
                } gap-2`}>
                  {/* Preset 1: Port 80 (Edge Ingress) */}
                  <button
                    type="button"
                    onClick={() => {
                      setNewTargetService('http://127.0.0.1:80');
                      setNoTlsVerify(false);
                    }}
                    className={`relative p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      newTargetService === 'http://127.0.0.1:80'
                        ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/20 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      newTargetService === 'http://127.0.0.1:80'
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      <Zap className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-800">Edge HTTP</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-100 text-blue-700">
                          Recommended
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                        http://127.0.0.1:80
                      </p>
                    </div>
                  </button>

                  {/* Preset 2: Port 443 (Edge HTTPS) */}
                  <button
                    type="button"
                    onClick={() => {
                      setNewTargetService('https://127.0.0.1:443');
                      setNoTlsVerify(true);
                    }}
                    className={`relative p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                      newTargetService === 'https://127.0.0.1:443'
                        ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/20 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      newTargetService === 'https://127.0.0.1:443'
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-slate-800">Edge HTTPS</span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                          Port 443
                        </span>
                      </div>
                      <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                        https://127.0.0.1:443
                      </p>
                    </div>
                  </button>

                  {/* Preset 3: Direct App Port (if available and different) */}
                  {(() => {
                    const customTarget = tunnelData?.availableApps?.find(a => a.slug === selectedAppSlug)?.targetUrl;
                    if (!customTarget || ['http://127.0.0.1:80', 'https://127.0.0.1:443'].includes(customTarget)) {
                      return null;
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setNewTargetService(customTarget);
                          setNoTlsVerify(customTarget.startsWith('https://'));
                        }}
                        className={`relative p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 ${
                          newTargetService === customTarget
                            ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/20 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                        }`}
                      >
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                          newTargetService === customTarget
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          <Server className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-xs font-bold text-slate-800">App Direct</span>
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700">
                              Port
                            </span>
                          </div>
                          <p className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                            {customTarget}
                          </p>
                        </div>
                      </button>
                    );
                  })()}
                </div>

                {/* Target URL Input Field */}
                <div className="pt-1">
                  <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus-within:border-blue-500 focus-within:bg-white transition-colors">
                    <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      required
                      placeholder="http://127.0.0.1:80"
                      value={newTargetService}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewTargetService(val);
                        if (val.startsWith('https://')) {
                          setNoTlsVerify(true);
                        }
                      }}
                      className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800 font-mono text-xs font-medium"
                    />
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Target destination forwarded by cloudflared. You can click a preset above or type a custom address.
                  </span>
                </div>

              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddRouteOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingRoute}
                  className="px-4 py-2 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isSavingRoute ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Syncing to Cloudflare...</span>
                    </>
                  ) : (
                    <span>{editingRoute ? 'Update Ingress Route' : 'Save Ingress Domain'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- UNLINK TUNNEL CONFIRMATION MODAL --- */}
      {showUnlinkConfirm && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100">
                  <Unlink className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Unlink Cloudflare Tunnel</h3>
                  <p className="text-xs text-slate-500">Disconnect tunnel daemon for user @{activeUser}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUnlinkConfirm(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs text-slate-600">
              <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-rose-800 text-xs">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>Warning: This will stop the tunnel daemon</span>
                </div>
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  The <code>cloudflared@{activeUser}</code> systemd service will be stopped and disabled. Tunnel token credentials in the panel will be permanently deleted. Any public domain pointing to this tunnel will become unreachable until reconnected.
                </p>
                <p className="text-[10px] text-rose-600 italic">
                  Note: If you are currently accessing this panel through this exact tunnel, your browser session will disconnect.
                </p>
              </div>

              <p className="text-slate-500 text-[11px]">
                Are you sure you want to disconnect and unlink this tunnel now?
              </p>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isUnlinking}
                onClick={() => setShowUnlinkConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isUnlinking}
                onClick={handleUnlink}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm shadow-rose-500/20 cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-colors"
              >
                {isUnlinking ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <>
                    <Unlink className="w-3.5 h-3.5" />
                    <span>Yes, Unlink Tunnel</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
