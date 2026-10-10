# BarePod Daemon (Go)

Core daemon for BarePod Panel — the **Phase 2 skeleton**: a real HTTP/JSON API
backed by a local SQLite database, provisioning websites as asynchronous jobs.

Everything ships as a single `barepod` binary (CLI + daemon).

## Install flow

The panel has **no built-in account**: you create your own root admin with the
CLI during installation, and the daemon refuses to start until one exists.

```bash
# 1. build (or use the binary the installer put in /usr/local/bin)
cd backend
go build -o ./barepod ./cmd/barepod

# 2. create your root admin — the generated password is printed once
./barepod admin create --username <you>

# 3. start the panel
./barepod serve -listen 127.0.0.1:8080 -db ./data/barepod.db -key ./data/secret.key
```

## CLI

| Command | Purpose |
|---|---|
| `barepod serve` | Run the daemon (API + SPA fallback) |
| `barepod admin create [--username X] [--password Y] [--force]` | Create the root admin; prints a generated password once |
| `barepod admin passwd <username>` | Reset a password (revokes that account's sessions) |
| `barepod user create --username X [--group Developer]` | Create a non-admin account in a permission group |
| `barepod user list` | List panel accounts |
| `barepod user suspend\|activate <username>` | Disable/enable an account |
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
| `-log-level` | `BAREPOD_LOG_LEVEL` | `info` | Log verbosity |

`BAREPOD_ADMIN_PASSWORD` is read by `admin create` / `admin passwd` when
`--password` is omitted, so an installer can pass a secret without argv.

**Execution mode:** privileged work runs for real only on Linux with systemd.
Everywhere else (macOS, containers without systemd, `-dry-run`) the daemon runs in
**dry-run**: it records the commands, writes the units and `.env`, and reports
`mode: "dry-run"` — the website is left `stopped` rather than faking a success.

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
| `GET` | `/api/v1/groups` | Permission groups + capability list (needs `users`) |
| `GET` | `/api/v1/system/capabilities` | systemd / LXC / Docker / S.M.A.R.T. / fstrim |
| `GET` | `/api/v1/websites` | Website list |
| `POST` | `/api/v1/websites` | Deploy wizard payload → `202` + `deployId` |
| `POST` | `/api/v1/websites/prepare-directory` | Create `/home/<tenant>/apps/<slug>` for "Existing Files" |
| `GET` | `/api/v1/websites/{slug}` | Website detail |
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

## Layout

```
cmd/barepod/          CLI + daemon entrypoint (serve / admin / user)
internal/api/         router, middleware (logging, auth+CSRF, capability), handlers
internal/store/       SQLite (WAL), migrations, queries, groups
internal/rbac/        capability set + built-in permission groups
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
go test ./...        # 29 tests: validate, secrets, auth, rbac, groups, supervisor, pipeline
go test -race ./internal/deploy/
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
