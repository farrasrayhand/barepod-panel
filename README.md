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

Install BarePod Panel directly on any clean **Ubuntu 22.04+ / Debian 12+** server (VPS or LXC container). This script automatically detects your architecture (`amd64` / `arm64`), downloads the latest release bundle from GitHub, configures your environment, and prepares the background service:

```bash
curl -fsSL https://raw.githubusercontent.com/farrasrayhand/barepod-panel/main/scripts/install.sh | sudo bash
```

### Next Steps:
1. **Create your root admin account** (there are no default credentials by design):
   ```bash
   barepod admin create --username admin
   ```
   *(Your secure random password will be generated and printed once to your terminal).*

2. **Install and start BarePod as a background systemd service**:
   ```bash
   barepod service install -listen 0.0.0.0:8443
   ```

3. **Access your panel**:
   Open **`https://<your-server-ip>:8443`** in your browser and sign in!

---

## 📊 Current Live Status

> [!NOTE]
> BarePod Panel follows an honest versioning policy: **Live** means fully verified on real Linux hosts (Ubuntu 24.04 in Proxmox LXC), not just mockups. The single source of truth is documented in [`MASTER_PLAN.md`](./MASTER_PLAN.md).

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
| **Traffic Telemetry & Map** | **Implemented 🟡** | Streaming access log parser (CLF/JSON), GeoIP coordinate resolution, private IP mapping, and SSE live beacon stream (pending live remote host verification). |
| **Docker Pods & Git CI/CD** | **Scheduled 📋** | Container pod orchestration (Docker SDK) and Push-to-Deploy webhooks with ED25519 deploy keys. |

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
- **Private Mount Namespaces**: Interactive web terminals (`@xterm/xterm` over WebSocket) run confined to `/home/<tenant>/apps/<site>` with root directories masked read-only.
- **Auto-Switching CLI Environment**: Opening a terminal automatically configures `PATH` so `php -v`, `node -v`, or `python -v` matches the exact version assigned to the website.
- **Kernel cgroups v2**: Resource package limits (RAM, CPU quota, task limits) are strictly enforced by the Linux kernel.

### 🛡️ Automated Domains & SSL/TLS Engine
- **Pre-Flight DNS Resolution Guard**: Checks DNS propagation before calling Certbot to prevent hitting Let's Encrypt rate limits (5 failures/hr per domain).
- **High-Grade ECDSA P-256 Fallback**: Automatically generates elliptic-curve self-signed certificates for unpointed domains, local testing, or staging environments.
- **Instant Hot-Reload**: Re-tests and reloads active web servers with zero dropped connections.

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
To cleanly remove BarePod Panel while automatically taking a safety backup first:

```bash
barepod uninstall
```
*(Interactive mode shows a confirmation dialog with **No preselected** to prevent accidental data loss).*

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
