package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// ErrNotFound is returned when a row does not exist.
var ErrNotFound = errors.New("store: not found")

func now() string { return time.Now().UTC().Format(time.RFC3339) }

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

// CreateSession stores a new browser session and returns it.
func (s *Store) CreateSession(userID, userAgent, ip, csrf string) (*Session, error) {
	sess := &Session{
		ID:         id.Token(24),
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

// SessionByID loads a session by its opaque id.
func (s *Store) SessionByID(sessionID string) (*Session, error) {
	var sess Session
	var elevated sql.NullString
	err := s.DB.QueryRow(
		`SELECT id, user_id, csrf_token, user_agent, ip, elevated_until, created_at, last_seen_at
		 FROM sessions WHERE id = ?`, sessionID,
	).Scan(&sess.ID, &sess.UserID, &sess.CSRFToken, &sess.UserAgent, &sess.IP, &elevated, &sess.CreatedAt, &sess.LastSeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	sess.ElevatedUntil = elevated.String
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
		        status, deploy_status, ssl, tunnel_enabled, port, created_at,
		        source_kind, source_repo, source_branch
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
			&w.Port, &w.CreatedAt, &w.SourceKind, &w.SourceRepo, &w.SourceBranch); err != nil {
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
		        status, deploy_status, ssl, tunnel_enabled, port, created_at,
		        source_kind, source_repo, source_branch
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
			&w.Port, &w.CreatedAt, &w.SourceKind, &w.SourceRepo, &w.SourceBranch); err != nil {
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
		        status, deploy_status, ssl, tunnel_enabled, port, created_at,
		        source_kind, source_repo, source_branch
		 FROM websites WHERE slug = ?`, slug,
	).Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version, &w.Framework,
		&w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable, &w.Port, &w.CreatedAt,
		&w.SourceKind, &w.SourceRepo, &w.SourceBranch)
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
	_, err := s.DB.Exec(
		`INSERT INTO websites (id, slug, domain, tenant_user, runtime, version, framework,
		                       web_server, status, deploy_status, ssl, tunnel_enabled, port, created_at,
		                       source_kind, source_repo, source_branch)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.Slug, w.Domain, w.TenantUser, w.Runtime, w.Version, w.Framework,
		w.WebServer, w.Status, w.DeployStatus, w.SSL, w.TunnelEnable, w.Port, w.CreatedAt,
		w.SourceKind, w.SourceRepo, w.SourceBranch,
	)
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
