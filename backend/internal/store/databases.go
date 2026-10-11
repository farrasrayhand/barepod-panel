package store

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

// Kind separates the two resource families that share one table: a database and
// a cache behave identically here (credentials, recycle bin), but they have their
// own endpoints and their own rules.
const (
	KindDatabase = "database"
	KindCache    = "cache"
)

// Database is one provisioned database or cache.
//
// SQLite and embedded engines leave Host/Port/User/Password empty and carry a
// FilePath instead: they are files inside the site, not daemons.
type Database struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	WebsiteSlug string `json:"websiteSlug,omitempty"`
	TenantUser  string `json:"tenantUser"`
	Engine      string `json:"engine"`
	Version     string `json:"version,omitempty"`
	Alias       string `json:"alias"`
	Name        string `json:"name"`
	User        string `json:"user,omitempty"`
	Host        string `json:"host,omitempty"`
	Port        int    `json:"port,omitempty"`
	FilePath    string `json:"path,omitempty"`
	MaxConns    int    `json:"maxConnections,omitempty"`
	MaxMemoryMB int    `json:"maxMemoryMb,omitempty"`
	Status      string `json:"status"`
	Note        string `json:"note,omitempty"`
	DeletedAt   string `json:"deletedAt,omitempty"`
	CreatedAt   string `json:"createdAt"`
	FileBased   bool   `json:"fileBased"`
	// Detected marks a file the panel found inside a website: the application made
	// it, so the panel reports and browses it but never deletes it.
	Detected bool `json:"detected,omitempty"`
	// SizeBytes is measured when it can be (a file-based database is one stat
	// call); it stays 0 rather than carrying an invented number.
	SizeBytes int64 `json:"sizeBytes,omitempty"`
	// PasswordCipher is the encrypted credential. It never leaves the daemon: the
	// API only ever exposes it through a reveal that re-authenticates first.
	PasswordCipher string `json:"-"`
}

// CreateDatabase inserts a database or cache row.
func (s *Store) CreateDatabase(db *Database) error {
	if db.ID == "" {
		db.ID = id.New()
	}
	if db.CreatedAt == "" {
		db.CreatedAt = now()
	}
	if db.Kind == "" {
		db.Kind = KindDatabase
	}
	_, err := s.DB.Exec(
		`INSERT INTO databases (id, kind, website_slug, tenant_user, engine, version, alias, db_name,
		                        db_user, password_cipher, host, port, file_path, max_connections,
		                        max_memory_mb, status, note, deleted_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		db.ID, db.Kind, db.WebsiteSlug, db.TenantUser, db.Engine, db.Version, db.Alias, db.Name,
		db.User, db.PasswordCipher, db.Host, db.Port, db.FilePath, db.MaxConns,
		db.MaxMemoryMB, db.Status, db.Note, db.DeletedAt, db.CreatedAt,
	)
	return err
}

const databaseColumns = `id, kind, website_slug, tenant_user, engine, version, alias, db_name,
	db_user, password_cipher, host, port, file_path, max_connections, max_memory_mb,
	status, note, deleted_at, created_at`

func scanDatabase(row interface{ Scan(...any) error }) (*Database, error) {
	var db Database
	err := row.Scan(&db.ID, &db.Kind, &db.WebsiteSlug, &db.TenantUser, &db.Engine, &db.Version,
		&db.Alias, &db.Name, &db.User, &db.PasswordCipher, &db.Host, &db.Port, &db.FilePath,
		&db.MaxConns, &db.MaxMemoryMB, &db.Status, &db.Note, &db.DeletedAt, &db.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	db.FileBased = db.FilePath != ""
	return &db, nil
}

// DatabaseByID loads one database or cache by its id.
func (s *Store) DatabaseByID(databaseID string) (*Database, error) {
	return scanDatabase(s.DB.QueryRow(`SELECT `+databaseColumns+` FROM databases WHERE id = ?`, databaseID))
}

// DatabasesForTenant lists the caller's records; an empty tenant means every
// account (admin), and binned items are only included when asked for.
//
// The kind argument separates /databases from /caches.
func (s *Store) DatabasesForTenant(kind, tenant string, binned bool) ([]Database, error) {
	query := `SELECT ` + databaseColumns + ` FROM databases WHERE kind = ?`
	args := []any{kind}
	if binned {
		query += ` AND deleted_at <> ''`
	} else {
		query += ` AND deleted_at = ''`
	}
	if tenant != "" {
		query += ` AND tenant_user = ?`
		args = append(args, tenant)
	}
	query += ` ORDER BY created_at DESC, alias ASC`

	rows, err := s.DB.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Database{}
	for rows.Next() {
		record, err := scanDatabase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *record)
	}
	return out, rows.Err()
}

// DatabaseByAlias finds a live record so a create can refuse a duplicate name.
func (s *Store) DatabaseByAlias(kind, tenant, alias string) (*Database, error) {
	row := s.DB.QueryRow(
		`SELECT `+databaseColumns+` FROM databases
		 WHERE kind = ? AND tenant_user = ? AND alias = ? AND deleted_at = ''`,
		kind, tenant, alias,
	)
	return scanDatabase(row)
}

// UpdateDatabasePassword stores a new encrypted credential.
func (s *Store) UpdateDatabasePassword(databaseID, ciphertext string) error {
	_, err := s.DB.Exec(`UPDATE databases SET password_cipher = ? WHERE id = ?`, ciphertext, databaseID)
	return err
}

// SetDatabaseStatus moves a record between ready/suspended (and friends).
func (s *Store) SetDatabaseStatus(databaseID, status, note string) error {
	_, err := s.DB.Exec(`UPDATE databases SET status = ?, note = ? WHERE id = ?`, status, note, databaseID)
	return err
}

// SetDatabaseAddress corrects where a record says its engine lives. It is used when
// the engine's mode changed under an older record (a host install that is now a
// container publishes on another port), so the port the panel hands out is the one
// something is really listening on.
func (s *Store) SetDatabaseAddress(databaseID, host string, port int) error {
	_, err := s.DB.Exec(`UPDATE databases SET host = ?, port = ? WHERE id = ?`, host, port, databaseID)
	return err
}

// AllDatabases lists every record whatever the kind or the account, which the
// daemon reads at start to repair an address that predates the engine's mode.
func (s *Store) AllDatabases() ([]Database, error) {
	rows, err := s.DB.Query(`SELECT ` + databaseColumns + ` FROM databases`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Database{}
	for rows.Next() {
		record, err := scanDatabase(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *record)
	}
	return out, rows.Err()
}

// RenameDatabaseFile records where a file-based database lives now, which is how
// a SQLite suspend/restore moves it into and out of the recycle bin.
func (s *Store) RenameDatabaseFile(databaseID, path string) error {
	_, err := s.DB.Exec(`UPDATE databases SET file_path = ? WHERE id = ?`, path, databaseID)
	return err
}

// SetDatabaseLimits updates the connection or memory ceiling.
func (s *Store) SetDatabaseLimits(databaseID, alias string, maxConnections, maxMemoryMB int) error {
	_, err := s.DB.Exec(
		`UPDATE databases SET alias = ?, max_connections = ?, max_memory_mb = ? WHERE id = ?`,
		alias, maxConnections, maxMemoryMB, databaseID,
	)
	return err
}

// BinDatabase is the soft delete: the record is kept, marked, and suspended.
func (s *Store) BinDatabase(databaseID string) error {
	_, err := s.DB.Exec(
		`UPDATE databases SET deleted_at = ?, status = 'suspended' WHERE id = ?`,
		now(), databaseID,
	)
	return err
}

// RestoreDatabase clears the bin marker.
func (s *Store) RestoreDatabase(databaseID string) error {
	_, err := s.DB.Exec(`UPDATE databases SET deleted_at = '', status = 'ready' WHERE id = ?`, databaseID)
	return err
}

// DeleteDatabase removes the record for good (purge).
func (s *Store) DeleteDatabase(databaseID string) error {
	_, err := s.DB.Exec(`DELETE FROM databases WHERE id = ?`, databaseID)
	return err
}

// DatabaseNameInUse reports whether an engine-side name is already taken by a
// live record, so shared engines never collide.
func (s *Store) DatabaseNameInUse(name string) (bool, error) {
	var count int
	err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM databases WHERE db_name = ? AND deleted_at = ''`, strings.TrimSpace(name),
	).Scan(&count)
	return count > 0, err
}

// EngineCredential is the administrator account of a containerised engine.
type EngineCredential struct {
	Engine     string `json:"engine"`
	AdminUser  string `json:"adminUser"`
	Ciphertext string `json:"-"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	CreatedAt  string `json:"createdAt"`
}

// PutEngineCredential stores (or replaces) one engine's administrator credential.
func (s *Store) PutEngineCredential(credential EngineCredential) error {
	if credential.CreatedAt == "" {
		credential.CreatedAt = now()
	}
	_, err := s.DB.Exec(
		`INSERT INTO engine_credentials (engine, admin_user, ciphertext, host, port, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(engine) DO UPDATE SET admin_user = excluded.admin_user,
		   ciphertext = excluded.ciphertext, host = excluded.host, port = excluded.port`,
		credential.Engine, credential.AdminUser, credential.Ciphertext,
		credential.Host, credential.Port, credential.CreatedAt,
	)
	return err
}

// EngineCredential loads one engine's administrator credential.
func (s *Store) EngineCredential(engine string) (*EngineCredential, error) {
	var credential EngineCredential
	err := s.DB.QueryRow(
		`SELECT engine, admin_user, ciphertext, host, port, created_at FROM engine_credentials WHERE engine = ?`,
		engine,
	).Scan(&credential.Engine, &credential.AdminUser, &credential.Ciphertext,
		&credential.Host, &credential.Port, &credential.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &credential, nil
}
