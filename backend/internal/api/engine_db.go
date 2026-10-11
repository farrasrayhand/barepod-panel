package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// engineDB opens a connection to a daemon engine **as the database's own user** —
// the account the panel created and scoped, never an administrator.
//
// Pure-Go drivers (pgx, go-sql-driver, the SQLite driver we already link) mean the
// host needs no psql/mysql client, there is no text output to parse back, and a
// value comes out as the type it is instead of something to un-quote by hand.
func (s *Server) engineDB(record *store.Database) (*sql.DB, error) {
	password, err := secrets.Decrypt(s.key, record.PasswordCipher)
	if err != nil {
		return nil, errors.New("the credential could not be decrypted")
	}
	host := record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := record.Port
	if port == 0 {
		port = defaultEnginePort(record.Engine)
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

func defaultEnginePort(engine string) int {
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

// engineTables lists the tables of a daemon engine.
func (s *Server) engineTables(ctx context.Context, record *store.Database) ([]string, error) {
	db, err := s.engineDB(record)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()

	var query string
	switch record.Engine {
	case "postgresql":
		query = `SELECT table_name FROM information_schema.tables
		         WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type = 'BASE TABLE'
		         ORDER BY table_name`
	case "mysql", "mariadb":
		query = `SELECT table_name FROM information_schema.tables
		         WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
		         ORDER BY table_name`
	default:
		return nil, fmt.Errorf("listing tables is not wired for %q yet", record.Engine)
	}

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tables := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// engineQuery runs one statement through the driver and returns the same grid the
// SQLite path returns, so the UI draws one thing.
func (s *Server) engineQuery(ctx context.Context, record *store.Database, statement string) (*queryResult, error) {
	db, err := s.engineDB(record)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()

	upper := strings.ToUpper(strings.TrimSpace(statement))
	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "WITH") || strings.HasPrefix(upper, "SHOW") ||
		strings.HasPrefix(upper, "EXPLAIN") || strings.HasPrefix(upper, "VALUES") {
		rows, err := db.QueryContext(ctx, statement)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		columns, err := rows.Columns()
		if err != nil {
			return nil, err
		}
		result := &queryResult{Columns: columns, Rows: [][]string{}, StatementKind: "select"}
		for rows.Next() {
			if len(result.Rows) >= maxQueryRows {
				result.Truncated = true
				break
			}
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if err := rows.Scan(pointers...); err != nil {
				return nil, err
			}
			row := make([]string, len(columns))
			for i, value := range values {
				row[i] = renderValue(value)
			}
			result.Rows = append(result.Rows, row)
		}
		return result, rows.Err()
	}

	outcome, err := db.ExecContext(ctx, statement)
	if err != nil {
		return nil, err
	}
	affected, _ := outcome.RowsAffected()
	return &queryResult{Columns: []string{}, Rows: [][]string{}, RowsAffected: affected, StatementKind: "exec"}, nil
}
