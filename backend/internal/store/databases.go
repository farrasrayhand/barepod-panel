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
	// DetachedAt is set when the record's website was deleted but the database was kept:
	// the file moves into the tenant's home and the record outlives the site, so the panel
	// can list it as its own thing rather than as a nameless leftover.
	DetachedAt string `json:"detachedAt,omitempty"`
	// Exposure is "" or "private" for a database only the panel and the host may reach, and
	// "public" once an operator has opened its port to the outside. ExposureNote carries what
	// the panel actually did — or could not do — about it, so the screen never claims a port
	// is open when the engine still refuses to listen on one.
	Exposure     string `json:"exposure,omitempty"`
	ExposureNote string `json:"exposureNote,omitempty"`
	ExposedAt    string `json:"exposedAt,omitempty"`
	CreatedAt    string `json:"createdAt"`
	FileBased    bool   `json:"fileBased"`
	// Detected marks a file the panel found inside a website: the application made
	// it, so the panel reports and browses it but never deletes it.
	Detected bool `json:"detected,omitempty"`
	// UnusedByApp marks a detected file the application is not connected to: Laravel's
	// starter database/database.sqlite on a site whose .env names another engine. The
	// screen hides these by default, but they are *reported* rather than dropped so the
	// list is never silently missing something.
	UnusedByApp bool `json:"unusedByApp,omitempty"`
	// Unreferenced marks a *ledger* row that the owning site's .env does not name: a
	// database left behind by an earlier deploy. The screen shows it with a badge rather
	// than hiding it, because a managed row must stay visible and manageable.
	Unreferenced bool `json:"unreferenced,omitempty"`
	// SizeBytes is measured when it can be (a file-based database is one stat
	// call); it stays 0 rather than carrying an invented number.
	SizeBytes int64 `json:"sizeBytes,omitempty"`
	// PasswordCipher is the encrypted credential. It never leaves the daemon: the
	// API only ever exposes it through a reveal that re-authenticates first.
	PasswordCipher string `json:"-"`
}

// Exposure values for a database's port. A database is private unless an operator has opened
// it, and the panel is the thing that opens it, so the decision is recorded rather than
// inferred from whatever the firewall happens to say.
const (
	ExposurePrivate = "private"
	ExposurePublic  = "public"
)

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
		                        max_memory_mb, status, note, deleted_at, exposure, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		db.ID, db.Kind, db.WebsiteSlug, db.TenantUser, db.Engine, db.Version, db.Alias, db.Name,
		db.User, db.PasswordCipher, db.Host, db.Port, db.FilePath, db.MaxConns,
		db.MaxMemoryMB, db.Status, db.Note, db.DeletedAt, db.Exposure, db.CreatedAt,
	)
	return err
}

const databaseColumns = `id, kind, website_slug, tenant_user, engine, version, alias, db_name,
	db_user, password_cipher, host, port, file_path, max_connections, max_memory_mb,
	status, note, deleted_at, detached_at, exposure, exposure_note, exposed_at, created_at`

func scanDatabase(row interface{ Scan(...any) error }) (*Database, error) {
	var db Database
	err := row.Scan(&db.ID, &db.Kind, &db.WebsiteSlug, &db.TenantUser, &db.Engine, &db.Version,
		&db.Alias, &db.Name, &db.User, &db.PasswordCipher, &db.Host, &db.Port, &db.FilePath,
		&db.MaxConns, &db.MaxMemoryMB, &db.Status, &db.Note, &db.DeletedAt, &db.DetachedAt,
		&db.Exposure, &db.ExposureNote, &db.ExposedAt, &db.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	db.FileBased = db.FilePath != ""
	return &db, nil
}

// SetDatabaseExposure records what an operator decided about a database's port, and what the
// panel managed to do about it. It is deliberately one call: the decision and its outcome are
// never stored apart, so a record cannot claim to be public while nothing was opened.
func (s *Store) SetDatabaseExposure(databaseID, exposure, note string) error {
	exposedAt := ""
	if exposure == ExposurePublic {
		exposedAt = now()
	}
	if _, err := s.DB.Exec(
		`UPDATE databases SET exposure = ?, exposure_note = ?, exposed_at = ? WHERE id = ?`,
		exposure, note, exposedAt, databaseID,
	); err != nil {
		return err
	}
	return nil
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

// SetDatabaseUser names the engine account a record was created without, so a record
// that predates the panel naming accounts can still be finished.
func (s *Store) SetDatabaseUser(databaseID, user string) error {
	// The column is `db_user`: writing to `user` is a SQL error, which is how this
	// returned 500 the first time it ran instead of naming the account.
	_, err := s.DB.Exec(`UPDATE databases SET db_user = ? WHERE id = ?`, user, databaseID)
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

// DatabasesForWebsite lists the live records a website owns: deleting a website has to
// know about them, because a SQLite file lives inside the site directory that goes away.
func (s *Store) DatabasesForWebsite(slug string) ([]Database, error) {
	rows, err := s.DB.Query(
		`SELECT `+databaseColumns+` FROM databases WHERE website_slug = ? AND deleted_at = '' ORDER BY alias ASC`, slug)
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

// SetDatabaseWebsite detaches a record from a website (an empty slug) or attaches it to
// one. Detaching is what "keep the databases" means when their website is deleted.
func (s *Store) SetDatabaseWebsite(databaseID, slug string) error {
	// Belonging to a website again clears the detached mark: it is no longer a leftover.
	_, err := s.DB.Exec(
		`UPDATE databases SET website_slug = ?, detached_at = CASE WHEN ? = '' THEN detached_at ELSE '' END WHERE id = ?`,
		slug, slug, databaseID)
	return err
}

// MarkDatabaseDetached records that a database outlived its website.
func (s *Store) MarkDatabaseDetached(databaseID string) error {
	_, err := s.DB.Exec(`UPDATE databases SET detached_at = ? WHERE id = ?`, now(), databaseID)
	return err
}

// CountDatabasesByTenant counts the live records an account owns — both families,
// because a package's database allowance is one number. Binned records are not counted:
// they are not in use, and a restore is checked against the allowance again.
func (s *Store) CountDatabasesByTenant(tenant string) (int, error) {
	var n int
	err := s.DB.QueryRow(
		`SELECT COUNT(*) FROM databases WHERE tenant_user = ? AND deleted_at = ''`, tenant,
	).Scan(&n)
	return n, err
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
