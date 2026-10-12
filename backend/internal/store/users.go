package store

// ListUsers returns every panel account, oldest first.
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.DB.Query(
		`SELECT id, username, email, password_hash, role, group_name, status, created_at
		 FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []User{}
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.PasswordHash, &u.Role, &u.GroupName, &u.Status, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetUserPassword replaces the password hash and returns the updated user.
func (s *Store) SetUserPassword(username, passwordHash string) (*User, error) {
	res, err := s.DB.Exec(`UPDATE users SET password_hash = ? WHERE username = ?`, passwordHash, username)
	if err != nil {
		return nil, err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return nil, ErrNotFound
	}
	// A password change invalidates every existing session for that account.
	if _, err := s.DB.Exec(
		`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)`, username,
	); err != nil {
		return nil, err
	}
	return s.UserByUsername(username)
}

// SetUserRole changes a user's role.
func (s *Store) SetUserRole(username, role, groupName string) error {
	_, err := s.DB.Exec(`UPDATE users SET role = ?, group_name = ? WHERE username = ?`, role, groupName, username)
	return err
}

// SetUserEmail changes a user's email address.
func (s *Store) SetUserEmail(username, email string) error {
	_, err := s.DB.Exec(`UPDATE users SET email = ? WHERE username = ?`, email, username)
	return err
}

// SetUserStatus activates or suspends an account.
func (s *Store) SetUserStatus(username, status string) error {
	_, err := s.DB.Exec(`UPDATE users SET status = ? WHERE username = ?`, status, username)
	if err != nil {
		return err
	}
	if status != "active" {
		_, err = s.DB.Exec(
			`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)`, username)
	}
	return err
}

// DeleteUser removes a panel account. Its sessions go with it (foreign key cascade).
func (s *Store) DeleteUser(username string) error {
	res, err := s.DB.Exec(`DELETE FROM users WHERE username = ?`, username)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}
