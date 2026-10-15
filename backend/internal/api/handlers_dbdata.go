package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/redis/go-redis/v9"

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

		// The daemon reaches the engine with a driver of its own: no client binary
		// has to exist on the host, and there is no port of its own either.
		tables, err := s.engineTables(r.Context(), record)
		if err != nil {
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"engine": record.Engine, "tables": tables, "browser": "daemon-driver",
		})
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
			// The statement runs through a driver as this database's own user, so the
			// panel can do no more than that user could — and no client binary has to
			// exist on the host.
			if !s.host.Materialises() {
				writeError(w, http.StatusNotImplemented, "dry_run",
					"The daemon is in dry-run mode: statements are not run against a real server")
				return
			}
			result, err := s.engineQuery(r.Context(), record, statement)
			if err != nil {
				// The engine's own message, with any credential redacted in case a
				// driver ever echoes it back.
				message := strings.ReplaceAll(err.Error(), record.Name, record.Name)
				if password, derr := secrets.Decrypt(s.key, record.PasswordCipher); derr == nil {
					message = strings.ReplaceAll(message, password, "***")
				}
				writeError(w, http.StatusBadGateway, "service_error", message)
				return
			}
			_ = s.store.Audit(user.ID, "database.query", record.Name, clientIP(r),
				fmt.Sprintf("%s via driver, %d row(s)", record.Engine, len(result.Rows)))
			writeJSON(w, http.StatusOK, result)
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

// redisKeys lists a sample of the cache's own keys — read through the pure-Go
// client, so no redis-cli has to exist on the host and there is no text output to
// parse back.
func (s *Server) redisClient(record *store.Database) (*redis.Client, error) {
	password, err := secrets.Decrypt(s.key, record.PasswordCipher)
	if err != nil {
		return nil, errors.New("the credential could not be decrypted")
	}
	host, port, _, _, err := dbengine.ParseRedisURL(s.cfg.RedisURL)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(&redis.Options{
		Addr:     fmt.Sprintf("%s:%d", host, port),
		Username: record.User,
		Password: password,
	}), nil
}

// redisKeys lists the cache's own keys. The ACL user is scoped to its prefix, so
// this cannot see another cache even if the panel asked it to.
func (s *Server) redisKeys(ctx context.Context, record *store.Database) ([]string, int, error) {
	client, err := s.redisClient(record)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = client.Close() }()

	keys := []string{}
	var cursor uint64
	for {
		batch, next, err := client.Scan(ctx, cursor, "*", int64(maxQueryRows)).Result()
		if err != nil {
			return nil, 0, fmt.Errorf("the cache did not answer: %w", err)
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 || len(keys) >= maxQueryRows {
			break
		}
	}
	if len(keys) > maxQueryRows {
		keys = keys[:maxQueryRows]
	}
	size, err := client.DBSize(ctx).Result()
	if err != nil {
		size = int64(len(keys))
	}
	return keys, int(size), nil
}

// redisKey is one key's shape, which is what a cache browser needs to be useful.
type redisKey struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	TTL  int64  `json:"ttlSeconds"`
	Size int64  `json:"sizeBytes"`
	// Value is the rendered content for the readable types (string, list, set,
	// hash, zset); a huge value comes back truncated.
	Value     string `json:"value,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

// handleRedisKey inspects one key of a cache.
func (s *Server) handleRedisKey(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if record.Engine != "redis" {
			writeError(w, http.StatusConflict, "not_applicable", "Only a cache has keys")
			return
		}
		key := r.URL.Query().Get("key")
		if strings.TrimSpace(key) == "" {
			writeError(w, http.StatusBadRequest, "bad_request", "A key is required")
			return
		}

		client, err := s.redisClient(record)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		defer func() { _ = client.Close() }()

		ctx := r.Context()
		keyType, err := client.Type(ctx, key).Result()
		if err != nil {
			// A key outside this cache's prefix answers NOPERM, and that must look
			// exactly like a key that does not exist — the panel never confirms that
			// another cache's key is there. A real connection problem is different.
			message := err.Error()
			if strings.Contains(message, "NOPERM") || strings.Contains(message, "no permissions") {
				writeError(w, http.StatusNotFound, "not_found", "No such key in this cache")
				return
			}
			writeError(w, http.StatusBadGateway, "service_error", fmt.Sprintf("the cache did not answer: %v", err))
			return
		}
		if keyType == "none" {
			writeError(w, http.StatusNotFound, "not_found", "No such key in this cache")
			return
		}
		ttl, _ := client.TTL(ctx, key).Result()

		detail := redisKey{Key: key, Type: keyType, TTL: int64(ttl.Seconds())}
		detail.Value, detail.Truncated = s.renderRedisValue(ctx, client, key, keyType)

		_ = s.store.Audit(user.ID, "database.key_read", record.Name, clientIP(r), key)
		writeJSON(w, http.StatusOK, detail)
	}
}

// renderRedisValue prints a key's content, capped so a 100 MB list cannot be sent
// to a browser by accident.
func (s *Server) renderRedisValue(ctx context.Context, client *redis.Client, key, keyType string) (string, bool) {
	const capItems = 200
	truncated := false

	switch keyType {
	case "string":
		value, err := client.Get(ctx, key).Result()
		if err != nil {
			return "", false
		}
		if len(value) > 4000 {
			return value[:4000], true
		}
		return value, false
	case "list":
		values, err := client.LRange(ctx, key, 0, capItems-1).Result()
		if err != nil {
			return "", false
		}
		length, _ := client.LLen(ctx, key).Result()
		truncated = length > int64(len(values))
		return strings.Join(quoteAll(values), "\n"), truncated
	case "set":
		values, _, err := client.SScan(ctx, key, 0, "", capItems).Result()
		if err != nil {
			return "", false
		}
		cardinality, _ := client.SCard(ctx, key).Result()
		truncated = cardinality > int64(len(values))
		return strings.Join(quoteAll(values), "\n"), truncated
	case "zset":
		values, err := client.ZRangeWithScores(ctx, key, 0, capItems-1).Result()
		if err != nil {
			return "", false
		}
		cardinality, _ := client.ZCard(ctx, key).Result()
		truncated = cardinality > int64(len(values))
		lines := make([]string, 0, len(values))
		for _, item := range values {
			lines = append(lines, fmt.Sprintf("%v = %s", item.Score, item.Member))
		}
		return strings.Join(lines, "\n"), truncated
	case "hash":
		values, err := client.HGetAll(ctx, key).Result()
		if err != nil {
			return "", false
		}
		truncated = len(values) > capItems
		lines := make([]string, 0, len(values))
		names := make([]string, 0, len(values))
		for name := range values {
			names = append(names, name)
		}
		sort.Strings(names)
		for i, name := range names {
			if i >= capItems {
				break
			}
			lines = append(lines, name+" = "+values[name])
		}
		return strings.Join(lines, "\n"), truncated
	case "stream":
		return "(a stream: open it with a client for full detail)", false
	}
	return "", false
}

func quoteAll(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}
