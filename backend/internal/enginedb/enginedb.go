// Package enginedb opens a connection to a daemon-managed database engine using the panel's own
// pure-Go drivers. The Data Browser and the maintenance jobs therefore reach an engine the same way,
// and neither needs a psql/mysql client on the host.
package enginedb

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// Open connects to a database **as the database's own user** — the account the panel created and
// scoped, never an administrator.
func Open(record *store.Database, key []byte) (*sql.DB, error) {
	password, err := secrets.Decrypt(key, record.PasswordCipher)
	if err != nil {
		return nil, errors.New("the credential could not be decrypted")
	}
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := record.Port
	if port == 0 {
		port = DefaultPort(record.Engine)
	}
	if record.User == "" || record.Name == "" {
		return nil, errors.New("this database has no user recorded yet")
	}

	switch record.Engine {
	case "postgresql":
		dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=disable&connect_timeout=5",
			url.QueryEscape(record.User), url.QueryEscape(password), host, port, url.PathEscape(record.Name))
		return sql.Open("pgx", dsn)
	case "mysql", "mariadb":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?timeout=5s&parseTime=false",
			record.User, password, host, port, record.Name)
		return sql.Open("mysql", dsn)
	case "sqlite":
		return nil, errors.New("SQLite is a file: the daemon reads it directly")
	}
	return nil, fmt.Errorf("no driver for %q yet", record.Engine)
}

// OpenServer connects to the engine without selecting a database.
//
// A name check needs this: the database a record names may not exist, and a DSN that selects it
// would fail before any query could explain why.
func OpenServer(record *store.Database, key []byte) (*sql.DB, error) {
	password, err := secrets.Decrypt(key, record.PasswordCipher)
	if err != nil {
		return nil, errors.New("the credential could not be decrypted")
	}
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := record.Port
	if port == 0 {
		port = DefaultPort(record.Engine)
	}
	if record.User == "" {
		return nil, errors.New("this database has no user recorded yet")
	}

	switch record.Engine {
	case "postgresql":
		// `postgres` always exists and is readable by a role with CONNECT; the recorded database
		// may be the very thing that is missing.
		dsn := fmt.Sprintf("postgres://%s:%s@%s:%d/postgres?sslmode=disable&connect_timeout=5",
			url.QueryEscape(record.User), url.QueryEscape(password), host, port)
		return sql.Open("pgx", dsn)
	case "mysql", "mariadb":
		dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/?timeout=5s&parseTime=false",
			record.User, password, host, port)
		return sql.Open("mysql", dsn)
	}
	return nil, fmt.Errorf("no driver for %q yet", record.Engine)
}

// DefaultPort is an engine's standard port, used when a record does not carry one.
func DefaultPort(engine string) int {
	switch engine {
	case "postgresql":
		return 5432
	case "mysql", "mariadb":
		return 3306
	case "mongodb":
		return 27017
	case "redis":
		return 6379
	}
	return 0
}
