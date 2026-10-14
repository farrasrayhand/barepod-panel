// Package store wraps the panel's local SQLite database (WAL mode).
package store

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Website is a hosted website (the "Website" entity in the UI).
type Website struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Domain       string `json:"domain"`
	TenantUser   string `json:"tenantUser"`
	Runtime      string `json:"runtime"`
	Version      string `json:"version"`
	Framework    string `json:"framework"`
	WebServer    string `json:"webServer"`
	Status       string `json:"status"`       // running | stopped | building | error
	DeployStatus string `json:"deployStatus"` // pending | building | ready | failed
	SourceKind   string `json:"sourceKind"`   // scaffold | github | upload | existing
	SourceRepo   string `json:"sourceRepo,omitempty"`
	SourceBranch    string `json:"sourceBranch,omitempty"`
	DeployHookToken string `json:"deployHookToken,omitempty"`
	AutoDeploy      bool   `json:"autoDeploy"`
	SSL             bool   `json:"ssl"`
	TunnelEnable    bool   `json:"tunnelEnabled"`
	Port            int    `json:"port"`
	CreatedAt       string `json:"createdAt"`
}

// WebsiteCronJob represents a scheduled task configured for a website running as its tenant.
type WebsiteCronJob struct {
	ID          string `json:"id"`
	WebsiteSlug string `json:"websiteSlug"`
	Name        string `json:"name"`
	Schedule    string `json:"schedule"` // e.g. "* * * * *" or "*/5 * * * *"
	Command     string `json:"command"`  // e.g. "php artisan schedule:run"
	Enabled     bool   `json:"enabled"`
	TimeoutSec  int    `json:"timeoutSec"`
	LastRunAt   string `json:"lastRunAt,omitempty"`
	LastStatus  string `json:"lastStatus,omitempty"` // success | failed | running
	LastOutput  string `json:"lastOutput,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

// UserGitProvider stores personal access credentials or OAuth tokens for git integrations.
type UserGitProvider struct {
	ID          string `json:"id"`
	UserID      string `json:"userId"`
	Provider    string `json:"provider"` // github | gitlab | bitbucket | gitea | custom
	Name        string `json:"name"`
	APIURL      string `json:"apiUrl,omitempty"`
	TokenCipher string `json:"-"`
	Username    string `json:"username,omitempty"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
}

// WebsiteDomain is a domain or alias mapped to a website, with its SSL/TLS state.
type WebsiteDomain struct {
	ID           string `json:"id"`
	WebsiteSlug  string `json:"websiteSlug"`
	Domain       string `json:"domain"`
	IsPrimary    bool   `json:"isPrimary"`
	SSLEnabled   bool   `json:"sslEnabled"`
	SSLProvider  string `json:"sslProvider"` // letsencrypt | zerossl | custom | self-signed | none
	SSLStatus    string `json:"sslStatus"`   // active | issuing | expired | error | none
	SSLCertPath  string `json:"sslCertPath"`
	SSLKeyPath   string `json:"sslKeyPath"`
	SSLIssuer    string `json:"sslIssuer"`
	SSLExpiresAt string `json:"sslExpiresAt"`
	ForceHTTPS   bool   `json:"forceHttps"`
	HSTSEnabled  bool   `json:"hstsEnabled"`
	AutoRenew    bool   `json:"autoRenew"`
	CreatedAt    string `json:"createdAt"`
}

// WebsiteSecurity defines the access control, HTTP basic auth, IP rules, and rate limits for a site.
type WebsiteSecurity struct {
	WebsiteSlug           string `json:"websiteSlug"`
	MaintenanceMode       bool   `json:"maintenanceMode"`
	MaintenanceTitle      string `json:"maintenanceTitle"`
	MaintenanceMessage    string `json:"maintenanceMessage"`
	MaintenanceBypassIPs  string `json:"maintenanceBypassIps"`
	BasicAuthEnabled      bool   `json:"basicAuthEnabled"`
	BasicAuthUser         string `json:"basicAuthUser"`
	BasicAuthPasswordHash string `json:"-"`
	HasPassword           bool   `json:"hasPassword"`
	BasicAuthRealm        string `json:"basicAuthRealm"`
	BasicAuthBypassIPs    string `json:"basicAuthBypassIps"`
	IPRestrictionMode     string `json:"ipRestrictionMode"` // none | allowlist | denylist
	IPRestrictionList     string `json:"ipRestrictionList"`
	RateLimitEnabled      bool   `json:"rateLimitEnabled"`
	RateLimitReqPerSec    int    `json:"rateLimitReqPerSec"`
	RateLimitBurst        int    `json:"rateLimitBurst"`
	AntiBruteforceEnabled bool   `json:"antiBruteforceEnabled"`
	AntiBruteforceMax     int    `json:"antiBruteforceMax"`
	AntiBruteforceBanMins int    `json:"antiBruteforceBanMins"`
	UpdatedAt             string `json:"updatedAt"`
}

// User is a panel account.
type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Email        string `json:"email"`
	Role         string `json:"role"` // admin | user
	GroupName    string `json:"groupName"`
	Status       string `json:"status"` // active | suspended
	PasswordHash string `json:"-"`
	CreatedAt    string `json:"createdAt"`
}

// Session is a browser session. ID is the stored (hashed) key; Token is the raw
// value the cookie carries and is never persisted or serialised.
type Session struct {
	ID            string `json:"id"`
	Token         string `json:"-"`
	UserID        string `json:"userId"`
	CSRFToken     string `json:"-"`
	UserAgent     string `json:"userAgent"`
	IP            string `json:"ip"`
	ElevatedUntil string `json:"elevatedUntil,omitempty"`
	CreatedAt     string `json:"createdAt"`
	LastSeenAt    string `json:"lastSeenAt"`
}

// Store is the SQLite-backed data access layer.
type Store struct {
	DB *sql.DB
}

// Open opens (creating if needed) the SQLite database and applies migrations.
func Open(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("store: create data dir: %w", err)
		}
	}
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=foreign_keys(1)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("store: open: %w", err)
	}
	// SQLite allows a single writer; serialising here avoids "database is locked".
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("store: ping: %w", err)
	}
	s := &Store{DB: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	// The panel database holds password hashes, session keys and encrypted
	// credentials: keep it and its WAL/SHM siblings root-only (0600). The data
	// directory is 0750, so only the owner can reach them anyway — this is the
	// layer that does not depend on the directory.
	for _, f := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(f); err == nil {
			_ = os.Chmod(f, 0o600)
		}
	}
	return s, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.DB.Close() }

const schemaV1 = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  group_name    TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token     TEXT NOT NULL,
  user_agent     TEXT NOT NULL DEFAULT '',
  ip             TEXT NOT NULL DEFAULT '',
  elevated_until TEXT,
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS websites (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  domain        TEXT NOT NULL,
  tenant_user   TEXT NOT NULL,
  runtime       TEXT NOT NULL,
  version       TEXT NOT NULL,
  framework     TEXT NOT NULL DEFAULT '',
  web_server    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'stopped',
  deploy_status TEXT NOT NULL DEFAULT 'ready',
  ssl           INTEGER NOT NULL DEFAULT 1,
  tunnel_enabled INTEGER NOT NULL DEFAULT 0,
  port          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_websites_slug ON websites(slug);

CREATE TABLE IF NOT EXISTS audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  action  TEXT NOT NULL,
  target  TEXT NOT NULL DEFAULT '',
  ip      TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`

func (s *Store) migrate() error {
	if _, err := s.DB.Exec(
		`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
	); err != nil {
		return fmt.Errorf("store: prepare migrations: %w", err)
	}
	for _, m := range migrations {
		var applied int
		if err := s.DB.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, m.version).Scan(&applied); err != nil {
			return fmt.Errorf("store: read migration state: %w", err)
		}
		if applied > 0 {
			continue
		}
		if _, err := s.DB.Exec(m.statements); err != nil {
			return fmt.Errorf("store: apply migration %d: %w", m.version, err)
		}
		if _, err := s.DB.Exec(
			`INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)`,
			m.version, time.Now().UTC().Format(time.RFC3339),
		); err != nil {
			return fmt.Errorf("store: record migration %d: %w", m.version, err)
		}
	}
	return nil
}
