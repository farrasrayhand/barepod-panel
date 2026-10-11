package store

import (
	"database/sql"
	"errors"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// PutWebsiteSecret stores (or replaces) an encrypted secret for a website.
// The ciphertext is produced by internal/secrets — the store never sees plaintext
// after this call.
func (s *Store) PutWebsiteSecret(slug, name, ciphertext string) error {
	_, err := s.DB.Exec(
		`INSERT INTO website_secrets (id, website_slug, name, ciphertext, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (website_slug, name) DO UPDATE SET ciphertext = excluded.ciphertext, created_at = excluded.created_at`,
		id.New(), slug, name, ciphertext, now(),
	)
	return err
}

// WebsiteSecret returns the encrypted secret for a website, or ErrNotFound.
func (s *Store) WebsiteSecret(slug, name string) (string, error) {
	var ciphertext string
	err := s.DB.QueryRow(
		`SELECT ciphertext FROM website_secrets WHERE website_slug = ? AND name = ?`, slug, name,
	).Scan(&ciphertext)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return ciphertext, nil
}

// ListWebsiteSecrets returns the encrypted secrets of a website, by name.
func (s *Store) ListWebsiteSecrets(slug string) (map[string]string, error) {
	rows, err := s.DB.Query(`SELECT name, ciphertext FROM website_secrets WHERE website_slug = ?`, slug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]string{}
	for rows.Next() {
		var name, ciphertext string
		if err := rows.Scan(&name, &ciphertext); err != nil {
			return nil, err
		}
		out[name] = ciphertext
	}
	return out, rows.Err()
}

// DeleteWebsiteSecrets removes every secret of a website (used on teardown).
func (s *Store) DeleteWebsiteSecrets(slug string) error {
	_, err := s.DB.Exec(`DELETE FROM website_secrets WHERE website_slug = ?`, slug)
	return err
}

// DeleteWebsite removes a website row.
func (s *Store) DeleteWebsite(slug string) error {
	res, err := s.DB.Exec(`DELETE FROM websites WHERE slug = ?`, slug)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}
