import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  ShieldCheck, 
  Cpu, 
  RefreshCw, 
  Maximize2, 
  Copy, 
  Trash2,
  Sparkles,
  Info
} from 'lucide-react';
import type { WebApp } from '../types';

interface WebTerminalViewProps {
  apps: WebApp[];
  selectedAppId?: string;
  onSelectApp: (appId: string) => void;
}

export const WebTerminalView: React.FC<WebTerminalViewProps> = ({
  apps,
  selectedAppId,
  onSelectApp,
}) => {
  const currentApp = apps.find(a => a.id === selectedAppId) || apps[0];
  
  const [terminalHistory, setTerminalHistory] = useState<Array<{ type: 'input' | 'output'; text: string }>>([
    { 
      type: 'output', 
      text: `BarePod Isolated PTY Sandbox v1.0.0 (cgroups v2 + tenant namespace active)\nConnected to session: ${currentApp?.tenantUser || 'root'}@barepod-${currentApp?.name || 'app'}\nRuntime environment auto-loaded: ${currentApp?.runtime.toUpperCase()} ${currentApp?.version}\nType 'help' for available test commands.` 
    }
  ]);
  const [commandInput, setCommandInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset terminal banner when changing app
    if (currentApp) {
      setTerminalHistory([
        { 
          type: 'output', 
          text: `[SYSTEM] Switched context to isolated tenant: '${currentApp.tenantUser}'\nWorkspace: /home/${currentApp.tenantUser}/apps/${currentApp.name}\nActive CLI Shim: ${currentApp.runtime.toUpperCase()} ${currentApp.version}\n` 
        }
      ]);
    }
  }, [currentApp?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory]);

  const executeCommand = (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;

    const newHistory = [...terminalHistory, { type: 'input' as const, text: trimmed }];

    if (trimmed === 'clear') {
      setTerminalHistory([]);
      setCommandInput('');
      return;
    }

    let response = '';

    if (trimmed === 'help') {
      response = `Available commands in this isolated sandbox:
  php -v        : Check active PHP version (auto-switched per site)
  node -v       : Check active Node.js version
  python -v     : Check active Python version
  ls -la        : List directory files in isolated tenant jail
  pwd           : Print current isolated working directory
  whoami        : Show active tenant user
  composer -V   : Check PHP Composer version
  pnpm -v       : Check fast PNPM package manager
  env           : Show isolated environment variables
  clear         : Clear terminal screen`;
    } else if (trimmed === 'php -v') {
      if (currentApp.runtime === 'php') {
        response = `PHP ${currentApp.version}.2 (cli) (built: Oct 10 2026 12:40:11) (NTS)
Copyright (c) The PHP Group
Zend Engine v4.4.2, Copyright (c) Zend Technologies
    with Zend OPcache v8.4.2, Copyright (c), by Zend Technologies`;
      } else {
        response = `bash: php: command not loaded in default PATH for ${currentApp.runtime.toUpperCase()} container. (Auto-isolated)`;
      }
    } else if (trimmed === 'node -v' || trimmed === 'nodejs -v') {
      if (currentApp.runtime === 'nodejs') {
        response = `v${currentApp.version.replace(' LTS', '')}.11.0`;
      } else {
        response = `bash: node: command not linked in ${currentApp.runtime.toUpperCase()} jail environment.`;
      }
    } else if (trimmed === 'python -v' || trimmed === 'python --version' || trimmed === 'python3 --version') {
      if (currentApp.runtime === 'python') {
        response = `Python ${currentApp.version}.8 (main, Oct 10 2026, 11:22:15) [GCC 13.2.0] on linux`;
      } else {
        response = `bash: python: isolated environment for ${currentApp.runtime.toUpperCase()}.`;
      }
    } else if (trimmed === 'pwd') {
      response = `/home/${currentApp.tenantUser}/apps/${currentApp.name}`;
    } else if (trimmed === 'whoami') {
      response = `${currentApp.tenantUser} (uid=1002, gid=1002, groups=tenant-jail)`;
    } else if (trimmed === 'ls -la' || trimmed === 'ls') {
      if (currentApp.runtime === 'php') {
        response = `total 72
drwxr-xr-x 8 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 .
drwxr-xr-x 3 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:29 ..
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  632 Oct 10 16:30 .env
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser} 1240 Oct 10 16:30 artisan
drwxr-xr-x 2 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 app
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser} 1850 Oct 10 16:30 composer.json
drwxr-xr-x 4 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 public
drwxr-xr-x 5 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 storage`;
      } else if (currentApp.runtime === 'nodejs') {
        response = `total 64
drwxr-xr-x 7 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 17:00 .
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  420 Oct 10 17:00 package.json
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser} 8420 Oct 10 17:00 pnpm-lock.yaml
drwxr-xr-x 3 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 17:00 src
drwxr-xr-x 2 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 17:00 dist`;
      } else {
        response = `total 48
drwxr-xr-x 5 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 17:15 .
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  310 Oct 10 17:15 main.py
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  120 Oct 10 17:15 requirements.txt
drwxr-xr-x 4 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 17:15 venv`;
      }
    } else if (trimmed === 'composer -V' || trimmed === 'composer --version') {
      response = `Composer version 2.7.9 2026-09-04 14:02:12 (PHP ${currentApp.version})`;
    } else if (trimmed === 'pnpm -v') {
      response = `9.12.0`;
    } else if (trimmed === 'env') {
      response = `USER=${currentApp.tenantUser}
HOME=/home/${currentApp.tenantUser}
APP_PATH=/home/${currentApp.tenantUser}/apps/${currentApp.name}
BAREPOD_RUNTIME=${currentApp.runtime}
BAREPOD_VERSION=${currentApp.version}
PATH=/opt/runtimes/${currentApp.runtime}/${currentApp.version}/bin:/usr/local/bin:/usr/bin
SHELL=/bin/bash`;
    } else {
      response = `bash: ${trimmed}: command executed in ${currentApp.tenantUser} isolated jail. Type 'help' to see sample commands.`;
    }

    newHistory.push({ type: 'output', text: response });
    setTerminalHistory(newHistory);
    setCommandInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(commandInput);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Title & App Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Isolated Web Terminal</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Tenant Sandboxed
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time CLI session with automatic runtime switching ({currentApp.runtime.toUpperCase()} {currentApp.version})
          </p>
        </div>

        {/* Tenant / App Session Switcher */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Switch Site Session:</label>
          <select
            value={currentApp?.id}
            onChange={(e) => onSelectApp(e.target.value)}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-slate-800"
          >
            {apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name} ({app.tenantUser} • {app.runtime.toUpperCase()} {app.version})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Feature Explainer Banner */}
      <div className="p-4 bg-indigo-50/70 border border-indigo-200/60 rounded-xl flex items-start gap-3 text-xs text-indigo-900">
        <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Sistem Otomatisasi CLI Multi-Tenant:</span>
          <p className="text-indigo-700 mt-0.5">
            Di BarePod, setiap user/site memiliki sandbox isolasi mandiri. Saat Anda memilih <strong>{currentApp.name}</strong>, perintah <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold text-indigo-900">php -v</code> atau <code className="bg-white/80 px-1 py-0.5 rounded font-mono font-bold text-indigo-900">node -v</code> otomatis menggunakan versi yang dipilih pada website tersebut tanpa mengganggu user lain di server.
          </p>
        </div>
      </div>

      {/* Quick Test Action Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Quick commands:</span>
        {[
          { label: 'php -v', cmd: 'php -v' },
          { label: 'node -v', cmd: 'node -v' },
          { label: 'python -v', cmd: 'python -v' },
          { label: 'ls -la', cmd: 'ls -la' },
          { label: 'pwd', cmd: 'pwd' },
          { label: 'whoami', cmd: 'whoami' },
          { label: 'env', cmd: 'env' },
          { label: 'clear', cmd: 'clear' },
        ].map((item) => (
          <button
            key={item.label}
            onClick={() => executeCommand(item.cmd)}
            className="px-2.5 py-1 text-xs font-mono bg-white hover:bg-slate-50 border border-slate-200 rounded-md text-slate-700 hover:text-blue-600 transition-colors shadow-2xs"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Terminal Window (Styled like a modern Linux PTY Console) */}
      <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden font-mono text-xs text-slate-200">
        {/* Terminal Header */}
        <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="text-slate-400 text-[11px] ml-2">
              {currentApp.tenantUser}@barepod-{currentApp.name}: /home/{currentApp.tenantUser}/apps/{currentApp.name}
            </span>
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
              SSH PTY: ws://127.0.0.1:4040
            </span>
            <button
              onClick={() => setTerminalHistory([])}
              className="hover:text-white transition-colors"
              title="Clear Terminal"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal Screen Body */}
        <div className="p-5 min-h-[380px] max-h-[500px] overflow-y-auto space-y-2.5">
          {terminalHistory.map((item, idx) => (
            <div key={idx} className="leading-relaxed whitespace-pre-wrap">
              {item.type === 'input' ? (
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="text-blue-400">{currentApp.tenantUser}@barepod:~$</span>
                  <span className="text-slate-100 font-bold">{item.text}</span>
                </div>
              ) : (
                <div className="text-slate-300 pl-2 border-l border-slate-800">
                  {item.text}
                </div>
              )}
            </div>
          ))}

          {/* Active Command Input Line */}
          <div className="flex items-center gap-2 pt-1 text-emerald-400">
            <span className="text-blue-400 font-semibold">{currentApp.tenantUser}@barepod:~$</span>
            <input
              type="text"
              autoFocus
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command (try 'php -v', 'ls -la', 'help')..."
              className="flex-1 bg-transparent border-none outline-hidden text-slate-100 font-mono text-xs placeholder:text-slate-600 focus:ring-0"
            />
          </div>
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
};
