import React, { useState, useEffect, useMemo } from 'react';
import { useSubRoute } from '../hooks/useSubRoute';
import { MetricHistoryChart } from './MetricHistoryChart';
import { HostConsole } from './HostConsole';
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
  Filter,
  Thermometer,
  Disc,
  Radio,
  CheckCircle2,
  ArrowDownRight,
  ArrowUpRight,
  Globe,
  Gauge,
  CircleDot
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
  isAdmin?: boolean;
}

export const ServerMonitoringView: React.FC<ServerMonitoringViewProps> = ({ 
  onShowToast,
  onOpenTerminal,
  isAdmin = false,
}) => {
  const [activeTab, setActiveTab] = useSubRoute<'metrics' | 'processes' | 'services' | 'storage' | 'network' | 'console'>('metrics');
  const [refreshInterval, setRefreshInterval] = useState<number>(3000);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);

  // Host console (root shell) is admin-only; bounce others back to metrics
  useEffect(() => {
    if (!isAdmin && activeTab === 'console') setActiveTab('metrics');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, activeTab]);

  // Switching tabs replaces the content below the tab bar, so start at the top
  // of the page: otherwise the old scroll position is kept and the new tab
  // looks like it opened in the middle (and the browser clamps the scroll,
  // which reads as a slide).
  useEffect(() => {
    document.querySelector('[data-scroll-root]')?.scrollTo({ top: 0 });
  }, [activeTab]);

  // Live Metrics State
  const [cpuUsage, setCpuUsage] = useState(14.2);
  const [cpuHistory, setCpuHistory] = useState<number[]>([12, 14, 18, 15, 13, 16, 22, 19, 14, 15, 17, 14]);
  const [perCore, setPerCore] = useState([16.4, 12.1, 18.0, 10.5]);

  // Host telemetry time range + synthetic history series
  const [hostRange, setHostRange] = useState<'live' | '1h' | '24h' | '7d' | '30d' | '90d'>('24h');

  const hostRangeLabel = (r: string) =>
    r === 'live' ? 'Live (5 min)' : r === '1h' ? '1 Hour' : r === '24h' ? '24 Hours' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days';

  const hostRangeTicks = (r: string): string[] =>
    r === 'live' ? ['-5m', '-2.5m', 'now']
      : r === '1h' ? ['-60m', '-30m', 'now']
        : r === '24h' ? ['-24h', '-12h', 'now']
          : r === '7d' ? ['-7d', '-3.5d', 'now']
            : r === '30d' ? ['-30d', '-15d', 'now']
              : ['-90d', '-45d', 'now'];

  const history = useMemo(() => {
    const points = hostRange === 'live' ? 24 : hostRange === '1h' ? 30 : hostRange === '24h' ? 48 : hostRange === '7d' ? 56 : 60;
    const gen = (base: number, amp: number) =>
      Array.from({ length: points }, (_, i) => {
        const wave = Math.sin((i / points) * Math.PI * 6) * amp;
        const drift = Math.sin((i / points) * Math.PI * 2) * amp * 0.4;
        const noise = (Math.random() - 0.5) * amp * 0.5;
        return Math.max(0.1, Number((base + wave + drift + noise).toFixed(2)));
      });

    // Real timestamps for the window, so hovering can show when a point happened.
    const spanMs =
      hostRange === 'live' ? 5 * 60_000
        : hostRange === '1h' ? 60 * 60_000
          : hostRange === '24h' ? 24 * 60 * 60_000
            : hostRange === '7d' ? 7 * 24 * 60 * 60_000
              : hostRange === '30d' ? 30 * 24 * 60 * 60_000
                : 90 * 24 * 60 * 60_000;
    const now = Date.now();
    const stamps = Array.from({ length: points }, (_, i) =>
      new Date(now - spanMs + (spanMs * i) / Math.max(1, points - 1)).toISOString(),
    );

    return { cpu: gen(12, 8), mem: gen(26, 5), net: gen(18, 12), disk: gen(6, 4), stamps };
  }, [hostRange]);
  const [ramUsed, setRamUsed] = useState(2.3);
  const [ramTotal] = useState(8.0);
  const [swapUsed, setSwapUsed] = useState(0.08);
  const [swapTotal] = useState(2.0);
  const [netRxMbps, setNetRxMbps] = useState(18.4);
  const [netTxMbps, setNetTxMbps] = useState(42.1);
  const [netRxHistory, setNetRxHistory] = useState<number[]>([14.2, 16.5, 15.0, 18.4, 21.2, 17.8, 19.4, 18.4]);
  const [netTxHistory, setNetTxHistory] = useState<number[]>([36.1, 38.4, 40.2, 42.1, 46.5, 39.8, 41.2, 42.1]);
  const [diskReadMb, setDiskReadMb] = useState(4.8);
  const [diskWriteMb, setDiskWriteMb] = useState(22.4);

  // S.M.A.R.T. Disk Health State
  const [selectedDriveIdx, setSelectedDriveIdx] = useState(0);
  const [isTestingSmart, setIsTestingSmart] = useState(false);
  const [smartTestProgress, setSmartTestProgress] = useState(0);
  const [smartTestResult, setSmartTestResult] = useState<string | null>(null);

  // Network Diagnostic & Filter State
  const [selectedNetIface, setSelectedNetIface] = useState<string>('all');
  const [isPingingNet, setIsPingingNet] = useState(false);
  const [pingLatencyResults, setPingLatencyResults] = useState<{ cloudflare: string; google: string; gateway: string } | null>(null);

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

      const nextRx = Math.max(8, Number((netRxMbps + (Math.random() - 0.5) * 5).toFixed(1)));
      const nextTx = Math.max(20, Number((netTxMbps + (Math.random() - 0.5) * 8).toFixed(1)));
      setNetRxMbps(nextRx);
      setNetTxMbps(nextTx);
      setNetRxHistory(prev => [...prev.slice(1), nextRx]);
      setNetTxHistory(prev => [...prev.slice(1), nextTx]);

      setDiskReadMb(Math.max(1.2, Number((diskReadMb + (Math.random() - 0.5) * 2).toFixed(1))));
      setDiskWriteMb(Math.max(8.0, Number((diskWriteMb + (Math.random() - 0.5) * 6).toFixed(1))));
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [cpuUsage, ramUsed, perCore, netRxMbps, netTxMbps, diskReadMb, diskWriteMb, isAutoRefresh, refreshInterval]);

  const handleRunSmartSelfTest = () => {
    setIsTestingSmart(true);
    setSmartTestProgress(15);
    setSmartTestResult(null);
    onShowToast?.('S.M.A.R.T. Self-Test Started', 'Running smartctl -t short on the physical drive...', 'info');

    let currentProg = 15;
    const interval = setInterval(() => {
      currentProg += 25;
      if (currentProg >= 100) {
        clearInterval(interval);
        setSmartTestProgress(100);
        setIsTestingSmart(false);
        setSmartTestResult('S.M.A.R.T. Self-Test Completed: 0 read/write errors found. Overall health assessment: PASSED.');
        onShowToast?.('S.M.A.R.T. Test Complete', 'Physical drive is healthy (status PASSED).', 'success');
      } else {
        setSmartTestProgress(currentProg);
      }
    }, 450);
  };

  const handlePingProbe = () => {
    setIsPingingNet(true);
    setTimeout(() => {
      setIsPingingNet(false);
      setPingLatencyResults({
        cloudflare: `${(Math.random() * 0.4 + 0.7).toFixed(1)} ms`,
        google: `${(Math.random() * 0.5 + 1.2).toFixed(1)} ms`,
        gateway: `${(Math.random() * 0.2 + 0.2).toFixed(1)} ms`,
      });
      onShowToast?.('Network Latency Probed', 'ICMP round-trip latency probed successfully.', 'success');
    }, 600);
  };

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

          {isAdmin && (
            <button
              onClick={() => setActiveTab('console')}
              title="Host root shell — admin only"
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Terminal</span>
              <span className="text-[9px] bg-rose-500/25 text-rose-200 px-1 rounded font-bold">root</span>
            </button>
          )}
        </div>
      </div>

      {/* Telemetry Filter & Server Retention Policy Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            <span>Host Time Range:</span>
          </span>
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 text-xs">
            {(['live', '1h', '24h', '7d', '30d', '90d'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setHostRange(r);
                  onShowToast?.('Server Time Filter', `Showing host telemetry aggregation: ${hostRangeLabel(r)}.`, 'info');
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                  r === hostRange
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r === 'live' ? '5m Live' : r === '1h' ? '1 Hour' : r === '24h' ? '24 Hours' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">
            Server Metrics Retention:
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 flex items-center gap-1" title="Global server metrics retention can be configured up to 365 days in Panel Settings.">
            <Server className="w-3.5 h-3.5 text-blue-600" />
            <span>90 Days (Set in Panel Settings)</span>
          </span>
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

        {isAdmin && (
          <button
            onClick={() => setActiveTab('console')}
            className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
              activeTab === 'console'
                ? 'border-slate-900 text-slate-900 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Terminal</span>
            <span className="text-[9px] bg-rose-100 text-rose-700 px-1 rounded font-bold">root</span>
          </button>
        )}

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
          <Disc className="w-4 h-4" />
          <span>Storage & S.M.A.R.T. Health</span>
          <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold text-[10px]">
            NVMe 39°C
          </span>
        </button>

        <button
          onClick={() => setActiveTab('network')}
          className={`py-3 px-4 border-b-2 flex items-center gap-2 transition-all whitespace-nowrap ${
            activeTab === 'network'
              ? 'border-blue-600 text-blue-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Radio className="w-4 h-4" />
          <span>Network Interfaces & Traffic</span>
          <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 font-bold text-[10px]">
            {netTxMbps.toFixed(1)} Mbps
          </span>
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

              {/* Historical Trends — spans the full width, charts side by side on wide screens */}
              <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Historical Trends</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Aggregated host metrics over the selected time range.</p>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 rounded-lg">
                    {hostRangeLabel(hostRange)}
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <MetricHistoryChart title="CPU Usage" unit="%" data={history.cpu} timestamps={history.stamps} color="#2563eb" height={220} ticks={hostRangeTicks(hostRange)} />
                  <MetricHistoryChart title="Memory Usage" unit="%" data={history.mem} timestamps={history.stamps} color="#10b981" height={220} ticks={hostRangeTicks(hostRange)} />
                  <MetricHistoryChart title="Network I/O" unit=" Mbps" data={history.net} timestamps={history.stamps} color="#0ea5e9" height={220} ticks={hostRangeTicks(hostRange)} />
                  <MetricHistoryChart title="Disk I/O" unit=" MB/s" data={history.disk} timestamps={history.stamps} color="#a855f7" height={220} ticks={hostRangeTicks(hostRange)} />
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
                <p className="text-xs text-slate-500">Control core server daemons, reverse proxies, runtimes, and databases.</p>
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

        {/* TAB 4: S.M.A.R.T. DISK HEALTH & PARTITIONS */}
        {activeTab === 'storage' && (
          <div className="space-y-6">
            {/* Drive Selection Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-bold text-slate-900">Physical Storage Device:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setSelectedDriveIdx(0)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                      selectedDriveIdx === 0
                        ? 'bg-purple-600 text-white shadow-2xs font-bold'
                        : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    /dev/nvme0n1 (Samsung PM9A1 1TB)
                  </button>
                  <button
                    onClick={() => setSelectedDriveIdx(1)}
                    className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
                      selectedDriveIdx === 1
                        ? 'bg-purple-600 text-white shadow-2xs font-bold'
                        : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
                    }`}
                  >
                    /dev/sda (Crucial MX500 500GB)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunSmartSelfTest}
                  disabled={isTestingSmart}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold bg-white hover:bg-purple-50 text-purple-700 rounded-lg border border-purple-200 shadow-2xs transition-colors disabled:opacity-50"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isTestingSmart ? 'animate-spin text-purple-600' : ''}`} />
                  <span>{isTestingSmart ? `Testing (${smartTestProgress}%)...` : 'Run S.M.A.R.T. Self-Test'}</span>
                </button>
              </div>
            </div>

            {/* S.M.A.R.T. Self-Test Progress & Result Notice */}
            {isTestingSmart && (
              <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 animate-in fade-in duration-200 space-y-2">
                <div className="flex items-center justify-between text-xs text-purple-900">
                  <span className="font-semibold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-purple-600 animate-pulse" />
                    Executing short offline self-test on {selectedDriveIdx === 0 ? '/dev/nvme0n1' : '/dev/sda'}...
                  </span>
                  <span className="font-mono font-bold">{smartTestProgress}%</span>
                </div>
                <div className="w-full bg-purple-200 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${smartTestProgress}%` }}
                  />
                </div>
              </div>
            )}

            {smartTestResult && (
              <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center justify-between animate-in fade-in">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span><strong>smartctl diagnostic pass:</strong> {smartTestResult}</span>
                </div>
                <button 
                  onClick={() => setSmartTestResult(null)}
                  className="text-emerald-700 hover:text-emerald-900 font-bold p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* S.M.A.R.T. Telemetry Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Health Status</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-xl font-bold text-emerald-600 flex items-center gap-1.5">
                  <span>PASSED</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {selectedDriveIdx === 0 ? 'NVMe Life Remaining: 99%' : 'SATA Life Remaining: 98%'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Drive Temperature</span>
                  <Thermometer className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {selectedDriveIdx === 0 ? '39°C' : '33°C'}
                </div>
                <p className="text-[11px] text-emerald-600 font-medium">
                  Optimal (Throttling @ 70°C)
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Total Written (TBW)</span>
                  <ArrowUpRight className="w-4 h-4 text-purple-500" />
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {selectedDriveIdx === 0 ? '24.8 TB' : '11.4 TB'}
                </div>
                <p className="text-[11px] text-slate-500">
                  Read: {selectedDriveIdx === 0 ? '51.2 TB' : '18.7 TB'}
                </p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Power-On Time</span>
                  <Clock className="w-4 h-4 text-amber-500" />
                </div>
                <div className="text-xl font-bold text-slate-900">
                  {selectedDriveIdx === 0 ? '6,420 hrs' : '12,850 hrs'}
                </div>
                <p className="text-[11px] text-slate-500">
                  Cycles: {selectedDriveIdx === 0 ? '94' : '142'} • Unsafe: {selectedDriveIdx === 0 ? '3' : '2'}
                </p>
              </div>
            </div>

            {/* S.M.A.R.T. Raw Attributes & NVMe Telemetry Table */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
              <div className="p-3 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">
                    S.M.A.R.T. Hardware Health Attributes ({selectedDriveIdx === 0 ? 'NVMe 1.4 Smart Log' : 'ATA / SMART Attributes'})
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Controller: {selectedDriveIdx === 0 ? 'Samsung Electronics PM9A1 (PCIe Gen4 x4)' : 'Crucial MX500 3D NAND (SATA 6Gb/s)'}
                  </p>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  Firmware: <strong>{selectedDriveIdx === 0 ? 'GXA7301Q' : 'M3CR043'}</strong>
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">ID / FIELD</th>
                      <th className="py-2.5 px-3">ATTRIBUTE DESCRIPTION</th>
                      <th className="py-2.5 px-3">CURRENT VALUE</th>
                      <th className="py-2.5 px-3">THRESHOLD</th>
                      <th className="py-2.5 px-3">RAW VALUE</th>
                      <th className="py-2.5 px-3 text-right">STATUS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedDriveIdx === 0 ? (
                      <>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x00</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Critical Warning</td>
                          <td className="py-2.5 px-3 text-slate-900">0</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">0x00 (Normal)</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x01</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Composite Temperature</td>
                          <td className="py-2.5 px-3 text-slate-900">312 Kelvin</td>
                          <td className="py-2.5 px-3 text-slate-400">353 Kelvin</td>
                          <td className="py-2.5 px-3 text-slate-500">39 °C</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x02</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Available Spare Blocks</td>
                          <td className="py-2.5 px-3 text-slate-900">100%</td>
                          <td className="py-2.5 px-3 text-slate-400">10%</td>
                          <td className="py-2.5 px-3 text-slate-500">100</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x03</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Percentage Used (Wear Index)</td>
                          <td className="py-2.5 px-3 text-slate-900">1%</td>
                          <td className="py-2.5 px-3 text-slate-400">100%</td>
                          <td className="py-2.5 px-3 text-slate-500">1 (99% Remaining)</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x04</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Data Units Read (TBR)</td>
                          <td className="py-2.5 px-3 text-slate-900">100,000,000</td>
                          <td className="py-2.5 px-3 text-slate-400">-</td>
                          <td className="py-2.5 px-3 text-slate-500">51.2 TB</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">OK</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x05</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Data Units Written (TBW)</td>
                          <td className="py-2.5 px-3 text-slate-900">48,437,500</td>
                          <td className="py-2.5 px-3 text-slate-400">-</td>
                          <td className="py-2.5 px-3 text-slate-500">24.8 TB</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">OK</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x0E</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Media and Data Integrity Errors</td>
                          <td className="py-2.5 px-3 text-slate-900">0</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">0</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">0x0F</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Error Information Log Entries</td>
                          <td className="py-2.5 px-3 text-slate-900">0</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">0</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                      </>
                    ) : (
                      <>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">05</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Reallocated Sectors Count</td>
                          <td className="py-2.5 px-3 text-slate-900">100</td>
                          <td className="py-2.5 px-3 text-slate-400">10</td>
                          <td className="py-2.5 px-3 text-slate-500">0</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">09</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Power-On Hours Count</td>
                          <td className="py-2.5 px-3 text-slate-900">100</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">12,850 hrs</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">OK</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">C5</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Current Pending Sector Count</td>
                          <td className="py-2.5 px-3 text-slate-900">100</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">0</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                        <tr>
                          <td className="py-2.5 px-3 font-bold text-slate-900">CA</td>
                          <td className="py-2.5 px-3 font-sans text-slate-700">Percentage Used Endurance Indicator</td>
                          <td className="py-2.5 px-3 text-slate-900">98</td>
                          <td className="py-2.5 px-3 text-slate-400">0</td>
                          <td className="py-2.5 px-3 text-slate-500">2% Used</td>
                          <td className="py-2.5 px-3 text-right"><span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">PASSED</span></td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Mounted Filesystems & Disk Partitions */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Mounted Filesystems & Disk Partitions</h3>
              
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
          </div>
        )}

        {/* TAB 5: NETWORK INTERFACES, TRAFFIC & PORTS */}
        {activeTab === 'network' && (
          <div className="space-y-6">
            {/* Real-time Bandwidth Sparklines & Latency Probes */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Ingress Throughput */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Ingress (Download Rx)</span>
                  <ArrowDownRight className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-emerald-600">{netRxMbps}</span>
                  <span className="text-xs text-slate-400 font-mono">Mbps</span>
                </div>
                {/* SVG Sparkline */}
                <div className="h-9 w-full flex items-end gap-1 pt-1">
                  {netRxHistory.map((val, idx) => {
                    const max = Math.max(...netRxHistory, 30);
                    const pct = Math.min(100, Math.max(15, (val / max) * 100));
                    return (
                      <div key={idx} className="flex-1 bg-emerald-100 rounded-t h-full flex items-end">
                        <div 
                          className="w-full bg-emerald-500 rounded-t transition-all duration-300"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                  <span>Min: 8.4 Mbps</span>
                  <span>Max: 26.2 Mbps</span>
                </div>
              </div>

              {/* Egress Throughput */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider">Egress (Upload Tx)</span>
                  <ArrowUpRight className="w-4 h-4 text-purple-500" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-purple-600">{netTxMbps}</span>
                  <span className="text-xs text-slate-400 font-mono">Mbps</span>
                </div>
                {/* SVG Sparkline */}
                <div className="h-9 w-full flex items-end gap-1 pt-1">
                  {netTxHistory.map((val, idx) => {
                    const max = Math.max(...netTxHistory, 60);
                    const pct = Math.min(100, Math.max(15, (val / max) * 100));
                    return (
                      <div key={idx} className="flex-1 bg-purple-100 rounded-t h-full flex items-end">
                        <div 
                          className="w-full bg-purple-600 rounded-t transition-all duration-300"
                          style={{ height: `${pct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-1">
                  <span>Min: 22.0 Mbps</span>
                  <span>Max: 54.8 Mbps</span>
                </div>
              </div>

              {/* Network Latency Prober */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">ICMP Edge Latency</span>
                    <button
                      onClick={handlePingProbe}
                      disabled={isPingingNet}
                      className="flex items-center gap-1 text-[11px] font-bold text-purple-600 hover:text-purple-700 disabled:opacity-50"
                    >
                      <RotateCw className={`w-3 h-3 ${isPingingNet ? 'animate-spin' : ''}`} />
                      <span>{isPingingNet ? 'Pinging...' : 'Ping Test'}</span>
                    </button>
                  </div>
                  <div className="space-y-1.5 mt-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Cloudflare (1.1.1.1):
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {pingLatencyResults?.cloudflare || '0.9 ms'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Google DNS (8.8.8.8):
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {pingLatencyResults?.google || '1.3 ms'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 flex items-center gap-1.5 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Uplink Gateway (103.147.154.1):
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {pingLatencyResults?.gateway || '0.3 ms'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Packet Drops: <strong>0%</strong></span>
                  <span>Jitter: <strong>0.1 ms</strong></span>
                </div>
              </div>
            </div>

            {/* Network Interfaces Cards */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Network Interfaces & Telemetry
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Interface eth0 (WAN) */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-blue-600" />
                        <span className="text-xs font-bold text-slate-900 font-mono">eth0 (WAN Uplink)</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">52:54:00:8a:3f:1c</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      UP 10 Gbps
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <div>IPv4: <strong className="text-slate-900">103.147.154.82/24</strong></div>
                    <div>IPv6: <span className="text-slate-500">2001:df4:*:*:1/64</span></div>
                    <div>MTU: <strong className="text-slate-800">1500</strong> (Full Duplex)</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-100">
                    <div>
                      <span className="block text-slate-400">Rx Total:</span>
                      <strong className="text-slate-800">4.18 TB</strong> (0 err)
                    </div>
                    <div>
                      <span className="block text-slate-400">Tx Total:</span>
                      <strong className="text-slate-800">12.65 TB</strong> (0 err)
                    </div>
                  </div>
                </div>

                {/* Interface docker0 (Bridge) */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Radio className="w-3.5 h-3.5 text-purple-600" />
                        <span className="text-xs font-bold text-slate-900 font-mono">docker0 (Bridge)</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">02:42:1a:4e:88:99</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      UP / ACTIVE
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <div>IPv4: <strong className="text-slate-900">172.17.0.1/16</strong></div>
                    <div>Scope: <span className="text-slate-500">Container Subnet</span></div>
                    <div>MTU: <strong className="text-slate-800">1500</strong></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-100">
                    <div>
                      <span className="block text-slate-400">Rx Containers:</span>
                      <strong className="text-slate-800">840 GB</strong>
                    </div>
                    <div>
                      <span className="block text-slate-400">Tx Containers:</span>
                      <strong className="text-slate-800">812 GB</strong>
                    </div>
                  </div>
                </div>

                {/* Interface cloudflared0 (Tunnel) */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                        <span className="text-xs font-bold text-slate-900 font-mono">cloudflared0 (Tunnel)</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">tun device (QUIC)</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      ZERO TRUST
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <div>Protocol: <strong className="text-slate-900">HTTP/3 QUIC</strong></div>
                    <div>Endpoint: <span className="text-slate-500">Edge Gateway</span></div>
                    <div>MTU: <strong className="text-slate-800">1280</strong></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-100">
                    <div>
                      <span className="block text-slate-400">Rx Ingress:</span>
                      <strong className="text-slate-800">1.24 TB</strong>
                    </div>
                    <div>
                      <span className="block text-slate-400">Tx Egress:</span>
                      <strong className="text-slate-800">1.89 TB</strong>
                    </div>
                  </div>
                </div>

                {/* Interface lo (Loopback) */}
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <CircleDot className="w-3.5 h-3.5 text-slate-600" />
                        <span className="text-xs font-bold text-slate-900 font-mono">lo (Loopback)</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">Local Interprocess</span>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">
                      INTERNAL
                    </span>
                  </div>

                  <div className="space-y-1 text-[11px] font-mono text-slate-600 bg-slate-50 p-2 rounded-lg">
                    <div>IPv4: <strong className="text-slate-900">127.0.0.1/8</strong></div>
                    <div>IPv6: <span className="text-slate-500">::1/128</span></div>
                    <div>MTU: <strong className="text-slate-800">65536</strong></div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-500 pt-1 border-t border-slate-100">
                    <div>
                      <span className="block text-slate-400">Rx Loopback:</span>
                      <strong className="text-slate-800">18.2 GB</strong>
                    </div>
                    <div>
                      <span className="block text-slate-400">Tx Loopback:</span>
                      <strong className="text-slate-800">18.2 GB</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* TCP Socket States Summary */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-bold text-slate-900 flex items-center gap-2">
                <Gauge className="w-4 h-4 text-purple-600" />
                Kernel TCP Socket States:
              </span>
              <div className="flex items-center gap-4 font-mono text-xs">
                <span>ESTABLISHED: <strong className="text-emerald-600">142</strong></span>
                <span>TIME_WAIT: <strong className="text-slate-700">18</strong></span>
                <span>CLOSE_WAIT: <strong className="text-amber-600">4</strong></span>
                <span>SYN_SENT: <strong className="text-slate-500">1</strong></span>
                <span>LISTEN: <strong className="text-blue-600">12</strong></span>
              </div>
            </div>

            {/* Listening Ports & Sockets (netstat/ss) */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Open TCP/UDP Sockets & Listening Ports (ss -tulpn)</h3>

              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
          </div>
        )}

        {/* TAB 6: HOST CONSOLE (root shell, admin only) */}
        {activeTab === 'console' && isAdmin && (
          <HostConsole hostname="vps-barepod-edge-01" />
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
              You are about to terminate <strong>{processToKill.command}</strong> (user: <code>{processToKill.user}</code>).
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setProcessToKill(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
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
                Close Log
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
