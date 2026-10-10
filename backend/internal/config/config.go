// Package config holds the daemon runtime configuration.
package config

import (
	"flag"
	"os"
	"path/filepath"
)

// Config is the resolved daemon configuration.
type Config struct {
	Listen    string
	DBPath    string
	KeyPath   string
	StaticDir string
	LogLevel  string
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// Load resolves configuration from flags first, then environment, then defaults.
func Load() Config {
	listen := flag.String("listen", env("BAREPOD_LISTEN", "127.0.0.1:8080"), "address to listen on")
	dbPath := flag.String("db", env("BAREPOD_DB", "/var/lib/barepod/barepod.db"), "path to the panel SQLite database")
	keyPath := flag.String("key", env("BAREPOD_KEY", "/etc/barepod/secret.key"), "path to the secrets encryption key")
	staticDir := flag.String("static", env("BAREPOD_STATIC", "./dist"), "path to the built frontend (SPA)")
	logLevel := flag.String("log-level", env("BAREPOD_LOG_LEVEL", "info"), "log level: debug|info|warn|error")
	flag.Parse()

	return Config{
		Listen:    *listen,
		DBPath:    filepath.Clean(*dbPath),
		KeyPath:   filepath.Clean(*keyPath),
		StaticDir: filepath.Clean(*staticDir),
		LogLevel:  *logLevel,
	}
}
