package store

import "database/sql"

// SetUserTOTP records an account's encrypted TOTP secret and whether it has been confirmed. An empty
// secret clears both.
func (s *Store) SetUserTOTP(userID, cipher string, enabled bool) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	_, err := s.DB.Exec(
		`UPDATE users SET totp_secret_cipher = ?, totp_enabled = ? WHERE id = ?`,
		cipher, enabledInt, userID,
	)
	return err
}

// UserTOTP returns the encrypted secret and its confirmed state.
func (s *Store) UserTOTP(userID string) (cipher string, enabled bool, err error) {
	err = s.DB.QueryRow(
		`SELECT totp_secret_cipher, totp_enabled FROM users WHERE id = ?`, userID,
	).Scan(&cipher, &enabled)
	if err == sql.ErrNoRows {
		return "", false, ErrNotFound
	}
	return cipher, enabled, err
}
