package api

import (
	"net/http"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

// handleCapabilities reports what this host can actually do (systemd, LXC,
// Docker, S.M.A.R.T., fstrim) so the UI can degrade gracefully.
func (s *Server) handleCapabilities(w http.ResponseWriter, _ *http.Request, _ *store.User, _ *store.Session) {
	caps := sysinfo.Detect()
	writeJSON(w, http.StatusOK, map[string]any{"capabilities": caps})
}

// handleListWebsites returns every website (pilot module of Phase 2).
func (s *Server) handleListWebsites(w http.ResponseWriter, _ *http.Request, _ *store.User, _ *store.Session) {
	items, err := s.store.ListWebsites()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list websites")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleGetWebsite returns one website by slug.
func (s *Server) handleGetWebsite(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	writeJSON(w, http.StatusOK, site)
}
