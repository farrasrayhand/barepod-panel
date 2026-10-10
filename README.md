# BarePod Panel

**BarePod Panel** is a next-generation, secure, isolated, and easy-to-use hybrid web-hosting and container-hosting management platform.

> **Hobby project — 100% free.** BarePod Panel is a personal hobby project and is completely free to use, modify, and self-host. No paid tiers, no subscriptions, no feature gating, no telemetry. Released under the [MIT License](./LICENSE).

> **Status:** Phase 1 frontend is feature-complete (still on mock data), and **Phase 2 has started** — a Go daemon in [`backend/`](./backend) implements SQLite/WAL, Argon2id + session-cookie auth with CSRF, per-account RBAC, a `barepod` CLI for account setup, and an asynchronous website provisioning pipeline with systemd unit rendering and SSE job logs. See [MASTER_PLAN.md](./MASTER_PLAN.md).

---

## Highlights

- **Four web server engines**: OpenLiteSpeed (LSCache + PHP), Nginx (high concurrency reverse proxy), Caddy (automatic HTTPS / Let's Encrypt + HTTP/3), and Apache 2.4 (`.htaccess` compatibility) — with a real vhost config generator per engine.
- **Multi-runtime & frameworks**: Python (Flask, FastAPI, Django), PHP (Laravel, WordPress, Symfony — 27 framework/CMS templates), Node.js (Next.js, Express, NestJS, Astro), Go, Rust, Ruby on Rails, and static sites.
- **Isolated multi-tenant terminal**: each tenant has its own web terminal in `/home/<tenant>/apps/<app>` with automatic runtime switching — `php -v`, `node -v`, `python -v` resolve to the site's configured version without colliding across tenants.
- **Database suite & SSO web GUI**: PostgreSQL 16, MariaDB 11 / MySQL 8, MongoDB 7.0, Redis 7.2, and file-based SQLite. Databases and caches are provisioned separately; web GUIs (DbGate, phpMyAdmin, pgAdmin, Mongo Express, Redis Commander) sit behind an internal proxy with automatic login.
- **Password vault**: database passwords are masked; revealing them requires the panel account password with a 60-second auto-lock.
- **Recycle bin for databases**: deleting a database suspends it and moves it to a recycle bin — apps can no longer connect, but the data is kept. Restore it, delete it permanently, or let it auto-purge after 30 days.
- **File Manager Pro**: per-file checkboxes with select-all, multi-file batch actions (download as `.zip`, delete, copy/cut/paste), right-click context menu, in-browser previewers (image / SVG / PDF), and a code editor with syntax highlighting.
- **GitHub push-to-deploy & one-click redeploy**: webhook-triggered `git pull` + build + zero-downtime reload, plus manual redeploy with streaming build logs.
- **Zero-NAT Cloudflare Tunnel**: per-tenant tunnel tokens expose domains and containers to the internet without a static public IP or port forwarding.
- **Dedicated reverse proxy mode & multi-engine path routing**: forward traffic to internal ports with WebSocket pass-through, real-IP preservation, auto-SSL, upstream ping tests, and live vhost preview.
- **World traffic map & streaming telemetry**: an interactive equirectangular world map with pulsing visitor pins, per-country filtering (latency, ISP), and a console log studio with light/dark themes, text-wrap toggle, and expandable request inspectors.
- **Backup & migration hub**: one-click server-to-server live migration (pull from an old VPS with a 2-hour token), portable `.bpod` snapshots with SHA-256/AES-256, drag-and-drop restore, and scheduled cloud sync to Cloudflare R2 / AWS S3 / Google Cloud Storage / Wasabi (MinIO) with retention policies.
- **Hardware health & network telemetry**: S.M.A.R.T. disk diagnostics with interactive self-test, ingress/egress sparklines, per-interface monitoring, ICMP edge-latency probes, and TCP socket / listening-port inspectors.
- **Per-app access control**: HTTP 503 maintenance mode, HTTP Basic Auth (`.htpasswd`), and anti-brute-force protection (failed-login throttling with temporary IP bans).
- **URL-addressable UI**: every menu and app sub-tab has its own route (`/apps/<app>/logs`, `/settings/backups`, …) so refresh and back/forward keep your place.

---

## Free & Open Source

- **100% free.** No pricing page, no paid plan, no locked features — everything in this repository is free to use forever.
- **Hobby project.** Built and maintained for fun and learning; expect rough edges and breaking changes.
- **Self-hosted.** Run it on any VPS you already own — this project adds no cloud accounts or vendor costs.
- **MIT licensed.** Fork it, rebrand it, ship it — see [LICENSE](./LICENSE).

---

## Platform Support

BarePod Panel targets **64-bit Linux** and is designed to install on **AMD64 and ARM64**, on bare metal, VPS, or inside **LXC / LXD** containers.

| Item | Support |
|---|---|
| Architecture | `linux/amd64` (x86_64) and `linux/arm64` (aarch64). 32-bit ARM is **not** supported. |
| OS | Debian 12 / Ubuntu 22.04+ (systemd) |
| Containers | LXC / LXD — see caveats below |
| cgroups | **v2 (unified hierarchy)** required for tenant isolation |
| Runtime deps | Node.js 20+ (frontend), Docker (container pods, Phase 3) |

**LXC / LXD caveats**
- Docker-in-LXC (container pods) requires `security.nesting=true` (and `keyctl=1`) in the container config.
- Cloudflare Tunnel needs `/dev/net/tun` (`lxc.cgroup2.devices.allow: c 10:200 rwm`).
- S.M.A.R.T. disk diagnostics and `fstrim` are typically unavailable in unprivileged containers.

Run the environment check (detects architecture and container type automatically):

```bash
bash scripts/install.sh
```

---

## Repository Structure

```
BarePod-Panel/
├── frontend/             # Dashboard web UI (React + Vite + TypeScript + Tailwind CSS)
├── backend/              # Core daemon (Go) — Phase 2 skeleton (SQLite, auth, websites API)
├── scripts/              # One-line VPS install scripts (Ubuntu/Debian) — planned
├── MASTER_PLAN.md        # Master architecture & development roadmap
└── README.md
```

---

## Running the Dashboard (Frontend)

```bash
cd frontend
npm install
npm run dev
```

Then open **`http://127.0.0.1:5173/`**.

Other scripts:

```bash
npm run build     # type-check + production build
npm run preview   # preview the production build
npm run lint      # oxlint
```

> **Note for production deployment:** the UI uses path-based routes, so the web server (the Go daemon) must serve `index.html` as an SPA fallback for unknown paths.

---

## Running the Daemon (Backend)

Requires Go 1.23+. Pure-Go SQLite driver — no cgo, so the same build runs on **amd64, arm64 and inside LXC**.

The panel ships with **no account**: you create your own root admin with the CLI, and the daemon refuses to start until one exists.

```bash
cd backend
go build -o ./barepod ./cmd/barepod

./barepod admin create --username <you>     # prints a generated password once
./barepod serve -listen 127.0.0.1:8080 -db ./data/barepod.db -key ./data/secret.key
```

Also available: `barepod user create --username <name> --group Developer`, `user list`, `user suspend|activate`, `admin passwd`. Privileged work only runs for real on **Linux with systemd** — elsewhere the daemon runs in **dry-run** and reports `mode: "dry-run"` instead of pretending. The only built-in data is three permission groups. See [`backend/README.md`](./backend/README.md) for flags, endpoints, permissions and a smoke test.
