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
}

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
