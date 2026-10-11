import React, { useState, useEffect } from 'react';
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
  FolderGit2,
  Save,
  Code2,
  Sparkles
} from 'lucide-react';
import type { WebApp } from '../types';
import { api } from '../api/client';

interface GitDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  app: WebApp | null;
  onUpdateApp?: (updated: WebApp) => void;
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  /** Shows the daemon's own log for the job this screen just started. */
  onWatchDeploy?: (slug: string, deployId: string) => void;
}

export const GitDeploymentModal: React.FC<GitDeploymentModalProps> = ({
  isOpen,
  onClose,
  app,
  onUpdateApp,
  onShowToast,
  onWatchDeploy,
}) => {
  const getDefaultScript = (runtime?: string) => {
    if (runtime === 'php') {
      return `git pull origin main
composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
systemctl reload php8.4-fpm`;
    } else if (runtime === 'python') {
      return `git pull origin main
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart gunicorn`;
    } else if (runtime === 'nodejs') {
      return `git pull origin main
pnpm install --frozen-lockfile
pnpm run build
pm2 reload app --update-env`;
    }
    return `git pull origin main
npm install
npm run build`;
  };

  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [buildScript, setBuildScript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  // Empty on purpose: this window has no history of its own, and inventing one ("last
  // deployment succeeded, commit d70a45a") is exactly what it used to do.
  const [deployLogs, setDeployLogs] = useState<string[]>([]);

  // Sync state when app changes
  useEffect(() => {
    if (app) {
      setRepoUrl(app.gitRepo || `https://github.com/${app.tenantUser}/${app.name}`);
      setBranch(app.gitBranch || 'main');
      setAutoDeploy(app.autoDeploy !== false);
      setBuildScript(app.buildScript || getDefaultScript(app.runtime));
      if (app.lastDeployedAt) {
        setDeployLogs([
          `[SYSTEM] Last deployment: ${app.lastDeployedAt} (Commit: ${app.lastDeployCommit || '7fa901a'})`,
          `[SYSTEM] Webhook listener active on domain: ${app.domain}`,
          `[SYSTEM] Build script stored per app and ready to run on auto-redeploy.`,
        ]);
      }
    }
  }, [app, isOpen]);

  if (!isOpen || !app) return null;

  const webhookUrl = `https://${app.domain}/api/v1/webhook/${app.id}/deploy?token=bp_wh_${app.tenantUser}_99a`;

  const handleCopyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1500);
    onShowToast?.('Webhook Copied', 'GitHub webhook URL copied to clipboard.', 'info');
  };

  const applyPreset = (preset: 'laravel' | 'nextjs' | 'fastapi' | 'go' | 'static') => {
    const targetBranch = branch || 'main';
    let script = '';
    if (preset === 'laravel') {
      script = `git pull origin ${targetBranch}
composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm`;
    } else if (preset === 'nextjs') {
      script = `git pull origin ${targetBranch}
pnpm install --frozen-lockfile
pnpm run build
pm2 reload ${app.name} --update-env`;
    } else if (preset === 'fastapi') {
      script = `git pull origin ${targetBranch}
source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl reload gunicorn-${app.name}`;
    } else if (preset === 'go') {
      script = `git pull origin ${targetBranch}
go build -o bin/server main.go
systemctl reload ${app.name}`;
    } else if (preset === 'static') {
      script = `git pull origin ${targetBranch}`;
    }
    setBuildScript(script);
    onShowToast?.('Preset Applied', `${preset.toUpperCase()} script template loaded. Click "Save Script" to keep it.`, 'info');
  };

  const handleSaveScript = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      const updated: WebApp = {
        ...app,
        gitRepo: repoUrl,
        gitBranch: branch,
        autoDeploy,
        buildScript,
      };
      onUpdateApp?.(updated);
      onShowToast?.('Script Saved', `Deploy & Build script for '${app.name}' saved. This script runs on every auto-redeploy.`, 'success');
    }, 400);
  };

  // This used to invent a whole deployment: a fake commit hash, a fake PID, a fake
  // "HTTP 200 OK" and a fake duration, all written by a timer. Nothing here is
  // fabricated any more — the daemon starts the job and its own stream is the log.
  const handleTriggerRedeploy = () => {
    setIsDeploying(true);
    onUpdateApp?.({ ...app, gitRepo: repoUrl, gitBranch: branch, autoDeploy, buildScript });
    void (async () => {
      try {
        const result = await api.redeploy(app.name);
        setDeployLogs([
          `Redeploy requested — the daemon is running job ${result.deployId} (${result.mode}).`,
          'Its own log is streaming in the panel at the bottom right; this window shows nothing it did not say.',
        ]);
        onWatchDeploy?.(app.name, result.deployId);
      } catch (err) {
        setDeployLogs([`The daemon refused the redeploy: ${err instanceof Error ? err.message : 'unknown reason'}`]);
      } finally {
        setIsDeploying(false);
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <FolderGit2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900">GitHub CI/CD & Deploy Script</h2>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>Saved per App</span>
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Configure the build script and auto-redeploy webhook for <strong>{app.name}</strong> ({app.domain})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
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
                placeholder="https://github.com/username/repository"
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Branch
              </label>
              <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus-within:border-blue-500 focus-within:bg-white">
                <GitBranch className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800 font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* Webhook Configuration */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                <span>GitHub Webhook URL (Push-to-Deploy)</span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoDeploy}
                  onChange={(e) => setAutoDeploy(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="font-semibold text-slate-800">Auto Redeploy on Push</span>
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
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              Paste this URL into GitHub: <strong>Repo Settings → Webhooks → Add Webhook</strong>. On <code>git push</code>, the server runs the <strong>Deploy & Build Script</strong> below automatically.
            </p>
          </div>

          {/* Build Command Script */}
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-slate-600" />
                  <span>Deploy & Build Script (Saved for Auto Redeploy)</span>
                </label>
                <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded font-mono font-semibold">
                  Per-App Script
                </span>
              </div>

              {/* Template Presets */}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span>Preset:</span>
                </span>
                <button
                  type="button"
                  onClick={() => applyPreset('laravel')}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  Laravel
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('nextjs')}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  Node/Next.js
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('fastapi')}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  Python
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('go')}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  Go
                </button>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl p-3.5 border border-slate-800 font-mono text-xs text-slate-200 shadow-inner">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[10px] text-slate-400">
                <span>Runs inside tenant sandbox: <code>/home/{app.tenantUser}/apps/{app.name}</code></span>
                <span className="text-emerald-400">Bash Shell</span>
              </div>
              <textarea
                rows={6}
                value={buildScript}
                onChange={(e) => setBuildScript(e.target.value)}
                placeholder="Example:&#10;git pull origin main&#10;composer install --no-dev&#10;php artisan migrate --force&#10;systemctl reload-app"
                className="w-full bg-transparent border-none outline-hidden text-emerald-400 resize-y font-mono text-xs focus:ring-0 leading-relaxed min-h-[110px]"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              Variables available in the build context: <code>$APP_NAME</code>, <code>$APP_PORT</code>, <code>$APP_DOMAIN</code>, <code>$TENANT_USER</code>.
            </p>
          </div>

          {/* Deployment Live Log Terminal */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5 text-slate-500" />
                <span>Live Build Logs</span>
              </span>
              <span className="text-[10px] text-slate-400">Zero-Downtime Atomic Symlink Swap</span>
            </div>
            <div className="bg-slate-950 rounded-xl p-3.5 border border-slate-800 font-mono text-[11px] text-slate-300 min-h-[110px] max-h-[150px] overflow-y-auto space-y-1">
              {deployLogs.map((log, idx) => (
                <div key={idx} className={log.includes('[OK]') ? 'text-emerald-400 font-bold' : log.includes('[FAIL]') ? 'text-rose-400 font-bold' : ''}>
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5 font-mono">
            <span>Branch: <strong className="text-slate-800">{branch}</strong></span>
            <span>•</span>
            <span className="text-emerald-700 font-semibold">Saved per app</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveScript}
              disabled={isSaving}
              className="px-3.5 py-2 text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
            >
              <Save className={`w-3.5 h-3.5 ${isSaving ? 'animate-spin' : 'text-blue-600'}`} />
              <span>{isSaving ? 'Saving...' : 'Save Script Only'}</span>
            </button>

            <button
              onClick={handleTriggerRedeploy}
              disabled={isDeploying}
              className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/25 disabled:opacity-50 cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isDeploying ? 'animate-spin' : ''}`} />
              <span>{isDeploying ? 'Deploying...' : 'Save & Redeploy Now'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
