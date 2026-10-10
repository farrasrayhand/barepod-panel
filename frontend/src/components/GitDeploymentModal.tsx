import React, { useState } from 'react';
import { 
  GitBranch, 
  Play, 
  RotateCw, 
  CheckCircle2, 
  Copy, 
  Check, 
  X, 
  Terminal, 
  ExternalLink, 
  Radio, 
  ShieldCheck,
  Zap,
  FolderGit2
} from 'lucide-react';
import type { WebApp } from '../types';

interface GitDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
}

export const GitDeploymentModal: React.FC<GitDeploymentModalProps> = ({
  isOpen,
  onClose,
  app,
}) => {
  const [repoUrl, setRepoUrl] = useState('https://github.com/farrasrayhand/barepod-panel');
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [buildScript, setBuildScript] = useState(
    app?.runtime === 'python'
      ? 'git pull origin main\nsource venv/bin/activate\npip install -r requirements.txt\nsystemctl reload-app'
      : app?.runtime === 'php'
      ? 'git pull origin main\ncomposer install --no-dev --optimize-autoloader\nphp artisan migrate --force\nsystemctl reload-app'
      : 'git pull origin main\npnpm install\npnpm run build\nsystemctl reload-app'
  );

  const [isDeploying, setIsDeploying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([
    '[SYSTEM] Last deployment succeeded on 2026-10-10 16:40:12 (Commit d70a45a)',
    '[SYSTEM] Webhook listener active and awaiting push events.',
  ]);

  if (!isOpen || !app) return null;

  const webhookUrl = `https://${app.domain}/api/v1/webhook/${app.id}/deploy?token=bp_wh_${app.tenantUser}_99a`;

  const handleCopyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1500);
  };

  const handleTriggerRedeploy = () => {
    setIsDeploying(true);
    const initialLogs = [
      `[${new Date().toLocaleTimeString()}] ⚡ Redeploy triggered for app '${app.name}'`,
      `[${new Date().toLocaleTimeString()}] 📦 Connecting to ${repoUrl} (branch: ${branch})...`,
    ];
    setDeployLogs(initialLogs);

    setTimeout(() => {
      setDeployLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🔄 Fetching latest commits... Fast-forward 2 commits.`,
        `[${new Date().toLocaleTimeString()}] 🛠️ Running build script for ${app.runtime.toUpperCase()} ${app.version}...`,
      ]);
    }, 1000);

    setTimeout(() => {
      setDeployLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] 🚀 Reloading runtime service in isolated tenant jail...`,
        `[${new Date().toLocaleTimeString()}] 🌐 Checking Cloudflare Ingress health (HTTP 200 OK)...`,
        `[${new Date().toLocaleTimeString()}] ✅ Zero-Downtime Deployment Finished in 4.2 seconds!`,
      ]);
      setIsDeploying(false);
    }, 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <FolderGit2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">GitHub CI/CD & Auto Redeploy</h2>
              <p className="text-xs text-slate-500">Push-to-deploy webhook and manual zero-downtime redeploy</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content (Scrollable) */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Repo & Branch Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                GitHub Repository URL
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Branch
              </label>
              <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono">
                <GitBranch className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                GitHub Webhook URL (Push-to-Deploy)
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDeploy}
                  onChange={(e) => setAutoDeploy(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span className="font-medium">Auto Redeploy on Push</span>
              </label>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={webhookUrl}
                className="w-full px-3 py-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded-lg text-slate-600"
              />
              <button
                onClick={handleCopyWebhook}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-400">
              Paste URL ini di GitHub Repo: <strong>Settings → Webhooks → Add Webhook</strong>. Setiap Anda push commit baru, aplikasi akan otomatis di-build ulang!
            </p>
          </div>

          {/* Build Command Script */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Deploy & Build Script
            </label>
            <div className="bg-slate-900 rounded-xl p-3 border border-slate-800 font-mono text-xs text-slate-200">
              <textarea
                rows={3}
                value={buildScript}
                onChange={(e) => setBuildScript(e.target.value)}
                className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-none font-mono text-xs focus:ring-0 leading-relaxed"
              />
            </div>
          </div>

          {/* Deployment Live Log Terminal */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-slate-500" />
                Live Build Logs
              </span>
              <span className="text-[10px] text-slate-400">Zero-Downtime Reload</span>
            </div>
            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 font-mono text-[11px] text-slate-300 min-h-[120px] max-h-[160px] overflow-y-auto space-y-1">
              {deployLogs.map((log, idx) => (
                <div key={idx} className={log.includes('✅') ? 'text-emerald-400 font-bold' : ''}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            Current Branch: <strong className="text-slate-800">{branch}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleTriggerRedeploy}
              disabled={isDeploying}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isDeploying ? 'animate-spin' : ''}`} />
              <span>{isDeploying ? 'Deploying...' : 'Redeploy from GitHub'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
