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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken && method !== 'GET' && method !== 'HEAD') headers.set('X-CSRF-Token', csrfToken);

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });

  let payload: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string }; fields?: Record<string, string> } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error?.code,
      body?.fields,
    );
  }
  return payload as T;
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

  me: () => request<{ user: PanelUser; csrfToken: string; elevated: boolean }>('/auth/me'),

  websites: () => request<{ items: ApiWebsite[] }>('/websites'),

  website: (slug: string) => request<ApiWebsite>(`/websites/${slug}`),

  prepareDirectory: (body: { slug: string; tenantUser: string }) =>
    request<PrepareDirectoryResult>('/websites/prepare-directory', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deployStreamUrl: (slug: string, deployId?: string) =>
    `${API_BASE}/websites/${slug}/deploy/stream${deployId ? `?id=${deployId}` : ''}`,
};

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

/**
 * Subscribe to a deploy job's log over SSE.
 *
 * `EventSource` cannot send custom headers, but `withCredentials: true` does send
 * the session cookie — and CSRF is not required for GET — so the stream is
 * authenticated without putting a token in the URL. The returned function closes it.
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
      // Ignore a malformed frame rather than killing the stream.
    }
  });

  source.addEventListener('done', (event) => {
    try {
      onDone?.(JSON.parse((event as MessageEvent).data) as DeployJob);
    } catch {
      // The final status frame may be unreadable; the job can still be polled.
    }
    source.close();
  });

  // EventSource reconnects on its own; the daemon replays the stored log, so a
  // dropped connection loses nothing. Close only when the caller asks.
  return () => source.close();
}
