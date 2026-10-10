# BarePod Panel — API Contract (Draft v0.1)

> Blueprint kontrak antara **frontend (React, Fase 1)** dan **backend Go daemon (Fase 2)**.
> Tujuannya: backend tinggal mengikuti bentuk respons di sini, tanpa mengubah UI.
> Status: **draft** — belum ada implementasi backend.

---

## 1. Konvensi Umum

- **Base path:** `/api/v1`
- **Format:** JSON (`application/json`), UTF-8.
- **Auth:** `Authorization: Bearer <JWT>` (kecuali `POST /auth/login` dan webhook GitHub).
- **Tenant scope:** endpoint yang diawali `/websites/:slug/...` otomatis dibatasi ke tenant pemilik.
- **Error format:**
  ```json
  { "error": { "code": "not_found", "message": "Website not found" } }
  ```
- **Pagination:** `?page=1&per_page=50` → `{ "items": [...], "page": 1, "per_page": 50, "total": 123 }`.
- **Waktu:** semua timestamp **RFC3339 UTC** (mis. `2026-10-10T16:40:12Z`).
- **Metrik:** kirim **angka mentah** (`memoryBytes`, `cpuPercent`), bukan string berformat. Formatting (`"42 MB"`, `"0.3%"`) dilakukan di frontend.
- **Webhook (publik):** `POST /api/v1/webhook/:siteId/deploy?token=<deployHookToken>` (tanpa JWT).

---

## 2. Kanal WebSocket

Satu endpoint, banyak channel: `wss://<host>/api/v1/ws` (auth via query `?token=<JWT>` atau header `Sec-WebSocket-Protocol`).

| Channel | Arah | Payload |
|---|---|---|
| `deploy-log` | server→client | `{ siteId, line, stream: "stdout"\|"stderr", ts }` |
| `migration-progress` | server→client | `{ jobId, step, totalSteps, line, ts }` |
| `restore-progress` | server→client | `{ jobId, percent, line }` |
| `pty` | duplex | stdin/stdout terminal (binary frames) |
| `system-metrics` | server→client | `{ ts, cpuPercent, memUsedBytes, memTotalBytes, netRxBps, netTxBps, diskReadBps, diskWriteBps }` |
| `smart-test` | server→client | `{ device, percent, done }` |
| `pod-logs` | server→client | `{ podId, line }` |
| `site-log-stream` | server→client | access/error log line (untuk Traffic Map & console) |

---

## 3. Perubahan Model Data yang Harus Dipenuhi Backend

Ini titik rawan rework — UI saat ini menyimpan beberapa nilai sebagai string presentasional.

| Field UI sekarang | Target kontrak |
|---|---|
| `WebApp.memoryUsage: "42 MB"` | `metrics: { rssBytes: number, limitBytes: number }` |
| `WebApp.cpuUsage: "0.3%"` | `cpuPercent: number` |
| `createdAt: "Just now"` / `"2026-10-10"` | `createdAt: string (RFC3339)` |
| `lastDeployedAt: "2026-10-10 16:40:12"` | `lastDeployedAt: string (RFC3339)` |
| `DatabaseItem.size: "142 MB"` | `sizeBytes: number` |
| `PodItem.ports: "5678:5678"` | `ports: Array<{ host: number, container: number }>` |
| `PodItem.cpu/memory: "0.4%" / "48 MB"` | `cpuPercent: number`, `memoryBytes: number` |
| `UserGroup.diskLimit: "10 GB"` | `diskLimitBytes: number \| null` |
| `TenantUser.diskUsage: "1.4 GB"` | `diskUsageBytes: number` |
| `Domain.sslExpiry: "2026-12-10 (60 days left)"` | `sslExpiresAt: string (RFC3339)` |
| `FileEntry.size: "420 B"` | `sizeBytes: number` |
| `log.latency: "14ms"` | `latencyMs: number` |
| Logs deploy/migrasi (textarea) | stream WS `deploy-log` / `migration-progress` |

**Entitas yang perlu interface kanonik di backend** (saat ini mock lokal di komponen):
`Website` (= WebApp), `DatabaseItem`, `PodItem`, `UserGroup`, `TenantUser`, `UserTunnel`, `DomainRecord`, `FileEntry`, `ProcessItem`, `ServiceItem`, `LogEntry`, `BackupSnapshot`, `PanelSettings`, `LiveMetrics`.

**Hardcode yang harus pindah ke API:** identitas tenant (`farras`), IP publik, path `/home/<tenant>/apps/<site>`, nama unit systemd (`php8.4-fpm`, `gunicorn-*`, …), port DB per versi.

---

## 4. Endpoint per Modul

### 4.1 Auth & Sesi
- `POST /auth/login` → `{ token, user }`
- `POST /auth/logout`
- `GET /auth/me` → `{ user, role, group, permissions }`
- `POST /auth/verify` (re-auth untuk reveal password DB / aksi sensitif)
- `POST /auth/2fa/enable` · `POST /auth/2fa/verify`

### 4.2 Websites (Apps)
- `GET /websites` · `POST /websites` · `GET|PATCH|DELETE /websites/:slug`
- `POST /websites/:slug/start|stop|restart`
- `GET /websites/:slug/metrics?range=` · `GET /websites/:slug/logs?range=`
- `PUT /websites/:slug/maintenance` · `PUT /websites/:slug/basic-auth` · `PUT /websites/:slug/anti-bruteforce`
- `GET|POST|DELETE /websites/:slug/routes` (multi-engine path routing)
- `GET|PUT /websites/:slug/env`
- `POST /websites/:slug/backup` (export `.bpod` per website)

### 4.3 Runtime, VHost & PHP
- `GET|PUT /websites/:slug/runtime` (engine: openlitespeed/nginx/caddy/apache, version)
- `GET /websites/:slug/vhost/preview?engine=` → `{ config: string }`
- `GET|PUT /websites/:slug/php/extensions` · `POST .../php/extensions/install` (PECL)
- `GET|PUT /websites/:slug/php/ini` · `POST /websites/:slug/php-fpm/reload`

### 4.4 File Manager
- `GET /websites/:slug/files?path=` → `FileEntry[]`
- `GET /websites/:slug/files/content?path=` · `PUT /websites/:slug/files/content`
- `POST /websites/:slug/files` (new) · `mkdir` · `rename` · `copy` · `move` · `delete`
- `POST /websites/:slug/files/upload` · `GET /websites/:slug/files/download?path=`
- `POST /websites/:slug/files/compress` (batch `.zip`)

### 4.5 Terminal
- `WS /websites/:slug/pty` — shell tenant (auto runtime switch)
- `WS /system/pty` — host root shell (**admin only**)

### 4.6 Databases & SSO
- `GET|POST /databases` · `GET|PATCH|DELETE /databases/:id`
- `POST /databases/:id/max-connections`
- `POST /databases/:id/reveal` (panel password) · `GET /databases/:id/connection-string`
- `GET /databases/:id/tables` · `POST /databases/:id/query`
- `POST /databases/:id/export` (`.sql`)
- `GET /databases/:id/gui?tool=pgadmin|phpmyadmin|dbgate|mongoexpress|rediscommander` → `{ ssoUrl }`
- `GET /db-engines` (versi + port shared daemon)

### 4.7 Cloudflare Tunnels
- `GET|POST /tunnels` · `DELETE /tunnels/:id` · `POST /tunnels/:id/token` · `POST /tunnels/:id/restart`
- `POST|DELETE /tunnels/:id/routes`

### 4.8 Domains & SSL
- `GET /domains` · `POST /domains/:id/renew-ssl` · `GET /domains/:id/ssl`

### 4.9 Users, Groups & RBAC
- `GET|POST /users` · `PATCH|DELETE /users/:id`
- `GET|POST /groups` · `PATCH|DELETE /groups/:id` (`permissions: GroupPermissions`)

### 4.10 System Monitoring
- `GET /system/metrics?range=` + `WS: system-metrics`
- `GET /system/processes` · `POST /system/processes/:pid/kill` (SIGTERM/SIGKILL)
- `GET /system/services` · `POST /system/services/:unit/{start,stop,restart,reload}` · `GET /system/services/:unit/logs` (journald)
- `GET /system/disks` · `POST /system/disks/:dev/smart-test` (+ `WS: smart-test`)
- `GET /system/network/interfaces` · `POST /system/network/ping` · `GET /system/sockets` (`ss -tulpn`)
- `GET /system/capabilities` → `{ smart: bool, fstrim: bool, docker: bool, lxc: bool }` (**penting untuk LXC**: UI menampilkan "tidak tersedia", bukan error)

### 4.11 Backup & Migration
- `GET|POST /backups` · `GET /backups/:id/download` · `POST /backups/:id/restore`
- `POST /backups/restore-upload` (drag & drop `.bpod`)
- `POST /migrations/handshake` · `POST /migrations/start` (+ `WS: migration-progress`)
- `GET /migrations/source-token` (TTL 2 jam)
- `GET|PUT /backups/cloud-sync` (R2/S3/GCS/Wasabi, cron, retensi) · `POST /backups/cloud-sync/test`

### 4.12 System Cleanup & Panel Settings
- `GET|PUT /settings/:tab` (general, monitoring, security, proxy, backups, notifications, databases, php_defaults, maintenance)
- `POST /settings/prune` (system junk + docker, per opsi) → `{ reclaimedBytes }`
- `GET|PUT /settings/cron-jobs` (daftar cronjob default + enable/disable)
- `POST /settings/backup-now` · `POST /system/daemon/restart`

### 4.13 Docker Pods
- `GET|POST /pods` (image / dockerfile / compose) · `GET|PATCH|DELETE /pods/:id`
- `POST /pods/:id/start|stop|restart` · `GET /pods/:id/logs` (+ `WS: pod-logs`) · `GET /pods/:id/compose`

---

## 5. Pemetaan Layar → Endpoint (contoh kunci)

| Layar UI (route) | Endpoint utama |
|---|---|
| `/websites` | `GET /websites` |
| `/websites/<name>` + tab monitoring | `GET /websites/:slug`, `GET .../metrics?range=` |
| `/websites/<name>/logs` & `/map` | `GET .../logs`, `WS: site-log-stream` |
| `/websites/<name>/routing` | `GET|POST .../routes`, `GET .../vhost/preview` |
| `/websites/<name>/files` | file manager endpoints |
| `/websites/<name>/deploy` | `PUT .../git`, `POST .../redeploy` (+ `WS: deploy-log`) |
| `/websites/<name>/security` | maintenance / basic-auth / anti-bruteforce |
| `/terminal` (tenant) | `GET /websites`, `WS /websites/:slug/pty` |
| `/monitoring/*` | system monitoring endpoints (+ `WS`) |
| `/databases` | `GET /databases`, `GET /db-engines` |
| `/backup/*` | backup & migration endpoints |
| `/users/*` | users & groups endpoints |
| `/settings/*` | settings & system cleanup endpoints |

---

## 6. Urutan Implementasi Backend (disarankan)

1. **Fondasi**: SQLite (WAL) + migrasi skema, router HTTP + WS, JWT/RBAC middleware, `/system/capabilities`.
2. **Pilot: Websites** — `GET/POST/PATCH/DELETE /websites`, start/stop/restart, metrics. Sambungkan UI sampai benar-benar hidup dari API.
3. **Files + Deploy** (file manager API + git runner + `WS: deploy-log`).
4. **Terminal** (`pty` bridge: tenant + host, host gated admin).
5. **Databases + SSO gateway**, lalu **Domains/SSL**, **Tunnels**.
6. **Monitoring** (baca `/proc`, `smartctl`, `ss`) + **Backup/Migration** (rsync stream + `.bpod` + S3/R2).
7. **Cleanup & Cron** (systemd timer), **Pods** (Docker SDK).

> Catatan platform: semua di atas harus jalan di **linux/amd64 & linux/arm64** (lihat MASTER_PLAN §5). Deteksi LXC → matikan fitur yang tidak tersedia (S.M.A.R.T./fstrim) dan tampilkan status, bukan error.

---

## 7. Otomasi: API Token, Webhook & MCP Server

Tujuan: pengguna (dan **agen AI**) bisa mengotomasi panel tanpa membuka UI.

### 7.1 API Token (untuk REST API)

- Dibuat per-user: `GET|POST|DELETE /api-tokens` (butuh permission grup `apiTokens`).
- Format: `bp_live_<base62>` (mis. `bp_live_9f8a20bc…`); hanya **prefix + hash** yang disimpan server. Nilai penuh ditampilkan sekali saat dibuat.
- **Scope** (subset `GroupPermissions` + tingkat akses):
  `websites:read`, `websites:write`, `files:read`, `files:write`, `databases:read`, `databases:write`, `backup:run`, `system:read`, `cleanup:run`, `users:write`, `tokens:manage`.
- Token **tidak boleh melebihi** permission grup pemiliknya (efektif = irisan).
- Atribut: `expiresAt`, `lastUsedAt`, `ipAllowlist`, `revoked`.
- Audit log setiap request: `{ tokenId, userId, method, path, status, ip, ts }`.
- Rate limit per token (mis. 120 req/min burst).
- `GET /openapi.json` menyediakan spesifikasi OpenAPI 3 dari seluruh endpoint §4.

Contoh:
```bash
curl -H "Authorization: Bearer bp_live_9f8a20bc…" \
     https://panel.example.com/api/v1/websites
```

### 7.2 Webhook (event keluar & masuk)

- **Keluar**: `GET|POST|DELETE /webhooks` → `{ url, secret, events[] }`.
  Event: `website.deployed`, `website.status_changed`, `backup.completed`, `migration.completed`, `cleanup.completed`, `cert.expiring`, `disk.threshold`. Payload ditandatangani HMAC-SHA256 di header `X-BarePod-Signature`.
- **Masuk** (trigger otomasi): `POST /hooks/:token/run?action=deploy|cleanup|backup&target=<slug>` — tanpa JWT, token one-shot/berulang sesuai konfigurasi.
- GitHub push-to-deploy sudah memakai pola ini (`POST /webhook/:siteId/deploy?token=…`).

### 7.3 MCP Server (Model Context Protocol)

Supaya agen (Claude / Command Code / Cursor / dsb.) bisa memanggil panel sebagai *tools*.

**Arsitektur (disarankan): MCP standalone yang membungkus REST API.**
- Server MCP kecil (Node/Go) berjalan di mesin agen/CI, **bukan** di server panel.
- Auth: **API token** (scoped), bukan password panel → tidak menambah attack surface di server.
- Alternatif: subcommand bawaan `barepod mcp` (stdio) yang memanggil API internal via Unix socket.

Konfigurasi klien:
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

**Tools (contoh surface):**

| Tool | Scope | Aksi |
|---|---|---|
| `list_websites` / `get_website` | `websites:read` | daftar/detail website |
| `create_website` / `delete_website` | `websites:write` | buat/hapus website |
| `start_website` / `stop_website` / `restart_website` | `websites:write` | kontrol lifecycle |
| `redeploy_website` | `websites:write` | trigger deploy (stream via events) |
| `get_website_metrics` / `tail_website_logs` | `websites:read` | metrik & log |
| `list_files` / `read_file` / `write_file` | `files:read` / `files:write` | file manager |
| `list_databases` / `create_database` / `rotate_db_password` | `databases:*` | DB suite |
| `create_backup` / `list_backups` / `restore_backup` / `start_migration` | `backup:run` | backup & migrasi |
| `create_tunnel` / `add_tunnel_route` | `websites:write` | Cloudflare Tunnel |
| `list_users` / `create_user` / `update_user` / `assign_group` | `users:write` | user & grup |
| `system_metrics` / `list_services` / `restart_service` | `system:read` | monitoring host |
| `run_cleanup` / `list_cron_jobs` | `cleanup:run` | system & Docker cleanup |

**Resources** (konteks read-only): `barepod://websites`, `barepod://system/capabilities`, `barepod://settings`.
**Prompts**: `deploy-website`, `migrate-server` (panduan langkah untuk agen).

**Aturan keamanan:**
1. Default token **read-only**; write/delete butuh scope eksplisit.
2. Aksi destruktif (`delete_website`, `restore_backup`) wajib scope khusus + konfirmasi dua-langkah (tool `preview_*` → `apply_*`).
3. Semua aksi terekam di audit log dengan `tokenId`.
4. MCP tidak pernah menyimpan password panel; hanya token.
5. Server panel bisa mematikan otomasi per grup (permission `apiTokens = false`).

### 7.4 Otomasi per Pengguna

- Setiap pengguna bisa membuat token **sendiri** dengan scope ≤ permission grupnya. Contoh: tenant `alex` membuat token `websites:read` + `files:write` untuk pipeline CI-nya.
- Kuota token & webhook per grup (mis. Starter: 1 token, Agency: 10 token).
- Aktivitas yang dipicu agen tetap tunduk pada **cgroup/cpu/disk quota** tenant seperti aksi manual.
