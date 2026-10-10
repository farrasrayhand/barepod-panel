package store

import (
	"database/sql"
	"errors"
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
		        status, deploy_status, ssl, tunnel_enabled, port, created_at
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
			&w.Port, &w.CreatedAt); err != nil {
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
		        status, deploy_status, ssl, tunnel_enabled, port, created_at
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
			&w.Port, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// WebsiteBySlug looks a website up by its slug.
func (s *Store) WebsiteBySlug(slug string) (*Website, error) {
	var w Website
	err := s.DB.QueryRow(
		`SELECT id, slug, domain, tenant_user, runtime, version, framework, web_server,
		        status, deploy_status, ssl, tunnel_enabled, port, created_at
		 FROM websites WHERE slug = ?`, slug,
	).Scan(&w.ID, &w.Slug, &w.Domain, &w.TenantUser, &w.Runtime, &w.Version, &w.Framework,
		&w.WebServer, &w.Status, &w.DeployStatus, &w.SSL, &w.TunnelEnable, &w.Port, &w.CreatedAt)
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
		                       web_server, status, deploy_status, ssl, tunnel_enabled, port, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		w.ID, w.Slug, w.Domain, w.TenantUser, w.Runtime, w.Version, w.Framework,
		w.WebServer, w.Status, w.DeployStatus, w.SSL, w.TunnelEnable, w.Port, w.CreatedAt,
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
