package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
)

const groupColumns = `g.id, g.name, g.description, g.permissions, g.is_default, g.is_system, g.created_at,
	(SELECT COUNT(*) FROM users u WHERE u.group_name = g.name)`

func scanGroup(row *sql.Row) (*rbac.Group, error) {
	var (
		g           rbac.Group
		permissions string
		isDefault   bool
		isSystem    bool
	)
	err := row.Scan(&g.ID, &g.Name, &g.Description, &permissions, &isDefault, &isSystem, &g.CreatedAt, &g.Members)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	g.Permissions = decodePermissions(permissions)
	g.IsDefault = isDefault
	g.IsSystem = isSystem
	return &g, nil
}

func decodePermissions(raw string) rbac.Permissions {
	out := rbac.Permissions{}
	if raw == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return rbac.Permissions{}
	}
	return out.Normalised()
}

func encodePermissions(p rbac.Permissions) string {
	b, err := json.Marshal(p.Normalised())
	if err != nil {
		return "{}"
	}
	return string(b)
}

// EnsureDefaultGroups inserts the built-in permission groups if they are missing.
// It is idempotent and is the only data the panel ever creates by itself.
// It returns how many groups were inserted.
func (s *Store) EnsureDefaultGroups() (int, error) {
	inserted := 0
	for _, g := range rbac.DefaultGroups() {
		var exists int
		if err := s.DB.QueryRow(`SELECT COUNT(*) FROM groups WHERE name = ?`, g.Name).Scan(&exists); err != nil {
			return inserted, err
		}
		if exists > 0 {
			continue
		}
		_, err := s.DB.Exec(
			`INSERT INTO groups (id, name, permissions, description, is_default, is_system, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id.New(), g.Name, encodePermissions(g.Permissions), g.Description, g.IsDefault, g.IsSystem, now(),
		)
		if err != nil {
			return inserted, fmt.Errorf("store: insert group %q: %w", g.Name, err)
		}
		inserted++
	}
	return inserted, nil
}

// ListGroups returns every permission group with its member count.
func (s *Store) ListGroups() ([]rbac.Group, error) {
	rows, err := s.DB.Query(
		`SELECT ` + groupColumns + ` FROM groups g ORDER BY g.is_system DESC, g.name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []rbac.Group{}
	for rows.Next() {
		var (
			g           rbac.Group
			permissions string
			isDefault   bool
			isSystem    bool
		)
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &permissions, &isDefault, &isSystem, &g.CreatedAt, &g.Members); err != nil {
			return nil, err
		}
		g.Permissions = decodePermissions(permissions)
		g.IsDefault = isDefault
		g.IsSystem = isSystem
		out = append(out, g)
	}
	return out, rows.Err()
}

// GroupByName loads one group, or ErrNotFound.
func (s *Store) GroupByName(name string) (*rbac.Group, error) {
	return scanGroup(s.DB.QueryRow(
		`SELECT `+groupColumns+` FROM groups g WHERE g.name = ?`, name))
}
