package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/phpext"
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

func availableRuntimeVersions(runtime string) []string {
	switch strings.ToLower(runtime) {
	case "php":
		vers := phpext.InstalledVersions()
		if len(vers) > 0 {
			return vers
		}
		return []string{"8.1", "8.2", "8.3", "8.4"}
	case "nodejs":
		return []string{"18", "20", "22"}
	case "python":
		return []string{"3.10", "3.11", "3.12"}
	case "ruby":
		return []string{"3.1", "3.2", "3.3"}
	case "go":
		return []string{"1.21", "1.22", "1.23"}
	case "rust":
		return []string{"stable"}
	default:
		return nil
	}
}

// siteRuntime reports how a site is served: the host's active engine, whether it is
// installed, and where the site's files and socket live.
func (s *Server) siteRuntime(site *store.Website) map[string]any {
	engine := s.deploy.ActiveEngine()
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	out := map[string]any{
		"runtime":           site.Runtime,
		"version":           site.Version,
		"availableVersions": availableRuntimeVersions(site.Runtime),
		"webServer":         engine,
		"siteEngine":        site.WebServer,
		"engine":            engine,
		"engineSupported":   webserver.Supported(engine),
		"engineInstalled":   webserver.Available(engine, s.lookPath),
		"docRoot":           spec.DocRoot,
		"port":              site.Port,
		"vhostPath":         webserver.Path(engine, s.host.VhostsFor(engine), site.Slug),
		"mode":              s.host.Mode(),
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

// handlePutRuntime switches a site's runtime version and updates the host service.
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

	if req.Version != nil && strings.TrimSpace(*req.Version) != "" && strings.TrimSpace(*req.Version) != site.Version {
		newVer := strings.TrimSpace(*req.Version)
		if err := s.store.UpdateWebsiteVersion(site.Slug, newVer); err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", "Failed to update version: "+err.Error())
			return
		}
		site.Version = newVer

		// Reconfigure runtime
		siteDir := s.host.SitePath(site.TenantUser, site.Slug)
		if strings.EqualFold(site.Runtime, "php") {
			limits := s.limitsForTenant(site.TenantUser)
			var saved map[string]any
			if raw, _ := s.store.PanelSetting("site_runtime_config:" + site.Slug); raw != "" {
				_ = json.Unmarshal([]byte(raw), &saved)
			}
			directives := phpfpm.Directives{
				MemoryLimit:        stringVal(saved["memoryLimit"], "256M"),
				UploadMaxSize:      stringVal(saved["uploadMaxSize"], "64M"),
				PostMaxSize:        stringVal(saved["postMaxSize"], "64M"),
				MaxExecutionTime:   intVal(saved["maxExecutionTime"], 60),
				MaxInputVars:       intVal(saved["maxInputVars"], 3000),
				ProcessIdleTimeout: stringVal(saved["processIdleTimeout"], "10s"),
			}
			maxChildren := intVal(saved["maxChildren"], phpfpm.MaxChildren(limits.MemoryMB))
			if maxChildren <= 0 {
				maxChildren = 5
			}
			spec := phpfpm.Spec{
				Tenant:      site.TenantUser,
				SiteDir:     siteDir,
				Socket:      phpfpm.SocketIn(siteDir),
				MaxChildren: maxChildren,
				Directives:  directives,
				MemoryMB:    limits.MemoryMB,
			}
			_, _ = phpfpm.Write(r.Context(), s.host, spec)
			_ = s.applyVhost(r, site)
			if s.host.Materialises() {
				_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
			}
		} else {
			_ = s.applyVhost(r, site)
			if s.host.Materialises() {
				_, _ = s.host.ServiceAction(r.Context(), "restart", site.Slug)
			}
		}
		_ = s.store.Audit(user.ID, "website.version_change", site.Slug, clientIP(r), "new_version="+newVer)
	}

	engine := strings.ToLower(strings.TrimSpace(req.Engine))
	if engine != "" && engine != strings.ToLower(site.WebServer) {
		if !webserver.Supported(engine) {
			writeError(w, http.StatusBadRequest, "unsupported_web_server",
				engine+" is not supported — choose caddy, nginx, openlitespeed, or apache")
			return
		}
		if err := s.store.SetWebsiteWebServer(site.Slug, engine); err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", "Failed to update web server: "+err.Error())
			return
		}
		site.WebServer = engine
		_ = s.applyVhost(r, site)
		_ = s.store.Audit(user.ID, "website.webserver_change", site.Slug, clientIP(r), "new_engine="+engine)
	}

	writeJSON(w, http.StatusOK, s.siteRuntime(site))
}

// applyVhost writes the site's vhost with the active engine, validating it before it
// goes live.
func (s *Server) applyVhost(r *http.Request, site *store.Website) error {
	engine := site.WebServer
	if engine == "" || !webserver.Supported(engine) {
		engine = s.deploy.ActiveEngine()
	}
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	home := filepath.Join(s.host.SitesRoot, site.TenantUser)
	if err := webserver.GrantRead(r.Context(), s.host, home, siteDir, webserver.WebUser(engine)); err != nil {
		return err
	}
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	if raw, err := s.store.PanelSetting("site_runtime_config:" + site.Slug); err == nil && raw != "" {
		var cfg map[string]any
		if err := json.Unmarshal([]byte(raw), &cfg); err == nil {
			if u, ok := cfg["upstreamUrl"].(string); ok && strings.TrimSpace(u) != "" {
				spec = spec.WithUpstream(strings.TrimSpace(u))
			}
		}
	}
	if domains, err := s.store.ListDomainsForSite(site.Slug); err == nil && len(domains) > 0 {
		var aliases []string
		var certPath, keyPath string
		var sslEnabled, forceHTTPS, hsts bool
		for _, d := range domains {
			if !d.IsPrimary {
				aliases = append(aliases, d.Domain)
			} else {
				certPath = d.SSLCertPath
				keyPath = d.SSLKeyPath
				sslEnabled = d.SSLEnabled
				forceHTTPS = d.ForceHTTPS
				hsts = d.HSTSEnabled
			}
		}
		spec = spec.WithSSL(aliases, certPath, keyPath, sslEnabled, forceHTTPS, hsts)
	}
	if sec, err := s.store.GetWebsiteSecurity(site.Slug); err == nil && sec != nil {
		spec = spec.WithSecurity(s.buildSecuritySpec(sec))
	}
	_, err := webserver.Apply(r.Context(), engine, s.host.VhostsFor(engine), s.host, spec)
	if active := s.deploy.ActiveEngine(); active != "" && !strings.EqualFold(active, engine) {
		_ = webserver.GrantRead(r.Context(), s.host, home, siteDir, webserver.WebUser(active))
		_, _ = webserver.Apply(r.Context(), active, s.host.VhostsFor(active), s.host, spec)
	}
	return err
}

func (s *Server) buildSecuritySpec(sec *store.WebsiteSecurity) webserver.SecuritySpec {
	if sec == nil {
		return webserver.SecuritySpec{}
	}
	htpasswdPath := ""
	if sec.BasicAuthEnabled && sec.BasicAuthPasswordHash != "" {
		htpasswdPath = filepath.Join(webserver.AuthDir, sec.WebsiteSlug+".htpasswd")
	}
	return webserver.SecuritySpec{
		MaintenanceMode:      sec.MaintenanceMode,
		MaintenanceTitle:     sec.MaintenanceTitle,
		MaintenanceMessage:   sec.MaintenanceMessage,
		MaintenanceBypassIPs: webserver.ParseIPList(sec.MaintenanceBypassIPs),
		BasicAuthEnabled:     sec.BasicAuthEnabled,
		BasicAuthUser:        sec.BasicAuthUser,
		BasicAuthHash:        sec.BasicAuthPasswordHash,
		BasicAuthFile:        htpasswdPath,
		BasicAuthRealm:       sec.BasicAuthRealm,
		BasicAuthBypassIPs:   webserver.ParseIPList(sec.BasicAuthBypassIPs),
		IPRestrictionMode:    sec.IPRestrictionMode,
		IPRestrictionList:    webserver.ParseIPList(sec.IPRestrictionList),
		RateLimitEnabled:     sec.RateLimitEnabled,
		RateLimitReqPerSec:   sec.RateLimitReqPerSec,
		RateLimitBurst:       sec.RateLimitBurst,
	}
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
		writeError(w, http.StatusNotImplemented, "not_supported_yet", engine+" is not supported yet — only nginx, caddy, apache, openlitespeed are implemented")
		return
	}
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
	if domains, err := s.store.ListDomainsForSite(site.Slug); err == nil && len(domains) > 0 {
		var aliases []string
		var certPath, keyPath string
		var sslEnabled, forceHTTPS, hsts bool
		for _, d := range domains {
			if !d.IsPrimary {
				aliases = append(aliases, d.Domain)
			} else {
				certPath = d.SSLCertPath
				keyPath = d.SSLKeyPath
				sslEnabled = d.SSLEnabled
				forceHTTPS = d.ForceHTTPS
				hsts = d.HSTSEnabled
			}
		}
		spec = spec.WithSSL(aliases, certPath, keyPath, sslEnabled, forceHTTPS, hsts)
	}
	if sec, err := s.store.GetWebsiteSecurity(site.Slug); err == nil && sec != nil {
		spec = spec.WithSecurity(s.buildSecuritySpec(sec))
	}
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
