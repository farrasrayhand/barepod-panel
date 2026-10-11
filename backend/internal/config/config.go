// Package config holds the daemon runtime configuration.
package config

import (
	"flag"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Config is the resolved daemon configuration.
type Config struct {
	Listen    string
	DBPath    string
	KeyPath   string
	StaticDir string
	// RedisURL is the admin connection used to create per-cache ACL users.
	RedisURL    string
	SitesRoot   string
	UnitsDir    string
	LogLevel    string
	DryRun      bool
	MaxUploadMB int
	// TLS serves the panel over HTTPS. With no cert/key given, a self-signed pair
	// is generated beside the panel database.
	TLS     bool
	TLSCert string
	TLSKey  string
	// HTTPListen is a plain-HTTP address that serves the server's default page, so a
	// bare visit answers ("no website here", and where the panel is) instead of a
	// browser's "connection refused" — until the web-server module owns the port.
	HTTPListen string
	// HTTPSListen is the same default page over TLS, so https://<server>/ answers
	// too. Empty disables it.
	HTTPSListen string

	MetricsInterval time.Duration
	MetricsHistory  int

	// DbtoolsIdle is how long an on-demand database manager (pgweb) may sit
	// unused before the sweeper stops it. The timer slides on every request.
	DbtoolsIdle time.Duration
	// DbtoolsDir is where the on-demand managers that need installing live
	// (phpMyAdmin), and where the panel writes their per-database config.
	DbtoolsDir string
}

// DefaultDbtoolsDir sits next to the panel database unless overridden.
func DefaultDbtoolsDir() string {
	return env("BAREPOD_DBTOOLS_DIR", filepath.Join(filepath.Dir(DefaultDBPath()), "dbtools"))
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if parsed, err := time.ParseDuration(v); err == nil && parsed > 0 {
			return parsed
		}
	}
	return fallback
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
	listen := fs.String("listen", env("BAREPOD_LISTEN", ":8443"), "address to listen on")
	tls := fs.Bool("tls", envBool("BAREPOD_TLS", true), "serve the panel over HTTPS (a self-signed certificate is generated when none is given)")
	tlsCert := fs.String("tls-cert", env("BAREPOD_TLS_CERT", ""), "TLS certificate path (default: a self-signed pair beside the panel database)")
	tlsKey := fs.String("tls-key", env("BAREPOD_TLS_KEY", ""), "TLS private key path")
	httpListen := fs.String("http-listen", env("BAREPOD_HTTP_LISTEN", ":80"), "plain-HTTP address that serves the server's default page (empty disables it); the web-server module will take this port over")
	httpsListen := fs.String("https-listen", env("BAREPOD_HTTPS_LISTEN", ":443"), "HTTPS address that serves the same default page over TLS (empty disables it)")
	dbPath := fs.String("db", DefaultDBPath(), "path to the panel SQLite database")
	keyPath := fs.String("key", DefaultKeyPath(), "path to the secrets encryption key")
	staticDir := fs.String("static", env("BAREPOD_STATIC", "./dist"), "path to the built frontend (SPA)")
	sitesRoot := fs.String("sites-root", env("BAREPOD_SITES_ROOT", DefaultSitesRoot()), "directory that holds tenant home directories")
	redisURL := fs.String("redis-url", env("BAREPOD_REDIS_URL", "redis://127.0.0.1:6379"), "admin connection used to create per-cache Redis users")
	unitsDir := fs.String("units-dir", env("BAREPOD_UNITS_DIR", defaultUnitsDir()), "directory for systemd unit files")
	logLevel := fs.String("log-level", env("BAREPOD_LOG_LEVEL", "info"), "log level: debug|info|warn|error")
	dryRun := fs.Bool("dry-run", envBool("BAREPOD_DRY_RUN", false), "never execute privileged commands (forced on non-Linux hosts)")
	maxUpload := fs.Int("max-upload-mb", envInt("BAREPOD_MAX_UPLOAD_MB", 64), "upload/edit ceiling for the file manager, in MiB")
	metricsInterval := fs.Duration("metrics-interval", envDuration("BAREPOD_METRICS_INTERVAL", 15*time.Second), "how often host and per-website metrics are sampled")
	metricsHistory := fs.Int("metrics-history", envInt("BAREPOD_METRICS_HISTORY", 2880), "how many metric samples to keep in memory (2880 x 15s = 12h)")
	dbtoolsIdle := fs.Duration("dbtools-idle", envDuration("BAREPOD_DBTOOLS_IDLE", 15*time.Minute), "how long an unused on-demand database manager (pgweb, phpMyAdmin, DbGate) stays up before it is stopped")
	dbtoolsDir := fs.String("dbtools-dir", DefaultDbtoolsDir(), "where on-demand managers that need installing (phpMyAdmin) live, and where their configs are written")

	if err := fs.Parse(args); err != nil {
		return Config{}, err
	}

	return Config{
		Listen:          *listen,
		DBPath:          filepath.Clean(*dbPath),
		KeyPath:         filepath.Clean(*keyPath),
		StaticDir:       filepath.Clean(*staticDir),
		SitesRoot:       filepath.Clean(*sitesRoot),
		RedisURL:        strings.TrimSpace(*redisURL),
		UnitsDir:        filepath.Clean(*unitsDir),
		LogLevel:        *logLevel,
		DryRun:          *dryRun,
		MaxUploadMB:     *maxUpload,
		TLS:             *tls,
		TLSCert:         strings.TrimSpace(*tlsCert),
		TLSKey:          strings.TrimSpace(*tlsKey),
		HTTPListen:      strings.TrimSpace(*httpListen),
		HTTPSListen:     strings.TrimSpace(*httpsListen),
		MetricsInterval: *metricsInterval,
		MetricsHistory:  *metricsHistory,
		DbtoolsIdle:     *dbtoolsIdle,
		DbtoolsDir:      filepath.Clean(*dbtoolsDir),
	}, nil
}
