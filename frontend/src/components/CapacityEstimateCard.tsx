import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle, CheckCircle2, Server, Boxes } from 'lucide-react';
import { api } from '../api/client';

interface CapacityEstimateCardProps {
  enabled?: boolean;
}

interface CapacityPayload {
  capacity: { cpuCores: number; memoryMb: number; diskGb: number; diskFreeGb: number };
  allocation: Record<string, number>;
  usage: { cpu: number; ram: number; disk: number };
  fits: boolean;
  exceeds: string[];
  overcommit: { cpu: boolean; ram: boolean; disk: boolean };
  suggested: Record<string, number>;
  packages: { name: string; members: number; limits: Record<string, number> }[];
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

export const CapacityEstimateCard: React.FC<CapacityEstimateCardProps> = ({ enabled = true }) => {
  const [data, setData] = useState<CapacityPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setData(await api.capacity() as CapacityPayload);
    } catch {
      // The endpoint is behind the `users` capability; a monitoring-only account
      // simply does not see this card instead of getting an error banner.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled || !data) return null;

  // Go serialises a nil slice as null. Every one of these must be normalised before
  // render: a single `.length` on null used to take the whole app blank.
  const suggested = data.suggested || {};
  const allocation = data.allocation || {};
  const usage = data.usage || { cpu: 0, ram: 0, disk: 0 };
  const overcommit = data.overcommit || { cpu: false, ram: false, disk: false };
  const exceeds = data.exceeds || [];
  const packages = data.packages || [];
  const cpuPer = Number(suggested.cpuQuotaPercent) || 100;
  const ramPer = Number(suggested.memoryMb) || 1024;
  const diskPer = Number(suggested.diskQuotaGb) || 10;

  // Shared resources are deliberately allowed to exceed their reservations. For
  // those the usable headroom is the physical capacity, not "capacity - claims";
  // otherwise a 142% RAM claim would report zero new users even though the host
  // is mostly idle. Disk uses the filesystem's free space.
  const cpuRemaining = overcommit.cpu
    ? data.capacity.cpuCores * 100
    : Math.max(0, data.capacity.cpuCores * 100 - Number(allocation.cpuQuotaPercent || 0));
  const ramRemaining = overcommit.ram
    ? data.capacity.memoryMb
    : Math.max(0, data.capacity.memoryMb - Number(allocation.memoryMb || 0));
  const diskRemaining = data.capacity.diskFreeGb > 0
    ? data.capacity.diskFreeGb
    : Math.max(0, data.capacity.diskGb - Number(allocation.diskQuotaGb || 0));

  const byCpu = Math.floor(cpuRemaining / cpuPer);
  const byRam = Math.floor(ramRemaining / ramPer);
  const byDisk = Math.floor(diskRemaining / diskPer);
  const addable = Math.max(0, Math.min(byCpu, byRam, byDisk));
  const comfortable = Math.max(0, Math.floor(addable * 0.75));

  const bottleneck = byCpu <= byRam && byCpu <= byDisk
    ? 'CPU quota'
    : byRam <= byDisk
      ? 'RAM'
      : 'disk';

  const bar = (label: string, used: number, total: number, color: string) => (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-600 font-medium">{label}</span>
        <span className="font-mono text-slate-700">{Math.round(used)} / {Math.round(total)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${Math.min(100, total > 0 ? (used / total) * 100 : 0)}%` }}
        />
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Capacity Estimate</h3>
            <p className="text-xs text-slate-500">How many more packages this host can hold.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          title="Refresh capacity"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">CPU</div>
          <div className="font-mono font-bold text-slate-800 text-sm mt-0.5">{data.capacity.cpuCores} vCPU</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{pct(usage.cpu)} allocated</div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">RAM</div>
          <div className="font-mono font-bold text-slate-800 text-sm mt-0.5">{(data.capacity.memoryMb / 1024).toFixed(1)} GB</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{pct(usage.ram)} allocated</div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Disk</div>
          <div className="font-mono font-bold text-slate-800 text-sm mt-0.5">{data.capacity.diskGb} GB</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{data.capacity.diskFreeGb} GB free</div>
        </div>
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-indigo-500 font-semibold">Comfortable</div>
          <div className="font-mono font-bold text-indigo-800 text-sm mt-0.5">{comfortable} user{comfortable === 1 ? '' : 's'}</div>
          <div className="text-[10px] text-indigo-600 mt-0.5">+{addable} theoretical</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {bar('CPU claim', Number(allocation.cpuQuotaPercent || 0), data.capacity.cpuCores * 100, 'bg-blue-600')}
        {bar('RAM claim', Number(allocation.memoryMb || 0), data.capacity.memoryMb, 'bg-emerald-600')}
        {bar('Disk claim', Number(allocation.diskQuotaGb || 0), data.capacity.diskGb, 'bg-violet-600')}
      </div>

      <div className={`rounded-xl border p-3 text-[11px] leading-relaxed ${data.fits ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
        <div className="flex items-start gap-2">
          {data.fits ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div>
            <strong>{data.fits ? 'Current allocation fits.' : 'Current allocation exceeds the host.'}</strong>{' '}
            {exceeds.length > 0
              ? exceeds.join(' ')
              : `Bottleneck for new users: ${bottleneck}.`}
            <div className="mt-1 text-[10px] opacity-80">
              Estimate assumes the suggested package: {cpuPer}% CPU, {ramPer} MB RAM, {diskPer} GB disk per user,
              with 25% headroom for the OS, panel, database, and traffic spikes. Actual capacity depends on the apps' workloads.
              {(overcommit.cpu || overcommit.ram) && (
                <div className="mt-1">
                  CPU/RAM are marked shared{overcommit.cpu ? ' (CPU)' : ''}{overcommit.ram ? ' (RAM)' : ''}, so reservations may exceed physical capacity; this estimate uses the physical headroom instead.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-slate-400">
        <Server className="w-3.5 h-3.5" />
        Suggested package: {cpuPer}% CPU · {ramPer} MB RAM · {diskPer} GB disk
        <Boxes className="w-3.5 h-3.5 ml-2" />
        {packages.length} active package{packages.length === 1 ? '' : 's'}
      </div>
    </div>
  );
};
