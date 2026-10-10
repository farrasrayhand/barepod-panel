/**
 * Maps API payloads onto the UI's view models, so the components keep using the
 * types they already render. The prototype's mock objects stay available for
 * when the daemon is not running.
 */
import type { WebApp, RuntimeType, WebServerType } from '../types';
import type { ApiWebsite, HostMetrics, SiteMetrics } from './client';

const RUNTIMES: RuntimeType[] = ['php', 'nodejs', 'python', 'go', 'ruby', 'rust', 'static', 'proxy'];
const WEB_SERVERS: WebServerType[] = ['openlitespeed', 'nginx', 'caddy', 'apache'];

/** Bytes to a short human string for the compact list columns. */
export function formatBytes(bytes: number, digits = 0): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`;
}

/** Bytes per second to a short human string. */
export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

/** Seconds to "3d 4h", "2h 15m", "45s". */
export function formatUptime(seconds: number): string {
  if (!seconds) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** RFC3339 to the panel's date format. */
export function formatDate(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

/** RFC3339 to "2026-10-10 16:40:12". */
export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}`;
}

/** A website as the API describes it, adapted to the UI model. */
export function toWebApp(site: ApiWebsite, metrics?: SiteMetrics): WebApp {
  const runtime = RUNTIMES.includes(site.runtime as RuntimeType) ? (site.runtime as RuntimeType) : 'nodejs';
  const webServer = WEB_SERVERS.includes(site.webServer as WebServerType)
    ? (site.webServer as WebServerType)
    : 'nginx';

  return {
    id: site.slug,
    name: site.slug,
    domain: site.domain,
    runtime,
    version: site.version,
    framework: site.framework || undefined,
    webServer,
    tenantUser: site.tenantUser,
    // The API tracks deployStatus separately; the UI shows the service state.
    status:
      site.deployStatus === 'failed'
        ? 'error'
        : site.deployStatus === 'building' || site.deployStatus === 'pending'
          ? 'building'
          : site.status === 'running'
            ? 'running'
            : 'stopped',
    ssl: site.ssl,
    tunnelEnabled: site.tunnelEnabled,
    tunnelRoute: site.tunnelEnabled ? `${site.domain} -> 127.0.0.1:${site.port}` : undefined,
    port: site.port,
    memoryUsage: metrics?.available ? formatBytes(metrics.memoryBytes) : '—',
    cpuUsage: metrics?.available ? `${metrics.cpuPercent.toFixed(1)}%` : '—',
    createdAt: formatDate(site.createdAt),
    path: `/home/${site.tenantUser}/apps/${site.slug}`,
  };
}

/** Compact summary of a host sample for cards. */
export function hostSummary(latest: HostMetrics) {
  return {
    cpu: `${latest.cpuPercent.toFixed(1)}%`,
    cpuCores: latest.cpuCores,
    memory: `${formatBytes(latest.memoryUsedBytes)} / ${formatBytes(latest.memoryTotalBytes)}`,
    memoryPercent: latest.memoryTotalBytes
      ? (latest.memoryUsedBytes / latest.memoryTotalBytes) * 100
      : 0,
    swap: latest.swapTotalBytes
      ? `${formatBytes(latest.swapUsedBytes)} / ${formatBytes(latest.swapTotalBytes)}`
      : 'none',
    load: `${latest.load1.toFixed(2)} / ${latest.load5.toFixed(2)} / ${latest.load15.toFixed(2)}`,
    uptime: formatUptime(latest.uptimeSeconds),
    disk: `${formatBytes(latest.diskUsedBytes)} / ${formatBytes(latest.diskTotalBytes)}`,
    diskPercent: latest.diskTotalBytes ? (latest.diskUsedBytes / latest.diskTotalBytes) * 100 : 0,
    net: `${formatRate(latest.netRxBps)} in / ${formatRate(latest.netTxBps)} out`,
    diskIo: `${formatRate(latest.diskReadBps)} read / ${formatRate(latest.diskWriteBps)} write`,
  };
}
