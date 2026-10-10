# BarePod Panel — API Contract (Draft v0.1)

> Blueprint for the contract between the **frontend (React, Phase 1)** and the **Go backend daemon (Phase 2)**.
> Goal: the backend can follow the response shapes defined here without requiring UI changes.
> Status: **draft** — no backend implementation yet.

---

## 1. Conventions

- **Base path:** `/api/v1`
- **Format:** JSON (`application/json`), UTF-8.
- **Auth:** `Authorization: Bearer <JWT>` (except `POST /auth/login` and GitHub webhooks).
- **Tenant scope:** endpoints under `/websites/:slug/...` are automatically restricted to the owning tenant.
- **Error shape:**
  ```json
  { "error": { "code": "not_found", "message": "Website not found" } }
  ```
- **Pagination:** `?page=1&per_page=50` → `{ "items": [...], "page": 1, "per_page": 50, "total": 123 }`.
- **Time:** all timestamps are **RFC3339 UTC** (e.g. `2026-10-10T16:40:12Z`).
- **Metrics:** send **raw numbers** (`memoryBytes`, `cpuPercent`), never formatted strings. Formatting (`"42 MB"`, `"0.3%"`) happens in the frontend.
- **IDs:** internal primary keys are **ULID** (time-sortable and immutable) — never the user-visible name. Websites are addressable by **slug** (URL-friendly) *or* `id`; if a website is renamed, the slug changes and the old slug is kept as a redirect alias so bookmarks and webhooks keep working. Other resources (`/databases/:id`, `/pods/:id`, …) use `id`.
- **Webhook (public):** `POST /api/v1/webhook/:slug/deploy?token=<deployHookToken>` (no JWT).
- **Errors:** `{ "error": { "code": "...", "message": "..." } }`, plus a `fields` map on validation failures. Codes: `bad_request`, `validation_error` (+`fields`), `unauthenticated`, `invalid_credentials`, `suspended`, `csrf`, `elevation_required` (reveal/rotate needs the 5-minute sudo mode), `capability_required` (group lacks the permission), `insufficient_capacity` (the packages exceed the server), `forbidden`, `not_found`, `slug_taken`, `directory_missing`, `service_error`, `internal`.
- **Tenant scoping:** collection endpoints return only the caller's own resources; `GET /:id` on someone else's resource is `404`, not `403` (it must not confirm existence). Only role `admin` sees every tenant.

---

## 2. WebSocket Channels

Single endpoint, multiple channels: `wss://<host>/api/v1/ws` (authenticate with the short-lived one-time ticket from `POST /ws/ticket`, sent via `Sec-WebSocket-Protocol` — never in the URL).

| Channel | Direction | Payload |
|---|---|---|
| `deploy-log` | server→client | `{ slug, line, stream: "stdout"\|"stderr", ts }` |
| `migration-progress` | server→client | `{ jobId, step, totalSteps, line, ts }` |
| `restore-progress` | server→client | `{ jobId, percent, line }` |
| `system-metrics` | server→client | `{ ts, cpuPercent, memUsedBytes, memTotalBytes, netRxBps, netTxBps, diskReadBps, diskWriteBps }` |
| `smart-test` | server→client | `{ device, percent, done }` |
| `pod-logs` | server→client | `{ podId, line }` |
| `site-log-stream` | server→client | access/error log line (Traffic Map & console) |

> **PTY is NOT multiplexed.** Terminal sessions use their own dedicated binary WebSocket endpoints (`WS /websites/:slug/pty`, `WS /system/pty`) because they stream raw ANSI frames — mixing that into a JSON channel adds parsing overhead and input lag.
> **One-way streams may use SSE.** `deploy-log`, `pod-logs` and `migration-progress` are server→client only; expose them as Server-Sent Events (`GET /websites/:slug/deploy/stream`, …) — plain HTTP, built-in browser reconnect, and more resilient to proxy/CDN timeouts (Cloudflare/Nginx) than WebSocket. Use the multiplexed `WS /api/v1/ws` for the remaining live channels.
> **Auth:** never pass a token in the URL; `POST /api/v1/ws/ticket` returns a short-lived one-time ticket used for the handshake.

---

## 3. Data Model Changes the Backend Must Satisfy

This is the main rework risk — the UI currently stores some values as presentational strings.

| Current UI field | Target contract |
|---|---|
| `Website.memoryUsage: "42 MB"` | `metrics: { rssBytes: number, limitBytes: number }` |
| `Website.cpuUsage: "0.3%"` | `cpuPercent: number` |
| `createdAt: "Just now"` / `"2026-10-10"` | `createdAt: string (RFC3339)` |
| `lastDeployedAt: "2026-10-10 16:40:12"` | `lastDeployedAt: string (RFC3339)` |
| `DatabaseItem.size: "142 MB"` | `sizeBytes: number` |
| `DatabaseItem.host/port` (SQLite) | `null` — SQLite is a file, only `path` applies |
| `PodItem.ports: "5678:5678"` | `ports: Array<{ host: number, container: number }>` |
| `PodItem.cpu/memory: "0.4%" / "48 MB"` | `cpuPercent: number`, `memoryBytes: number` |
| `UserGroup.diskLimit: "10 GB"` | `diskLimitBytes: number \| null` |
| `TenantUser.diskUsage: "1.4 GB"` | `diskUsageBytes: number` |
| `Domain.sslExpiry: "2026-12-10 (60 days left)"` | `sslExpiresAt: string (RFC3339)` |
| `FileEntry.size: "420 B"` | `sizeBytes: number` |
| `log.latency: "14ms"` | `latencyMs: number` |
| Deploy/migration logs (textarea) | `deploy-log` / `migration-progress` WS stream |

**Entities that need a canonical backend schema** (currently local mock state inside components):
`Website`, `DatabaseItem`, `PodItem`, `UserGroup`, `TenantUser`, `UserTunnel`, `DomainRecord`, `FileEntry`, `ProcessItem`, `ServiceItem`, `LogEntry`, `BackupSnapshot`, `PanelSettings`, `LiveMetrics`, `ApiToken`.

**Hardcoded values that must move to the API:** tenant identity (the signed-in account, never a name baked into the UI), public IP, path `/home/<tenant>/apps/<site>`, systemd unit names (`php8.4-fpm`, `gunicorn-*`, …), per-version DB ports.

> **Terminology:** the UI calls these entities **"Websites"** (previously "Apps"). The API path is `/websites`; `WebApp` in the frontend types is the same entity.

---

## 4. Endpoints by Module

### 4.1 Auth, Profile & Session
- `POST /auth/login` → `{ token, user }`
- `POST /auth/logout`
- `GET /auth/me` → `{ user, role, group, permissions }`
- `POST /auth/verify` (re-auth for revealing DB passwords / sensitive actions)
- `POST /auth/2fa/enable` · `POST /auth/2fa/verify`
- `GET|PATCH /profile` (identity: username, email, group)
- `POST /profile/password` (change the panel password)
- `GET /sessions` · `DELETE /sessions/:id` (active sessions, revoke)

### 4.2 Websites
- `GET /websites` · `POST /websites` · `GET|PATCH|DELETE /websites/:slug`
- `POST /websites` — deploy payload from the wizard:
  ```json
  {
    "name": "example-shop",
    "domain": "shop.example.com",
    "tenantUser": "admin",
    "webServer": "openlitespeed",
    "runtime": "php", "version": "8.4", "framework": "Laravel 12",
    "source": { "kind": "scaffold" },
    "git": { "repo": null, "branch": null, "autoDeploy": false },
    "database": { "provision": true, "engine": "postgres", "version": "PostgreSQL 16.4",
                  "name": "shop_db", "user": "admin_shop_db", "password": "…",
                  "maxConnections": 25 },
    "cache": { "provision": true, "engine": "redis", "version": "Redis 7.2.4", "password": "…" },
    "autoEnv": true,
    "automationSteps": ["composer install …", "php artisan migrate --force"]
  }
  ```
  `source.kind` ∈ `scaffold | github | upload | existing`. For `upload` the archive is sent to `POST /websites/:slug/files/upload`; for `existing` the directory must exist **and not be empty** (the daemon returns `409` otherwise, and the job fails with an actionable message).
- **`POST /websites/prepare-directory`** `{ slug, tenantUser }` → `201 { slug, tenantUser, path, created, existed, mode }`. **Tenants have no shell on the server**, so this is how "Existing Files" is reachable from the panel: create the folder here → upload the code with the File Manager → deploy. Idempotent; also gated on `deployApps` and restricted to the caller's own tenant.
- **`POST /websites` returns `202 Accepted`** with `{ slug, deployId, mode, status, totalSteps, stream }` — provisioning runs asynchronously. `mode` is `real` on Linux+systemd and `dry-run` everywhere else; **in dry-run nothing is started and the website stays `stopped`** (units and `.env` are still written, and the recorded commands are logged).
- **`GET /websites/:slug/deploy`** → the latest job · **`GET /websites/:slug/deploy/:id?after=<logId>`** → `{ job, log[] }` (safe polling) · **`GET /websites/:slug/deploy/stream?id=`** → **SSE** `event: log` frames, closed by `event: done` with the final job. Every line is persisted, so a reconnect loses nothing.
- The website model carries **`deployStatus`**: `pending | building | ready | failed`.
- **Failure & rollback:** if a step fails, the deploy stops, `deployStatus` becomes `failed`, and the failure is reported on the stream. Partial resources are **kept** (so the log can be inspected and the deploy retried) but are marked as unlinked: a failed database/cache is created in the Recycle Bin rather than dropped, and `POST /websites/:slug/redeploy` retries from the failed step. A website that never reached `ready` can be deleted without leaving orphans.
- `POST /websites/:slug/start|stop|restart`
- `GET /websites/:slug/metrics?range=` · `GET /websites/:slug/logs?range=`
- `PUT /websites/:slug/maintenance` · `PUT /websites/:slug/basic-auth` · `PUT /websites/:slug/anti-bruteforce`
- `GET|POST|DELETE /websites/:slug/routes` (multi-engine path routing)
- `GET|PUT /websites/:slug/env`
- `POST /websites/:slug/backup` (export per-website `.bpod`)

### 4.2.1 Accounts, Groups & Permissions (per account)
- **No built-in account.** The operator creates the root admin during installation with the CLI: `barepod admin create` (generated password shown once). The daemon refuses to start while no account exists.
- **The only built-in data is three permission groups**, created on first run: `Superadmin (Root)`, `Developer`, `Read Only`. `users.group_name` is the membership.
- `GET /groups` → `{ items: [{ id, name, description, permissions{10 capabilities}, members, isDefault, isSystem }], capabilities: [...] }` (requires the `users` capability). `POST|PATCH|DELETE /groups` and member management land with the users module; system groups cannot be deleted.
- Capabilities: `deployApps`, `fileManager`, `terminal`, `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`, `apiTokens`. `GET /auth/me` returns the caller's **effective permissions**, resolved from the group.
- **Enforcement is per account, never global:** a route whose capability is missing returns `403 { code: "capability_required" }`, and resource routes are scoped to the caller's own resources (another tenant's object returns `404`, even when the capability is granted). **Admins are the single exception** — they see and manage every tenant.
- **Backup, migration and every future module follow the same rule:** capability from the group + ownership of the resource; `Read Only` may view dashboards/metrics/logs and start nothing.
- **A group is also the tenant package (resource limits).** Each group carries per-member limits — `cpuQuotaPercent`, `memoryMb`, `tasksMax`, `diskQuotaGb`, `inodeQuota`, `maxSites`, `maxDatabases` (`0` = unlimited). They are applied to the website's systemd drop-in (`MemoryMax`, `CPUQuota`, `TasksMax` — cgroup v2) and to the tenant's disk quota (`setquota`); `maxSites` is enforced when creating a website.
- `PATCH /groups/:name` `{ description?, permissions?, limits? }` → the updated group. A plan whose total (limits × members, summed over every package) exceeds the host is refused with `409 {"error":{"code":"insufficient_capacity","message":"the packages exceed this server: memory: allocated 65536 of 16384 available (400%)"}}` plus `capacity` and `usage`.
- `GET /system/capacity` → `{ capacity, allocation, usage{cpu,ram,disk}, fits, exceeds[], suggested, packages[], checkedAt }`. Capacity is read **live** — cgroup v2 `cpu.max`, `/sys/devices/system/cpu/online`, `/proc/meminfo`, `statfs` of the sites filesystem — so scaling the server up or down changes the answer **without restarting the daemon**. After a scale-down `fits` becomes `false`, `exceeds` names each resource with its numbers, and the daemon logs + audits `system.capacity_exceeded` once per change.
- **Pods reuse the same `Limits` model** as their Docker resource spec (Phase 3): one model, three consumers.

### 4.3 Runtime, VHost & PHP
- `GET|PUT /websites/:slug/runtime` (engine: openlitespeed/nginx/caddy/apache, version)
- `GET /websites/:slug/vhost/preview?engine=` → `{ config: string }`
- `GET|PUT /websites/:slug/php/extensions` · `POST .../php/extensions/install` (PECL)
- `GET|PUT /websites/:slug/php/ini` · `POST /websites/:slug/php-fpm/reload`

### 4.4 File Manager
- `GET /websites/:slug/files?path=` → `FileEntry[]`
- `GET /websites/:slug/files/content?path=` · `PUT /websites/:slug/files/content`
- `POST /websites/:slug/files` (new) · `mkdir` · `rename` · `copy` · `move` · `delete`
- `POST /websites/:slug/files/upload` · `GET /websites/:slug/files/download?path=`
- `POST /websites/:slug/files/compress` (batch `.zip`)

> **Path safety:** every `path` parameter is **relative to the site root** (`/home/<tenant>/apps/<site>`). The daemon must resolve it (`filepath.Clean` + `EvalSymlinks`), then reject anything that does not satisfy `strings.HasPrefix(resolved, siteRoot)`. File operations run **as the tenant UID/GID** (fork worker + `setresuid`/`setresgid`), so the kernel enforces ownership on top of the prefix check. Symlinks pointing outside the site root are refused.

### 4.5 Terminal
- `WS /websites/:slug/pty` — tenant shell (auto runtime switch)
- `WS /system/pty` — host root shell (**admin only**)

### 4.6 Databases, Caches & SSO
- `GET|POST /databases` · `GET|PATCH|DELETE /databases/:id`
- `POST /databases/:id/max-connections`
- `POST /databases/:id/rotate-password` → `{ password }` (random when the body is empty, or a custom one; min. 12 chars)
- `POST /databases/:id/reveal` (panel password) · `GET /databases/:id/connection-string`
- `GET /databases/:id/tables` · `POST /databases/:id/query`
- `POST /databases/:id/export` (`.sql`, or a `.sqlite` file copy for SQLite)
- `GET /databases/:id/gui?tool=pgadmin|phpmyadmin|dbgate|mongoexpress|rediscommander` → `{ ssoUrl }`
- **Caches (Redis) are a separate resource:** `GET|POST /caches` · `GET|PATCH|DELETE /caches/:id` · `POST /caches/:id/rotate-password`
- `GET /db-engines` (versions + shared-daemon ports; SQLite reports `fileBased: true`, `port: null`)
- **SQLite is file-based:** `host`/`port`/`username`/`password`/`maxConnections` are `null`; the record carries a `path` (e.g. `/home/<tenant>/apps/<site>/<name>.sqlite`) and has no SSO web GUI.
- **Recycle Bin (soft delete) — `DELETE` never drops immediately:**
  - `DELETE /databases/:id` → sets `deletedAt` and **suspends** the database: existing connections are refused, grants are revoked and the app route is withdrawn. The data is retained.
  - `GET /databases/recycle-bin` (or `GET /databases?bin=true`) → binned items with `deletedAt`.
  - `POST /databases/:id/restore` → clears `deletedAt`, re-enables connections and re-grants access.
  - `POST /databases/:id/purge` (or `DELETE /databases/:id?permanent=true`) → drops the database and its data permanently.
  - `DELETE /databases/recycle-bin` → empties the bin (purges all binned items).
  - Retention: `retentionDays` (default **30**) lives in settings; a daily cron purges expired items.
  - Implementation note: for daemon engines "suspend" means refuse connections (e.g. PostgreSQL `ALLOW_CONNECTIONS false` after renaming; MySQL/MariaDB revoke + rename); for SQLite the file is moved/renamed. MongoDB/Redis use a suspended namespace. Restore reverses the same operation; purge is the only destructive step.

### 4.7 Cloudflare Tunnels
- `GET|POST /tunnels` · `DELETE /tunnels/:id` · `POST /tunnels/:id/token` · `POST /tunnels/:id/restart`
- `POST|DELETE /tunnels/:id/routes`

### 4.8 Domains & SSL
- `GET /domains` · `POST /domains/:id/renew-ssl` · `GET /domains/:id/ssl`

### 4.9 Users, Groups & RBAC
- `GET|POST /users` · `PATCH|DELETE /users/:id`
- `GET|POST /groups` · `PATCH|DELETE /groups/:id`
- `GroupPermissions` (10 capabilities): `deployApps`, `fileManager`, `terminal`, `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`, `apiTokens`.
- `GET /permissions` → capability catalog (key, label, description) for UI rendering.

### 4.10 System Monitoring
- `GET /system/metrics?range=` + `WS: system-metrics`
- `GET /system/processes` · `POST /system/processes/:pid/kill` (SIGTERM/SIGKILL)
- `GET /system/services` · `POST /system/services/:unit/{start,stop,restart,reload}` · `GET /system/services/:unit/logs` (journald)
- `GET /system/disks` · `POST /system/disks/:dev/smart-test` (+ `WS: smart-test`)
- `GET /system/network/interfaces` · `POST /system/network/ping` · `GET /system/sockets` (`ss -tulpn`)
- `GET /system/capabilities` → `{ smart: bool, fstrim: bool, docker: bool, lxc: bool }` (**important for LXC**: the UI shows "unavailable" instead of an error)

### 4.11 Backup & Migration
- `GET|POST /backups` · `GET /backups/:id/download` · `POST /backups/:id/restore`
- `POST /backups/restore-upload` (drag & drop `.bpod`)
- `POST /migrations/handshake` · `POST /migrations/start` (+ `WS: migration-progress`)
- `GET /migrations/source-token` (2-hour TTL)
- `GET|PUT /backups/cloud-sync` (R2/S3/GCS/Wasabi, cron, retention) · `POST /backups/cloud-sync/test`

### 4.12 System Cleanup & Panel Settings
- `GET|PUT /settings/:tab` (general, monitoring, security, proxy, backups, notifications, databases, php_defaults, maintenance)
- `POST /settings/prune` (system junk + docker, per option) → `{ reclaimedBytes }`
- `GET|PUT /settings/cron-jobs` (recommended default cron jobs + enable/disable)
- `POST /settings/backup-now` · `POST /system/daemon/restart`

### 4.13 Docker Pods
- `GET|POST /pods` (image / dockerfile / compose) · `GET|PATCH|DELETE /pods/:id`
- `POST /pods/:id/start|stop|restart` · `GET /pods/:id/logs` (+ `WS: pod-logs`) · `GET /pods/:id/compose`

---

## 5. Screen → Endpoint Mapping (key examples)

| UI screen (route) | Primary endpoints |
|---|---|
| `/websites` | `GET /websites` |
| `/websites/<name>` + monitoring tab | `GET /websites/:slug`, `GET .../metrics?range=` |
| `/websites/<name>/logs` & `/map` | `GET .../logs`, `WS: site-log-stream` |
| `/websites/<name>/routing` | `GET|POST .../routes`, `GET .../vhost/preview` |
| `/websites/<name>/files` | file manager endpoints |
| `/websites/<name>/deploy` | `PUT .../git`, `POST .../redeploy` (+ `WS: deploy-log`) |
| `/websites/<name>/security` | maintenance / basic-auth / anti-bruteforce |
| `/terminal` (tenant) | `GET /websites`, `WS /websites/:slug/pty` |
| `/monitoring/*` | system monitoring endpoints (+ `WS`) |
| `/databases` | `GET /databases`, `GET /db-engines` |
| `/databases/caches` | `GET /caches` |
| `/databases/trash` | `GET /databases/recycle-bin`, `POST /databases/:id/restore`, `POST /databases/:id/purge` |
| `/api` | `GET|POST|DELETE /api-tokens`, `GET|POST|DELETE /webhooks` |
| `/profile` | `GET /profile`, `POST /profile/password`, `GET|DELETE /sessions` |
| `/backup/*` | backup & migration endpoints |
| `/users/*` | users & groups endpoints |
| `/settings/*` | settings & system cleanup endpoints |

---

## 6. Recommended Backend Implementation Order

1. **Foundation:** SQLite (WAL) + schema migrations, HTTP + WS router, JWT/RBAC middleware, `/system/capabilities`.
2. **Pilot: Websites** — `GET/POST/PATCH/DELETE /websites`, start/stop/restart, metrics. Wire the UI to real data end-to-end.
3. **Files + Deploy** (file manager API + git runner + `WS: deploy-log`).
4. **Terminal** (`pty` bridge: tenant + host, host gated to admins).
5. **Databases + SSO gateway**, then **Domains/SSL**, **Tunnels**.
6. **Monitoring** (read `/proc`, `smartctl`, `ss`) + **Backup/Migration** (rsync stream + `.bpod` + S3/R2).
7. **Cleanup & Cron** (systemd timers), **Pods** (Docker SDK).

> Platform note: everything above must run on **linux/amd64 & linux/arm64** (see MASTER_PLAN §5). On LXC, disable unavailable features (S.M.A.R.T./fstrim) and surface a status instead of an error.

---

## 7. Automation: API Tokens, Webhooks & MCP Server

Goal: let users (and **AI agents**) automate the panel without opening the UI.

### 7.1 API Tokens (for the REST API)

- Created per user: `GET|POST|DELETE /api-tokens` (requires the `apiTokens` group permission).
- Format: `bp_live_<base62>` (e.g. `bp_live_9f8a20bc…`); the server stores only the **prefix + hash**. The full value is shown once at creation.
- **Scopes** (subset of `GroupPermissions` plus access level):
  `websites:read`, `websites:write`, `files:read`, `files:write`, `databases:read`, `databases:write`, `backup:run`, `system:read`, `cleanup:run`, `users:write`, `tokens:manage`.
- A token **may never exceed** its owner's group permissions (effective scope = intersection).
- Attributes: `expiresAt`, `lastUsedAt`, `ipAllowlist`, `revoked`.
- Audit log per request: `{ tokenId, userId, method, path, status, ip, ts }`.
- Rate limit per token (e.g. 120 req/min burst).
- `GET /openapi.json` exposes an OpenAPI 3 spec for every endpoint in §4.

Example:
```bash
curl -H "Authorization: Bearer bp_live_9f8a20bc…" \
     https://panel.example.com/api/v1/websites
```

### 7.2 Webhooks (outbound & inbound)

- **Outbound:** `GET|POST|DELETE /webhooks` → `{ url, secret, events[] }`.
  Events: `website.deployed`, `website.status_changed`, `backup.completed`, `migration.completed`, `cleanup.completed`, `cert.expiring`, `disk.threshold`. Payloads are signed with HMAC-SHA256 in the `X-BarePod-Signature` header.
- **Inbound** (trigger automation): `POST /hooks/:token/run?action=deploy|cleanup|backup&target=<slug>` — no JWT; the token is one-shot/reusable per configuration.
- GitHub push-to-deploy already follows this pattern (`POST /webhook/:slug/deploy?token=…`).

### 7.3 MCP Server (Model Context Protocol)

So agents (Claude / Command Code / Cursor / etc.) can call the panel as *tools*.

**Architecture (recommended): a standalone MCP server wrapping the REST API.**
- A small MCP server (Node/Go) runs on the agent/CI machine, **not** on the panel server.
- Auth: **API token** (scoped), never the panel password → no extra attack surface on the server.
- Alternative: a built-in `barepod mcp` subcommand (stdio) calling the internal API over a Unix socket.

Client configuration:
```json
{
  "mcpServers": {
    "barepod": {
      "command": "npx",
      "args": ["-y", "@barepod/mcp"],
      "env": {
        "BAREPOD_URL": "https://panel.example.com",
        "BAREPOD_TOKEN": "bp_live_9f8a20bc…"
      }
    }
  }
}
```

**Tools (example surface):**

| Tool | Scope | Action |
|---|---|---|
| `list_websites` / `get_website` | `websites:read` | list / inspect websites |
| `create_website` / `delete_website` | `websites:write` | create / delete a website |
| `start_website` / `stop_website` / `restart_website` | `websites:write` | lifecycle control |
| `redeploy_website` | `websites:write` | trigger a deploy (streamed via events) |
| `get_website_metrics` / `tail_website_logs` | `websites:read` | metrics & logs |
| `list_files` / `read_file` / `write_file` | `files:read` / `files:write` | file manager |
| `list_databases` / `create_database` / `rotate_db_password` | `databases:*` | database suite |
| `create_backup` / `list_backups` / `restore_backup` / `start_migration` | `backup:run` | backup & migration |
| `create_tunnel` / `add_tunnel_route` | `websites:write` | Cloudflare Tunnel |
| `list_users` / `create_user` / `update_user` / `assign_group` | `users:write` | users & groups |
| `system_metrics` / `list_services` / `restart_service` | `system:read` | host monitoring |
| `run_cleanup` / `list_cron_jobs` | `cleanup:run` | system & Docker cleanup |

**Resources** (read-only context): `barepod://websites`, `barepod://system/capabilities`, `barepod://settings`.
**Prompts**: `deploy-website`, `migrate-server` (step-by-step guidance for agents).

**Security rules:**
1. Tokens default to **read-only**; write/delete require explicit scopes.
2. Destructive actions (`delete_website`, `restore_backup`) require a dedicated scope plus a two-step flow (a `preview_*` tool → an `apply_*` tool).
3. Every action is recorded in the audit log with its `tokenId`.
4. The MCP server never stores the panel password — only tokens.
5. The panel can disable automation per group (`apiTokens = false`).

### 7.4 Per-User Automation

- Each user can create **their own** tokens with scopes ≤ their group permissions. Example: tenant `alex` issues a `websites:read` + `files:write` token for their CI pipeline.
- Token/webhook quotas per group (e.g. Starter: 1 token, Agency: 10 tokens).
- Actions triggered by agents are still bounded by the tenant's **cgroup/CPU/disk quotas**, exactly like manual actions.
