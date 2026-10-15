# BarePod Panel

**BarePod Panel** is a next-generation, secure, isolated, and easy-to-use hybrid web-hosting and container-hosting management platform.

> **Hobby project — 100% free.** BarePod Panel is a personal hobby project and is completely free to use, modify, and self-host. No paid tiers, no subscriptions, no feature gating, no telemetry. Released under the [MIT License](./LICENSE).

> **Status:** Phase 1 frontend is feature-complete (still on mock data), and **Phase 2 has started** — a Go daemon in [`backend/`](./backend) implements SQLite/WAL, Argon2id + session-cookie auth with CSRF, per-account RBAC, a `barepod` CLI for account setup, and an asynchronous website provisioning pipeline with systemd unit rendering and SSE job logs. See [MASTER_PLAN.md](./MASTER_PLAN.md).

---

## Highlights

- **Four web server engines**: OpenLiteSpeed (LSCache + PHP), Nginx (high concurrency reverse proxy), Caddy (automatic HTTPS / Let's Encrypt + HTTP/3), and Apache 2.4 (`.htaccess` compatibility) — with a real vhost config generator per engine.
- **Multi-runtime & frameworks**: Python (Flask, FastAPI, Django), PHP (Laravel, WordPress, Symfony — 27 framework/CMS templates), Node.js (Next.js, Express, NestJS, Astro), Go, Rust, Ruby on Rails, and static sites.
- **Isolated multi-tenant terminal**: each tenant has its own web terminal in `/home/<tenant>/apps/<app>` with automatic runtime switching — `php -v`, `node -v`, `python -v` resolve to the site's configured version without colliding across tenants.
- **Database suite & SSO web GUI**: PostgreSQL 16, MariaDB 11 / MySQL 8, MongoDB 7.0, Redis 7.2, and file-based SQLite. Databases and caches are provisioned separately; the panel hosts **pgweb** (PostgreSQL) and **phpMyAdmin** (MySQL/MariaDB) behind its own gated path with automatic login — one loopback process, no Apache or extra port — alongside its own in-panel **Data Browser & SQL** for every engine and a real logical export (pg_dump/mysqldump, or the SQLite file).
- **Password vault**: database passwords are masked; revealing them requires the panel account password with a 60-second auto-lock.
- **Recycle bin for databases**: deleting a database suspends it and moves it to a recycle bin — apps can no longer connect, but the data is kept. Restore it, delete it permanently, or let it auto-purge after 30 days.
- **File Manager Pro**: per-file checkboxes with select-all, multi-file batch actions (download as `.zip`, delete, copy/cut/paste), right-click context menu, in-browser previewers (image / SVG / PDF), and a code editor with syntax highlighting.
- **GitHub push-to-deploy & one-click redeploy**: webhook-triggered `git pull` + build + zero-downtime reload, plus manual redeploy with streaming build logs.
- **Zero-NAT Cloudflare Tunnel**: per-tenant tunnel tokens expose domains and containers to the internet without a static public IP or port forwarding. The panel can also **publish its own hostname** through the administrator's Cloudflare account (Settings → General): it is reached at its public address by default, and once the Cloudflare hostname is on the daemon **binds to it** — any other hostname pointed at the box is refused, while IP access still works.
- **Tokens are write-only**: saved Cloudflare run/API tokens are never returned to the browser (only masked forms, with `has*` flags). A token can be replaced, never revealed or copied.
- **Tunnel routes follow their app**: deleting a website (or unpublishing the panel) removes its ingress rule and DNS record from Cloudflare too, so no hostname is left pointing at a tunnel for something that no longer exists.
- **Dedicated reverse proxy mode & multi-engine path routing**: forward traffic to internal ports with WebSocket pass-through, real-IP preservation, auto-SSL, upstream ping tests, and live vhost preview.
- **World traffic map & streaming telemetry**: an interactive equirectangular world map with pulsing visitor pins, per-country filtering (latency, ISP), and a console log studio with light/dark themes, text-wrap toggle, and expandable request inspectors.
- **Backup & migration hub**: one-click server-to-server live migration (pull from an old VPS with a 2-hour token), portable `.bpod` snapshots with SHA-256/AES-256, drag-and-drop restore, and scheduled cloud sync to Cloudflare R2 / AWS S3 / Google Cloud Storage / Wasabi (MinIO) with retention policies.
- **Hardware health & network telemetry**: S.M.A.R.T. disk diagnostics with interactive self-test, ingress/egress sparklines, per-interface monitoring, ICMP edge-latency probes, and TCP socket / listening-port inspectors.
- **Anti-brute-force watchdog built into the panel** (it replaces fail2ban, which is no longer installed or
  needed): it reads **six sources independently** — PostgreSQL, MariaDB, MongoDB, Redis (its own `ACL LOG`,
  because Redis logs no refusals at all), the panel's own refused sign-ins, and sshd's journal — with
  thresholds per engine in **Settings → Security**, and bans applied in the kernel with a timeout, persisted
  across restarts. What a ban closes depends on what it was earned on: the **panel's port** for a panel ban,
  **SSH's port** for an SSH ban (so a brute-force on SSH never takes away your way back in), and the **whole
  host** for a database engine. Addresses on the never-ban list are never banned, and where you sign in from
  is added to it automatically. Verified on a real host: six refused panel logins closed only the panel port,
  and a real SSH brute-force dropped port 22 while the panel kept answering.
- **Per-app access control**: HTTP 503 maintenance mode and HTTP Basic Auth (`.htpasswd`).
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

### Removing it, and putting it back

Take the panel off a host with the CLI, which reads what is really there (websites, tenants, ledger
records, containers, the lockout's firewall table) and asks before anything it cannot undo:

```bash
barepod uninstall                      # print the plan and change nothing
barepod uninstall --yes                # remove it; the panel database is backed up first
barepod uninstall --yes --backup=full  # also save /etc/barepod and the systemd unit files
barepod uninstall --yes --purge-data   # also delete /var/lib/barepod (records, accounts, certificate)
```

Run it without `--yes` and it is interactive, because a decision this final should be read before it is
made: the backup level is a **menu** (arrows, Enter), the removals are one **checklist** (space toggles,
Enter confirms — data directory, tenant accounts, their files, container volumes), and the last question is a
**box holding the summary with *No* preselected**, so pressing Enter alone never removes anything. **Esc**
cancels, **Ctrl-C** ends it saying *nothing was changed*, and on a bare console where a box cannot be drawn
the same questions are asked in plain text.

The backup is written **before** anything is removed and is read back before the first deletion, it refuses
to land inside a directory the uninstall deletes, and it lives in `/var/backups/barepod` — outside
everything the run touches. Put it back later:

```bash
scripts/restore.sh                    # newest backup; prints its manifest first
scripts/restore.sh --from /mnt/usb/barepod-backup-host-20261012-1930.tar.gz
```

**What a backup holds, and what it does not:** the panel database (accounts, records, their settings and the
audit log) plus the self-signed certificate, and with `--backup=full` also `/etc/barepod` and the unit files.
It does **not** hold the contents of your databases or your site files — their credentials are encrypted
inside the panel database, so a dump cannot be authenticated for from here. Use the panel's **Export** for
each database, and copy site files, before uninstalling.

`scripts/install.sh` looks in `/var/backups/barepod` and, when it finds one, says so and tells you to restore
it instead of creating a fresh admin. If the panel binary is already gone, `scripts/uninstall.sh` does the
same job as a standalone script (`--backup=db|full|none`, dry run until `--yes`), because a broken install is
exactly when someone reaches for it.

---

## Repository Structure

```
BarePod-Panel/
├── frontend/             # Dashboard web UI (React + Vite + TypeScript + Tailwind CSS)
├── backend/              # Core daemon (Go) — SQLite/WAL, auth + RBAC, websites, files,
│                         #   terminal, databases, monitoring, Cloudflare tunnels, metrics
├── scripts/              # install.sh, install-engines.sh, uninstall.sh, restore.sh (Ubuntu/Debian)
├── MASTER_PLAN.md        # Architecture, decisions with the measurements behind them, roadmap
├── API_CONTRACT.md       # What the daemon serves, endpoint by endpoint
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

> **The UI talks to the daemon when it is running.** On load it asks
> `/api/v1/health`; if the Go daemon answers you get the real sign-in screen and
> the website list/metrics come from the API. If nothing answers, the panel stays
> in **simulation mode** with its mock data — both paths are supported.
>
> If your environment sets `NODE_ENV=production`, npm skips devDependencies
> (Vite/TypeScript disappear). Install with
> `NODE_ENV=development npm install --include=dev`.

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

Also available: `barepod user create --username <name> --group Basic`, `user list`, `user suspend|activate`, `admin passwd`. Privileged work only runs for real on **Linux with systemd** — elsewhere the daemon runs in **dry-run** and reports `mode: "dry-run"` instead of pretending. The only built-in data is two packages (`Unlimited`, `Basic`). See [`backend/README.md`](./backend/README.md) for flags, endpoints, permissions and a smoke test.
