package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/cloudflare"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/provision"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

type sourcePayload struct {
	Kind   string `json:"kind"`
	Repo   string `json:"repo"`
	Branch string `json:"branch"`
}

type databasePayload struct {
	Engine  string `json:"engine"`
	Version string `json:"version"`
	Name    string `json:"name"`
}

type cachePayload struct {
	Engine  string `json:"engine"`
	Version string `json:"version"`
}

type createWebsiteRequest struct {
	Slug             string            `json:"slug"`
	Domain           string            `json:"domain"`
	TenantUser       string            `json:"tenantUser"`
	Runtime          string            `json:"runtime"`
	Version          string            `json:"version"`
	Framework        string            `json:"framework"`
	FrameworkVersion string            `json:"frameworkVersion"`
	WebServer        string            `json:"webServer"`
	Port             int               `json:"port"`
	UpstreamURL      string            `json:"upstreamUrl"`
	ProxyWebsocket   bool              `json:"proxyWebsocket"`
	ProxyPreserveHost bool             `json:"proxyPreserveHost"`
	ProxyRealIP      bool              `json:"proxyRealIp"`
	ProxyTimeoutSecs int               `json:"proxyTimeoutSecs"`
	SSL              bool              `json:"ssl"`
	TunnelEnabled    bool              `json:"tunnelEnabled"`
	Source           sourcePayload     `json:"source"`
	Database         *databasePayload  `json:"database"`
	Cache            *cachePayload     `json:"cache"`
	AutomationSteps  []string          `json:"automationSteps"`
	DeployScript     string            `json:"deployScript"`
	Env              map[string]string `json:"env"`
}

var slugSanitizer = regexp.MustCompile(`[^a-z0-9-]+`)

func (r *createWebsiteRequest) normalize() {
	r.Domain = strings.ToLower(strings.TrimSpace(r.Domain))
	r.Runtime = strings.ToLower(strings.TrimSpace(r.Runtime))
	r.WebServer = strings.ToLower(strings.TrimSpace(r.WebServer))
	r.Framework = strings.ToLower(strings.TrimSpace(r.Framework))
	r.TenantUser = strings.ToLower(strings.TrimSpace(r.TenantUser))
	r.Source.Kind = strings.ToLower(strings.TrimSpace(r.Source.Kind))
	r.Source.Branch = strings.TrimSpace(r.Source.Branch)
	r.UpstreamURL = strings.TrimSpace(r.UpstreamURL)

	if r.Runtime == "proxy" {
		r.Framework = "Reverse Proxy"
		r.Source.Kind = "default"
		r.Source.Repo = ""
		r.Source.Branch = ""
		r.AutomationSteps = nil
		r.DeployScript = ""
		r.Database = nil
		r.Cache = nil
		if r.Port == 0 && r.UpstreamURL != "" {
			if m := regexp.MustCompile(`:(\d+)`).FindStringSubmatch(r.UpstreamURL); len(m) > 1 {
				r.Port, _ = strconv.Atoi(m[1])
			}
		}
		if r.Port == 0 {
			r.Port = 8080
		}
	}

	r.Slug = strings.ToLower(strings.TrimSpace(r.Slug))
	if r.Slug == "" && r.Domain != "" {
		// Derive a slug from the domain, e.g. "api.mycompany.com" -> "api".
		r.Slug = slugSanitizer.ReplaceAllString(strings.Split(r.Domain, ".")[0], "-")
		r.Slug = strings.Trim(r.Slug, "-")
	}
}

// validateCreate returns per-field errors, mirroring what the deploy wizard checks.
func validateCreate(r *createWebsiteRequest) map[string]string {
	fields := map[string]string{}

	if !validate.Slug(r.Slug) {
		fields["slug"] = "use 2–40 lowercase letters, digits and inner dashes"
	}
	if !validate.FQDN(r.Domain) {
		fields["domain"] = "enter a valid domain, for example app.example.com"
	}
	if !validate.TenantUser(r.TenantUser) {
		fields["tenantUser"] = "enter a valid tenant account name"
	}
	if !validate.Runtime(r.Runtime) {
		fields["runtime"] = "unsupported runtime"
	}
	// A static site and a reverse proxy run no runtime, so there is no version to pick:
	// requiring one would refuse the two site types that have none.
	if r.Version == "" && !validate.Versionless(r.Runtime) {
		fields["version"] = "select a runtime version"
	}
	if !validate.WebServer(r.WebServer) {
		fields["webServer"] = "unsupported web server"
	}
	if r.Port < 1 || r.Port > 65535 {
		fields["port"] = "use a port between 1 and 65535 (or leave it empty to use the runtime default)"
	}
	if !validate.SourceKind(r.Source.Kind) {
		fields["source"] = "choose how the code is provided"
	}
	if r.Source.Kind == "github" && r.Source.Repo == "" {
		fields["source.repo"] = "a repository URL is required"
	}
	if r.Database != nil && !validate.Engine(r.Database.Engine) {
		fields["database.engine"] = "unsupported database engine"
	}
	if r.Cache != nil && !validate.Engine(r.Cache.Engine) {
		fields["cache.engine"] = "unsupported cache engine"
	}
	return fields
}

func validationResponse(fields map[string]string, message string) map[string]any {
	return map[string]any{
		"error":  apiError{Code: "validation_error", Message: message},
		"fields": fields,
	}
}

// handleCreateWebsite accepts the deploy wizard payload, records the website and
// returns 202 with a deploy id. Provisioning runs in the background.
func (s *Server) handleCreateWebsite(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req createWebsiteRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	req.normalize()
	if req.Port == 0 {
		req.Port = provision.DefaultPort(req.Runtime)
	}

	if fields := validateCreate(&req); len(fields) > 0 {
		writeJSON(w, http.StatusBadRequest, validationResponse(fields, "The deployment plan is not valid"))
		return
	}
	if _, err := s.store.WebsiteBySlug(req.Slug); err == nil {
		writeJSON(w, http.StatusConflict, validationResponse(
			map[string]string{"slug": "this website name is already in use"},
			"A website with this name already exists"))
		return
	}
	if dom, err := s.store.GetDomainByName(req.Domain); err == nil && dom != nil {
		writeJSON(w, http.StatusConflict, validationResponse(
			map[string]string{"domain": fmt.Sprintf("domain '%s' is already in use by website '%s'", req.Domain, dom.WebsiteSlug)},
			"This domain is already in use by another website"))
		return
	}
	if existing, err := s.store.WebsiteByDomain(req.Domain); err == nil && existing != nil {
		writeJSON(w, http.StatusConflict, validationResponse(
			map[string]string{"domain": fmt.Sprintf("domain '%s' is already registered for website '%s'", req.Domain, existing.Slug)},
			"This domain is already in use by another website"))
		return
	}
	// Only admins deploy for another tenant.
	if user.Role != "admin" && user.Username != req.TenantUser {
		writeError(w, http.StatusForbidden, "forbidden", "You can only deploy inside your own account")
		return
	}
	// The owner must be a real panel account: an owner string that names nobody is how
	// a website ends up belonging to no one.
	if _, err := s.store.UserByUsername(req.TenantUser); err != nil {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"tenantUser": "no panel account is named " + req.TenantUser},
			"The owner account does not exist"))
		return
	}
	// Web server engine selection: supports all 4 engines (nginx, caddy, apache, openlitespeed).
	// If omitted, defaults to host's active edge ingress engine.
	if req.WebServer == "" {
		req.WebServer = s.deploy.ActiveEngine()
	}
	if !webserver.Supported(req.WebServer) {
		writeError(w, http.StatusBadRequest, "unsupported_web_server",
			req.WebServer+" is not supported — choose nginx, caddy, apache, or openlitespeed")
		return
	}
	if !webserver.Available(req.WebServer, s.lookPath) {
		writeError(w, http.StatusConflict, "engine_not_installed", req.WebServer+" is not installed — "+webserver.InstallHint(req.WebServer))
		return
	}
	// Package guard: the tenant's group may cap how many websites it can own.
	if limits := s.limitsForTenant(req.TenantUser); limits.MaxSites > 0 {
		count, err := s.store.CountWebsitesByTenant(req.TenantUser)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not check the package limits")
			return
		}
		if count >= limits.MaxSites {
			writeJSON(w, http.StatusConflict, map[string]any{
				"error": apiError{Code: "quota_exceeded", Message: fmt.Sprintf(
					"this account may own at most %d websites and it already has %d — the package limit for this account has been reached",
					limits.MaxSites, count)},
				"quota": map[string]int{"maxSites": limits.MaxSites, "usedSites": count},
			})
			return
		}
	}
	if req.Source.Kind == "existing" && !s.host.SiteExists(req.TenantUser, req.Slug) {
		writeJSON(w, http.StatusConflict, validationResponse(
			map[string]string{"source": "the target directory does not exist yet"},
			"No directory found for this website"))
		return
	}

	site := &store.Website{
		Slug:         req.Slug,
		Domain:       req.Domain,
		TenantUser:   req.TenantUser,
		Runtime:      req.Runtime,
		Version:      req.Version,
		Framework:    req.Framework,
		WebServer:    req.WebServer,
		Status:       "stopped",
		DeployStatus: "pending",
		SSL:          req.SSL,
		TunnelEnable: req.TunnelEnabled,
		Port:         req.Port,
		UpstreamURL:  req.UpstreamURL,
		SourceKind:   req.Source.Kind,
		SourceRepo:   req.Source.Repo,
		SourceBranch: req.Source.Branch,
		DeployScript: req.DeployScript,
	}
	if err := s.store.CreateWebsite(site); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not record the website")
		return
	}

	if req.Runtime == "proxy" {
		cfg := map[string]any{
			"upstreamUrl":  req.UpstreamURL,
			"websocket":    req.ProxyWebsocket,
			"preserveHost": req.ProxyPreserveHost,
			"realIp":       req.ProxyRealIP,
			"timeout":      req.ProxyTimeoutSecs,
		}
		if data, err := json.Marshal(cfg); err == nil {
			_ = s.store.SavePanelSetting("site_runtime_config:"+req.Slug, string(data))
		}
	}

	if req.TunnelEnabled {
		s.ensureWebsiteTunnelRoute(r.Context(), req.TenantUser, req.Domain, req.Slug)
	}

	job, err := s.deploy.Start(deploy.Request{
		Slug:             req.Slug,
		Tenant:           req.TenantUser,
		Domain:           req.Domain,
		Runtime:          req.Runtime,
		Version:          req.Version,
		Framework:        req.Framework,
		FrameworkVersion: req.FrameworkVersion,
		WebServer:        req.WebServer,
		Port:             req.Port,
		UpstreamURL:      req.UpstreamURL,
		SSL:              req.SSL,
		TunnelEnabled:    req.TunnelEnabled,
		Source:           deploy.SourceSpec{Kind: req.Source.Kind, Repo: req.Source.Repo, Branch: req.Source.Branch},
		Database:         toDatabaseSpec(req.Database),
		Cache:            toCacheSpec(req.Cache),
		Automation:       req.AutomationSteps,
		BuildScript:      req.DeployScript,
		Env:              req.Env,
	})
	if err != nil {
		_ = s.store.SetWebsiteRuntimeState(req.Slug, "error", "failed")
		writeError(w, http.StatusInternalServerError, "internal", "Could not start the deployment")
		return
	}
	_ = s.store.Audit(user.ID, "website.deploy_start", req.Slug, clientIP(r), "job="+job.ID)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"slug":       req.Slug,
		"deployId":   job.ID,
		"mode":       job.Mode,
		"status":     job.Status,
		"totalSteps": job.TotalSteps,
		"stream":     "/api/v1/websites/" + req.Slug + "/deploy/stream?id=" + job.ID,
	})
}

func toDatabaseSpec(p *databasePayload) *deploy.DatabaseSpec {
	if p == nil {
		return nil
	}
	return &deploy.DatabaseSpec{Engine: p.Engine, Version: p.Version, Name: p.Name}
}

func toCacheSpec(p *cachePayload) *deploy.CacheSpec {
	if p == nil {
		return nil
	}
	return &deploy.CacheSpec{Engine: p.Engine, Version: p.Version}
}

// handleDeployJob returns a job plus its log lines after ?after=<id>.
func (s *Server) handleDeployJob(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	job, ok := s.resolveDeployJob(w, r)
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	logs, err := s.store.DeployLogs(job.ID, after)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the deploy log")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": job, "log": logs})
}

// handleLatestDeploy returns the most recent job of a website.
func (s *Server) handleLatestDeploy(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	job, err := s.store.LatestDeployJob(slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No deployment has run for this website")
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *Server) resolveDeployJob(w http.ResponseWriter, r *http.Request) (*store.DeployJob, bool) {
	slug := r.PathValue("slug")
	id := r.PathValue("id")
	var (
		job *store.DeployJob
		err error
	)
	if id == "" || id == "latest" {
		job, err = s.store.LatestDeployJob(slug)
	} else {
		job, err = s.store.DeployJob(id)
	}
	if err != nil || job.Slug != slug {
		writeError(w, http.StatusNotFound, "not_found", "Deployment not found")
		return nil, false
	}
	return job, true
}

// handleDeployStream replays the persisted log and then follows it over SSE.
// Because every line is stored, a dropped connection loses nothing.
func (s *Server) handleDeployStream(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	job, ok := s.resolveDeployJob(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "internal", "Streaming is not supported")
		return
	}

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	var last int64
	for {
		logs, err := s.store.DeployLogs(job.ID, last)
		if err != nil {
			break
		}
		for _, l := range logs {
			last = l.ID
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", jsonLine(l))
		}
		if len(logs) > 0 {
			flusher.Flush()
		}

		current, err := s.store.DeployJob(job.ID)
		if err != nil {
			break
		}
		if isTerminal(current.Status) && len(logs) == 0 {
			fmt.Fprintf(w, "event: done\ndata: %s\n\n", jsonLine(current))
			flusher.Flush()
			return
		}

		select {
		case <-r.Context().Done():
			return
		case <-time.After(400 * time.Millisecond):
		}
	}
}

func isTerminal(status string) bool { return status == "success" || status == "failed" }

func jsonLine(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return `{"error":"encode failed"}`
	}
	return string(b)
}

// handleWebsiteAction starts, stops or restarts a website's service.
func (s *Server) handleWebsiteAction(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session, action string) {
	slug := r.PathValue("slug")

	site, err := s.store.WebsiteBySlug(slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	if user.Role != "admin" && user.Username != site.TenantUser {
		writeError(w, http.StatusForbidden, "forbidden", "You can only manage your own websites")
		return
	}
	// A suspended owner's website stays down: starting it would make the suspension
	// cosmetic. The account has to be activated first.
	if action == "start" || action == "restart" {
		if owner, err := s.store.UserByUsername(site.TenantUser); err == nil && owner.Status != "active" {
			writeError(w, http.StatusConflict, "owner_suspended",
				"The owner account is suspended; activate it before starting this website")
			return
		}
	}

	var out string
	var runErr error
	if site.Runtime != "proxy" {
		out, runErr = s.host.ServiceAction(r.Context(), action, slug)
		if runErr != nil && s.host.Materialises() {
			writeError(w, http.StatusBadGateway, "service_error",
				fmt.Sprintf("systemctl %s failed: %v (%s)", action, runErr, strings.TrimSpace(out)))
			return
		}
	}

	status := site.Status
	switch action {
	case "start", "restart":
		status = "running"
	case "stop":
		status = "stopped"
	}
	if !s.host.Materialises() {
		status = site.Status
	}
	_ = s.store.SetWebsiteRuntimeState(slug, status, site.DeployStatus)
	_ = s.store.Audit(user.ID, "website."+action, slug, clientIP(r), s.host.Mode())

	writeJSON(w, http.StatusOK, map[string]any{
		"slug":   slug,
		"action": action,
		"status": status,
		"mode":   s.host.Mode(),
		"output": strings.TrimSpace(out),
	})
}

// prepareDirectoryRequest asks the daemon to create a site directory.
type prepareDirectoryRequest struct {
	Slug       string `json:"slug"`
	TenantUser string `json:"tenantUser"`
}

// handlePrepareDirectory creates <sites-root>/<tenant>/apps/<slug>.
//
// Tenants have no shell on the server, so the panel must be able to create the
// folder itself — otherwise "Existing Files" could never be used. The flow is:
// create the directory here, upload the code with the File Manager, then deploy.
func (s *Server) handlePrepareDirectory(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req prepareDirectoryRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}

	slug := strings.ToLower(strings.TrimSpace(req.Slug))
	tenant := strings.ToLower(strings.TrimSpace(req.TenantUser))
	if tenant == "" {
		tenant = user.Username
	}

	fields := map[string]string{}
	if !validate.Slug(slug) {
		fields["slug"] = "use 2–40 lowercase letters, digits and inner dashes"
	}
	if !validate.TenantUser(tenant) {
		fields["tenantUser"] = "enter a valid tenant account name"
	}
	if len(fields) > 0 {
		writeJSON(w, http.StatusBadRequest, validationResponse(fields, "Cannot create the directory"))
		return
	}
	if user.Role != "admin" && user.Username != tenant {
		writeError(w, http.StatusForbidden, "forbidden", "You can only create directories inside your own account")
		return
	}
	if _, err := s.store.UserByUsername(tenant); err != nil {
		writeJSON(w, http.StatusBadRequest, validationResponse(
			map[string]string{"tenantUser": "no panel account is named " + tenant},
			"The owner account does not exist"))
		return
	}
	if _, err := s.store.WebsiteBySlug(slug); err == nil {
		writeJSON(w, http.StatusConflict, validationResponse(
			map[string]string{"slug": "this name is already in use"}, "A website with this name already exists"))
		return
	}

	existed := s.host.SiteExists(tenant, slug)
	path, err := s.host.EnsureSiteDir(r.Context(), tenant, slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not create the directory: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.directory_prepare", tenant+"/"+slug, clientIP(r), s.host.Mode())

	writeJSON(w, http.StatusCreated, map[string]any{
		"slug":       slug,
		"tenantUser": tenant,
		"path":       path,
		"created":    !existed,
		"existed":    existed,
		"mode":       s.host.Mode(),
		"next":       "Upload your code with the File Manager, then deploy.",
	})
}

// handleDeleteWebsite removes a website completely: service, unit, files and
// records. Deploying used to leave the operator to clean up by hand.
func (s *Server) handleDeleteWebsite(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	// A website can own databases, and a SQLite file lives *inside* the site directory that
	// is about to be removed — so deleting the site used to leave a record behind pointing
	// at a file that no longer existed (the "its file is gone" case). The operator now says
	// what should happen to them, and keeping them moves the file out first.
	owned, err := s.store.DatabasesForWebsite(slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read this website's databases")
		return
	}
	choice := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("databases")))
	if len(owned) > 0 && choice == "" {
		names := make([]string, 0, len(owned))
		for i := range owned {
			names = append(names, owned[i].Alias)
		}
		writeError(w, http.StatusConflict, "has_databases", fmt.Sprintf(
			"this website owns %d database(s): %s — deleting it would remove their files. Pass ?databases=keep to keep them (a SQLite file is moved out of the site first) or ?databases=delete to delete them with the website",
			len(owned), strings.Join(names, ", ")))
		return
	}
	switch choice {
	case "keep":
		for i := range owned {
			if err := s.detachDatabase(r.Context(), &owned[i]); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", "Could not keep the database: "+err.Error())
				return
			}
		}
	case "delete":
		for i := range owned {
			if err := s.purgeDatabase(r.Context(), &owned[i]); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", "Could not delete the database: "+err.Error())
				return
			}
			_ = s.store.Audit(user.ID, "database.purge", owned[i].Name, clientIP(r), owned[i].Engine+" (with website "+slug+")")
		}
		// Also clean up any un-tracked matching daemon databases created for this website
		if s.host.Materialises() {
			for _, candidate := range []string{site.TenantUser + "_" + slug + "_db", site.TenantUser + "_" + slug} {
				mysqlCleanup := fmt.Sprintf(
					"DROP DATABASE IF EXISTS `%s`; DROP USER IF EXISTS '%s'@'localhost'; DROP USER IF EXISTS '%s'@'127.0.0.1'; FLUSH PRIVILEGES;",
					candidate, candidate, candidate,
				)
				_, _ = s.host.Run(r.Context(), []string{"mysql", "-e", mysqlCleanup})
				psqlCleanup := fmt.Sprintf("DROP DATABASE IF EXISTS %q WITH (FORCE); DROP ROLE IF EXISTS %q;", candidate, candidate)
				_, _ = s.host.Run(r.Context(), []string{"sudo", "-u", "postgres", "psql", "-c", psqlCleanup})
			}
		}
	case "":
		// nothing owned, nothing to decide
	default:
		writeError(w, http.StatusBadRequest, "validation_error", "databases must be keep or delete")
		return
	}

	// The website's Cloudflare Tunnel routes go with it — removed in Cloudflare too, not just locally.
	s.purgeCloudflareRoutes(r.Context(), site.TenantUser, slug)

	steps, err := s.deploy.Teardown(r.Context(), slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Teardown failed: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.delete", slug, clientIP(r), strings.Join(steps, "; "))

	writeJSON(w, http.StatusOK, map[string]any{"slug": slug, "steps": steps, "mode": s.host.Mode()})
}

// detachDatabase keeps a record alive without the website it lived in: the link is
// cleared, and a file-based database's file is moved out of the site first, because
// deleting the site would take it with it (which is how a record ended up pointing at a
// file that no longer existed).
func (s *Server) detachDatabase(ctx context.Context, record *store.Database) error {
	if record.FileBased && record.FilePath != "" {
		// The tenant's own home, not the daemon's data directory: the file is theirs, it
		// stays reachable through the panel's File Manager (and by them), and it is where
		// they would look for it. Ownership is handed back after the move so nothing in
		// their home is left root-owned.
		dir := filepath.Join(s.cfg.SitesRoot, record.TenantUser, "detached")
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		if ids := s.tenantIDs(ctx, record.TenantUser); ids != "" {
			if out, err := s.host.Run(ctx, []string{"chown", ids, dir}); err != nil {
				return fmt.Errorf("chown %s: %w (%s)", dir, err, strings.TrimSpace(out))
			}
		}
		target := filepath.Join(dir, filepath.Base(record.FilePath))
		if err := os.Rename(record.FilePath, target); err != nil {
			return err
		}
		if ids := s.tenantIDs(ctx, record.TenantUser); ids != "" {
			if out, err := s.host.Run(ctx, []string{"chown", ids, target}); err != nil {
				return fmt.Errorf("chown %s: %w (%s)", target, err, strings.TrimSpace(out))
			}
		}
		if err := s.store.RenameDatabaseFile(record.ID, target); err != nil {
			return err
		}
	}
	if err := s.store.SetDatabaseWebsite(record.ID, ""); err != nil {
		return err
	}
	// Marked as kept-by-detach, so the Databases screen can show it as its own thing.
	return s.store.MarkDatabaseDetached(record.ID)
}

// handleRedeployWebsite runs the pipeline again for an existing website, using
// the source that was recorded when it was created.
func (s *Server) handleRedeployWebsite(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	if !validate.HasRuntime(site.Runtime) {
		writeError(w, http.StatusConflict, "not_applicable",
			"A reverse proxy has nothing to build or deploy")
		return
	}

	kind := site.SourceKind
	if kind == "" {
		kind = "existing"
	}
	job, err := s.deploy.Start(deploy.Request{
		Slug:          site.Slug,
		Tenant:        site.TenantUser,
		Domain:        site.Domain,
		Runtime:       site.Runtime,
		Version:       site.Version,
		Framework:     site.Framework,
		WebServer:     site.WebServer,
		Port:          site.Port,
		SSL:           site.SSL,
		TunnelEnabled: site.TunnelEnable,
		Source:        deploy.SourceSpec{Kind: kind, Repo: site.SourceRepo, Branch: site.SourceBranch},
		Redeploy:      true,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not start the redeploy")
		return
	}

	if site.TunnelEnable {
		s.ensureWebsiteTunnelRoute(r.Context(), site.TenantUser, site.Domain, site.Slug)
	}
	_ = s.store.Audit(user.ID, "website.redeploy", slug, clientIP(r), "job="+job.ID)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"slug":       site.Slug,
		"deployId":   job.ID,
		"mode":       job.Mode,
		"status":     job.Status,
		"totalSteps": job.TotalSteps,
		"stream":     "/api/v1/websites/" + site.Slug + "/deploy/stream?id=" + job.ID,
	})
}

// handleListSecrets lists the names of a website's stored credentials — never the values.
func (s *Server) handleListSecrets(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	if user.Role != "admin" && user.Username != site.TenantUser {
		writeError(w, http.StatusForbidden, "forbidden", "Not your website")
		return
	}
	stored, err := s.store.ListWebsiteSecrets(slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the credentials")
		return
	}
	names := make([]string, 0, len(stored))
	for name := range stored {
		names = append(names, name)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": names, "encryption": "AES-256-GCM"})
}

// handleRevealSecret decrypts one credential. It requires elevated mode, which is
// granted for 5 minutes after re-entering the panel password.
func (s *Server) handleRevealSecret(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	if !sessionElevated(sess) {
		writeError(w, http.StatusForbidden, "elevation_required",
			"Confirm your panel password again before revealing a credential")
		return
	}
	slug := r.PathValue("slug")
	name := r.PathValue("name")

	ciphertext, err := s.store.WebsiteSecret(slug, name)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Credential not found")
		return
	}
	plain, err := secrets.Decrypt(s.key, ciphertext)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
		return
	}
	_ = s.store.Audit(user.ID, "website.secret_reveal", slug+"/"+name, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{
		"name":      name,
		"value":     plain,
		"expiresIn": 60,
	})
}

type execCommandRequest struct {
	Command string `json:"command"`
}

// handleWebsiteExecCommand runs a framework/artisan/npm/pip command inside the site directory as the tenant.
func (s *Server) handleWebsiteExecCommand(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req execCommandRequest
	if err := decodeJSON(r, &req); err != nil || strings.TrimSpace(req.Command) == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Command is required")
		return
	}

	start := time.Now()
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Minute)
	defer cancel()

	out, err := s.host.RunCronCommand(ctx, site.TenantUser, site.Slug, req.Command)
	duration := time.Since(start)

	ok := err == nil
	if err != nil {
		if out == "" {
			out = err.Error()
		} else {
			out = out + "\n" + err.Error()
		}
	}

	_ = s.store.Audit(user.ID, "website.exec", slug, clientIP(r), "command="+req.Command)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         ok,
		"command":    req.Command,
		"output":     out,
		"durationMs": duration.Milliseconds(),
	})
}

// ensureWebsiteTunnelRoute creates or updates the Cloudflare ingress route for a website if tunnel is enabled.
func (s *Server) ensureWebsiteTunnelRoute(ctx context.Context, tenantUser, domain, slug string) {
	hostname := strings.ToLower(strings.TrimSpace(domain))
	if hostname == "" {
		return
	}
	service := "http://127.0.0.1:80"
	_, err := s.store.CreateCloudflareTunnelRoute(tenantUser, hostname, service, slug)
	if err != nil {
		log.Printf("cloudflare: failed to record tunnel route for %s: %v", hostname, err)
		return
	}
	tunnel, err := s.store.GetCloudflareTunnel(tenantUser)
	if err == nil && tunnel != nil && tunnel.ApiToken != "" && tunnel.AccountID != "" && tunnel.TunnelID != "" {
		go func() {
			bgCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			cf := cloudflare.NewClient(tunnel.ApiToken, tunnel.AccountID, tunnel.TunnelID)
			zones, zErr := cf.ListZones(bgCtx)
			if zErr == nil && len(zones) > 0 {
				matched := false
				for _, z := range zones {
					zn := strings.ToLower(z.Name)
					if hostname == zn || strings.HasSuffix(hostname, "."+zn) {
						matched = true
						break
					}
				}
				if !matched {
					log.Printf("cloudflare: skipping tunnel route for %s (domain does not belong to any zone in Cloudflare account)", hostname)
					_ = s.store.DeleteCloudflareTunnelRoute(tenantUser, hostname)
					return
				}
			}
			if err := cf.AddIngressRule(bgCtx, hostname, service, false); err != nil {
				log.Printf("cloudflare: auto-sync tunnel route failed for %s: %v", hostname, err)
			}
		}()
	}
}

// reconcileWebsiteTunnelRoutes ensures all active websites with tunnel enabled have an ingress route recorded.
func (s *Server) reconcileWebsiteTunnelRoutes() {
	sites, err := s.store.ListWebsites()
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, site := range sites {
		if site.TunnelEnable && site.Domain != "" {
			s.ensureWebsiteTunnelRoute(ctx, site.TenantUser, site.Domain, site.Slug)
		}
	}
}
