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

  const sharedResources = [
    overcommit.cpu ? 'CPU' : '',
    overcommit.ram ? 'RAM' : '',
  ].filter(Boolean);
  const bottleneckLabel = bottleneck === 'CPU quota' ? 'CPU' : bottleneck;

  const resource = (
    label: string,
    total: string,
    promised: string,
    percent: number,
    color: string,
    shared: boolean,
    detail?: string,
  ) => (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</span>
        {shared && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-white border border-amber-200 text-amber-700">
            Shared
          </span>
        )}
      </div>
      <div className="font-mono font-bold text-slate-800 text-sm mt-1">{total}</div>
      <div className={`text-[10px] mt-0.5 ${percent > 100 ? 'text-amber-700' : 'text-slate-500'}`}>
        {promised}
        {detail ? ` · ${detail}` : ''}
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mt-2">
        <div
          className={`h-full rounded-full ${percent > 100 ? 'bg-amber-500' : color}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
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
            <p className="text-xs text-slate-500">A practical guide to how many more users this host can take.</p>
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

      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 flex items-start gap-3">
        <div className="text-3xl font-bold leading-none text-indigo-800 font-mono">{comfortable}</div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-indigo-900">
            {comfortable > 0 ? `more user${comfortable === 1 ? '' : 's'} can be added safely` : 'no safe headroom at this package size'}
          </div>
          <p className="text-[11px] text-indigo-700 mt-1">
            Maximum {addable} at the suggested package. {addable > 0 ? `${bottleneckLabel} is the first limit.` : 'Free CPU, RAM, or disk first.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {resource(
          'CPU',
          `${data.capacity.cpuCores} vCPU`,
          `${(Number(allocation.cpuQuotaPercent || 0) / 100).toFixed(2)} vCPU promised (${pct(usage.cpu)})`,
          usage.cpu * 100,
          'bg-blue-600',
          overcommit.cpu,
        )}
        {resource(
          'RAM',
          `${(data.capacity.memoryMb / 1024).toFixed(1)} GB`,
          `${(Number(allocation.memoryMb || 0) / 1024).toFixed(1)} GB promised (${pct(usage.ram)})`,
          usage.ram * 100,
          'bg-emerald-600',
          overcommit.ram,
        )}
        {resource(
          'Disk',
          `${data.capacity.diskGb} GB`,
          `${data.capacity.diskFreeGb} GB free`,
          data.capacity.diskGb > 0 ? (Number(allocation.diskQuotaGb || 0) / data.capacity.diskGb) * 100 : 0,
          'bg-violet-600',
          overcommit.disk,
          `${Number(allocation.diskQuotaGb || 0)} GB promised`,
        )}
      </div>

      <div className={`rounded-xl border p-3 text-[11px] leading-relaxed ${data.fits ? 'bg-slate-50 border-slate-200 text-slate-700' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
        <div className="flex items-start gap-2">
          {data.fits ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <div>
            <strong>{data.fits ? 'The current plan fits.' : 'The current plan exceeds the host.'}</strong>{' '}
            {exceeds.length > 0 && <span>{exceeds.join(' ')}</span>}
            {data.fits && sharedResources.length > 0 && (
              <div className="mt-1">
                {sharedResources.join(' and ')} {sharedResources.length === 1 ? 'is' : 'are'} shared, so promised
                values may go above the physical hardware. The estimate above uses real capacity and free disk,
                not the promises.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-[10px] text-slate-400 leading-relaxed">
        Assumes <strong className="text-slate-500">{cpuPer}% CPU, {ramPer} MB RAM, {diskPer} GB disk</strong> per user,
        with 25% headroom for the OS, panel, database, and traffic spikes. Actual capacity depends on the apps' workloads.
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
