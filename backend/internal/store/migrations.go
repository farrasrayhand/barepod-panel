package store

// migration is one ordered, idempotent schema step.
type migration struct {
	version    int
	statements string
}

// migrations must only ever be appended to — existing versions are immutable.
var migrations = []migration{
	{version: 1, statements: schemaV1},
	{version: 2, statements: schemaV2},
	{version: 3, statements: schemaV3},
	{version: 4, statements: schemaV4},
	{version: 5, statements: schemaV5},
	{version: 6, statements: schemaV6},
	{version: 7, statements: schemaV7},
	{version: 8, statements: schemaV8},
	{version: 9, statements: schemaV9},
	{version: 10, statements: schemaV10},
	{version: 11, statements: schemaV11},
	{version: 12, statements: schemaV12},
	{version: 13, statements: schemaV13},
	{version: 14, statements: schemaV14},
	{version: 15, statements: schemaV15},
	{version: 16, statements: schemaV16},
	{version: 17, statements: schemaV17},
	{version: 18, statements: schemaV18},
	{version: 19, statements: schemaV19},
	{version: 20, statements: schemaV20},
	{version: 21, statements: schemaV21},
	{version: 22, statements: schemaV22},
	{version: 23, statements: schemaV23},
	{version: 24, statements: schemaV24},
	{version: 25, statements: schemaV25},
	{version: 26, statements: schemaV26},
}

// schemaV26 gives each package a CPU *share* next to its hard quota. The quota
// (cpu_quota_percent) stays the cap used in hardcap mode; cpu_weight is the
// relative share used when the operator turns CPU sharing on. Both are kept, so
// switching the allocation mode never loses either value. Existing packages are
// backfilled from their quota so a package that was "1 core" becomes "1 core of
// share" the moment sharing is switched on. 0 means unset (systemd default 100).
const schemaV26 = `
ALTER TABLE groups ADD COLUMN cpu_weight INTEGER NOT NULL DEFAULT 0;
UPDATE groups SET cpu_weight = cpu_quota_percent WHERE cpu_weight = 0 AND cpu_quota_percent > 0;
`

// schemaV25 gives an account a TOTP secret. The secret is encrypted like every other secret, and is
// only written once enrolment starts; totp_enabled marks a secret the operator has confirmed with a
// code, and only an enabled one is demanded at sign-in.
const schemaV25 = `
ALTER TABLE users ADD COLUMN totp_secret_cipher TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
`

// schemaV24 is the built-in maintenance scheduler's state: one row per system job the daemon can run
// on a schedule. It mirrors website_cron_jobs on purpose — an operator may disable a job or move its
// schedule, and the last run has to survive a restart either way. The rows are seeded from the
// daemon's job registry (EnsureSystemCronJobs), so the table only ever holds what actually exists.
const schemaV24 = `
CREATE TABLE IF NOT EXISTS system_cron_jobs (
  id           TEXT PRIMARY KEY,
  enabled      INTEGER NOT NULL DEFAULT 1,
  schedule     TEXT NOT NULL,
  last_run_at  TEXT NOT NULL DEFAULT '',
  last_status  TEXT NOT NULL DEFAULT '',
  last_output  TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL DEFAULT ''
);
`

// schemaV23 adds upstream_url to websites table so reverse proxy upstreams are permanently stored.
const schemaV23 = `
ALTER TABLE websites ADD COLUMN upstream_url TEXT NOT NULL DEFAULT '';
`

// schemaV22 cleans up orphaned records left by deleted websites.
const schemaV22 = `
DELETE FROM website_domains WHERE website_slug NOT IN (SELECT slug FROM websites);
DELETE FROM website_security WHERE website_slug NOT IN (SELECT slug FROM websites);
DELETE FROM website_cron_jobs WHERE website_slug NOT IN (SELECT slug FROM websites);
DELETE FROM website_secrets WHERE website_slug NOT IN (SELECT slug FROM websites);
`

// schemaV21 adds api_token, account_id, and tunnel_id to cloudflare_tunnels.
const schemaV21 = `
ALTER TABLE cloudflare_tunnels ADD COLUMN api_token TEXT NOT NULL DEFAULT '';
ALTER TABLE cloudflare_tunnels ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE cloudflare_tunnels ADD COLUMN tunnel_id TEXT NOT NULL DEFAULT '';
`

// schemaV20 adds cloudflare_tunnels and cloudflare_tunnel_routes.
const schemaV20 = `
CREATE TABLE IF NOT EXISTS cloudflare_tunnels (
  id          TEXT PRIMARY KEY,
  tenant_user TEXT NOT NULL UNIQUE,
  tunnel_name TEXT NOT NULL DEFAULT '',
  token       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_cf_tunnels_user ON cloudflare_tunnels(tenant_user);

CREATE TABLE IF NOT EXISTS cloudflare_tunnel_routes (
  id           TEXT PRIMARY KEY,
  tenant_user  TEXT NOT NULL,
  hostname     TEXT NOT NULL,
  service      TEXT NOT NULL,
  app_name     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'Healthy',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cf_routes_user ON cloudflare_tunnel_routes(tenant_user);
`

// schemaV19 adds deploy_script column to websites for custom or auto-detected CI/CD pipelines.
const schemaV19 = `
ALTER TABLE websites ADD COLUMN deploy_script TEXT NOT NULL DEFAULT '';
`

// schemaV18 adds deploy_hook_token and auto_deploy to websites, plus website_cron_jobs and user_git_providers.
const schemaV18 = `
ALTER TABLE websites ADD COLUMN deploy_hook_token TEXT NOT NULL DEFAULT '';
ALTER TABLE websites ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 1;

UPDATE websites SET deploy_hook_token = 'bph_' || lower(hex(randomblob(16))) WHERE deploy_hook_token = '';

CREATE TABLE IF NOT EXISTS website_cron_jobs (
  id           TEXT PRIMARY KEY,
  website_slug TEXT NOT NULL,
  name         TEXT NOT NULL,
  schedule     TEXT NOT NULL,
  command      TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  timeout_sec  INTEGER NOT NULL DEFAULT 300,
  last_run_at  TEXT NOT NULL DEFAULT '',
  last_status  TEXT NOT NULL DEFAULT '',
  last_output  TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_website_cron_site ON website_cron_jobs(website_slug);

CREATE TABLE IF NOT EXISTS user_git_providers (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  provider     TEXT NOT NULL,
  name         TEXT NOT NULL,
  api_url      TEXT NOT NULL DEFAULT '',
  token_cipher TEXT NOT NULL DEFAULT '',
  username     TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_git_providers_user ON user_git_providers(user_id);
`

// schemaV17 adds website_security table for per-app maintenance mode, HTTP basic auth, IP access rules, and rate limiting.
const schemaV17 = `
CREATE TABLE IF NOT EXISTS website_security (
  website_slug             TEXT PRIMARY KEY,
  maintenance_mode         INTEGER NOT NULL DEFAULT 0,
  maintenance_title        TEXT NOT NULL DEFAULT '',
  maintenance_message      TEXT NOT NULL DEFAULT '',
  maintenance_bypass_ips   TEXT NOT NULL DEFAULT '',
  basic_auth_enabled       INTEGER NOT NULL DEFAULT 0,
  basic_auth_user          TEXT NOT NULL DEFAULT '',
  basic_auth_password_hash TEXT NOT NULL DEFAULT '',
  basic_auth_realm         TEXT NOT NULL DEFAULT '',
  basic_auth_bypass_ips    TEXT NOT NULL DEFAULT '',
  ip_restriction_mode      TEXT NOT NULL DEFAULT 'none',
  ip_restriction_list      TEXT NOT NULL DEFAULT '',
  rate_limit_enabled       INTEGER NOT NULL DEFAULT 0,
  rate_limit_req_per_sec   INTEGER NOT NULL DEFAULT 10,
  rate_limit_burst         INTEGER NOT NULL DEFAULT 20,
  anti_bruteforce_enabled  INTEGER NOT NULL DEFAULT 1,
  anti_bruteforce_max      INTEGER NOT NULL DEFAULT 5,
  anti_bruteforce_ban_mins INTEGER NOT NULL DEFAULT 15,
  updated_at               TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_website_security_slug ON website_security(website_slug);
`

// schemaV16 adds website_domains table for multi-domain mapping, aliases, and SSL/TLS tracking.
const schemaV16 = `
CREATE TABLE IF NOT EXISTS website_domains (
  id              TEXT PRIMARY KEY,
  website_slug    TEXT NOT NULL,
  domain          TEXT NOT NULL UNIQUE,
  is_primary      INTEGER NOT NULL DEFAULT 0,
  ssl_enabled     INTEGER NOT NULL DEFAULT 1,
  ssl_provider    TEXT NOT NULL DEFAULT 'self-signed',
  ssl_status      TEXT NOT NULL DEFAULT 'active',
  ssl_cert_path   TEXT NOT NULL DEFAULT '',
  ssl_key_path    TEXT NOT NULL DEFAULT '',
  ssl_issuer      TEXT NOT NULL DEFAULT '',
  ssl_expires_at  TEXT NOT NULL DEFAULT '',
  force_https     INTEGER NOT NULL DEFAULT 1,
  hsts_enabled    INTEGER NOT NULL DEFAULT 0,
  auto_renew      INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_domains_site ON website_domains(website_slug);
CREATE INDEX IF NOT EXISTS idx_domains_domain ON website_domains(domain);

INSERT OR IGNORE INTO website_domains (id, website_slug, domain, is_primary, ssl_enabled, ssl_provider, ssl_status, created_at)
SELECT 'dom_' || id, slug, domain, 1, ssl, 'self-signed', 'active', created_at FROM websites;
`

// schemaV15 renames two built-in packages to the names the panel uses now. The
// names are stored data (groups.name AND users.group_name), so a rename is a
// migration rather than a constant change; each statement is a no-op when the old
// name is absent, which is the case on a fresh database where EnsureDefaultGroups
// inserts the new names.
const schemaV15 = `
UPDATE groups SET name = 'Unlimited' WHERE name = 'Superadmin (Root)';
UPDATE users  SET group_name = 'Unlimited' WHERE group_name = 'Superadmin (Root)';
UPDATE groups SET name = 'Basic' WHERE name = 'Developer';
UPDATE users  SET group_name = 'Basic' WHERE group_name = 'Developer';
DELETE FROM groups WHERE name = 'Read Only'
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.group_name = 'Read Only');
`

// schemaV14 lets one ban close several ports. SSH can listen on more than one while its port is being
// moved — the safe way to move it is to add the new one and keep the old until the new answers — and a
// single-port scope meant the new door stood open for the length of that window. The old `port` column
// is left in place and unused: dropping a column is the kind of migration that can fail on an older
// SQLite, and a panel that will not start is a worse outcome than a column nobody reads.
const schemaV14 = `
ALTER TABLE guard_bans ADD COLUMN ports TEXT NOT NULL DEFAULT '';
`

// schemaV13 records what a ban covers. 0 is the whole host, which is what a ban earned on a database
// engine is: an address attacking PostgreSQL has no business reaching anything else either. A port
// means that door only, which is what the panel's own logins and SSH earn — so an operator who trips
// their own lockout loses the panel and nothing else, and can still get in to fix it.
const schemaV13 = `
ALTER TABLE guard_bans ADD COLUMN port INTEGER NOT NULL DEFAULT 0;
`

// schemaV12 is where the panel keeps a setting that belongs to the panel and not to any record. The
// first one is the address an external client should use, which the daemon cannot work out for
// itself: behind NAT it has no public address to discover, and a domain is knowledge only the
// operator has.
const schemaV12 = `
CREATE TABLE IF NOT EXISTS panel_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
`

// schemaV11 lets an engine have its own lockout numbers. The row in guard_settings stays the
// default for every engine; a row here overrides it for one of them, because a cache that is asked
// for a password ten times a second and a panel login are not the same risk and should not have to
// share one threshold.
const schemaV11 = `
CREATE TABLE IF NOT EXISTS guard_engine_settings (
  engine     TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 1,
  max_retry  INTEGER NOT NULL DEFAULT 5,
  find_time  TEXT NOT NULL DEFAULT '10m0s',
  ban_time   TEXT NOT NULL DEFAULT '1h0m0s',
  updated_at TEXT NOT NULL DEFAULT ''
);
`

// schemaV10 is per-database exposure: a database is private unless an operator says
// otherwise, and "public" is a decision the panel records because it is the one that opened
// the port — with the address it was opened from, so the panel can close it again and say
// when it did.
const schemaV10 = `
ALTER TABLE databases ADD COLUMN exposure TEXT NOT NULL DEFAULT '';
ALTER TABLE databases ADD COLUMN exposure_note TEXT NOT NULL DEFAULT '';
ALTER TABLE databases ADD COLUMN exposed_at TEXT NOT NULL DEFAULT '';
`

// schemaV9 is the brute-force lockout: the addresses the panel keeps out of the engines,
// and the numbers it decides with. The bans live here rather than only in the kernel
// because a panel restart must not forget one — the nft set is re-filled from this table
// at every start — and because an operator should be able to see and release them without
// knowing nft exists.
const schemaV9 = `
CREATE TABLE IF NOT EXISTS guard_bans (
  ip         TEXT PRIMARY KEY,
  engine     TEXT NOT NULL DEFAULT '',
  user_name  TEXT NOT NULL DEFAULT '',
  reason     TEXT NOT NULL DEFAULT '',
  hits       INTEGER NOT NULL DEFAULT 0,
  banned_at  TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guard_bans_expiry ON guard_bans(expires_at);

CREATE TABLE IF NOT EXISTS guard_settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  enabled    INTEGER NOT NULL DEFAULT 1,
  max_retry  INTEGER NOT NULL DEFAULT 5,
  find_time  TEXT NOT NULL DEFAULT '10m0s',
  ban_time   TEXT NOT NULL DEFAULT '1h0m0s',
  updated_at TEXT NOT NULL DEFAULT ''
);
`

// schemaV8 marks a database that outlived its website: deleting a website can keep its
// databases, and a kept record would otherwise be indistinguishable from one that was
// simply created on its own (both have no website) — so the panel could not show them.
// It is cleared the moment the record belongs to a website again.
const schemaV8 = `
ALTER TABLE databases ADD COLUMN detached_at TEXT NOT NULL DEFAULT '';
`

// schemaV2 adds the deploy job ledger: one row per deployment, plus its step log.
const schemaV2 = `
CREATE TABLE IF NOT EXISTS deploy_jobs (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  website_id   TEXT NOT NULL DEFAULT '',
  mode         TEXT NOT NULL DEFAULT 'dry-run',
  status       TEXT NOT NULL DEFAULT 'pending',
  step         INTEGER NOT NULL DEFAULT 0,
  total_steps  INTEGER NOT NULL DEFAULT 0,
  current_step TEXT NOT NULL DEFAULT '',
  error        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  finished_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_deploy_jobs_slug ON deploy_jobs(slug, created_at DESC);

CREATE TABLE IF NOT EXISTS deploy_logs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id  TEXT NOT NULL,
  ts      TEXT NOT NULL,
  stream  TEXT NOT NULL DEFAULT 'stdout',
  line    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deploy_logs_job ON deploy_logs(job_id, id);

CREATE TABLE IF NOT EXISTS website_secrets (
  id           TEXT PRIMARY KEY,
  website_slug TEXT NOT NULL,
  name         TEXT NOT NULL,
  ciphertext   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (website_slug, name)
);
`

// schemaV6 is the database and cache ledger. Both are the same shape on purpose:
// a cache is a database with a different engine, a fixed set of commands and its
// own endpoint family, so the recycle bin and the credential vault work once.
const schemaV6 = `
CREATE TABLE IF NOT EXISTS databases (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'database', -- database | cache
  website_slug    TEXT NOT NULL DEFAULT '',
  tenant_user     TEXT NOT NULL,
  engine          TEXT NOT NULL,
  version         TEXT NOT NULL DEFAULT '',
  alias           TEXT NOT NULL DEFAULT '',
  db_name         TEXT NOT NULL DEFAULT '',
  db_user         TEXT NOT NULL DEFAULT '',
  password_cipher TEXT NOT NULL DEFAULT '',
  host            TEXT NOT NULL DEFAULT '',
  port            INTEGER NOT NULL DEFAULT 0,
  file_path       TEXT NOT NULL DEFAULT '',
  max_connections INTEGER NOT NULL DEFAULT 0,
  max_memory_mb   INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'ready',    -- ready | suspended | provisioning | failed
  note            TEXT NOT NULL DEFAULT '',
  deleted_at      TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_databases_tenant ON databases(tenant_user, kind);
CREATE INDEX IF NOT EXISTS idx_databases_site ON databases(website_slug);
`

// schemaV7 holds the administrator credential of a containerised engine: the panel
// generates it when it first brings the container up, and needs it afterwards to run
// admin SQL. Encrypted, like every other secret.
const schemaV7 = `
CREATE TABLE IF NOT EXISTS engine_credentials (
  engine     TEXT PRIMARY KEY,
  admin_user TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  host       TEXT NOT NULL DEFAULT '127.0.0.1',
  port       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`

// schemaV5 remembers where a website's code came from, so a redeploy does not
// have to ask the operator again.
const schemaV5 = `
ALTER TABLE websites ADD COLUMN source_kind TEXT NOT NULL DEFAULT '';
ALTER TABLE websites ADD COLUMN source_repo TEXT NOT NULL DEFAULT '';
ALTER TABLE websites ADD COLUMN source_branch TEXT NOT NULL DEFAULT '';
`

// schemaV3 describes permission groups. Membership is tracked on users.group_name.
const schemaV3 = `
ALTER TABLE groups ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE groups ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;
`

// schemaV4 gives each group (= tenant package) its resource allowances.
// 0 means unlimited for every column, so existing rows keep working.
const schemaV4 = `
ALTER TABLE groups ADD COLUMN cpu_quota_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN memory_mb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN tasks_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN disk_quota_gb INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN inode_quota INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN max_sites INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN max_databases INTEGER NOT NULL DEFAULT 0;
`
