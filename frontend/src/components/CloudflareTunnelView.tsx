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
  Trash2,
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
  Pencil
} from 'lucide-react';
import { api, type TunnelStatusResponse, type IngressRouteDTO } from '../api/client';

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

  // Fetch tunnel status from real backend
  const fetchTunnel = useCallback(async (user: string, isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const data = await api.tunnelStatus(user);
      setTunnelData(data);
      setInputToken(data.token || '');
    } catch (err: any) {
      console.error('Failed to load tunnel status:', err);
      onShowToast?.('Failed to load tunnel', err?.message || 'Could not reach server', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onShowToast]);

  useEffect(() => {
    fetchTunnel(activeUser);
  }, [activeUser, fetchTunnel]);

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
    try {
      const updated = await api.saveTunnelToken(
        cleanedToken, 
        inputApiToken.trim() || undefined, 
        activeUser
      );
      setTunnelData(updated);
      setInputToken(updated.token || '');
      setInputApiToken('');
      setIsTokenSaved(true);
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

  const handleOpenAddModal = () => {
    setEditingRoute(null);
    setSelectedAppSlug('');
    setNewHostname('');
    setNewAppName('');
    setNewTargetService('http://127.0.0.1:80');
    setNoTlsVerify(false);
    setIsAddRouteOpen(true);
    if (tunnelData?.availableApps && tunnelData.availableApps.length > 0) {
      handleAppSelect(tunnelData.availableApps[0].slug);
    }
  };

  const handleEditRoute = (route: IngressRouteDTO) => {
    setEditingRoute(route);
    setSelectedAppSlug('');
    setNewHostname(route.hostname);
    setNewAppName(route.appName || '');
    setNewTargetService(route.service || 'http://127.0.0.1:80');
    setNoTlsVerify(route.service.startsWith('https://'));
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
      if (!newHostname && found.domain) {
        setNewHostname(found.domain);
      }
    }
  };

  // Add / Edit Route
  const handleSaveRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHostname.trim()) return;

    setIsSavingRoute(true);
    try {
      if (editingRoute) {
        await api.updateTunnelRoute(editingRoute.id, newHostname.trim(), newTargetService.trim(), newAppName.trim(), noTlsVerify, activeUser);
        onShowToast?.(
          'Ingress Domain Updated',
          `Route for ${newHostname.trim()} updated to ${newTargetService.trim()}`,
          'success'
        );
      } else {
        await api.addTunnelRoute(newHostname.trim(), newTargetService.trim(), newAppName.trim(), noTlsVerify, activeUser);
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

  // Delete Route
  const handleDeleteRoute = async (idOrHostname: string, hostnameDisplay: string) => {
    try {
      await api.deleteTunnelRoute(idOrHostname, activeUser);
      await fetchTunnel(activeUser, true);
      onShowToast?.(
        'Ingress Domain Removed',
        `Hostname ${hostnameDisplay} was removed from your tunnel.`,
        'info'
      );
    } catch (err: any) {
      onShowToast?.('Failed to Delete Route', err?.message || 'Server error', 'error');
    }
  };

  const isConnected = tunnelData?.status === 'connected';
  const isConfiguring = tunnelData?.status === 'configuring';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
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

        {/* Dual Configuration Box: Run Token & API Token */}
        <form onSubmit={handleSaveToken} className="space-y-4">
          {/* Step 1: Tunnel Run Token */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800">
                1. Cloudflare Zero Trust Tunnel Token (Connector)
              </label>
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
                required
                value={inputToken}
                onChange={(e) => handleTokenInput(e.target.value)}
                placeholder="Paste token or full command (e.g. sudo cloudflared service install eyJh... or docker run ...)"
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
          <table className="w-full text-left text-xs">
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
                        onClick={() => handleDeleteRoute(route.id, route.hostname)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        title="Remove this domain from the tunnel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add / Edit Route Modal */}
      {isAddRouteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
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

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Public Hostname (Cloudflare Zone Domain / Subdomain)
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. app.yourdomain.com or mywebsite.id"
                  value={newHostname}
                  onChange={(e) => setNewHostname(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                />
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

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700">
                    Internal Service URL & Port
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTargetService('http://127.0.0.1:80');
                      setNoTlsVerify(false);
                    }}
                    className="text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Zap className="w-3 h-3" /> Auto Edge Ingress (Port 80)
                  </button>
                </div>
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
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
                />
                
                {/* Quick Ingress Presets */}
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[10px] text-slate-400">Presets:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTargetService('http://127.0.0.1:80');
                      setNoTlsVerify(false);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      newTargetService === 'http://127.0.0.1:80'
                        ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    ⚡ Edge Ingress (http://127.0.0.1:80)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewTargetService('https://127.0.0.1:443');
                      setNoTlsVerify(true);
                    }}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      newTargetService === 'https://127.0.0.1:443'
                        ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    🔒 HTTPS (https://127.0.0.1:443)
                  </button>
                </div>

                <div className="mt-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={noTlsVerify}
                      onChange={(e) => setNoTlsVerify(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-800 text-[11px] block">
                        No TLS Verify (Bypass Origin SSL Check)
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Check this if targeting HTTPS (e.g. port 443 with self-signed certificate) to avoid 502 Bad Gateway.
                      </span>
                    </div>
                  </label>
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
    </div>
  );
};
