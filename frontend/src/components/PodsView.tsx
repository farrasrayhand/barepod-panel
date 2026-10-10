import React, { useState } from 'react';
import { 
  Box, 
  Plus, 
  RefreshCw, 
  Play, 
  Square, 
  Terminal, 
  ExternalLink, 
  Trash2,
  Globe,
  Sliders,
  Layers,
  FileCode,
  HardDrive,
  Cloud
} from 'lucide-react';
import type { PodItem } from '../types';
import { DeployPodModal } from './DeployPodModal';
import { PodConfigModal } from './PodConfigModal';
import { DangerConfirmModal } from './DangerConfirmModal';

interface PodsViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

export const PodsView: React.FC<PodsViewProps> = ({ onShowToast, onOpenTerminal }) => {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [selectedPodForConfig, setSelectedPodForConfig] = useState<PodItem | null>(null);
  const [podToDelete, setPodToDelete] = useState<PodItem | null>(null);

  const [pods, setPods] = useState<PodItem[]>([
    {
      id: 'pod-1',
      name: 'redis-cache-cluster',
      sourceType: 'image',
      image: 'redis:7.2-alpine',
      status: 'running',
      ports: '6379:6379',
      cpu: '0.4%',
      memory: '28 MB',
      restartPolicy: 'unless-stopped',
      isWebApp: false,
      volumes: [
        { hostPath: 'redis_cache_data', containerPath: '/data', readOnly: false }
      ],
      envVars: [
        { key: 'REDIS_MAXMEMORY', value: '256mb', isSecret: false }
      ],
      memoryLimit: '512 MB',
      cpuLimit: '0.5 core',
    },
    {
      id: 'pod-2',
      name: 'typesense-search',
      sourceType: 'image',
      image: 'typesense/typesense:26.0',
      status: 'running',
      ports: '8108:8108',
      cpu: '1.2%',
      memory: '180 MB',
      restartPolicy: 'always',
      isWebApp: true,
      webDomain: 'typesense.demo.barepod.cloud',
      webPort: 8108,
      sslEnabled: true,
      volumes: [
        { hostPath: 'typesense_data', containerPath: '/data', readOnly: false }
      ],
      envVars: [
        { key: 'TYPESENSE_API_KEY', value: 'xyz_search_secret_key_prod', isSecret: true },
        { key: 'TYPESENSE_DATA_DIR', value: '/data', isSecret: false }
      ],
      memoryLimit: '1 GB',
      cpuLimit: '1.0 core',
    },
    {
      id: 'pod-3',
      name: 'n8n-workflow-automation',
      sourceType: 'compose',
      image: 'n8nio/n8n:latest',
      status: 'running',
      ports: '5678:5678',
      cpu: '2.5%',
      memory: '310 MB',
      restartPolicy: 'unless-stopped',
      isWebApp: true,
      webDomain: 'n8n.workflow.barepod.cloud',
      webPort: 5678,
      sslEnabled: true,
      useCloudflareTunnel: true,
      volumes: [
        { hostPath: 'n8n_storage', containerPath: '/home/node/.n8n', readOnly: false }
      ],
      envVars: [
        { key: 'N8N_HOST', value: 'n8n.workflow.barepod.cloud', isSecret: false },
        { key: 'N8N_PORT', value: '5678', isSecret: false },
        { key: 'N8N_PROTOCOL', value: 'https', isSecret: false },
        { key: 'NODE_ENV', value: 'production', isSecret: false },
        { key: 'WEBHOOK_URL', value: 'https://n8n.workflow.barepod.cloud/', isSecret: false }
      ],
      memoryLimit: '2 GB',
      cpuLimit: '2.0 cores',
    },
  ]);

  const handleDeployPod = (newPod: PodItem) => {
    setPods([newPod, ...pods]);
    onShowToast?.('Pod Deployed', `Container ${newPod.name} (${newPod.image}) is now active.`, 'success');
  };

  const handleUpdatePod = (updatedPod: PodItem) => {
    setPods(pods.map(p => p.id === updatedPod.id ? updatedPod : p));
  };

  const handleTogglePod = (podId: string) => {
    setPods(pods.map(p => {
      if (p.id === podId) {
        const nextStatus = p.status === 'running' ? 'stopped' : 'running';
        onShowToast?.(
          nextStatus === 'running' ? 'Pod Started' : 'Pod Stopped',
          `Container ${p.name} status is now ${nextStatus}.`,
          'info'
        );
        return {
          ...p,
          status: nextStatus,
          cpu: nextStatus === 'running' ? '0.4%' : '0%',
          memory: nextStatus === 'running' ? '30 MB' : '0 MB',
        };
      }
      return p;
    }));
  };

  const handleDeletePod = (podId: string, podName: string) => {
    setPods(pods.filter(p => p.id !== podId));
    onShowToast?.('Pod Removed', `Container ${podName} was deleted.`, 'info');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Pods (Containers)</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-100 text-purple-800">
              Docker Engine
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Host standalone containers, Dockerfiles, or Docker Compose stacks with custom web routing, envs & storage
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={() => onShowToast?.('Refreshed', 'Container states synchronized with Docker daemon.', 'info')}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button
            onClick={() => setIsDeployModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors shadow-sm shadow-purple-500/25"
          >
            <Plus className="w-4 h-4" />
            <span>Deploy Pod</span>
          </button>
        </div>
      </div>

      {/* Pods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {pods.map((pod) => {
          const isRunning = pod.status === 'running';
          const isWeb = pod.isWebApp && pod.webDomain;

          return (
            <div 
              key={pod.id} 
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all group"
            >
              <div>
                {/* Top Row: Icon, Status, Source Badge */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                      <Box className="w-5 h-5" />
                    </div>
                    <div>
                      {pod.sourceType === 'compose' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                          <Layers className="w-2.5 h-2.5" /> Compose
                        </span>
                      ) : pod.sourceType === 'dockerfile' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">
                          <FileCode className="w-2.5 h-2.5" /> Dockerfile
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          Image
                        </span>
                      )}
                    </div>
                  </div>

                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    isRunning 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                    {isRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>

                {/* Name & Image */}
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <h3 
                      onClick={() => setSelectedPodForConfig(pod)}
                      className="font-bold text-slate-900 text-sm hover:text-purple-600 cursor-pointer truncate"
                      title={pod.name}
                    >
                      {pod.name}
                    </h3>
                  </div>
                  <p className="text-xs text-slate-400 font-mono mt-0.5 truncate" title={pod.image}>
                    {pod.image}
                  </p>
                </div>

                {/* Web Domain Badge if Web App */}
                {isWeb && (
                  <div className="mt-3 p-2 rounded-lg bg-blue-50/70 border border-blue-200/80 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 truncate">
                      <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <a
                        href={`https://${pod.webDomain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono font-bold text-blue-900 hover:underline truncate"
                        title={pod.webDomain}
                      >
                        {pod.webDomain}
                      </a>
                    </div>
                    {pod.useCloudflareTunnel && (
                      <span className="shrink-0 text-[9px] font-bold text-purple-700 bg-purple-100 px-1.5 py-0.2 rounded flex items-center gap-0.5" title="Routed via Cloudflare Tunnel">
                        <Cloud className="w-2.5 h-2.5" /> Tunnel
                      </span>
                    )}
                  </div>
                )}

                {/* Specs / Port & RAM */}
                <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Port Mapping</span>
                    <span className="font-mono text-slate-700 font-medium truncate block">{pod.ports || 'None'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block">RAM / CPU</span>
                    <span className="font-medium text-slate-700 truncate block">{pod.memory} ({pod.cpu})</span>
                  </div>
                </div>

                {/* Quick Envs & Volumes Counter */}
                <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                  {pod.envVars && pod.envVars.length > 0 && (
                    <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-600">
                      {pod.envVars.length} Envs
                    </span>
                  )}
                  {pod.volumes && pod.volumes.length > 0 && (
                    <span className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded font-mono text-slate-600 flex items-center gap-1">
                      <HardDrive className="w-2.5 h-2.5" />
                      {pod.volumes.length} Vol
                    </span>
                  )}
                </div>
              </div>

              {/* Bottom Card Footer Actions */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => setSelectedPodForConfig(pod)}
                  className="flex items-center gap-1 text-xs font-bold text-purple-700 hover:text-purple-900 bg-purple-50 hover:bg-purple-100 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Sliders className="w-3 h-3" />
                  <span>Configure</span>
                </button>

                <div className="flex items-center gap-1">
                  {isWeb && (
                    <a 
                      href={`https://${pod.webDomain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition-colors"
                      title="Open Web App in New Tab"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}

                  <button 
                    onClick={onOpenTerminal}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                    title="Open Web Terminal"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                  </button>

                  <button 
                    onClick={() => handleTogglePod(pod.id)}
                    className={`p-1.5 rounded transition-colors ${
                      isRunning ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50'
                    }`}
                    title={isRunning ? 'Stop Container' : 'Start Container'}
                  >
                    {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>

                  <button 
                    onClick={() => setPodToDelete(pod)}
                    className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                    title="Delete Pod"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deploy Pod Modal */}
      <DeployPodModal
        isOpen={isDeployModalOpen}
        onClose={() => setIsDeployModalOpen(false)}
        onDeploy={handleDeployPod}
      />

      {/* Pod Detail & Config Modal */}
      <PodConfigModal
        isOpen={!!selectedPodForConfig}
        onClose={() => setSelectedPodForConfig(null)}
        pod={selectedPodForConfig}
        onSaveConfig={handleUpdatePod}
        onToggleStatus={handleTogglePod}
        onOpenTerminal={onOpenTerminal}
        onShowToast={onShowToast}
      />

      {/* Danger Confirm Delete Modal */}
      <DangerConfirmModal
        isOpen={!!podToDelete}
        onClose={() => setPodToDelete(null)}
        onConfirm={() => {
          if (podToDelete) {
            handleDeletePod(podToDelete.id, podToDelete.name);
            setPodToDelete(null);
          }
        }}
        title={`Hapus Container Pod "${podToDelete?.name}"`}
        itemType="Container Pod"
        itemName={podToDelete?.name || ''}
        warningDescription={`Container pod ${podToDelete?.name} (${podToDelete?.image}) akan dihentikan paksa dan dihapus permanen dari Docker runtime.`}
      />
    </div>
  );
};
