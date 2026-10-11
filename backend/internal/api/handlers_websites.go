package api

import (
	"net/http"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/terminal"
)

// handleCapabilities reports what this host can actually do (systemd, LXC,
// Docker, S.M.A.R.T., fstrim, tenant accounts, quotas) so the UI can degrade
// gracefully — with guidance instead of an error — on an unprivileged container.
func (s *Server) handleCapabilities(w http.ResponseWriter, _ *http.Request, _ *store.User, _ *store.Session) {
	caps := sysinfo.Detect()
	// The jail probe runs the daemon again in a throwaway namespace, so it lives
	// with the terminal rather than in the sysinfo package.
	if jailed, _ := terminal.JailSupported(); jailed {
		caps.PTYJail = true
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"capabilities": caps,
		"limitations":  caps.Limitations(),
		"mode":         s.host.Mode(),
	})
}

// handleListWebsites returns the websites the caller may see: an admin sees all,
// everyone else only their own account's websites.
func (s *Server) handleListWebsites(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var (
		items []store.Website
		err   error
	)
	if user.Role == "admin" {
		items, err = s.store.ListWebsites()
	} else {
		items, err = s.store.ListWebsitesByTenant(user.Username)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list websites")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleGetWebsite returns one website by slug, but never another tenant's.
func (s *Server) handleGetWebsite(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	writeJSON(w, http.StatusOK, site)
}
