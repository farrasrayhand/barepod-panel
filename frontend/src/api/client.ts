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
  upstreamUrl?: string;
  createdAt: string;
  sourceKind?: string;
  sourceRepo?: string;
  sourceBranch?: string;
  deployHookToken?: string;
  autoDeploy?: boolean;
}

export interface ApiDeployKey {
  algorithm: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface DetectedFramework {
  name: string;
  title: string;
  frameworkVersion?: string;
  minPhpVersion?: string;
  compatiblePhp?: string[];
  runtime: 'php' | 'nodejs' | 'python' | 'static' | 'go';
  version: string;
  packageManager: string;
  docRoot: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  databaseEngine?: string;
  cacheEngine?: string;
  isProxy?: boolean;
}

export interface ApiWebsiteGitStatus {
  detected: boolean;
  repo: string;
  branch: string;
  commit?: string;
  commitMessage?: string;
  autoDeploy: boolean;
  deployHookToken: string;
  webhookUrl: string;
  deployScript?: string;
  framework?: DetectedFramework;
  deployKey?: ApiDeployKey;
}

export interface ApiCronJob {
  id: string;
  websiteSlug: string;
  name: string;
  schedule: string;
  command: string;
  enabled: boolean;
  timeoutSec: number;
  lastRunAt?: string;
  lastStatus?: string;
  lastOutput?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SystemCronJob {
  id: string;
  label: string;
  desc: string;
  schedule: string;
  enabled: boolean;
  category: string;
}

export interface UserGitProvider {
  id: string;
  userId: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'gitea' | 'custom' | string;
  name: string;
  apiUrl?: string;
  username?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ApiDomain {
  id: string;
  websiteSlug: string;
  domain: string;
  isPrimary: boolean;
  sslEnabled: boolean;
  sslProvider: 'letsencrypt' | 'self_signed' | 'custom' | 'none' | string;
  sslStatus: 'active' | 'issuing' | 'expired' | 'error' | 'none' | string;
  sslCertPath: string;
  sslKeyPath: string;
  sslIssuer: string;
  sslExpiresAt: string;
  forceHttps: boolean;
  hstsEnabled: boolean;
  autoRenew: boolean;
  createdAt: string;
}

export interface ApiWebsiteSecurity {
  websiteSlug: string;
  maintenanceMode: boolean;
  maintenanceTitle: string;
  maintenanceMessage: string;
  maintenanceBypassIps: string;
  basicAuthEnabled: boolean;
  basicAuthUser: string;
  hasPassword?: boolean;
  basicAuthRealm: string;
  basicAuthBypassIps: string;
  ipRestrictionMode: 'none' | 'allowlist' | 'denylist' | string;
  ipRestrictionList: string;
  rateLimitEnabled: boolean;
  rateLimitReqPerSec: number;
  rateLimitBurst: number;
  antiBruteforceEnabled: boolean;
  antiBruteforceMax: number;
  antiBruteforceBanMins: number;
  updatedAt: string;
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
  hostname?: string;
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

export interface StorageMount {
  mountPoint: string;
  filesystem: string;
  fsType: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usagePercent: number;
  inodes: string;
}

export interface StorageDisk {
  name: string;
  size: string;
  type: string;
  model: string;
  mounted: string;
}

export interface SystemStorageResponse {
  mounts: StorageMount[];
  disks: StorageDisk[];
  smartSupported: boolean;
  smartMessage: string;
}

export interface NetInterface {
  name: string;
  state: string;
  mac: string;
  ipv4: string;
  ipv6: string;
  mtu: number;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  rxErrors: number;
  txErrors: number;
  rxDrops: number;
  txDrops: number;
}

export interface SocketPort {
  proto: string;
  port: number;
  localAddr: string;
  process: string;
  pid: number;
  status: string;
}

export interface SocketSummary {
  established: number;
  timeWait: number;
  closeWait: number;
  listen: number;
  total: number;
}

export interface SystemNetworkResponse {
  interfaces: NetInterface[];
  ports: SocketPort[];
  socketSummary: SocketSummary;
  gateway: string;
}

export interface SystemPingResponse {
  cloudflare: string;
  google: string;
  gateway: string;
  gatewayIp: string;
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
  /** Recorded, not applied: no engine here enforces a per-database memory limit. */
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
  clientPath?: string;
  daemon?: string;
  available: boolean;
  running: boolean;
  automated: boolean;
  mode: 'host' | 'docker' | 'none';
  note?: string;
  /** The version probed from the engine's own binary, when installed. */
  installedVersion?: string;
}

/** What the deploy wizard sends; the daemon validates every part of it. */
export interface CreateWebsitePayload {
  slug: string;
  domain: string;
  tenantUser: string;
  runtime: string;
  version?: string;
  framework?: string;
  frameworkVersion?: string;
  webServer: string;
  port?: number;
  upstreamUrl?: string;
  proxyWebsocket?: boolean;
  proxyPreserveHost?: boolean;
  proxyRealIp?: boolean;
  proxyTimeoutSecs?: number;
  tunnelEnabled?: boolean;
  source: { kind: string; repo?: string; branch?: string };
  database?: { engine: string; version?: string; name?: string; user?: string };
  cache?: { engine: string };
  autoEnv?: boolean;
  automationSteps?: string[];
  deployScript?: string;
  env?: Record<string, string>;
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
  /** Recorded, not applied: no engine here enforces a per-database memory limit. */
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
   * One key's shape: the type and TTL a cache browser needs, and a preview of the value. Read
   * through the panel's own connection and the record's prefix-scoped account.
   */
  key: (id: string, key: string) =>
    request<{ key: string; type?: string; ttl?: number; value?: string; note?: string }>(
      `${base}/${id}/key?key=${encodeURIComponent(key)}`,
    ),

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

/** One engine's own lockout numbers, and whether they are its own or the default's. */
export interface EngineNumbers {
  maxRetry: number;
  findTime: string;
  banTime: string;
  override: boolean;
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
  /** Every engine the lockout reads, with the numbers it would use for it. */
  engines: Record<string, EngineNumbers>;
}

export const api = {
  health: () => request<{ status: string; version: string; mode: string }>('/health'),

  /**
   * The brute-force lockout. The daemon decides with these numbers and keeps the addresses
   * out in an nftables set, so this is the panel's view of something that is really enforced.
   */
  guard: () => request<GuardStatus>('/system/guard'),

  /**
   * Save the lockout's numbers. `engine` targets one engine instead of the default, and `reset`
   * returns that engine to the default — the panel's Settings → Security is the only caller, because
   * a lockout a tenant could loosen is not a lockout.
   */
  saveGuardSettings: (settings: { enabled?: boolean; maxRetry?: number; findTime?: string; banTime?: string; engine?: string; reset?: boolean }) =>
    request<GuardStatus>('/system/guard', { method: 'PATCH', body: JSON.stringify(settings) }),

  /** Let one address back in. Audited by the daemon, against the address. */
  unban: (ip: string) =>
    request<GuardStatus>('/system/guard/unban', { method: 'POST', body: JSON.stringify({ ip }) }),

  /**
   * Panel-wide settings. `externalAddress` is the address an external client should use — the daemon
   * cannot detect it, so the operator sets it and every snippet prefers it.
   */
  /** The ports this host is actually listening on, measured rather than written into a screen. */
  systemPorts: () =>
    request<{
      panel: number;
      ssh: number;
      engines: Record<string, number>;
      sshPorts: number[];
      note: string;
    }>('/system/ports'),

  /**
   * Move the panel to another port: the daemon rewrites the flag its unit starts with and restarts
   * itself, so the page stops answering here and the panel is on the new port.
   */
  setPanelPort: (port: number) =>
    request<{ port: number; note: string }>('/system/ports/panel', {
      method: 'POST',
      body: JSON.stringify({ port }),
    }),

  /**
   * Change a port sshd listens on. Adding keeps the old one, so a mistake costs nothing; removing is
   * the deliberate second step, once the new port is known to answer.
   */
  setSSHPort: (port: number, remove = false) =>
    request<{ port: number; removed: boolean; note: string; ports: number[] }>('/system/ports/ssh', {
      method: 'POST',
      body: JSON.stringify({ port, remove }),
    }),

  panelSettings: () =>
    request<{ externalAddress: string; panelFqdn: string; useCloudflare: boolean; trustedAddresses: string[] }>('/system/settings'),

  savePanelSettings: (settings: { externalAddress?: string; panelFqdn?: string; useCloudflare?: boolean; trustedAddresses?: string[] }) =>
    request<{ externalAddress?: string; panelFqdn?: string; useCloudflare?: boolean; trustedAddresses?: string[] }>('/system/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),

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

  deleteWebsite: (slug: string, options?: { databases?: 'keep' | 'delete' }) =>
    request<{ slug: string; steps: string[]; mode: string }>(
      `/websites/${encodeURIComponent(slug)}${options?.databases ? `?databases=${options.databases}` : '?databases=keep'}`,
      { method: 'DELETE' },
    ),

  /** Re-run the pipeline from the source recorded at create time; also a 202 + job. */
  redeploy: (slug: string) =>
    request<{ slug: string; deployId: string; mode: string; status: string; totalSteps?: number }>(
      `/websites/${slug}/redeploy`,
      { method: 'POST' },
    ),

  /** Run a framework CLI command in the website directory (e.g. php artisan, manage.py). */
  execWebsiteCommand: (slug: string, command: string) =>
    request<{ ok: boolean; command: string; output: string; durationMs: number }>(
      `/websites/${slug}/exec`,
      { method: 'POST', body: JSON.stringify({ command }) },
    ),

  /** Get latest deploy job status and error info. */
  latestDeploy: (slug: string) => request<DeployJob>(`/websites/${slug}/deploy`),

  /** Git Ingress & Deploy Keys */
  websiteGitStatus: (slug: string) => request<ApiWebsiteGitStatus>(`/websites/${slug}/git`),
  websiteDeployKey: (slug: string) => request<ApiDeployKey>(`/websites/${slug}/git/deploy-key`),
  rotateWebsiteDeployKey: (slug: string) =>
    request<ApiDeployKey>(`/websites/${slug}/git/deploy-key/rotate`, { method: 'POST' }),
  updateWebsiteGit: (slug: string, payload: { repo?: string; branch?: string; autoDeploy?: boolean; deployScript?: string }) =>
    request<ApiWebsite>(`/websites/${slug}/git`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  /** Framework CI/CD Auto-Detection */
  detectWebsiteFramework: (slug: string) =>
    request<{ ok: boolean; framework?: DetectedFramework }>(`/websites/${slug}/detect-framework`),
  detectFrameworkFromArchive: (file: File) => {
    const form = new FormData();
    form.append('archive', file, file.name);
    return uploadForm<{ ok: boolean; framework?: DetectedFramework }>('/websites/detect-framework', form);
  },
  detectFrameworkFromExisting: (tenant: string, slug: string) =>
    request<{ ok: boolean; framework?: DetectedFramework }>('/websites/detect-framework', {
      method: 'POST',
      body: JSON.stringify({ tenant, slug }),
    }),

  /** Centralized & Per-Site Scheduled Tasks / Cron Jobs */
  cronJobs: (websiteSlug?: string) =>
    request<{ systemJobs: SystemCronJob[]; websiteJobs: ApiCronJob[] }>(
      `/cron/jobs${websiteSlug ? `?websiteSlug=${encodeURIComponent(websiteSlug)}` : ''}`,
    ),
  createCronJob: (payload: {
    websiteSlug: string;
    name: string;
    schedule: string;
    command: string;
    enabled?: boolean;
    timeoutSec?: number;
  }) =>
    request<ApiCronJob>('/cron/jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCronJob: (id: string, payload: Partial<ApiCronJob>) =>
    request<ApiCronJob>(`/cron/jobs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCronJob: (id: string) =>
    request<{ ok: boolean }>(`/cron/jobs/${id}`, { method: 'DELETE' }),
  runCronJob: (id: string) =>
    request<{ ok: boolean; status: string; output: string; durationMs: number; runAt: string }>(
      `/cron/jobs/${id}/run`,
      { method: 'POST' },
    ),

  /** User Git Providers */
  userGitProviders: () => request<{ items: UserGitProvider[] }>('/git/providers'),
  createUserGitProvider: (payload: {
    provider: string;
    name: string;
    apiUrl?: string;
    token?: string;
    username?: string;
  }) =>
    request<UserGitProvider>('/git/providers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteUserGitProvider: (id: string) =>
    request<{ ok: boolean }>(`/git/providers/${id}`, { method: 'DELETE' }),

  websiteAction: (slug: string, action: 'start' | 'stop' | 'restart') =>
    request<{ slug: string; action: string; status: string; mode: string }>(
      `/websites/${slug}/${action}`,
      { method: 'POST' },
    ),

  /** Domains & SSL API */
  domains: (websiteSlug?: string) =>
    request<{ items: ApiDomain[] }>(`/domains${websiteSlug ? `?websiteSlug=${encodeURIComponent(websiteSlug)}` : ''}`),

  addDomain: (payload: { websiteSlug: string; domain: string }) =>
    request<ApiDomain>('/domains', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteDomain: (id: string) =>
    request<{ status: string; id: string; domain: string }>(`/domains/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  issueSsl: (
    id: string,
    payload?: { provider?: string; forceHTTPS?: boolean; hsts?: boolean; email?: string }
  ) =>
    request<{
      status: string;
      provider: string;
      domain: string;
      issuer: string;
      expiresAt: string;
      daysLeft: number;
      forceHTTPS: boolean;
      hstsEnabled: boolean;
      warning?: string;
    }>(`/domains/${encodeURIComponent(id)}/ssl/issue`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  uploadCustomSsl: (
    id: string,
    payload: { certificate: string; privateKey: string; forceHTTPS?: boolean; hsts?: boolean }
  ) =>
    request<{
      status: string;
      provider: string;
      domain: string;
      issuer: string;
      expiresAt: string;
      daysLeft: number;
      forceHTTPS: boolean;
      hstsEnabled: boolean;
    }>(`/domains/${encodeURIComponent(id)}/ssl/custom`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleSsl: (
    id: string,
    payload: { forceHTTPS?: boolean; hsts?: boolean; autoRenew?: boolean }
  ) =>
    request<ApiDomain>(`/domains/${encodeURIComponent(id)}/ssl/toggle`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  websiteSecurity: (slug: string) =>
    request<ApiWebsiteSecurity>(`/websites/${encodeURIComponent(slug)}/security`),

  updateWebsiteSecurity: (
    slug: string,
    payload: Partial<ApiWebsiteSecurity> & { basicAuthPassword?: string }
  ) =>
    request<ApiWebsiteSecurity>(`/websites/${encodeURIComponent(slug)}/security`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggleMaintenance: (slug: string) =>
    request<{ maintenanceMode: boolean; security: ApiWebsiteSecurity }>(
      `/websites/${encodeURIComponent(slug)}/maintenance/toggle`,
      {
        method: 'POST',
      }
    ),

  toggleBasicAuth: (slug: string) =>
    request<{ basicAuthEnabled: boolean; security: ApiWebsiteSecurity }>(
      `/websites/${encodeURIComponent(slug)}/basic-auth/toggle`,
      {
        method: 'POST',
      }
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

  createGroup: (body: GroupPayload) =>
    request<GroupRow>('/groups', { method: 'POST', body: JSON.stringify(body) }),

  updateGroup: (name: string, body: Partial<GroupPayload>) =>
    request<GroupRow>(`/groups/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteGroup: (name: string) =>
    request<{ name: string; deleted: boolean }>(`/groups/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  /** Accounts: the package they belong to and the Linux account behind them. */
  users: () => request<{ items: ApiUser[]; mode: string }>('/users'),

  createUser: (body: CreateUserPayload) =>
    request<ApiUser>('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id: string, body: UpdateUserPayload) =>
    request<ApiUser>(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteUser: (id: string) =>
    request<{ username: string; deleted: boolean }>(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  resetUserPassword: (id: string, password?: string) =>
    request<{ username: string; password?: string; passwordShownOnce?: boolean; signedOutEverywhere: boolean }>(
      `/users/${encodeURIComponent(id)}/password`,
      { method: 'POST', body: JSON.stringify({ password }) },
    ),

  /** Create (or reconcile) the Linux account behind a panel account. */
  provisionUser: (id: string) =>
    request<{ user: ApiUser; linux: { mode: string; created?: boolean; home?: string; notes?: string[] } }>(
      `/users/${encodeURIComponent(id)}/provision`,
      { method: 'POST' },
    ),

  /** How a site is served: engine, whether it is installed, docroot and socket. */
  runtime: (slug: string) => request<SiteRuntime>(`/websites/${encodeURIComponent(slug)}/runtime`),

  updateRuntime: (slug: string, body: { engine?: string; version?: string }) =>
    request<SiteRuntime>(`/websites/${encodeURIComponent(slug)}/runtime`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  vhostPreview: (slug: string, engine?: string) =>
    request<{ engine: string; config: string }>(
      `/websites/${encodeURIComponent(slug)}/vhost/preview${engine ? `?engine=${encodeURIComponent(engine)}` : ''}`,
    ),

  /** Restart the site's PHP-FPM master (the pool reload). */
  reloadPhpFpm: (slug: string) =>
    request<{ status: string; mode: string; pool: string; output?: string }>(
      `/websites/${encodeURIComponent(slug)}/php-fpm/reload`,
      { method: 'POST' },
    ),

  /** Polyglot Runtime Configuration Studio: tuning directives and process supervision. */
  runtimeConfig: (slug: string) =>
    request<SiteRuntimeConfigResponse>(`/websites/${encodeURIComponent(slug)}/runtime/config`),

  updateRuntimeConfig: (slug: string, config: Record<string, any>) =>
    request<{ status: string; runtime: string; config: Record<string, any>; restarted?: boolean; mode?: string }>(
      `/websites/${encodeURIComponent(slug)}/runtime/config`,
      { method: 'PUT', body: JSON.stringify({ config }) },
    ),

  stack: (refresh?: boolean) => request<StackStatus>(refresh ? '/system/stack?refresh=true' : '/system/stack'),

  stackRepair: () =>
    request<{ ok: boolean; actions: string[]; message: string }>('/system/stack/repair', {
      method: 'POST',
    }),

  setStackWebServer: (engine: string) =>
    request<StackStatus>('/system/stack/web-server', { method: 'PUT', body: JSON.stringify({ engine }) }),

  installStackComponent: (component: string, version?: string) =>
    request<{ jobId: string; component: string; version: string; status: string; totalSteps: number; mode: string; stream: string }>(
      '/system/stack/install',
      { method: 'POST', body: JSON.stringify({ component, version }) },
    ),

  stackJob: (id: string, after?: number) =>
    request<{ job: StackJob; log: StackJobLogLine[] }>(
      `/system/stack/jobs/${encodeURIComponent(id)}${after ? `?after=${after}` : ''}`,
    ),

  stackJobStreamUrl: (id: string) => `${API_BASE}/system/stack/jobs/stream?id=${encodeURIComponent(id)}`,

  /** Dry run: what a switch or removal would do and what it touches. */
  stackPlan: (component: string, version?: string, action?: string) =>
    request<StackPlanResult>(
      `/system/stack/plan?component=${encodeURIComponent(component)}${version ? `&version=${encodeURIComponent(version)}` : ''}${action ? `&action=${encodeURIComponent(action)}` : ''}`,
    ),

  /** Uninstalls an installed version. The daemon refuses when a site or database uses it. */
  uninstallStackComponent: (component: string, version: string) =>
    request<{ jobId: string; component: string; version: string; status: string; totalSteps: number; mode: string; stream: string }>(
      '/system/stack/uninstall',
      { method: 'POST', body: JSON.stringify({ component, version }) },
    ),

  /** The PHP extensions this host really has for a version, and the switch that runs phpenmod/phpdismod. */
  phpExtensions: (version?: string) =>
    request<PhpExtensionReport>(`/system/php/extensions${version ? `?version=${encodeURIComponent(version)}` : ''}`),

  setPhpExtension: (version: string, name: string, enabled: boolean) =>
    request<PhpExtensionReport>('/system/php/extensions', {
      method: 'POST',
      body: JSON.stringify({ version, name, enabled }),
    }),

  /** Installs all missing repository extensions for a specific PHP version (or all installed versions if omitted). */
  installPhpExtensions: (version?: string) =>
    request<{ jobId: string; component: string; version: string; status: string; totalSteps: number; mode: string; stream: string }>(
      '/system/php/extensions/install',
      { method: 'POST', body: JSON.stringify({ version: version || 'all' }) },
    ),

  phpDefaults: () =>
    request<{ config: PhpDefaultsConfig; installedVersions: string[] }>('/system/settings/php-defaults'),

  savePhpDefaults: (config: PhpDefaultsConfig, applyToHost = false) =>
    request<{ success: boolean; config: PhpDefaultsConfig; installedVersions: string[] }>('/system/settings/php-defaults', {
      method: 'PUT',
      body: JSON.stringify({ config, applyToHost }),
    }),

  deployStreamUrl: (slug: string, deployId?: string) =>
    `${API_BASE}/websites/${slug}/deploy/stream${deployId ? `?id=${deployId}` : ''}`,

  // --- Cloudflare Tunnels (Zero-NAT) -----------------------------------------
  tunnelStatus: (user?: string) =>
    request<TunnelStatusResponse>(`/tunnels/status${user ? `?user=${encodeURIComponent(user)}` : ''}`),

  saveTunnelToken: (token: string, apiToken?: string, user?: string, tunnelName?: string) =>
    request<TunnelStatusResponse>('/tunnels/token', {
      method: 'POST',
      body: JSON.stringify({ token, apiToken, user, tunnelName }),
    }),

  syncTunnelRoutes: (user?: string) =>
    request<TunnelStatusResponse>(`/tunnels/sync${user ? `?user=${encodeURIComponent(user)}` : ''}`, {
      method: 'POST',
    }),

  restartTunnel: (user?: string) =>
    request<TunnelStatusResponse>(`/tunnels/restart${user ? `?user=${encodeURIComponent(user)}` : ''}`, {
      method: 'POST',
    }),

  addTunnelRoute: (hostname: string, service: string, appName?: string, noTLSVerify?: boolean, user?: string) =>
    request<IngressRouteDTO>('/tunnels/routes', {
      method: 'POST',
      body: JSON.stringify({ hostname, service, appName, noTLSVerify, user }),
    }),

  updateTunnelRoute: (id: string, hostname: string, service: string, appName?: string, noTLSVerify?: boolean, user?: string) =>
    request<IngressRouteDTO>(`/tunnels/routes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ hostname, service, appName, noTLSVerify, user }),
    }),

  tunnelZones: (user?: string) =>
    request<{ zones: CloudflareZone[]; error?: string }>(`/tunnels/zones${user ? `?user=${encodeURIComponent(user)}` : ''}`),

  // --- The panel's own hostname, published through the admin's Cloudflare Tunnel ----------
  panelTunnelStatus: () => request<PanelTunnelStatus>('/panel/tunnel'),

  publishPanelTunnel: (hostname: string) =>
    request<PanelTunnelStatus>('/panel/tunnel/publish', {
      method: 'POST',
      body: JSON.stringify({ hostname }),
    }),

  unpublishPanelTunnel: () =>
    request<PanelTunnelStatus>('/panel/tunnel/unpublish', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // --- metrics & host operations ------------------------------------------
  systemMetrics: (range = '1h') =>
    request<MetricSeries<HostMetrics>>(`/system/metrics?range=${encodeURIComponent(range)}`),

  systemProcesses: () =>
    request<{ items: any[]; total: number; checkedAt: string }>('/system/processes'),

  systemProcessKill: (pid: number, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') =>
    request<{ ok: boolean; pid: number }>(`/system/processes/${pid}/kill`, {
      method: 'POST',
      body: JSON.stringify({ signal }),
    }),

  systemServices: () =>
    request<{ items: any[]; total: number; checkedAt: string }>('/system/services'),

  systemServiceAction: (unit: string, action: 'start' | 'stop' | 'restart') =>
    request<{ ok: boolean; unit: string; action: string }>(`/system/services/${encodeURIComponent(unit)}/action`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),

  systemServiceLogs: (unit: string) =>
    request<{ unit: string; lines: string[]; total: number }>(`/system/services/${encodeURIComponent(unit)}/logs`),

  systemStorage: () =>
    request<SystemStorageResponse>('/system/storage'),

  systemNetwork: () =>
    request<SystemNetworkResponse>('/system/network'),

  systemPing: () =>
    request<SystemPingResponse>('/system/network/ping', { method: 'POST' }),

  siteMetrics: (slug: string, range = '1h') =>
    request<MetricSeries<SiteMetrics>>(`/websites/${slug}/metrics?range=${encodeURIComponent(range)}`),

  websiteTelemetry: (slug: string, limit = 300) =>
    request<ApiWebsiteTelemetry>(`/websites/${encodeURIComponent(slug)}/telemetry?limit=${limit}`),

  websiteTelemetryStreamUrl: (slug: string) =>
    `${API_BASE}/websites/${encodeURIComponent(slug)}/telemetry/stream`,

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

  compressFiles: (slug: string, paths: string[], destination?: string, format?: string) =>
    destination
      ? request<{ ok: boolean; path: string }>(`/websites/${slug}/files/compress`, {
          method: 'POST',
          body: JSON.stringify({ paths, destination, format }),
        })
      : request<Blob>(`/websites/${slug}/files/compress`, {
          method: 'POST',
          body: JSON.stringify({ paths }),
          raw: true,
        }),

  extractFiles: (slug: string, path: string, destination?: string) =>
    request<{ ok: boolean; destination: string; extracted: string[] }>(`/websites/${slug}/files/extract`, {
      method: 'POST',
      body: JSON.stringify({ path, destination }),
    }),

  uploadChunk: (slug: string, form: FormData) =>
    uploadForm<{ uploadId: string; chunkIndex?: number; completed: boolean; path?: string; extracted?: string[] }>(
      `/websites/${slug}/files/upload-chunk`,
      form,
    ),

  uploadChunkStatus: (slug: string, uploadId: string) =>
    request<{ uploadId: string; chunks: number[] }>(
      `/websites/${slug}/files/upload-chunk?uploadId=${encodeURIComponent(uploadId)}`,
    ),

  uploadUrl: (slug: string, path = '') =>
    `${API_BASE}/websites/${slug}/files/upload?path=${encodeURIComponent(path)}`,

  /** Multipart upload; the URL builder differs per family, the work does not. */
  uploadFiles: (slug: string, path: string, files: File[], autoExtract = false) =>
    uploadTo(`${api.uploadUrl(slug, path)}${autoExtract ? '&autoExtract=true' : ''}`, files),

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

    compress: (scope: FileScope, paths: string[], destination?: string, format?: string) =>
      destination
        ? request<{ ok: boolean; path: string }>(`/files/compress?${fileScopeQuery(scope)}`, {
            method: 'POST',
            body: JSON.stringify({ paths, destination, format }),
          })
        : request<Blob>(`/files/compress?${fileScopeQuery(scope)}`, {
            method: 'POST',
            body: JSON.stringify({ paths }),
            raw: true,
          }),

    extract: (scope: FileScope, path: string, destination?: string) =>
      request<{ ok: boolean; destination: string; extracted: string[] }>(`/files/extract?${fileScopeQuery(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ path, destination }),
      }),

    uploadChunk: (scope: FileScope, form: FormData) =>
      uploadForm<{ uploadId: string; chunkIndex?: number; completed: boolean; path?: string; extracted?: string[] }>(
        `/files/upload-chunk?${fileScopeQuery(scope)}`,
        form,
      ),

    uploadChunkStatus: (scope: FileScope, uploadId: string) =>
      request<{ uploadId: string; chunks: number[] }>(
        `/files/upload-chunk?${fileScopeQuery(scope)}&uploadId=${encodeURIComponent(uploadId)}`,
      ),

    uploadUrl: (scope: FileScope, path = '') => `${API_BASE}/files/upload?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`,

    uploadFiles: (scope: FileScope, path: string, files: File[], autoExtract = false) =>
      uploadTo(`${api.scopedFiles.uploadUrl(scope, path)}${autoExtract ? '&autoExtract=true' : ''}`, files),

    downloadUrl: (scope: FileScope, path: string) =>
      `${API_BASE}/files/download?${fileScopeQuery(scope)}&path=${encodeURIComponent(path)}`,
  },

  // --- terminal ------------------------------------------------------------
  /** One-time ticket for a WebSocket handshake (never a token in the URL). */
  wsTicket: () => request<{ ticket: string; expiresAt: string }>('/ws/ticket', { method: 'POST' }),

  /** WebSocket URL for a terminal; without a slug it is the host shell (admin only). */
  ptyUrl: (ticket: string, slug?: string) =>
    `${wsBase()}${slug ? `/websites/${slug}/pty` : '/system/pty'}?ticket=${encodeURIComponent(ticket)}`,

  // --- in-panel self-update ------------------------------------------------
  checkUpdates: () =>
    request<{
      currentVersion: string;
      rawVersion: string;
      latestVersion: string;
      hasUpdate: boolean;
      release?: {
        tag: string;
        version: string;
        publishedAt: string;
        releaseNotesUrl: string;
        changelogMarkdown: string;
        asset?: {
          arch: string;
          sha256: string;
          sizeBytes: number;
          filename: string;
        };
      };
    }>('/system/updates/check'),

  applyUpdate: (targetVersion: string, channel = 'stable') =>
    request<{ jobId: string; status: string; streamUrl: string }>('/system/updates/apply', {
      method: 'POST',
      body: JSON.stringify({ targetVersion, channel }),
    }),

  updatesStreamUrl: (jobId: string) => `${API_BASE}/system/updates/stream?jobId=${encodeURIComponent(jobId)}`,
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
  onError?: (err: Event) => void,
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

  source.onerror = (err) => {
    onError?.(err);
    if (source.readyState === EventSource.CLOSED) {
      source.close();
    }
  };

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
  files.forEach((file) => {
    const rel = (file as any).webkitRelativePath || (file as any).relativePath || file.name;
    form.append('files', file, rel);
  });
  return uploadForm<{ uploaded: string[] }>(url, form);
}

export interface ResumableUploadOptions {
  uploadId?: string;
  file: File;
  targetDir: string;
  autoExtract?: boolean;
  uploadChunkFn: (form: FormData) => Promise<{ completed: boolean; path?: string; extracted?: string[] }>;
  uploadStatusFn: (uploadId: string) => Promise<{ chunks: number[] }>;
  chunkSize?: number; // default 2MB
  onProgress?: (info: {
    bytesUploaded: number;
    totalBytes: number;
    percent: number;
    speedBytesPerSec: number;
  }) => void;
  signal?: AbortSignal;
}

export async function uploadFileResumable(options: ResumableUploadOptions): Promise<{ path?: string; extracted?: string[] }> {
  const {
    file,
    targetDir,
    autoExtract = false,
    uploadChunkFn,
    uploadStatusFn,
    chunkSize = 2 * 1024 * 1024,
    onProgress,
    signal,
  } = options;

  const uploadId = options.uploadId || `up_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

  // Check which chunks already exist for resumption
  let completedChunks = new Set<number>();
  try {
    const status = await uploadStatusFn(uploadId);
    if (status && Array.isArray(status.chunks)) {
      completedChunks = new Set(status.chunks);
    }
  } catch {
    // Brand new upload or status check not yet available
  }

  let bytesUploaded = 0;
  completedChunks.forEach((idx) => {
    const chunkStart = idx * chunkSize;
    const chunkEnd = Math.min(file.size, (idx + 1) * chunkSize);
    bytesUploaded += Math.max(0, chunkEnd - chunkStart);
  });

  let startTime = Date.now();
  let uploadedSinceStart = 0;

  let finalResult: { path?: string; extracted?: string[] } = {};

  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      throw new DOMException('Upload aborted', 'AbortError');
    }

    if (completedChunks.has(i)) {
      continue;
    }

    const start = i * chunkSize;
    const end = Math.min(file.size, (i + 1) * chunkSize);
    const chunkBlob = file.slice(start, end);

    const form = new FormData();
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    const rel = (file as any).webkitRelativePath || (file as any).relativePath || file.name;
    form.append('filename', rel);
    form.append('path', targetDir || '');
    if (autoExtract) {
      form.append('autoExtract', 'true');
    }
    form.append('chunk', chunkBlob, file.name);

    const chunkStartTime = Date.now();
    const res = await uploadChunkFn(form);
    const chunkDuration = (Date.now() - chunkStartTime) / 1000;

    bytesUploaded += chunkBlob.size;
    uploadedSinceStart += chunkBlob.size;
    const totalElapsed = (Date.now() - startTime) / 1000;
    const speedBytesPerSec = totalElapsed > 0 ? uploadedSinceStart / totalElapsed : 0;

    if (onProgress) {
      const percent = Math.min(100, Math.round((bytesUploaded / Math.max(1, file.size)) * 100));
      onProgress({
        bytesUploaded,
        totalBytes: file.size,
        percent,
        speedBytesPerSec,
      });
    }

    if (res.completed) {
      finalResult = { path: res.path, extracted: res.extracted };
    }
  }

  return finalResult;
}

async function uploadForm<T>(url: string, form: FormData): Promise<T> {
  const headers = new Headers();
  if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const targetUrl = url.startsWith('http') ? url : `/api/v1${url.startsWith('/') ? url : `/${url}`}`;
  const response = await fetch(targetUrl, { method: 'POST', body: form, headers, credentials: 'include' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      if (payload?.error?.message) message = payload.error.message;
    } catch {
      // keep generic message
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
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

/** A package's resource limits, as the API reports them (0 = unlimited). */
export interface GroupLimits {
  cpuQuotaPercent: number;
  memoryMb: number;
  tasksMax: number;
  diskQuotaGb: number;
  inodeQuota: number;
  maxSites: number;
  maxDatabases: number;
}

export interface GroupPayload {
  name: string;
  description?: string;
  permissions?: Record<string, boolean>;
  limits?: Partial<GroupLimits>;
}

/** One account, as the Tenants screen needs it. */
export interface ApiUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  groupName: string;
  status: 'active' | 'suspended';
  createdAt: string;
  home: string;
  osExists: boolean;
  sites: { used: number; max: number };
  databases: { used: number; max: number };
  /** Measured disk use against the package allowance (maxBytes 0 = unlimited). */
  disk?: { usedBytes: number; maxBytes: number };
  /** Present only on the create/reset response, and shown once. */
  password?: string;
  passwordShownOnce?: boolean;
}

export interface CreateUserPayload {
  username: string;
  email?: string;
  password?: string;
  groupName: string;
}

export interface UpdateUserPayload {
  email?: string;
  groupName?: string;
  status?: 'active' | 'suspended';
}

/** How a website is served (GET /websites/:slug/runtime). */
export interface SiteRuntime {
  runtime: string;
  version: string;
  availableVersions?: string[];
  webServer: string;
  siteEngine?: string;
  engine: string;
  engineSupported: boolean;
  engineInstalled: boolean;
  docRoot: string;
  port: number;
  vhostPath: string;
  socket?: string;
  mode: string;
}

export interface ApiTelemetryNode {
  country: string;
  countryName: string;
  flag: string;
  city: string;
  ip: string;
  isp: string;
  x: number;
  y: number;
  reqs: number;
  percentage: number;
  latency: string;
  isThreat: boolean;
}

export interface ApiTelemetryLogItem {
  time: string;
  type: 'access' | 'error';
  ip?: string;
  country?: string;
  isp?: string;
  method?: string;
  path?: string;
  status?: number;
  latency?: string;
  size?: string;
  userAgent?: string;
  msg: string;
  rawLine?: string;
}

export interface ApiWebsiteTelemetry {
  slug: string;
  domain: string;
  webServer: string;
  logPath: string;
  totalRequests: number;
  uniqueIps: number;
  threatCount: number;
  nodes: ApiTelemetryNode[];
  logs: ApiTelemetryLogItem[];
  updatedAt: string;
}

/** One web server's real state (the Stack screen). */
export interface StackWebServerStatus {
  engine: string;
  installed: boolean;
  version?: string;
  running: boolean;
}

/** One installable component the daemon offers. */
export interface StackComponent {
  name: string;
  label: string;
  kind: 'web' | 'runtime' | 'database' | 'repo';
  versions?: string[];
  description: string;
}

/** One language's versions on the host: probed installed + what its repositories offer. */
export interface RuntimeStatus {
  installed: string[];
  available: string[];
  /** The short list to draw first; available keeps everything for a project that pins one. */
  supported: string[];
  /** The newest version the host can install. */
  latest?: string;
  /** True when that newest version is already installed (a Rust channel is resolved by the daemon). */
  upToDate: boolean;
  /** Names a version the number alone does not describe: for Node, "current" or "LTS Jod". */
  labels?: Record<string, string>;
  /** True when the version matters per site (interpreted), false for a build toolchain. */
  perSite: boolean;
  source?: string;
}

export interface PhpDefaultsConfig {
  memoryLimit: string;
  uploadMaxSize: string;
  postMaxSize: string;
  maxExecutionTime: number;
  maxInputTime: number;
  maxInputVars: number;
  opcacheEnable: boolean;
  opcacheMemoryConsumption: number;
  opcacheMaxAcceleratedFiles: number;
  opcacheValidateTimestamps: boolean;
  opcacheRevalidateFreq: number;
  recommendedExtensions: string[];
}

/** What a PHP version really has on this host: the mods it can toggle and what its
 *  repositories still offer. */
export interface PhpExtensionReport {
  version: string;
  extensions: { name: string; enabled: boolean }[];
  installable: string[];
}

export interface SiteRuntimeConfigResponse {
  runtime: string;
  version: string;
  config: {
    // PHP
    memoryLimit?: string;
    uploadMaxSize?: string;
    postMaxSize?: string;
    maxExecutionTime?: number;
    maxInputVars?: number;
    maxInputTime?: number;
    maxChildren?: number;
    processIdleTimeout?: string;
    extensions?: Array<{ name: string; enabled: boolean; description?: string; installed?: boolean }>;
    installable?: string[];
    installedVersions?: string[];

    // Node.js
    packageManager?: string;
    script?: string;
    startScript?: string;
    entrypoint?: string;
    memoryLimitMb?: number;
    detectedScripts?: string[];

    // Python
    wsgiServer?: string;
    runner?: string;
    workers?: number;
    threads?: number;
    timeout?: number;
    venvExists?: boolean;
    venvPath?: string;

    // Ruby
    appServer?: string;

    // Go / Rust
    binaryPath?: string;
    args?: string;
    port?: number;

    // Static
    spaFallback?: boolean;
    docRoot?: string;

    [key: string]: any;
  };
  limits?: {
    memoryMb: number;
    cpuQuotaPercent: number;
    tasksMax: number;
  };
}

export interface StackStatus {
  /** The install in progress, if any: an install holds the queue one at a time. */
  installRunning?: string;
  /** The ID of the currently running install job, if any. */
  activeJobId?: string;
  /** The sources the panel adds (Sury, deadsnakes, rbenv, rustup) and whether they are here. */
  repositories?: { name: string; label: string; present: boolean; group: string; path?: string }[];
  /** What each engine's repositories carry, and the newest of them. */
  databaseAvailable?: Record<string, string[]>;
  databaseLatest?: Record<string, string>;
  webServer: {
    active: string;
    supported: string[];
    installed: StackWebServerStatus[];
    /** What each engine's own repository carries, and the newest of them. */
    available?: Record<string, string[]>;
    latest?: Record<string, string>;
    /** Every web server the panel keeps versions for (the ingress is only nginx/caddy). */
    managed?: string[];
    managedInstalled?: StackWebServerStatus[];
    webUser: string;
    vhostsPath: string;
  };
  components: StackComponent[];
  databases: DbEngineRow[];
  /** The version chosen for each engine (what an install recorded). */
  databaseVersions: Record<string, string>;
  /** All versions installed locally on the host for each engine. */
  databaseInstalled?: Record<string, string[]>;
  /** Each language's versions: installed (probed) and available (from its repositories). */
  runtimes: Record<string, RuntimeStatus>;
  php: { installed: string[]; default: string };
  node: { installed: string[]; default: string };
  mode: string;
}

/** One line of an install job's log. */
export interface StackJobLogLine {
  id: number;
  jobId: string;
  ts: string;
  stream: string;
  line: string;
}

export interface StackJob {
  id: string;
  status: string;
  error?: string;
  currentStep?: string;
  totalSteps: number;
  mode: string;
}

/** The dry run returned by GET /system/stack/plan. */
export interface StackPlanResult {
  component: string;
  version: string;
  installed: string;
  steps: string[];
  uses: string[];
  warnings: string[];
  safeToRun: boolean;
  mode: string;
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

export interface IngressRouteDTO {
  id: string;
  hostname: string;
  service: string;
  appName: string;
  status: string;
  createdAt?: string;
}

export interface TunnelStatusResponse {
  tenantUser: string;
  tunnelName: string;
  hasToken: boolean;
  tokenMasked: string;
  hasApiToken: boolean;
  apiTokenMasked: string;
  accountId: string;
  tunnelId: string;
  autoSync: boolean;
  status: 'connected' | 'disconnected' | 'configuring';
  daemonPid: number;
  memoryUsage: string;
  uptime: string;
  routes: IngressRouteDTO[];
  availableApps: Array<{
    slug: string;
    domain: string;
    port: number;
    status: string;
    webServer: string;
    runtime: string;
    targetUrl: string;
  }>;
  accounts?: string[];
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export interface PanelTunnelStatus {
  configured: boolean;
  fqdn: string;
  service: string;
  accountId: string;
  tunnelId: string;
}


