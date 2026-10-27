package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
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

	// Auto-detect framework for generic or unassigned sites
	for i := range items {
		if items[i].Runtime != "proxy" {
			if fw := s.host.DetectFramework(items[i].TenantUser, items[i].Slug); fw != nil && framework.ShouldUpdateFramework(items[i].Framework, fw.Title) {
				items[i].Framework = fw.Title
				_ = s.store.UpdateWebsiteFramework(items[i].Slug, fw.Title)
			}
		}
	}

	query := parseListQuery(r)
	if !query.validFor(websiteSortFields) {
		writeError(w, http.StatusBadRequest, "validation_error",
			"sort_by must be one of owner, name, status, runtime or engine for websites")
		return
	}
	if user.Role == "admin" {
		items = filterWebsitesByOwner(items, query.Owner)
	}
	sortWebsites(items, query)

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

// handleWebsiteLogs returns the service's journal, not the web-server access log. The Logs tab
// used to show only telemetry; when an application fails to start, the unit's own output is the
// thing that says why.
func (s *Server) handleWebsiteLogs(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	lines := 200
	if raw := r.URL.Query().Get("lines"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 1000 {
			lines = n
		}
	}
	unit := "barepod-app@" + site.Slug + ".service"
	response := map[string]any{
		"unit":  unit,
		"mode":  s.host.Mode(),
		"lines": []string{},
	}
	if !s.host.Materialises() {
		response["note"] = "dry-run: the service unit is not running on this machine, so there is no journal to read"
		writeJSON(w, http.StatusOK, response)
		return
	}

	out, err := s.host.Run(r.Context(), []string{
		"journalctl", "-u", unit, "--no-pager", "-n", strconv.Itoa(lines), "-o", "short-iso",
	})
	if err != nil {
		response["note"] = "journalctl could not read this unit: " + err.Error()
		writeJSON(w, http.StatusOK, response)
		return
	}
	collected := []string{}
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		collected = append(collected, line)
	}
	response["lines"] = collected
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
	if site.Runtime != "proxy" {
		if fw := s.host.DetectFramework(site.TenantUser, site.Slug); fw != nil && framework.ShouldUpdateFramework(site.Framework, fw.Title) {
			site.Framework = fw.Title
			_ = s.store.UpdateWebsiteFramework(site.Slug, fw.Title)
		}
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
	if fw != nil && framework.ShouldUpdateFramework(site.Framework, fw.Title) {
		site.Framework = fw.Title
		_ = s.store.UpdateWebsiteFramework(site.Slug, fw.Title)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"framework": fw,
	})
}

type updateWebsiteFrameworkRequest struct {
	Framework string `json:"framework"`
}

// handleUpdateWebsiteFramework updates the website's framework label.
func (s *Server) handleUpdateWebsiteFramework(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req updateWebsiteFrameworkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Invalid request body")
		return
	}

	fw := strings.TrimSpace(req.Framework)
	if fw == "" {
		if detected := s.host.DetectFramework(site.TenantUser, site.Slug); detected != nil && detected.Name != "" {
			fw = detected.Title
		} else {
			fw = "generic (bring your own code)"
		}
	}

	if err := s.store.UpdateWebsiteFramework(site.Slug, fw); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not update framework")
		return
	}

	_ = s.store.Audit(user.ID, "website.update_framework", slug, clientIP(r), "framework="+fw)
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
		Tenant     string `json:"tenant"`
		Slug       string `json:"slug"`
		Repo       string `json:"repo"`
		Branch     string `json:"branch"`
		ProviderID string `json:"providerId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err == nil && payload.Repo != "" {
		s.detectFromGitPayload(w, r, user, payload.Repo, payload.Branch, payload.ProviderID)
		return
	} else if err == nil && payload.Slug != "" {
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
