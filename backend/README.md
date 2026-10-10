# BarePod Daemon (Go)

Core daemon for BarePod Panel. This is the **Phase 2 skeleton** — it replaces the
frontend mock data with a real HTTP/JSON API backed by a local SQLite database.

## Run

```bash
cd backend
go run ./cmd/barepod-daemon \
  -listen 127.0.0.1:8080 \
  -db ./data/barepod.db \
  -key ./data/secret.key \
  -static ../frontend/dist
```

On the first start the daemon creates a root admin and prints the generated
password once — set `BAREPOD_ADMIN_PASSWORD` to choose it yourself.

| Flag / Env | Default | Purpose |
|---|---|---|
| `-listen` / `BAREPOD_LISTEN` | `127.0.0.1:8080` | API listen address |
| `-db` / `BAREPOD_DB` | `/var/lib/barepod/barepod.db` | Panel SQLite database (WAL) |
| `-key` / `BAREPOD_KEY` | `/etc/barepod/secret.key` | AES-256-GCM key (created `0600`) |
| `-static` / `BAREPOD_STATIC` | `./dist` | Built frontend for the SPA fallback |
| `-log-level` / `BAREPOD_LOG_LEVEL` | `info` | Log verbosity |
| `BAREPOD_ADMIN_USER` | `farras` | Root admin username on first boot |
| `BAREPOD_ADMIN_PASSWORD` | *(random)* | Root admin password on first boot |

## Endpoints (implemented)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/health` | Public liveness probe |
| `POST` | `/api/v1/auth/login` | Sets the session cookie, returns `csrfToken` |
| `POST` | `/api/v1/auth/logout` | Requires CSRF header |
| `GET` | `/api/v1/auth/me` | User, effective permissions, elevated state |
| `POST` | `/api/v1/auth/verify` | Enables elevated mode for 5 minutes |
| `GET` | `/api/v1/sessions` | Active sessions (CSRF tokens never returned) |
| `DELETE` | `/api/v1/sessions/{id}` | Revoke a session immediately |
| `GET` | `/api/v1/system/capabilities` | systemd / LXC / Docker / S.M.A.R.T. / fstrim |
| `GET` | `/api/v1/websites` | Website list (pilot module) |
| `GET` | `/api/v1/websites/{slug}` | Website detail |
| `POST` | `/api/v1/ws/ticket` | One-time WebSocket ticket (~30 s TTL) |

Full payload shapes live in [`../API_CONTRACT.md`](../API_CONTRACT.md).

## Layout

```
cmd/barepod-daemon/   entrypoint (config, store, secrets, HTTP server, graceful shutdown)
internal/api/         router, middleware (logging, auth+CSRF), handlers
internal/store/       SQLite (WAL) open + migrations + queries + seed
internal/auth/        Argon2id password hashing
internal/secrets/     AES-256-GCM helpers with a 0600 key file
internal/sysinfo/     host capability detection
internal/id/          ULID & token generation
```

## Smoke test

```bash
curl -s localhost:8080/api/v1/health
curl -s -c cj.txt -X POST localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' -d '{"username":"farras","password":"<pw>"}'
curl -s -b cj.txt localhost:8080/api/v1/websites
```

Mutating requests must send the `X-CSRF-Token` header with the value from
`/auth/me` (or the login response).

## Notes

- Sessions are **stateful** (SQLite) so revoke and suspend take effect instantly.
- The secrets key is created next to the database in dev; in production it lives at
  `/etc/barepod/secret.key`, owned by root with mode `0600`.
- SQLite is opened with a single connection because SQLite allows one writer — the
  panel's write volume is tiny.
- Pure-Go SQLite driver (`modernc.org/sqlite`) — no cgo, so the same build runs on
  **amd64, arm64 and inside LXC**.
