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
}

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
