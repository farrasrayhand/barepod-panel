# BarePod Panel

<div align="center">

<img src="./frontend/public/favicon.svg" alt="BarePod Logo" width="80" height="80" />

### Modern, Isolated Multi-Tenant Web Hosting & Server Control Panel

[![Release](https://img.shields.io/github/v/release/farrasrayhand/barepod-panel?color=blue&style=flat-square)](https://github.com/farrasrayhand/barepod-panel/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](./LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux%20(amd64%20%7C%20arm64)-green?style=flat-square)](#platform-support)
[![Architecture: cgroups v2](https://img.shields.io/badge/Isolation-cgroups%20v2%20%2B%20namespaces-purple?style=flat-square)](#isolation--access-control)

**BarePod Panel** is a lightweight, zero-dependency, and highly secure multi-tenant web hosting control panel. It runs PHP, Node.js, Python, Go, Rust, Ruby, and Static sites — with each tenant strictly jailed inside their own Linux system account (`/home/<tenant>/...`) with kernel cgroup v2 resource limits, automated Let's Encrypt SSL/TLS, database GUIs, and zero-downtime over-the-air updates.

[Quick 1-Line Install](#-quick-1-line-installation-no-git-clone-required) • [Live Status](#-current-live-status) • [Features](#-features-in-depth) • [Architecture](#-system-architecture) • [Backup & Restore](#-backup-restore--uninstall) • [Self-Update](#-over-the-air-ota-in-panel-self-update)

</div>

---

## ⚡ Quick 1-Line Installation (No Git Clone Required!)

Install BarePod Panel directly on any clean **Ubuntu 22.04+ / Debian 12+** server (VPS or LXC container). This script automatically detects your architecture (`amd64` / `arm64`), downloads the precompiled release bundle, installs web engines and runtimes, runs an interactive setup wizard to create your root admin, and starts the systemd service automatically:

```bash
curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/install.sh | sudo bash
```

### What the installer does automatically:
1. **Installs System Dependencies**: Nginx edge ingress, MariaDB, Redis, Certbot, Composer, Python3 venv, and `cloudflared`.
2. **Interactive Admin Wizard**: Prompts you for your admin username, password (or auto-generates a secure 12-char token), and panel port (default `8443`).
3. **Starts Systemd Service**: Configures `/etc/systemd/system/barepod.service` and starts it immediately.
4. **Access your panel**: Open **`https://<your-server-ip>:8443`** in your browser and sign in!

---

## 📊 Current Live Status

> [!NOTE]
> BarePod Panel follows an honest versioning policy: **Live** means verified on a real Linux host (Ubuntu 24.04 in Proxmox LXC), not just compiled. Current snapshot: **v0.4.4 (2026-10-21)**. The single source of truth is documented in [`MASTER_PLAN.md`](./MASTER_PLAN.md).

| Feature / Module | Real Host Status | Description |
|---|---|---|
| **Web Server Matrix** | **Live ✅** | Concurrent multi-webserver execution (OpenLiteSpeed, Nginx, Caddy, Apache 2.4) with atomic ingress swapping and port collision protection. |
| **Automated Domains & SSL/TLS** | **Live ✅** | Automated ACME Let's Encrypt certificates with pre-flight DNS verification, high-grade ECDSA P-256 self-signed fallbacks, custom certificate imports, and 301 HTTPS enforcement. |
| **Multi-Runtime Stack** | **Live ✅** | PHP (5.6–8.5 with live extension manager & host tuning blueprint), Node.js (Current & LTS), Python (virtualenv `.venv`), Ruby, Go, Rust, and Static. |
| **Multi-Tenant Isolation** | **Live ✅** | Linux system accounts per tenant, kernel cgroup v2 quotas (`MemoryMax`, `CPUQuota`, `TasksMax`), disk quota enforcement, and jailed mount namespace terminals. |
| **Databases & Caches** | **Live ✅** | PostgreSQL, MariaDB/MySQL, MongoDB, SQLite, and **Dedicated Native Redis per App** (zero cross-tenant `FLUSHALL` vulnerability). |
| **Hosted Database GUIs** | **Live ✅** | On-demand single-session loopback reverse proxy for **pgweb** (Postgres), **phpMyAdmin** (MySQL), and containerized **DbGate** (<2s cold start). |
| **In-Panel Self-Update (OTA)** | **Live ✅** | Zero tenant downtime atomic binary swap (`ETXTBSY` avoidance), pre-flight SHA-256 checksums, binary smoke test, automated DB backup, and auto-rollback guard. |
| **Anti-Brute Force Watchdog** | **Live ✅** | Kernel-level nftables enforcement reading 6 independent sources (Postgres, MariaDB, Mongo, Redis ACL, SSH, and Panel logins). |
| **File Manager Pro** | **Live ✅** | Path-jail protected file manager running under tenant UID/GID (`barepod fs-exec`) with chunked uploads, batch zip, in-browser editor, and media previewers. |
| **Traffic Telemetry & Map** | **Live ✅** | Reads the active vhost's access log (Caddy JSON, Nginx/Apache combined CLF), resolves country/city/ISP/coordinates via `ip-api.com`, maps RFC1918/loopback peers to **Local Network**, flags threat probes, and streams new hits over SSE. Verified on a real host with live traffic. |
| **Metrics History & Retention** | **Live ✅** | Live samples stay in memory; aggregated rollups (1m → 24h, 5m → 30d, 1h → configurable 30/90/365d) are written once a minute to a separate `metrics.db`, so history survives restarts. Daemon RSS, Go heap, goroutines and FDs are recorded in the same rollup tiers and charted on Server Monitoring; heap/goroutine pprof dumps are admin-only. Admin can disable persistence or change retention from Monitoring & Retention. |
| **Git CI/CD & Auto-Deploy** | **Live ✅** | Per-tenant GitHub, GitLab, Gitea/Forgejo and Bitbucket connections with AES-256-GCM tokens, repo/branch discovery, ED25519 deploy keys, deploy history, and auto-deploy in **webhook / polling / off** modes. Provider hooks are registered, updated and deleted by the daemon. |
| **Path Routing, Service Logs & Lists** | **Live ✅** | Per-site path prefixes (`/api/` → upstream) rendered into Nginx, Caddy, Apache and OpenLiteSpeed vhosts with hot reload; inline edit/delete; journald service logs; server-side `?owner=&sort_by=&order=` for websites, databases and caches. |
| **Activity Log** | **Live ✅** | A dedicated menu over the existing audit trail: an admin sees every account, a tenant sees only their own activity, with search, action filter, and newest 100/250/500 rows. |
| **Capacity Estimate** | **Live ✅** | Server Monitoring and Overview show remaining CPU/RAM/disk against the suggested package, a theoretical user ceiling, a 75%-headroom "comfortable" number, and the current bottleneck. Clearly labelled as an estimate. |
| **Docker Pods** | **Scheduled 📋** | Container pod orchestration through the Docker SDK (Pod lifecycle, env, volumes, port mapping). |

**Verification for v0.4.4:** on a real Ubuntu 24.04 host, the daemon reported `mode: real` with migrations through V29, the active Caddy config validated, a site returned `200` and matched its remote branch, a real GitHub webhook delivery was answered, a foreign-branch push was ignored, and telemetry aggregation plus SSE were exercised, and metrics rollups were written to the separate metrics.db. Repeatable checks live in [`scripts/verify-v044.sh`](./scripts/verify-v044.sh).

---

## 🚀 Features In-Depth

### 🌐 Multi-Engine Edge Ingress & 4 Web Servers
- **OpenLiteSpeed (OLS)**: High-speed WordPress & PHP hosting with native LSCache integration.
- **Nginx**: High-concurrency event-driven reverse proxy gateway with WebSocket pass-through and microcaching.
- **Caddy**: Modern auto-HTTPS web server with HTTP/3 (QUIC) support out of the box.
- **Apache 2.4**: Maximum backward compatibility for `.htaccess` rewrite rules and legacy applications.
- **No Port Collisions**: Edge ingress exclusively handles public ports `:80` and `:443`; backend engines bind internally on loopback (`127.0.0.1:8088`, `:8080`, `:8081`).

### 🔒 Enterprise-Grade Multi-Tenant Isolation
- **1 Tenant = 1 Linux UID**: Websites do not share user privileges or processes.
- **Private Mount Namespaces**: Interactive web terminals (`@xterm/xterm` over WebSocket) run confined to `/home/<tenant>/web/<site>` with root directories masked read-only.
- **Auto-Switching CLI Environment**: Opening a terminal automatically configures `PATH` so `php -v`, `node -v`, or `python -v` matches the exact version assigned to the website.
- **Kernel cgroups v2**: Resource package limits (RAM, CPU quota, task limits) are strictly enforced by the Linux kernel.

### 🛡️ Automated Domains & SSL/TLS Engine
- **Pre-Flight DNS Resolution Guard**: Checks DNS propagation before calling Certbot to prevent hitting Let's Encrypt rate limits (5 failures/hr per domain).
- **High-Grade ECDSA P-256 Fallback**: Automatically generates elliptic-curve self-signed certificates for unpointed domains, local testing, or staging environments.
- **Instant Hot-Reload**: Re-tests and reloads active web servers with zero dropped connections.

### 🔀 Git CI/CD & Auto-Deploy
- **One connection per tenant**: GitHub, GitLab (SaaS or self-hosted), Gitea/Forgejo, and Bitbucket tokens are stored per account with AES-256-GCM and never returned by the API. Each tenant can only see its own connections.
- **Repository and branch discovery**: the Add-Website wizard lists repositories, loads branches, and preselects the provider's default branch. A per-site ED25519 deploy key (`0600`) covers private repositories and Custom Git.
- **Three explicit auto-deploy modes**:
  - **Webhook** — the daemon creates, updates or deletes the provider's push hook (`/repos/:owner/:repo/hooks` on GitHub, `/api/v4/projects/:id/hooks` on GitLab, `/api/v1/repos/:owner/:repo/hooks` on Gitea/Forgejo, `/2.0/repositories/:workspace/:repo/hooks` on Bitbucket). The public endpoint still checks the site token and the configured branch.
  - **Polling** — `git_commit_watcher` runs every 5 minutes, reads local `HEAD` from `.git` without a subprocess, dedupes checks per `(repo, branch)`, runs at most 4 remote checks concurrently, and uses GitHub's REST API with `If-None-Match` (or `git ls-remote` for other providers).
  - **Off** — manual deploy only; the panel removes the hook it registered.
- **Deploy history and safety**: newest ten jobs per site (commit, author, trigger, duration, status, replayable log), one deploy per site at a time (`409 deploy_in_progress` for the second trigger), and a public webhook that answers `200 ignored` instead of making GitHub record a failed delivery.
- **Path routes and service logs**: path prefixes are rendered into all four engines before the primary location, rewritten and reloaded on every mutation; `GET /websites/:slug/logs` reads the site unit's journald output.

### 🗺️ Traffic Telemetry & Live Map
- **Real access logs, not synthetic traffic**: the daemon tails the active vhost log — `/var/log/caddy/barepod-<slug>.access.log`, `/var/log/nginx/...`, `/var/log/apache2/...`, or the OpenLiteSpeed equivalent — and parses **Caddy JSON** or **Nginx/Apache combined CLF**.
- **GeoIP and local peers**: `ip-api.com` resolves country, city, ISP, latitude and longitude with an in-memory cache; the host node is detected automatically; RFC1918, loopback, link-local and CGNAT peers are labelled **Local Network** instead of being sent to a public lookup.
- **Threat hints**: 403 responses and common probe paths (`.env`, `wp-login`, `xmlrpc.php`, `phpinfo`, `.git/`, etc.) are flagged in the same stream.
- **Two endpoints**:
  - `GET /api/v1/websites/:slug/telemetry` — aggregated snapshot (nodes, totals, unique IPs, threats, recent log items).
  - `GET /api/v1/websites/:slug/telemetry/stream` — SSE `snapshot` event, then new parsed lines about once per second, with a `: ping` keepalive every 15 seconds.
- **Verified on a real host**: the aggregation endpoint returned `200`, an SSE connection stayed open under live traffic, the Caddy JSON log contained real requests, and the GeoIP lookup succeeded.
- **History survives a restart**: the live window is in memory, while `metrics.db` keeps 1-minute, 5-minute and hourly rollups. The file is separate from the panel database, written once a minute, and pruned by the retention setting; it can be disabled entirely from **Panel Settings → Monitoring & Retention**.

### 🗄️ Databases, Caches & Fast Hosted GUIs
- **Dedicated Native Process per App for Redis**: Each cache instance binds to an isolated loopback IP (`127.0.0.X:6379`) with dedicated memory and storage. Completely immune to cross-app `FLUSHALL` or key collisions!
- **Hosted Managers**: Access **DbGate**, **pgweb**, and **phpMyAdmin** directly through panel paths (`/api/v1/databases/:id/gui/...`) without exposing separate public ports.
- **AES-256-GCM Vault**: Credentials are encrypted at rest with host-level `0600` keys. Viewing passwords requires entering your admin credentials.

---

## 🔄 Over-The-Air (OTA) In-Panel Self-Update

BarePod Panel can update itself with a single click directly from **Panel Settings (`/settings`) -> Tab "System & Updates"**:

```
[ Check GitHub Release ] ──> [ Download Tarball ] ──> [ SHA-256 Checksum ]
                                                             │
                                                    (Smoke Test Passed)
                                                             │
[ Reload Dashboard ] <── [ Atomic Binary Swap ] <── [ Backup DB & Dist ]
```

- **Zero Website Downtime**: Only the panel daemon restarts (~1-2 seconds). Your websites, PHP pools, Node apps, and databases remain untouched and running!
- **Atomic Inode Replacement**: Swaps executables using Linux `mv` to avoid `ETXTBSY` ("Text file busy") errors.
- **Automatic Watchdog Rollback**: If a new release crashes or fails migrations within 30 seconds, the watchdog immediately restores `barepod.bak` and rolls back database snapshots.

---

## 💾 Backup, Restore & Uninstall

BarePod provides first-class backup and restore utilities without requiring you to keep repository source code:

### Restore a Previous Backup:
You can restore a panel backup directly using `curl`:

```bash
# Restore latest backup found in /var/backups/barepod
curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/restore.sh | sudo bash -s -- --yes

# Or restore a specific backup tarball:
curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/restore.sh | sudo bash -s -- --from=/path/to/backup.tar.gz --yes
```

### Guided & Safe Uninstall:
To cleanly remove BarePod Panel (takes an automatic safety backup first before deleting):

```bash
# Option A: Using the CLI (interactive confirmation):
sudo barepod uninstall

# Option B: Standalone 1-line curl script:
curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/uninstall.sh | sudo bash -s -- --yes --purge-data
```
*(Interactive mode shows a confirmation plan first to prevent accidental data loss. Always run with `sudo` or as root).*

---

## 💻 Manual Development & Source Compilation

If you want to modify BarePod Panel or build from source:

### Prerequisites:
- Go 1.23+
- Node.js 20+ & npm

### Build & Run:
```bash
# 1. Clone the repository
git clone https://github.com/farrasrayhand/barepod-panel.git
cd barepod-panel

# 2. Build Frontend (SPA)
cd frontend
npm ci
npm run build
cd ..

# 3. Build Backend Daemon
cd backend
go build -o barepod ./cmd/barepod

# 4. Run Development Server
./barepod serve -listen 127.0.0.1:8080 -db ./barepod.db -key ./secret.key -static ../frontend/dist
```

---

## 📄 License

BarePod Panel is 100% free, open-source software licensed under the **[MIT License](./LICENSE)**. Fork it, customize it, and deploy it anywhere.
