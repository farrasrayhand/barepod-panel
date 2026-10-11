package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"

	_ "modernc.org/sqlite"
)

// maxQueryRows caps what one query may return, so a careless SELECT cannot fill a
// browser tab or the daemon's memory.
const maxQueryRows = 500

type queryRequest struct {
	SQL string `json:"sql"`
}

// handleDatabaseTables lists the tables of one database.
//
// For SQLite the daemon reads the file itself (the driver is already linked in, so
// no client has to be installed), for Redis it lists the cache's keys, and for a
// daemon engine it answers honestly when the client is missing.
func (s *Server) handleListTables(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}

		if record.FileBased {
			tables, err := sqliteTables(r.Context(), record.FilePath)
			if err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"engine": record.Engine, "tables": tables, "browser": "daemon"})
			return
		}

		if record.Engine == "redis" {
			keys, total, err := s.redisKeys(r.Context(), record)
			if err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"engine": "redis", "keys": keys, "keyCount": total,
				"note": "A cache has no tables: this is a sample of its keys, scoped to the account's prefix.",
			})
			return
		}

		engine, _ := s.engineFor(r.Context(), record.Engine)
		if !engine.Available {
			writeError(w, http.StatusConflict, "not_available",
				fmt.Sprintf("%s is not installed on this host, so the panel cannot browse this database", engine.Client))
			return
		}
		writeError(w, http.StatusNotImplemented, "not_implemented",
			"Browsing a daemon engine is not wired yet: use the terminal or a client for now")
	}
}

// handleDatabaseQuery runs one statement and returns what it produced.
func (s *Server) handleDatabaseQuery(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		var req queryRequest
		if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.SQL) == "" {
			writeError(w, http.StatusBadRequest, "bad_request", "A statement is required")
			return
		}
		statement := strings.TrimSpace(req.SQL)

		if !record.FileBased {
			// A daemon engine: the statement runs through its own client, as this
			// database's user, with the password in the environment.
			if record.DeletedAt != "" {
				writeError(w, http.StatusConflict, "suspended",
					"This database is in the recycle bin: restore it before running anything against it")
				return
			}
			if record.Status != "ready" {
				// Not the same thing as suspended: this one was never created (the
				// client was missing when it was added, for instance).
				reason := record.Note
				if reason == "" {
					reason = "it was never created on this host"
				}
				writeError(w, http.StatusConflict, "not_ready", fmt.Sprintf(
					"There is nothing to query yet (%s): %s", record.Status, reason))
				return
			}
			engine, _ := s.engineFor(r.Context(), record.Engine)
			if !engine.Available {
				writeError(w, http.StatusConflict, "not_available", fmt.Sprintf(
					"%s is not installed on this host, so the panel cannot run statements here", engine.Client))
				return
			}
			if !s.host.Materialises() {
				writeError(w, http.StatusNotImplemented, "dry_run",
					"The daemon is in dry-run mode: statements are not run against a real server")
				return
			}
			password, err := secrets.Decrypt(s.key, record.PasswordCipher)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
				return
			}
			command, err := dbengine.QueryCommand(record.Engine, s.resourceFor(record, password), statement)
			if err != nil {
				writeError(w, http.StatusBadRequest, "validation_error", err.Error())
				return
			}
			out, runErr := s.host.Runner.RunEnv(r.Context(), "", command.Env, command.Argv[0], command.Argv[1:]...)
			grid, parseErr := dbengine.ParseQueryOutput(record.Engine, out)
			if runErr != nil && parseErr != nil {
				// The client said nothing usable: report its message, with the
				// credential redacted in case a driver ever echoes it back.
				message := strings.TrimSpace(out)
				if message == "" {
					message = runErr.Error()
				}
				message = strings.ReplaceAll(message, password, "***")
				writeError(w, http.StatusBadGateway, "service_error", message)
				return
			}
			kind := "exec"
			if len(grid.Columns) > 0 {
				kind = "select"
			}
			_ = s.store.Audit(user.ID, "database.query", record.Name, clientIP(r),
				fmt.Sprintf("%s via %s, %d row(s)", record.Engine, engine.Client, len(grid.Rows)))
			writeJSON(w, http.StatusOK, map[string]any{
				"columns": grid.Columns, "rows": grid.Rows,
				"truncated": grid.Truncated, "kind": kind,
			})
			return
		}

		result, err := sqliteQuery(r.Context(), record.FilePath, statement)
		if err != nil {
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		// The statement is the tenant's own data operation; it stays audited, but the
		// statement text itself is not stored (it can contain values).
		_ = s.store.Audit(user.ID, "database.query", record.Name, clientIP(r),
			fmt.Sprintf("%d row(s) affected/returned", len(result.Rows)))

		writeJSON(w, http.StatusOK, result)
	}
}

// sqliteTables reads the schema with the SQLite driver the daemon already links:
// no client, no port, no credential.
func sqliteTables(ctx context.Context, path string) ([]string, error) {
	db, err := openSQLiteReadOnly(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()

	rows, err := db.QueryContext(ctx,
		`SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
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

// queryResult is what the UI needs to draw a grid.
type queryResult struct {
	Columns       []string   `json:"columns"`
	Rows          [][]string `json:"rows"`
	Truncated     bool       `json:"truncated"`
	RowsAffected  int64      `json:"rowsAffected"`
	StatementKind string     `json:"kind"` // select | exec
}

// sqliteQuery runs one statement. A SELECT comes back as a grid; anything else
// reports how many rows it changed.
func sqliteQuery(ctx context.Context, path, statement string) (*queryResult, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = db.Close() }()

	upper := strings.ToUpper(statement)
	if strings.HasPrefix(upper, "SELECT") || strings.HasPrefix(upper, "PRAGMA") || strings.HasPrefix(upper, "WITH") {
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

// renderValue prints any column value as text, and says so when it is NULL.
func renderValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return "NULL"
	case []byte:
		return string(typed)
	case int64:
		return fmt.Sprint(typed)
	case float64:
		return fmt.Sprint(typed)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

// openSQLiteReadOnly opens a database file without creating it.
func openSQLiteReadOnly(path string) (*sql.DB, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("the database has no file")
	}
	return sql.Open("sqlite", "file:"+path+"?mode=ro")
}

// redisKeys lists a sample of the cache's own keys (its user is scoped to the
// prefix, so this cannot see another cache).
func (s *Server) redisKeys(ctx context.Context, record *store.Database) ([]string, int, error) {
	password, err := secrets.Decrypt(s.key, record.PasswordCipher)
	if err != nil {
		return nil, 0, errors.New("the credential could not be decrypted")
	}
	host, port, _, _ := dbengine.ParseRedisURL(s.cfg.RedisURL)
	base := []string{"redis-cli", "-h", host, "-p", fmt.Sprint(port), "--no-auth-warning",
		"--user", record.User, "--pass", password, "--raw"}

	countOut, err := s.host.Run(ctx, append(append([]string{}, base...), "DBSIZE"))
	if err != nil {
		return nil, 0, fmt.Errorf("the cache did not answer: %s", strings.TrimSpace(countOut))
	}

	keysOut, err := s.host.Run(ctx, append(append([]string{}, base...), "SCAN", "0", "COUNT", fmt.Sprint(maxQueryRows)))
	if err != nil {
		return nil, 0, fmt.Errorf("the cache did not answer: %s", strings.TrimSpace(keysOut))
	}

	keys := []string{}
	for _, line := range strings.Split(keysOut, "\n") {
		line = strings.TrimSpace(line)
		// The output is "<cursor>" then one key per line.
		if line == "" || line == "0" || strings.HasPrefix(strings.ToLower(line), record.User+":") == false {
			continue
		}
		keys = append(keys, line)
		if len(keys) >= maxQueryRows {
			break
		}
	}
	total := 0
	fmt.Sscanf(strings.TrimSpace(countOut), "%d", &total)
	return keys, total, nil
}
