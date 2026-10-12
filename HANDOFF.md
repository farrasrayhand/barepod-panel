# Handoff — start here

BarePod Panel: a hosting panel that manages databases, caches and (next) websites on a real host, with
its own anti-brute-force watchdog instead of fail2ban. One session per module; this file is written so a
new session can start working in minutes instead of re-reading the plan.

**MASTER_PLAN.md was compacted** on 2026-10-12: its 137-line build log became 22 lines of decisions (kept: every measured claim that a later change must not undo; dropped: the narration, which is in the file's own git history). The remaining sections were **not** touched, deliberately — they are module specifications for things not built yet (domains, backups, telemetry) plus the repo map and the status table, and rewriting a spec nobody has read is how this session lost work twice. If it needs a second pass, read §3.x and §4.1 first, and check §4.1 against `HANDOFF.md`, which is newer.

**Authoritative documents:** `MASTER_PLAN.md` = decisions *with the measurements behind them* (481 lines —
read the sections you need, not all of it). `API_CONTRACT.md` = what the daemon serves. Neither is a
wish list: every claim in them was measured on the host.

## State, verified on the host (2026-10-12)

- **Databases & caches: live and verified.** Lifecycle, quota refusal, credentials + rotate/reveal, export,
  data browser, Redis ACL users, per-record logs, exposure private/public gated behind the watchdog.
- **Anti-brute-force watchdog: live, 6 log sources** (PostgreSQL, MariaDB, MongoDB, Redis ACL LOG, the
  panel's own refused logins, sshd's journal), per-engine thresholds in Settings → Security, kernel bans
  with timeouts, door-scoped: panel port, SSH port, or host-wide for engines. A real SSH brute-force was
  measured: port 22 dropped, panel still `200`.
- **Ports:** panel and SSH are editable (Settings → General, one **Change** each) and **a port any active
  service already holds is refused with that service named** (`ss -ltnp`).
- **On-demand managers (pgweb/phpMyAdmin/DbGate):** verified end to end — adopted at startup, stopped by
  the sweeper, failures now logged. An adopted container older than the idle window is due immediately.
- **The Stack is live, and the web server is a host-level choice.** One engine owns `:80`: **nginx or Caddy** (both vhost generators exist), switched from the new admin **Stack** screen — every site's vhost is rewritten, validated once, then the old engine is stopped and the new one started (a reload alone cannot work: the new engine is not running while the old holds the port), and a failure restores files, ownership and the previous engine. Installs (`nginx`, `caddy`, `php`+version, `node`+major, the DB engines) run **on this host from an allowlist** as a job with a live log over SSE. Measured on the LXC: `php-demo.test` answered "Hello from PHP 8.3.6 as bptest" through **both** engines after switching each way.
- **Mocks stay, marked.** The operator's rule: a mock is a plan, so it is labelled `Not applied: …`, not
  deleted and not silently kept. An unmarked mock is treated as a bug.
- **Tenants & User Groups: live and measured on the host.** The users/groups API answers (`401` without a
  session), and an authenticated smoke test created a package and an account (the Linux account and its
  `/home` were really created), suspended and reactivated it, then deleted both; the audit recorded each
  step. **Not verified:** a full browser click-through of the screen. Two hardening changes ride with it:
  a suspended account's websites are stopped and marked `suspended` (a start is refused until
  reactivation), and **session tokens are stored only as a hash** while the panel database is `0600`.

## The working loop

Backend (Go, `backend/`): `go build ./...` then `go test -timeout 250s ./...` (251 tests, ~25s).
Frontend (`frontend/`): `npx tsc -b` **and** `npx vite build` — the type-checker is not enough (see traps).
Deploy: build `linux/amd64` binary + `vite build`, copy both to the host, move the binary into place,
unpack the bundle to `/var/lib/barepod/dist`, `systemctl restart barepod`, then **verify by measurement on
the host** — the served bundle, `systemctl is-active`, the journal, the database, `nft`.

Host access: an LXC at `172.19.1.26`, reached as root. The password is **not** in this repository and must
never be; it comes from the session environment. Same for any token.

## Traps that cost time in this session

- **The type-checker cannot see placement.** A component can be valid TypeScript and rendered on every
  tab because it sits outside every `{activeTab === …}` block. After moving JSX, check the **line order**
  against the tab that opens it (an `awk` line-number check beats an eyeball).
- **Read before patching.** Guessed anchors fail silently or cut the wrong span; two commits in this
  session recorded documentation edits that never applied. Verify the anchor, then verify the result.
- **`grep -c` exits 1 on zero matches** — an `&&` chain after it swallows the rest of the command. Two
  deploys went out uncommitted this way.
- **`nft add element` with a comma-separated list of elements silently adds nothing** (exit 0, empty set).
  One command per element, each with its own `timeout`.
- **Never trust a test that encodes your assumption.** Two bugs were blessed by unit tests written from
  the same wrong belief; the kernel and the host caught both.
- **Timestamps:** the panel stores UTC, sshd/Postgres log in host-local time, and this host is
  **WITA (UTC+8), not WIB**. Use read-time ordering, not parsed log timestamps.
- **Don't make the operator the test runner, and don't make them wait.** Three things cost an hour here: the
  deploy uploaded a **31 MB** binary every iteration (strip it and gzip it — 8 MB); an interactive test was
  run without `timeout`, so a real `whiptail` menu waited for a keypress and hung the whole call; and the
  `git commit` sat *after* the host steps, so an aborted call took the commit with it. Order: verify the
  logic locally with a stub on `PATH` (no upload at all), commit locally first, then one short deploy.
- **Don't make the operator wait.** Verify with short windows, poll for the result, and use a `trap` so a
  half-finished probe cannot leave the host changed.

## Next, in the order the operator chose

1. **Tenants & User Groups — the control plane shipped.** The users/groups HTTP API is live (`GET|POST
   /users`, `PATCH|DELETE /users/{id}`, `POST /users/{id}/password`, `GET|POST /groups`, `PATCH|DELETE
   /groups/{name}`), gated on the `users` capability. Creating an account also provisions its Linux account
   and applies the package's disk/inode quota from the panel; suspending mirrors `usermod --lock` and
   revokes that account's sessions; deleting one that still owns websites/databases is refused with `409
   has_resources`. Hardened alongside it: an unknown owner is refused on every create path, `maxSites` now
   answers `409 quota_exceeded` (matching databases), and a package edit re-applies the quota to its
   members. The UI page is live. **Still open in this module:** the **admin catalog** for installing extra
   engine/PHP versions, and re-rendering a site's cgroup limits when its package changes (today they land
   on the next deploy). The Linux account is now **mandatory at creation** (the CLI `barepod admin create`
   provisions too, and a real host that cannot make one refuses rather than recording the account);
   `POST /users/{id}/provision` reconciles an older account and the screen offers it whenever `osExists`
   is false; deleting an account removes its Linux account and home with it. The quota capability is only
   claimed when the filesystem actually has user quotas enabled — this host does not (an unprivileged
   container cannot remount its root), so the panel reports it unavailable instead of failing every
   `setquota`. **Because the kernel cannot enforce it here, the panel does:** it measures each account's
   home (`disk{usedBytes,maxBytes}` in `GET /users`, shown on the screen) and refuses its own editor
   saves/uploads that would exceed the package allowance (`409 quota_exceeded`, `enforcedBy: "panel"`). A
   process writing from inside a site is not stopped — only a kernel quota does that.
2. **Websites, one PHP site end to end — the two missing pieces now exist (nginx).** `internal/phpfpm`
   writes the pool the unit's `ExecStart` already pointed at (`<site>/php-fpm.conf`, tenant-owned, a unix
   socket inside the site, `open_basedir` = the site + `/tmp`), and `internal/webserver` writes the nginx
   vhost (`/etc/nginx/sites-enabled/barepod-<slug>.conf`, `fastcgi_pass` to that socket; the site is
   granted read access to `www-data` with the setgid bit). The pipeline gained two steps (10 now: pool,
   vhost, then unit/start/health) and the health check asks for the site **by domain through nginx**.
   `GET|PUT /websites/:slug/runtime`, `vhost/preview` and `php-fpm/reload` are live; the wizard only
   offers nginx (the other engines answer `501 not_supported_yet`), and the operator installs nginx +
   php-fpm. Next in this module: OpenLiteSpeed/Caddy/Apache, TLS, then logs/traffic/access control.
3. **The Stack — databases, then PHP, then Node (the menu exists).** The screen is built and its install
   machinery works; what is left is the *choosing*: installing a database engine version and pointing the
   panel at it (today one version per engine, chosen at install), then per-site PHP/Node version selection.
   The plan and its phases are in `~/.commandcode/plans/stack-menu.md` (P1 shipped). Then: domains & TLS,
   backups/migration, pods/Docker, tunnels — still mocks.

**`barepod uninstall` is built and guided.** The menus are `whiptail` (present on any base Ubuntu/Debian),
driven through `sh -c … 3>&1 1>&2 2>&3` — the fd swap has to happen in a shell, and passing it as argv to
whiptail is a usage error (`--output-fd` is not in every version either); both of those were shipped and
then found by the operator. The final confirmation is a box with *No* preselected, and a menu that cannot be
drawn falls back to plain questions rather than to a silent default. Verified by a dry run: It reads the truth from the store
rather than inferring it: on this host the plan named 3 sites, 1 tenant account, 9 ledger databases, the
lockout's nftables table and 2 panel containers — and running it without `--yes` left the state identical
(service active, database present, units and table untouched). Guided by default: it prints the plan, then
asks with `Type uninstall` and one question per irreversible step; with `--yes` nothing irreversible happens
unless a flag names it (`--purge-data`, `--remove-tenants`, `--remove-tenant-data`, `--remove-volumes`), and
it refuses a backup directory inside anything it deletes — a guard whose first version was wrong in exactly
that case and was caught by its own test. The backup is written with the panel already stopped (SQLite WAL:
a copy of a live database can miss the write-ahead log), prefers `sqlite3 VACUUM INTO`, and is read back
before a single file is removed.

**Still script-only:** `scripts/uninstall.sh` does not yet delegate to the CLI — it stands alone, which is
what a host needs when the binary is gone (a broken install is exactly when someone reaches for it), but
where both exist the script should hand over to `barepod uninstall` and keep only the package removal that
the CLI deliberately does not do.

## How this operator works (worth following)

Direct, fast, and they check claims. Honest labels beat reassuring ones: mark what is not built, name what
broke, and state what was not verified. Commits carry no co-author trailer. Every "done" should be
something that was measured on the host, not something that compiles.
