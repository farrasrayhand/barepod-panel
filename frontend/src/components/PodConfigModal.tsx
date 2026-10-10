import React, { useState } from 'react';
import { 
  X, 
  Box, 
  Globe, 
  ExternalLink, 
  Sliders, 
  HardDrive, 
  Cpu, 
  Terminal, 
  Play, 
  Square, 
  RotateCw, 
  Copy, 
  Check, 
  ShieldCheck, 
  Eye, 
  EyeOff, 
  Plus, 
  Trash2, 
  FileText, 
  Layers, 
  FileCode,
  Cloud,
  Lock,
  AlertTriangle,
  Key,
  Shield
} from 'lucide-react';
import type { PodItem, PodEnvVar, PodVolumeMount } from '../types';
import { MaintenancePreviewModal } from './MaintenancePreviewModal';
import { BasicAuthPromptModal } from './BasicAuthPromptModal';

interface PodConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  pod: PodItem | null;
  onSaveConfig: (updatedPod: PodItem) => void;
  onToggleStatus: (podId: string) => void;
  onOpenTerminal?: () => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
}

export const PodConfigModal: React.FC<PodConfigModalProps> = ({
  isOpen,
  onClose,
  pod,
  onSaveConfig,
  onToggleStatus,
  onOpenTerminal,
  onShowToast,
}) => {
  if (!isOpen || !pod) return null;

  const [activeTab, setActiveTab] = useState<'overview' | 'web' | 'env' | 'storage' | 'yaml' | 'logs'>('overview');
  
  // Local editable state
  const [name, setName] = useState(pod.name);
  const [isWebApp, setIsWebApp] = useState(pod.isWebApp ?? !!pod.webDomain);
  const [webDomain, setWebDomain] = useState(pod.webDomain || `${pod.name}.demo.barepod.cloud`);
  const [webPort, setWebPort] = useState(pod.webPort || 80);
  const [sslEnabled, setSslEnabled] = useState(pod.sslEnabled ?? true);
  const [useCloudflareTunnel, setUseCloudflareTunnel] = useState(pod.useCloudflareTunnel ?? false);
  const [ports, setPorts] = useState(pod.ports);
  const [restartPolicy, setRestartPolicy] = useState(pod.restartPolicy);
  const [memoryLimit, setMemoryLimit] = useState(pod.memoryLimit || '512 MB');
  const [cpuLimit, setCpuLimit] = useState(pod.cpuLimit || '1.0 core');

  // Maintenance & Basic Auth State for Web Container
  const [maintenanceMode, setMaintenanceMode] = useState(pod.maintenanceMode ?? false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    pod.maintenanceMessage || 'Container ini sedang dalam pemeliharaan berkala. Silakan coba beberapa saat lagi.'
  );
  const [maintenanceBypassIps, setMaintenanceBypassIps] = useState(pod.maintenanceBypassIps || '127.0.0.1, 103.147.154.82');
  const [basicAuthEnabled, setBasicAuthEnabled] = useState(pod.basicAuthEnabled ?? false);
  const [basicAuthUser, setBasicAuthUser] = useState(pod.basicAuthUser || 'admin');
  const [basicAuthPassword, setBasicAuthPassword] = useState(pod.basicAuthPassword || 'Pod$ecure2026!');
  const [basicAuthRealm, setBasicAuthRealm] = useState(pod.basicAuthRealm || `${pod.name} - Protected Container`);
  const [basicAuthBypassIps, setBasicAuthBypassIps] = useState(pod.basicAuthBypassIps || '');
  const [showBasicAuthPassword, setShowBasicAuthPassword] = useState(false);
  const [isPreviewMaintenanceOpen, setIsPreviewMaintenanceOpen] = useState(false);
  const [isTestBasicAuthOpen, setIsTestBasicAuthOpen] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleGeneratePassword = () => {
    const charset = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    let pass = '';
    for (let i = 0; i < 16; i++) {
      pass += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    setBasicAuthPassword(pass);
    onShowToast?.('Password Baru Dibuat', 'Kombinasi 16-karakter acak berhasil dibuat.', 'info');
  };

  const handleCopyCurl = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
    onShowToast?.('Perintah Copied', 'cURL command disalin ke clipboard.', 'info');
  };

  // Envs
  const [envVars, setEnvVars] = useState<PodEnvVar[]>(pod.envVars || [
    { key: 'PORT', value: String(pod.webPort || 80), isSecret: false },
    { key: 'NODE_ENV', value: 'production', isSecret: false },
  ]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Volumes
  const [volumes, setVolumes] = useState<PodVolumeMount[]>(pod.volumes || [
    { hostPath: `${pod.name}_data`, containerPath: '/data', readOnly: false }
  ]);

  const isRunning = pod.status === 'running';

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    onShowToast?.('Copied', 'Configuration copied to clipboard.', 'info');
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '', isSecret: false }]);
  };

  const handleRemoveEnv = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleEnvChange = (index: number, field: keyof PodEnvVar, value: any) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: value };
    setEnvVars(updated);
  };

  const handleAddVolume = () => {
    setVolumes([...volumes, { hostPath: '', containerPath: '', readOnly: false }]);
  };

  const handleRemoveVolume = (index: number) => {
    setVolumes(volumes.filter((_, i) => i !== index));
  };

  const handleVolumeChange = (index: number, field: keyof PodVolumeMount, value: any) => {
    const updated = [...volumes];
    updated[index] = { ...updated[index], [field]: value };
    setVolumes(updated);
  };

  const handleSave = () => {
    const updated: PodItem = {
      ...pod,
      name,
      isWebApp,
      webDomain: isWebApp ? webDomain.trim() : undefined,
      webPort: isWebApp ? webPort : undefined,
      sslEnabled: isWebApp ? sslEnabled : undefined,
      useCloudflareTunnel: isWebApp ? useCloudflareTunnel : undefined,
      maintenanceMode: isWebApp ? maintenanceMode : undefined,
      maintenanceMessage: isWebApp ? maintenanceMessage : undefined,
      maintenanceBypassIps: isWebApp ? maintenanceBypassIps : undefined,
      basicAuthEnabled: isWebApp ? basicAuthEnabled : undefined,
      basicAuthUser: isWebApp ? basicAuthUser : undefined,
      basicAuthPassword: isWebApp ? basicAuthPassword : undefined,
      basicAuthRealm: isWebApp ? basicAuthRealm : undefined,
      basicAuthBypassIps: isWebApp ? basicAuthBypassIps : undefined,
      ports,
      restartPolicy,
      memoryLimit,
      cpuLimit,
      envVars: envVars.filter(ev => ev.key.trim().length > 0),
      volumes: volumes.filter(v => v.containerPath.trim().length > 0),
    };
    onSaveConfig(updated);
    onShowToast?.('Configuration Saved', `Container ${pod.name} settings updated and container restarted.`, 'success');
    onClose();
  };

  // Generate docker-compose representation
  const generatedCompose = pod.composeContent || `version: '3.8'

services:
  ${name}:
    image: ${pod.image}
    container_name: ${name}
    restart: ${restartPolicy}
    ports:
      - "${ports || `${webPort}:${webPort}`}"
    environment:
${envVars.map(ev => `      - ${ev.key}=${ev.value}`).join('\n')}
    volumes:
${volumes.map(v => `      - ${v.hostPath}:${v.containerPath}${v.readOnly ? ':ro' : ''}`).join('\n')}
${isWebApp ? `    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${name}.rule=Host(\`${webDomain}\`)"
      - "traefik.http.routers.${name}.entrypoints=websecure"
      - "traefik.http.routers.${name}.tls.certresolver=letsencrypt"` : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-2xs">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">{pod.name}</h2>
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  isRunning 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                    : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {isRunning ? 'Running' : 'Stopped'}
                </span>
                {isWebApp && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                    Web App
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{pod.image}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isWebApp && webDomain && (
              <a
                href={`https://${webDomain}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shadow-2xs"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Open Web App</span>
                <ExternalLink className="w-3 h-3 text-blue-500" />
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-200 bg-white text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Box className="w-4 h-4" />
            <span>Overview & Controls</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('web')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'web'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Web Routing & Domain</span>
            {isWebApp && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('env')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'env'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>Environment ({envVars.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'storage'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>Volumes & Ports</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('yaml')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'yaml'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <FileCode className="w-4 h-4" />
            <span>Compose / Dockerfile</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('logs')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === 'logs'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Live Logs</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Quick Metrics & State */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-medium block">CPU USAGE</span>
                  <span className="text-base font-bold text-slate-800">{pod.cpu || '0.4%'}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Quota: {cpuLimit}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-medium block">MEMORY (RAM)</span>
                  <span className="text-base font-bold text-slate-800">{pod.memory || '48 MB'}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">Limit: {memoryLimit}</span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-medium block">PORT MAPPING</span>
                  <span className="text-xs font-mono font-bold text-slate-800 truncate block mt-1">
                    {ports || 'None'}
                  </span>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-medium block">RESTART POLICY</span>
                  <span className="text-xs font-semibold text-slate-800 truncate block mt-1">
                    {restartPolicy}
                  </span>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => onToggleStatus(pod.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      isRunning 
                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' 
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isRunning ? 'Stop Pod' : 'Start Pod'}</span>
                  </button>

                  <button
                    onClick={() => {
                      onShowToast?.('Container Restarting', `Restart signal sent to ${pod.name}.`, 'info');
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Restart Container</span>
                  </button>

                  <button
                    onClick={() => {
                      onClose();
                      onOpenTerminal?.();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 rounded-lg"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Exec Shell Terminal</span>
                  </button>
                </div>

                <span className="text-[11px] text-slate-400 font-mono">
                  Container ID: {pod.id}
                </span>
              </div>

              {/* General Settings */}
              <div className="space-y-4 pt-2">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Basic Pod Properties
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Pod Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Restart Policy
                    </label>
                    <select
                      value={restartPolicy}
                      onChange={(e) => setRestartPolicy(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                    >
                      <option value="unless-stopped">unless-stopped</option>
                      <option value="always">always</option>
                      <option value="on-failure">on-failure</option>
                      <option value="no">no</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: WEB ROUTING */}
          {activeTab === 'web' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="modalWebAppToggle"
                  checked={isWebApp}
                  onChange={(e) => setIsWebApp(e.target.checked)}
                  className="mt-1 w-4 h-4 text-purple-600 rounded border-slate-300"
                />
                <div className="flex-1">
                  <label htmlFor="modalWebAppToggle" className="text-xs font-bold text-slate-900 cursor-pointer block">
                    Expose as Web Application (HTTP / HTTPS Ingress)
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Hubungkan container ke internal reverse proxy BarePod Panel untuk routing domain publik dan auto SSL.
                  </p>
                </div>
              </div>

              {isWebApp ? (
                <div className="space-y-4 p-4 rounded-xl border border-purple-200 bg-purple-50/20">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Public Domain / FQDN
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                          <Globe className="w-3.5 h-3.5" />
                        </div>
                        <input
                          type="text"
                          value={webDomain}
                          onChange={(e) => setWebDomain(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                        />
                      </div>
                      {webDomain && (
                        <a
                          href={`https://${webDomain}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-3 py-2 text-xs font-bold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Visit URL</span>
                        </a>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        Container Internal Port
                      </label>
                      <input
                        type="number"
                        value={webPort}
                        onChange={(e) => setWebPort(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg font-mono"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Port tempat aplikasi container Anda me-listen traffic HTTP (misal 5678, 3000, 8080).
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        SSL / TLS Security
                      </label>
                      <label className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sslEnabled}
                          onChange={(e) => setSslEnabled(e.target.checked)}
                          className="w-4 h-4 text-purple-600 rounded border-slate-300"
                        />
                        <span className="text-xs text-slate-700 font-medium flex items-center gap-1">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                          Auto Let's Encrypt SSL
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-purple-100 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="modalCfTunnelToggle"
                      checked={useCloudflareTunnel}
                      onChange={(e) => setUseCloudflareTunnel(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-purple-600 rounded border-slate-300"
                    />
                    <div>
                      <label htmlFor="modalCfTunnelToggle" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                        <Cloud className="w-3.5 h-3.5 text-blue-600" />
                        Rute melalui Isolated Cloudflare Tunnel Tenant
                      </label>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Container ini akan otomatis ditambahkan ke Ingress Rule Cloudflare Tunnel pribadi milik Anda tanpa perlu membuka port router/VPS publik.
                      </p>
                    </div>
                  </div>

                  {/* ACCESS CONTROL: MAINTENANCE & BASIC AUTH FOR WEB POD */}
                  <div className="pt-4 border-t border-purple-200/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Shield className="w-4 h-4 text-purple-700" />
                        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                          Edge Access Control & Traffic Protection
                        </h4>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px]">
                        {maintenanceMode && (
                          <span className="px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-300">
                            503 Maintenance
                          </span>
                        )}
                        {basicAuthEnabled && (
                          <span className="px-2 py-0.5 rounded-full font-bold bg-purple-100 text-purple-800 border border-purple-300">
                            🔒 Basic Auth
                          </span>
                        )}
                      </div>
                    </div>

                    {/* SECTION A: MAINTENANCE MODE */}
                    <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className={`w-4 h-4 ${maintenanceMode ? 'text-amber-600' : 'text-slate-400'}`} />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">
                              Maintenance Mode (HTTP 503)
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Kirim respons HTTP 503 Service Unavailable ke pengunjung
                            </span>
                          </div>
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={maintenanceMode}
                            onChange={(e) => setMaintenanceMode(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500" />
                        </label>
                      </div>

                      {maintenanceMode && (
                        <div className="space-y-2.5 pt-2 border-t border-slate-100 animate-in fade-in duration-150">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Pesan Downtime Pemeliharaan
                            </label>
                            <input
                              type="text"
                              value={maintenanceMessage}
                              onChange={(e) => setMaintenanceMessage(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                              placeholder="Container ini sedang dalam pemeliharaan berkala."
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              IP Whitelist Bypass (Developer / Admin)
                            </label>
                            <input
                              type="text"
                              value={maintenanceBypassIps}
                              onChange={(e) => setMaintenanceBypassIps(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                              placeholder="127.0.0.1, 103.147.154.82"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => setIsPreviewMaintenanceOpen(true)}
                            className="text-xs font-bold text-amber-700 hover:text-amber-900 flex items-center gap-1 pt-0.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Preview Halaman 503 Container</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* SECTION B: HTTP BASIC AUTH */}
                    <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <Lock className={`w-4 h-4 ${basicAuthEnabled ? 'text-purple-600' : 'text-slate-400'}`} />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">
                              HTTP Basic Authentication (.htpasswd)
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Kunci akses web container dengan user & password
                            </span>
                          </div>
                        </div>

                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={basicAuthEnabled}
                            onChange={(e) => setBasicAuthEnabled(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-purple-600" />
                        </label>
                      </div>

                      {basicAuthEnabled && (
                        <div className="space-y-2.5 pt-2 border-t border-slate-100 animate-in fade-in duration-150">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                                Username
                              </label>
                              <input
                                type="text"
                                value={basicAuthUser}
                                onChange={(e) => setBasicAuthUser(e.target.value)}
                                className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                              />
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[11px] font-bold text-slate-700">
                                  Password
                                </label>
                                <button
                                  type="button"
                                  onClick={handleGeneratePassword}
                                  className="text-[10px] font-bold text-purple-600 hover:text-purple-800"
                                >
                                  ⚡ Generate
                                </button>
                              </div>
                              <div className="relative">
                                <input
                                  type={showBasicAuthPassword ? 'text' : 'password'}
                                  value={basicAuthPassword}
                                  onChange={(e) => setBasicAuthPassword(e.target.value)}
                                  className="w-full px-2.5 py-1.5 pr-8 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowBasicAuthPassword(!showBasicAuthPassword)}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                >
                                  {showBasicAuthPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Realm Title (Pesan Dialog Browser)
                            </label>
                            <input
                              type="text"
                              value={basicAuthRealm}
                              onChange={(e) => setBasicAuthRealm(e.target.value)}
                              className="w-full px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-medium"
                            />
                          </div>

                          <div className="flex items-center justify-between pt-1">
                            <button
                              type="button"
                              onClick={() => setIsTestBasicAuthOpen(true)}
                              className="text-xs font-bold text-purple-700 hover:text-purple-900 flex items-center gap-1"
                            >
                              <Key className="w-3.5 h-3.5" />
                              <span>Uji Dialog Otentikasi (Simulator)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyCurl(`curl -i -u "${basicAuthUser}:${basicAuthPassword}" https://${webDomain}`)}
                              className="text-[10px] font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded"
                            >
                              {copiedCurl ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                              <span>{copiedCurl ? 'Copied' : 'Copy cURL'}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs text-slate-500">
                  Container ini beroperasi dalam mode non-web (backend worker atau caching pod). Centang kotak di atas jika ingin menambahkan domain web.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ENVIRONMENT */}
          {activeTab === 'env' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Active Environment Variables</h3>
                  <p className="text-[11px] text-slate-500">Nilai akan disuntikkan ke runtime process container.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const envStr = envVars.map(e => `${e.key}=${e.value}`).join('\n');
                      handleCopy(envStr, 'all-env');
                    }}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold"
                  >
                    {copiedKey === 'all-env' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>Export .env</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAddEnv}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold border border-purple-200"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Variable</span>
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {envVars.map((ev, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="KEY"
                      value={ev.key}
                      onChange={(e) => handleEnvChange(idx, 'key', e.target.value.toUpperCase())}
                      className="w-1/3 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono uppercase"
                    />
                    <span className="text-slate-400 font-mono text-xs">=</span>
                    <input
                      type={ev.isSecret ? "password" : "text"}
                      placeholder="VALUE"
                      value={ev.value}
                      onChange={(e) => handleEnvChange(idx, 'value', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleEnvChange(idx, 'isSecret', !ev.isSecret)}
                      className={`text-[10px] px-2 py-1 rounded border font-medium ${
                        ev.isSecret ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      {ev.isSecret ? 'Masked' : 'Text'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveEnv(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: STORAGE & PORTS */}
          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Exposed Host Port Mapping
                </label>
                <input
                  type="text"
                  value={ports}
                  onChange={(e) => setPorts(e.target.value)}
                  placeholder="e.g. 5678:5678 or 8080:80"
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Mounted Storage Volumes</h3>
                    <p className="text-[11px] text-slate-500">Persistent mapping antara filesystem server host dan container.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddVolume}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold border border-purple-200"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Volume</span>
                  </button>
                </div>

                {volumes.map((v, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Volume Name or /host/path"
                      value={v.hostPath}
                      onChange={(e) => handleVolumeChange(idx, 'hostPath', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                    <span className="text-slate-400 font-mono text-xs">:</span>
                    <input
                      type="text"
                      placeholder="/container/mount/path"
                      value={v.containerPath}
                      onChange={(e) => handleVolumeChange(idx, 'containerPath', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveVolume(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: COMPOSE / DOCKERFILE */}
          {activeTab === 'yaml' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900">
                  {pod.sourceType === 'dockerfile' ? 'Dockerfile Definition' : 'docker-compose.yml Orchestration'}
                </h3>
                <button
                  type="button"
                  onClick={() => handleCopy(pod.dockerfileContent || generatedCompose, 'raw-yaml')}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold"
                >
                  {copiedKey === 'raw-yaml' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy YAML</span>
                </button>
              </div>
              <pre className="p-4 bg-slate-950 text-emerald-400 rounded-xl font-mono text-xs overflow-x-auto max-h-72 border border-slate-800">
                {pod.dockerfileContent || generatedCompose}
              </pre>
            </div>
          )}

          {/* TAB 6: LIVE LOGS */}
          {activeTab === 'logs' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs font-bold text-slate-900">Streaming Docker Logs</span>
                </div>
                <button
                  onClick={() => onShowToast?.('Logs Cleared', 'Terminal buffer cleared.', 'info')}
                  className="text-[10px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                >
                  Clear Buffer
                </button>
              </div>

              <div className="bg-slate-950 text-slate-300 font-mono text-[11px] p-4 rounded-xl max-h-72 overflow-y-auto space-y-1 border border-slate-800">
                <p className="text-slate-500">[2026-10-10 19:04:12] [docker] Container {pod.name} starting up with entrypoint...</p>
                <p className="text-slate-500">[2026-10-10 19:04:13] [init] Allocating memory pool: {memoryLimit}</p>
                <p className="text-emerald-400">[2026-10-10 19:04:14] [ready] Listening on container port {webPort || 80}</p>
                {isWebApp && (
                  <p className="text-blue-400">[2026-10-10 19:04:15] [ingress] Reverse proxy route mapped: https://{webDomain} -&gt; 127.0.0.1:{webPort || 80}</p>
                )}
                {useCloudflareTunnel && (
                  <p className="text-purple-400">[2026-10-10 19:04:16] [cloudflared] Tunnel ingress connector established for tenant.</p>
                )}
                <p className="text-slate-400">[2026-10-10 19:04:20] [healthcheck] HTTP 200 OK - Health probe passed</p>
                <p className="text-slate-400">[2026-10-10 19:05:01] [worker] Background worker heartbeat active. CPU: {pod.cpu}</p>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm shadow-purple-500/25 transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save & Apply Changes</span>
          </button>
        </div>

      </div>

      {/* Maintenance Preview Simulator Modal for Container */}
      <MaintenancePreviewModal
        isOpen={isPreviewMaintenanceOpen}
        onClose={() => setIsPreviewMaintenanceOpen(false)}
        domain={webDomain}
        appName={name}
        message={maintenanceMessage}
        bypassIps={maintenanceBypassIps}
      />

      {/* HTTP Basic Auth Simulator Modal for Container */}
      <BasicAuthPromptModal
        isOpen={isTestBasicAuthOpen}
        onClose={() => setIsTestBasicAuthOpen(false)}
        domain={webDomain}
        expectedUser={basicAuthUser}
        expectedPass={basicAuthPassword}
        realm={basicAuthRealm}
      />

    </div>
  );
};
