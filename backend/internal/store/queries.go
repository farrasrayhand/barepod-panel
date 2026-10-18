package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// sessionKey is what the database stores for a session: the SHA-256 of the token
// the cookie carries. A leaked database therefore holds no usable session token.
func sessionKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// --- Users ---

// CreateUser inserts a new panel user.
func (s *Store) CreateUser(username, email, passwordHash, role, groupName string) (*User, error) {
	u := &User{
		ID:           id.New(),
		Username:     username,
		Email:        email,
		PasswordHash: passwordHash,
		Role:         role,
		GroupName:    groupName,
		Status:       "active",
		CreatedAt:    now(),
	}
	_, err := s.DB.Exec(
		`INSERT INTO users (id, username, email, password_hash, role, group_name, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		u.ID, u.Username, u.Email, u.PasswordHash, u.Role, u.GroupName, u.Status, u.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func scanUser(row *sql.Row) (*User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.GroupName, &u.Status, &u.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// UserByUsername looks a user up by username.
func (s *Store) UserByUsername(username string) (*User, error) {
	return scanUser(s.DB.QueryRow(
		`SELECT id, username, email, password_hash, role, group_name, status, created_at
		 FROM users WHERE username = ?`, username))
}

// UserByID looks a user up by id.
func (s *Store) UserByID(userID string) (*User, error) {
	return scanUser(s.DB.QueryRow(
		`SELECT id, username, email, password_hash, role, group_name, status, created_at
		 FROM users WHERE id = ?`, userID))
}

// CountUsers returns the number of panel users.
func (s *Store) CountUsers() (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// --- Sessions ---

// CreateSession stores a new browser session and returns it. The raw token (what
// the cookie carries) is returned in Token; only its hash is written to disk.
func (s *Store) CreateSession(userID, userAgent, ip, csrf string) (*Session, error) {
	token := id.Token(24)
	sess := &Session{
		ID:         sessionKey(token),
		Token:      token,
		UserID:     userID,
		CSRFToken:  csrf,
		UserAgent:  userAgent,
		IP:         ip,
		CreatedAt:  now(),
		LastSeenAt: now(),
	}
	_, err := s.DB.Exec(
		`INSERT INTO sessions (id, user_id, csrf_token, user_agent, ip, created_at, last_seen_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		sess.ID, sess.UserID, sess.CSRFToken, sess.UserAgent, sess.IP, sess.CreatedAt, sess.LastSeenAt,
	)
	if err != nil {
		return nil, err
	}
	return sess, nil
}

// SessionByID loads a session by the token its cookie carries, hashing it to the
// stored id. The returned session keeps the raw token in Token so callers (the
// WebSocket ticket) can hand it on without ever reading it back from the store.
func (s *Store) SessionByID(token string) (*Session, error) {
	if token == "" {
		return nil, ErrNotFound
	}
	var sess Session
	var elevated sql.NullString
	err := s.DB.QueryRow(
		`SELECT id, user_id, csrf_token, user_agent, ip, elevated_until, created_at, last_seen_at
		 FROM sessions WHERE id = ?`, sessionKey(token),
	).Scan(&sess.ID, &sess.UserID, &sess.CSRFToken, &sess.UserAgent, &sess.IP, &elevated, &sess.CreatedAt, &sess.LastSeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	sess.ElevatedUntil = elevated.String
	sess.Token = token
	return &sess, nil
}

// TouchSession updates the last-seen timestamp.
func (s *Store) TouchSession(sessionID string) error {
	_, err := s.DB.Exec(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`, now(), sessionID)
	return err
}

// DeleteSession revokes a session immediately.
func (s *Store) DeleteSession(sessionID string) error {
	_, err := s.DB.Exec(`DELETE FROM sessions WHERE id = ?`, sessionID)
	return err
}

// ListSessions returns a user's active sessions, newest first.
func (s *Store) ListSessions(userID string) ([]Session, error) {
	rows, err := s.DB.Query(
		`SELECT id, user_id, user_agent, ip, COALESCE(elevated_until, ''), created_at, last_seen_at
		 FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Session{}
	for rows.Next() {
		var sess Session
		if err := rows.Scan(&sess.ID, &sess.UserID, &sess.UserAgent, &sess.IP, &sess.ElevatedUntil, &sess.CreatedAt, &sess.LastSeenAt); err != nil {
			return nil, err
		}
		out = append(out, sess)
	}
	return out, rows.Err()
}

// SetElevated grants elevated (sudo) mode on a session until the given time.
func (s *Store) SetElevated(sessionID string, until time.Time) error {
	_, err := s.DB.Exec(`UPDATE sessions SET elevated_until = ? WHERE id = ?`, until.UTC().Format(time.RFC3339), sessionID)
	return err
}

// --- Websites ---

// ListWebsites returns every website, newest first.
func (s *Store) ListWebsites() ([]Website, error) {
	rows, err := s.DB.Query(
		`SELECT id, slug, domain, tenant_user, runtime, version, framework, web_server,
		        status, deploy_status, ssl, tunnel_enabled, port, upstream_url, created_at,
		        source_kind, source_repo, source_branch, deploy_hook_token, auto_deploy, deploy_script
		 FROM websites ORDER BY created_at DESC, slug ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Website{}
	for rows.Next() {
		var w Website
		if err := rows.Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version,
			&w.Framework, &w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable,
			&w.Port, &w.UpstreamURL, &w.CreatedAt, &w.SourceKind, &w.SourceRepo, &w.SourceBranch,
			&w.DeployHookToken, &w.AutoDeploy, &w.DeployScript); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// ListWebsitesByTenant returns the websites owned by one tenant account.
func (s *Store) ListWebsitesByTenant(tenant string) ([]Website, error) {
	rows, err := s.DB.Query(
		`SELECT id, slug, domain, tenant_user, runtime, version, framework, web_server,
		        status, deploy_status, ssl, tunnel_enabled, port, upstream_url, created_at,
		        source_kind, source_repo, source_branch, deploy_hook_token, auto_deploy, deploy_script
		 FROM websites WHERE tenant_user = ? ORDER BY created_at DESC, slug ASC`, tenant)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Website{}
	for rows.Next() {
		var w Website
		if err := rows.Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version,
			&w.Framework, &w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable,
			&w.Port, &w.UpstreamURL, &w.CreatedAt, &w.SourceKind, &w.SourceRepo, &w.SourceBranch,
			&w.DeployHookToken, &w.AutoDeploy, &w.DeployScript); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CountWebsitesByTenant returns how many websites a tenant owns.
func (s *Store) CountWebsitesByTenant(tenant string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM websites WHERE tenant_user = ?`, tenant).Scan(&n)
	return n, err
}

// WebsiteBySlug looks a website up by its slug.
func (s *Store) WebsiteBySlug(slug string) (*Website, error) {
	var w Website
	err := s.DB.QueryRow(
		`SELECT id, slug, domain, tenant_user, runtime, version, framework, web_server,
		        status, deploy_status, ssl, tunnel_enabled, port, upstream_url, created_at,
		        source_kind, source_repo, source_branch, deploy_hook_token, auto_deploy, deploy_script
		 FROM websites WHERE slug = ?`, slug,
	).Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version, &w.Framework,
		&w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable, &w.Port, &w.UpstreamURL, &w.CreatedAt,
		&w.SourceKind, &w.SourceRepo, &w.SourceBranch, &w.DeployHookToken, &w.AutoDeploy, &w.DeployScript)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// WebsiteByDomain looks a website up by its primary domain.
func (s *Store) WebsiteByDomain(domain string) (*Website, error) {
	var w Website
	err := s.DB.QueryRow(
		`SELECT id, slug, domain, tenant_user, runtime, version, framework, web_server,
		        status, deploy_status, ssl, tunnel_enabled, port, upstream_url, created_at,
		        source_kind, source_repo, source_branch, deploy_hook_token, auto_deploy, deploy_script
		 FROM websites WHERE lower(domain) = ?`, strings.ToLower(strings.TrimSpace(domain)),
	).Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version, &w.Framework,
		&w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable, &w.Port, &w.UpstreamURL, &w.CreatedAt,
		&w.SourceKind, &w.SourceRepo, &w.SourceBranch, &w.DeployHookToken, &w.AutoDeploy, &w.DeployScript)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &w, nil
}

// CreateWebsite inserts a website row.
func (s *Store) CreateWebsite(w *Website) error {
	if w.ID == "" {
		w.ID = id.New()
	}
	if w.CreatedAt == "" {
		w.CreatedAt = now()
	}
	if w.DeployHookToken == "" {
		w.DeployHookToken = "bph_" + id.Token(24)
	}
	_, err := s.DB.Exec(
		`INSERT INTO websites (id, slug, domain, tenant_user, runtime, version, framework,
		                       web_server, status, deploy_status, ssl, tunnel_enabled, port, upstream_url, created_at,
		                       source_kind, source_repo, source_branch, deploy_hook_token, auto_deploy, deploy_script)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.Slug, w.Domain, w.TenantUser, w.Runtime, w.Version, w.Framework,
		w.WebServer, w.Status, w.DeployStatus, w.SSL, w.TunnelEnable, w.Port, strings.TrimSpace(w.UpstreamURL), w.CreatedAt,
		w.SourceKind, w.SourceRepo, w.SourceBranch, w.DeployHookToken, w.AutoDeploy, w.DeployScript,
	)
	if err != nil {
		return err
	}
	// Auto-create primary domain row
	_, _ = s.DB.Exec(
		`INSERT OR IGNORE INTO website_domains (id, website_slug, domain, is_primary, ssl_enabled, ssl_provider, ssl_status, created_at)
		 VALUES (?, ?, ?, 1, ?, 'self-signed', 'active', ?)`,
		"dom_"+w.ID, w.Slug, w.Domain, w.SSL, w.CreatedAt,
	)
	return nil
}

// UpdateWebsiteGit updates repository URL, target branch, and auto_deploy setting.
func (s *Store) UpdateWebsiteGit(slug, repo, branch string, autoDeploy bool) error {
	_, err := s.DB.Exec(
		`UPDATE websites SET source_repo = ?, source_branch = ?, auto_deploy = ? WHERE slug = ?`,
		repo, branch, autoDeploy, slug,
	)
	return err
}

// UpdateWebsiteDeployScript updates the CI/CD build script.
func (s *Store) UpdateWebsiteDeployScript(slug, script string) error {
	_, err := s.DB.Exec(
		`UPDATE websites SET deploy_script = ? WHERE slug = ?`,
		script, slug,
	)
	return err
}

// UpdateWebsiteVersion updates the runtime version of a website.
func (s *Store) UpdateWebsiteVersion(slug, version string) error {
	_, err := s.DB.Exec(
		`UPDATE websites SET version = ? WHERE slug = ?`,
		version, slug,
	)
	return err
}

// UpdateWebsitePort updates the service/proxy port of a website.
func (s *Store) UpdateWebsitePort(slug string, port int) error {
	_, err := s.DB.Exec(`UPDATE websites SET port = ? WHERE slug = ?`, port, slug)
	return err
}

// UpdateWebsiteUpstream updates the reverse proxy upstream URL.
func (s *Store) UpdateWebsiteUpstream(slug, upstreamURL string) error {
	_, err := s.DB.Exec(`UPDATE websites SET upstream_url = ? WHERE slug = ?`, strings.TrimSpace(upstreamURL), slug)
	return err
}

// UpdateWebsiteFramework updates the framework name/label of a website.
func (s *Store) UpdateWebsiteFramework(slug, framework string) error {
	_, err := s.DB.Exec(`UPDATE websites SET framework = ? WHERE slug = ?`, strings.TrimSpace(framework), slug)
	return err
}

// --- Website Scheduled Tasks (Cron Jobs) ---

// ListWebsiteCronJobs returns all scheduled tasks configured for a website.
func (s *Store) ListWebsiteCronJobs(slug string) ([]WebsiteCronJob, error) {
	rows, err := s.DB.Query(
		`SELECT id, website_slug, name, schedule, command, enabled, timeout_sec,
		        last_run_at, last_status, last_output, created_at, updated_at
		 FROM website_cron_jobs WHERE website_slug = ? ORDER BY created_at ASC`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WebsiteCronJob{}
	for rows.Next() {
		var j WebsiteCronJob
		if err := rows.Scan(&j.ID, &j.WebsiteSlug, &j.Name, &j.Schedule, &j.Command,
			&j.Enabled, &j.TimeoutSec, &j.LastRunAt, &j.LastStatus, &j.LastOutput,
			&j.CreatedAt, &j.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, rows.Err()
}

// WebsiteCronJobByID looks up a scheduled task by ID.
func (s *Store) WebsiteCronJobByID(id string) (*WebsiteCronJob, error) {
	var j WebsiteCronJob
	err := s.DB.QueryRow(
		`SELECT id, website_slug, name, schedule, command, enabled, timeout_sec,
		        last_run_at, last_status, last_output, created_at, updated_at
		 FROM website_cron_jobs WHERE id = ?`, id,
	).Scan(&j.ID, &j.WebsiteSlug, &j.Name, &j.Schedule, &j.Command,
		&j.Enabled, &j.TimeoutSec, &j.LastRunAt, &j.LastStatus, &j.LastOutput,
		&j.CreatedAt, &j.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// CreateWebsiteCronJob adds a new scheduled task for a website.
func (s *Store) CreateWebsiteCronJob(job *WebsiteCronJob) error {
	if job.ID == "" {
		job.ID = "cron_" + id.New()
	}
	if job.CreatedAt == "" {
		job.CreatedAt = now()
	}
	if job.TimeoutSec <= 0 {
		job.TimeoutSec = 300
	}
	_, err := s.DB.Exec(
		`INSERT INTO website_cron_jobs (id, website_slug, name, schedule, command, enabled, timeout_sec,
		                                last_run_at, last_status, last_output, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.WebsiteSlug, job.Name, job.Schedule, job.Command, job.Enabled, job.TimeoutSec,
		job.LastRunAt, job.LastStatus, job.LastOutput, job.CreatedAt, job.UpdatedAt,
	)
	return err
}

// UpdateWebsiteCronJob updates a scheduled task.
func (s *Store) UpdateWebsiteCronJob(job *WebsiteCronJob) error {
	job.UpdatedAt = now()
	_, err := s.DB.Exec(
		`UPDATE website_cron_jobs
		 SET name = ?, schedule = ?, command = ?, enabled = ?, timeout_sec = ?, updated_at = ?
		 WHERE id = ? AND website_slug = ?`,
		job.Name, job.Schedule, job.Command, job.Enabled, job.TimeoutSec, job.UpdatedAt,
		job.ID, job.WebsiteSlug,
	)
	return err
}

// DeleteWebsiteCronJob removes a scheduled task.
func (s *Store) DeleteWebsiteCronJob(slug, id string) error {
	_, err := s.DB.Exec(`DELETE FROM website_cron_jobs WHERE id = ? AND website_slug = ?`, id, slug)
	return err
}

// RecordWebsiteCronRun updates the last execution status and output for a task.
func (s *Store) RecordWebsiteCronRun(id, status, output string) error {
	_, err := s.DB.Exec(
		`UPDATE website_cron_jobs SET last_run_at = ?, last_status = ?, last_output = ? WHERE id = ?`,
		now(), status, output, id,
	)
	return err
}

// --- User Git Providers ---

// ListUserGitProviders returns all git provider integrations for a user.
func (s *Store) ListUserGitProviders(userID string) ([]UserGitProvider, error) {
	rows, err := s.DB.Query(
		`SELECT id, user_id, provider, name, api_url, token_cipher, username, created_at, updated_at
		 FROM user_git_providers WHERE user_id = ? ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []UserGitProvider{}
	for rows.Next() {
		var p UserGitProvider
		if err := rows.Scan(&p.ID, &p.UserID, &p.Provider, &p.Name, &p.APIURL,
			&p.TokenCipher, &p.Username, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreateUserGitProvider records a new git provider credential.
func (s *Store) CreateUserGitProvider(p *UserGitProvider) error {
	if p.ID == "" {
		p.ID = "git_" + id.New()
	}
	if p.CreatedAt == "" {
		p.CreatedAt = now()
	}
	_, err := s.DB.Exec(
		`INSERT INTO user_git_providers (id, user_id, provider, name, api_url, token_cipher, username, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.UserID, p.Provider, p.Name, p.APIURL, p.TokenCipher, p.Username, p.CreatedAt, p.UpdatedAt,
	)
	return err
}

// DeleteUserGitProvider removes a git provider configuration.
func (s *Store) DeleteUserGitProvider(userID, id string) error {
	_, err := s.DB.Exec(`DELETE FROM user_git_providers WHERE id = ? AND user_id = ?`, id, userID)
	return err
}

// CountWebsites returns the number of website rows.
func (s *Store) CountWebsites() (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM websites`).Scan(&n)
	return n, err
}

// --- Audit ---

// Audit appends an entry to the audit log.
func (s *Store) Audit(userID, action, target, ip, detail string) error {
	_, err := s.DB.Exec(
		`INSERT INTO audit_log (ts, user_id, action, target, ip, detail) VALUES (?, ?, ?, ?, ?, ?)`,
		now(), userID, action, target, ip, detail,
	)
	return err
}

// AuditEntry is one line of the audit log, with the account that caused it.
type AuditEntry struct {
	ID       int64  `json:"id"`
	At       string `json:"at"`
	UserID   string `json:"userId,omitempty"`
	Username string `json:"username,omitempty"`
	Action   string `json:"action"`
	Target   string `json:"target,omitempty"`
	IP       string `json:"ip,omitempty"`
	Detail   string `json:"detail,omitempty"`
}

// ListAudit returns the newest audit entries, newest first. An empty userID
// means every account, which is only ever used for admins.
func (s *Store) ListAudit(userID string, limit int) ([]AuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := `SELECT a.id, a.ts, a.user_id, COALESCE(u.username, ''), a.action, a.target, a.ip, a.detail
	          FROM audit_log a LEFT JOIN users u ON u.id = a.user_id`
	args := []any{}
	if userID != "" {
		query += ` WHERE a.user_id = ?`
		args = append(args, userID)
	}
	query += ` ORDER BY a.id DESC LIMIT ?`
	args = append(args, limit)

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AuditEntry{}
	for rows.Next() {
		var entry AuditEntry
		if err := rows.Scan(&entry.ID, &entry.At, &entry.UserID, &entry.Username,
			&entry.Action, &entry.Target, &entry.IP, &entry.Detail); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

// RefusedLogins returns the panel's own refused logins newer than an audit id, oldest first. The
// caller remembers the last id it saw, so they are counted exactly once — the same idea as a log
// file's byte offset.
func (s *Store) RefusedLogins(afterID int64, limit int) ([]AuditEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.DB.Query(`
SELECT id, ts, user_id, action, target, ip, detail FROM audit_log
WHERE action = 'auth.login_refused' AND id > ? ORDER BY id ASC LIMIT ?`, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("store: read refused logins: %w", err)
	}
	defer rows.Close()
	out := []AuditEntry{}
	for rows.Next() {
		var entry AuditEntry
		if err := rows.Scan(&entry.ID, &entry.At, &entry.UserID, &entry.Action, &entry.Target, &entry.IP, &entry.Detail); err != nil {
			return nil, fmt.Errorf("store: scan refused login: %w", err)
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

// LatestRefusedLoginID is where a reader starts: everything at or before it is history, and replaying
// history would ban addresses that stopped long ago.
func (s *Store) LatestRefusedLoginID() (int64, error) {
	var id int64
	if err := s.DB.QueryRow(`SELECT COALESCE(MAX(id), 0) FROM audit_log`).Scan(&id); err != nil {
		return 0, fmt.Errorf("store: read audit high-water mark: %w", err)
	}
	return id, nil
}

// PanelSetting reads one panel-wide setting, empty when it has never been set.
func (s *Store) PanelSetting(key string) (string, error) {
	var value string
	err := s.DB.QueryRow(`SELECT value FROM panel_settings WHERE key = ?`, key).Scan(&value)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("store: read panel setting %q: %w", key, err)
	}
	return value, nil
}

// SavePanelSetting writes one panel-wide setting. An empty value clears it, which is how a setting is
// removed rather than left saying something stale.
func (s *Store) SavePanelSetting(key, value string) error {
	if value == "" {
		if _, err := s.DB.Exec(`DELETE FROM panel_settings WHERE key = ?`, key); err != nil {
			return fmt.Errorf("store: clear panel setting %q: %w", key, err)
		}
		return nil
	}
	_, err := s.DB.Exec(`
INSERT INTO panel_settings (key, value, updated_at) VALUES (?, ?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, value, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("store: save panel setting %q: %w", key, err)
	}
	return nil
}

// OvercommitSettingKey names the panel setting that records which resources the operator
// has chosen to share rather than reserve ("cpu,ram,disk"; any subset, empty for none).
// It lives here so the API and the deployer read the same key.
const OvercommitSettingKey = "overcommit_resources"

// Sharing reads the panel's overcommit policy. An unset value is the zero value — every
// resource reserved — which is the historic behaviour, so a failure to read can never
// loosen a guard by accident.
func (s *Store) Sharing() (resources.Sharing, error) {
	raw, err := s.PanelSetting(OvercommitSettingKey)
	if err != nil {
		return resources.Sharing{}, err
	}
	return resources.ParseSharing(raw), nil
}

// trustedAddressesKey holds the addresses the lockout must never ban. It exists because the operator
// administers the panel from somewhere, and a host-wide ban that includes that somewhere takes away
// the way back in: measured, an operator's own address was banned by their own brute-force test and
// with it went SSH.
const trustedAddressesKey = "trusted_addresses"

// TrustedAddresses lists them, comma separated in one setting.
func (s *Store) TrustedAddresses() ([]string, error) {
	raw, err := s.PanelSetting(trustedAddressesKey)
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, entry := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
		if entry = strings.TrimSpace(entry); entry != "" {
			out = append(out, entry)
		}
	}
	return out, nil
}

// AddTrustedAddress adds one, if it is not already there.
func (s *Store) AddTrustedAddress(address string) error {
	address = strings.TrimSpace(address)
	if address == "" {
		return nil
	}
	current, err := s.TrustedAddresses()
	if err != nil {
		return err
	}
	for _, entry := range current {
		if entry == address {
			return nil
		}
	}
	return s.SavePanelSetting(trustedAddressesKey, strings.Join(append(current, address), ","))
}

// SetTrustedAddresses replaces the list, which is how the screen edits it.
func (s *Store) SetTrustedAddresses(addresses []string) error {
	clean := []string{}
	for _, entry := range addresses {
		if entry = strings.TrimSpace(entry); entry != "" {
			clean = append(clean, entry)
		}
	}
	return s.SavePanelSetting(trustedAddressesKey, strings.Join(clean, ","))
}

// --- Website Domains ---

func scanDomain(row interface{ Scan(...any) error }) (*WebsiteDomain, error) {
	var d WebsiteDomain
	var isPrimary, sslEnabled, forceHTTPS, hstsEnabled, autoRenew int
	err := row.Scan(
		&d.ID, &d.WebsiteSlug, &d.Domain, &isPrimary, &sslEnabled,
		&d.SSLProvider, &d.SSLStatus, &d.SSLCertPath, &d.SSLKeyPath,
		&d.SSLIssuer, &d.SSLExpiresAt, &forceHTTPS, &hstsEnabled, &autoRenew,
		&d.CreatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	d.IsPrimary = isPrimary == 1
	d.SSLEnabled = sslEnabled == 1
	d.ForceHTTPS = forceHTTPS == 1
	d.HSTSEnabled = hstsEnabled == 1
	d.AutoRenew = autoRenew == 1
	return &d, nil
}

// CreateDomain inserts a new domain alias for a website.
func (s *Store) CreateDomain(websiteSlug, domain string, isPrimary bool) (*WebsiteDomain, error) {
	d := &WebsiteDomain{
		ID:          id.New(),
		WebsiteSlug: websiteSlug,
		Domain:      strings.ToLower(strings.TrimSpace(domain)),
		IsPrimary:   isPrimary,
		SSLEnabled:  true,
		SSLProvider: "self-signed",
		SSLStatus:   "active",
		ForceHTTPS:  true,
		HSTSEnabled: false,
		AutoRenew:   true,
		CreatedAt:   now(),
	}
	isPrimInt := 0
	if isPrimary {
		isPrimInt = 1
	}
	_, err := s.DB.Exec(
		`INSERT INTO website_domains (id, website_slug, domain, is_primary, ssl_enabled, ssl_provider,
		                              ssl_status, ssl_cert_path, ssl_key_path, ssl_issuer, ssl_expires_at,
		                              force_https, hsts_enabled, auto_renew, created_at)
		 VALUES (?, ?, ?, ?, 1, 'self-signed', 'active', '', '', '', '', 1, 0, 1, ?)`,
		d.ID, d.WebsiteSlug, d.Domain, isPrimInt, d.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return d, nil
}

// GetDomain looks up a domain row by its ID.
func (s *Store) GetDomain(domainID string) (*WebsiteDomain, error) {
	return scanDomain(s.DB.QueryRow(
		`SELECT id, website_slug, domain, is_primary, ssl_enabled, ssl_provider, ssl_status,
		        ssl_cert_path, ssl_key_path, ssl_issuer, ssl_expires_at, force_https, hsts_enabled,
		        auto_renew, created_at
		 FROM website_domains WHERE id = ?`, domainID))
}

// GetDomainByName looks up a domain row by its domain name.
func (s *Store) GetDomainByName(domain string) (*WebsiteDomain, error) {
	return scanDomain(s.DB.QueryRow(
		`SELECT id, website_slug, domain, is_primary, ssl_enabled, ssl_provider, ssl_status,
		        ssl_cert_path, ssl_key_path, ssl_issuer, ssl_expires_at, force_https, hsts_enabled,
		        auto_renew, created_at
		 FROM website_domains WHERE domain = ?`, strings.ToLower(strings.TrimSpace(domain))))
}

// ListDomains returns all domains, optionally filtered by tenant.
func (s *Store) ListDomains(tenantUser string) ([]*WebsiteDomain, error) {
	var rows *sql.Rows
	var err error
	if tenantUser != "" {
		rows, err = s.DB.Query(
			`SELECT d.id, d.website_slug, d.domain, d.is_primary, d.ssl_enabled, d.ssl_provider, d.ssl_status,
			        d.ssl_cert_path, d.ssl_key_path, d.ssl_issuer, d.ssl_expires_at, d.force_https, d.hsts_enabled,
			        d.auto_renew, d.created_at
			 FROM website_domains d
			 JOIN websites w ON d.website_slug = w.slug
			 WHERE w.tenant_user = ?
			 ORDER BY d.is_primary DESC, d.domain ASC`, tenantUser)
	} else {
		rows, err = s.DB.Query(
			`SELECT d.id, d.website_slug, d.domain, d.is_primary, d.ssl_enabled, d.ssl_provider, d.ssl_status,
			        d.ssl_cert_path, d.ssl_key_path, d.ssl_issuer, d.ssl_expires_at, d.force_https, d.hsts_enabled,
			        d.auto_renew, d.created_at
			 FROM website_domains d
			 JOIN websites w ON d.website_slug = w.slug
			 ORDER BY d.is_primary DESC, d.domain ASC`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*WebsiteDomain{}
	for rows.Next() {
		d, err := scanDomain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListDomainsForSite returns all domains mapped to a specific website slug.
func (s *Store) ListDomainsForSite(slug string) ([]*WebsiteDomain, error) {
	rows, err := s.DB.Query(
		`SELECT id, website_slug, domain, is_primary, ssl_enabled, ssl_provider, ssl_status,
		        ssl_cert_path, ssl_key_path, ssl_issuer, ssl_expires_at, force_https, hsts_enabled,
		        auto_renew, created_at
		 FROM website_domains WHERE website_slug = ?
		 ORDER BY is_primary DESC, domain ASC`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []*WebsiteDomain{}
	for rows.Next() {
		d, err := scanDomain(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// UpdateDomainSSL updates SSL configuration, paths, and status for a domain.
func (s *Store) UpdateDomainSSL(id, provider, status, certPath, keyPath, issuer, expiresAt string, forceHTTPS, hsts, autoRenew bool) error {
	forceInt := 0
	if forceHTTPS {
		forceInt = 1
	}
	hstsInt := 0
	if hsts {
		hstsInt = 1
	}
	autoInt := 0
	if autoRenew {
		autoInt = 1
	}
	sslEnabledInt := 0
	if status == "active" || status == "valid" {
		sslEnabledInt = 1
	}
	res, err := s.DB.Exec(
		`UPDATE website_domains
		 SET ssl_enabled = ?, ssl_provider = ?, ssl_status = ?, ssl_cert_path = ?, ssl_key_path = ?,
		     ssl_issuer = ?, ssl_expires_at = ?, force_https = ?, hsts_enabled = ?, auto_renew = ?
		 WHERE id = ?`,
		sslEnabledInt, provider, status, certPath, keyPath, issuer, expiresAt, forceInt, hstsInt, autoInt, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateDomainToggles updates force_https, hsts_enabled, and auto_renew flags.
func (s *Store) UpdateDomainToggles(id string, forceHTTPS, hsts, autoRenew bool) error {
	forceInt := 0
	if forceHTTPS {
		forceInt = 1
	}
	hstsInt := 0
	if hsts {
		hstsInt = 1
	}
	autoInt := 0
	if autoRenew {
		autoInt = 1
	}
	res, err := s.DB.Exec(
		`UPDATE website_domains
		 SET force_https = ?, hsts_enabled = ?, auto_renew = ?
		 WHERE id = ?`,
		forceInt, hstsInt, autoInt, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteDomain deletes an alias domain row.
func (s *Store) DeleteDomain(domainID string) error {
	res, err := s.DB.Exec(`DELETE FROM website_domains WHERE id = ?`, domainID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateWebsiteDomain updates the primary domain of a website and syncs the primary row in website_domains.
func (s *Store) UpdateWebsiteDomain(slug, newDomain string) error {
	slug = strings.TrimSpace(slug)
	newDomain = strings.ToLower(strings.TrimSpace(newDomain))
	if slug == "" || newDomain == "" {
		return errors.New("slug and newDomain cannot be empty")
	}

	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE websites SET domain = ? WHERE slug = ?`, newDomain, slug); err != nil {
		return err
	}

	if _, err := tx.Exec(`UPDATE website_domains SET domain = ?, ssl_status = 'pending' WHERE website_slug = ? AND is_primary = 1`, newDomain, slug); err != nil {
		return err
	}

	return tx.Commit()
}

// UpdateDomainName updates the domain name string of a domain record.
func (s *Store) UpdateDomainName(domainID, newDomain string) error {
	domainID = strings.TrimSpace(domainID)
	newDomain = strings.ToLower(strings.TrimSpace(newDomain))
	if domainID == "" || newDomain == "" {
		return errors.New("domainID and newDomain cannot be empty")
	}
	_, err := s.DB.Exec(`UPDATE website_domains SET domain = ?, ssl_status = 'pending' WHERE id = ?`, newDomain, domainID)
	return err
}
