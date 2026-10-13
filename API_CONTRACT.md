# BarePod Panel — API Contract (Draft v0.1)

> Blueprint for the contract between the **frontend (React, Phase 1)** and the **Go backend daemon (Phase 2)**.
> Goal: the backend can follow the response shapes defined here without requiring UI changes.
> Status: **draft, partially implemented** — see the table below.

### Implementation status

| Already served by the daemon | Contract only (planned) |
|---|---|
| `GET /health` · auth: `login`, `logout`, `me`, `verify` (elevated) · `sessions` list + revoke · `audit` · `system/capabilities` (+`limitations[]`) · `system/capacity` · `system/metrics` · `system/guard` (+ `unban`) · `system/settings` · `system/ports` (panel/ssh) · **the Stack**: `system/stack` + `web-server` switch + allowlisted `install` (job + SSE) · **accounts & packages**: `users` list/create/patch/delete + password reset + `provision`, `groups` list/create/`PATCH`/delete · `websites` list/get/`POST`/`prepare-directory`/`DELETE`/`redeploy` · deploy job, poll and **SSE stream** · per-website `metrics` · **`runtime` (get/put) + `vhost/preview` + `php-fpm/reload`** · `start`/`stop`/`restart` · `secrets` list + reveal · the **whole file manager** (`/files/*`, site + host/tenant scope) · `GET /tenants` · `ws/ticket` + `WS /pty` (site and host, confined to the site) · **databases & caches**: `db-engines`, list/create/get/patch, `rotate-password`, `reveal`, `connection-string`, bin/restore/purge, `recycle-bin`, **`tables`/`query`** for every engine, the gated **`gui`** family (tool list + hosted **pgweb**/**phpMyAdmin**, plus **DbGate** as a per-database container), and a real logical **`export`** | Pods (Docker) · backups & migration · domains & SSL · Cloudflare tunnels · webhooks · MCP server · per-app access control (503, basic auth, anti-brute-force) · the other web servers (openlitespeed, apache) · PHP extensions/ini · per-site version selection |

`mode: "real" | "dry-run"` appears on every response that depends on privileged work — off Linux+systemd the daemon is in dry-run and says so instead of faking success.

---

## 1. Conventions

- **Base path:** `/api/v1`
- **Known gaps, recorded rather than implied** (a reader should not assume these exist): the deploy wizard and the redeploy screen call the daemon, but **nothing in this session was verified through a real browser** — every claim is HTTP-level; the manager start has a **bounded retry, not a queue** (a cold open can still take the waiting page, and there is no ordered job queue with per-job status); **domains & automated SSL** (Let's Encrypt / ZeroSSL) is still scheduled (vhost generation for nginx & caddy exists, but automated ACME cert issuance is not yet wired); **per-database exposure is applied per engine and gated behind the watchdog** (a `public` exposure answers `409 guard_required` while it is not enforcing); and the status page's **503 maintenance variant is unused** until the web-server module owns the ports.
- **A milestone is a claim about the daemon, not about a screen.** The deploy and database flows are verified by driving these endpoints (curl on the LXC); a panel screen that does not call them is mock and is labelled as such in the UI (the Add-Website wizard was one until it was wired to `POST /websites`).
- **Everything is behind one origin.** The panel and every manager it hosts are reached on the panel's own port and path, so a reverse proxy or tunnel (Cloudflare Tunnel, nginx) only has to point at the panel — there is no second hostname or port to expose, and nothing to configure per database. When one is in front, `X-Forwarded-Proto` decides the scheme the *visitor* is on: a manager's absolute URLs (phpMyAdmin's `PmaAbsoluteUri`) and the session cookie's `Secure` flag follow the visitor, not the plain-HTTP hop to the daemon.
- **Format:** JSON (`application/json`), UTF-8.
- **Auth:** an opaque **session cookie** (`HttpOnly`; `Secure` when the visitor is on HTTPS), set by `POST /auth/login` and restored by `GET /auth/me`, with an `X-CSRF-Token` on every state-changing request (except `POST /auth/login` and GitHub webhooks). **Not JWT** — see `MASTER_PLAN.md` decision #4.
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
- **Errors:** `{ "error": { "code": "...", "message": "..." } }`, plus a `fields` map on validation failures. Codes: `bad_request`, `validation_error` (+`fields`), `unauthenticated`, `invalid_credentials`, `suspended`, `csrf`, `system_path_protected` (a write into a system tree through the host-wide browser), `elevation_required` (reveal/rotate needs the 5-minute sudo mode), `capability_required` (group lacks the permission), `not_applicable` (the site type has no such capability, e.g. a proxy has no shell/files), `insufficient_capacity` (the packages exceed the server), `forbidden`, `not_found`, `slug_taken`, `directory_missing`, `service_error`, `owner_suspended` (a website's owner account is suspended), `provisioning_failed` / `linux_account_missing` (the Linux account could not be created and the panel account was not added), `internal`.
- **Tenant scoping:** collection endpoints return only the caller's own resources; `GET /:id` on someone else's resource is `404`, not `403` (it must not confirm existence). Only role `admin` sees every tenant.
- **Serving rules (normative):** an unknown **`/api/*`** route always returns the JSON `404` above — it must never fall back to the single-page app, or a client parsing JSON receives HTML. Any *page* path instead serves `index.html`, because deep links such as `/apps/<slug>/files` are resolved by the client router on refresh. The client is responsible for correcting a path it does not recognise to a route it does show (it replaces the URL rather than leaving the address bar disagreeing with the screen).

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
- **`POST /auth/password`** `{ currentPassword, newPassword }` (session + CSRF) → `200 { status: "changed", signedOutEverywhere: true }`. The current password is verified (`403` when it is not right, `400` when the new one is under 12 characters) and **every session for the account is invalidated**, the caller's included — the store's own rule, and what the CLI does. Both outcomes are audited (`auth.password_change`, `auth.password_change_refused`).
- `POST /auth/login` `{ username, password }` → sets the session cookie, `200 { user, csrfToken }`
- `POST /auth/logout`
- `GET /auth/me` → `{ user, csrfToken, elevated, permissions }`
- **CSRF:** every state-changing request carries `X-CSRF-Token`, and the token is returned by **`/auth/me`** as well as by login — a client must store it on *every* session read, because a reloaded page restores its session from `/auth/me` and would otherwise fail every write with `403 { code: "csrf" }`. A missing or stale token is rejected, never ignored.
- `POST /auth/verify` (re-auth for revealing DB passwords / sensitive actions)
- `POST /auth/2fa/enable` · `POST /auth/2fa/verify`
- `GET|PATCH /profile` (identity: username, email, group)
- `POST /profile/password` (change the panel password)
- `GET /sessions` · `DELETE /sessions/:id` (active sessions, revoke). **Only a hash of each session token is stored** (`sha256`, in `sessions.id`), so a leaked database holds no usable session — the cookie carries the raw token and the daemon hashes it on the way in.
- `GET /audit?limit=<n>` → `{ items: [{ id, at, userId, username, action, target, ip, detail }], everything }` — the caller's own activity, newest first, or **every account's for an admin** (the same single exception as elsewhere; `everything` says which view you got). `limit` defaults to 50 and is capped at 500. Actions are namespaced: `auth.*` (login, logout, elevate, session_revoke), `terminal.*` (open, close), `files.*` (write, create, mkdir, rename, copy, move, delete, compress, **download**), `website.*` (deploy_start, start, stop, restart, delete, redeploy, secret_reveal, directory_prepare), `group.update`, `system.capacity_exceeded`.

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
  `source.kind` ∈ `scaffold | github | upload | existing | default`. For `upload` the archive is sent to `POST /websites/:slug/files/upload`; for `existing` the directory must exist **and not be empty** (the daemon returns `409` otherwise, and the job fails with an actionable message); for `default` the daemon writes a single `index.html` (owned by the tenant) and nothing else, so a website can exist and answer before its application does — and a static site needs no `version` (`static` and `proxy` are version-less by contract, which the validator now accepts).
- `source.kind = scaffold` runs the framework's download **and writes its starter entrypoint** when that file is absent (never overwriting uploaded or cloned code), so the site runs as promised: Flask/FastAPI get an `app.py` exposing `/` and `/healthz`, and FastAPI's unit starts gunicorn with an ASGI worker. For Python, virtual environment creation uses the chosen version (`python<version> -m venv .venv`, e.g. `python3.12`) rather than an unversioned system default. A preset that only installed packages would deploy a site that cannot start.
- **`POST /websites/prepare-directory`** `{ slug, tenantUser }` → `201 { slug, tenantUser, path, created, existed, mode }`. **Tenants have no shell on the server**, so this is how "Existing Files" is reachable from the panel: create the folder here → upload the code with the File Manager → deploy. Idempotent; also gated on `deployApps` and restricted to the caller's own tenant.
- **`DELETE /websites/:slug` has to be told what happens to the website's databases.** A SQLite file lives *inside* the site directory, so deleting the site used to take the file and leave the record behind, pointing at nothing (`409 not_ready — its file is gone`). The request now answers `409 has_databases` listing them unless it carries `?databases=keep` — the record is detached (its `websiteSlug` cleared) and a file-based database's file is **moved out of the site** into the tenant's own home — `<sites root>/<tenant>/detached/<file>`, handed back to that account so it stays reachable in their File Manager — and the record's `path` is updated, so the manager still opens it — or `?databases=delete`, which purges them with the website. A kept record carries `detachedAt` (migration 8) and `GET /databases?detached=true` lists exactly those, which is what the panel's **Detached** tab shows; the mark is cleared if the record belongs to a website again.
- **`POST /websites` returns `202 Accepted`** with `{ slug, deployId, mode, status, totalSteps, stream }` — provisioning runs asynchronously. `mode` is `real` on Linux+systemd and `dry-run` everywhere else; **in dry-run nothing is started and the website stays `stopped`** (units and `.env` are still written, and the recorded commands are logged).
- **`GET /websites/:slug/deploy`** → the latest job · **`GET /websites/:slug/deploy/:id?after=<logId>`** → `{ job, log[] }` (safe polling) · **`GET /websites/:slug/deploy/stream?id=`** → **SSE** `event: log` frames, closed by `event: done` with the final job. Every line is persisted, so a reconnect loses nothing.
- **`DELETE /websites/:slug`** → `200 { slug, steps[], mode }`. Full teardown: stop + disable the unit, remove the per-site drop-in and reload systemd, delete the app directory (bounded to `<sites-root>/<tenant>/apps/<slug>` — the daemon refuses the root or a tenant home), then forget the stored secrets and the row. A second delete is a `404`.
- **`POST /websites/:slug/redeploy`** → `202` with the same envelope as create. The pipeline runs again from the **source recorded at create time** (`sourceKind`/`sourceRepo`/`sourceBranch` are part of the website model); when a row predates that field the source falls back to `existing`. A redeploy **keeps the existing database and cache** and says so in the log, and it is refused with `409 not_applicable` for a reverse proxy (nothing to build).
- The website model carries **`deployStatus`**: `pending | building | ready | failed`. Its service state (`status`) is `running`, `stopped`, or `suspended` — the last set when the owner account is suspended (§4.2.2); starting a site whose owner is suspended answers `409 owner_suspended`.
- **Failure & rollback:** if a step fails, the deploy stops, `deployStatus` becomes `failed`, and the failure is reported on the stream. Partial resources are **kept** (so the log can be inspected and the deploy retried) but are marked as unlinked: a failed database/cache is created in the Recycle Bin rather than dropped, and `POST /websites/:slug/redeploy` retries from the failed step. A website that never reached `ready` can be deleted without leaving orphans.
- `POST /websites/:slug/start|stop|restart`
- `GET /websites/:slug/metrics?range=` · `GET /websites/:slug/logs?range=`
- `PUT /websites/:slug/maintenance` · `PUT /websites/:slug/basic-auth` · `PUT /websites/:slug/anti-bruteforce`
- `GET|POST|DELETE /websites/:slug/routes` (multi-engine path routing)
- `GET|PUT /websites/:slug/env`
- `POST /websites/:slug/backup` (export per-website `.bpod`)

### 4.2.1 Site Types and What They Expose
Normative: a client must not offer a control the site type cannot use, and the server must refuse such a request rather than half-serve it.

| Site `runtime` | Shell (`/pty`) | Files (`/files/*`) | Env / Deploy / CI-CD | Meaning |
|---|---|---|---|---|
| `php`, `nodejs`, `python`, `go`, `ruby`, `rust` | ✅ | ✅ | ✅ | The site runs its own process |
| `static` | ✅ | ✅ | ✅ (no env) | Serves a docroot; nothing to run |
| `proxy` | ❌ | ❌ | ❌ | **Reverse proxy only** — forwards to an upstream; its process and files live in that container |

- `runtime: "proxy"` is a **valid** site type (it is what "Reverse Proxy Only" creates) but it has no runtime of its own.
- Calling `/websites/:slug/files/*` or `WS /websites/:slug/pty` for a proxy returns **`409 { code: "not_applicable" }`** with the reason. Hiding the button in the UI is not enforcement — the server is the authority.
- The routing tab/module (`/websites/:slug/routes`, upstream target) is the meaningful one for a proxy, together with monitoring, logs, traffic map and security.
- A pod has no `/pty` endpoint yet: container shells arrive with the pods module (Phase 3). Until then a pod target is a UI-only concept.

### 4.2.2 Accounts, Groups & Permissions (per account)
> **The accounts and packages are an HTTP surface now** — `GET|POST /users`, `PATCH|DELETE /users/{id}`,
> `POST /users/{id}/password`, `GET|POST /groups`, `PATCH|DELETE /groups/{name}`. What stays CLI-only is
> host lifecycle, not accounts: `barepod uninstall` removes the panel from the host (guided; backs up and
> verifies the backup before deleting anything; `--backup=db|full|none`), `barepod service
> install|status|uninstall` manages its systemd unit, and `scripts/` carries the same operations for a
> host whose binary is already gone.

- **No built-in account.** The operator creates the root admin during installation with the CLI: `barepod admin create` (generated password shown once). The daemon refuses to start while no account exists.
- **The only built-in data is two packages**, created on first run: `Unlimited` and `Basic`. `users.group_name` is the membership, and membership of `Unlimited` is what makes an account an admin.
- `GET /groups` → `{ items: [{ id, name, description, permissions{10 capabilities}, limits{cpuQuotaPercent,memoryMb,tasksMax,diskQuotaGb,inodeQuota,maxSites,maxDatabases}, members, isDefault, isSystem }], capabilities: [...] }` (requires the `users` capability). `POST /groups` creates a package, `PATCH /groups/{name}` edits it, `DELETE /groups/{name}` removes it — a system group cannot be deleted (`403`), and one that still has members answers `409 has_members`.
- **Accounts.** `GET /users` lists them with `{ id, username, email, role, groupName, status, createdAt, home, osExists, sites{used,max}, databases{used,max} }` and a top-level `mode`. **A Linux account is mandatory where one can be made:** `POST /users` `{ username, email?, password?, groupName }` creates it **first** and only records the panel account once it exists, so no account is left without an OS identity — a `real` host that cannot create it answers `502 provisioning_failed` / `linux_account_missing` and nothing is added. Off Linux (dry-run) nothing can be created, so the account is recorded and the response carries a `linux` block (`{ mode, home, created, quotaSet, notes[] }`) saying so, which is exactly the `osExists: false` the list then shows. `POST /users/{id}/provision` creates (or reconciles) the Linux account for an account that predates this rule — the repair path behind the screen's Provision action. When a password was not given, the response carries a generated `password`+`passwordShownOnce`. `PATCH /users/{id}` `{ email?, groupName?, status? }` changes the package (re-applies the quota) or the status (mirrors `usermod --lock/--unlock` and revokes that account's sessions). **Suspending carries down to the account's services:** every website it owns is stopped and marked `status: "suspended"` (so the state is visible and a start is refused with `409 owner_suspended`); reactivating marks them `stopped`, left for the operator to start. `DELETE /users/{id}` refuses with **`409 has_resources`** (naming the websites and databases) while the account still owns anything, and refuses `self_action` / `last_admin`; otherwise it removes the panel row **and the Linux account with its home** (`userdel -r`), because the two must not drift apart — a drifted account has nothing to remove and is simply forgotten, and a failed removal keeps the row so they stay in step. `POST /users/{id}/password` resets it and signs that account out everywhere.
- **The role follows the package:** an account whose `groupName` is the Root package is `role: "admin"`; any other package is `role: "user"`. Cross-tenant visibility keys off `role` and capabilities off the group, so the two are kept in step — a Root member is an admin and nothing else is.
- New error codes: `no_such_group`, `has_resources`, `has_members`, `last_admin`, `self_action`, `owner_suspended`, `provisioning_failed` / `linux_account_missing`.
- Capabilities: `deployApps`, `fileManager`, `terminal`, `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`, `apiTokens`. `GET /auth/me` returns the caller's **effective permissions**, resolved from the group.
- **Enforcement is per account, never global:** a route whose capability is missing returns `403 { code: "capability_required" }`, and resource routes are scoped to the caller's own resources (another tenant's object returns `404`, even when the capability is granted). **Admins are the single exception** — they see and manage every tenant.
- **Backup, migration and every future module follow the same rule:** capability from the package + ownership of the resource; a package that lacks a capability cannot use that module at all.
- **A group is also the tenant package (resource limits).** Each group carries per-member limits — `cpuQuotaPercent`, `memoryMb`, `tasksMax`, `diskQuotaGb`, `inodeQuota`, `maxSites`, `maxDatabases` (`0` = unlimited). They are applied to the website's systemd drop-in (`MemoryMax`, `CPUQuota`, `TasksMax` — cgroup v2) and to the tenant's disk quota (`setquota`); `maxSites` is enforced when creating a website.
- **Where the kernel cannot enforce a disk quota, the panel does — and says so.** `GET /users` reports each account's **measured** disk use (`disk: { usedBytes, maxBytes }`, `maxBytes` 0 = unlimited), and on a host whose filesystem has no user quotas (an unprivileged LXC cannot enable them) a panel-driven write — `PUT …/files/content`, `POST …/files/upload` — that would exceed the package allowance is refused with `409 quota_exceeded` (the body's `quota.enforcedBy` is `"panel"`). This covers what the panel writes; a process writing from inside the site is not stopped, which is exactly what a kernel quota is for. When the filesystem *does* have quotas, the kernel is the authority and the panel steps aside.
- `PATCH /groups/:name` `{ description?, permissions?, limits? }` → the updated group. A plan whose total (limits × members, summed over every package) exceeds the host is refused with `409 {"error":{"code":"insufficient_capacity","message":"the packages exceed this server: memory: allocated 65536 of 16384 available (400%)"}}` plus `capacity` and `usage`.
- `GET /system/capacity` → `{ capacity, allocation, usage{cpu,ram,disk}, fits, exceeds[], suggested, packages[], checkedAt }`. Capacity is read **live** — cgroup v2 `cpu.max`, `/sys/devices/system/cpu/online`, `/proc/meminfo`, `statfs` of the sites filesystem — so scaling the server up or down changes the answer **without restarting the daemon**. After a scale-down `fits` becomes `false`, `exceeds` names each resource with its numbers, and the daemon logs + audits `system.capacity_exceeded` once per change.
- **Pods reuse the same `Limits` model** as their Docker resource spec (Phase 3): one model, three consumers.

### 4.3 Runtime, VHost & PHP
- `GET /websites/:slug/runtime` → `{ runtime, version, webServer, engine, engineSupported, engineInstalled, docRoot, port, vhostPath, socket?, mode }`.
- `PUT /websites/:slug/runtime` `{ engine }` → switches the engine, rewrites the vhost and reloads the web server. A runtime **version** change is refused with `409 redeploy_required` (it rewrites the unit's ExecStart, which the deploy pipeline owns). An engine the daemon cannot write answers `501 not_supported_yet`; one that is not installed answers `409 engine_not_installed`.
- `GET /websites/:slug/vhost/preview?engine=` → `{ engine, config }` — rendered **by the daemon** (the client used to build this string itself).
- `POST /websites/:slug/php-fpm/reload` → `{ status: "reloaded", mode, pool, output }`; a non-PHP site answers `409 not_applicable`.
- `GET|PUT /websites/:slug/php/extensions` · `POST .../php/extensions/install` (PECL)
- `GET|PUT /websites/:slug/php/ini`
> **Engine support today:** All 4 engines (`nginx`, `caddy`, `apache`, `openlitespeed`) are supported site choices. A site can choose its web server engine freely in `AddAppModal` and `POST /websites`. Public ports `:80`/`:443` are managed by the active edge ingress (Nginx or Caddy), which reverse-proxies traffic to internal backend engine ports (Apache on `127.0.0.1:8080`, OpenLiteSpeed on `127.0.0.1:8088`, Caddy on `127.0.0.1:8081`).

### 4.14 Stack (host-level platform choices)
> Reading it is for anyone signed in; changing and installing are administrative (`users` capability) and audited.
- `GET /system/stack` → `{ webServer:{active,supported,installed[],available:{engine:[versions]},latest:{engine:version},webUser,vhostsPath}, components:[{name,label,kind,versions,description}], databases:[Engine], databaseVersions:{engine:installedVersion}, databaseAvailable:{engine:[versions]}, databaseLatest:{engine:version}, repositories:[{name,label,present,group,path}], runtimes:{php,node,python,ruby,go,rust}, php:{installed,default}, node:{installed,default}, installRunning, activeJobId, mode }`. Everything about *installed* is detected, never stored: the web servers from `nginx -v`/`caddy version`, each database engine from its own client's version banner (`installedVersion`; MariaDB's `Distrib` number is preferred over the protocol version its banner starts with), and each language from `python3 --version`, `ruby --version`, `go version`, `rustc --version`, `php-fpm*`, `node --version`. Each `runtimes` entry is `{installed, available, supported, latest, upToDate, labels, perSite, source}`. **`available` is read from the host's repositories or the vendor's own index** — `apt-cache search` against the source's package pattern for PHP (Sury), Python (deadsnakes) and Ruby (the prebuilt `ruby3.x` packages); `apt-cache madison`/the vendor feed for Go and Rust; nodejs.org's `index.json` plus its release schedule for Node, which is why Node offers **Current plus the LTS lines still in support**, each named in `labels` ("current", "LTS Krypton"). Nothing is kept in code: a version the repository adds appears without a release of the panel. `supported` is the short list the screen draws first (all of PHP; the newest three for Go; four lines for Python; the channels for Rust) and `available` still carries everything for a project that pins an older one. `upToDate` is the daemon's answer, not a string comparison in the browser: a Rust channel is a moving name, so rustc is asked what `stable` points at. `perSite` marks the interpreted runtimes (PHP, Node, Python, Ruby) against the build-time toolchains (Go, Rust). Ruby is **prebuilt only** — rbenv compiled it from source, which took minutes per version and could be killed by a deploy; the packages install in seconds. When an install is running, `activeJobId` provides the active job ID so that page refreshes in the frontend immediately reconnect to the SSE log stream. Components: `nginx`, `caddy`, `php`, `node`, `python`, `ruby`, `go`, `rust`, `postgresql`, `mariadb`, `mongodb`, `redis`.
- **A database's version is not chosen at creation.** One version per engine is installed (and recorded) from the Stack, so neither Add Database nor the deploy wizard offers one — the daemon records the engine's version on the record. Installing a PHP version installs the **full extension set** the Settings screen toggles later (`phpenmod`/`phpdismod`); an extension the repository does not carry is named in the install log rather than failing the install.
- `PUT /system/stack/web-server` `{engine}` → writes **every** site's vhost for the new edge ingress engine, validates once, grants the new web user read access, then swaps the edge ingress holding `:80`/`:443`. In the Hybrid Multi-Engine architecture, backend web servers (Apache on `:8080`, OpenLiteSpeed on `:8088`, Caddy on `:8081`) remain active and enabled in systemd, so all 4 web server engines run concurrently without port collision. A failed validation or start puts the host back the way it was. Refuses an engine the panel cannot write (`501 not_supported_yet`) or one that is not installed (`409 engine_not_installed`).
- `POST /system/stack/install` `{component, version?}` → `202 {jobId, stream, mode, totalSteps}`. **Allowlisted components only** (the four web servers, `php`+version, `node`+major, `python`+version, `ruby`+version, `go`+minor, `rust`, `postgresql`/`mariadb`/`mongodb`/`redis`, and `repositories`, which adds every extra source at once); the daemon never accepts a free-form command. Architecture for direct binary tarball downloads (Node.js, Go) is dynamically resolved via `uname -m` (`x64`/`arm64` and `amd64`/`arm64`) to prevent hardcoding. When installing Apache on Debian/Ubuntu, its port listener is automatically configured to internal port `127.0.0.1:8080` (and `8443`) before enabling and starting, ensuring Apache runs concurrently without port 80 collisions. When installing Caddy while Nginx is ingress, Caddy is assigned internal port `8081`. **One install runs at a time** — every apt step shares the dpkg lock, so a second is refused with `409`-shaped `bad_request` naming the running one — and each step is executed as its own transient systemd unit, so a deploy that restarts the daemon no longer kills an install mid-flight. Every job starts with `dpkg --configure -a`, because a daemon restart under a running apt leaves dpkg half-done and every later apt step then fails. In dry-run the commands are recorded and nothing is installed. An install no longer decides a version: a site's version is chosen when the site is created (the create request requires one), so nothing is recorded as a "default" any more.
- `POST /system/stack/uninstall` `{component, version}` → `202 {jobId, …}`. One rule: **refused while a project uses it** — a site whose runtime and version match (`409 version_in_use`, naming the sites), a database on that engine (naming the databases), or the **active ingress** (every site is served by it). The last copy of a runtime is removable: an operator who does not want Rust on the host should be able to say so. Removal is per version everywhere: a PHP version, a Node major, a Go toolchain, a Ruby package, `postgresql-16`, an image tag (`docker rmi mongo:8.0`), and a web server's installed version. A database engine's data directories are **named in the log and left in place** — removing an engine is not shredding it.
- `GET /system/stack/plan?component=&version=` → **the dry run**: `{component, version, installed, steps[], uses[], warnings[], safeToRun, mode}`. It answers what a switch or a removal would do and what it would touch, without changing anything — for a database that includes the dump that has to happen first and the databases at risk, which is why `safeToRun` is false when anything uses it. The frontend StackView renders this as an interactive pre-flight preview modal before executing database version switches or uninstalls.
- `GET /system/stack/jobs/{id}?after=` → `{job, log[]}` · `GET /system/stack/jobs/stream?id=` → **SSE** (`event: log` … `event: done`), exactly the deploy shape, resolved by id because an install belongs to no website. Auto-reconnectable on page refresh via `activeJobId`.

**One rule for removal: nothing may use it.** `POST /system/stack/uninstall` refuses a site's runtime version (naming the sites), a database engine any database is on (naming the databases), and the active ingress (every site is served by it). Everything else goes, per version everywhere — a PHP version, a Node major, a Go toolchain, a Ruby package, `postgresql-16`, an image tag — and a database engine's data directories are named in the log and left in place, because removing an engine is not shredding it.

**Web servers are version-managed; all 4 run concurrently.** `webServer.managed` lists every engine the panel keeps versions for (`nginx`, `caddy`, `openlitespeed`, `apache`), `webServer.managedInstalled` carries their real state, and `available`/`latest` are keyed by engine. Their repositories come from the same `repositories` step (nginx.org, Cloudsmith, ondrej PPA, LiteSpeed's own). Detection follows the package rather than PATH: OpenLiteSpeed installs into `/usr/local/lsws/bin` and its service unit is `lshttpd`. Port 80/443 collision is prevented by dedicating public `:80`/`:443` to the edge ingress (Nginx or Caddy) and assigning internal loopback ports to backend engines (`apache2` on `:8080`, `lshttpd` on `:8088`, `caddy` on `:8081`).

**Installs are serialised and non-interactive.** One job at a time (they share one dpkg lock, and the second is refused by name); each step runs as its own transient systemd unit, so a deploy that restarts the daemon does not kill it; every job begins with `dpkg --configure -a`; every apt call runs with `DEBIAN_FRONTEND=noninteractive` and `-o Dpkg::Options::=--force-confold`, because a configuration-file prompt with no terminal aborts *mid-transaction* — that is how MariaDB was left unpacked with seven packages unconfigured. A MariaDB install then runs `mariadb-upgrade`. A job the daemon restarts under is marked interrupted on the next start, since its steps ran under systemd and may have finished.

**Database columns mean what they say.** `Active` is the version the engine is running, probed from the engine itself (`installedVersion`); `Newest` is what its repositories carry (`databaseLatest`). A container engine's Active version is the tag of the container that is **running**, falling back to the images on disk when none is up. Available image tags for containerized engines (MongoDB) are resolved from Docker Hub and local host images matching release lines and patch tags (`^\d+\.\d+(\.\d+)*$`), filtering out single-digit floating aliases (such as `7`, `8`, `9`) to prevent duplicate version entries beside `7.0`, `8.0`, `9.0`. In the frontend dropdown, options are deduplicated against the active version line so that exact active releases and their corresponding branch lines never appear twice or falsely share `(active)` tags, and switching between patch levels or minor lines remains properly enabled.

### 4.4 File Manager
- `GET /websites/:slug/files?path=` → `{ path, site, tenant, items[FileEntry], maxSize }`
- `GET /websites/:slug/files/content?path=` → `{ path, size, mode, modifiedAt, binary, encoding, content }` (`encoding` is `utf-8` or `base64` for binary files)
- `PUT /websites/:slug/files/content` `{ path, content, encoding? }` → `{ path, size, modifiedAt }`
- `POST /websites/:slug/files/create` `{ path }` (refuses to overwrite) · `mkdir` `{ path }`
- `POST /websites/:slug/files/rename` `{ path, name }` · `copy` `{ path, to? }` · `move` `{ path, to? }`
- `POST /websites/:slug/files/delete` `{ paths[] }` (max 500 per request)
- `POST /websites/:slug/files/upload?path=<dir>` (multipart, one or more files)
- `GET /websites/:slug/files/download?path=` → the file · `POST /websites/:slug/files/compress` `{ paths[] }` → `application/zip`
- All of it requires the `fileManager` capability **and** ownership of the site.
- **Everything returned is relative to the site root** — the API never leaks an absolute host path.

- `GET /tenants` → `{ items: [{ username, group, status, home, exists }], root }` — the account picker behind the host-wide browser. An admin sees every account; an ordinary account sees only itself.
- **Scoped browser (host-wide, admin only):** the same operations are reachable outside a website through `GET|PUT|POST /api/v1/files…?scope=host` (the whole machine) and `?scope=tenant&tenant=<name>` (that account's home; a tenant may open its own, an admin anyone's, and another account's home answers `404`). Listings answer `{ path, scope, root, readOnly, items[], maxSize }`, where **`readOnly` describes the directory being listed, not the whole scope** — an admin can create files in `/tmp` and cannot create any in `/etc` and each item carries `protected: true` when it may not be changed; `GET /files/content` answers `writable` for the same reason.
- **The system trees are read-only, enforced by the daemon:** `/bin`, `/sbin`, `/lib*`, `/boot`, `/etc`, `/usr`, `/proc`, `/sys`, `/dev`, `/run`, `/var/lib`, `/var/cache`, `/var/spool`, `/var/log`, `/lost+found` (and `/etc/barepod`, `/var/lib/barepod`). Every mutation there — `content`, `create`, `mkdir`, `rename`, `copy`, `move`, `delete`, `upload` — answers **`403 { code: "system_path_protected" }`** and is audited as `files.blocked`. `/home`, `/var/www`, `/tmp`, `/srv`, `/opt` and `/root` stay writable. Reads of protected paths are audited as `files.read_system`. Both the literal path and its symlink-resolved form are checked on both sides, so a link cannot reach into a protected tree.
> **Path safety (normative):** the server must treat every request path as relative, reject absolute paths and `..` outright, resolve symlinks (`EvalSymlinks` on the deepest existing ancestor), and then compare with the site root using a **separator-safe** test (`resolved == root || HasPrefix(resolved, root+"/")`) — a plain `HasPrefix` would let `/home/u/apps/site-evil` pass as inside `/home/u/apps/site`. Operations run **as the tenant UID/GID** (helper process with `setuid`/`setgid`), so the kernel enforces ownership too; a symlink resolving outside the root is refused and archives skip symlinks. `content` returns `403 path_not_allowed` for a rejected path.

### 4.5 Terminal
- `WS /websites/:slug/pty` — tenant shell (runs as the tenant, cwd = the site directory, allow-listed shell)
- **A site shell is jailed into its site.** The daemon builds the shell's world inside a private mount namespace (`CLONE_NEWNS`): the system directories a shell needs (`bin`, `usr`, `lib*`, `etc`, `var`, `srv`, `opt`) are bound **read-only**, `/tmp` is its own small tmpfs, `/proc` and the host's `/dev` are mounted, and the website is bound at its usual path — then it `chroot`s and drops to the tenant's UID/GID. So `cd` has nowhere else to go: `/root` and `/var/www` do not exist, a sibling site is not a name (`ls ../web-flask` → No such file or directory), `/etc` is read-only, and the project path, prompt and `~` are unchanged. Writing works inside the website (and in the jail's `/tmp`). Where a jail cannot be built the daemon falls back to masking the neighbours, which hides their contents but leaves their names. Bash additionally gets a small rc file inside the jail (in its private `/tmp`) that bounces the prompt back when `cd` leaves the site: it is a shell-level guard, not a kernel one — everything outside stays read-only and the other sites do not exist. The `ready` frame carries `jailed`, `jailMode` (`root` | `mask`) and `masked`, and `terminal.open` is audited with them, so a client shows the truth instead of assuming.
- **What the jail does not hide:** `/proc` is the host's (no PID namespace), so process names are visible — signalling another user's process still fails. `/tmp` inside the jail is private and small.
- **The mount namespace is made private before anything is masked** (`mount --make-rprivate /`), because `CLONE_NEWNS` otherwise inherits shared propagation and would publish the masks to the container itself. A helper refuses to mask when it is not in a private namespace, or when the daemon tells it (via its own namespace id) that it shares the daemon's.
- **Hosts that cannot build the namespace** (unprivileged container, not Linux) still open the shell, but unconfined: `/system/capabilities` reports `ptyJail: false` and `limitations[]` explains it, and the `ready` frame says `jailed: false`. Never report a confined shell when it is not.
- **Isolation is per tenant, not per site, at the account level**: sites of one tenant share a Linux UID, so two customers' sites must be two tenants. The confinement above covers the shell; the file-manager jail covers the API.
- `WS /system/pty` — host root shell (**admin only**)
- **Auth:** redeem a one-time ticket, never a session token in the URL — `POST /ws/ticket` → `{ ticket, expiresAt }` (30 s TTL, single use) → connect with `?ticket=…`. A replayed ticket is refused.
- **Frames:** binary = stdin/stdout; text = control JSON:
  - `{ "type": "resize", "cols": 120, "rows": 40 }` → `pty.Setsize` (so vim/top fit the browser)
  - `{ "type": "ping" }` → `{ "type": "pong", "ts": … }`
- The first frame is `{ type: "ready", target, dir, shell, user, mode, note }` so the client can label the tab with the identity the shell runs as.
- Idle sessions close after 30 minutes; disconnecting kills the whole process group; `terminal.open` / `terminal.close` are audited.

### 4.6 Databases, Caches & SSO
> **Implementation status:** the ledger, the vault, rotate/reveal/connection-string, the recycle bin, the engine detection, **data browsing for every engine** (`tables`, `query` — SQLite read in-process, PostgreSQL/MySQL through pure-Go drivers as the database's own user, Redis as keys plus a single-key inspector) and the **gated `gui` family** (401 without a session, a tool list whose `available` flag is real, and a **reverse proxy that hosts pgweb for PostgreSQL and phpMyAdmin for MySQL/MariaDB** under `/databases/:id/gui/:tool/…`) and the **logical export** (`GET /databases/:id/export`) are served by the daemon. MongoDB is provisioned **through the panel's own driver** (a containerised engine's user is created inside the container, rotated, dropped on bin and recreated on restore, and dropped with its database on purge). **DbGate** is hosted for every engine as an on-demand container (loopback port published only to `127.0.0.1`, one scoped connection, no login of its own behind the panel session, removed when idle). pgAdmin was dropped (a heavy Python service) and Adminer is not shipped (version 5 offers no zero-login). A create on an engine whose client is missing answers `status: "pending"` with a note instead of pretending.
> **Reveal, connection-string and rotate require elevated mode** (`/auth/verify`, 5 minutes), and ownership is checked **before** elevation so another account's record still answers `404`.
- `GET|POST /databases` · `GET|PATCH|DELETE /databases/:id`
- **The connection limit is applied, not merely stored:** set `maxConnections` through `PATCH /databases/:id` and the daemon runs the engine's own `ALTER ROLE … CONNECTION LIMIT` / `ALTER USER … MAX_USER_CONNECTIONS` **as that database's user**; a file engine, a missing client or a dry-run host keeps the number in the ledger (the record still carries it).
- `POST /databases/:id/rotate-password` → `{ password }` (random when the body is empty, or a custom one; min. 12 chars). **A record that was never really created is finished here:** when its note points at a missing engine client, the rotate runs that engine's *create* plan (for MongoDB, it creates the database user the driver found missing) and the record becomes `ready` — the action the panel's own note names, instead of an ALTER on a role that does not exist.
- `POST /databases/:id/reveal` (panel password) · `GET /databases/:id/connection-string`
- `GET /databases/:id/tables` · `POST /databases/:id/query`
- `GET /databases/:id/export` → the dump itself (`application/octet-stream`, `Content-Disposition: attachment`): a `.sql` from `pg_dump` / `mysqldump` — the credential in the **environment**, never argv — or a copy of the `.sqlite` file. Audited as `database.export`. A key-value/document store has no logical dump (`409 not_applicable`).
- `GET /databases/:id/gui` (the tool list) · `GET /databases/:id/gui/:tool` (where to open one) · `GET|POST /databases/:id/gui/:tool/…` (the proxied manager itself, pages and assets)
- **A Redis cache is an ACL user, not a database:** the daemon creates `ACL SETUSER <tenant>_<name> reset on ><password> ~<tenant>_<name>:* +@all` on the server it finds through `BAREPOD_REDIS_URL` (default `redis://127.0.0.1:6379`; `redis://:password@host:port` when it needs one). Suspend is `off`, restore is `on`, rotation is `resetpass ><password>` so the previous secret stops working, and purge is `ACL DELUSER` — **the keys are left in place** and the API says so. Per-cache memory limits are not enforceable on a shared server (maxmemory is a server setting); a hard isolation would need one instance per cache.
- **Caches (Redis) are a separate resource:** `GET|POST /caches` · `GET|PATCH|DELETE /caches/:id` · `POST /caches/:id/rotate-password`
- `GET /db-engines` (versions + shared-daemon ports; SQLite reports `fileBased: true`, `port: null`) — and **`mode`** per engine: `docker` when the panel runs it as a container, `host` when it uses the host's packages (administered over the engine's own socket), `none` when neither is possible, always with the reason. **`available` means the panel can provide that engine, and `mode` says how:** an engine with nothing installed is still `available: true` when this host runs containers (`mode: "docker"`, with `running` reporting whether the panel's container is already up), because the drop-down locks on `available` — reporting "not installed" there hid an engine the panel runs perfectly well (MongoDB was unselectable while its container was up). A container engine runs on the **host network** and listens on its own loopback port (5433/3307/27018/6380) rather than publishing a port, because publishing needs a docker bridge and iptables that an unprivileged container does not have — and the host's loopback is where a tenant's application looks anyway. Nothing about where an engine runs is implicit.
- **Detected databases exist alongside managed ones.** `GET /databases` also returns SQLite files found inside the caller's websites with `detected: true`, an id of the form `det:sqlite:<base64url>` (**one path segment on purpose**, so routing and logs stay clean) and no credential. `GET /databases/:id/tables` and `POST /databases/:id/query` accept that id; `DELETE`/`rotate`/`reveal` answer **`409 app_managed`** because the file belongs to the application — use the File Manager to delete it. A file the ledger already manages is never listed twice, and the scan is bounded (depth 3, 25 files, dependency and build directories skipped).
- **`GET /caches/:id/key?key=<name>`** → `{ key, type, ttlSeconds, value, truncated }` for a cache — read with the pure-Go client; a key **outside this cache's prefix answers `404`**, exactly like a key that does not exist (the refusal is never leaked as a server error).
- **`GET /databases/:id/tables`** → `{ engine, tables[], browser }` — the daemon reaches every engine with a **pure-Go driver** (`browser: daemon-driver`, `browser: daemon` for SQLite), so **no client has to be installed** for browsing or querying, `{ engine: "redis", keys[], keyCount, note }` for a cache (scoped to its own prefix). **`POST /databases/:id/query`** `{ sql }` → `{ columns[], rows[][], truncated, rowsAffected, kind }`, capped at 500 rows with `NULL` rendered explicitly; it runs **as that database's own user**, so the panel can do no more than that account could, and an engine's refusal comes back with its own code (`SQLSTATE 42501`-style) rather than as a result grid. Each run is audited as `database.query` with the row count, **never the statement text** (it can carry values).
- **`GET /databases/:id/gui`** → `{ database, tools: [{ tool, description, available, path }] }`. The catalog is the decided shape — `browser` (the panel's own table browser / cache-key inspector), `pgweb` (PostgreSQL), `phpmyadmin` (MySQL/MariaDB), and `dbgate` (a container, for SQLite, MongoDB, Redis, PostgreSQL and MySQL/MariaDB) — and **`available` is real**: a tool that needs a binary (or an install) is offered only when it is on the host *and* the daemon is running for real, and one that is not hosted says why. **`GET /databases/:id/gui/:tool`** → where to open one (`{ tool, available, path }`); a tool that is not hosted answers `501 not_installed` with the rule.
- **`GET|POST /databases/:id/gui/:tool/…`** is the manager itself, reverse-proxied **under the panel's own path**. `pgweb` is started on first access on loopback, told its exact mount so its own links stay inside, with this database's credential injected into `--url` and the tool locked to that one connection. `phpmyadmin` runs on **PHP's built-in server** (`php -S`, no Apache/FPM) with a per-database `config.inc.php` (root 0600) using `auth_type=config` + `only_db` — so it opens exactly that database **with no login** — and `PmaAbsoluteUri` set to the mount; the proxy strips the mount so phpMyAdmin sees its own root. **The panel session is required** — without it every request answers `401 unauthenticated` (a browser gets the sign-in screen, never a database tool). Because the tool's own client cannot send our `X-CSRF-Token`, the page load issues a **path-scoped `HttpOnly; SameSite=Strict` cookie** that every further request under the mount must present; a cross-site request carries the session cookie (Lax) but not this one, so a `POST …/api/query` without it is `403 csrf`. Opening one is audited as `database.gui_open`.
- **A refusal is a page for a browser and JSON for a client.** A request that accepts HTML on a manager's mount gets the panel's own page with the reason on it (the same look as the status page); a request for data keeps `{"error":{"code",…}}`. An unauthenticated browser is redirected to `/login` (which remembers where it was going) rather than shown `401` JSON.
- **A record that is not `ready`** (a create whose engine client was missing, or one that failed) **or is in the recycle bin answers `409 not_ready`** with the record's own note — no manager is started, so the answer is immediate instead of a tool that dies on a database that was never created and waits out its startup timeout. When a started tool fails anyway, the failure carries **the tool's own output** (captured beside the panel database), not a bare timeout.
- **The anti-brute-force watchdog has three routes and one rule.** `GET /system/guard` answers the state the Settings → Security screen shows: the thresholds in force, including a per-engine override where one is set, and the addresses currently kept out. `PATCH /system/guard` changes them — how many refusals in what window keep an address out for how long, per engine or for all of them — and `POST /system/guard/unban` releases one address. Both of the changes require the admin capability, and every ban and release is audited. What a ban closes depends on what it was earned on: the panel's port for a panel ban, SSH's port for an SSH ban, and the whole host for an engine ban, because an address attacking PostgreSQL has no business reaching anything else. Addresses on the never-ban list are never banned, matched as an exact address or a network, and an address that signs in successfully is added to that list. A `public` exposure is refused with `409 guard_required` whenever the watchdog is not enforcing — the honest gate, since a public port with no lockout is the thing this exists to prevent.
- **Exposure is a decision with a result, applied per engine.** `POST /databases/:id/exposure` (and the caches variant) takes `private` or `public` and answers with what was applied and what was not, for the engine in question: PostgreSQL through `pg_hba.conf`, MariaDB through an account that may connect from anywhere, SQLite refused with the reason that a file has no network, and MongoDB/Redis answered honestly where the panel cannot yet restrict them. **MariaDB is opened by the panel itself**: its `bind-address` is written in `/etc/mysql/mariadb.conf.d/50-server.cnf` and MariaDB is restarted, because the setting takes effect only then — and the file is put back if MariaDB does not come up again, so a failed exposure cannot leave a database unreachable.
- **Panel settings and ports are the daemon's own state, not a mock.** `GET /system/settings` answers `{ externalAddress, trustedAddresses }`: the address external clients should use (a bare hostname or IP, and the one every connection snippet prefers for a public database), and the addresses the lockout must never ban, matched as an exact address or as a network, added automatically from wherever an operator signs in. `PATCH` takes either field: each entry is validated as an address or a CIDR and nothing else (one that is neither would be counted as protection while protecting nothing), the change is audited as `panel.trusted`, and an empty list exempts nobody. `GET /system/ports` answers what the host is actually listening on — the panel, SSH as a list, each engine as `listening`/`not listening` — read on demand rather than assumed. `POST /system/ports/panel` rewrites the port in the unit's `-listen` flag, keeps the previous unit alongside, `daemon-reload`s, and answers before asking systemd to restart (non-blocking, because the restart is this process ending); it refuses `0`, anything above 65535, anything below 1024, the port the panel already uses, and **a port any active service already holds — naming it**, read from `ss -ltnp`, so the panel cannot be moved onto SSH's port or onto PostgreSQL's. `POST /system/ports/ssh` adds or removes one `Port` line, validates with `sshd -t` (the only authority) and reloads, putting the file back if either refuses. The UI offers one **Change** per port: it adds the new port, verifies sshd accepts it, and only then removes the old one, so a failure leaves the host with more access rather than less.
- **These are paths on the panel, not a GUI on a port.** Nothing is published or firewalled: a manager is proxied behind these routes (credentials injected server-side, page + assets rebased onto the mount, **stopped after an idle window** — default 15 minutes, `-dbtools-idle`), leftovers are reconciled at daemon start (`database.gui_idle` is audited), and a manager is never exposed directly.
- **DbGate is one container per database, on demand.** Each record gets its own container (`barepod-dbgate-<record id>`), its own loopback-only port from a fixed range, and its own `WEB_ROOT`, so several databases — and several accounts — can have the manager open at once. A single shared container could not: it had to be restarted for the second database, which closed the page the first one had open (DbGate's own "Database connection closed"). The instance is started on first access, the port is released when it stops, and a run with the range exhausted answers `409 busy`. At daemon start leftovers are cleared by the shared name prefix. The port is never published outside loopback, and a container is only reused when its own `WEB_ROOT` is this record's mount.
- **DbGate is a container, so how it reaches an engine is part of the contract, and it is decided per engine:** an engine the panel runs as a container is reached through the **docker bridge gateway** (a container shares the host network; `127.0.0.1` inside DbGate is its own loopback); an engine installed on the host — which listens on the host's loopback — is reached over its **unix socket**, mounted read-only into the container (`/var/run/postgresql`, `/run/mysqld`) and selected with the plugin's own fields, `CONNECTION_bpod_authType=socket` + `CONNECTION_bpod_socketPath=…` (DbGate takes any connection field from env that way; plain `AUTHTYPE_bpod` is not one it reads); an engine that has neither (a host cache listening on TCP loopback only) is **not offered** — `409 not_reachable` with the reason, instead of a manager whose connection is refused. A manager opened for an engine whose stored address predates its mode also **repairs that record** (a MongoDB record saying 27017 while mongod listened on 27018), so the address the panel hands out is the one something is listening on.
- **SQLite is file-based:** `host`/`port`/`username`/`password`/`maxConnections` are `null`; the record carries a `path` (e.g. `/home/<tenant>/apps/<site>/<name>.sqlite`) and has no SSO web GUI.
- **Recycle Bin (soft delete) — `DELETE` never drops immediately:**
  - `DELETE /databases/:id` → sets `deletedAt` and **suspends** the database: existing connections are refused, grants are revoked and the app route is withdrawn. The data is retained.
  - `GET /databases/recycle-bin` (or `GET /databases?bin=true`) → binned items with `deletedAt`.
  - `POST /databases/:id/restore` → clears `deletedAt`, re-enables connections and re-grants access.
  - `POST /databases/:id/purge` (or `DELETE /databases/:id?permanent=true`) → drops the database and its data permanently.
  - `DELETE /databases/recycle-bin` → empties the bin (purges all binned items).
  - Retention: `retentionDays` (default **30**) lives in settings; a daily cron purges expired items.
  - Implementation note: for daemon engines "suspend" means refuse connections (e.g. PostgreSQL `ALLOW_CONNECTIONS false` after renaming; MySQL/MariaDB revoke + rename); for SQLite the file is moved/renamed. MongoDB/Redis use a suspended namespace. Restore reverses the same operation; purge is the only destructive step.

### 4.6.1 Metrics
- `GET /system/metrics?range=1h` (also `?live=1`) → `{ latest, items[], range, windowSeconds, intervalSeconds, buffered, maxRangeSeconds, source, checkedAt }`. `latest`/`items[]` carry **raw numbers**: `cpuPercent`, `memoryUsedBytes`, `memoryTotalBytes`, `swapUsedBytes`, `diskUsedBytes`, `netRxBps`, `diskReadBps`, `load1`, `uptimeSeconds`, …
- `GET /websites/:slug/metrics?range=1h` → the same envelope for one website (`cpuPercent`, `memoryBytes`, `memoryLimitBytes`, `tasks`) plus `unit` (e.g. `barepod-app@my-shop.service`).
- **Unavailable ≠ zero:** when the host or the cgroup cannot provide a metric, the sample carries `available:false` with a `reason` (e.g. "the service is not running"), so no chart draws a fake flat line.
- Ranges: `5m | 1h | 6h | 12h | 24h`, bounded by `-metrics-history` samples held in memory.

### 4.7 Cloudflare Tunnels
- `GET|POST /tunnels` · `DELETE /tunnels/:id` · `POST /tunnels/:id/token` · `POST /tunnels/:id/restart`
- `POST|DELETE /tunnels/:id/routes`

### 4.8 Domains & SSL
- `GET /domains` · `POST /domains/:id/renew-ssl` · `GET /domains/:id/ssl`

### 4.9 Users, Groups & RBAC
- `GET|POST /users` · `PATCH|DELETE /users/:id` · `POST /users/:id/password`
- `GET|POST /groups` · `PATCH|DELETE /groups/:name` (a package is addressed by name, not id)
- `GroupPermissions` (10 capabilities): `deployApps`, `fileManager`, `terminal`, `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`, `apiTokens`.
- `GET /permissions` (capability catalog for UI rendering) is **not served yet** — the client renders the same matrix from static data.

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

1. **Foundation:** SQLite (WAL) + schema migrations, HTTP + WS router, session-cookie + CSRF and RBAC middleware, `/system/capabilities`.
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
