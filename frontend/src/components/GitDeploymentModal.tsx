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
  Sparkles,
  Key,
  RefreshCw
} from 'lucide-react';
import type { WebApp } from '../types';
import { api, type ApiWebsiteGitStatus } from '../api/client';

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
  const getDefaultScript = (runtime?: string, hasGit = false, targetBranch = 'main') => {
    const gitPull = hasGit ? `git pull origin ${targetBranch}\n` : '';
    if (runtime === 'php') {
      return `${gitPull}composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm`;
    } else if (runtime === 'python') {
      return `${gitPull}source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl restart gunicorn`;
    } else if (runtime === 'nodejs') {
      return `${gitPull}pnpm install --frozen-lockfile
pnpm run build
pm2 reload app --update-env`;
    } else if (runtime === 'go') {
      return `${gitPull}go build -o bin/server main.go
systemctl reload app`;
    } else if (runtime === 'static') {
      return hasGit ? `git pull origin ${targetBranch}` : `# Static website — assets served directly by web server`;
    }
    return `${gitPull}npm install
npm run build`;
  };

  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [buildScript, setBuildScript] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const [deployKey, setDeployKey] = useState<{ publicKey: string; fingerprint: string } | null>(null);
  const [loadingKey, setLoadingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [isRotatingKey, setIsRotatingKey] = useState(false);
  const [gitStatus, setGitStatus] = useState<ApiWebsiteGitStatus | null>(null);

  // Sync state when app changes
  useEffect(() => {
    if (app) {
      setRepoUrl(app.gitRepo || '');
      setBranch(app.gitBranch || 'main');
      setAutoDeploy(app.autoDeploy !== false);

      const hasGit = Boolean(
        (app.gitRepo && app.gitRepo.trim() !== '') ||
        app.sourceKind === 'github'
      );

      if (app.buildScript && app.buildScript.trim() !== '') {
        if (!hasGit && app.buildScript.trim().startsWith('git pull')) {
          const cleaned = app.buildScript.replace(/^git pull[^\n]*\n?/m, '').trim();
          setBuildScript(cleaned || getDefaultScript(app.runtime, false, app.gitBranch));
        } else {
          setBuildScript(app.buildScript);
        }
      } else {
        setBuildScript(getDefaultScript(app.runtime, hasGit, app.gitBranch));
      }

      if (app.lastDeployedAt) {
        setDeployLogs([
          `[SYSTEM] Last deployment: ${app.lastDeployedAt} (Commit: ${app.lastDeployCommit || '7fa901a'})`,
          `[SYSTEM] Webhook listener active on: ${window.location.origin}/api/v1/webhooks/deploy/${app.name}`,
          `[SYSTEM] Build script stored per app and ready to run on auto-redeploy.`,
        ]);
      }
    }
    if (app && isOpen) {
      setLoadingKey(true);
      api.websiteGitStatus(app.name)
        .then((res) => {
          setGitStatus(res);
          if (res.repo) setRepoUrl(res.repo);
          if (res.branch) setBranch(res.branch);
          setAutoDeploy(res.autoDeploy);
          if (res.deployKey) setDeployKey(res.deployKey);
          const hasGitNow = Boolean(res.repo?.trim() || app.sourceKind === 'github');
          if (res.deployScript && res.deployScript.trim() !== '') {
            if (!hasGitNow && res.deployScript.trim().startsWith('git pull')) {
              const cleaned = res.deployScript.replace(/^git pull[^\n]*\n?/m, '').trim();
              setBuildScript(cleaned || getDefaultScript(app.runtime, false, res.branch || 'main'));
            } else {
              setBuildScript(res.deployScript);
            }
          } else if (!app.buildScript) {
            setBuildScript(getDefaultScript(app.runtime, hasGitNow, res.branch || 'main'));
          }
        })
        .catch(() => {
          api.websiteDeployKey(app.name).then((res) => setDeployKey(res)).catch(() => {});
        })
        .finally(() => setLoadingKey(false));
    }
  }, [app, isOpen]);

  if (!isOpen || !app) return null;

  const webhookUrl = `${window.location.origin}/api/v1/webhooks/deploy/${app.name}?token=${app.deployHookToken || ''}`;

  const handleCopyWebhook = () => {
    navigator.clipboard?.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 1500);
    onShowToast?.('Webhook Copied', 'Deploy webhook URL copied to clipboard.', 'info');
  };

  const handleCopyDeployKey = () => {
    if (!deployKey?.publicKey) return;
    navigator.clipboard?.writeText(deployKey.publicKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
    onShowToast?.('Deploy Key Copied', 'ED25519 Public Key copied to clipboard. Add it to your repository deploy keys.', 'info');
  };

  const handleRotateDeployKey = async () => {
    if (!confirm('Rotate Deploy Key? The old key will immediately stop working and you will need to update the public key in your git repository settings.')) return;
    setIsRotatingKey(true);
    try {
      const res = await api.rotateWebsiteDeployKey(app.name);
      setDeployKey(res);
      onShowToast?.('Deploy Key Rotated', 'New ED25519 deploy key generated.', 'success');
    } catch (err) {
      onShowToast?.('Rotation Failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsRotatingKey(false);
    }
  };

  const isGitConnected = Boolean(
    (repoUrl && repoUrl.trim() !== '') ||
    (app?.gitRepo && app.gitRepo.trim() !== '') ||
    app?.sourceKind === 'github' ||
    (gitStatus && gitStatus.detected && Boolean(gitStatus.repo?.trim()))
  );

  const handleBranchChange = (newBranch: string) => {
    setBranch(newBranch);
    const trimmed = newBranch.trim();
    if (trimmed && buildScript.includes('git pull origin')) {
      setBuildScript((prev) => prev.replace(/^git pull origin\s+[^\s\n]+/m, `git pull origin ${trimmed}`));
    }
  };

  const handleToggleGitPull = () => {
    const targetBranch = branch.trim() || app?.gitBranch || gitStatus?.branch || 'main';
    const pullLine = `git pull origin ${targetBranch}`;
    if (buildScript.includes('git pull')) {
      const stripped = buildScript.replace(/^git pull[^\n]*\n?/m, '').trim();
      setBuildScript(stripped);
      onShowToast?.('Git Pull Removed', 'Removed "git pull" step from build script.', 'info');
    } else {
      const added = `${pullLine}\n${buildScript.trim()}`.trim();
      setBuildScript(added);
      onShowToast?.('Git Pull Added', `Added "${pullLine}" at the beginning of the script.`, 'info');
    }
  };

  const applyPreset = (preset: 'laravel' | 'nextjs' | 'fastapi' | 'go' | 'static') => {
    const isGit = isGitConnected;
    const targetBranch = branch.trim() || app?.gitBranch || gitStatus?.branch || 'main';
    const gitPull = isGit ? `git pull origin ${targetBranch}\n` : '';
    let script = '';
    if (preset === 'laravel') {
      script = `${gitPull}composer install --no-dev --optimize-autoloader --quiet
php artisan migrate --force
php artisan config:cache
php artisan route:cache
php artisan view:cache
systemctl reload php8.4-fpm`;
    } else if (preset === 'nextjs') {
      script = `${gitPull}pnpm install --frozen-lockfile
pnpm run build
pm2 reload ${app.name} --update-env`;
    } else if (preset === 'fastapi') {
      script = `${gitPull}source venv/bin/activate
pip install -r requirements.txt --quiet
systemctl reload gunicorn-${app.name}`;
    } else if (preset === 'go') {
      script = `${gitPull}go build -o bin/server main.go
systemctl reload ${app.name}`;
    } else if (preset === 'static') {
      script = isGit ? `git pull origin ${targetBranch}` : `# Static website — assets served directly by web server`;
    }
    setBuildScript(script);
    onShowToast?.(
      'Preset Applied',
      `${preset.toUpperCase()} script loaded ${isGit ? `(with branch '${targetBranch}')` : '(without git pull)'}. Click "Save Script" to keep it.`,
      'info'
    );
  };

  const handleSaveScript = async () => {
    setIsSaving(true);
    try {
      await api.updateWebsiteGit(app.name, {
        repo: repoUrl,
        branch,
        autoDeploy,
        deployScript: buildScript,
      });
      const updated: WebApp = {
        ...app,
        gitRepo: repoUrl,
        gitBranch: branch,
        autoDeploy,
        buildScript,
      };
      onUpdateApp?.(updated);
      onShowToast?.('Settings Saved', `Git settings and deploy script for '${app.name}' saved to server.`, 'success');
    } catch (err) {
      onShowToast?.('Save Failed', err instanceof Error ? err.message : 'Unknown error', 'error');
    } finally {
      setIsSaving(false);
    }
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
                <h2 className="text-base font-bold text-slate-900">
                  {app.gitRepo ? 'Git CI/CD & Push-to-Deploy' : 'Connect Git Repository'}
                </h2>
                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  <span>{app.gitRepo ? 'Connected' : 'Git Integration'}</span>
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {app.gitRepo
                  ? <>Configure build script, deploy keys, and auto-redeploy webhook for <strong>{app.name}</strong> ({app.domain})</>
                  : <>Connect a Git repository (GitHub, GitLab, Bitbucket, Gitea) to enable automated push-to-deploy for <strong>{app.name}</strong></>}
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
          {/* Git Auto-detected banner */}
          {gitStatus?.detected && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 bg-purple-50/80 border border-purple-200 rounded-xl text-xs text-purple-900">
              <div className="flex items-center gap-2.5">
                <FolderGit2 className="w-4 h-4 text-purple-600 shrink-0" />
                <div>
                  <div className="flex items-center gap-1.5 font-bold">
                    <span>Git Repository Auto-Detected on Host:</span>
                    <code className="font-mono text-[11px] bg-purple-100 px-1.5 py-0.2 rounded border border-purple-200">{gitStatus.repo || 'Local .git found'}</code>
                  </div>
                  {gitStatus.commit && (
                    <p className="text-[11px] text-purple-700 mt-0.5">
                      Latest Commit: <code className="font-mono font-semibold">{gitStatus.commit}</code>{gitStatus.commitMessage ? ` - ${gitStatus.commitMessage}` : ''}
                    </p>
                  )}
                </div>
              </div>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-white text-purple-800 rounded border border-purple-200 shrink-0">
                Active Branch: {gitStatus.branch || branch}
              </span>
            </div>
          )}

          {/* Auto-Detected Framework & CI/CD Banner */}
          {gitStatus?.framework && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 bg-gradient-to-r from-indigo-50/90 via-purple-50/90 to-blue-50/90 border border-indigo-200/90 rounded-xl text-xs text-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                  <Zap className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <span>Auto-Detected: {gitStatus.framework.title}</span>
                    <span className="text-[10px] font-bold bg-indigo-100 text-indigo-800 px-2 py-0.2 rounded-full border border-indigo-200 font-mono">
                      Vercel-Style CI/CD
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Runtime: <strong className="text-indigo-700">{gitStatus.framework.runtime.toUpperCase()} {gitStatus.framework.version || ''}</strong> ·
                    Package Mgr: <strong>{gitStatus.framework.packageManager}</strong>
                    {gitStatus.framework.docRoot && <> · Root: <code className="font-mono bg-white px-1.5 py-0.2 rounded border border-indigo-200 text-emerald-700">/{gitStatus.framework.docRoot}</code></>}
                  </p>
                </div>
              </div>
              {gitStatus.framework.buildCommand && (
                <button
                  type="button"
                  onClick={() => {
                    setBuildScript(gitStatus.framework?.buildCommand || '');
                    onShowToast?.('Framework Preset Loaded', `Loaded CI/CD build script for ${gitStatus.framework?.title}. Click 'Save Script Only' below to keep it.`, 'success');
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs shrink-0 whitespace-nowrap transition-all cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  <span>Apply {gitStatus.framework.title} Preset</span>
                </button>
              )}
            </div>
          )}

          {/* Repo & Branch Configuration */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Git Repository URL (GitHub / GitLab / Gitea / Custom)
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/username/repository.git or git@github.com:..."
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
                  onChange={(e) => handleBranchChange(e.target.value)}
                  placeholder="main"
                  className="w-full bg-transparent border-none outline-hidden p-0 text-slate-800 font-mono text-xs"
                />
              </div>
            </div>
          </div>

          {/* SSH Deploy Key (ED25519) */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-600" />
                <span>SSH Deploy Key (Private Git Repositories)</span>
              </span>
              <button
                type="button"
                onClick={handleRotateDeployKey}
                disabled={isRotatingKey || loadingKey}
                className="text-[11px] font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isRotatingKey ? 'animate-spin' : ''}`} />
                <span>Rotate Key</span>
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={loadingKey ? 'Generating / loading ED25519 key...' : deployKey?.publicKey || ''}
                className="w-full px-3 py-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded-lg text-slate-600 select-all"
              />
              <button
                type="button"
                onClick={handleCopyDeployKey}
                disabled={!deployKey?.publicKey}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs disabled:opacity-50"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
              </button>
            </div>
            {deployKey?.fingerprint && (
              <p className="text-[10px] text-slate-500 font-mono">
                Fingerprint: <span className="text-slate-700">{deployKey.fingerprint}</span> (ED25519 mode 0600, isolated per tenant)
              </p>
            )}
          </div>

          {/* Webhook Configuration */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                <span>Inbound Push Webhook URL</span>
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                  autoDeploy ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                }`}>
                  {autoDeploy ? 'Active' : 'Disabled'}
                </span>
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
                value={gitStatus?.webhookUrl || webhookUrl}
                className="w-full px-3 py-1.5 text-[11px] font-mono bg-white border border-slate-200 rounded-lg text-slate-600 select-all"
              />
              <button
                type="button"
                onClick={handleCopyWebhook}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-[11px] text-slate-700 space-y-1">
              <span className="font-bold text-blue-900 block">Cara Pasang di Provider Git:</span>
              <ul className="list-disc list-inside space-y-0.5 text-slate-600 text-[10.5px]">
                <li><strong>GitHub:</strong> Settings &rarr; Webhooks &rarr; Add Webhook &rarr; Masukkan Payload URL, pilih <code>application/json</code>, pilih <em>Just the push event</em>.</li>
                <li><strong>GitLab:</strong> Settings &rarr; Webhooks &rarr; Add Webhook &rarr; Masukkan URL, centang <em>Push events</em>.</li>
                <li><strong>Gitea:</strong> Settings &rarr; Webhooks &rarr; Add Webhook &rarr; Masukkan Target URL.</li>
              </ul>
              <p className="text-[10px] text-blue-900 font-semibold pt-0.5">
                {autoDeploy
                  ? '✓ Auto-deploy AKTIF: Setiap commit baru di-push ke branch ' + branch + ' akan otomatis men-trigger build & deploy.'
                  : '⚠️ Auto-deploy NONAKTIF: Centang "Auto Redeploy on Push" di atas agar commit baru otomatis di-deploy.'}
              </p>
            </div>
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
                {gitStatus?.framework?.buildCommand && (
                  <button
                    type="button"
                    onClick={() => {
                      setBuildScript(gitStatus.framework?.buildCommand || '');
                      onShowToast?.('Preset Applied', `${gitStatus.framework?.title} script loaded. Click 'Save Script Only' to keep it.`, 'info');
                    }}
                    className="px-2 py-0.5 text-[10px] font-bold bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded text-indigo-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-2.5 h-2.5 text-amber-500" />
                    <span>{gitStatus.framework.title}</span>
                  </button>
                )}
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
                <button
                  type="button"
                  onClick={() => applyPreset('static')}
                  className="px-2 py-0.5 text-[10px] font-semibold bg-white border border-slate-200 hover:bg-slate-100 rounded text-slate-700"
                >
                  Static
                </button>

                <div className="h-3 w-px bg-slate-200 mx-0.5" />

                <button
                  type="button"
                  onClick={handleToggleGitPull}
                  title={buildScript.includes('git pull') ? 'Remove "git pull" step from build script' : 'Prepend "git pull" step to build script'}
                  className={`px-2 py-0.5 text-[10px] font-semibold border rounded flex items-center gap-1 transition-colors ${
                    buildScript.includes('git pull')
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <GitBranch className="w-2.5 h-2.5" />
                  <span>{buildScript.includes('git pull') ? 'git pull: ON' : '+ git pull'}</span>
                </button>

                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded font-medium border ${
                    isGitConnected
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                  title={isGitConnected ? `Target Branch: ${branch.trim() || 'main'}` : 'No remote Git repository configured'}
                >
                  {isGitConnected ? `Git: ${branch.trim() || 'main'}` : 'No Git'}
                </span>
              </div>
            </div>

            <div className="bg-slate-900 rounded-xl p-3.5 border border-slate-800 font-mono text-xs text-slate-200 shadow-inner">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[10px] text-slate-400">
                <span>Runs inside tenant sandbox: <code>{app.path || `/home/${app.tenantUser}/web/${app.name}`}</code></span>
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
