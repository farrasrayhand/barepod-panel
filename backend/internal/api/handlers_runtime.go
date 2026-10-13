package api

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpfpm"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// siteOr404 resolves the website named in the path, never another tenant's.
func (s *Server) siteOr404(w http.ResponseWriter, r *http.Request, user *store.User) (*store.Website, bool) {
	site, err := s.store.WebsiteBySlug(r.PathValue("slug"))
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return nil, false
	}
	return site, true
}

// siteRuntime reports how a site is served: the host's active engine, whether it is
// installed, and where the site's files and socket live.
func (s *Server) siteRuntime(site *store.Website) map[string]any {
	engine := s.deploy.ActiveEngine()
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	out := map[string]any{
		"runtime":         site.Runtime,
		"version":         site.Version,
		"webServer":       engine,
		"siteEngine":      site.WebServer,
		"engine":          engine,
		"engineSupported": webserver.Supported(engine),
		"engineInstalled": webserver.Available(engine, s.lookPath),
		"docRoot":         spec.DocRoot,
		"port":            site.Port,
		"vhostPath":       webserver.Path(engine, s.host.VhostsFor(engine), site.Slug),
		"mode":            s.host.Mode(),
	}
	if site.Runtime == "php" {
		out["socket"] = phpfpm.SocketIn(siteDir)
	}
	return out
}

func (s *Server) handleGetRuntime(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, s.siteRuntime(site))
}

// handlePutRuntime used to switch a single site's web server. The engine is a
// host-level choice now (one engine owns :80), so this refuses and points at Stack.
func (s *Server) handlePutRuntime(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	var req struct {
		Engine  string  `json:"engine"`
		Version *string `json:"version"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if req.Version != nil && strings.TrimSpace(*req.Version) != site.Version {
		writeError(w, http.StatusConflict, "redeploy_required",
			"changing the runtime version rewrites the service unit — redeploy the site instead")
		return
	}
	engine := strings.ToLower(strings.TrimSpace(req.Engine))
	if engine != "" && !webserver.Supported(engine) {
		writeError(w, http.StatusBadRequest, "unsupported_web_server",
			engine+" is not supported — choose nginx, caddy, apache, or openlitespeed")
		return
	}
	writeJSON(w, http.StatusOK, s.siteRuntime(site))
}

// applyVhost writes the site's vhost with the active engine, validating it before it
// goes live.
func (s *Server) applyVhost(r *http.Request, site *store.Website) error {
	engine := s.deploy.ActiveEngine()
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	home := filepath.Join(s.host.SitesRoot, site.TenantUser)
	if err := webserver.GrantRead(r.Context(), s.host, home, siteDir, webserver.WebUser(engine)); err != nil {
		return err
	}
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	_, err := webserver.Apply(r.Context(), engine, s.host.VhostsFor(engine), s.host, spec)
	return err
}

// handleVhostPreview renders the vhost the daemon would write, so a client never has
// to guess it (the screen used to build this string in the browser).
func (s *Server) handleVhostPreview(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	engine := r.URL.Query().Get("engine")
	if engine == "" {
		engine = s.deploy.ActiveEngine()
	}
	if !webserver.Supported(engine) {
		writeError(w, http.StatusNotImplemented, "not_supported_yet", engine+" is not supported yet — only nginx and caddy are implemented")
		return
	}
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	config, err := webserver.Render(engine, spec)
	if err != nil {
		writeError(w, http.StatusNotImplemented, "not_supported_yet", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"engine": engine, "config": config})
}

// handlePhpFpmReload restarts the site's PHP-FPM master (the pool reload). Only a PHP
// site has one; anything else is refused rather than half-served.
func (s *Server) handlePhpFpmReload(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	if site.Runtime != "php" {
		writeError(w, http.StatusConflict, "not_applicable", "This site has no PHP-FPM pool (runtime "+site.Runtime+")")
		return
	}
	out, err := s.host.ServiceAction(r.Context(), "restart", site.Slug)
	if err != nil && s.host.Materialises() {
		writeError(w, http.StatusBadGateway, "service_error", "systemctl restart failed: "+strings.TrimSpace(out))
		return
	}
	_ = s.store.Audit(user.ID, "website.php_fpm_reload", site.Slug, clientIP(r), s.host.Mode())
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "reloaded",
		"mode":   s.host.Mode(),
		"pool":   filepath.Join(s.host.SitePath(site.TenantUser, site.Slug), "php-fpm.conf"),
		"output": strings.TrimSpace(out),
	})
}
