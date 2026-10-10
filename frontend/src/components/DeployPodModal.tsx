import React, { useState } from 'react';
import { 
  X, 
  Box, 
  Globe, 
  Layers, 
  FileCode, 
  Terminal, 
  Plus, 
  Trash2, 
  ShieldCheck, 
  HardDrive, 
  Cpu, 
  Sliders, 
  Code, 
  HelpCircle,
  Cloud,
  Check
} from 'lucide-react';
import type { PodItem, PodSourceType, PodEnvVar, PodVolumeMount } from '../types';

interface DeployPodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (pod: PodItem) => void;
}

const DEFAULT_DOCKERFILE = `# Sample multi-stage Dockerfile for Web Application
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]`;

const DEFAULT_COMPOSE = `version: '3.8'

services:
  app:
    image: n8nio/n8n:latest
    container_name: n8n-automation
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=n8n.demo.barepod.cloud
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - NODE_ENV=production
      - WEBHOOK_URL=https://n8n.demo.barepod.cloud/
    volumes:
      - n8n_storage:/home/node/.n8n

volumes:
  n8n_storage:
    driver: local`;

export const DeployPodModal: React.FC<DeployPodModalProps> = ({
  isOpen,
  onClose,
  onDeploy,
}) => {
  const [sourceType, setSourceType] = useState<PodSourceType>('image');
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [dockerfileContent, setDockerfileContent] = useState(DEFAULT_DOCKERFILE);
  const [composeContent, setComposeContent] = useState(DEFAULT_COMPOSE);
  
  // Web Application configuration
  const [isWebApp, setIsWebApp] = useState(false);
  const [webDomain, setWebDomain] = useState('');
  const [webPort, setWebPort] = useState<number>(80);
  const [sslEnabled, setSslEnabled] = useState(true);
  const [useCloudflareTunnel, setUseCloudflareTunnel] = useState(false);

  // Networking & Resources
  const [ports, setPorts] = useState('');
  const [restartPolicy, setRestartPolicy] = useState('unless-stopped');
  const [memoryLimit, setMemoryLimit] = useState('512 MB');
  const [cpuLimit, setCpuLimit] = useState('1.0 core');

  // Env variables
  const [envMode, setEnvMode] = useState<'table' | 'raw'>('table');
  const [envVars, setEnvVars] = useState<PodEnvVar[]>([
    { key: 'PORT', value: '80', isSecret: false },
    { key: 'NODE_ENV', value: 'production', isSecret: false },
  ]);
  const [rawEnv, setRawEnv] = useState('PORT=80\nNODE_ENV=production');

  // Volumes
  const [volumes, setVolumes] = useState<PodVolumeMount[]>([
    { hostPath: 'app_data', containerPath: '/data', readOnly: false }
  ]);

  // Tab for modal layout
  const [configTab, setConfigTab] = useState<'source' | 'web' | 'env' | 'storage' | 'resources'>('source');

  if (!isOpen) return null;

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

  const syncRawToEnvVars = (text: string) => {
    setRawEnv(text);
    const lines = text.split('\n');
    const parsed: PodEnvVar[] = [];
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        parsed.push({
          key: trimmed.slice(0, eqIdx).trim(),
          value: trimmed.slice(eqIdx + 1).trim(),
          isSecret: false
        });
      }
    });
    setEnvVars(parsed);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let finalImage = image.trim();
    if (sourceType === 'dockerfile') {
      finalImage = `custom-build/${name.toLowerCase()}:latest`;
    } else if (sourceType === 'compose') {
      finalImage = `compose-stack/${name.toLowerCase()}`;
    }

    const finalPorts = ports.trim() 
      ? ports.trim() 
      : isWebApp 
        ? `${webPort || 80}:${webPort || 80}` 
        : '8080:80';

    const newPod: PodItem = {
      id: `pod-${Date.now()}`,
      name: name.toLowerCase().replace(/\s+/g, '-'),
      sourceType,
      image: finalImage || 'custom-image:latest',
      dockerfileContent: sourceType === 'dockerfile' ? dockerfileContent : undefined,
      composeContent: sourceType === 'compose' ? composeContent : undefined,
      status: 'running',
      ports: finalPorts,
      cpu: '0.4%',
      memory: '48 MB',
      restartPolicy,
      isWebApp,
      webDomain: isWebApp ? (webDomain.trim() || `${name.toLowerCase()}.demo.barepod.cloud`) : undefined,
      webPort: isWebApp ? webPort : undefined,
      sslEnabled: isWebApp ? sslEnabled : undefined,
      useCloudflareTunnel: isWebApp ? useCloudflareTunnel : undefined,
      envVars: envVars.filter(ev => ev.key.trim().length > 0),
      volumes: volumes.filter(v => v.containerPath.trim().length > 0),
      memoryLimit,
      cpuLimit,
    };

    onDeploy(newPod);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shadow-2xs">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">Deploy Container Pod</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">
                  Docker Engine
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Run any Docker Image, Dockerfile, or Docker Compose stack with web routing & envs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-200 bg-white text-xs font-semibold overflow-x-auto">
          <button
            type="button"
            onClick={() => setConfigTab('source')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              configTab === 'source'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>1. Source & Base</span>
          </button>
          <button
            type="button"
            onClick={() => setConfigTab('web')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              configTab === 'web'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>2. Web App & Domain</span>
            {isWebApp && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfigTab('env')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              configTab === 'env'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Sliders className="w-4 h-4" />
            <span>3. Env Variables</span>
            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-mono">
              {envVars.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setConfigTab('storage')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              configTab === 'storage'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            <span>4. Storage & Ports</span>
          </button>
          <button
            type="button"
            onClick={() => setConfigTab('resources')}
            className={`py-3 px-3 border-b-2 flex items-center gap-1.5 transition-all whitespace-nowrap ${
              configTab === 'resources'
                ? 'border-purple-600 text-purple-700 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>5. Limits</span>
          </button>
        </div>

        {/* Modal Body Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          
          {/* TAB 1: SOURCE & BASE */}
          {configTab === 'source' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Pod Identifier */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Pod Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. n8n-workflow or analytics-worker"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Internal DNS hostname inside the Docker network.
                </p>
              </div>

              {/* Source Type Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-2">
                  Deployment Method
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSourceType('image')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sourceType === 'image'
                        ? 'border-purple-600 bg-purple-50/60 ring-1 ring-purple-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">🐳</span>
                      <span className="text-xs font-bold text-slate-900">Docker Image</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      Pull pre-built image from Docker Hub, GHCR, or Quay.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSourceType('dockerfile')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sourceType === 'dockerfile'
                        ? 'border-purple-600 bg-purple-50/60 ring-1 ring-purple-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <FileCode className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-bold text-slate-900">Dockerfile</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      Custom build directly from multi-stage Dockerfile source.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSourceType('compose')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sourceType === 'compose'
                        ? 'border-purple-600 bg-purple-50/60 ring-1 ring-purple-600'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Layers className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-bold text-slate-900">Compose YAML</span>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-tight">
                      Declare multi-container stack with networks & services.
                    </p>
                  </button>
                </div>
              </div>

              {/* Source-specific input */}
              {sourceType === 'image' && (
                <div className="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-2">
                  <label className="block text-xs font-bold text-slate-800">
                    Docker Image Tag <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. n8nio/n8n:latest or getmeili/meilisearch:v1.9"
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-mono"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-[10px] text-slate-400 font-medium">Popular:</span>
                    {['n8nio/n8n:latest', 'redis:7.2-alpine', 'getmeili/meilisearch:v1.9', 'typesense/typesense:26.0', 'grafana/grafana:latest'].map(sample => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => {
                          setImage(sample);
                          if (!name) setName(sample.split('/')[0].split(':')[0]);
                        }}
                        className="text-[10px] bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-600 hover:border-purple-300 hover:text-purple-700 font-mono"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sourceType === 'dockerfile' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800">
                      Dockerfile Script
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">Build engine: BuildKit</span>
                  </div>
                  <textarea
                    rows={9}
                    value={dockerfileContent}
                    onChange={(e) => setDockerfileContent(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 text-slate-100 rounded-xl border border-slate-800 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                    placeholder="FROM node:alpine..."
                  />
                </div>
              )}

              {sourceType === 'compose' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800">
                      docker-compose.yml Specification
                    </label>
                    <span className="text-[10px] text-slate-400 font-mono">Compose spec v3.8</span>
                  </div>
                  <textarea
                    rows={9}
                    value={composeContent}
                    onChange={(e) => setComposeContent(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-slate-900 text-slate-100 rounded-xl border border-slate-800 focus:outline-hidden focus:ring-1 focus:ring-purple-500"
                    placeholder="version: '3.8'..."
                  />
                </div>
              )}
            </div>
          )}

          {/* TAB 2: WEB APPLICATION & DOMAIN */}
          {configTab === 'web' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Web Toggle */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start gap-3">
                <input
                  type="checkbox"
                  id="webAppToggle"
                  checked={isWebApp}
                  onChange={(e) => {
                    setIsWebApp(e.target.checked);
                    if (e.target.checked && !webDomain && name) {
                      setWebDomain(`${name.toLowerCase()}.demo.barepod.cloud`);
                    }
                  }}
                  className="mt-1 w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <label htmlFor="webAppToggle" className="text-xs font-bold text-slate-900 cursor-pointer block">
                    Expose as Web Application (HTTP / HTTPS Ingress)
                  </label>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Aktifkan jika container ini memiliki web interface atau REST API (seperti n8n, Next.js, Grafana, WordPress) yang ingin diakses langsung lewat browser dan domain publik.
                  </p>
                </div>
              </div>

              {isWebApp ? (
                <div className="space-y-4 border border-purple-200 bg-purple-50/30 p-4 rounded-xl">
                  {/* Domain Name */}
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Public Domain / Subdomain <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Globe className="w-3.5 h-3.5" />
                      </div>
                      <input
                        type="text"
                        required={isWebApp}
                        placeholder="e.g. n8n.company.com or search.demo.barepod.cloud"
                        value={webDomain}
                        onChange={(e) => setWebDomain(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-mono"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Panel akan mengatur Reverse Proxy internal (Nginx/Traefik) ke port container ini.
                    </p>
                  </div>

                  {/* Internal Container Port */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        Internal Container Port
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        value={webPort}
                        onChange={(e) => setWebPort(Number(e.target.value))}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-mono"
                      />
                      <p className="text-[10px] text-slate-400 mt-1">
                        Port web yang di-listen oleh container (e.g. 5678 untuk n8n, 3000 untuk Node, 80 untuk Nginx).
                      </p>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-800 mb-1">
                        TLS / SSL Encryption
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

                  {/* Cloudflare Tunnel Option */}
                  <div className="pt-2 border-t border-purple-100 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="cfTunnelToggle"
                      checked={useCloudflareTunnel}
                      onChange={(e) => setUseCloudflareTunnel(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                    />
                    <div>
                      <label htmlFor="cfTunnelToggle" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                        <Cloud className="w-3.5 h-3.5 text-blue-600" />
                        Rute melalui Isolated Cloudflare Tunnel Tenant
                      </label>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Bypass IP publik & port forwarding. Container langsung dihubungkan ke Cloudflare Zero Trust Tunnel milik user Anda secara terisolasi.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-center">
                  <p className="text-xs text-slate-500">
                    Container ini berjalan sebagai background daemon, worker, atau database cache murni tanpa domain web publik.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ENVIRONMENT VARIABLES */}
          {configTab === 'env' && (
            <div className="space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-900">Environment Variables</h3>
                  <p className="text-[11px] text-slate-500">Injeksi variabel rahasia, database URLs, atau config flags.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEnvMode(envMode === 'table' ? 'raw' : 'table')}
                    className="text-[10px] px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                  >
                    {envMode === 'table' ? 'Switch to .env Text' : 'Switch to Table'}
                  </button>
                  {envMode === 'table' && (
                    <button
                      type="button"
                      onClick={handleAddEnv}
                      className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold border border-purple-200"
                    >
                      <Plus className="w-3 h-3" />
                      Add Variable
                    </button>
                  )}
                </div>
              </div>

              {envMode === 'table' ? (
                <div className="space-y-2">
                  {envVars.map((ev, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="KEY (e.g. API_KEY)"
                        value={ev.key}
                        onChange={(e) => handleEnvChange(idx, 'key', e.target.value.toUpperCase())}
                        className="w-1/3 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono uppercase focus:border-purple-500"
                      />
                      <span className="text-slate-400 font-mono text-xs">=</span>
                      <input
                        type={ev.isSecret ? "password" : "text"}
                        placeholder="VALUE"
                        value={ev.value}
                        onChange={(e) => handleEnvChange(idx, 'value', e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-purple-500"
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
                  {envVars.length === 0 && (
                    <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
                      Tidak ada variabel environment. Klik "Add Variable" untuk menambahkan.
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  rows={8}
                  value={rawEnv}
                  onChange={(e) => syncRawToEnvVars(e.target.value)}
                  placeholder="KEY=VALUE&#10;DATABASE_URL=mysql://user:pass@host/db"
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-900 text-emerald-400 rounded-xl border border-slate-800 focus:outline-hidden"
                />
              )}
            </div>
          )}

          {/* TAB 4: STORAGE & PORTS */}
          {configTab === 'storage' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* Port Mappings */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Port Mapping (Host:Container)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 5678:5678 or 8080:80"
                  value={ports}
                  onChange={(e) => setPorts(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Format: [HostPort]:[ContainerPort]. Kosongkan jika menggunakan default web port.
                </p>
              </div>

              {/* Volume Mounts */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold text-slate-900">Persistent Storage Volumes</h3>
                    <p className="text-[11px] text-slate-500">Mount path host atau docker volume agar data tidak hilang saat restart.</p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddVolume}
                    className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold border border-purple-200"
                  >
                    <Plus className="w-3 h-3" />
                    Add Volume
                  </button>
                </div>

                {volumes.map((v, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Volume Name or /host/path"
                      value={v.hostPath}
                      onChange={(e) => handleVolumeChange(idx, 'hostPath', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-purple-500"
                    />
                    <span className="text-slate-400 font-mono text-xs">:</span>
                    <input
                      type="text"
                      placeholder="/container/mount/path"
                      value={v.containerPath}
                      onChange={(e) => handleVolumeChange(idx, 'containerPath', e.target.value)}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg font-mono focus:border-purple-500"
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

          {/* TAB 5: RESOURCE LIMITS & RESTART */}
          {configTab === 'resources' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    Memory Limit (RAM)
                  </label>
                  <select
                    value={memoryLimit}
                    onChange={(e) => setMemoryLimit(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-medium"
                  >
                    <option value="256 MB">256 MB (Micro)</option>
                    <option value="512 MB">512 MB (Standard)</option>
                    <option value="1 GB">1 GB (Medium)</option>
                    <option value="2 GB">2 GB (Large)</option>
                    <option value="4 GB">4 GB (High Mem)</option>
                    <option value="Unlimited">Unlimited (Host memory)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    CPU Core Quota
                  </label>
                  <select
                    value={cpuLimit}
                    onChange={(e) => setCpuLimit(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-medium"
                  >
                    <option value="0.5 core">0.5 Cores (Half Core)</option>
                    <option value="1.0 core">1.0 Cores (Standard)</option>
                    <option value="2.0 cores">2.0 Cores (High Perf)</option>
                    <option value="Unlimited">Unlimited (Shared)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Restart Policy
                </label>
                <select
                  value={restartPolicy}
                  onChange={(e) => setRestartPolicy(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-purple-500 font-medium"
                >
                  <option value="unless-stopped">unless-stopped (Rekomendasi server)</option>
                  <option value="always">always (Selalu restart jika crash atau reboot)</option>
                  <option value="on-failure">on-failure (Restart hanya saat error exit code)</option>
                  <option value="no">no (Jangan pernah auto restart)</option>
                </select>
              </div>
            </div>
          )}

          {/* Footer Controls */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <div className="text-[11px] text-slate-400">
              {sourceType === 'image' && 'Direct Docker daemon pull'}
              {sourceType === 'dockerfile' && 'BuildKit local compilation'}
              {sourceType === 'compose' && 'Docker Compose stack orchestration'}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg shadow-sm shadow-purple-500/25 transition-all"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Deploy Pod</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
