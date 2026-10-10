// Package config holds the daemon runtime configuration.
package config

import (
	"flag"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
)

// Config is the resolved daemon configuration.
type Config struct {
	Listen      string
	DBPath      string
	KeyPath     string
	StaticDir   string
	SitesRoot   string
	UnitsDir    string
	LogLevel    string
	DryRun      bool
	MaxUploadMB int
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	switch os.Getenv(key) {
	case "1", "true", "TRUE", "yes":
		return true
	case "0", "false", "FALSE", "no":
		return false
	}
	return fallback
}

func onLinux() bool { return runtime.GOOS == "linux" }

func DefaultSitesRoot() string {
	if onLinux() {
		return "/home"
	}
	return "./data/sites"
}

func defaultUnitsDir() string {
	if onLinux() {
		return "/etc/systemd/system"
	}
	return "./data/units"
}

// DefaultDBPath is the panel database location.
func DefaultDBPath() string {
	return env("BAREPOD_DB", "/var/lib/barepod/barepod.db")
}

// DefaultKeyPath is the secrets key location.
func DefaultKeyPath() string {
	return env("BAREPOD_KEY", "/etc/barepod/secret.key")
}

// Load parses the flags of the `serve` subcommand (args excludes the program
// name and the subcommand itself).
func Load(args []string) (Config, error) {
	fs := flag.NewFlagSet("barepod serve", flag.ContinueOnError)
	listen := fs.String("listen", env("BAREPOD_LISTEN", "127.0.0.1:8080"), "address to listen on")
	dbPath := fs.String("db", DefaultDBPath(), "path to the panel SQLite database")
	keyPath := fs.String("key", DefaultKeyPath(), "path to the secrets encryption key")
	staticDir := fs.String("static", env("BAREPOD_STATIC", "./dist"), "path to the built frontend (SPA)")
	sitesRoot := fs.String("sites-root", env("BAREPOD_SITES_ROOT", DefaultSitesRoot()), "directory that holds tenant home directories")
	unitsDir := fs.String("units-dir", env("BAREPOD_UNITS_DIR", defaultUnitsDir()), "directory for systemd unit files")
	logLevel := fs.String("log-level", env("BAREPOD_LOG_LEVEL", "info"), "log level: debug|info|warn|error")
	dryRun := fs.Bool("dry-run", envBool("BAREPOD_DRY_RUN", false), "never execute privileged commands (forced on non-Linux hosts)")
	maxUpload := fs.Int("max-upload-mb", envInt("BAREPOD_MAX_UPLOAD_MB", 64), "upload/edit ceiling for the file manager, in MiB")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}

	return Config{
		Listen:      *listen,
		DBPath:      filepath.Clean(*dbPath),
		KeyPath:     filepath.Clean(*keyPath),
		StaticDir:   filepath.Clean(*staticDir),
		SitesRoot:   filepath.Clean(*sitesRoot),
		UnitsDir:    filepath.Clean(*unitsDir),
		LogLevel:    *logLevel,
		DryRun:      *dryRun,
		MaxUploadMB: *maxUpload,
	}, nil
}
