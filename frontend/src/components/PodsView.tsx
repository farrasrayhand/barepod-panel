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
  Cloud,
  AlertTriangle,
  Lock,
  Search,
  User,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import type { PodItem } from '../types';
import { PodConfigModal } from './PodConfigModal';
import { DangerConfirmModal } from './DangerConfirmModal';

interface PodsViewProps {
  isAdmin?: boolean;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: (podId: string) => void;
}

export const PodsView: React.FC<PodsViewProps> = ({ isAdmin = false, onShowToast, onOpenTerminal }) => {
  const [selectedPodForConfig, setSelectedPodForConfig] = useState<PodItem | null>(null);
  const [podToDelete, setPodToDelete] = useState<PodItem | null>(null);

  const [pods, setPods] = useState<PodItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'name' | 'owner' | 'status'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const availableOwners = React.useMemo(() => {
    const set = new Set<string>();
    pods.forEach((p) => {
      set.add(p.tenantUser || 'admin');
    });
    return Array.from(set).sort();
  }, [pods]);

  const filteredAndSortedPods = React.useMemo(() => {
    const filtered = pods.filter((p) => {
      const pOwner = p.tenantUser || 'admin';
      const matchesOwner = ownerFilter === 'all' || pOwner === ownerFilter;
      const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            p.image.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            pOwner.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            (p.webDomain && p.webDomain.toLowerCase().includes(searchQuery.toLowerCase()));
      return matchesOwner && matchesSearch;
    });

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'owner') {
        cmp = (a.tenantUser || 'admin').localeCompare(b.tenantUser || 'admin');
      } else if (sortBy === 'status') {
        cmp = a.status.localeCompare(b.status);
      } else {
        cmp = a.name.localeCompare(b.name);
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [pods, ownerFilter, searchQuery, sortBy, sortDirection]);



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
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
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
            disabled
            title="The Docker Pods module is not available yet"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-400 bg-white border border-slate-200 rounded-lg cursor-not-allowed shadow-2xs"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button
            disabled
            title="The Docker Pods module is not available yet"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-300 rounded-lg cursor-not-allowed shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Deploy Pod</span>
          </button>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900">
        The Docker Pods module is not implemented yet. No containers are shown or can be deployed from this page.
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Owner Filter Dropdown */}
          {(isAdmin || availableOwners.length > 1) && (
            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shrink-0">
              <User className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-500 font-medium">Owner:</span>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="text-xs bg-transparent border-0 text-slate-800 font-semibold focus:outline-hidden cursor-pointer"
              >
                <option value="all">All Owners ({pods.length})</option>
                {availableOwners.map((u) => (
                  <option key={u} value={u}>
                    @{u} ({pods.filter((p) => (p.tenantUser || 'admin') === u).length})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort Dropdown */}
          <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-[11px] text-slate-500 font-medium">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs bg-transparent border-0 text-slate-800 font-semibold focus:outline-hidden cursor-pointer"
            >
              <option value="name">Container Name</option>
              <option value="owner">Owner (Tenant)</option>
              <option value="status">Status</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              title={sortDirection === 'asc' ? 'Ascending (A-Z)' : 'Descending (Z-A)'}
              className="p-1 hover:bg-slate-200/60 rounded text-slate-600 hover:text-purple-600 transition-colors cursor-pointer"
            >
              {sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative min-w-0 sm:min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search container, image, owner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
          />
        </div>
      </div>

      {/* Pods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {filteredAndSortedPods.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-xl border border-slate-200 p-8">
            <Box className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">No containers found</p>
            <p className="text-xs text-slate-400 mt-1">Try resetting your filters or deploy a new pod container.</p>
          </div>
        ) : (
          filteredAndSortedPods.map((pod) => {
            const isRunning = pod.status === 'running';
            const isWeb = pod.isWebApp && pod.webDomain;

            return (
              <div
                key={pod.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between hover:shadow-md hover:border-slate-300 transition-all group"
              >
                <div>
                  {/* Top Row: Icon, Status, Source Badge & Owner */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                        <Box className="w-5 h-5" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
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
                          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            <User className="w-2.5 h-2.5 text-slate-400" />
                            @{pod.tenantUser || 'admin'}
                          </span>
                        </div>
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
                  <div className="mt-3 space-y-1.5">
                    <div className="p-2 rounded-lg bg-blue-50/70 border border-blue-200/80 flex items-center justify-between">
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

                    {(pod.maintenanceMode || pod.basicAuthEnabled) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {pod.maintenanceMode && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-1.5 py-0.2 rounded" title="HTTP 503 Maintenance Mode Active">
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-600" />
                            503 Maint
                          </span>
                        )}
                        {pod.basicAuthEnabled && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-800 bg-purple-50 border border-purple-300 px-1.5 py-0.2 rounded" title="HTTP Basic Auth Protected">
                            <Lock className="w-2.5 h-2.5 text-purple-600" />
                            Auth ({pod.basicAuthUser || 'admin'})
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Specs / Port & RAM */}
                <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-500">
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
                    onClick={() => onOpenTerminal?.(pod.id)}
                    className="p-1.5 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                    title="Open a shell inside this container"
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
        }))}
      </div>

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
        title={`Delete Container Pod "${podToDelete?.name}"`}
        itemType="Container Pod"
        itemName={podToDelete?.name || ''}
        warningDescription={`Container pod ${podToDelete?.name} (${podToDelete?.image}) will be force-stopped and permanently removed from the Docker runtime.`}
      />
    </div>
  );
};
