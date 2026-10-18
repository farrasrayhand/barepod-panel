package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
)

const groupColumns = `g.id, g.name, g.description, g.permissions, g.is_default, g.is_system, g.created_at,
	g.cpu_quota_percent, g.cpu_weight, g.memory_mb, g.tasks_max, g.disk_quota_gb, g.inode_quota, g.max_sites, g.max_databases,
	(SELECT COUNT(*) FROM users u WHERE u.group_name = g.name)`

// groupScanner reads a group row into the model.
type groupScanner interface {
	Scan(dest ...any) error
}

func scanGroupRow(sc groupScanner) (*rbac.Group, error) {
	var (
		g           rbac.Group
		permissions string
		isDefault   bool
		isSystem    bool
	)
	err := sc.Scan(
		&g.ID, &g.Name, &g.Description, &permissions, &isDefault, &isSystem, &g.CreatedAt,
		&g.Limits.CPUQuotaPercent, &g.Limits.CPUWeight, &g.Limits.MemoryMB, &g.Limits.TasksMax, &g.Limits.DiskQuotaGB,
		&g.Limits.InodeQuota, &g.Limits.MaxSites, &g.Limits.MaxDatabases,
		&g.Members,
	)
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
			`INSERT INTO groups (id, name, permissions, description, is_default, is_system, created_at,
			                     cpu_quota_percent, cpu_weight, memory_mb, tasks_max, disk_quota_gb, inode_quota, max_sites, max_databases)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id.New(), g.Name, encodePermissions(g.Permissions), g.Description, g.IsDefault, g.IsSystem, now(),
			g.Limits.CPUQuotaPercent, g.Limits.CPUWeight, g.Limits.MemoryMB, g.Limits.TasksMax, g.Limits.DiskQuotaGB,
			g.Limits.InodeQuota, g.Limits.MaxSites, g.Limits.MaxDatabases,
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
		group, err := scanGroupRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *group)
	}
	return out, rows.Err()
}

// GroupByName loads one group, or ErrNotFound.
func (s *Store) GroupByName(name string) (*rbac.Group, error) {
	return scanGroupRow(s.DB.QueryRow(`SELECT `+groupColumns+` FROM groups g WHERE g.name = ?`, name))
}

// UpdateGroup replaces a group's description, capabilities and resource limits.
func (s *Store) UpdateGroup(name, description string, permissions rbac.Permissions, limits resources.Limits) error {
	res, err := s.DB.Exec(
		`UPDATE groups SET description = ?, permissions = ?, cpu_quota_percent = ?, cpu_weight = ?, memory_mb = ?, tasks_max = ?,
		                   disk_quota_gb = ?, inode_quota = ?, max_sites = ?, max_databases = ?
		 WHERE name = ?`,
		description, encodePermissions(permissions), limits.CPUQuotaPercent, limits.CPUWeight, limits.MemoryMB, limits.TasksMax,
		limits.DiskQuotaGB, limits.InodeQuota, limits.MaxSites, limits.MaxDatabases, name,
	)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateGroup inserts a new permission group (a tenant package). It is never a
// system group: those are the built-in three. The caller owns the uniqueness
// decision (an insert on a taken name fails on the UNIQUE constraint).
func (s *Store) CreateGroup(name, description string, permissions rbac.Permissions, limits resources.Limits) (*rbac.Group, error) {
	_, err := s.DB.Exec(
		`INSERT INTO groups (id, name, permissions, description, is_default, is_system, created_at,
		                     cpu_quota_percent, cpu_weight, memory_mb, tasks_max, disk_quota_gb, inode_quota, max_sites, max_databases)
		 VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id.New(), name, encodePermissions(permissions), description, now(),
		limits.CPUQuotaPercent, limits.CPUWeight, limits.MemoryMB, limits.TasksMax, limits.DiskQuotaGB,
		limits.InodeQuota, limits.MaxSites, limits.MaxDatabases,
	)
	if err != nil {
		return nil, fmt.Errorf("store: insert group %q: %w", name, err)
	}
	return s.GroupByName(name)
}

// DeleteGroup removes a permission group by name.
func (s *Store) DeleteGroup(name string) error {
	res, err := s.DB.Exec(`DELETE FROM groups WHERE name = ?`, name)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return ErrNotFound
	}
	return nil
}

// CountUsersByGroup counts the accounts that belong to a group.
func (s *Store) CountUsersByGroup(name string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM users WHERE group_name = ?`, name).Scan(&n)
	return n, err
}
