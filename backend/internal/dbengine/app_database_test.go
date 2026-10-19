package dbengine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestEnvDatabaseReadsARealLaravelEnv is the shape that caused the phantom SQLite
// entry: a site whose .env points at PostgreSQL, with unrelated REDIS_* lines around it.
func TestEnvDatabaseReadsARealLaravelEnv(t *testing.T) {
	dir := t.TempDir()
	env := filepath.Join(dir, ".env")
	body := `APP_NAME=siaarta24
APP_ENV=production
APP_KEY=base64:X8n49f03jfa94klsm49v02kflasjfo32=
APP_DEBUG=false
APP_URL=https://siarta24.web.id

DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=app_siaarta24
DB_USERNAME=suprion7
DB_PASSWORD="s3cret"

REDIS_HOST=redis-siaarta24
REDIS_PORT=6379
`
	if err := os.WriteFile(env, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	app, ok := EnvDatabase(env)
	if !ok {
		t.Fatal("EnvDatabase found no connection in a .env that names one")
	}
	if app.Connection != "pgsql" || app.Port != 5432 || app.Name != "app_siaarta24" || app.User != "suprion7" {
		t.Fatalf("EnvDatabase = %+v, want pgsql/5432/app_siaarta24/suprion7", app)
	}
	if app.Host != "127.0.0.1" {
		t.Errorf("host = %q, want 127.0.0.1", app.Host)
	}
}

func TestEnvDatabaseWithoutAConnectionIsNotAMistake(t *testing.T) {
	dir := t.TempDir()
	if _, ok := EnvDatabase(filepath.Join(dir, ".env")); ok {
		t.Error("a missing .env must not be read as a connection")
	}
	cacheOnly := filepath.Join(dir, ".env")
	if err := os.WriteFile(cacheOnly, []byte("REDIS_HOST=redis-x\nCACHE_STORE=redis\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := EnvDatabase(cacheOnly); ok {
		t.Error("a .env with no DB_CONNECTION must not be read as a connection")
	}
}

func TestUnusedLaravelPlaceholder(t *testing.T) {
	postgres := AppDatabase{Connection: "pgsql"}
	sqlite := AppDatabase{Connection: "sqlite"}

	cases := []struct {
		name     string
		relative string
		app      AppDatabase
		hasApp   bool
		want     bool
	}{
		{"laravel file, app on postgres", "database/database.sqlite", postgres, true, true},
		{"laravel file, app on mysql", "database/database.sqlite", AppDatabase{Connection: "mysql"}, true, true},
		{"laravel file, app on sqlite", "database/database.sqlite", sqlite, true, false},
		{"some other sqlite file, app on postgres", "storage/metrics.sqlite", postgres, true, false},
		{"no .env at all", "database/database.sqlite", AppDatabase{}, false, false},
	}
	for _, tc := range cases {
		if got := IsUnusedLaravelPlaceholder(tc.relative, tc.app, tc.hasApp); got != tc.want {
			t.Errorf("%s: IsUnusedLaravelPlaceholder = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// TestPostgresRotateRepairsAMissingRole is the same defect on the other engine: ALTER ROLE
// on a role that no longer exists failed the whole rotate.
func TestPostgresRotateRepairsAMissingRole(t *testing.T) {
	plan, err := PlanFor(StepRotate, Resource{
		Engine: "postgresql", Name: "app_siaarta24", User: "suprion7", Secret: "a-long-enough-secret",
	})
	if err != nil {
		t.Fatalf("PlanFor: %v", err)
	}
	sql := ""
	for _, command := range plan.Commands {
		sql += strings.Join(command, " ") + "\n"
	}
	for _, want := range []string{"pg_catalog.pg_roles", "CREATE ROLE", "ALTER ROLE", "PASSWORD"} {
		if !strings.Contains(sql, want) {
			t.Errorf("postgres rotate is missing %q\n---\n%s", want, sql)
		}
	}
}

// TestMySQLRotateRepairsAMissingAccount is the 502 from the panel: a ledger row whose
// MySQL user no longer exists (or only exists for @localhost) made a plain ALTER fail.
func TestMySQLRotateRepairsAMissingAccount(t *testing.T) {
	plan, err := PlanFor(StepRotate, Resource{
		Engine: "mysql", Name: "siarta24", User: "siarta24", Secret: "a-long-enough-secret",
	})
	if err != nil {
		t.Fatalf("PlanFor: %v", err)
	}
	sql := ""
	for _, command := range plan.Commands {
		for _, part := range command {
			sql += part + "\n"
		}
	}
	for _, want := range []string{
		"CREATE DATABASE IF NOT EXISTS `siarta24`",
		"CREATE USER IF NOT EXISTS 'siarta24'@'localhost'",
		"CREATE USER IF NOT EXISTS 'siarta24'@'127.0.0.1'",
		"ALTER USER 'siarta24'@'localhost'",
		"ALTER USER 'siarta24'@'127.0.0.1'",
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("rotate is missing %q\n---\n%s", want, sql)
		}
	}
}
