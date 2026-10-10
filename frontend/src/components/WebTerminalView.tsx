import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  ShieldCheck, 
  Cpu, 
  RefreshCw, 
  Maximize2, 
  Copy, 
  Trash2,
  Info,
  ChevronRight
} from 'lucide-react';
import type { WebApp } from '../types';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';
import { LiveTerminal } from './LiveTerminal';

interface WebTerminalViewProps {
  apps: WebApp[];
  selectedAppId?: string | null;
  onSelectApp: (appId: string) => void;
  /** True when the daemon is reachable: use the real PTY instead of the mock. */
  liveMode?: boolean;
  isAdmin?: boolean;
}

export const WebTerminalView: React.FC<WebTerminalViewProps> = ({
  apps,
  selectedAppId,
  onSelectApp,
  liveMode = false,
  isAdmin = false,
}) => {
  const currentApp = apps.find(a => a.id === selectedAppId) || apps[0];
  const [hostShell, setHostShell] = useState(false);
  
  const [terminalHistory, setTerminalHistory] = useState<Array<{ type: 'input' | 'output'; text: string }>>([
    { 
      type: 'output', 
      text: `BarePod Isolated PTY Sandbox v1.0.0 (cgroups v2 + tenant namespace active)\nConnected to session: ${currentApp?.tenantUser || 'root'}@barepod-${currentApp?.name || 'app'}\nRuntime environment auto-loaded: ${currentApp?.runtime.toUpperCase()} ${currentApp?.version}\nType 'help' for available test commands.` 
    }
  ]);
  const [commandInput, setCommandInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const { size: termSize, height: termHeight, setSize: setTermSize } = usePanelSize({ sm: 300, md: 420, lg: 620 });

  useEffect(() => {
    // Reset terminal banner when changing app
    if (currentApp) {
      setTerminalHistory([
        { 
          type: 'output', 
          text: `[SYSTEM] Switched context to isolated tenant: '${currentApp.tenantUser}'
Workspace: /home/${currentApp.tenantUser}/apps/${currentApp.name}
Polyglot PATH: ${currentApp.runtime.toUpperCase()} ${currentApp.version} (Primary) + Node.js 22 LTS + Python 3.12
Hybrid Monorepo Sandbox: ACTIVE (Full multi-runtime support for PHP backend, Vite/Node frontend & Python workers)
` 
        }
      ]);
    }
  }, [currentApp?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalHistory]);

  // No session selected yet -> ask the user to pick a site before opening the PTY
  const hasActiveSession = Boolean(selectedAppId && apps.some((a) => a.id === selectedAppId));

  // Live mode: a real PTY over WebSocket, running as the tenant (or as root for
  // the host shell, which is administrators only).
  if (liveMode && (hasActiveSession || (hostShell && isAdmin))) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-5 animate-in fade-in duration-200">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Isolated Web Terminal</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Each session runs as that website's tenant user, inside its own directory.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100">
              <button
                type="button"
                onClick={() => setHostShell(false)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  !hostShell ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Website shell
              </button>
              <button
                type="button"
                onClick={() => setHostShell(true)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  hostShell ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Host shell (root)
              </button>
            </div>
          )}
        </div>

        {hostShell && isAdmin ? (
          <LiveTerminal title="Host console" subtitle="/root" isHost />
        ) : (
          currentApp && (
            <>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {apps.map((app) => (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => onSelectApp(app.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                      app.id === currentApp.id
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    {app.name}
                  </button>
                ))}
              </div>
              <LiveTerminal
                slug={currentApp.id}
                title={currentApp.name}
                subtitle={`${currentApp.tenantUser}@${currentApp.name}`}
              />
            </>
          )
        )}
      </div>
    );
  }

  if (!hasActiveSession) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Isolated Web Terminal</h1>
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" /> Tenant Sandboxed
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Select a site or app to open its CLI session. Each session uses that app's tenant user, working directory, and runtime version.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onSelectApp(app.id)}
              className="text-left bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-2xl p-4 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <TerminalIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <span className="font-semibold text-sm text-slate-900 block truncate">{app.name}</span>
                    <span className="text-[11px] text-slate-400 font-mono block truncate">{app.domain}</span>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors shrink-0" />
              </div>

              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-blue-50 text-blue-700">
                  {app.runtime.toUpperCase()} {app.version}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 font-mono">
                  {app.tenantUser}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  app.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>
                  {app.status}
                </span>
              </div>

              <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                /home/{app.tenantUser}/apps/{app.name}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

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
      response = `Available commands in this Polyglot Hybrid Sandbox:
  php -v        : Check active PHP version (Primary runtime or Polyglot shim)
  php -m        : List all loaded PHP extensions (redis, imagick, swoole, pdo_*, etc.)
  php --ini     : Show loaded php.ini and additional configuration files
  php artisan   : Run Laravel Artisan command
  node -v       : Check active Node.js version (ready for Vite / Tailwind build)
  npm -v        : Check NPM package manager version
  npx -v        : Check NPX package runner
  pnpm -v       : Check fast PNPM package manager
  python -v     : Check active Python version (ready for AI/Scraping scripts)
  pip -V        : Check Python PIP package manager
  composer -V   : Check PHP Composer version
  ls -la        : List directory files in isolated tenant jail
  pwd           : Print current isolated working directory
  whoami        : Show active tenant user
  env           : Show polyglot environment variables & PATH
  clear         : Clear terminal screen`;
    } else if (trimmed === 'php -v' || trimmed === 'php --version') {
      const phpVer = currentApp.runtime === 'php' ? currentApp.version : '8.4';
      response = `PHP ${phpVer}.2 (cli) (built: Oct 10 2026 12:40:11) (NTS)
Copyright (c) The PHP Group
Zend Engine v4.4.2, Copyright (c) Zend Technologies
    with Zend OPcache v${phpVer}.2, Copyright (c), by Zend Technologies`;
    } else if (trimmed === 'php -m' || trimmed === 'php --modules') {
      response = `[PHP Modules]
bcmath
bz2
calendar
Core
ctype
curl
date
dom
exif
fileinfo
filter
ftp
gd
gettext
hash
iconv
imagick
intl
json
libxml
mbstring
mysqli
mysqlnd
openssl
pcntl
pcre
PDO
pdo_mysql
pdo_pgsql
pdo_sqlite
Phar
posix
readline
redis
Reflection
session
shmop
SimpleXML
soap
sockets
sodium
SPL
standard
swoole
sysvmsg
sysvsem
sysvshm
tokenizer
xml
xmlreader
xmlwriter
xsl
Zend OPcache
zip
zlib

[Zend Modules]
Zend OPcache`;
    } else if (trimmed === 'php --ini') {
      const phpVer = currentApp.runtime === 'php' ? currentApp.version : '8.4';
      response = `Configuration File (php.ini) Path: /etc/php/${phpVer}/cli
Loaded Configuration File:         /etc/php/${phpVer}/cli/php.ini
Scan for additional .ini files in: /etc/php/${phpVer}/cli/conf.d
Additional .ini files parsed:      10-opcache.ini, 20-bcmath.ini, 20-curl.ini, 20-gd.ini, 20-imagick.ini, 20-intl.ini, 20-mbstring.ini, 20-pdo_mysql.ini, 20-pdo_pgsql.ini, 20-redis.ini, 20-swoole.ini, 20-zip.ini`;
    } else if (trimmed === 'php artisan' || trimmed === 'artisan') {
      response = `Laravel Framework 12.1.4

Usage:
  command [options] [arguments]

Options:
  -h, --help            Display help for the given command
  -q, --quiet           Do not output any message
  -V, --version         Display this application version
  --env[=ENV]           The environment the command should run under

Available commands:
  about                 Display basic information about your application
  clear-compiled        Remove the compiled class file
  migrate               Run the database migrations
  optimize              Cache the framework bootstrap files
  route:list            List all registered routes
  schedule:run          Run the scheduled tasks`;
    } else if (trimmed === 'node -v' || trimmed === 'nodejs -v' || trimmed === 'node --version') {
      if (currentApp.runtime === 'nodejs') {
        response = `v${currentApp.version.replace(' LTS', '')}.11.0`;
      } else {
        response = `v22.11.0 (Node.js 22 LTS active in tenant PATH for Vite/Tailwind frontend builds)`;
      }
    } else if (trimmed === 'npm -v' || trimmed === 'npm --version' || trimmed === 'npm') {
      response = `10.8.2`;
    } else if (trimmed === 'npx -v' || trimmed === 'npx') {
      response = `10.8.2`;
    } else if (trimmed === 'pnpm -v' || trimmed === 'pnpm') {
      response = `9.12.0`;
    } else if (trimmed === 'python -v' || trimmed === 'python --version' || trimmed === 'python3 --version' || trimmed === 'python3 -V') {
      if (currentApp.runtime === 'python') {
        response = `Python ${currentApp.version}.8 (main, Oct 10 2026, 11:22:15) [GCC 13.2.0] on linux`;
      } else {
        response = `Python 3.12.3 (main, Oct 10 2026, 11:22:15) [GCC 13.2.0] on linux (Polyglot Runtime linked in PATH)`;
      }
    } else if (trimmed === 'pip -V' || trimmed === 'pip3 -V' || trimmed === 'pip') {
      response = `pip 24.0 from /usr/local/lib/python3.12/site-packages/pip (python 3.12)`;
    } else if (trimmed === 'pwd') {
      response = `/home/${currentApp.tenantUser}/apps/${currentApp.name}`;
    } else if (trimmed === 'whoami') {
      response = `${currentApp.tenantUser} (uid=1002, gid=1002, groups=tenant-jail,hybrid-developers)`;
    } else if (trimmed === 'ls -la' || trimmed === 'ls') {
      if (currentApp.runtime === 'php') {
        response = `total 80
drwxr-xr-x 9 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 .
drwxr-xr-x 3 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:29 ..
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  632 Oct 10 16:30 .env
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser} 1240 Oct 10 16:30 artisan
drwxr-xr-x 2 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 app
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser} 1850 Oct 10 16:30 composer.json
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  540 Oct 10 16:30 package.json
-rw-r--r-- 1 ${currentApp.tenantUser} ${currentApp.tenantUser}  120 Oct 10 16:30 vite.config.js
drwxr-xr-x 4 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 public
drwxr-xr-x 3 ${currentApp.tenantUser} ${currentApp.tenantUser} 4096 Oct 10 16:30 ai_scripts (python workers)
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
      const phpVer = currentApp.runtime === 'php' ? currentApp.version : '8.4';
      response = `Composer version 2.7.9 2026-09-04 14:02:12 (PHP ${phpVer}.2)`;
    } else if (trimmed === 'env') {
      const phpVer = currentApp.runtime === 'php' ? currentApp.version : '8.4';
      response = `USER=${currentApp.tenantUser}
HOME=/home/${currentApp.tenantUser}
APP_PATH=/home/${currentApp.tenantUser}/apps/${currentApp.name}
BAREPOD_RUNTIME=${currentApp.runtime}
BAREPOD_VERSION=${currentApp.version}
BAREPOD_HYBRID_MONOREPO=enabled
PATH=/opt/runtimes/${currentApp.runtime}/${currentApp.version}/bin:/opt/runtimes/php/${phpVer}/bin:/opt/runtimes/nodejs/22/bin:/opt/runtimes/python/3.12/bin:/usr/local/bin:/usr/bin
NODE_PATH=/opt/runtimes/nodejs/22/lib/node_modules
PYTHONPATH=/home/${currentApp.tenantUser}/apps/${currentApp.name}/ai_scripts
SHELL=/bin/bash`;
    } else {
      response = `bash: ${trimmed}: command executed in ${currentApp.tenantUser} polyglot jail. Type 'help' to see sample commands.`;
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

      {/* Quick Test Action Chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Quick commands:</span>
        {[
          { label: 'php -v', cmd: 'php -v' },
          { label: 'php -m (Extensions)', cmd: 'php -m' },
          { label: 'php --ini', cmd: 'php --ini' },
          { label: 'node -v', cmd: 'node -v' },
          { label: 'npm -v', cmd: 'npm -v' },
          { label: 'python -v', cmd: 'python -v' },
          { label: 'pip -V', cmd: 'pip -V' },
          { label: 'php artisan', cmd: 'php artisan' },
          { label: 'ls -la', cmd: 'ls -la' },
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
      <div
        className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl overflow-hidden font-mono text-xs text-slate-200 flex flex-col"
        style={{ height: termHeight }}
      >
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
        <div className="flex-1 min-h-0 p-5 overflow-y-auto space-y-2.5">
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
        <PanelSizeControl value={termSize} onChange={setTermSize} dark />
      </div>
    </div>
  );
};
