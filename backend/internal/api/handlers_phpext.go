package api

import (
	"net/http"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpext"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handlePhpExtensions reports the PHP extensions this host really has for a version:
// the mods it can toggle, which are on, and what its repositories still offer. The
// Settings screen reads this instead of a catalog kept in the frontend, so a version
// this host does not carry cannot be shown as if it did.
func (s *Server) handlePhpExtensions(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	version := r.URL.Query().Get("version")
	if version == "" {
		version = s.defaultPhpVersion()
	}
	report, err := phpext.List(r.Context(), s.host, version)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// handleSetPhpExtension enables or disables one extension for a version (phpenmod /
// phpdismod and a reload), which is where the toggle in Settings actually lands.
func (s *Server) handleSetPhpExtension(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Version string `json:"version"`
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if req.Version == "" {
		req.Version = s.defaultPhpVersion()
	}
	if err := phpext.Set(r.Context(), s.host, req.Version, req.Name, req.Enabled); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	action := "disabled"
	if req.Enabled {
		action = "enabled"
	}
	_ = s.store.Audit(user.ID, "php.extension."+action, req.Name+" (php "+req.Version+")", clientIP(r), "")
	report, err := phpext.List(r.Context(), s.host, req.Version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// defaultPhpVersion is the newest PHP the host has: a site chooses its own version, so
// this is only the fallback for a caller that names none.
func (s *Server) defaultPhpVersion() string {
	versions := phpext.InstalledVersions()
	if len(versions) > 0 {
		return versions[0]
	}
	return ""
}

// handleInstallPhpExtensions triggers a background job to install missing PHP extensions.
func (s *Server) handleInstallPhpExtensions(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Version string `json:"version"`
	}
	_ = decodeJSON(r, &req)
	job, err := s.installs.Start("php-extensions", req.Version)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "php.extensions.install", req.Version, clientIP(r), job.ID)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"jobId":      job.ID,
		"component":  "php-extensions",
		"version":    req.Version,
		"status":     job.Status,
		"totalSteps": job.TotalSteps,
		"mode":       job.Mode,
		"stream":     "/api/v1/system/stack/jobs/stream?id=" + job.ID,
	})
}

