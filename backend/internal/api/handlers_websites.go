package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/framework"
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
	response := map[string]any{"items": items}
	// An account under a package limit is told what it is, so a create that will be
	// refused can say "2 of 2 used" beforehand (the same hint the databases list gives).
	if limits := s.limitsForTenant(user.Username); limits.MaxSites > 0 {
		if used, err := s.store.CountWebsitesByTenant(user.Username); err == nil {
			response["quota"] = map[string]int{"maxSites": limits.MaxSites, "usedSites": used}
		}
	}
	writeJSON(w, http.StatusOK, response)
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

// handleDetectWebsiteFramework inspects an existing site directory and returns detected framework info.
func (s *Server) handleDetectWebsiteFramework(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	fw := s.host.DetectFramework(site.TenantUser, site.Slug)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"framework": fw,
	})
}

// handleDetectFrameworkFromSource inspects an uploaded ZIP archive or an existing folder on server.
func (s *Server) handleDetectFrameworkFromSource(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	// 1. Check if multipart archive was uploaded
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		if err := r.ParseMultipartForm(64 * 1024 * 1024); err == nil && r.MultipartForm != nil {
			if files, ok := r.MultipartForm.File["archive"]; ok && len(files) > 0 {
				fh := files[0]
				file, err := fh.Open()
				if err == nil {
					defer file.Close()
					if ra, ok := file.(io.ReaderAt); ok {
						fw := framework.DetectArchive(ra, fh.Size)
						writeJSON(w, http.StatusOK, map[string]any{
							"ok":        true,
							"framework": fw,
						})
						return
					}
				}
			}
		}
	}

	// 2. Check JSON payload for existing directory
	var payload struct {
		Tenant string `json:"tenant"`
		Slug   string `json:"slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err == nil && payload.Slug != "" {
		tenant := payload.Tenant
		if tenant == "" || user.Role != "admin" {
			tenant = user.Username
		}
		fw := s.host.DetectFramework(tenant, payload.Slug)
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"framework": fw,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        false,
		"framework": nil,
	})
}
