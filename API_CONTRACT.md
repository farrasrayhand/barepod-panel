# BarePod Panel — API Contract (Draft v0.1)

> Blueprint for the contract between the **frontend (React, Phase 1)** and the **Go backend daemon (Phase 2)**.
> Goal: the backend can follow the response shapes defined here without requiring UI changes.
> Status: **draft, partially implemented** — see the table below.

### Implementation status

| Already served by the daemon | Contract only (planned) |
| `GET /health` · auth: `login`, `logout`, `me`, `verify` (elevated) · `sessions` list + revoke · `audit` · `system/capabilities` (+`limitations[]`) · `system/capacity` · `system/metrics` · `system/guard` (+ `unban`) · `system/settings` · `system/ports` (panel/ssh) · **the Stack**: `system/stack` + `web-server` switch + allowlisted `install` (job + real-time verbose **SSE stream** via `RunDetachedStream`) + dedicated uninstall modal + targeted PHP extensions sync (`version: "all" \| "<X.Y>"`) + Rustup channel selection (`stable`, `beta`, `nightly`) · **accounts & packages**: `users` list/create/patch/delete + password reset + `provision`, `groups` list/create/`PATCH`/delete · `websites` list/get/`POST`/`prepare-directory`/`DELETE`/`redeploy` · deploy job, poll and **SSE stream** · per-website `metrics` · **all 4 web servers (nginx, caddy, apache, openlitespeed vhosts & concurrent ports)** · **`runtime` (get/put) + `vhost/preview` + `php-fpm/reload`** · **PHP web shell defense (`disable_functions` default & upload directory `.php` block)** · **PHP extensions toggle (`system/php/extensions`) & host tuning blueprint (`system/settings/php-defaults`)** · **Framework version detection (`GET /websites/:slug/detect-framework`, `POST /websites/detect-framework`) & version guardrails** · **Operational command execution (`POST /websites/:slug/exec`)** · **Non-destructive .env injection & merge** · `start`/`stop`/`restart` · `secrets` list + reveal · the **whole file manager** (`/files/*`, site + host/tenant scope) · `GET /tenants` · `ws/ticket` + `WS /pty` (site and host, confined to the site) · **databases & caches**: `db-engines`, list/create/get/patch, `rotate-password`, `reveal`, `connection-string`, bin/restore/purge, `recycle-bin`, **`tables`/`query`** for every engine, the gated **`gui`** family (tool list + hosted **pgweb**/**phpMyAdmin**, plus **DbGate** as a per-database container), and a real logical **`export`** · **Domains & Automated SSL/TLS**: `domains` list/`POST`/`DELETE`, Cloudflare Tunnel vs Direct IP routing mode detection (`isTunnelConnected`), ACME Let's Encrypt automated issuance with preflight DNS check, self-signed local generator, custom cert upload, 301 Force HTTPS redirection, HSTS headers, and vhost hot-reload · **Website Telemetry & Traffic Map** (`GET /websites/:slug/telemetry` + SSE stream, implemented in code, pending live host verification) · **Universal Git Providers & Deploy Keys** (`GET /websites/:slug/git/deploy-key`, rotate, `/git/providers`) · **Push-to-Deploy Webhooks** (`POST /api/v1/webhooks/deploy/:slug` & `/webhook/:slug/deploy`) · **Centralized Cron & Scheduled Tasks** (`GET\|POST\|PUT\|DELETE /api/v1/cron/jobs`, `POST /api/v1/cron/jobs/:id/run`) · **In-Panel Self-Update (OTA Engine)** (`GET /api/v1/system/updates/check`, `POST /api/v1/system/updates/apply`, `GET /api/v1/system/updates/stream`) | Pods (Docker) · backups & migration · MCP server · per-app access control (503, basic auth, anti-brute-force) · per-site custom php.ini directive editor |

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
- **Serving rules (normative):** an unknown **`/api/*`** route always returns the JSON `404` above — it must never fall back to the single-page app, or a client parsing JSON receives HTML. Any *page* path instead serves `index.html`, because deep links such as `/web/<slug>/files` (or legacy `/apps/<slug>/files`) are resolved by the client router on refresh. The client is responsible for correcting a path it does not recognise to a route it does show (it replaces the URL rather than leaving the address bar disagreeing with the screen).

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

**Hardcoded values that must move to the API:** tenant identity (the signed-in account, never a name baked into the UI), public IP, path `/home/<tenant>/web/<site>`, systemd unit names (`php8.4-fpm`, `gunicorn-*`, …), per-version DB ports.

> **Terminology:** the UI calls these entities **"Websites"** (previously "Apps"). The API path is `/websites`; `WebApp` in the frontend types is the same entity.

---

## 4. Endpoints by Module

### 4.1 Auth, Profile & Session
- **`POST /auth/password`** `{ currentPassword, newPassword }` (session + CSRF) → `200 { status: "changed", signedOutEverywhere: true }`. The current password is verified (`403` when it is not right, `400` when the new one is under 12 characters) and **every session for the account is invalidated**, the caller's included — the store's own rule, and what the CLI does. Both outcomes are audited (`auth.password_change`, `auth.password_change_refused`).
- `POST /auth/login` `{ username, password, totpCode? }` → sets the session cookie, `200 { user, csrfToken }`. For an account with a **confirmed** TOTP secret, the password alone is not enough: a missing or wrong `totpCode` answers `401 { code: "totp_required" }` and no session is created.
- **TOTP (two-factor):** `GET /auth/totp` → `{ enabled }`; `POST /auth/totp/setup` → `{ secret, otpauthUrl }` (stores an unconfirmed secret, encrypted); `POST /auth/totp/enable` `{ code }` → `{ enabled: true }` (a valid code confirms it); `POST /auth/totp/disable` `{ code }` → `{ enabled: false }`. Secrets are AES-256-GCM under the panel key, and the code accepts the current 30-second step plus one either side for clock skew.
- `POST /auth/logout`
- `GET /auth/me` → `{ user, csrfToken, elevated, permissions }`
- **CSRF:** every state-changing request carries `X-CSRF-Token`, and the token is returned by **`/auth/me`** as well as by login — a client must store it on *every* session read, because a reloaded page restores its session from `/auth/me` and would otherwise fail every write with `403 { code: "csrf" }`. A missing or stale token is rejected, never ignored.
- `POST /auth/verify` (re-auth for revealing DB passwords / sensitive actions)
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
    "env": { "APP_KEY": "base64:…", "CUSTOM_VAR": "value" },
    "automationSteps": ["composer install …", "php artisan migrate --force"]
  }
  ```
  `env` is an optional `Record<string, string>` map. The deployment pipeline (`stepWriteEnv`) reads pre-existing `.env` (or `.env.example`) and non-destructively merges custom variables alongside database credentials (`DB_*`, `DATABASE_URL`) and Redis cache configurations (`REDIS_*`, `CACHE_STORE`, `CACHE_URL`). Existing keys and secrets are never wiped out or overwritten by blank defaults on redeployment.
  `source.kind` ∈ `scaffold | github | upload | existing | default`. For `upload` the archive is sent to `POST /websites/:slug/files/upload`; for `existing` the directory must exist **and not be empty** (the daemon returns `409` otherwise, and the job fails with an actionable message); for `default` the daemon writes a single `index.html` (owned by the tenant) and nothing else, so a website can exist and answer before its application does — and a static site needs no `version` (`static` and `proxy` are version-less by contract, which the validator now accepts).
- `source.kind = scaffold` runs the framework's download **and writes its starter entrypoint** when that file is absent (never overwriting uploaded or cloned code), so the site runs as promised: Flask/FastAPI get an `app.py` exposing `/` and `/healthz`, and FastAPI's unit starts gunicorn with an ASGI worker. For Python, virtual environment creation uses the chosen version (`python<version> -m venv .venv`, e.g. `python3.12`) rather than an unversioned system default. A preset that only installed packages would deploy a site that cannot start.
- **`POST /websites/prepare-directory`** `{ slug, tenantUser }` → `201 { slug, tenantUser, path, created, existed, mode }`. **Tenants have no shell on the server**, so this is how "Existing Files" is reachable from the panel: create the folder here → upload the code with the File Manager → deploy. Idempotent; also gated on `deployApps` and restricted to the caller's own tenant.
- **`DELETE /websites/:slug` has to be told what happens to the website's databases.** A SQLite file lives *inside* the site directory, so deleting the site used to take the file and leave the record behind, pointing at nothing (`409 not_ready — its file is gone`). The request now answers `409 has_databases` listing them unless it carries `?databases=keep` — the record is detached (its `websiteSlug` cleared) and a file-based database's file is **moved out of the site** into the tenant's own home — `<sites root>/<tenant>/detached/<file>`, handed back to that account so it stays reachable in their File Manager — and the record's `path` is updated, so the manager still opens it — or `?databases=delete`, which purges them with the website. A kept record carries `detachedAt` (migration 8) and `GET /databases?detached=true` lists exactly those, which is what the panel's **Detached** tab shows; the mark is cleared if the record belongs to a website again.
- **`POST /websites` returns `202 Accepted`** with `{ slug, deployId, mode, status, totalSteps, stream }` — provisioning runs asynchronously. `mode` is `real` on Linux+systemd and `dry-run` everywhere else; **in dry-run nothing is started and the website stays `stopped`** (units and `.env` are still written, and the recorded commands are logged).
- **Multi-Tenant Scoping & Smart Scoped Slug Strategy**:
  - `name`: User-facing display title/name (e.g. `blog`, `portfolio`, `shop`). Distinct tenant users can create websites with identical display names without conflict.
  - `slug`: System-level unique identifier across the operating system and database.
  - **Collision Resolution Contract**:
    When `POST /websites` is invoked:
    - If `slug` is globally unassigned, the daemon allocates `slug` directly.
    - If `slug` is already owned by *another* tenant account, the daemon automatically resolves the collision by prefixing the slug with the owner's username: `<tenantUser>-<slug>` (e.g. `suprion7-blog`), returning `202 Accepted` with the resolved `slug`.
    - If `slug` is already owned by the *same* tenant account, the daemon returns `409 Conflict` (`{"slug": "this website name is already in use by your account"}`).
    - Linux Virtual Host configuration path: `/etc/<webserver>/sites-available/barepod-<resolved_slug>.conf`.
    - Systemd Service unit: `barepod-<resolved_slug>.service`.
    - Website Home Directory: `/home/<tenantUser>/web/<name>` (isolated under tenant UID/GID).
- **Collection Filtering and Sorting Contract**:
  - `GET /websites?owner=<tenantUser>&sort_by=<field>&order=asc|desc`
  - `GET /databases?owner=<tenantUser>&sort_by=<field>&order=asc|desc`
  - `GET /caches?owner=<tenantUser>&sort_by=<field>&order=asc|desc`
  - `GET /pods?owner=<tenantUser>&sort_by=<field>&order=asc|desc`
    - `owner`: Optional string to filter resources by tenant username. Permitted for `role: "admin"`; non-admin tenants are strictly scoped to their own resources regardless of parameter.
    - `sort_by`: `owner | name | status | engine | runtime | size`
    - `order`: `asc | desc` (default: `asc`).
- **`GET /websites/:slug/deploy`** → the latest job · **`GET /websites/:slug/deploy/:id?after=<logId>`** → `{ job, log[] }` (safe polling) · **`GET /websites/:slug/deploy/stream?id=`** → **SSE** `event: log` frames, closed by `event: done` with the final job. Every line is persisted, so a reconnect loses nothing.
- **`DELETE /websites/:slug`** → `200 { slug, steps[], mode }`. Full teardown: stop + disable the unit, remove the per-site drop-in and reload systemd, delete the app directory (bounded to `<sites-root>/<tenant>/web/<slug>` or legacy `<sites-root>/<tenant>/apps/<slug>` — the daemon refuses the root or a tenant home), then forget the stored secrets and the row. A second delete is a `404`.
- **`POST /websites/:slug/redeploy`** → `202` with the same envelope as create. The pipeline runs again from the **source recorded at create time** (`sourceKind`/`sourceRepo`/`sourceBranch` are part of the website model); when a row predates that field the source falls back to `existing`. A redeploy **keeps the existing database and cache** and says so in the log, and it is refused with `409 not_applicable` for a reverse proxy (nothing to build).
- The website model carries **`deployStatus`**: `pending | building | ready | failed`. Its service state (`status`) is `running`, `stopped`, or `suspended` — the last set when the owner account is suspended (§4.2.2); starting a site whose owner is suspended answers `409 owner_suspended`.
- **Failure & rollback:** if a step fails, the deploy stops, `deployStatus` becomes `failed`, and the failure is reported on the stream. Partial resources are **kept** (so the log can be inspected and the deploy retried) but are marked as unlinked: a failed database/cache is created in the Recycle Bin rather than dropped, and `POST /websites/:slug/redeploy` retries from the failed step. A website that never reached `ready` can be deleted without leaving orphans.
- `POST /websites/:slug/start|stop|restart`
- `GET /websites/:slug/metrics?range=` · `GET /websites/:slug/logs?range=`
- `PUT /websites/:slug/maintenance` · `PUT /websites/:slug/basic-auth` · `PUT /websites/:slug/anti-bruteforce`
- `GET|POST|DELETE /websites/:slug/routes` (multi-engine path routing)
- `GET|PUT /websites/:slug/env`
- `POST /websites/:slug/backup` (export per-website `.bpod`)
- **`POST /websites/:slug/exec`** `{ command: string }` → `200 { ok: boolean, command: string, output: string, durationMs: number }`. Executes an operational command inside the site directory (`/home/<tenant>/web/<slug>`) as the tenant user with timeout protection.

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
- `GET /groups` → `{ items: [{ id, name, description, permissions{10 capabilities}, limits{cpuQuotaPercent,cpuWeight,memoryMb,tasksMax,diskQuotaGb,inodeQuota,maxSites,maxDatabases}, members, isDefault, isSystem }], capabilities: [...] }` (requires the `users` capability). `POST /groups` creates a package, `PATCH /groups/{name}` edits it, `DELETE /groups/{name}` removes it — a system group cannot be deleted (`403`), and one that still has members answers `409 has_members`.
- **Accounts.** `GET /users` lists them with `{ id, username, email, role, groupName, status, createdAt, home, osExists, sites{used,max}, databases{used,max} }` and a top-level `mode`. **A Linux account is mandatory where one can be made:** `POST /users` `{ username, email?, password?, groupName }` creates it **first** and only records the panel account once it exists, so no account is left without an OS identity — a `real` host that cannot create it answers `502 provisioning_failed` / `linux_account_missing` and nothing is added. Off Linux (dry-run) nothing can be created, so the account is recorded and the response carries a `linux` block (`{ mode, home, created, quotaSet, notes[] }`) saying so, which is exactly the `osExists: false` the list then shows. `POST /users/{id}/provision` creates (or reconciles) the Linux account for an account that predates this rule — the repair path behind the screen's Provision action. When a password was not given, the response carries a generated `password`+`passwordShownOnce`. `PATCH /users/{id}` `{ email?, groupName?, status? }` changes the package (re-applies the quota) or the status (mirrors `usermod --lock/--unlock` and revokes that account's sessions). **Suspending carries down to the account's services:** every website it owns is stopped and marked `status: "suspended"` (so the state is visible and a start is refused with `409 owner_suspended`); reactivating marks them `stopped`, left for the operator to start. `DELETE /users/{id}` refuses with **`409 has_resources`** (naming the websites and databases) while the account still owns anything, and refuses `self_action` / `last_admin`; otherwise it removes the panel row **and the Linux account with its home** (`userdel -r`), because the two must not drift apart — a drifted account has nothing to remove and is simply forgotten, and a failed removal keeps the row so they stay in step. `POST /users/{id}/password` resets it and signs that account out everywhere.
- **The role follows the package:** an account whose `groupName` is the Root package is `role: "admin"`; any other package is `role: "user"`. Cross-tenant visibility keys off `role` and capabilities off the group, so the two are kept in step — a Root member is an admin and nothing else is.
- New error codes: `no_such_group`, `has_resources`, `has_members`, `last_admin`, `self_action`, `owner_suspended`, `provisioning_failed` / `linux_account_missing`.
- Capabilities: `deployApps`, `fileManager`, `terminal`, `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`, `apiTokens`. `GET /auth/me` returns the caller's **effective permissions**, resolved from the group.
- **Enforcement is per account, never global:** a route whose capability is missing returns `403 { code: "capability_required" }`, and resource routes are scoped to the caller's own resources (another tenant's object returns `404`, even when the capability is granted). **Admins are the single exception** — they see and manage every tenant.
- **Backup, migration and every future module follow the same rule:** capability from the package + ownership of the resource; a package that lacks a capability cannot use that module at all.
- **A group is also the tenant package (resource limits).** Each group carries per-member limits — `cpuQuotaPercent`, `cpuWeight`, `memoryMb`, `tasksMax`, `diskQuotaGb`, `inodeQuota`, `maxSites`, `maxDatabases` (`0` = unlimited). They are applied to the website's systemd drop-in (`MemoryMax`, `CPUQuota`/`CPUWeight`, `TasksMax` — cgroup v2) and to the tenant's disk quota (`setquota`); `maxSites` is enforced when creating a website. `cpuQuotaPercent` is the hard cap and `cpuWeight` the proportional share: **which one is written is decided by the sharing policy** (see `GET /system/settings` → `overcommit`). Both are stored at once, so switching the mode loses neither. The package editor shows only the active one — the quota in hardcap mode, the share in sharing mode.
- **Sharing (overcommit).** `overcommit` names the resources whose package limits stop being reservations. A **shared CPU** is written as `CPUWeight=` instead of `CPUQuota=` (so idle sites lend their cores instead of each being pinned to a fraction of one); a **shared RAM or disk** keeps its per-site cap (`MemoryMax=`, `setquota`) — only the *total* may exceed the host, which is ordinary thin-provisioning. The choice is applied to every deployed site immediately (its resource-controls drop-in is rewritten and systemd reloaded), not at the next deploy.
- **Where the kernel cannot enforce a disk quota, the panel does — and says so.** `GET /users` reports each account's **measured** disk use (`disk: { usedBytes, maxBytes }`, `maxBytes` 0 = unlimited), and on a host whose filesystem has no user quotas (an unprivileged LXC cannot enable them) a panel-driven write — `PUT …/files/content`, `POST …/files/upload` — that would exceed the package allowance is refused with `409 quota_exceeded` (the body's `quota.enforcedBy` is `"panel"`). This covers what the panel writes; a process writing from inside the site is not stopped, which is exactly what a kernel quota is for. When the filesystem *does* have quotas, the kernel is the authority and the panel steps aside.
- `PATCH /groups/:name` `{ description?, permissions?, limits? }` → the updated group. A plan whose total (limits × members, summed over every package) exceeds the host is refused with `409 {"error":{"code":"insufficient_capacity","message":"the packages exceed this server: memory: allocated 65536 of 16384 available (400%)"}}` plus `capacity` and `usage`. **A resource in the sharing policy is never refused** — it is reported as usage, not as a problem.
- `GET /system/capacity` → `{ capacity, allocation, usage{cpu,ram,disk}, fits, exceeds[], overcommit{cpu,ram,disk}, suggested, packages[], checkedAt }`. Capacity is read **live** — cgroup v2 `cpu.max`, `/sys/devices/system/cpu/online`, `/proc/meminfo`, `statfs` of the sites filesystem — so scaling the server up or down changes the answer **without restarting the daemon**. After a scale-down `fits` becomes `false`, `exceeds` names each resource with its numbers (except the shared ones, which may exceed by design), and the daemon logs + audits `system.capacity_exceeded` once per change.
- **Pods reuse the same `Limits` model** as their Docker resource spec (Phase 3): one model, three consumers.

### 4.3 Runtime, VHost & Polyglot Runtime Configuration
- `GET /websites/:slug/runtime` → `{ runtime, version, webServer, engine, engineSupported, engineInstalled, docRoot, port, vhostPath, socket?, mode }`.
- `PUT /websites/:slug/runtime` `{ engine }` → switches the engine, rewrites the vhost and reloads the web server. A runtime **version** change is refused with `409 redeploy_required` (it rewrites the unit's ExecStart, which the deploy pipeline owns). An engine the daemon cannot write answers `501 not_supported_yet`; one that is not installed answers `409 engine_not_installed`.
- `GET /websites/:slug/vhost/preview?engine=` → `{ engine, config }` — rendered **by the daemon** (the client used to build this string itself).
- `POST /websites/:slug/php-fpm/reload` → `{ status: "reloaded", mode, pool, output }`; a non-PHP site answers `409 not_applicable`.
- `GET /websites/:slug/runtime/config` → `{ runtime, version, config }`. Returns runtime-specific tuning options:
  - PHP: `{ memoryLimit, uploadMaxSize, postMaxSize, maxExecutionTime, maxInputVars, maxChildren, idleTimeout, extensions: [] }`
  - Node.js: `{ entrypoint, packageManager, memoryLimitMb, script, nodeVersion }`
  - Python: `{ wsgiServer, workers, timeout, venvPath, pythonVersion }`
  - Ruby: `{ appServer, workers, threads, rubyVersion }`
  - Go / Rust: `{ binaryPath, args, port }`
  - Proxy / Static: `{ upstreamUrl, websocket, spaFallback }`
- `PUT /websites/:slug/runtime/config` → validates parameters against the site's `runtime`. For PHP, updates `<siteDir>/php-fpm.conf` with `php_admin_value[...]` directives and gracefully reloads the FPM pool. For daemon runtimes (Node, Python, Ruby, Go, Rust), updates the systemd unit drop-in / `.env` and restarts the service. Audited as `website.runtime_config`.
- `GET|PUT /websites/:slug/php/extensions` · `POST .../php/extensions/install` (PECL)
- `GET|PUT /websites/:slug/php/ini` (compatibility alias for `/runtime/config` on PHP sites)
- **`GET /websites/:slug/detect-framework`** → `200 { ok: true, framework: DetectedFramework }`. Inspects `composer.lock`, `composer.json`, `package.json`, `requirements.txt`, `pyproject.toml`, or `wp-config.php` in the site directory and returns detected framework metadata:
  ```json
  {
    "ok": true,
    "framework": {
      "name": "laravel",
      "title": "Laravel 12",
      "frameworkVersion": "12.70.0",
      "minPhpVersion": "8.2",
      "compatiblePhp": ["8.2", "8.3", "8.4"],
      "runtime": "php",
      "version": "8.2",
      "packageManager": "composer",
      "docRoot": "public",
      "buildCommand": "composer install --no-dev --optimize-autoloader && php artisan config:cache && php artisan route:cache && php artisan view:cache && php artisan migrate --force",
      "startCommand": "",
      "port": 8001,
      "databaseEngine": "mariadb",
      "cacheEngine": "redis",
      "isProxy": false
    }
  }
  ```
  The panel UI uses `minPhpVersion` and `compatiblePhp` to lock incompatible PHP versions (e.g. PHP 7.1–8.1 on Laravel 12) from accidental switching, preventing fatal syntax errors.
- **`POST /websites/detect-framework`** → `200 { ok: true, framework: DetectedFramework }`. Inspects an uploaded project ZIP archive (multipart) or staged directory (`{ slug, tenantUser }`) prior to website provisioning.
> **Engine support today:** All 4 engines (`nginx`, `caddy`, `apache`, `openlitespeed`) are supported site choices. A site can choose its web server engine freely in `AddAppModal` and `POST /websites`. Public ports `:80`/`:443` are managed by the active edge ingress (Nginx or Caddy), which reverse-proxies traffic to internal backend engine ports (Apache on `127.0.0.1:8080`, OpenLiteSpeed on `127.0.0.1:8088`, Caddy on `127.0.0.1:8081`).

### 4.14 Stack (host-level platform choices)
> Reading it is for anyone signed in; changing and installing are administrative (`users` capability) and audited.
- `GET /system/stack` → `{ webServer:{active,supported,installed[],available:{engine:[versions]},latest:{engine:version},webUser,vhostsPath}, components:[{name,label,kind,versions,description}], databases:[Engine], databaseVersions:{engine:installedVersion}, databaseAvailable:{engine:[versions]}, databaseLatest:{engine:version}, repositories:[{name,label,present,group,path}], runtimes:{php,node,python,ruby,go,rust}, php:{installed,default}, node:{installed,default}, installRunning, activeJobId, mode }`. Everything about *installed* is detected, never stored: the web servers from `nginx -v`/`caddy version`, each database engine from its own client's version banner (`installedVersion`; MariaDB's `Distrib` number is preferred over the protocol version its banner starts with), and each language from `python3 --version`, `ruby --version`, `go version`, `rustc --version`, `php-fpm*`, `node --version`. Each `runtimes` entry is `{installed, available, supported, latest, upToDate, labels, perSite, source}`. **`available` is read from the host's repositories or the vendor's own index** — `apt-cache search` against the source's package pattern for PHP (Sury), Python (deadsnakes) and Ruby (the prebuilt `ruby3.x` packages); `apt-cache madison`/the vendor feed for Go; **Rust exposes the 3 official Rustup channels (`stable`, `beta`, `nightly`)** without bloating the UI with 100+ git release tags or false upgrade prompts; nodejs.org's `index.json` plus its release schedule for Node, which is why Node offers **Current plus the LTS lines still in support**, each named in `labels` ("current", "LTS Krypton"). Nothing is kept in code: a version the repository adds appears without a release of the panel. `supported` is the short list the screen draws first (all of PHP; the newest three for Go; four lines for Python; the 3 channels for Rust) and `available` still carries everything for a project that pins an older one. `upToDate` is the daemon's answer, not a string comparison in the browser: a Rust channel is a moving name, so rustc is asked what `stable` points at. `perSite` marks the interpreted runtimes (PHP, Node, Python, Ruby) against the build-time toolchains (Go, Rust). Ruby is **prebuilt only** — rbenv compiled it from source, which took minutes per version and could be killed by a deploy; the packages install in seconds. When an install is running, `activeJobId` provides the active job ID so that page refreshes in the frontend immediately reconnect to the SSE log stream. Components: `nginx`, `caddy`, `php`, `node`, `python`, `ruby`, `go`, `rust`, `postgresql`, `mariadb`, `mongodb`, `redis`, `php-extensions`.
- **A database's version is not chosen at creation.** One version per engine is installed (and recorded) from the Stack, so neither Add Database nor the deploy wizard offers one — the daemon records the engine's version on the record. Installing any PHP version dynamically scans all available repository extension packages via `apt-cache search` (~75–85 modules per version) and installs them in full, safely filtering conflicting alternatives (`gmagick`, `yac`, `openswoole`, `phalcon5`) and non-extension binaries (`-fpm`, `-cli`, `-dev`, `-dbg`, `-pear`, `lib*`). All installed modules are automatically enabled via `phpenmod -v <version> ALL` so they are immediately available for toggle.
- `PUT /system/stack/web-server` `{engine}` → writes **every** site's vhost for the new edge ingress engine, validates once, grants the new web user read access, then swaps the edge ingress holding `:80`/`:443`. In the Hybrid Multi-Engine architecture, backend web servers (Apache on `:8080`, OpenLiteSpeed on `:8088`, Caddy on `:8081` & `:8445`, Nginx on `127.0.0.1:8082` & `127.0.0.1:8444 ssl`) remain active and enabled in systemd, so all 4 web server engines run concurrently without port collision:
  - **Caddy Port & Scheme Isolation:** When Caddy runs as backend, global options specify `http_port 8081` and `https_port 8445` (port 8443 is strictly reserved for the BarePod Panel daemon). Site vhosts define plain HTTP listeners using the `http://<domain>` scheme rather than hardcoded `<domain>:80`, ensuring Caddy dynamically inherits `http_port` and never attempts to bind physical port 80 when running as backend.
  - **Nginx Worker Permissions:** Nginx worker processes are configured as `user www-data;` (and user `nginx` is added to group `www-data`). This ensures Nginx worker processes have read/write access to PHP-FPM unix sockets (`srw-rw---- <tenant> www-data`) and site docroots, preventing `13: Permission denied` upstream errors (`502 Bad Gateway`).
  - **Delimiter-Aware Python Regex Port Remapping:** Switching web server ports utilizes boundary-aware Python regular expressions across `/etc/nginx/sites-enabled/*.conf` to prevent port-prefix concatenation (e.g. preventing `80` inside `8082` from turning into invalid ports like `808282`).
  - **ACME Challenge Single-Declaration:** In Nginx vhosts, `location ^~ /.well-known/acme-challenge/` is declared conditionally (inside `if hasSSL && s.ForceHTTPS` or within `nginxServerBody`), preventing Nginx configuration test failure `duplicate location "/.well-known/acme-challenge/"`.
  - A failed validation or start puts the host back the way it was. Refuses an engine the panel cannot write (`501 not_supported_yet`) or one that is not installed (`409 engine_not_installed`).
- `POST /system/stack/install` `{component, version?}` → `202 {jobId, stream, mode, totalSteps}`. **Allowlisted components only** (the four web servers, `php`+version, `node`+major, `python`+version, `ruby`+version, `go`+minor, `rust`, `postgresql`/`mariadb`/`mongodb`/`redis`, `repositories`, and `php-extensions` with `version: "all" | "<X.Y>"`). The daemon never accepts a free-form command. Architecture for direct binary tarball downloads (Node.js, Go) is dynamically resolved via `uname -m` (`x64`/`arm64` and `amd64`/`arm64`) to prevent hardcoding. When installing Apache on Debian/Ubuntu, its port listener is automatically configured to internal port `127.0.0.1:8080` (and `8443`) before enabling and starting, ensuring Apache runs concurrently without port 80 collisions. When installing Caddy while Nginx is ingress, Caddy is assigned internal port `8081`. When `version == "latest"` or empty, the installer dynamically resolves to the newest upstream package available from the host repository (`offered[0]`) rather than rejecting the string `'latest'`. **One install runs at a time** — every apt step shares the dpkg lock, so a second is refused with `409`-shaped `bad_request` naming the running one.
  - **Real-Time Verbose Streaming (No `/dev/null`):** Each step runs as its own transient systemd unit using `host.RunDetachedStream` via a live pipe scanner. Output redirection to `>/dev/null`, `2>/dev/null`, and `-qq` is strictly prohibited in repo configuration and apt installation scripts; every line of stdout and stderr (package downloads, uncompressing, configuration progress) is streamed live via Server-Sent Events (`GET /system/stack/jobs/stream?id=`).
  - Every job starts with `dpkg --configure -a`, because a daemon restart under a running apt leaves dpkg half-done and every later apt step then fails. In dry-run the commands are recorded and nothing is installed. An install no longer decides a version: a site's version is chosen when the site is created (the create request requires one), so nothing is recorded as a "default" any more.
- `POST /system/stack/repair` → `200 { message, actions[] }`. Diagnostic auto-healing across core database engines and web servers. Automatically heals web server log directory permissions (`0664`, `caddy:caddy`, `www-data:adm`, `nobody:nogroup`), clears stale PID lockfiles, isolates incompatible legacy configs, resets failed systemd units, and ensures `systemctl enable` is active. Also runs periodically in the background via watchdog.
- `POST /system/stack/uninstall` `{component, version}` → `202 {jobId, …}`. One rule: **refused while a project uses it** — a site whose runtime and version match (`409 version_in_use`, naming the sites), a database on that engine (naming the databases), or the **active ingress** (every site is served by it). The last copy of a runtime is removable: an operator who does not want Rust on the host should be able to say so. Removal is per version everywhere: a PHP version, a Node major, a Go toolchain, a Ruby package, `postgresql-16`, an image tag (`docker rmi mongo:8.0`), and a web server's installed version. For PHP, removal purges packages and cleans up leftover configuration directories (`rm -rf /etc/php/<version>`). A database engine's data directories are **named in the log and left in place** — removing an engine is not shredding it.
- `GET /system/stack/plan?component=&version=&action=` → **the dry run**: `{component, version, installed, steps[], uses[], warnings[], safeToRun, mode}`. Answers what a database switch (`action=switch`) or removal (`action=uninstall`) would do and what it would touch, without changing anything. For a database switch, this includes migration steps, data dump recommendations, and identifying at-risk databases (`safeToRun` is false when in use). The frontend StackView renders this as an interactive pre-flight preview modal before executing database version switches. Uninstalls across runtimes and web servers use a dedicated confirmation modal with live dependency checks.
- `GET /system/stack/jobs/{id}?after=` → `{job, log[]}` · `GET /system/stack/jobs/stream?id=` → **SSE** (`event: log` … `event: done`), exactly the deploy shape, resolved by id because an install belongs to no website. Auto-reconnectable on page refresh via `activeJobId`.

**One rule for removal: nothing may use it.** `POST /system/stack/uninstall` refuses a site's runtime version (naming the sites), a database engine any database is on (naming the databases), and the active ingress (every site is served by it). Everything else goes, per version everywhere — a PHP version, a Node major, a Go toolchain, a Ruby package, `postgresql-16`, an image tag — and a database engine's data directories are named in the log and left in place, because removing an engine is not shredding it. Detection in `phpext.InstalledVersions()` requires actual binaries (`php-fpm<version>`, `php<version>`) or valid configuration files, preventing empty ghost directories from persisting in installed runtime listings.

**Web servers are version-managed; all 4 run concurrently.** `webServer.managed` lists every engine the panel keeps versions for (`nginx`, `caddy`, `openlitespeed`, `apache`), `webServer.managedInstalled` carries their real state, and `available`/`latest` are keyed by engine. Their repositories come from the same `repositories` step (nginx.org, Cloudsmith, ondrej PPA, LiteSpeed's own). Detection follows the package rather than PATH: OpenLiteSpeed installs into `/usr/local/lsws/bin` and its service unit is `lshttpd`. Port 80/443 collision is prevented by dedicating public `:80`/`:443` to the edge ingress (Nginx or Caddy) and assigning internal loopback ports to backend engines (`apache2` on `:8080`, `lshttpd` on `:8088`, `caddy` on `:8081` & `:8445`, `nginx` on `:8082` & `:8444`).

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
- **A Redis cache is an isolated per-app loopback instance + ACL user:** each cache record is assigned a per-app hostname (`redis-<site>` or `redis-<alias>`) on port `6379`, mapped to a dedicated loopback IP (`127.0.0.x`, skipping `.1`, `.53`, `.54`) in `/etc/hosts` (`# barepod-cache <name>`). On a real host with a dedicated loopback IP, the daemon runs an ultra-lightweight diskless `redis-server` (`--save "" --appendonly no`, `databases 1`, `hz 10`, `maxmemory <mb>mb`, `maxmemory-policy allkeys-lru`, `requirepass` + ACL rules) bound strictly to that loopback IP, and applies `ACL SETUSER <user> reset on ><password> <key-pattern> +@all -<dangerous…>` followed by `ACL SAVE`. Suspend is `off`, restore is `on`, rotation is `resetpass ><password>`, `maxMemoryMb` updates `CONFIG SET maxmemory <mb>mb` + `allkeys-lru`, and purge stops the dedicated instance and removes its `/etc/hosts` entry.
- **Caches (Redis) are a separate resource:** `GET|POST /caches` · `GET|PATCH|DELETE /caches/:id` · `POST /caches/:id/rotate-password`
  - A **website's** Redis cache is one of these records too: the deploy wizard creates a `kind='cache'` row with `host = "redis-<slug>"`, `port = 6379`, and the same credentials as the app's `.env`, so `GET /caches` lists it and the hosted GUI (`GET /caches/:id/gui/…`, DbGate) can attach to it. Creating or rotating a website-linked cache from the panel **rewrites `CACHE_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, and `REDIS_PASSWORD` in place** inside `<siteDir>/.env` without requiring a redeploy.
  - Each cache user is written with `ACL SAVE` (so it survives a Redis restart) and denied the dangerous command set (`flushall`, `swapdb`, `restore`, `config`, `acl`, `shutdown`, `module`, `replicaof`, `migrate`, …). `FLUSHDB`, `KEYS` and `INFO` stay allowed on purpose — `php artisan cache:clear` and libraries call them. A cache belonging to a website keeps the deploy's `~*` scope (its app prefixes its own keys); only a standalone cache record is scoped to `<user>:*`.
  - **A cache never leaves loopback:** `POST /caches/:id/exposure` (or `POST /databases/:id/exposure` on a `kind='cache'` record) is always refused with `409 not_applicable`.
- `GET /db-engines` (versions + shared-daemon ports; SQLite reports `fileBased: true`, `port: null`) — and **`mode`** per engine: `docker` when the panel runs it as a container, `host` when it uses the host's packages (administered over the engine's own socket), `none` when neither is possible, always with the reason. **`available` means the panel can provide that engine, and `mode` says how:** an engine with nothing installed is still `available: true` when this host runs containers (`mode: "docker"`, with `running` reporting whether the panel's container is already up), because the drop-down locks on `available` — reporting "not installed" there hid an engine the panel runs perfectly well (MongoDB was unselectable while its container was up). A container engine runs on the **host network** and listens on its own loopback port (5433/3307/27018/6380) rather than publishing a port, because publishing needs a docker bridge and iptables that an unprivileged container does not have — and the host's loopback is where a tenant's application looks anyway. Nothing about where an engine runs is implicit.
- **Detected databases exist alongside managed ones.** `GET /databases` also returns SQLite files found inside the caller's websites with `detected: true`, an id of the form `det:sqlite:<base64url>` (**one path segment on purpose**, so routing and logs stay clean) and no credential. `GET /databases/:id/tables` and `POST /databases/:id/query` accept that id; `DELETE`/`rotate`/`reveal` answer **`409 app_managed`** because the file belongs to the application — use the File Manager to delete it. A file the ledger already manages is never listed twice, and the scan is bounded (depth 3, 25 files, dependency and build directories skipped).
- **`GET /caches/:id/key?key=<name>`** → `{ key, type, ttlSeconds, value, truncated }` for a cache — read with the pure-Go client; a key **outside this cache's prefix answers `404`**, exactly like a key that does not exist (the refusal is never leaked as a server error).
- **`GET /databases/:id/tables`** → `{ engine, tables[], browser }` — the daemon reaches every engine with a **pure-Go driver** (`browser: daemon-driver`, `browser: daemon` for SQLite), so **no client has to be installed** for browsing or querying, `{ engine: "redis", keys[], keyCount, note }` for a cache (scoped to its own prefix). **`POST /databases/:id/query`** `{ sql }` → `{ columns[], rows[][], truncated, rowsAffected, kind }`, capped at 500 rows with `NULL` rendered explicitly; it runs **as that database's own user**, so the panel can do no more than that account could, and an engine's refusal comes back with its own code (`SQLSTATE 42501`-style) rather than as a result grid. Each run is audited as `database.query` with the row count, **never the statement text** (it can carry values).
- **`GET /databases/:id/gui`** → `{ database, tools: [{ tool, description, available, path }] }`. The catalog is the decided shape — `browser` (the panel's own table browser / cache-key inspector), `pgweb` (PostgreSQL), `phpmyadmin` (MySQL/MariaDB), and `dbgate` (a container, for SQLite, MongoDB, Redis, PostgreSQL and MySQL/MariaDB) — and **`available` is real**: a tool that needs a binary (or an install) is offered only when it is on the host *and* the daemon is running for real, and one that is not hosted says why. **`GET /databases/:id/gui/:tool`** → where to open one (`{ tool, available, path }`); for `dbgate` it also triggers an asynchronous warm-start (`warmDbGateAsync`) so the container is already booting before the browser opens the window. A tool that is not hosted answers `501 not_installed` with the rule.
- **`GET|POST /databases/:id/gui/:tool/…`** is the manager itself, reverse-proxied **under the panel's own path**. While a manager is still starting, the daemon returns HTTP `200` with header `X-BarePod-Manager-Status: starting` and a non-flashing auto-polling page that polls `fetch()` with `X-BarePod-Poll: 1`, re-triggers container startup if a prior attempt exited, and calls `window.location.replace(...)` as soon as the manager is ready (never getting stuck on a static retry limit). Once a container is marked serving for that record, sub-resource and asset requests skip `docker info` and provisioning checks and proxy directly. `pgweb` is started on first access on loopback, told its exact mount so its own links stay inside, with this database's credential injected into `--url` and the tool locked to that one connection. `phpmyadmin` runs on **PHP's built-in server** (`php -S`, no Apache/FPM) with a per-database `config.inc.php` (root 0600) using `auth_type=config` + `only_db` — so it opens exactly that database **with no login** — and `PmaAbsoluteUri` set to the mount; the proxy strips the mount so phpMyAdmin sees its own root. **The panel session is required** — without it every request answers `401 unauthenticated` (a browser gets the sign-in screen, never a database tool). Because the tool's own client cannot send our `X-CSRF-Token`, the page load issues a **path-scoped `HttpOnly; SameSite=Strict` cookie** that every further request under the mount must present; a cross-site request carries the session cookie (Lax) but not this one, so a `POST …/api/query` without it is `403 csrf`. Opening one is audited as `database.gui_open`.
- **A refusal is a page for a browser and JSON for a client.** A request that accepts HTML on a manager's mount gets the panel's own page with the reason on it (the same look as the status page); a request for data keeps `{"error":{"code",…}}`. An unauthenticated browser is redirected to `/login` (which remembers where it was going) rather than shown `401` JSON.
- **A record that is not `ready`** (a create whose engine client was missing, or one that failed) **or is in the recycle bin answers `409 not_ready`** with the record's own note — no manager is started, so the answer is immediate instead of a tool that dies on a database that was never created and waits out its startup timeout. When a started tool fails anyway, the failure carries **the tool's own output** (captured beside the panel database), not a bare timeout.
- **The anti-brute-force watchdog has three routes and one rule.** `GET /system/guard` answers the state the Settings → Security screen shows: the thresholds in force, including a per-engine override where one is set, and the addresses currently kept out. `PATCH /system/guard` changes them — how many refusals in what window keep an address out for how long, per engine or for all of them — and `POST /system/guard/unban` releases one address. Both of the changes require the admin capability, and every ban and release is audited. What a ban closes depends on what it was earned on: the panel's port for a panel ban, SSH's port for an SSH ban, and the whole host for an engine ban, because an address attacking PostgreSQL has no business reaching anything else. Addresses on the never-ban list are never banned, matched as an exact address or a network, and an address that signs in successfully is added to that list. A `public` exposure is refused with `409 guard_required` whenever the watchdog is not enforcing — the honest gate, since a public port with no lockout is the thing this exists to prevent.
- **Exposure is a decision with a result, applied per engine.** `POST /databases/:id/exposure` takes `private` or `public` and answers with what was applied and what was not, for the engine in question: PostgreSQL through `pg_hba.conf`, MariaDB through an account that may connect from anywhere, SQLite and Redis caches refused (`409 not_applicable` — a file has no network and a cache never leaves loopback), and MongoDB answered honestly where the panel cannot yet restrict it. **MariaDB is opened by the panel itself**: its `bind-address` is written in `/etc/mysql/mariadb.conf.d/50-server.cnf` and MariaDB is restarted, because the setting takes effect only then — and the file is put back if MariaDB does not come up again, so a failed exposure cannot leave a database unreachable.
- **Panel settings and ports are the daemon's own state, not a mock.** `GET /system/settings` answers `{ externalAddress, trustedAddresses }`: the address external clients should use (a bare hostname or IP, and the one every connection snippet prefers for a public database), and the addresses the lockout must never ban, matched as an exact address or as a network, added automatically from wherever an operator signs in. `PATCH` takes either field: each entry is validated as an address or a CIDR and nothing else (one that is neither would be counted as protection while protecting nothing), the change is audited as `panel.trusted`, and an empty list exempts nobody. `GET /system/ports` answers what the host is actually listening on — the panel, SSH as a list, each engine as `listening`/`not listening` — read on demand rather than assumed. `POST /system/ports/panel` rewrites the port in the unit's `-listen` flag, keeps the previous unit alongside, `daemon-reload`s, and answers before asking systemd to restart (non-blocking, because the restart is this process ending); it refuses `0`, anything above 65535, anything below 1024, the port the panel already uses, and **a port any active service already holds — naming it**, read from `ss -ltnp`, so the panel cannot be moved onto SSH's port or onto PostgreSQL's. `POST /system/ports/ssh` adds or removes one `Port` line, validates with `sshd -t` (the only authority) and reloads, putting the file back if either refuses. The UI offers one **Change** per port: it adds the new port, verifies sshd accepts it, and only then removes the old one, so a failure leaves the host with more access rather than less.
- **These are paths on the panel, not a GUI on a port.** Nothing is published or firewalled: a manager is proxied behind these routes (credentials injected server-side, page + assets rebased onto the mount, **stopped after an idle window** — default 15 minutes, `-dbtools-idle`), leftovers are reconciled at daemon start (`database.gui_idle` is audited), and a manager is never exposed directly.
- **DbGate is one container per database, on demand.** Each record gets its own container (`barepod-dbgate-<record id>`), its own loopback-only port from a fixed range, and its own `WEB_ROOT`, so several databases — and several accounts — can have the manager open at once. A single shared container could not: it had to be restarted for the second database, which closed the page the first one had open (DbGate's own "Database connection closed"). The instance is started on first access, the port is released when it stops, and a run with the range exhausted answers `409 busy`. At daemon start leftovers are cleared by the shared name prefix. The port is never published outside loopback, and a container is only reused when its own `WEB_ROOT` is this record's mount.
- **DbGate is a container, so how it reaches an engine is part of the contract, and it is decided per engine:** an engine the panel runs as a container is reached through the **docker bridge gateway** (a container shares the host network; `127.0.0.1` inside DbGate is its own loopback); an engine installed on the host — which listens on the host's loopback — is reached over its **unix socket**, mounted read-only into the container (`/var/run/postgresql`, `/run/mysqld`) and selected with the plugin's own fields, `CONNECTION_bpod_authType=socket` + `CONNECTION_bpod_socketPath=…` (DbGate takes any connection field from env that way; plain `AUTHTYPE_bpod` is not one it reads); a per-app Redis cache listening on a dedicated loopback IP (`127.0.0.x:6379`) is bridged on demand via an ephemeral listener on the Docker bridge gateway (`ensureRedisGatewayBridge`) and cleaned up when the container stops. A manager opened for an engine whose stored address predates its mode also **repairs that record** (a MongoDB record saying 27017 while mongod listened on 27018), so the address the panel hands out is the one something is listening on.
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

### 4.7 Cloudflare Zero Trust Tunnels & Ingress Routing
- `GET /api/v1/tunnels/status` (query `?user=<tenant>`) → `200 TunnelStatusResponse`.
  Before returning the list it **removes unclaimed ingress routes**: a route whose hostname is not a current website domain/alias, is not the panel's own `panel_fqdn`, and whose `app_name` does not resolve to an existing website is deleted in Cloudflare and locally. This is what cleans up rows left by an older delete (and entries that were never linked to a site).
  - Returns tunnel daemon health, isolated tenant user `@<tenant>`, systemd unit `barepod-tunnel@<tenant>.service` state (`connected` | `configuring` | `disconnected`), `daemonPid`, RSS `memoryUsage`, `uptime`, `hasToken`, `tokenMasked`, `hasApiToken`, `autoSync` boolean, and `accounts[]` list for admin persona switching.
  - Returns `routes[]`: active ingress rules (`id`, `hostname`, `service`, `appName`, `status`, `createdAt`).
  - Returns `availableApps[]`: list of tenant's installed applications with auto-mapped Edge Ingress `targetUrl: "http://127.0.0.1:80"` (ensures public tunnel traffic enters via Primary Edge Ingress reverse proxy rather than raw internal backend ports).
- `POST /api/v1/tunnels/token` → Body `{ token: string, apiToken?: string, tunnelName?: string, user?: string }` → `200 TunnelStatusResponse`.
  - Saves the Cloudflare Zero Trust run token (`eyJh...`) and optional API token.
  - Automatically provisions systemd unit `/etc/systemd/system/barepod-tunnel@.service` and executes `systemctl enable --now barepod-tunnel@<user>.service`.
  - When Cloudflare API token is provided with `Account.Tunnel` and `Zone.DNS` permissions, enables **1-Click Auto Sync** to create Public Hostnames and DNS CNAMEs in Cloudflare Zero Trust automatically.
- `GET /api/v1/tunnels/zones` (query `?user=<tenant>`) → `200 { zones: CloudflareZone[] }`.
  - Queries Cloudflare API (`GET /zones?status=active&per_page=50`) to retrieve all verified DNS domains/zones owned by the user's Cloudflare account.
  - Used by UI to provide a zone select dropdown (`*.domain.com`) + subdomain input (`app`, `api`, or `@` for apex domain) with live hostname previews.
- `POST /api/v1/tunnels/routes` → Body `{ hostname: string, service: string, appName?: string, noTLSVerify?: bool, user?: string }` → `201 IngressRouteDTO`.
  - Registers a new ingress hostname rule. If `service` is omitted, defaults to `http://127.0.0.1:80` (BarePod Edge Ingress).
  - If Auto-Sync is active, calls Cloudflare API (`POST /accounts/{account_id}/cfd_tunnel/{tunnel_id}/configurations`) to create the ingress rule and auto-creates the DNS CNAME record in the corresponding Cloudflare Zone.
  - Supports `noTLSVerify: true` to bypass origin certificate checks when proxying to local self-signed HTTPS endpoints (such as port 443), preventing `502 Bad Gateway`.
  - **Automatic Website Domain Synchronization**: When route is mapped to a website (via `appName`), BarePod automatically registers the public hostname into `website_domains` as an active alias and calls `applyVhost` to reload the active web server (Nginx, Caddy, OLS, Apache), making the route immediately visible under Website Details $\rightarrow$ Domains and `/domains`.
- `PUT /api/v1/tunnels/routes/:id` → Body `{ hostname: string, service: string, appName?: string, noTLSVerify?: bool, user?: string }` → `200 IngressRouteDTO`.
  - Updates an existing ingress route target URL, hostname, app label, and `noTLSVerify` flag.
  - Synchronizes changes directly to Cloudflare Zero Trust tunnel configuration and auto-syncs website domain alias in real time.
- `DELETE /api/v1/tunnels/routes/:id` (query `?user=<tenant>`) → `200 { ok: true }`.
  - Removes the route from local SQLite database, automatically deletes the public hostname rule in Cloudflare Zero Trust via API, and cleans up non-primary alias entries from `website_domains` while reloading the web server.
  - The panel UI no longer exposes a per-route delete — routes are **lifecycle-managed** (see the cascade below). The endpoint stays available to the API/MCP surface.
- `POST /api/v1/tunnels/sync` (query `?user=<tenant>`) → `200 TunnelStatusResponse`.
  - Bidirectional sync: queries Cloudflare Zero Trust API for all active ingress rules on this tunnel and synchronizes them into BarePod local database.
- `POST /api/v1/tunnels/restart` (query `?user=<tenant>`) → `200 TunnelStatusResponse`.
  - Executes `systemctl restart barepod-tunnel@<tenant>.service` to refresh the daemon process.
- **Token hygiene — the saved tokens can never be read back:** no endpoint returns the Cloudflare run token or API token. `GET|POST /tunnels/status` expose only `hasToken`, `tokenMasked`, `hasApiToken`, `apiTokenMasked`. A token can be **replaced** (`POST /tunnels/token`) but never revealed or copied from the panel.
- **Panel's own hostname (admin only)** — publishing the panel itself through the administrator's Cloudflare Tunnel, reusing the same zones:
  - `GET /api/v1/panel/tunnel` → `200 { configured, fqdn, service, accountId, tunnelId }`.
    - Detection only: `configured` is true when the admin's Cloudflare API token, account id and tunnel id are saved. `service` is the panel's own origin (`https://127.0.0.1:<panel port>`).
  - `POST /api/v1/panel/tunnel/publish` → Body `{ hostname }` → `200 PanelTunnelStatus`.
    - Validates the hostname (`validate.FQDN`), writes the ingress rule + DNS CNAME in Cloudflare, records the route (`app_name = "BarePod Panel"`), stores `panel_fqdn`, and turns `panel_use_cloudflare` on. `400 cloudflare_not_configured` when Cloudflare is not set up; `403 admin_required` for a non-admin.
  - `POST /api/v1/panel/tunnel/unpublish` → `200 PanelTunnelStatus`.
    - Removes the ingress rule + route and clears `panel_fqdn` and `panel_use_cloudflare`.
  - **Host binding:** while `panel_use_cloudflare` is on and `panel_fqdn` is set, the daemon answers **only** on that hostname (or any IP literal / loopback); any other hostname pointed at the box gets `403 host_not_allowed`. With Cloudflare off the panel answers on any address (the public-IP default) and IP access always works.
- **Cascade Deletion & Orphaned Domain Pruning**:
  - `DELETE /api/v1/websites/:slug` cascades and permanently deletes child records from `website_domains`, `website_security`, `website_cron_jobs`, `website_secrets`, and `cloudflare_tunnel_routes`. Its Cloudflare Tunnel routes are removed **in Cloudflare too** (ingress rule + DNS record, via `Client.DeleteHostname`), so a deleted site leaves no live hostname behind. Best-effort: a Cloudflare outage does not block the delete.
  - `GET /api/v1/domains` joins `websites w ON d.website_slug = w.slug` ensuring orphaned domains from deleted websites never display in the global `/domains` registry.
- **Edge Ingress Anti-Redirect Loop Pattern (`ERR_TOO_MANY_REDIRECTS` Prevention)**:
  - All web traffic from Cloudflare Tunnels arrives on plain HTTP port 80 (`http://127.0.0.1:80`).
  - Edge Ingress (Caddy) defines an explicit `:80` site block alongside the TLS block using a shared snippet `(barepod_<slug>_common)`, preventing Caddy's Automatic HTTPS from issuing 308 redirect loops back to Cloudflare.
  - Edge Ingress (Nginx) generates separate `listen 80;` and `listen 443 ssl;` server blocks with `$http_x_forwarded_proto` bypass, preventing `400 Bad Request: The plain HTTP request was sent to HTTPS port`.
- **Visitor Real IP & GeoIP Header Extraction**:
  - Telemetry parser prioritizes proxy headers in order: `Cf-Connecting-Ip` $\rightarrow$ `True-Client-Ip` $\rightarrow$ `X-Forwarded-For` $\rightarrow$ `RemoteAddr`.
  - Country code resolution extracts `Cf-Ipcountry` header before falling back to local GeoIP lookups.

### 4.8 Domains & SSL / TLS Automation
- `GET /domains` (also `?websiteSlug=...`) → `{ items: ApiDomain[] }`. Lists configured hostnames. Admins see all domains across tenants; non-admin tenants see only domains attached to their owned websites. Performs an inner join against `websites` to exclude any orphaned domain records.
- `POST /domains` → Body `{ websiteSlug: string, domain: string }` → `201 ApiDomain`. Registers a new domain alias for a website, validates uniqueness and FQDN format, appends to the website's virtual host, and reloads the active web server. Refuses duplicates with `409 domain_exists`.
- `DELETE /domains/:id` → `200 { status: "deleted", id, domain }`. Detaches an alias domain from the website and reloads the web server. Deleting the website's primary domain is guarded and answered with `400 primary_domain`.
- `POST /domains/:id/ssl/issue` → Body `{ provider?: "auto" | "letsencrypt" | "self_signed", forceHTTPS?: bool, hsts?: bool, email?: string }` → `200 { status: "active", provider, domain, issuer, expiresAt, daysLeft, forceHTTPS, hstsEnabled, warning? }`.
  - Performs a DNS pre-flight check before ACME validation to prevent Let's Encrypt rate limiting. If the domain does not resolve to the host, it either returns `400 dns_unresolved` (if Let's Encrypt was explicitly requested) or automatically issues a high-grade ECDSA P-256 self-signed certificate with a helpful diagnostic warning (if `"auto"` was requested) so HTTPS immediately works.
  - Automatically provisions ACME webroot challenge files into `/var/lib/barepod/acme`, updates SQLite `website_domains`, re-renders the vhost with SSL directives and redirection rules, and gracefully reloads the web server without dropping connections.
- `POST /domains/:id/ssl/custom` → Body `{ certificate: string, privateKey: string, forceHTTPS?: bool, hsts?: bool }` → `200 { status: "active", provider: "custom", ... }`. Accepts, validates PEM syntax, verifies public/private keypair matching, writes securely to `/etc/barepod/ssl/<domain>/` (mode `0600`), and reloads the web server.
- `POST /domains/:id/ssl/toggle` → Body `{ forceHTTPS?: bool, hsts?: bool, autoRenew?: bool }` → `200 ApiDomain`. Updates redirect and security headers and hot-reloads the web server.

### 4.8.1 Website Security & Access Control
- `GET /websites/:slug/security` → `200 ApiWebsiteSecurity`. Retrieves current access control, maintenance mode, HTTP basic auth, IP allowlist/denylist, and rate limiting settings for a site. Returns safe defaults if not yet configured.
- `PUT /websites/:slug/security` → Body `UpdateSecurityRequest` → `200 ApiWebsiteSecurity`.
  - Configures **HTTP 503 Maintenance Mode** with customizable title, message, Retry-After header, and bypass IPs. Generates responsive dark-mode HTML with live SVG pulse badge and auto-refresh countdown to `/var/lib/barepod/maintenance/<slug>/index.html`.
  - Configures **HTTP Basic Authentication** (`.htpasswd` bcrypt hash stored in `/etc/barepod/auth/<slug>.htpasswd` for Nginx/Apache, and native bcrypt matcher for Caddy).
  - Configures **IP Access Control**: `allowlist` (only allowed IPs/CIDRs permitted; all others receive 403 Forbidden) or `denylist` (denylisted IPs receive 403 Forbidden).
  - Configures **Rate Limiting**: Nginx `limit_req_zone` + `limit_req` with burst control; graceful fallback on Caddy.
  - Automatically regenerates the site's vhost and triggers an atomic hot-reload on the active web server.
- `POST /websites/:slug/maintenance/toggle` → `200 { maintenanceMode: bool, security: ApiWebsiteSecurity }`. Quickly toggles maintenance mode on or off, updates the maintenance page, re-renders the vhost, and hot-reloads the web server.
- `POST /websites/:slug/basic-auth/toggle` → `200 { basicAuthEnabled: bool, security: ApiWebsiteSecurity }`. Quickly toggles HTTP Basic Auth on or off and hot-reloads the web server. Requires that a password was previously configured.

### 4.8.2 Website Telemetry & World Traffic Map (Live Stream)
> **Implementation status:** Fully implemented in backend (`internal/telemetry`) and frontend (`AppDetailPage`), passing unit tests. Awaiting live host verification against active traffic once host 172.19.1.26 is powered back on following power outage.
- **`GET /websites/:slug/telemetry?limit=300`** → `200 ApiWebsiteTelemetry`:
  ```json
  {
    "nodes": [
      {
        "id": "node-172-19-1-26",
        "name": "Host (Samarinda)",
        "lat": -0.5007,
        "lon": 117.1787,
        "x": 825.49,
        "y": 251.39,
        "isHost": true,
        "country": "Indonesia",
        "city": "Samarinda",
        "isp": "PT. Telkom Indonesia",
        "activeConnections": 1
      }
    ],
    "logs": [
      {
        "id": "log-01HQX...",
        "ip": "172.19.1.1",
        "country": "Indonesia",
        "city": "Samarinda",
        "isp": "Local Network",
        "flag": "🏠",
        "lat": -0.5007,
        "lon": 117.1787,
        "x": 825.49,
        "y": 251.39,
        "method": "GET",
        "path": "/api/v1/health",
        "status": 200,
        "bytesSent": 45,
        "durationMs": 1.2,
        "isThreat": false,
        "timestamp": "2026-10-14T06:00:00Z"
      }
    ],
    "totalRequests": 1,
    "totalThreats": 0,
    "totalBandwidthBytes": 45
  }
  ```
  Parses recent access logs from Caddy JSON (`/var/log/caddy/barepod-<slug>.access.log`) or Nginx/Apache CLF (`/var/log/nginx/barepod-<slug>.access.log`), performs in-memory cached GeoIP resolution, computes equirectangular map projection coordinates (`x`, `y` on 1000x500 SVG), maps RFC1918 private IPs to local host coordinates, and detects threat probes.
- **`GET /websites/:slug/telemetry/stream`** → **Server-Sent Events (SSE)** stream.
  Streams live telemetry updates as traffic hits the website:
  - `event: ping` → `{ id, lat, lon, x, y, country, city, isp, flag, isThreat, timestamp }`
  - `event: log` → `ApiTelemetryLogItem`
  - `event: stats` → `{ totalRequests, totalThreats, totalBandwidthBytes }`
  Automatically reconnects in browser via standard `EventSource`.

### 4.8.3 Universal Multi-Tenant Git Providers & Deploy Keys
> **Implementation status:** Contract and database schema designed; planned for Phase 3.
- **Multi-Tenant Git Isolation:** All provider tokens are scoped to the authenticated tenant (`user_id`) in `user_git_providers` and encrypted with **AES-256-GCM**. Non-admin tenants cannot view, use, or mutate another tenant's Git connections.
- **`GET /me/git/providers`** → `{ items: ApiGitProvider[] }`.
  Returns the authenticated user's configured Git providers:
  `{ id, name, provider: "github" | "gitlab" | "gitea" | "bitbucket" | "custom", baseUrl?, username?, createdAt, lastSyncedAt? }` (tokens are never returned).
- **`POST /me/git/providers`** → Body `{ name: string, provider: string, baseUrl?: string, token?: string, username?: string }` → `201 ApiGitProvider`.
  Connects a new provider account for the current user. Validates credentials against provider API where applicable.
- **`DELETE /me/git/providers/:id`** → `200 { status: "deleted", id }`.
  Removes a provider integration for the current user. Refuses deletion with `409 in_use` if active websites rely on automatic branch syncing through this provider.
- **`GET /me/git/providers/:id/repos?page=1&per_page=30`** → `{ repos: ApiGitRepo[], page, perPage, total }`.
  Fetches available repositories the user has access to from the Git provider API:
  `{ fullName, defaultBranch, isPrivate, cloneUrl, sshUrl, description? }`.
- **`GET /websites/:slug/git`** → `200 WebsiteGitStatus`.
  Auto-detects live repository status from server disk (`/home/<tenant>/web/<slug>/.git`):
  `{ repo, branch, commit, commitMessage, detected: bool, autoDeploy: bool, deployHookToken, webhookUrl, deployKey?: ApiDeployKey, deployScript?: string, framework?: DetectedFramework }`.
- **`PUT /websites/:slug/git`** → Body `{ repoUrl?: string, branch?: string, deployScript?: string, autoDeploy?: bool }` → `200 { status: "updated", ... }`.
  Updates Git configuration, deployment build script, or toggles auto-deploy on push.
- **`GET /websites/:slug/detect-framework`** → `200 DetectedFramework`.
  Inspects existing site directory on disk (`composer.json`, `package.json`, `requirements.txt`, `go.mod`, etc.) and returns auto-detected runtime, framework, docRoot, and recommended CI/CD build script.
- **`POST /websites/detect-framework`** → `200 DetectedFramework`.
  Vercel-style zero-config project inspection. Supports:
  1. `multipart/form-data` with `archive` file (inspects uploaded `.zip` in memory without writing to disk).
  2. `application/json` with `{ tenant, slug }` (inspects prepared directory on host).
  Returns:
  `{ framework: string, title: string, runtime: string, version: string, docRoot: string, buildCommand: string, packageManager: string, databaseEngine: string }`.
- **`GET /websites/:slug/git/deploy-key`** → `200 ApiDeployKey`.
  Returns the website's dedicated ED25519 deploy key:
  `{ publicKey: string, fingerprint: string, algorithm: "ED25519", createdAt: string }`.
  The private key is stored at `/home/<tenant>/.ssh/id_ed25519_<slug>` with `0600` permissions and never exposed via the API.
- **`POST /websites/:slug/git/deploy-key/rotate`** → `200 ApiDeployKey`.
  Generates a fresh ED25519 keypair, archives the old key, and returns the new public key for pasting into the repository's Deploy Keys.
- **`POST /webhooks/deploy/:slug?token=<deployHookToken>`** → `202 Accepted { deployId: string, slug: string, stream: string }` (or `200 { status: "ignored", reason: "auto_deploy_disabled" }`).
  Universal inbound push webhook for GitHub, GitLab, Gitea, or custom Git triggers. Public endpoint (no cookie/session required; authenticated strictly via URL query `token`).
  - Verifies `token` against the website's vaulted `deployHookToken`.
  - Checks if `autoDeploy` is enabled (`site.AutoDeploy`). If disabled, safely ignores webhook execution.
  - When enabled, dispatches an asynchronous deployment job (`internal/deploy`): executes `git fetch` and `git checkout <branch>` as the tenant UID/GID, runs framework build/migration steps (`stepRunBuildScript`), updates cgroup limits, and hot-reloads the service.
  - Streaming build logs available at `GET /websites/:slug/deploy/stream?id=<deployId>`.

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
- `GET /system/settings/php-defaults` → `{ config: PhpDefaultsConfig, installedVersions: string[] }`
  Returns baseline PHP tuning blueprint directives (`memoryLimit`, `uploadMaxSize`, `postMaxSize`, `maxExecutionTime`, `maxInputTime`, `maxInputVars`, OPcache settings, and `recommendedExtensions[]`) from SQLite `panel_settings` (defaults if unset) and lists all installed PHP versions on the host (`phpext.InstalledVersions()`).
- `PUT /system/settings/php-defaults` → Payload `{ config: PhpDefaultsConfig, applyToHost?: bool }`
  Validates parameters and saves the global blueprint preset to SQLite `panel_settings`. When `applyToHost: true`, writes `/etc/php/<version>/mods-available/99-barepod-tuning.ini` across all installed PHP versions, executes `phpenmod -v <version> 99-barepod-tuning`, ensures recommended extensions in the blueprint are enabled via `phpenmod -v <version> <ext>`, and reloads `php<version>-fpm`. Audited as `panel.php_defaults`.
- `GET /system/settings` → `{ externalAddress, panelFqdn, useCloudflare, letsencryptEmail, sessionTimeoutHours, ipAllowlist, trustedAddresses, overcommit{cpu,ram,disk} }`
- `PATCH /system/settings` → `{ externalAddress?: string, panelFqdn?: string, useCloudflare?: boolean, letsencryptEmail?: string, sessionTimeoutHours?: number, ipAllowlist?: string[], trustedAddresses?: string[], overcommit?: {cpu,ram,disk} }`. Saving `overcommit` re-applies the allocation to every deployed site at once.
  - `letsencryptEmail` is the default contact for certificate issuance (`panel_settings.letsencrypt_email`); an empty value clears it. The Domains dialog can still override it per certificate.
  - `sessionTimeoutHours` (1–720, default 24) is **enforced**: `requireSession` deletes a session older than this from its creation and answers `401`.
  - `ipAllowlist` (addresses or CIDRs) is **enforced** for the whole panel by `panelAccessGuard`; an empty list allows everyone. Loopback is always allowed and `/api/v1/health` is exempt (monitoring/updater). Behind a local reverse proxy (cloudflared) the first `X-Forwarded-For` hop is used, and a non-local peer's forwarded header is ignored so it cannot be used to claim an allowed address.
  - `panelFqdn` (a validated FQDN; empty clears it) and `useCloudflare` record how the panel itself is reached: the public IP by default, or the Cloudflare Tunnel hostname once turned on. See §4.7 for publishing the panel's own hostname.
- `GET /system/time` → `{ timezone: string, zones: string[] }` — the host's own timezone (`timedatectl`), plus the zones it can be set to.
- `POST /system/time` → `{ timezone: string }` → `{ timezone: string, mode: string }`. Administrative (`users` capability); applies with `timedatectl set-timezone`, records the command in dry-run, and audits as `system.timezone`.
- `GET /system/ports` → `{ panel: number, ssh: number, engines: map, sshPorts: number[] }`
- `POST /system/ports/panel` → `{ port: number }`
- `POST /system/ports/ssh` → `{ port: number, action: "add" | "remove" }`
- `POST /settings/prune` (system junk + docker, per option) → `{ reclaimedBytes }`
- `POST /system/daemon/restart`

### 4.12.1 Alert Channels (Notifications)
- `GET /system/notifications` → `NotificationConfig` with secrets masked: `{ telegramEnabled, telegramHasToken, telegramChatId, discordEnabled, discordHasWebhook, smtpEnabled, smtpHost, smtpPort, smtpUser, smtpHasPassword, smtpFrom, smtpTo, diskAlertThresholdPercent, channels[] }`.
- `PUT /system/notifications` → same fields (all optional). Secret fields (`telegramBotToken`, `discordWebhookUrl`, `smtpPassword`) are **write-only**: an empty or omitted secret keeps the stored one, so the masked form round-trips without the browser holding a secret. Stored in `panel_settings` with the secrets encrypted under the panel key (`internal/secrets`, AES-256-GCM). Administrative (`users` capability) and audited as `system.notifications`.
- `POST /system/notifications/test` → `200 { ok, channels[], errors? }`. Sends one test message through every configured channel; `400 no_channels` when none is complete. Audited as `system.notifications_test`.
  Used by the `disk_alert` maintenance job (`diskAlertThresholdPercent`, default 90) and available to any alert source.

### 4.13 Docker Pods
- `GET|POST /pods` (image / dockerfile / compose) · `GET|PATCH|DELETE /pods/:id`
- `POST /pods/:id/start|stop|restart` · `GET /pods/:id/logs` (+ `WS: pod-logs`) · `GET /pods/:id/compose`

### 4.14 Unified Cron Jobs & Scheduled Tasks (Settings & Website Modules)
- **`GET /cron/jobs`** → `{ items: ApiCronJob[], systemJobs: SystemCronJob[] }`
  Returns all website-scoped scheduled tasks (filtered by tenant for non-admins) as well as the daemon's **built-in maintenance jobs** (`systemJobs`) with their real, stored state: `{ id, label, desc, schedule, enabled, category, implemented, lastRunAt?, lastStatus?, lastOutput? }`. The jobs are seeded into `system_cron_jobs` from the daemon's own registry and executed by an in-daemon scheduler (no host systemd timers); a job's `enabled` flag and `schedule` survive restarts, and seeding is `INSERT OR IGNORE`, so a reinstall/update never re-enables a job an operator turned off. Every listed job is implemented today (`implemented: true`); the flag is kept so a future entry can be listed before its executor exists. Each job has its own timeout (default 15m; `security_updates` 60m, `db_maintenance` 30m). Jobs that free or change disk state seed as disabled.
- **`POST /cron/jobs`** → Body `{ websiteSlug: string, name: string, schedule: string, command: string, enabled?: boolean, timeoutSec?: number }` → `201 ApiCronJob`.
  Validates the schedule against the daemon's matcher: five fields (`min hour dom month dow`) with lists, ranges, steps, names, and the `@yearly|@annually|@monthly|@weekly|@daily|@midnight|@hourly` aliases; anything else is `400 invalid_schedule`. Checks website existence and tenant ownership.
- **`PUT /cron/jobs/:id`** → Body `{ name?: string, schedule?: string, command?: string, enabled?: boolean, timeoutSec?: number }` → `200 ApiCronJob`.
  Updates schedule, command, or pauses/resumes execution. A supplied `schedule` is validated the same way (`400 invalid_schedule`).
- **`DELETE /cron/jobs/:id`** → `200 { status: "deleted", id }`.
  Removes the scheduled job.
- **`POST /cron/jobs/:id/run`** → `200 { status: "completed" | "failed", output: string, durationMs: number }`.
  Manually triggers immediate execution. Runs isolated as the tenant UID/GID (`Runner.RunAs`) inside the website root directory (`/home/<tenant>/web/<slug>`). Captures stdout/stderr into `last_output` and updates `last_run_at` and `last_status`.
- **`PUT /cron/jobs/system/:id`** → Body `{ enabled?: boolean, schedule?: string }` → `200 SystemCronJob`.
  Changes one built-in maintenance job. A non-empty `schedule` is validated the same way as above (`400 invalid_schedule`). Administrative (`users` capability) and audited as `system.cron_update`.
- **`POST /cron/jobs/system/:id/run`** → `200 { ok: boolean, status: "success" | "failed", output: string, durationMs: number, runAt: string }`.
  Runs a built-in job once, immediately, outside its schedule. Refuses with `501 not_implemented` when the job is not implemented. Records `last_run_at`/`last_status`/`last_output` and audits as `system.cron_run`.

---

## 5. Screen → Endpoint Mapping (key examples)

| UI screen (route) | Primary endpoints |
|---|---|
| `/websites` | `GET /websites` |
| `/websites/<name>` + monitoring tab | `GET /websites/:slug`, `GET .../metrics?range=` |
| `/websites/<name>/logs` & `/map` | `GET .../logs`, `GET .../telemetry`, `GET .../telemetry/stream` (SSE) |
| `/websites/<name>/routing` | `GET|POST .../routes`, `GET .../vhost/preview` |
| `/websites/<name>/files` | file manager endpoints |
| `/websites/<name>/deploy` & Git | `GET /me/git/providers`, `GET|POST .../git/deploy-key`, `POST /webhooks/deploy/:slug`, `POST .../redeploy` (+ `deploy/stream` SSE) |
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
| `/settings/*` | settings, PHP defaults, alerts (`GET\|PUT /system/notifications`, `POST /system/notifications/test`), and cron (`GET\|POST\|PUT\|DELETE /cron/jobs`, `POST /cron/jobs/:id/run`, `PUT /cron/jobs/system/:id`, `POST /cron/jobs/system/:id/run`) |

---

## 6. Recommended Backend Implementation Order

1. **Foundation:** SQLite (WAL) + schema migrations, HTTP + WS router, session-cookie + CSRF and RBAC middleware, `/system/capabilities`.
2. **Pilot: Websites** — `GET/POST/PATCH/DELETE /websites`, start/stop/restart, metrics. Wire the UI to real data end-to-end.
3. **Files + Deploy** (file manager API + git runner + `WS: deploy-log`).
4. **Terminal** (`pty` bridge: tenant + host, host gated to admins).
5. **Databases + SSO gateway**, then **Domains/SSL**, **Tunnels**.
6. **Monitoring** (read `/proc`, `smartctl`, `ss`) + **Backup/Migration** (rsync stream + `.bpod` + S3/R2).
7. **Cleanup & Cron** — done as an **in-daemon scheduler** (`internal/scheduler`, `system_cron_jobs`), not host systemd timers: job state stays visible/controllable in the panel and travels with a deploy. **Pods** (Docker SDK) next.

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

---

## 8. In-Panel Self-Update & Over-The-Air (OTA) API

All update endpoints require role `admin` and active elevated session (`elevation_required`).

### 8.1 Check for Available Updates
`GET /api/v1/system/updates/check`

**Response (`200 OK`):**
```json
{
  "currentVersion": "0.3.0",
  "latestVersion": "0.3.1",
  "hasUpdate": true,
  "release": {
    "version": "0.3.1",
    "channel": "stable",
    "publishedAt": "2026-10-18T04:00:00Z",
    "releaseNotesUrl": "https://github.com/farrasrayhand/barepod-panel/releases/tag/v0.3.1",
    "changelogMarkdown": "### Fixed\n- Resolved DbGate container cold-start DNS delay.\n- Enforced tenant SQLite database permissions.",
    "assets": {
      "linux-amd64": {
        "url": "https://updates.barepod.com/v0.3.1/barepod-linux-amd64.tar.gz",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "sizeBytes": 28456120
      },
      "linux-arm64": {
        "url": "https://updates.barepod.com/v0.3.1/barepod-linux-arm64.tar.gz",
        "sha256": "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
        "sizeBytes": 27124980
      }
    }
  }
}
```

### 8.2 Trigger In-Panel Update
`POST /api/v1/system/updates/apply`

**Payload:**
```json
{
  "targetVersion": "0.3.1",
  "channel": "stable"
}
```

**Response (`202 Accepted`):**
```json
{
  "jobId": "upd_01JA482K9XF8QMN2PRST",
  "status": "in_progress",
  "streamUrl": "/api/v1/system/updates/stream?jobId=upd_01JA482K9XF8QMN2PRST"
}
```

### 8.3 Live Update Stream (SSE)
`GET /api/v1/system/updates/stream?jobId=...`

Streams real-time execution steps:
```
event: step
data: {"step": "downloading", "progressPercent": 45, "message": "Downloading release package..."}

event: step
data: {"step": "verifying", "progressPercent": 100, "message": "SHA256 checksum verified successfully."}

event: step
data: {"step": "smoke_test", "progressPercent": 100, "message": "Binary compatibility test passed (exit 0)."}

event: step
data: {"step": "snapshot_db", "progressPercent": 100, "message": "SQLite database backed up to pre-update-0.3.0.db."}

event: step
data: {"step": "atomic_swap", "progressPercent": 100, "message": "Daemon binary and SPA assets atomically swapped."}

event: step
data: {"step": "restarting", "progressPercent": 100, "message": "Invoking daemon restart via supervisor..."}

event: done
data: {"status": "success", "newVersion": "0.3.1", "reloadInSeconds": 3}
```

