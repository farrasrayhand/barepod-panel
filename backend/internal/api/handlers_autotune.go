package api

import (
	"net/http"
	"os"
	"path/filepath"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handleGetAutoTune reports current hardware memory sizing and tuning profiles for
// MariaDB, PostgreSQL, Redis, and Web Stack.
func (s *Server) handleGetAutoTune(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	ramMB := dbengine.ReadHostRAMMB()
	profile := dbengine.CalculateProfile(ramMB)

	// Check if configurations are actually present on disk
	if _, err := os.Stat("/etc/mysql/mariadb.conf.d/99-barepod.cnf"); err == nil {
		profile.MariaDB.Applied = true
	}
	matches, _ := filepath.Glob("/etc/postgresql/*/main/conf.d/99-barepod.conf")
	if len(matches) > 0 {
		profile.PostgreSQL.Applied = true
		profile.PostgreSQL.ConfigFile = matches[0]
	}
	if _, err := os.Stat("/etc/redis/redis.conf"); err == nil {
		profile.Redis.Applied = true
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"profile": profile,
		"ramMb":   ramMB,
	})
}

// handleApplyAutoTune re-calculates and re-applies tuning drop-ins across MariaDB,
// PostgreSQL, and Redis, reloading them safely.
func (s *Server) handleApplyAutoTune(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	ramMB := dbengine.ReadHostRAMMB()
	profile := dbengine.CalculateProfile(ramMB)

	runner := s.host.Runner
	redisURL := s.cfg.RedisURL

	res := dbengine.ApplyProfile(r.Context(), runner, redisURL, profile)
	_ = s.store.Audit(user.ID, "system.autotune", "apply", clientIP(r), "applied hardware-adaptive auto-tuning")

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"result":  res,
	})
}
