import React, { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Cpu, HardDrive, Activity } from 'lucide-react';
import { useResizableHeight } from '../hooks/useResizableHeight';

interface HostConsoleProps {
  hostname?: string;
}

export const HostConsole: React.FC<HostConsoleProps> = ({ hostname = 'vps-barepod-edge-01' }) => {
  const [history, setHistory] = useState<Array<{ type: 'input' | 'output'; text: string }>>([
    {
      type: 'output',
      text: `BarePod Host Console — root shell\n${hostname} • Debian 12 Bookworm • Linux 6.1.0-21-amd64\nType 'help' for available host commands.`,
    },
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const { height: termHeight, onDragStart: onTermDragStart } = useResizableHeight(380, 220, 900);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const run = (raw: string) => {
    const command = raw.trim();
    if (!command) return;
    if (command === 'clear') {
      setHistory([]);
      setInput('');
      return;
    }

    let out: string;
    if (command === 'help') {
      out = `Available host commands:
  htop / top            Live process viewer (host)
  uptime                Load average & uptime
  free -m               Memory usage
  df -h                 Disk usage
  systemctl status <u>  Service status (nginx, caddy, docker, cloudflared...)
  docker ps             Running containers
  ls /var/www/apps      Tenant applications
  whoami                Current user (root)
  clear                 Clear screen`;
    } else if (command === 'htop' || command === 'top') {
      out = `Tasks: 142 total, 2 running, 140 sleeping   Load avg: 0.42 0.38 0.35

  PID USER        CPU%  MEM%  COMMAND
 1912 mysql        1.9   3.8  /usr/sbin/mariadbd --datadir=/var/lib/mysql
 2140 redis        0.3   0.4  /usr/bin/redis-server 127.0.0.1:6379
 3051 nginx        0.6   0.5  nginx: worker process
  982 caddy        0.4   0.6  /usr/bin/caddy run --config /etc/caddy/Caddyfile
 4102 docker       0.9   1.2  dockerd --host=unix:///var/run/docker.sock
 5210 cloudflared  0.2   0.3  cloudflared tunnel run barepod-edge`;
    } else if (command === 'uptime') {
      out = ` 18:42:05 up 18 days,  4:12,  2 users,  load average: 0.42, 0.38, 0.35`;
    } else if (command === 'free -m') {
      out = `               total        used        free      shared  buff/cache   available
Mem:            8192        2160        4820         128        1212        5709
Swap:           2048          84        1964`;
    } else if (command === 'df -h') {
      out = `Filesystem      Size  Used Avail Use% Mounted on
/dev/nvme0n1p2  160G   28G  124G  19% /
tmpfs           3.9G     0  3.9G   0% /dev/shm
/dev/nvme0n1p1  512M   62M  450M  13% /boot/efi
overlay         160G   28G  124G  19% /var/lib/docker/overlay2`;
    } else if (command.startsWith('systemctl status')) {
      const unit = command.split(' ').slice(2).join(' ') || 'barepod-daemon.service';
      out = `● ${unit} - ${unit.replace('.service', '')} service
     Loaded: loaded (/lib/systemd/system/${unit}; enabled; preset: enabled)
     Active: active (running) since Sat 2026-09-22 14:30:12 UTC; 18 days ago
   Main PID: 1422 (${unit.replace('.service', '')})
      Tasks: 12 (limit: 9418)
     Memory: 128.4M`;
    } else if (command === 'docker ps') {
      out = `CONTAINER ID   IMAGE              STATUS         PORTS                    NAMES
a1b2c3d4e5f6   n8n:latest         Up 6 days      0.0.0.0:5678->5678/tcp   n8n-workflow
9f8e7d6c5b4a   redis:7.2          Up 18 days     0.0.0.0:6379->6379/tcp   redis-pod`;
    } else if (command.startsWith('ls')) {
      out = `clientA  farras  tenant_alex  tenant_clientB`;
    } else if (command === 'whoami') {
      out = `root (uid=0, gid=0) — host shell, not tenant-jailed`;
    } else {
      out = `bash: ${command}: command not found. Type 'help' for host commands.`;
    }

    setHistory((prev) => [...prev, { type: 'input', text: command }, { type: 'output', text: out }]);
    setInput('');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>LOAD AVERAGE</span>
            <Activity className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900 font-mono">0.42 · 0.38 · 0.35</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>TASKS</span>
            <Cpu className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900 font-mono">142 (2 running)</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>MEMORY</span>
            <Activity className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900 font-mono">2.1 / 8.0 GB</div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>DISK (/)</span>
            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="mt-1.5 text-sm font-bold text-slate-900 font-mono">28.4 / 160 GB</div>
        </div>
      </div>

      <div
        className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xs overflow-hidden font-mono text-xs text-slate-200 flex flex-col"
        style={{ height: termHeight }}
      >
        <div className="bg-slate-900/90 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
            <span className="text-slate-400 text-[11px] ml-2 flex items-center gap-1.5">
              <TerminalIcon className="w-3.5 h-3.5" /> root@{hostname}: ~ (host shell)
            </span>
          </div>
          <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">SSH PTY: ssh://localhost:22</span>
        </div>
        <div className="flex-1 min-h-0 p-5 overflow-y-auto space-y-2">
          {history.map((item, idx) => (
            <div key={idx} className="leading-relaxed whitespace-pre-wrap">
              {item.type === 'input' ? (
                <div className="flex items-center gap-2 text-emerald-400">
                  <span className="text-blue-400">{hostname}:~#</span>
                  <span className="text-slate-100 font-bold">{item.text}</span>
                </div>
              ) : (
                <div className="text-slate-300 pl-2 border-l border-slate-800">{item.text}</div>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1 text-emerald-400">
            <span className="text-blue-400 font-semibold">{hostname}:~#</span>
            <input
              type="text"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run(input); }}
              placeholder="Try 'htop', 'df -h', 'docker ps', 'systemctl status nginx'"
              className="flex-1 bg-transparent border-none outline-hidden text-slate-100 font-mono text-xs placeholder:text-slate-600 focus:ring-0"
            />
          </div>
          <div ref={bottomRef} />
        </div>
        <div
          onMouseDown={onTermDragStart}
          title="Drag to resize"
          className="group flex items-center justify-center h-3 shrink-0 cursor-row-resize bg-slate-900 border-t border-slate-800"
        >
          <span className="w-10 h-1 rounded-full bg-slate-600 group-hover:bg-blue-400 transition-colors" />
        </div>
      </div>
    </div>
  );
};
