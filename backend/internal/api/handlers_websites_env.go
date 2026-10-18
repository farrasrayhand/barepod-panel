package api

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// envSecretKey matches the .env keys whose value must never leave the daemon. The
// Environment tab is a read-only view, so a credential is shown masked rather than
// shipped to the browser.
var envSecretKey = regexp.MustCompile(`(?i)(password|passwd|secret|token|app_key|api_key|access_key|private_key)`)

// envAssignment splits a KEY=value line, keeping `export ` and the spacing so a file
// reads the same when only the value is replaced.
var envAssignment = regexp.MustCompile(`^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$`)

// MaskEnvSecrets replaces the value of every secret-looking key with a fixed mask.
func MaskEnvSecrets(content string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		m := envAssignment.FindStringSubmatch(line)
		if m == nil || strings.TrimSpace(m[4]) == "" {
			continue
		}
		if !envSecretKey.MatchString(m[2]) {
			continue
		}
		lines[i] = m[1] + m[2] + m[3] + "********"
	}
	return strings.Join(lines, "\n")
}

// handleWebsiteEnv returns the website's real .env, with secret values masked.
//
// It exists because the Environment tab used to *invent* the file: every value was
// derived from the site name, and DB_CONNECTION was hardcoded to pgsql. That is how a
// panel can claim an application uses PostgreSQL while it runs on SQLite — the one
// authority on what the app connects to is this file.
func (s *Server) handleWebsiteEnv(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	envPath := filepath.Join(s.host.SitePath(site.TenantUser, site.Slug), ".env")
	raw, err := os.ReadFile(envPath)
	if err != nil {
		// Missing is not an error: a static site or a proxy has no .env at all, and an
		// honest empty state is better than an invented file.
		writeJSON(w, http.StatusOK, map[string]any{
			"path":   envPath,
			"exists": false,
			"note":   "there is no .env file in this site directory, or the daemon cannot read it",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"path":    envPath,
		"exists":  true,
		"content": MaskEnvSecrets(string(raw)),
	})
}
