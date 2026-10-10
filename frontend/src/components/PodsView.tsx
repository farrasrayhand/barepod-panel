import React from 'react';
import { 
  Box, 
  Plus, 
  RefreshCw, 
  Play, 
  Square, 
  Terminal, 
  ExternalLink, 
  CheckCircle2, 
  Cpu, 
  HardDrive 
} from 'lucide-react';
import type { PodItem } from '../types';

export const PodsView: React.FC = () => {
  const pods: PodItem[] = [
    {
      id: 'pod-1',
      name: 'redis-cache-cluster',
      image: 'redis:7.2-alpine',
      status: 'running',
      ports: '6379:6379',
      cpu: '0.4%',
      memory: '28 MB',
      restartPolicy: 'unless-stopped',
    },
    {
      id: 'pod-2',
      name: 'typesense-search',
      image: 'typesense/typesense:26.0',
      status: 'running',
      ports: '8108:8108',
      cpu: '1.2%',
      memory: '180 MB',
      restartPolicy: 'always',
    },
    {
      id: 'pod-3',
      name: 'n8n-workflow-automation',
      image: 'n8nio/n8n:latest',
      status: 'running',
      ports: '5678:5678',
      cpu: '2.5%',
      memory: '310 MB',
      restartPolicy: 'unless-stopped',
    },
  ];

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
            Lightweight container hosting without Easypanel's complexity
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs">
            <RefreshCw className="w-4 h-4 text-slate-500" />
            <span>Refresh</span>
          </button>
          <button className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-500/25">
            <Plus className="w-4 h-4" />
            <span>Deploy Pod</span>
          </button>
        </div>
      </div>

      {/* Pods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {pods.map((pod) => (
          <div key={pod.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs flex flex-col justify-between hover:shadow-xs transition-shadow">
            <div>
              <div className="flex items-start justify-between">
                <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                  <Box className="w-5 h-5" />
                </div>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Running
                </span>
              </div>

              <div className="mt-3">
                <h3 className="font-semibold text-slate-900 text-sm">{pod.name}</h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">{pod.image}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs text-slate-500">
                <div>
                  <span className="text-[10px] text-slate-400 block">Port Mapping</span>
                  <span className="font-mono text-slate-700 font-medium">{pod.ports}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">RAM / CPU</span>
                  <span className="font-medium text-slate-700">{pod.memory} ({pod.cpu})</span>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Restart: {pod.restartPolicy}</span>
              <div className="flex items-center gap-2">
                <button 
                  className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  title="Pod Terminal"
                >
                  <Terminal className="w-3.5 h-3.5" />
                </button>
                <button 
                  className="p-1 rounded text-amber-600 hover:bg-amber-50"
                  title="Stop Pod"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
