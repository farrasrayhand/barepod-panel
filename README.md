# BarePod Panel

**BarePod Panel** is a secure, isolated and easy-to-use **multi-tenant web-hosting control panel**. It runs PHP, Node.js, Python, Go, Rust, Ruby and static sites — each tenant in its own Linux account with cgroup limits — behind a single admin dashboard. Container hosting is on the [roadmap](#roadmap-not-built-yet).

> **Hobby project — 100% free.** A personal project, free to use, modify and self-host. No paid tiers, no subscriptions, no feature gating, no telemetry. [MIT licensed](./LICENSE).

> Nothing here is aspirational: **live** means measured on a real Linux host (Ubuntu 24.04 LXC on Proxmox), not just compiled. Screens that are not built yet **say so on screen**, and the per-module status table lives in [MASTER_PLAN.md](./MASTER_PLAN.md).

**Contents:** [Status](#status) · [Features](#features) · [Platform support](#platform-support) · [Install & remove](#install--remove) · [Repository](#repository-structure) · [Frontend](#run-the-frontend) · [Backend](#run-the-daemon) · [Roadmap](#roadmap-not-built-yet)

---

## Status

**Live** — auth, sessions & profile · RBAC, groups & packages with a live capacity guard · websites and all four vhost writers (Nginx, Caddy, Apache 2.4, OpenLiteSpeed) · the deploy wizard · the stack installer (engines, runtimes, databases) · file manager · jailed per-tenant terminal · databases & caches with hosted GUIs · metrics & monitoring · per-app security · panel settings & PHP defaults · Cloudflare tunnels (plus the panel's own hostname) · URL-addressable UI.

**Partially live** — S.M.A.R.T. health *(counters live; the self-test probe is simulated and gated by capability)* · world traffic map & streaming telemetry *(implemented and unit-tested; pending live verification on the host)*.

**Roadmap — not built yet** — Docker pods & containers · backup & migration hub · Git CI/CD push-to-deploy · two-factor auth and API/MCP tokens · the Panel Settings items still labelled *Not applied*. See [Roadmap](#roadmap-not-built-yet).

---

## Features

### Hosting & runtimes
- **Four web server engines** — OpenLiteSpeed (LSCache + PHP), Nginx (high-concurrency reverse proxy), Caddy (automatic HTTPS + HTTP/3) and Apache 2.4 (`.htaccess` compatibility) — each with a real vhost config generator and an atomic switch that rewrites every vhost, validates, then swaps.
- **Multi-runtime & frameworks** — PHP (Laravel, WordPress, Symfony, 27 templates), Node.js (Next.js, Express, NestJS, Astro), Python (Flask, FastAPI, Django), Go, Rust, Ruby on Rails, and static sites. Runtime versions install on demand (PHP 5.6–8.5, Node Current/LTS, Python, Ruby, Go, Rust).
- **Guided deploy wizard** — 5 steps, source choice, presets; `202 Accepted` + a persisted job log and an SSE stream (`GET /websites/:slug/deploy/stream`). Verified end to end on a real host.
- **Dedicated reverse proxy mode** — forward a hostname to an internal port with WebSocket pass-through, real-IP preservation, auto-SSL, upstream ping tests and a live vhost preview.
- **Stack page** — install / update / remove engines and runtimes with a live log and a per-version picker, dry-run first, one step at a time under systemd.

### Isolation & access control
- **Per-tenant Linux accounts** — each website runs as its own UID/GID under a systemd unit, with cgroup v2 limits (`MemoryMax`, `CPUQuota`, `TasksMax`) and a disk quota applied from the panel's package.
- **RBAC that is per account** — 10-capability matrix resolved from the caller's group; website endpoints are scoped to the caller's own resources, admins see all.
- **Isolated terminal** — a web terminal per site in `/home/<tenant>/apps/<app>`, jailed by a mount namespace + chroot, automatic runtime switching (`php -v`, `node -v`, `python -v` resolve to the site's version), tenant UID/GID, idle timeout and process-group cleanup.
- **Anti-brute-force watchdog** (replaces fail2ban) — reads **six sources independently**: PostgreSQL, MariaDB, MongoDB, Redis (its own `ACL LOG`), the panel's own refused sign-ins and sshd's journal. Bans are applied in the kernel with a timeout and persisted across restarts; what a ban closes depends on what earned it — the **panel port** for a panel ban, **SSH's port** for an SSH ban (so an SSH brute-force never takes away your way back in), the **whole host** for a database engine. Never-ban addresses are exempt, and where you sign in from is added automatically. Verified: six refused panel logins closed only the panel port, and a real SSH brute-force dropped port 22 while the panel kept answering.
- **Per-app access control** — HTTP 503 maintenance mode and HTTP Basic Auth (`.htpasswd`).

### Databases & caches
- **PostgreSQL, MariaDB / MySQL, MongoDB, Redis and file-based SQLite** — databases and caches are provisioned separately, with safe quoting, engine detection and a live mode (docker / host / none).
- **Hosted web GUIs** — the panel hosts **pgweb** (PostgreSQL), **phpMyAdmin** (MySQL/MariaDB) and **DbGate** (every engine) behind its own session-gated path with credentials injected server-side on loopback only — one process on first access, removed when idle. No Apache, no extra port.
- **In-panel Data Browser & SQL** for every engine, plus a real logical export (pg_dump / mysqldump, or the SQLite file).
- **Password vault** — credentials are masked (AES-256-GCM at rest); revealing one requires the panel password and auto-locks after 60 seconds.
- **Recycle bin** — deleting a database suspends it (apps can no longer connect, data is kept) and moves it to a bin; restore, purge, or let it auto-purge after 30 days.

### Files & terminal
- **File Manager Pro** — per-file checkboxes with select-all, multi-file batch actions (download as `.zip`, delete, copy/cut/paste), right-click context menu, in-browser previewers (image / SVG / PDF) and a syntax-highlighting code editor. A separator-safe path jail plus operations run as the tenant UID/GID, so new files belong to the tenant, never root.

### Monitoring & telemetry
- **Host & per-site metrics** — a background sampler serves `GET /system/metrics` and `GET /websites/:slug/metrics` from `/proc`, `statfs` and cgroup v2. Raw numbers + RFC3339 only; a metric the host cannot provide is **unavailable with a reason**, never a fake zero. The host core count comes from one source, shared with the capacity guard.
- **Hardware health & network** — S.M.A.R.T. disk diagnostics *(counters live; the self-test probe is simulated and gated by capability)*, ingress/egress sparklines, per-interface monitoring, ICMP edge-latency probes, and TCP socket / listening-port inspectors.
- **World traffic map & streaming telemetry** *(implemented; pending live verification on the host)* — an equirectangular world map with pulsing visitor pins, per-country filtering (latency, ISP) and a console log studio with light/dark themes, text-wrap toggle and expandable request inspectors.

### Networking & Cloudflare
- **Zero-NAT Cloudflare Tunnel** — per-tenant tunnel tokens publish domains and containers with no static public IP or port forwarding. The panel can also **publish its own hostname** through the administrator's Cloudflare account (Settings → General): it is reached at its public address by default, and once the Cloudflare hostname is on the daemon **binds to it** — any other hostname pointed at the box is refused, while IP access keeps working.
- **Tokens are write-only** — saved Cloudflare run/API tokens are never returned to the browser (only masked forms with `has*` flags). A token can be replaced, never revealed or copied.
- **Routes follow their app** — deleting a website (or unpublishing the panel) removes its ingress rule and DNS record from Cloudflare too, so no hostname is left pointing at a tunnel for something that no longer exists.

### Panel administration
- **Panel Settings** — horizontal top tabs for general preferences, monitoring retention, security, reverse proxy & SSL, backups, notifications, database defaults, a PHP tuning blueprint and cleanup.
- **Ports you can change safely** — the panel and SSH ports are changed with add-then-verify-then-remove, so a mistake never locks you out.
- **URL-addressable UI** — every menu and app sub-tab has its own route (`/apps/<app>/logs`, `/settings/backups`, …), so refresh and back/forward keep your place.
- **One honest binary** — `api.Version` is what `/health` reports, what the CLI prints and what the footer shows. Privileged work only runs for real on **Linux with systemd**; elsewhere the daemon runs in **dry-run** and reports `mode: "dry-run"` instead of pretending.

---

## Platform support

BarePod Panel targets **64-bit Linux** and installs on **AMD64 and ARM64** — bare metal, VPS, or inside **LXC / LXD**.

| Item | Support |
|---|---|
| Architecture | `linux/amd64` (x86_64) and `linux/arm64` (aarch64). 32-bit ARM is **not** supported. |
| OS | Debian 12 / Ubuntu 22.04+ (systemd) |
| Containers | LXC / LXD — see caveats below |
| cgroups | **v2 (unified hierarchy)** required for tenant isolation |
| Runtime deps | Node.js 20+ (frontend build), Go 1.23+ (daemon build), Docker (container pods, roadmap) |

**LXC / LXD caveats**
- Docker-in-LXC (container pods, roadmap) needs `security.nesting=true` (and `keyctl=1`).
- Cloudflare Tunnel needs `/dev/net/tun` (`lxc.cgroup2.devices.allow: c 10:200 rwm`).
- S.M.A.R.T. disk diagnostics and `fstrim` are typically unavailable in unprivileged containers.

---

## Install & remove

Run the environment check — it detects architecture and container type automatically:

```bash
bash scripts/install.sh
```

The panel ships with **no account**: you create your own root admin with the CLI, and the daemon refuses to start until one exists.

### Remove it, and put it back

`barepod uninstall` reads what is really there (websites, tenants, records, containers, the lockout's firewall table) and asks before anything it cannot undo:

```bash
barepod uninstall                      # print the plan and change nothing
barepod uninstall --yes                # remove it; the panel database is backed up first
barepod uninstall --yes --backup=full  # also save /etc/barepod and the systemd unit files
barepod uninstall --yes --purge-data   # also delete /var/lib/barepod (records, accounts, certificate)
```

Without `--yes` it is interactive: the backup level is a menu, the removals a checklist, and the final summary box has **No preselected**, so pressing Enter alone never removes anything. **Esc** cancels; **Ctrl-C** ends it saying *nothing was changed*.

The backup is written **before** anything is removed, is read back before the first deletion, refuses to land inside a directory the uninstall deletes, and lives in `/var/backups/barepod` — outside everything the run touches. Restore it later:

```bash
scripts/restore.sh                    # newest backup; prints its manifest first
scripts/restore.sh --from /mnt/usb/barepod-backup-host-20261012-1930.tar.gz
```

**What a backup holds, and what it does not:** the panel database (accounts, records, their settings and the audit log) plus the self-signed certificate, and with `--backup=full` also `/etc/barepod` and the unit files. It does **not** hold your database contents or your site files — their credentials are encrypted inside the panel database, so a dump cannot be authenticated for from here. Use the panel's **Export** for each database, and copy site files, before uninstalling.

`scripts/install.sh` looks in `/var/backups/barepod` and, when it finds one, tells you to restore it instead of creating a fresh admin. If the binary is already gone, `scripts/uninstall.sh` does the same job standalone (`--backup=db|full|none`, dry run until `--yes`).

---

## Repository structure

```
BarePod-Panel/
├── frontend/             # Dashboard web UI (React + Vite + TypeScript + Tailwind CSS)
├── backend/              # Core daemon (Go) — SQLite/WAL, auth + RBAC, websites, files,
│                         #   terminal, databases, monitoring, Cloudflare tunnels, metrics
├── scripts/              # install.sh, install-engines.sh, uninstall.sh, restore.sh (Ubuntu/Debian)
├── MASTER_PLAN.md        # Architecture, decisions with the measurements behind them, per-module status
├── API_CONTRACT.md       # What the daemon serves, endpoint by endpoint
└── README.md
```

---

## Run the frontend

```bash
cd frontend
npm install
npm run dev        # then open http://127.0.0.1:5173/
```

> **The UI talks to the daemon when it is running.** On load it asks `/api/v1/health`; if the Go daemon answers you get the real sign-in screen and live data. If nothing answers, the panel stays in **simulation mode** with its mock data — both paths are supported.
>
> If your environment sets `NODE_ENV=production`, npm skips devDependencies. Install with `NODE_ENV=development npm install --include=dev`.

```bash
npm run build      # type-check + production build
npm run preview    # preview the production build
npm run lint       # oxlint
```

> **Production note:** the UI uses path-based routes, so the daemon must serve `index.html` as an SPA fallback for unknown paths.

---

## Run the daemon

Requires Go 1.23+. The pure-Go SQLite driver means no cgo — the same build runs on **amd64, arm64 and inside LXC**.

```bash
cd backend
go build -o ./barepod ./cmd/barepod

./barepod admin create --username <you>     # prints a generated password once
./barepod serve -listen 127.0.0.1:8080 -db ./data/barepod.db -key ./data/secret.key
```

Also available: `barepod user create --username <name> --group Basic`, `user list`, `user suspend|activate`, `admin passwd`. The only built-in data is two packages (`Unlimited`, `Basic`). See [`backend/README.md`](./backend/README.md) for flags, endpoints, permissions and a smoke test.

---

## Roadmap (not built yet)

These screens exist, but the daemon does not implement them yet — the UI says so, and nothing is faked.

- **Docker Pods & Containers** — deploy from an image / Dockerfile / compose with per-pod resource limits (needs the Docker Engine SDK).
- **Backup & Migration Hub** — server-to-server live migration (pull from an old VPS with a 2-hour token), portable `.bpod` snapshots (SHA-256/AES-256), drag-and-drop restore, and scheduled cloud sync to Cloudflare R2 / AWS S3 / Google Cloud Storage / Wasabi (MinIO) with retention.
- **Git CI/CD push-to-deploy** — webhook-triggered `git pull` + build + zero-downtime reload, per-site ED25519 deploy keys and streaming build logs (contract designed).
- **Two-factor auth** and **API/MCP tokens**.
- **Panel Settings items still labelled *Not applied*** — Server Timezone, Interface Language, Automatic Security Patches, and some Security-tab controls.

---

## License

MIT — fork it, rebrand it, ship it. See [LICENSE](./LICENSE).
