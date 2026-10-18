package dbengine

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// AppDatabase is what a website's .env says its application connects to.
//
// The panel's ledger records what the *panel* created; the .env is what the
// application actually uses, and the two can drift — a hand-edited .env, a database
// made outside the panel, or a row deleted from the Recycle Bin while the database
// itself lives on. Reading the .env is how the Databases screen can tell a real
// database apart from a leftover.
type AppDatabase struct {
	Connection string
	Host       string
	Port       int
	Name       string
	User       string
}

// LaravelDatabaseFile is the file `composer create-project laravel/laravel` ships
// (empty). Laravel uses it only while DB_CONNECTION is sqlite.
const LaravelDatabaseFile = "database/database.sqlite"

// EnvDatabase reads a website's .env and returns its DB_* settings.
//
// ok is false when the file is missing or names no connection, so a caller never
// mistakes "this site has no .env" for "this site uses SQLite".
func EnvDatabase(envPath string) (AppDatabase, bool) {
	data, err := os.ReadFile(envPath)
	if err != nil {
		return AppDatabase{}, false
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		values[key] = strings.Trim(strings.TrimSpace(value), `"' `)
	}
	connection := strings.ToLower(strings.TrimSpace(values["DB_CONNECTION"]))
	if connection == "" {
		return AppDatabase{}, false
	}
	port, _ := strconv.Atoi(values["DB_PORT"])
	return AppDatabase{
		Connection: connection,
		Host:       values["DB_HOST"],
		Port:       port,
		Name:       values["DB_DATABASE"],
		User:       values["DB_USERNAME"],
	}, true
}

// IsUnusedLaravelPlaceholder reports a starter database file the application is not
// connected to.
//
// It answers one question only: is this the file Laravel ships, on a site whose .env
// names another engine? That is the phantom the Databases screen used to list beside
// the real database (a site on PostgreSQL showed a SQLite entry nothing used). A site
// whose DB_CONNECTION really is sqlite keeps it listed — it is the application's
// database then.
func IsUnusedLaravelPlaceholder(relative string, app AppDatabase, hasApp bool) bool {
	if !hasApp {
		return false
	}
	if filepath.ToSlash(strings.TrimPrefix(relative, "/")) != LaravelDatabaseFile {
		return false
	}
	return app.Connection != "sqlite"
}
