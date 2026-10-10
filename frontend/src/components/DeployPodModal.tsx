import React, { useState } from 'react';
import { X, Box, Check } from 'lucide-react';
import type { PodItem } from '../types';

interface DeployPodModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: (pod: PodItem) => void;
}

export const DeployPodModal: React.FC<DeployPodModalProps> = ({
  isOpen,
  onClose,
  onDeploy,
}) => {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [ports, setPorts] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !image.trim()) return;

    const newPod: PodItem = {
      id: `pod-${Date.now()}`,
      name: name.toLowerCase().replace(/\s+/g, '-'),
      image: image.trim(),
      status: 'running',
      ports: ports.trim() || '8080:80',
      cpu: '0.5%',
      memory: '45 MB',
      restartPolicy: 'unless-stopped',
    };

    onDeploy(newPod);
    onClose();
    setName('');
    setImage('');
    setPorts('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Deploy Container Pod</h2>
              <p className="text-xs text-slate-500">Run any Docker image with resource limits</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Pod Name
            </label>
            <input
              type="text"
              required
              placeholder="e.g. meilisearch-service"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Docker Image
            </label>
            <input
              type="text"
              required
              placeholder="e.g. getmeili/meilisearch:v1.9 or rabbitmq:alpine"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Port Mapping (Host:Container)
            </label>
            <input
              type="text"
              placeholder="e.g. 7700:7700"
              value={ports}
              onChange={(e) => setPorts(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 font-mono"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm shadow-blue-500/20"
            >
              Deploy Pod
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
