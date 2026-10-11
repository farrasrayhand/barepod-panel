/**
 * Minimal API client for the BarePod daemon.
 *
 * The frontend is still a prototype: when the daemon is not running every call
 * fails fast and the UI falls back to its mock data (see `apiReachable`).
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fields?: Record<string, string>;

  constructor(message: string, status: number, code?: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

type RequestOptions = RequestInit & { raw?: boolean };

async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const { raw, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken && method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-Token', csrfToken);

  const response = await fetch(`${API_BASE}${path}`, { ...rest, headers, credentials: 'include' });

  if (!response.ok) {
    let payload: { error?: { code?: string; message?: string }; fields?: Record<string, string> } | null = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    throw new ApiError(
      payload?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      payload?.error?.code,
      payload?.fields,
    );
  }

  if (raw) return (await response.blob()) as T;

  const text = await response.text();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

export interface PanelUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  groupName: string;
  status: string;
  createdAt: string;
}

export interface ApiWebsite {
  id: string;
  slug: string;
  domain: string;
  tenantUser: string;
  runtime: string;
  version: string;
  framework: string;
  webServer: string;
  status: string;
  deployStatus: 'pending' | 'building' | 'ready' | 'failed';
  ssl: boolean;
  tunnelEnabled: boolean;
  port: number;
  createdAt: string;
}

export interface DeployJob {
  id: string;
  slug: string;
  mode: 'real' | 'dry-run';
  status: 'pending' | 'running' | 'success' | 'failed';
  step: number;
  totalSteps: number;
  currentStep: string;
  error?: string;
}

export interface PrepareDirectoryResult {
  slug: string;
  tenantUser: string;
  path: string;
  created: boolean;
  existed: boolean;
  mode: 'real' | 'dry-run';
}

export interface Capabilities {
  os: string;
  arch: string;
  kernel: string;
  distro: string;
  systemd: boolean;
  lxc: boolean;
  docker: boolean;
  smart: boolean;
  fstrim: boolean;
  useradd: boolean;
  quota: boolean;
  runAsUser: boolean;
  diskStats: boolean;
  systemdState: string;
}

/** One thing this host cannot do, with the reason and what to use instead. */
export interface Limitation {
  feature: string;
  reason: string;
  advice: string;
}

/** Raw host numbers — formatting happens in the UI. */
export interface HostMetrics {
  ts: string;
  cpuPercent: number;
  cpuCores: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  load1: number;
  load5: number;
  load15: number;
  uptimeSeconds: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskReadBps: number;
  diskWriteBps: number;
  netRxBps: number;
  netTxBps: number;
  available: boolean;
  reason?: string;
}

export interface SiteMetrics {
  ts: string;
  slug: string;
  cpuPercent: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  tasks: number;
  available: boolean;
  reason?: string;
}

export interface MetricSeries<T> {
  latest: T;
  items: T[];
  range: string;
  windowSeconds: number;
  intervalSeconds: number;
  /** Longest window the daemon can answer (ring buffer bound). */
  maxRangeSeconds?: number;
  buffered?: number;
  source?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  mode: string;
  modifiedAt: string;
  symlinkTarget?: string;
}

export const api = {
  health: () => request<{ status: string; version: string; mode: string }>('/health'),

  login: async (username: string, password: string) => {
    const session = await request<{ user: PanelUser; csrfToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    csrfToken = session.csrfToken;
    return session;
  },

  logout: async () => {
    await request('/auth/logout', { method: 'POST' });
    csrfToken = null;
  },

  me: async () => {
    const session = await request<{
      user: PanelUser;
      csrfToken: string;
      elevated: boolean;
      permissions: Record<string, boolean>;
    }>('/auth/me');
    // The daemon re-issues the CSRF token on every session read, so a page that
    // was reloaded (or opened fresh with a live cookie) can still write: without
    // this, every mutating call failed with "Missing or invalid CSRF token".
    csrfToken = session.csrfToken;
    return session;
  },

  verify: (password: string) =>
    request<{ elevated: boolean; elevatedUntil: string }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  sessions: () => request<{ items: SessionRow[]; currentId: string }>('/sessions'),

  revokeSession: (id: string) => request(`/sessions/${id}`, { method: 'DELETE' }),

  websites: () => request<{ items: ApiWebsite[] }>('/websites'),

  website: (slug: string) => request<ApiWebsite>(`/websites/${slug}`),

  websiteAction: (slug: string, action: 'start' | 'stop' | 'restart') =>
    request<{ slug: string; action: string; status: string; mode: string }>(
      `/websites/${slug}/${action}`,
      { method: 'POST' },
    ),

  prepareDirectory: (body: { slug: string; tenantUser: string }) =>
    request<PrepareDirectoryResult>('/websites/prepare-directory', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  capabilities: () => request<{ capabilities: Capabilities; limitations: Limitation[]; mode: string }>(
    '/system/capabilities',
  ),

  capacity: () =>
    request<{
      capacity: { cpuCores: number; memoryMb: number; diskGb: number; diskFreeGb: number };
      allocation: Record<string, number>;
      usage: { cpu: number; ram: number; disk: number };
      fits: boolean;
      exceeds: string[];
      suggested: Record<string, number>;
      packages: { name: string; members: number; limits: Record<string, number> }[];
    }>('/system/capacity'),

  groups: () =>
    request<{ items: GroupRow[]; capabilities: string[] }>('/groups'),

  deployStreamUrl: (slug: string, deployId?: string) =>
    `${API_BASE}/websites/${slug}/deploy/stream${deployId ? `?id=${deployId}` : ''}`,

  // --- metrics -------------------------------------------------------------
  systemMetrics: (range = '1h') =>
    request<MetricSeries<HostMetrics>>(`/system/metrics?range=${encodeURIComponent(range)}`),

  siteMetrics: (slug: string, range = '1h') =>
    request<MetricSeries<SiteMetrics>>(`/websites/${slug}/metrics?range=${encodeURIComponent(range)}`),

  // --- file manager --------------------------------------------------------
  files: (slug: string, path = '') =>
    request<{ path: string; site: string; tenant: string; items: FileEntry[]; maxSize: number }>(
      `/websites/${slug}/files?path=${encodeURIComponent(path)}`,
    ),

  readFile: (slug: string, path: string) =>
    request<{
      path: string;
      size: number;
      mode: string;
      modifiedAt: string;
      binary: boolean;
      encoding: 'utf-8' | 'base64';
      content: string;
    }>(`/websites/${slug}/files/content?path=${encodeURIComponent(path)}`),

  writeFile: (slug: string, path: string, content: string, encoding?: 'utf-8' | 'base64') =>
    request<{ path: string; size: number; modifiedAt: string }>(`/websites/${slug}/files/content`, {
      method: 'PUT',
      body: JSON.stringify({ path, content, encoding }),
    }),

  createFile: (slug: string, path: string) =>
    request<{ path: string }>(`/websites/${slug}/files/create`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  mkdir: (slug: string, path: string) =>
    request<{ path: string }>(`/websites/${slug}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  renameFile: (slug: string, path: string, name: string) =>
    request<{ path: string }>(`/websites/${slug}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),

  copyFiles: (slug: string, path: string, to?: string) =>
    request<{ path: string }>(`/websites/${slug}/files/copy`, {
      method: 'POST',
      body: JSON.stringify({ path, to }),
    }),

  moveFiles: (slug: string, path: string, to?: string) =>
    request<{ path: string }>(`/websites/${slug}/files/move`, {
      method: 'POST',
      body: JSON.stringify({ path, to }),
    }),

  deleteFiles: (slug: string, paths: string[]) =>
    request<{ deleted: string[] }>(`/websites/${slug}/files/delete`, {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),

  compressFiles: (slug: string, paths: string[]) =>
    request<Blob>(`/websites/${slug}/files/compress`, {
      method: 'POST',
      body: JSON.stringify({ paths }),
      raw: true,
    }),

  uploadUrl: (slug: string, path = '') =>
    `${API_BASE}/websites/${slug}/files/upload?path=${encodeURIComponent(path)}`,

  /**
   * Multipart upload. Kept here (not in the view) so the CSRF header and the
   * error shape stay in one place.
   */
  uploadFiles: async (slug: string, path: string, files: File[]) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file, file.name));
    const headers = new Headers();
    if (csrfToken) headers.set('X-CSRF-Token', csrfToken);

    const response = await fetch(api.uploadUrl(slug, path), {
      method: 'POST',
      body: form,
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      let message = `Upload failed (${response.status})`;
      try {
        const payload = (await response.json()) as { error?: { message?: string } };
        if (payload?.error?.message) message = payload.error.message;
      } catch {
        // keep the generic message
      }
      throw new ApiError(message, response.status);
    }
    return (await response.json()) as { uploaded: string[] };
  },

  downloadUrl: (slug: string, path: string) =>
    `${API_BASE}/websites/${slug}/files/download?path=${encodeURIComponent(path)}`,

  // --- terminal ------------------------------------------------------------
  /** One-time ticket for a WebSocket handshake (never a token in the URL). */
  wsTicket: () => request<{ ticket: string; expiresAt: string }>('/ws/ticket', { method: 'POST' }),

  /** WebSocket URL for a terminal; without a slug it is the host shell (admin only). */
  ptyUrl: (ticket: string, slug?: string) =>
    `${wsBase()}${slug ? `/websites/${slug}/pty` : '/system/pty'}?ticket=${encodeURIComponent(ticket)}`,
};

/**
 * EventSource cannot send headers, but withCredentials sends the session cookie
 * and CSRF is not required for GET — so the stream authenticates without a token
 * in the URL. The returned function closes it.
 */
export function subscribeDeploy(
  slug: string,
  deployId: string | undefined,
  onLine: (line: DeployLogLine) => void,
  onDone?: (job: DeployJob) => void,
): () => void {
  const source = new EventSource(api.deployStreamUrl(slug, deployId), { withCredentials: true });

  source.addEventListener('log', (event) => {
    try {
      onLine(JSON.parse((event as MessageEvent).data) as DeployLogLine);
    } catch {
      // A malformed frame must not kill the stream.
    }
  });

  source.addEventListener('done', (event) => {
    try {
      onDone?.(JSON.parse((event as MessageEvent).data) as DeployJob);
    } catch {
      // The final status is pollable anyway.
    }
    source.close();
  });

  return () => source.close();
}

/** ws:// base derived from the API base (works for a relative base too). */
function wsBase(): string {
  if (/^https?:\/\//.test(API_BASE)) return API_BASE.replace(/^http/, 'ws');
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}${API_BASE}`;
}

export interface SessionRow {
  id: string;
  userAgent: string;
  ip: string;
  elevatedUntil?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, boolean>;
  limits: Record<string, number>;
  members: number;
  isDefault: boolean;
  isSystem: boolean;
}

/** True when the daemon answers — the prototype keeps working when it does not. */
export async function apiReachable(): Promise<boolean> {
  try {
    await api.health();
    return true;
  } catch {
    return false;
  }
}

export interface DeployLogLine {
  id: number;
  jobId: string;
  ts: string;
  stream: 'stdout' | 'stderr' | 'step' | 'status';
  line: string;
}


