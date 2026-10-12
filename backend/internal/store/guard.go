package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// GuardSettings are the numbers the brute-force lockout decides with. They are kept in the
// panel's own database rather than in a second configuration language read by another
// daemon, so an operator changes them in the panel they already use.
type GuardSettings struct {
	Enabled   bool
	MaxRetry  int
	FindTime  time.Duration
	BanTime   time.Duration
	UpdatedAt string
}

// DefaultGuardSettings is what an unconfigured panel uses: five refused logins inside ten
// minutes keep an address out for an hour.
func DefaultGuardSettings() GuardSettings {
	return GuardSettings{Enabled: true, MaxRetry: 5, FindTime: 10 * time.Minute, BanTime: time.Hour}
}

// GuardBan is one address the panel keeps out of the engines, with the moment it may come
// back. It is the store's own shape so that this package needs no knowledge of how the
// decision was reached.
type GuardBan struct {
	IP        string    `json:"ip"`
	Engine    string    `json:"engine,omitempty"`
	User      string    `json:"user,omitempty"`
	Reason    string    `json:"reason,omitempty"`
	Hits      int       `json:"hits"`
	BannedBy  string    `json:"bannedBy,omitempty"`
	BannedAt  time.Time `json:"bannedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// GuardSettings reads the lockout's numbers, answering the defaults when nothing has been
// configured yet — so a fresh panel is protected without anyone having to visit a screen.
func (s *Store) GuardSettings() (GuardSettings, error) {
	out := DefaultGuardSettings()
	var enabled int
	var maxRetry int
	var findTime, banTime, updatedAt string
	err := s.DB.QueryRow(
		`SELECT enabled, max_retry, find_time, ban_time, updated_at FROM guard_settings WHERE id = 1`,
	).Scan(&enabled, &maxRetry, &findTime, &banTime, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, fmt.Errorf("store: read guard settings: %w", err)
	}
	out.Enabled = enabled != 0
	if maxRetry > 0 {
		out.MaxRetry = maxRetry
	}
	if parsed, err := time.ParseDuration(findTime); err == nil && parsed > 0 {
		out.FindTime = parsed
	}
	if parsed, err := time.ParseDuration(banTime); err == nil && parsed > 0 {
		out.BanTime = parsed
	}
	out.UpdatedAt = updatedAt
	return out, nil
}

// SaveGuardSettings writes the lockout's numbers, ready to be used on the next sweep.
func (s *Store) SaveGuardSettings(in GuardSettings) error {
	enabled := 0
	if in.Enabled {
		enabled = 1
	}
	_, err := s.DB.Exec(`
INSERT INTO guard_settings (id, enabled, max_retry, find_time, ban_time, updated_at)
VALUES (1, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  enabled = excluded.enabled,
  max_retry = excluded.max_retry,
  find_time = excluded.find_time,
  ban_time = excluded.ban_time,
  updated_at = excluded.updated_at`,
		enabled, in.MaxRetry, in.FindTime.String(), in.BanTime.String(),
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("store: save guard settings: %w", err)
	}
	return nil
}

// GuardBans lists every address the panel currently keeps out, newest first.
func (s *Store) GuardBans() ([]GuardBan, error) {
	rows, err := s.DB.Query(`
SELECT ip, engine, user_name, reason, hits, banned_at, expires_at
FROM guard_bans ORDER BY banned_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("store: list guard bans: %w", err)
	}
	defer rows.Close()
	out := []GuardBan{}
	for rows.Next() {
		var entry GuardBan
		var bannedAt, expiresAt string
		if err := rows.Scan(&entry.IP, &entry.Engine, &entry.User, &entry.Reason, &entry.Hits, &bannedAt, &expiresAt); err != nil {
			return nil, fmt.Errorf("store: scan guard ban: %w", err)
		}
		entry.BannedAt, _ = time.Parse(time.RFC3339, bannedAt)
		entry.ExpiresAt, _ = time.Parse(time.RFC3339, expiresAt)
		out = append(out, entry)
	}
	return out, rows.Err()
}

// SaveGuardBan records a ban (or refreshes an existing one) so that it survives a restart
// of the panel.
func (s *Store) SaveGuardBan(ban GuardBan) error {
	_, err := s.DB.Exec(`
INSERT INTO guard_bans (ip, engine, user_name, reason, hits, banned_at, expires_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(ip) DO UPDATE SET
  engine = excluded.engine,
  user_name = excluded.user_name,
  reason = excluded.reason,
  hits = excluded.hits,
  banned_at = excluded.banned_at,
  expires_at = excluded.expires_at`,
		ban.IP, ban.Engine, ban.User, ban.Reason, ban.Hits,
		ban.BannedAt.UTC().Format(time.RFC3339), ban.ExpiresAt.UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("store: save guard ban: %w", err)
	}
	return nil
}

// DropGuardBan releases one address.
func (s *Store) DropGuardBan(ip string) error {
	if _, err := s.DB.Exec(`DELETE FROM guard_bans WHERE ip = ?`, ip); err != nil {
		return fmt.Errorf("store: drop guard ban: %w", err)
	}
	return nil
}

// DropExpiredGuardBans releases every ban whose time is up, and answers how many went.
func (s *Store) DropExpiredGuardBans(now time.Time) (int64, error) {
	res, err := s.DB.Exec(`DELETE FROM guard_bans WHERE expires_at <= ?`, now.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("store: drop expired guard bans: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return affected, nil
}
