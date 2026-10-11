# BarePod Daemon (Go)

Core daemon for BarePod Panel — the **Phase 2 skeleton**: a real HTTP/JSON API
backed by a local SQLite database, provisioning websites as asynchronous jobs.

Everything ships as a single `barepod` binary (CLI + daemon).

## Install flow

The panel has **no built-in account**: you create your own root admin with the
CLI during installation, and the daemon refuses to start until one exists.

```bash
# 1. build and put `barepod` on your PATH
cd backend
make install                 # -> /usr/local/bin/barepod (sudo if needed)
#    …or without root:  go install ./cmd/barepod   (needs $GOPATH/bin on PATH)

# 2. create your root admin — the generated password is printed once
barepod admin create --username <you>

# 3. start the panel
barepod service install -listen 127.0.0.1:8080 -db ./data/barepod.db -key ./data/secret.key
#    …or foreground:  barepod serve <same flags>
```

`barepod service install` writes `/etc/systemd/system/barepod.service` from the
`serve` flags you pass, reloads systemd and enables + starts it, so the panel
survives an SSH session and comes back after a crash (`Restart=always`) and on
boot. `barepod service status` reports it, `journalctl -u barepod -f` shows the
logs. The unit is intentionally unsandboxed (no `ProtectSystem`/`PrivateTmp`/
`NoNewPrivileges`): the daemon writes units, creates Linux accounts and drops
privileges per request, so those options would break it rather than protect it.

## CLI

| Command | Purpose |
|---|---|
| `barepod serve` | Run the daemon (API + SPA fallback) |
| `barepod admin create [--username X] [--password Y] [--force]` | Create the root admin; prints a generated password once |
| `barepod admin passwd <username>` | Reset a password (revokes that account's sessions) |
| `barepod user create --username X [--group Developer] [--quota 10GB]` | Create a non-admin account in a package (also creates the Linux tenant account) |
| `barepod user list` | List panel accounts |
| `barepod user suspend\|activate <username>` | Disable/enable an account (also locks/unlocks the Linux user) |
| `barepod group list` | Show packages with their capabilities and resource limits |
| `barepod tenant provision --username X` | Create/repair the Linux account for a panel user |
| `barepod service install` | Install the daemon as a systemd service (the `serve` flags apply) |
| `barepod service status\|uninstall` | Check / remove that unit |
| `barepod version` | Print the version |

Use `--db <path>` on any command to point at a non-default database.

## Flags / environment (`serve`)

| Flag | Env | Default | Purpose |
|---|---|---|---|
| `-listen` | `BAREPOD_LISTEN` | `127.0.0.1:8080` | API listen address |
| `-db` | `BAREPOD_DB` | `/var/lib/barepod/barepod.db` | Panel SQLite database (WAL) |
| `-key` | `BAREPOD_KEY` | `/etc/barepod/secret.key` | AES-256-GCM key (created `0600`) |
| `-static` | `BAREPOD_STATIC` | `./dist` | Built frontend for the SPA fallback |
| `-sites-root` | `BAREPOD_SITES_ROOT` | `/home` (Linux) | Directory holding tenant homes |
| `-units-dir` | `BAREPOD_UNITS_DIR` | `/etc/systemd/system` (Linux) | systemd unit output |
| `-dry-run` | `BAREPOD_DRY_RUN` | `false` | Record privileged commands instead of running them |
| `-max-upload-mb` | `BAREPOD_MAX_UPLOAD_MB` | `64` | File manager upload/edit ceiling |
| `-metrics-interval` | `BAREPOD_METRICS_INTERVAL` | `15s` | How often host and per-website metrics are sampled |
| `-metrics-history` | `BAREPOD_METRICS_HISTORY` | `2880` | Samples kept in memory (2880 × 15s = 12h) |
| `-log-level` | `BAREPOD_LOG_LEVEL` | `info` | Log verbosity |

`BAREPOD_ADMIN_PASSWORD` is read by `admin create` / `admin passwd` when
`--password` is omitted, so an installer can pass a secret without argv.

**Execution mode:** privileged work runs for real only on Linux with systemd.
Everywhere else (macOS, containers without systemd, `-dry-run`) the daemon runs in
**dry-run**: it records the commands, writes the units and `.env`, and reports
`mode: "dry-run"` — the website is left `stopped` rather than faking a success.

> **Verified on a real host (0.2):** on Ubuntu 24.04 in an LXC container the daemon
> ran `mode: real` and a scaffolded Flask site came up end-to-end — unit active,
> service running as the tenant, cgroup limits applied (`memory.max`, `cpu.max`,
> `pids.max`), health check green, files created through the API owned by the
> tenant, per-site metrics read from the cgroup.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/health` | Public liveness probe (includes the execution mode) |
| `POST` | `/api/v1/auth/login` | Sets the session cookie, returns `csrfToken` |
| `POST` | `/api/v1/auth/logout` | Requires the CSRF header |
| `GET` | `/api/v1/auth/me` | User, effective permissions, elevated state |
| `POST` | `/api/v1/auth/verify` | Elevated (sudo) mode for 5 minutes |
| `GET` | `/api/v1/sessions` | Active sessions (CSRF tokens never returned) |
| `DELETE` | `/api/v1/sessions/{id}` | Revoke a session immediately |
| `GET` | `/api/v1/groups` | Permission groups + package limits (needs `users`) |
| `PATCH` | `/api/v1/groups/{name}` | Edit a package (capabilities, limits) — capacity-guarded |
| `GET` | `/api/v1/system/capacity` | Host capacity, current allocation, live re-check |
| `GET` | `/api/v1/system/capabilities` | systemd / LXC / Docker / S.M.A.R.T. / fstrim **+ `limitations[]`** |
| `GET` | `/api/v1/system/metrics?range=1h` | Host time series (`?live=1` for the latest sample only) |
| `GET` | `/api/v1/websites/{slug}/metrics?range=1h` | Per-website cgroup v2 usage |
| `GET` | `/api/v1/websites/{slug}/files?path=` | Directory listing (relative paths only) |
| `GET` `PUT` | `/api/v1/websites/{slug}/files/content?path=` | Read / save a file for the editor |
| `GET` | `/api/v1/websites/{slug}/files/download?path=` | Download a file |
| `POST` | `/api/v1/websites/{slug}/files/{create,mkdir,rename,copy,move,delete,upload,compress}` | File operations |
| `GET` | `/api/v1/websites/{slug}/pty?ticket=` | **WebSocket** terminal as the tenant |
| `GET` | `/api/v1/system/pty?ticket=` | **WebSocket** host shell (admin only) |
| `GET` | `/api/v1/websites` | Website list |
| `POST` | `/api/v1/websites` | Deploy wizard payload → `202` + `deployId` |
| `POST` | `/api/v1/websites/prepare-directory` | Create `/home/<tenant>/apps/<slug>` for "Existing Files" |
| `GET` | `/api/v1/websites/{slug}` | Website detail |
| `DELETE` | `/api/v1/websites/{slug}` | Full teardown: stop/disable the unit, remove the drop-in, delete the app directory, forget the rows |
| `POST` | `/api/v1/websites/{slug}/redeploy` | Re-run the pipeline from the recorded source (keeps the existing database/cache) |
| `GET` | `/api/v1/websites/{slug}/deploy` | Latest deploy job |
| `GET` | `/api/v1/websites/{slug}/deploy/{id}` | Job + log (poll with `?after=<id>`) |
| `GET` | `/api/v1/websites/{slug}/deploy/stream` | SSE log stream, ends with `event: done` |
| `POST` | `/api/v1/websites/{slug}/start\|stop\|restart` | Service action |
| `GET` | `/api/v1/websites/{slug}/secrets` | Credential **names** only |
| `POST` | `/api/v1/websites/{slug}/secrets/{name}/reveal` | Requires elevated mode; audited |
| `POST` | `/api/v1/ws/ticket` | One-time WebSocket ticket (~30 s TTL) |

Full payload shapes live in [`../API_CONTRACT.md`](../API_CONTRACT.md).

## Deploy pipeline

`POST /api/v1/websites` returns `202` and runs eight steps, each persisted to the
job log: prepare directory → fetch source → write `.env` → provision database →
provision cache → render systemd unit → start service → health check.

- `source.kind = existing` requires a **non-empty** directory: create it from the
  wizard (`prepare-directory`), upload the code with the File Manager, then deploy.
- Database names and users are prefixed with the tenant (`<tenant>_<name>`) so two
  tenants can use the same name on a shared daemon.
- Generated credentials are stored encrypted (AES-256-GCM) and revealed only in
  elevated mode.
- systemd gets one template unit (`barepod-app@.service`) plus a per-site
  `override.conf` holding the diff.

## Permissions (per account, not global)

The panel ships with **three built-in groups** — and that is the only data it
creates by itself:

| Group | May do |
|---|---|
| `Superadmin (Root)` | Everything |
| `Developer` | Deploy/operate websites, files, terminal, databases, backups, domains, tunnels, monitoring — **no** user or API-token administration |
| `Read Only` | View dashboards, metrics and logs; change nothing |

- Every endpoint is gated on a capability (`deployApps`, `fileManager`, `terminal`,
  `databases`, `backups`, `domains`, `cloudflareTunnels`, `monitoring`, `users`,
  `apiTokens`) resolved from the caller's group. A missing capability returns
  `403 capability_required`.
- Website endpoints are additionally **scoped to the caller's own websites**;
  another tenant's website returns `404`, and deploying into another tenant is
  refused. **Admins are the exception** — they see and manage every tenant.
- Backup/migration and every other module follow the same rule: per account, own
  resources only, admin sees all. `Read Only` cannot even start one.

## Resource limits (packages) & the capacity guard

A group **is** the tenant package: the same row carries the capabilities and the
per-member resource limits — CPU, RAM, tasks, disk quota, inodes, max websites,
max databases. Zero means unlimited.

- **Applied for real:** the limits land in the website's systemd drop-in
  (`MemoryMax=`, `CPUQuota=`, `TasksMax=`, cgroup v2) and in the tenant's disk
  quota (`setquota`). Nothing is hardcoded in the pipeline any more.
- **Capacity guard:** `PATCH /groups/{name}` refuses a plan whose total
  (limits × members, summed over all packages) exceeds the server, and returns
  the numbers: `409 insufficient_capacity` →
  `"memory: allocated 65536 of 16384 available (400%)"`.
- **Live re-detection:** capacity is measured on every read — cgroup v2 `cpu.max`
  (so a running container resize is seen), `/sys/.../cpu/online`, `/proc/meminfo`,
  `statfs` of the sites filesystem (walking up if the path does not exist yet).
  Scaling the server up or down changes the answer **without restarting the
  daemon**; a plan that no longer fits is reported by `GET /system/capacity`
  (`fits:false` + `exceeds:[…]`) and logged/audited once as
  `system.capacity_exceeded`.
- **Same model for pods:** the `resources.Limits` struct is also the input for a
  pod's Docker resource spec in Phase 3 (one model, three consumers).
- Existing systemd units keep the limits they were deployed with; a package
  change applies to the next deploy/restart of that website.

## Metrics

Sampled in the background (default 15s) and returned as **raw numbers with
RFC3339 timestamps** — the UI formats them.

- **Host** (`/system/metrics`): CPU% from `/proc/stat` deltas, memory/swap from
  `/proc/meminfo` (used = total − MemAvailable), load, uptime, disk usage
  (`statfs`) and per-second disk/network rates from `/proc/diskstats` +
  `/proc/net/dev`. The first sample reports rates as 0 (there is nothing to
  compare with yet) instead of averaging over the machine's uptime.
- **Per website** (`/websites/{slug}/metrics`): cgroup v2 of
  `barepod-app@<slug>.service` — `memory.current`, `memory.max`, `pids.current`
  and a CPU% derived from `cpu.stat`'s `usage_usec`.
- A metric the host cannot provide is **unavailable with a reason**, never a
  misleading zero: on a stopped/dry-run website the reason is "the service is not
  running", and on macOS (development) host CPU/memory/network are real while
  disk I/O rates are 0 because macOS has no simple cumulative counter.
- Ranges: `5m`, `1h`, `6h`, `12h`, `24h` (bounded by the in-memory history).
  Persisting longer history is a later module.

## File manager & the path jail

Two independent layers, because one is never enough:

1. **Path jail** (`internal/files`): every path from the client is relative,
   run through `filepath.IsLocal`, then `EvalSymlinks` on its *deepest existing
   ancestor* (a path that does not exist yet cannot be a symlink), and finally
   compared with the site root using a **separator-safe** test — so
   `/home/u/apps/site-evil` can never pass as inside `/home/u/apps/site`. A
   symlink that resolves outside the site is refused, and archives skip
   symlinks instead of following them.
2. **Ownership**: on Linux the daemon is root, so file operations are executed
   through a helper process started with the tenant's UID/GID
   (`barepod fs-exec`, see `files.HelperOps`): the kernel applies the tenant's
   own permissions and new files belong to the tenant, not root. Off Linux (or
   when the account does not exist) the daemon falls back to in-process
   operations.

Uploads use the multipart base name only, batch operations are capped at 500
items, and `create`/`copy`/`move` refuse to overwrite an existing file.

## Terminal (PTY)

- `GET /websites/{slug}/pty` runs a shell **as the tenant** in the site
  directory; `GET /system/pty` is a host shell and is **admin only**. Both
  re-check the capability and the ownership of the site.
- Authentication uses the one-time ticket from `POST /ws/ticket` (30 s TTL,
  single use) — a session token never appears in a URL, and the test suite
  asserts a ticket cannot be replayed.
- Protocol: binary frames are stdin/stdout, text frames are control messages —
  `{"type":"resize","cols":120,"rows":40}` calls `pty.Setsize` (so vim/top fill
  the browser window correctly) and `{"type":"ping"}` answers with `pong`.
- The first frame is a `ready` message describing the shell, the identity it
  runs as and the execution mode, so the UI can label the tab honestly.
- Idle sessions close after 30 minutes; closing kills the whole process group
  (no orphan shells), and every open/close is audited.

## On LXC / unprivileged containers

A container is a supported target — it just owns fewer things than the host.
`GET /system/capabilities` therefore returns a **`limitations[]`** list with the
reason and the advice for each unavailable feature, so the UI shows guidance
instead of a red error:

| Feature | Why it is unavailable | What to use instead |
|---|---|---|
| `smart` | No access to the host's block device | Run `smartctl` on the LXC host; the panel still reports filesystem/inode usage and disk I/O latency |
| `fstrim` | A container cannot issue a discard | `fstrim.timer` on the host, or continuous trim on the pool (`discard=on` for LVM-thin, `autotrim=on` for ZFS) |
| `quota` | `setquota` needs host quota support + quotactl | Host-side quotas (XFS project quotas, a ZFS dataset per tenant); the package's cgroup v2 limits still apply |
| `useradd` | Account utilities missing | Install the shadow/passwd utilities, or create tenants on the host |

CPU and memory capacity *are* container-aware (`cpu.max`, `/proc/meminfo`), so
the package limits and the capacity guard keep working inside LXC.

## Layout

```
cmd/barepod/          CLI + daemon entrypoint (serve / admin / user)
internal/api/         router, middleware (logging, auth+CSRF, capability), handlers
internal/store/       SQLite (WAL), migrations, queries, groups, job retention
internal/rbac/        capability set + built-in permission groups
internal/resources/   Limits/Capacity model, live detection, overcommit guard
internal/metrics/     Host (proc/sysctl) + per-website (cgroup v2) sampling
internal/tenant/      Linux account lifecycle (useradd, quota, lock/unlock)
internal/files/       File manager: hardened path jail, ops, zip
internal/terminal/    PTY sessions (allow-listed shells, resize, process group)
internal/deploy/      async provisioning pipeline + job log
internal/host/        privileged operations (real vs dry-run runner)
internal/supervisor/  systemd template + per-site drop-in rendering
internal/provision/   runtime/framework package and start commands
internal/auth/        Argon2id password hashing
internal/secrets/     AES-256-GCM helpers with a 0600 key file
internal/sysinfo/     host capability detection
internal/validate/    input rules (FQDN, slug, runtime, engine)
internal/id/          ULID & token generation
```

## Smoke test

```bash
./barepod admin create --username admin --password devpass --db ./data/barepod.db
./barepod serve -db ./data/barepod.db -key ./data/secret.key &

curl -s localhost:8080/api/v1/health
curl -s -c cj.txt -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"admin","password":"devpass"}'
CSRF=$(curl -s -b cj.txt localhost:8080/api/v1/auth/me | grep -o '"csrfToken":"[^"]*"' | cut -d'"' -f4)
curl -s -b cj.txt -H "X-CSRF-Token: $CSRF" -H 'Content-Type: application/json' \
  -d '{"slug":"demo","domain":"demo.example.com","tenantUser":"admin","runtime":"nodejs","version":"22","webServer":"caddy","source":{"kind":"scaffold"}}' \
  localhost:8080/api/v1/websites
curl -sN -b cj.txt "localhost:8080/api/v1/websites/demo/deploy/stream"
```

Mutating requests must send the `X-CSRF-Token` header from `/auth/me` (or the
login response).

## Tests

```bash
go test ./...        # 87 tests: validate, secrets, auth, rbac, resources, metrics, tenant, files, terminal, store, supervisor, pipeline, HTTP/WS end-to-end
go test -race ./internal/deploy/ ./internal/resources/ ./internal/metrics/
```

## Notes

- Sessions are **stateful** (SQLite) so revoke and suspend take effect instantly.
- The secrets key is created next to the database in dev; in production it lives at
  `/etc/barepod/secret.key`, owned by root, mode `0600`.
- SQLite runs with a single connection (one writer) — the panel's write volume is tiny.
- Pure-Go SQLite driver (`modernc.org/sqlite`) — no cgo, so one build covers
  **amd64, arm64 and LXC**.
- Not implemented yet: metrics collection, files/terminal APIs, tenant `useradd`,
  databases module, TLS/Cloudflare Tunnel, and installing itself as a systemd service.
