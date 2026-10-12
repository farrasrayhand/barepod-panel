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
  /** A system path the browser may read but never change. */
  protected?: boolean;
}

/** One database or cache row, as the daemon stores it. */
export interface DatabaseRow {
  id: string;
  kind: 'database' | 'cache';
  websiteSlug?: string;
  tenantUser: string;
  engine: string;
  version?: string;
  alias: string;
  name: string;
  user?: string;
  host?: string;
  port?: number;
  path?: string;
  maxConnections?: number;
  maxMemoryMb?: number;
  status: string;
  note?: string;
  deletedAt?: string;
  /** Set when the website this database lived in was deleted but the database was kept. */
  detachedAt?: string;
  createdAt: string;
  fileBased: boolean;
  detected?: boolean;
  sizeBytes?: number;
  exposure?: string;
  exposureNote?: string;
  exposedAt?: string;
}

/** One engine, with what this host can really do (availability is detected). */
export interface DbEngineRow {
  engine: string;
  label: string;
  kind: 'database' | 'cache';
  versions: string[];
  port?: number;
  fileBased: boolean;
  client?: string;
  daemon?: string;
  available: boolean;
  running: boolean;
  automated: boolean;
  note?: string;
}

/** What the deploy wizard sends; the daemon validates every part of it. */
export interface CreateWebsitePayload {
  slug: string;
  domain: string;
  tenantUser: string;
  runtime: string;
  version?: string;
  framework?: string;
  webServer: string;
  port?: number;
  tunnelEnabled?: boolean;
  source: { kind: string; repo?: string; branch?: string };
  database?: { engine: string; version?: string; name?: string; user?: string };
  cache?: { engine: string };
  autoEnv?: boolean;
  automationSteps?: string[];
}

export interface CreateDatabasePayload {
  engine: string;
  version?: string;
  alias: string;
  /** The engine account the form asked for; the daemon derives one when it is empty. */
  username?: string;
  websiteSlug?: string;
  password?: string;
  maxConnections?: number;
  maxMemoryMb?: number;
}

/** Databases and caches are the same resource with different commands. */
const databaseFamily = (base: string) => ({
  list: (bin = false) =>
    request<{
      items: DatabaseRow[];
      bin: boolean;
      retentionDays: number;
      /** The account's package allowance, present only when it is under one. */
      quota?: { maxDatabases: number; usedDatabases: number };
    }>(`${base}${bin ? '?bin=true' : ''}`),

  recycleBin: () => request<{ items: DatabaseRow[]; retentionDays: number }>(`${base}/recycle-bin`),

  create: (payload: CreateDatabasePayload) =>
    request<{ database: DatabaseRow; password?: string; passwordShownOnce?: boolean }>(base, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  get: (id: string) => request<{ database: DatabaseRow }>(`${base}/${id}`),

  patch: (id: string, payload: { alias?: string; maxConnections?: number; maxMemoryMb?: number }) =>
    request<{ database: DatabaseRow }>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  /** Soft delete: the record is kept and moves to the recycle bin. */
  bin: (id: string) => request<{ id: string; status: string }>(`${base}/${id}`, { method: 'DELETE' }),

  restore: (id: string) => request<{ database: DatabaseRow }>(`${base}/${id}/restore`, { method: 'POST' }),

  purge: (id: string) => request<{ id: string; purged: boolean }>(`${base}/${id}/purge`, { method: 'POST' }),

  emptyBin: () => request<{ purged: string[] }>(`${base}/recycle-bin`, { method: 'DELETE' }),

  rotatePassword: (id: string, password: string) =>
    request<{ id: string; password: string }>(`${base}/${id}/rotate-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  reveal: (id: string) =>
    request<{ id: string; user: string; password: string; expiresIn: number }>(`${base}/${id}/reveal`, {
      method: 'POST',
    }),

  connectionString: (id: string) => request<{ string: string; engine: string }>(`${base}/${id}/connection-string`),

  /**
   * The engine's own log for this record, plus what the panel did with it — the two halves of
   * "why did this happen". A family method, not a fixed path: a cache lives under /caches and a
   * database under /databases, and either path answers "No such record" for the other's kind.
   */
  log: (id: string) =>
    request<{
      engine: string;
      source: string;
      note: string;
      lines: string[];
      audit: { id?: number; at?: string; ts?: string; action: string; target?: string; detail?: string }[];
    }>(`${base}/${id}/log`),

  /**
   * Open or close this record's port. The daemon refuses "public" with 409 while the
   * brute-force lockout is not enforcing, and answers with the note describing what it did.
   */
  setExposure: (id: string, exposure: 'public' | 'private') =>
    request<{ exposure: string; note: string; database: unknown }>(`${base}/${id}/exposure`, {
      method: 'POST',
      body: JSON.stringify({ exposure }),
    }),

  /**
   * The dump, as a blob.
   *
   * Fetched rather than navigated to on purpose: a download started by an `<a download>` is
   * handled by the browser's own network stack, which refuses to run at all on an origin whose
   * certificate the user clicked past — "Failed - Network error" while the page works.
   */
  export: (id: string) => request<Blob>(`${base}/${id}/export`, { raw: true }),

  tables: (id: string) =>
    request<{
      engine: string;
      tables?: string[];
      keys?: string[];
      keyCount?: number;
      browser?: string;
      note?: string;
    }>(`${base}/${id}/tables`),

  query: (id: string, sql: string) =>
    request<{
      columns: string[];
      rows: (string | null)[][];
      affected: number;
      truncated: boolean;
    }>(`${base}/${id}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),

  gui: (id: string, tool?: string) =>
    request<{
      database?: string;
      tool?: string;
      available?: boolean;
      path?: string;
      tools?: { tool: string; description: string; available: boolean; path: string }[];
      tables?: string;
      query?: string;
      note?: string;
    }>(`${base}/${id}/gui${tool ? `/${tool}` : ''}`),
});

/** One address the brute-force lockout is keeping out of the database engines. */
export interface GuardBan {
  ip: string;
  engine?: string;
  user?: string;
  reason?: string;
  count: number;
  at: string;
  expiresAt: string;
}

/** The lockout's state: its numbers, what it is keeping out, and whether it can enforce. */
export interface GuardStatus {
  enabled: boolean;
  maxRetry: number;
  findTime: string;
  banTime: string;
  enforcing: boolean;
  reason?: string;
  bans: GuardBan[];
  /** Per engine: empty means the log is being read, otherwise why it is not. */
  sources: Record<string, string>;
  lastSweep?: string;
  lastError?: string;
  interval: string;
  /** The nftables table and set the bans really live in. */
  table: string;
  set: string;
}

export const api = {
  health: () => request<{ status: string; version: string; mode: string }>('/health'),

  /**
   * The brute-force lockout. The daemon decides with these numbers and keeps the addresses
   * out in an nftables set, so this is the panel's view of something that is really enforced.
   */
  guard: () => request<GuardStatus>('/system/guard'),

  saveGuardSettings: (settings: { enabled?: boolean; maxRetry?: number; findTime?: string; banTime?: string }) =>
    request<GuardStatus>('/system/guard', { method: 'PATCH', body: JSON.stringify(settings) }),

  /** Let one address back in. Audited by the daemon, against the address. */
  unban: (ip: string) =>
    request<GuardStatus>('/system/guard/unban', { method: 'POST', body: JSON.stringify({ ip }) }),

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

  /** Change the panel password; every other session is signed out by the daemon. */
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ status: string; signedOutEverywhere: boolean }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  verify: (password: string) =>
    request<{ elevated: boolean; elevatedUntil: string }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  sessions: () => request<{ items: SessionRow[]; currentId: string }>('/sessions'),

  revokeSession: (id: string) => request(`/sessions/${id}`, { method: 'DELETE' }),

  /** The caller's own activity; an admin receives every account's (see `everything`). */
  audit: (limit = 25) => request<{ items: AuditEntry[]; everything: boolean }>(`/audit?limit=${limit}`),

  websites: () => request<{ items: ApiWebsite[] }>('/websites'),

  /** The real deploy: the daemon provisions asynchronously and answers with a job id. */
  createWebsite: (payload: CreateWebsitePayload) =>
    request<{ slug: string; deployId: string; mode: string; status: string; totalSteps?: number }>(
      '/websites',
      { method: 'POST', body: JSON.stringify(payload) },
    ),

  website: (slug: string) => request<ApiWebsite>(`/websites/${slug}`),

  /** Re-run the pipeline from the source recorded at create time; also a 202 + job. */
  redeploy: (slug: string) =>
    request<{ slug: string; deployId: string; mode: string; status: string; totalSteps?: number }>(
      `/websites/${slug}/redeploy`,
      { method: 'POST' },
    ),

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

  /** Multipart upload; the URL builder differs per family, the work does not. */
  uploadFiles: (slug: string, path: string, files: File[]) => uploadTo(api.uploadUrl(slug, path), files),

  downloadUrl: (slug: string, path: string) =>
    `${API_BASE}/websites/${slug}/files/download?path=${encodeURIComponent(path)}`,

  /** Databases: engines detected on this host, then the usual CRUD + bin. */
  dbEngines: () => request<{ items: DbEngineRow[] }>('/db-engines'),
  databases: databaseFamily('/databases'),
  caches: databaseFamily('/caches'),

  /** The picker behind the host-wide browser: which accounts have a home. */
  tenants: () => request<{ items: TenantRow[]; root: string }>('/tenants'),

  /**
   * The host-wide browser. Same operations as a website's files, but the scope
   * travels as a query instead of a slug: `scope=host` for the whole machine
   * (admin only) or `scope=tenant&tenant=<name>` for one account's home.
   */
  scopedFiles: {
    list: (scope: FileScope, path = '') =>
      request<{
        path: string;
        scope: string;
        root: string;
        readOnly: boolean;
        items: FileEntry[];
        maxSize: number;
      }>(`/files?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`),

    read: (scope: FileScope, path: string) =>
      request<{
        path: string;
        size: number;
        mode: string;
        modifiedAt: string;
        binary: boolean;
        encoding: 'utf-8' | 'base64';
        content: string;
        writable: boolean;
      }>(`/files/content?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`),

    write: (scope: FileScope, path: string, content: string, encoding?: 'utf-8' | 'base64') =>
      request<{ path: string; size: number; modifiedAt: string }>(`/files/content?${fileScopeQuery(scope)}`, {
        method: 'PUT',
        body: JSON.stringify({ path, content, encoding }),
      }),

    create: (scope: FileScope, path: string) =>
      request<{ path: string }>(`/files/create?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),

    mkdir: (scope: FileScope, path: string) =>
      request<{ path: string }>(`/files/mkdir?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),

    rename: (scope: FileScope, path: string, name: string) =>
      request<{ path: string }>(`/files/rename?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path, name }),
      }),

    copy: (scope: FileScope, path: string, to?: string) =>
      request<{ path: string }>(`/files/copy?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path, to }),
      }),

    move: (scope: FileScope, path: string, to?: string) =>
      request<{ path: string }>(`/files/move?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path, to }),
      }),

    remove: (scope: FileScope, paths: string[]) =>
      request<{ deleted: string[] }>(`/files/delete?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ paths }),
      }),

    compress: (scope: FileScope, paths: string[]) =>
      request<Blob>(`/files/compress?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ paths }),
        raw: true,
      }),

    uploadUrl: (scope: FileScope, path = '') => `${API_BASE}/files/upload?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`,

    uploadFiles: (scope: FileScope, path: string, files: File[]) =>
      uploadTo(api.scopedFiles.uploadUrl(scope, path), files),

    downloadUrl: (scope: FileScope, path: string) =>
      `${API_BASE}/files/download?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`,
  },

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

/** One account, as the host-wide browser's picker needs it. */
export interface TenantRow {
  username: string;
  group: string;
  status: string;
  home: string;
  exists: boolean;
}

/** Which tree a host-wide request is about. */
export type FileScope = { kind: 'host' } | { kind: 'tenant'; tenant: string };

const fileScopeQuery = (scope: FileScope): string =>
  scope.kind === 'host' ? 'scope=host' : `scope=tenant&tenant=${encodeURIComponent(scope.tenant)}`;

/** Shared multipart upload: the CSRF header and the error shape live here once. */
async function uploadTo(url: string, files: File[]): Promise<{ uploaded: string[] }> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);

  const response = await fetch(url, { method: 'POST', body: form, headers, credentials: 'include' });
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
}

export interface SessionRow {
  id: string;
  userAgent: string;
  ip: string;
  elevatedUntil?: string;
  createdAt: string;
  lastSeenAt: string;
}

/** One line of the daemon's audit log. */
export interface AuditEntry {
  id: number;
  at: string;
  userId?: string;
  username?: string;
  action: string;
  target?: string;
  ip?: string;
  detail?: string;
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


