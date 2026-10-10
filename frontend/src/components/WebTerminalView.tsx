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
import type { WebApp, PodItem } from '../types';
import { usePanelSize } from '../hooks/usePanelSize';
import { PanelSizeControl } from './PanelSizeControl';
import { LiveTerminal } from './LiveTerminal';
import { siteSupportsShell } from '../utils/siteRuntime';

interface TerminalTarget {
  kind: 'site' | 'pod';
  id: string;
}

interface WebTerminalViewProps {
  apps: WebApp[];
  /** Containers, so a shell opened from a pod card lands on that pod. */
  pods?: PodItem[];
  target?: TerminalTarget | null;
  onSelectTarget: (target: TerminalTarget) => void;
  /** True when the daemon is reachable: use the real PTY instead of the mock. */
  liveMode?: boolean;
  isAdmin?: boolean;
  onOpenHostConsole?: () => void;
}

export const WebTerminalView: React.FC<WebTerminalViewProps> = ({
  apps,
  pods = [],
  target,
  onSelectTarget,
  liveMode = false,
  isAdmin = false,
  onOpenHostConsole,
}) => {
  // A reverse proxy has no runtime of its own, so it is not offered here.
  const shellApps = apps.filter(siteSupportsShell);
  const skippedProxies = apps.filter((app) => !siteSupportsShell(app));
  const selectedSite = target?.kind === 'site' ? shellApps.find((a) => a.id === target.id) : undefined;
  const selectedPod = target?.kind === 'pod' ? pods.find((p) => p.id === target.id) : undefined;
  const currentApp = selectedSite ?? (selectedPod ? undefined : shellApps[0]);
  const isPod = Boolean(selectedPod);
  // The prompt tells you where you are: a container root, or the tenant shell.
  const prompt = selectedPod
    ? `root@${selectedPod.name}:/#`
    : `${currentApp?.tenantUser ?? 'root'}@barepod:~$`;
  const [hostShell, setHostShell] = useState(false);

  const [terminalHistory, setTerminalHistory] = useState<Array<{ type: 'input' | 'output'; text: string }>>([
    {
      type: 'output',
      text: '',
    }
  ]);
  const [commandInput, setCommandInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { size: termSize, height: termHeight, setSize: setTermSize } = usePanelSize({ sm: 300, md: 420, lg: 620 });

  // Focus without scrolling the page (see HostConsole for the same fix).
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    // The banner describes what this session actually is: a container exec for
    // a pod, or a tenant shell for a website.
    if (selectedPod) {
      setTerminalHistory([
        {
          type: 'output',
          text: `[SYSTEM] Exec session into container '${selectedPod.name}'
Image: ${selectedPod.image}
Ports: ${selectedPod.ports}   Status: ${selectedPod.status}
Note: a container shell exposes the container filesystem only. Type 'help'.

`,
        },
      ]);
      return;
    }
    if (currentApp) {
      setTerminalHistory([
        {
          type: 'output',
          text: `[SYSTEM] Switched context to isolated tenant: '${currentApp.tenantUser}'
Workspace: /home/${currentApp.tenantUser}/apps/${currentApp.name}
Runtime: ${currentApp.runtime.toUpperCase()} ${currentApp.version}
`,
        },
      ]);
    }
  }, [selectedPod, currentApp?.id]);

  // Scroll the terminal pane itself: `scrollIntoView` also scrolls the page,
  // which made the whole view jump down when a session opened.
  useEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    pane.scrollTop = pane.scrollHeight;
  }, [terminalHistory]);

  // Nothing selected yet -> ask which session to open.
  const hasActiveSession = Boolean(selectedSite || selectedPod);

  /** Websites and containers, grouped, so both menus agree on what exists. */
  const renderPicker = (compact = false) => (
    <div className={compact ? 'flex items-center gap-2 overflow-x-auto pb-1' : 'space-y-4'}>
      {compact ? (
        <>
          {shellApps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onSelectTarget({ kind: 'site', id: app.id })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                app.id === currentApp?.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
              }`}
            >
              {app.name}
            </button>
          ))}
          {pods.map((pod) => (
            <button
              key={pod.id}
              type="button"
              onClick={() => onSelectTarget({ kind: 'pod', id: pod.id })}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                pod.id === selectedPod?.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
              }`}
            >
              {pod.name}
            </button>
          ))}
        </>
      ) : (
        <PickerGroups apps={shellApps} pods={pods} selected={target} onSelect={onSelectTarget} />
      )}
    </div>
  );

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
          <div className="flex items-center gap-2">
            {onOpenHostConsole && (
              <button
                type="button"
                onClick={onOpenHostConsole}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              >
                Host console
              </button>
            )}
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
        </div>

        {hostShell && isAdmin ? (
          <LiveTerminal title="Host console" subtitle="/root" isHost />
        ) : selectedPod ? (
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
            <p className="font-semibold">Container shells need the pods module</p>
            <p>
              Exec into <span className="font-mono">{selectedPod.name}</span> arrives with the
              container integration (Phase 3). Website shells are real today.
            </p>
          </div>
        ) : (
          currentApp && (
            <>
              {renderPicker(true)}
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

        <PickerGroups
          apps={shellApps}
          pods={pods}
          selected={target}
          onSelect={onSelectTarget}
        />

        {(skippedProxies.length > 0 || pods.length > 0) && (
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-[11px] text-slate-500 space-y-1">
            {skippedProxies.length > 0 && (
              <p>
                Not listed: <span className="font-mono">{skippedProxies.map((a) => a.name).join(', ')}</span> — a
                reverse proxy has no runtime of its own; its process runs in the upstream container, so open the
                shell there.
              </p>
            )}
            {pods.length > 0 && (
              <p>Container sessions are simulated until the pods module lands (Phase 3); website shells are real.</p>
            )}
          </div>
        )}
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

    // Container session: only what a container shell can actually answer, with
    // secrets masked rather than printed.
    if (selectedPod) {
      let response: string;
      if (trimmed === 'help') {
        response = `Available container commands:
  ls /            : container filesystem root
  ls /data        : the mounted volume
  env             : container environment (secrets masked)
  ps              : processes
  whoami          : current user
  cat /etc/os-release
  exit            : close the session
  clear           : clear the screen`;
      } else if (trimmed === 'whoami') {
        response = 'root';
      } else if (trimmed === 'ls /') {
        response = 'bin  data  dev  etc  home  lib  proc  root  run  sbin  srv  sys  tmp  usr  var';
      } else if (trimmed === 'ls /data') {
        response = 'dump.rdb  lost+found';
      } else if (trimmed === 'env') {
        response = (selectedPod.envVars ?? [])
          .map((v) => `${v.key}=${v.isSecret ? '********' : v.value}`)
          .join('\n');
      } else if (trimmed === 'ps') {
        response = `PID   USER   COMMAND\n  1   root   ${selectedPod.image.split(':')[0]}`;
      } else if (trimmed.startsWith('cat /etc/os-release')) {
        response = 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.20';
      } else if (trimmed === 'exit') {
        response = '[session closed]';
      } else {
        response = `sh: ${trimmed}: not found (container shell — type 'help')`;
      }
      setTerminalHistory([...newHistory, { type: 'output', text: response }]);
      setCommandInput('');
      return;
    }


    // Everything below is website-specific; a container session returned above.
    const app = currentApp ?? shellApps[0];
    if (!app) return;

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
      const phpVer = app.runtime === 'php' ? app.version : '8.4';
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
      const phpVer = app.runtime === 'php' ? app.version : '8.4';
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
      if (app.runtime === 'nodejs') {
        response = `v${app.version.replace(' LTS', '')}.11.0`;
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
      if (app.runtime === 'python') {
        response = `Python ${app.version}.8 (main, Oct 10 2026, 11:22:15) [GCC 13.2.0] on linux`;
      } else {
        response = `Python 3.12.3 (main, Oct 10 2026, 11:22:15) [GCC 13.2.0] on linux (Polyglot Runtime linked in PATH)`;
      }
    } else if (trimmed === 'pip -V' || trimmed === 'pip3 -V' || trimmed === 'pip') {
      response = `pip 24.0 from /usr/local/lib/python3.12/site-packages/pip (python 3.12)`;
    } else if (trimmed === 'pwd') {
      response = `/home/${app.tenantUser}/apps/${app.name}`;
    } else if (trimmed === 'whoami') {
      response = `${app.tenantUser} (uid=1002, gid=1002, groups=tenant-jail,hybrid-developers)`;
    } else if (trimmed === 'ls -la' || trimmed === 'ls') {
      if (app.runtime === 'php') {
        response = `total 80
drwxr-xr-x 9 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:30 .
drwxr-xr-x 3 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:29 ..
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  632 Oct 10 16:30 .env
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser} 1240 Oct 10 16:30 artisan
drwxr-xr-x 2 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:30 app
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser} 1850 Oct 10 16:30 composer.json
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  540 Oct 10 16:30 package.json
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  120 Oct 10 16:30 vite.config.js
drwxr-xr-x 4 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:30 public
drwxr-xr-x 3 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:30 ai_scripts (python workers)
drwxr-xr-x 5 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 16:30 storage`;
      } else if (app.runtime === 'nodejs') {
        response = `total 64
drwxr-xr-x 7 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 17:00 .
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  420 Oct 10 17:00 package.json
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser} 8420 Oct 10 17:00 pnpm-lock.yaml
drwxr-xr-x 3 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 17:00 src
drwxr-xr-x 2 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 17:00 dist`;
      } else {
        response = `total 48
drwxr-xr-x 5 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 17:15 .
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  310 Oct 10 17:15 main.py
-rw-r--r-- 1 ${app.tenantUser} ${app.tenantUser}  120 Oct 10 17:15 requirements.txt
drwxr-xr-x 4 ${app.tenantUser} ${app.tenantUser} 4096 Oct 10 17:15 venv`;
      }
    } else if (trimmed === 'composer -V' || trimmed === 'composer --version') {
      const phpVer = app.runtime === 'php' ? app.version : '8.4';
      response = `Composer version 2.7.9 2026-09-04 14:02:12 (PHP ${phpVer}.2)`;
    } else if (trimmed === 'env') {
      const phpVer = app.runtime === 'php' ? app.version : '8.4';
      response = `USER=${app.tenantUser}
HOME=/home/${app.tenantUser}
APP_PATH=/home/${app.tenantUser}/apps/${app.name}
BAREPOD_RUNTIME=${app.runtime}
BAREPOD_VERSION=${app.version}
BAREPOD_HYBRID_MONOREPO=enabled
PATH=/opt/runtimes/${app.runtime}/${app.version}/bin:/opt/runtimes/php/${phpVer}/bin:/opt/runtimes/nodejs/22/bin:/opt/runtimes/python/3.12/bin:/usr/local/bin:/usr/bin
NODE_PATH=/opt/runtimes/nodejs/22/lib/node_modules
PYTHONPATH=/home/${app.tenantUser}/apps/${app.name}/ai_scripts
SHELL=/bin/bash`;
    } else {
      response = `bash: ${trimmed}: command executed in ${app.tenantUser} polyglot jail. Type 'help' to see sample commands.`;
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
            {selectedPod
              ? `Container exec session — ${selectedPod.image}`
              : `CLI session with the runtime loaded${
                  currentApp ? ` (${currentApp.runtime.toUpperCase()} ${currentApp.version})` : ''
                }`}
          </p>
        </div>

        {/* Session switcher: the same websites and containers as the other menus */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Session:</label>
          <select
            value={selectedPod ? `pod:${selectedPod.id}` : currentApp ? `site:${currentApp.id}` : ''}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              onSelectTarget({ kind: kind === 'pod' ? 'pod' : 'site', id });
            }}
            className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg shadow-2xs focus:outline-hidden focus:ring-2 focus:ring-blue-500/20 text-slate-800"
          >
            <optgroup label="Websites">
              {shellApps.map((app) => (
                <option key={app.id} value={`site:${app.id}`}>
                  {app.name} ({app.tenantUser} • {app.runtime.toUpperCase()} {app.version})
                </option>
              ))}
            </optgroup>
            {pods.length > 0 && (
              <optgroup label="Containers">
                {pods.map((pod) => (
                  <option key={pod.id} value={`pod:${pod.id}`}>
                    {pod.name} ({pod.image})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* Quick Test Action Chips — container sessions get container commands */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 font-medium">Quick commands:</span>
        {(selectedPod
          ? [
              { label: 'ls /', cmd: 'ls /' },
              { label: 'ls /data', cmd: 'ls /data' },
              { label: 'env', cmd: 'env' },
              { label: 'ps', cmd: 'ps' },
              { label: 'whoami', cmd: 'whoami' },
              { label: 'clear', cmd: 'clear' },
            ]
          : [
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
            ]
        ).map((item) => (
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
              {selectedPod
                ? `root@${selectedPod.name} — ${selectedPod.image}`
                : currentApp
                  ? `${currentApp.tenantUser}@barepod-${currentApp.name}: /home/${currentApp.tenantUser}/apps/${currentApp.name}`
                  : 'no session selected'}
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
        <div ref={scrollRef} className="flex-1 min-h-0 p-5 overflow-y-auto space-y-2.5">
          {terminalHistory.map((item, idx) => (
            <div key={idx} className="leading-relaxed whitespace-pre-wrap">
              {item.type === 'input' ? (
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="text-blue-400">{prompt}</span>
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
            <span className="text-blue-400 font-semibold">{prompt}</span>
            <input
              type="text"
              ref={inputRef}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command (try 'php -v', 'ls -la', 'help')..."
              className="flex-1 bg-transparent border-none outline-hidden text-slate-100 font-mono text-xs placeholder:text-slate-600 focus:ring-0"
            />
          </div>
        </div>
        <PanelSizeControl value={termSize} onChange={setTermSize} dark />
      </div>
    </div>
  );
};

interface PickerGroupsProps {
  apps: WebApp[];
  pods: PodItem[];
  selected?: TerminalTarget | null;
  onSelect: (target: TerminalTarget) => void;
}

/**
 * The two kinds of shell target, in one list so the Website, Pods and Terminal
 * menus always agree on what exists.
 */
const PickerGroups: React.FC<PickerGroupsProps> = ({ apps, pods, selected, onSelect }) => (
  <div className="space-y-5">
    {apps.length > 0 && (
      <div className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Websites</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {apps.map((app) => {
            const active = selected?.kind === 'site' && selected.id === app.id;
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => onSelect({ kind: 'site', id: app.id })}
                className={`text-left bg-white border rounded-2xl p-4 transition-all cursor-pointer group ${
                  active ? 'border-blue-500 ring-1 ring-blue-200' : 'border-slate-200 hover:border-blue-400 hover:shadow-md'
                }`}
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
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      app.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {app.status}
                  </span>
                </div>

                <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                  /home/{app.tenantUser}/apps/{app.name}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    )}

    {pods.length > 0 && (
      <div className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Containers</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pods.map((pod) => {
            const active = selected?.kind === 'pod' && selected.id === pod.id;
            return (
              <button
                key={pod.id}
                type="button"
                onClick={() => onSelect({ kind: 'pod', id: pod.id })}
                className={`text-left bg-white border rounded-2xl p-4 transition-all cursor-pointer group ${
                  active ? 'border-slate-900 ring-1 ring-slate-300' : 'border-slate-200 hover:border-slate-400 hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-700 text-white flex items-center justify-center shrink-0">
                      <TerminalIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-semibold text-sm text-slate-900 block truncate">{pod.name}</span>
                      <span className="text-[11px] text-slate-400 font-mono block truncate">{pod.image}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
                </div>

                <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-slate-100 text-slate-600">
                    container
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600 font-mono">
                    {pod.ports}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      pod.status === 'running' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {pod.status}
                  </span>
                </div>

                <div className="mt-2 text-[10px] text-slate-400 font-mono truncate">
                  docker exec -it {pod.name} sh
                </div>
              </button>
            );
          })}
        </div>
      </div>
    )}
  </div>
);
