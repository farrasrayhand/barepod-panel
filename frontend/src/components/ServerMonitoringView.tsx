import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Cpu, 
  HardDrive, 
  Server, 
  RotateCw, 
  Search, 
  Play, 
  Square, 
  Terminal, 
  FileText, 
  ShieldCheck, 
  Wifi, 
  Clock, 
  Zap, 
  Sliders, 
  X, 
  Check, 
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Filter
} from 'lucide-react';

interface ProcessItem {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  rss: string;
  threads: number;
  status: 'R' | 'S';
  command: string;
  category: 'web' | 'database' | 'container' | 'system';
}

interface ServiceItem {
  unit: string;
  name: string;
  status: 'active' | 'inactive' | 'failed';
  subState: 'running' | 'dead';
  description: string;
  memory: string;
  uptime: string;
  category: 'web' | 'database' | 'system' | 'network' | 'container';
}

interface ServerMonitoringViewProps {
  onShowToast?: (title: string, message?: string, type?: 'success' | 'error' | 'info') => void;
  onOpenTerminal?: () => void;
}

export const ServerMonitoringView: React.FC<ServerMonitoringViewProps> = ({ 
  onShowToast,
  onOpenTerminal
}) => {
  const [activeTab, setActiveTab] = useState<'metrics' | 'processes' | 'services' | 'storage' | 'network'>('metrics');
  const [refreshInterval, setRefreshInterval] = useState<number>(3000);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);

  // Live Metrics State
  const [cpuUsage, setCpuUsage] = useState(14.2);
  const [cpuHistory, setCpuHistory] = useState<number[]>([12, 14, 18, 15, 13, 16, 22, 19, 14, 15, 17, 14]);
  const [perCore, setPerCore] = useState([16.4, 12.1, 18.0, 10.5]);
  const [ramUsed, setRamUsed] = useState(2.3);
  const [ramTotal] = useState(8.0);
  const [swapUsed, setSwapUsed] = useState(0.08);
  const [swapTotal] = useState(2.0);
  const [netRxMbps, setNetRxMbps] = useState(18.4);
  const [netTxMbps, setNetTxMbps] = useState(42.1);
  const [diskReadMb, setDiskReadMb] = useState(4.8);
  const [diskWriteMb, setDiskWriteMb] = useState(22.4);

  // Process Kill Confirmation State
  const [processToKill, setProcessToKill] = useState<ProcessItem | null>(null);
  const [processSearch, setProcessSearch] = useState('');
  const [processCategory, setProcessCategory] = useState<string>('all');

  // Service Log Drawer State
  const [activeServiceLogs, setActiveServiceLogs] = useState<ServiceItem | null>(null);

  // Top Processes List
  const [processes, setProcesses] = useState<ProcessItem[]>([
    { pid: 1042, user: 'root', cpu: 0.8, mem: 1.4, rss: '112 MB', threads: 4, status: 'S', command: '/usr/sbin/nginx -g daemon on;', category: 'web' },
    { pid: 1045, user: 'www-data', cpu: 1.2, mem: 0.9, rss: '72 MB', threads: 1, status: 'S', command: 'nginx: worker process', category: 'web' },
    { pid: 1420, user: 'root', cpu: 2.4, mem: 3.2, rss: '256 MB', threads: 14, status: 'S', command: '/usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock', category: 'container' },
    { pid: 1850, user: 'postgres', cpu: 1.5, mem: 2.1, rss: '168 MB', threads: 8, status: 'S', command: '/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main', category: 'database' },
    { pid: 1912, user: 'mysql', cpu: 1.9, mem: 3.8, rss: '304 MB', threads: 12, status: 'S', command: '/usr/sbin/mariadbd --basedir=/usr --datadir=/var/lib/mysql', category: 'database' },
    { pid: 2140, user: 'redis', cpu: 0.3, mem: 0.4, rss: '32 MB', threads: 4, status: 'S', command: '/usr/bin/redis-server 127.0.0.1:6379', category: 'database' },
    { pid: 2480, user: 'www-data', cpu: 3.1, mem: 1.8, rss: '144 MB', threads: 6, status: 'R', command: 'php-fpm: pool tenant_laravel (8.3)', category: 'web' },
    { pid: 2890, user: 'tenant1', cpu: 2.2, mem: 2.4, rss: '192 MB', threads: 10, status: 'R', command: 'node /home/tenant1/sites/node-api/dist/server.js', category: 'web' },
    { pid: 3120, user: 'root', cpu: 0.5, mem: 0.8, rss: '64 MB', threads: 5, status: 'S', command: '/usr/bin/cloudflared tunnel --no-autoupdate run', category: 'system' },
    { pid: 820, user: 'root', cpu: 0.1, mem: 0.3, rss: '24 MB', threads: 1, status: 'S', command: '/usr/sbin/cron -f', category: 'system' },
    { pid: 740, user: 'systemd', cpu: 0.2, mem: 0.5, rss: '40 MB', threads: 2, status: 'S', command: '/lib/systemd/systemd-journald', category: 'system' },
    { pid: 910, user: 'root', cpu: 0.1, mem: 0.2, rss: '18 MB', threads: 1, status: 'S', command: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', category: 'system' }
  ]);

  // System Services
  const [services, setServices] = useState<ServiceItem[]>([
    { unit: 'nginx.service', name: 'Nginx Web Proxy', status: 'active', subState: 'running', description: 'High Performance HTTP and Reverse Proxy Server', memory: '112 MB', uptime: '18 days', category: 'web' },
    { unit: 'docker.service', name: 'Docker Engine', status: 'active', subState: 'running', description: 'Docker Application Container Engine', memory: '256 MB', uptime: '18 days', category: 'container' },
    { unit: 'cloudflared.service', name: 'Cloudflare Tunnel', status: 'active', subState: 'running', description: 'Cloudflare Zero Trust Ingress Daemon', memory: '64 MB', uptime: '14 days', category: 'network' },
    { unit: 'postgresql@16-main.service', name: 'PostgreSQL 16', status: 'active', subState: 'running', description: 'PostgreSQL RDBMS Engine', memory: '168 MB', uptime: '18 days', category: 'database' },
    { unit: 'mariadb.service', name: 'MariaDB / MySQL', status: 'active', subState: 'running', description: 'MariaDB Community Database Server', memory: '304 MB', uptime: '18 days', category: 'database' },
    { unit: 'redis-server.service', name: 'Redis Cache', status: 'active', subState: 'running', description: 'Advanced key-value cache and store', memory: '32 MB', uptime: '18 days', category: 'database' },
    { unit: 'php8.3-fpm.service', name: 'PHP 8.3 FPM', status: 'active', subState: 'running', description: 'PHP FastCGI Process Manager', memory: '144 MB', uptime: '18 days', category: 'web' },
    { unit: 'ufw.service', name: 'UFW Firewall', status: 'active', subState: 'running', description: 'Uncomplicated Firewall Security Rules', memory: '8 MB', uptime: '18 days', category: 'system' },
    { unit: 'cron.service', name: 'Cron Daemon', status: 'active', subState: 'running', description: 'Regular Background Program Execution Scheduler', memory: '12 MB', uptime: '18 days', category: 'system' },
    { unit: 'ssh.service', name: 'OpenSSH Daemon', status: 'active', subState: 'running', description: 'OpenBSD Secure Shell Server', memory: '18 MB', uptime: '18 days', category: 'system' },
  ]);

  // Simulation tick for real-time telemetry
  useEffect(() => {
    if (!isAutoRefresh) return;
    const interval = setInterval(() => {
      // Small jitter for realistic CPU & RAM monitoring
      const cpuDelta = (Math.random() - 0.48) * 3;
      const nextCpu = Math.max(8.5, Math.min(65.0, Number((cpuUsage + cpuDelta).toFixed(1))));
      setCpuUsage(nextCpu);
      setCpuHistory(prev => [...prev.slice(1), nextCpu]);

      setPerCore([
        Math.max(5, Math.min(80, Number((perCore[0] + (Math.random() - 0.5) * 4).toFixed(1)))),
        Math.max(4, Math.min(75, Number((perCore[1] + (Math.random() - 0.5) * 4).toFixed(1)))),
        Math.max(6, Math.min(85, Number((perCore[2] + (Math.random() - 0.5) * 4).toFixed(1)))),
        Math.max(3, Math.min(70, Number((perCore[3] + (Math.random() - 0.5) * 4).toFixed(1)))),
      ]);

      const ramDelta = (Math.random() - 0.5) * 0.08;
      setRamUsed(Math.max(2.1, Math.min(3.8, Number((ramUsed + ramDelta).toFixed(2)))));

      setNetRxMbps(Math.max(8, Number((netRxMbps + (Math.random() - 0.5) * 5).toFixed(1))));
      setNetTxMbps(Math.max(20, Number((netTxMbps + (Math.random() - 0.5) * 8).toFixed(1))));

      setDiskReadMb(Math.max(1.2, Number((diskReadMb + (Math.random() - 0.5) * 2).toFixed(1))));
      setDiskWriteMb(Math.max(8.0, Number((diskWriteMb + (Math.random() - 0.5) * 6).toFixed(1))));
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [cpuUsage, ramUsed, perCore, netRxMbps, netTxMbps, diskReadMb, diskWriteMb, isAutoRefresh, refreshInterval]);

  const handleKillProcess = (pid: number, signal: 'SIGTERM' | 'SIGKILL') => {
    setProcesses(processes.filter(p => p.pid !== pid));
    setProcessToKill(null);
    onShowToast?.(
      'Process Terminated',
      `Sent ${signal} to PID ${pid}. Process removed from active queue.`,
      'info'
    );
  };

  const handleRestartService = (unit: string) => {
    onShowToast?.('Service Restarting', `Issued systemctl restart ${unit}`, 'info');
    setServices(services.map(s => {
      if (s.unit === unit) {
        return { ...s, uptime: '1 second ago' };
      }
      return s;
    }));
  };

  const handleToggleService = (unit: string) => {
    setServices(services.map(s => {
      if (s.unit === unit) {
        const nextStatus = s.status === 'active' ? 'inactive' : 'active';
        const nextSub = nextStatus === 'active' ? 'running' : 'dead';
        onShowToast?.(
          nextStatus === 'active' ? 'Service Started' : 'Service Stopped',
          `Issued systemctl ${nextStatus === 'active' ? 'start' : 'stop'} ${unit}`,
          nextStatus === 'active' ? 'success' : 'info'
        );
        return { ...s, status: nextStatus, subState: nextSub };
      }
      return s;
    }));
  };

  // Filter processes
  const filteredProcesses = processes.filter(p => {
    const matchSearch = p.command.toLowerCase().includes(processSearch.toLowerCase()) || 
      p.user.toLowerCase().includes(processSearch.toLowerCase()) || 
      String(p.pid).includes(processSearch);
    const matchCategory = processCategory === 'all' || p.category === processCategory;
    return matchSearch && matchCategory;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      
      {/* Header & Server Hardware Specs Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Real-Time Server Monitoring</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Bare Metal Telemetry
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-2">
            <span>Hostname: <strong className="text-slate-700 font-mono">vps-barepod-edge-01</strong></span>
            <span>•</span>
            <span>OS: <strong className="text-slate-700">Debian 12 Bookworm (x86_64)</strong></span>
            <span>•</span>
            <span>Kernel: <strong className="text-slate-700 font-mono">Linux 6.1.0-21-amd64</strong></span>
            <span>•</span>
            <span>Uptime: <strong className="text-slate-700">18 days, 4h 12m</strong></span>
          </p>
        </div>

        {/* Controls: Refresh selector & Open Terminal */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600 shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-transparent font-medium focus:outline-hidden cursor-pointer"
            >
              <option value={1000}>Interval: 1s</option>
              <option value={3000}>Interval: 3s</option>
              <option value={5000}>Interval: 5s</option>
            </select>
            <button
              onClick={() => setIsAutoRefresh(!isAutoRefresh)}
              className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                isAutoRefresh ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {isAutoRefresh ? 'Live' : 'Paused'}
            </button>
          </div>

          <button
            onClick={onOpenTerminal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>htop / bash CLI</span>
          </button>
        </div>
      </div>

      {/* Primary Telemetry Cards (CPU, RAM, Disk I/O, Network) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: CPU Usage */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-500 flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-blue-600" /> CPU LOAD
            </span>
            <span className="font-mono text-slate-600">4 vCPUs</span>
          </div>
          
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900">{cpuUsage}%</span>
            <span className="text-xs text-slate-400 font-mono">Load: 0.34, 0.48, 0.52</span>
          </div>

          {/* Sparkline Visual Graph */}
          <div className="h-8 flex items-end gap-1 pt-1">
            {cpuHistory.map((val, idx) => (
              <div 
                key={idx}
                className="flex-1 bg-blue-500/80 hover:bg-blue-600 rounded-xs transition-all duration-300"
                style={{ height: `${Math.max(15, (val / 100) * 100)}%` }}
                title={`${val}%`}
              />
            ))}
          </div>

          {/* Per-core small bars */}
          <div className="pt-2 border-t border-slate-100 grid grid-cols-4 gap-1.5 text-[9px] text-slate-400 font-mono text-center">
            {perCore.map((c, i) => (
              <div key={i} className="bg-slate-50 p-1 rounded">
                <span>c{i}</span>
                <div className="font-bold text-slate-700">{c}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Card 2: Memory (RAM & Swap) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-500 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-600" /> RAM / MEMORY
            </span>
            <span className="font-mono text-slate-600">DDR4 ECC</span>
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900">{ramUsed} <span className="text-sm font-semibold text-slate-400">/ {ramTotal} GB</span></span>
            <span className="text-xs font-bold text-emerald-600">
              {((ramUsed / ramTotal) * 100).toFixed(0)}% Used
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden flex">
            <div className="bg-emerald-500 h-2" style={{ width: `${(ramUsed / ramTotal) * 100}%` }} />
            <div className="bg-amber-400 h-2" style={{ width: '38%' }} title="Buffers / Cached: 3.1 GB" />
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span>Cache: <strong className="text-slate-700">3.1 GB</strong></span>
            <span>Free: <strong className="text-slate-700 font-mono">{(ramTotal - ramUsed - 3.1).toFixed(1)} GB</strong></span>
            <span>Swap: <strong className="text-slate-700 font-mono">{(swapUsed * 1024).toFixed(0)} MB</strong></span>
          </div>
        </div>

        {/* Card 3: Storage & NVMe I/O */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-500 flex items-center gap-1.5">
              <HardDrive className="w-4 h-4 text-purple-600" /> NVME DISK I/O
            </span>
            <span className="font-mono text-slate-600">PCIe 4.0</span>
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900">28.4 <span className="text-sm font-semibold text-slate-400">/ 160 GB</span></span>
            <span className="text-xs font-bold text-purple-600">18% Space</span>
          </div>

          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div className="bg-purple-600 h-2 rounded-full" style={{ width: '18%' }} />
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-0.5"><ArrowDown className="w-3 h-3 text-emerald-500" /> Read: <strong className="text-slate-700">{diskReadMb} MB/s</strong></span>
            <span className="flex items-center gap-0.5"><ArrowUp className="w-3 h-3 text-blue-500" /> Write: <strong className="text-slate-700">{diskWriteMb} MB/s</strong></span>
          </div>
        </div>

        {/* Card 4: Network Bandwidth */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold text-slate-500 flex items-center gap-1.5">
              <Wifi className="w-4 h-4 text-cyan-600" /> NETWORK TRAFFIC
            </span>
            <span className="font-mono text-slate-600">eth0 • 1 Gbps</span>
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-slate-900">{(netRxMbps + netTxMbps).toFixed(1)} <span className="text-sm font-semibold text-slate-400">Mbps</span></span>
            <span className="text-xs font-bold text-emerald-600">Full Duplex</span>
          </div>

          {/* Rx / Tx representation */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><ArrowDown className="w-3 h-3 text-emerald-500" /> Inbound</span>
              <strong className="text-xs font-mono text-slate-800">{netRxMbps} M</strong>
            </div>
            <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><ArrowUp className="w-3 h-3 text-blue-500" /> Outbound</span>
              <strong className="text-xs font-mono text-slate-800">{netTxMbps} M</strong>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
            <span>Total In: 142.5 GB</span>
            <span>Total Out: 380.2 GB</span>
          </div>
        </div>

      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 rounded-t-xl overflow-x-auto text-xs font-semibold">
        <button
          onClick={() => setActiveTab('metrics')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'metrics'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span>Hardware & Performance</span>
        </button>

        <button
          onClick={() => setActiveTab('processes')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'processes'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>Top Processes (htop GUI)</span>
          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
            {processes.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('services')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'services'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>System Services (systemd)</span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
            {services.filter(s => s.status === 'active').length} Active
          </span>
        </button>

        <button
          onClick={() => setActiveTab('storage')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'storage'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          <span>Filesystem & Partitions</span>
        </button>

        <button
          onClick={() => setActiveTab('network')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'network'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Wifi className="w-4 h-4" />
          <span>Ports & Sockets (netstat)</span>
        </button>
      </div>

      {/* TAB CONTENT */}
      <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs">
        
        {/* TAB 1: HARDWARE & PERFORMANCE */}
        {activeTab === 'metrics' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* CPU Breakdown Box */}
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-blue-600" />
                    Processor Telemetry
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">AMD EPYC 7763 @ 2.45GHz</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Core 0</span>
                      <span className="font-mono font-bold text-slate-800">{perCore[0]}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${perCore[0]}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Core 1</span>
                      <span className="font-mono font-bold text-slate-800">{perCore[1]}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${perCore[1]}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Core 2</span>
                      <span className="font-mono font-bold text-slate-800">{perCore[2]}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${perCore[2]}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600">Core 3</span>
                      <span className="font-mono font-bold text-slate-800">{perCore[3]}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-blue-600 h-1.5 rounded-full" style={{ width: `${perCore[3]}%` }} />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200 grid grid-cols-3 gap-2 text-[11px] text-slate-500 text-center font-mono">
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400 text-[10px]">USER SPACE</span>
                    <strong className="text-slate-800">8.2%</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400 text-[10px]">KERNEL / SYS</span>
                    <strong className="text-slate-800">4.1%</strong>
                  </div>
                  <div className="bg-white p-2 rounded border border-slate-200">
                    <span className="block text-slate-400 text-[10px]">I/O WAIT</span>
                    <strong className="text-slate-800">1.9%</strong>
                  </div>
                </div>
              </div>

              {/* Memory & Swap Box */}
              <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-600" />
                    RAM & Virtual Memory Pool
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">Total Physical: 8192 MB</span>
                </div>

                <div className="space-y-3 text-xs">
                  <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-600 font-medium">Active Applications Memory</span>
                      <span className="font-mono font-bold text-slate-900">{ramUsed} GB ({((ramUsed / ramTotal) * 100).toFixed(0)}%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-emerald-500 h-1.5" style={{ width: `${(ramUsed / ramTotal) * 100}%` }} />
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-600 font-medium">Page Cache & Buffers</span>
                      <span className="font-mono font-bold text-slate-900">3.1 GB (38%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-amber-400 h-1.5" style={{ width: '38%' }} />
                    </div>
                  </div>

                  <div className="bg-white p-3 rounded-lg border border-slate-200 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-slate-600 font-medium">Linux Swap Space</span>
                      <span className="font-mono font-bold text-slate-900">84 MB / 2048 MB (4%)</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-purple-500 h-1.5" style={{ width: '4%' }} />
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 text-center">
                  Swappiness: <strong className="text-slate-600 font-mono">vm.swappiness=10</strong> • ZRAM compression active
                </div>
              </div>

            </div>
          </div>
        )}

        {/* TAB 2: TOP PROCESSES (HTOP GUI) */}
        {activeTab === 'processes' && (
          <div className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by PID, command, or user..."
                    value={processSearch}
                    onChange={(e) => setProcessSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-hidden focus:border-blue-500 w-64"
                  />
                </div>

                <div className="flex items-center gap-1">
                  {(['all', 'web', 'database', 'container', 'system'] as const).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setProcessCategory(cat)}
                      className={`px-2.5 py-1 text-xs rounded-lg font-medium capitalize transition-colors ${
                        processCategory === cat
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="text-xs text-slate-400 font-mono">
                Showing {filteredProcesses.length} active processes
              </div>
            </div>

            {/* Processes Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">PID</th>
                    <th className="py-2.5 px-3">USER</th>
                    <th className="py-2.5 px-3">CPU %</th>
                    <th className="py-2.5 px-3">MEM %</th>
                    <th className="py-2.5 px-3">RES MEM</th>
                    <th className="py-2.5 px-3">THREADS</th>
                    <th className="py-2.5 px-3">STAT</th>
                    <th className="py-2.5 px-4">COMMAND</th>
                    <th className="py-2.5 px-3 text-right">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredProcesses.map((proc) => (
                    <tr key={proc.pid} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 font-bold text-slate-800">{proc.pid}</td>
                      <td className="py-2.5 px-3 text-slate-600">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                          proc.user === 'root' ? 'bg-rose-50 text-rose-700 font-bold' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {proc.user}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-blue-600">{proc.cpu.toFixed(1)}%</td>
                      <td className="py-2.5 px-3 text-slate-700">{proc.mem.toFixed(1)}%</td>
                      <td className="py-2.5 px-3 text-slate-500">{proc.rss}</td>
                      <td className="py-2.5 px-3 text-slate-400">{proc.threads}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1 py-0.2 rounded text-[10px] font-bold ${
                          proc.status === 'R' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {proc.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 font-sans text-xs text-slate-800 max-w-md truncate" title={proc.command}>
                        {proc.command}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => setProcessToKill(proc)}
                          className="px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50 rounded border border-rose-200 transition-colors cursor-pointer"
                        >
                          Kill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: SYSTEM SERVICES (SYSTEMD) */}
        {activeTab === 'services' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Systemd Service Units</h3>
                <p className="text-xs text-slate-500">Kendalikan daemon inti server, reverse proxy, runtime, dan database.</p>
              </div>
              <button
                onClick={() => onShowToast?.('Daemon Reloaded', 'systemctl daemon-reload executed.', 'info')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>daemon-reload</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {services.map((svc) => {
                const isActive = svc.status === 'active';
                return (
                  <div key={svc.unit} className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between space-y-3">
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-bold text-xs text-slate-900">{svc.name}</h4>
                          <span className="text-[10px] text-slate-400 font-mono block mt-0.5">{svc.unit}</span>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isActive 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {svc.status.toUpperCase()} ({svc.subState})
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        {svc.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <div className="text-[11px] text-slate-400 font-mono">
                        Mem: <strong className="text-slate-700">{svc.memory}</strong> • Up: {svc.uptime}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setActiveServiceLogs(svc)}
                          className="px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
                          title="View journalctl logs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRestartService(svc.unit)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded border border-slate-200"
                        >
                          Restart
                        </button>
                        <button
                          onClick={() => handleToggleService(svc.unit)}
                          className={`px-2.5 py-1 text-xs font-bold rounded ${
                            isActive 
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200' 
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                        >
                          {isActive ? 'Stop' : 'Start'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 4: FILESYSTEM & PARTITIONS */}
        {activeTab === 'storage' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Mounted Filesystems & Disk Partitions</h3>
            
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">MOUNT POINT</th>
                    <th className="py-2.5 px-3">FILESYSTEM</th>
                    <th className="py-2.5 px-3">TYPE</th>
                    <th className="py-2.5 px-3">SIZE</th>
                    <th className="py-2.5 px-3">USED</th>
                    <th className="py-2.5 px-3">AVAIL</th>
                    <th className="py-2.5 px-3">USAGE</th>
                    <th className="py-2.5 px-3">INODES</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  <tr>
                    <td className="py-3 px-3 font-bold text-slate-900">/ (Root)</td>
                    <td className="py-3 px-3 text-slate-500">/dev/nvme0n1p2</td>
                    <td className="py-3 px-3 text-slate-700">ext4</td>
                    <td className="py-3 px-3 text-slate-700">160 GB</td>
                    <td className="py-3 px-3 text-purple-600 font-bold">28.4 GB</td>
                    <td className="py-3 px-3 text-emerald-600 font-bold">131.6 GB</td>
                    <td className="py-3 px-3">
                      <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-purple-600 h-1.5" style={{ width: '18%' }} />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-500">420K / 10.2M (4%)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-slate-900">/boot/efi</td>
                    <td className="py-3 px-3 text-slate-500">/dev/nvme0n1p1</td>
                    <td className="py-3 px-3 text-slate-700">vfat</td>
                    <td className="py-3 px-3 text-slate-700">512 MB</td>
                    <td className="py-3 px-3 text-slate-700">12 MB</td>
                    <td className="py-3 px-3 text-slate-700">500 MB</td>
                    <td className="py-3 px-3">
                      <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-blue-600 h-1.5" style={{ width: '2%' }} />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-500">18 / 64K (&lt;1%)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-slate-900">/var/lib/docker</td>
                    <td className="py-3 px-3 text-slate-500">overlay2</td>
                    <td className="py-3 px-3 text-slate-700">overlay</td>
                    <td className="py-3 px-3 text-slate-700">160 GB</td>
                    <td className="py-3 px-3 text-slate-700">14.2 GB</td>
                    <td className="py-3 px-3 text-slate-700">131.6 GB</td>
                    <td className="py-3 px-3">
                      <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-purple-600 h-1.5" style={{ width: '9%' }} />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-500">110K / 10.2M (1%)</td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 font-bold text-slate-900">/home (Tenants)</td>
                    <td className="py-3 px-3 text-slate-500">/dev/nvme0n1p2</td>
                    <td className="py-3 px-3 text-slate-700">ext4 (quota)</td>
                    <td className="py-3 px-3 text-slate-700">160 GB</td>
                    <td className="py-3 px-3 text-slate-700">6.8 GB</td>
                    <td className="py-3 px-3 text-slate-700">131.6 GB</td>
                    <td className="py-3 px-3">
                      <div className="w-24 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-emerald-500 h-1.5" style={{ width: '4%' }} />
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-500">85K / 10.2M (&lt;1%)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: PORTS & SOCKETS (NETSTAT) */}
        {activeTab === 'network' && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Open TCP/UDP Sockets & Listening Ports</h3>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">PROTO</th>
                    <th className="py-2.5 px-3">PORT</th>
                    <th className="py-2.5 px-3">BIND ADDRESS</th>
                    <th className="py-2.5 px-3">PROCESS / SERVICE</th>
                    <th className="py-2.5 px-3">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">80</td>
                    <td className="py-2.5 px-3 text-slate-600">0.0.0.0:80</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">nginx (HTTP)</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">443</td>
                    <td className="py-2.5 px-3 text-slate-600">0.0.0.0:443</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">nginx (HTTPS SSL)</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">5432</td>
                    <td className="py-2.5 px-3 text-slate-600">127.0.0.1:5432</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">postgres</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN (Local only)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">3306</td>
                    <td className="py-2.5 px-3 text-slate-600">127.0.0.1:3306</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">mariadbd (MySQL)</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN (Local only)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">6379</td>
                    <td className="py-2.5 px-3 text-slate-600">127.0.0.1:6379</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">redis-server</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN (Local only)</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-blue-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">22</td>
                    <td className="py-2.5 px-3 text-slate-600">0.0.0.0:22</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">sshd (OpenSSH)</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 font-bold text-purple-600">tcp</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">8443</td>
                    <td className="py-2.5 px-3 text-slate-600">127.0.0.1:8443</td>
                    <td className="py-2.5 px-3 text-slate-800 font-sans font-semibold">barepod-panel daemon</td>
                    <td className="py-2.5 px-3 text-emerald-600 font-bold">LISTEN (Proxy protected)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* KILL PROCESS CONFIRMATION MODAL */}
      {processToKill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900">Terminate Process</h3>
                <span className="text-xs text-slate-500 font-mono">PID: {processToKill.pid}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Anda akan menghentikan proses <strong>{processToKill.command}</strong> (User: <code>{processToKill.user}</code>).
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setProcessToKill(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Batal
              </button>
              <button
                onClick={() => handleKillProcess(processToKill.pid, 'SIGTERM')}
                className="px-3.5 py-2 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg"
              >
                SIGTERM (Graceful)
              </button>
              <button
                onClick={() => handleKillProcess(processToKill.pid, 'SIGKILL')}
                className="px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm shadow-rose-500/25"
              >
                SIGKILL -9 (Force)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SERVICE JOURNALCTL LOGS MODAL */}
      {activeServiceLogs && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-slate-950 rounded-2xl border border-slate-800 shadow-2xl max-w-2xl w-full p-6 space-y-4 text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <FileText className="w-4 h-4 text-emerald-400" />
                <h3 className="font-mono text-xs font-bold text-white">
                  journalctl -u {activeServiceLogs.unit} -n 30 --no-pager
                </h3>
              </div>
              <button
                onClick={() => setActiveServiceLogs(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="font-mono text-[11px] max-h-72 overflow-y-auto space-y-1 text-slate-300">
              <p className="text-slate-500">-- Logs begin at Wed 2026-09-22 08:00:00 UTC, end at Sat 2026-10-10 19:05:00 UTC. --</p>
              <p className="text-emerald-400">[systemd] Started {activeServiceLogs.name} ({activeServiceLogs.description}).</p>
              <p>[daemon] Successfully initialized memory manager and process workers.</p>
              <p>[info] Ready for incoming connections on socket.</p>
              <p>[info] Healthcheck probe status: healthy (PID {services.find(s => s.unit === activeServiceLogs.unit)?.memory})</p>
              <p className="text-blue-400">[worker] Handled 18,420 requests with zero dropped frames.</p>
              <p className="text-slate-400">[metrics] CPU usage 0.8%, RSS memory {activeServiceLogs.memory}</p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                onClick={() => setActiveServiceLogs(null)}
                className="px-4 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white rounded-lg"
              >
                Tutup Log
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
