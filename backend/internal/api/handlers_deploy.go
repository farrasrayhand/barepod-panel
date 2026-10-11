package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/provision"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
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
	Slug             string           `json:"slug"`
	Domain           string           `json:"domain"`
	TenantUser       string           `json:"tenantUser"`
	Runtime          string           `json:"runtime"`
	Version          string           `json:"version"`
	Framework        string           `json:"framework"`
	FrameworkVersion string           `json:"frameworkVersion"`
	WebServer        string           `json:"webServer"`
	Port             int              `json:"port"`
	SSL              bool             `json:"ssl"`
	TunnelEnabled    bool             `json:"tunnelEnabled"`
	Source           sourcePayload    `json:"source"`
	Database         *databasePayload `json:"database"`
	Cache            *cachePayload    `json:"cache"`
	AutomationSteps  []string         `json:"automationSteps"`
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
			map[string]string{"slug": "this name is already in use"},
			"A website with this name already exists"))
		return
	}
	// Only admins deploy for another tenant.
	if user.Role != "admin" && user.Username != req.TenantUser {
		writeError(w, http.StatusForbidden, "forbidden", "You can only deploy inside your own account")
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
			writeJSON(w, http.StatusConflict, validationResponse(
				map[string]string{"slug": fmt.Sprintf("this account may own at most %d websites", limits.MaxSites)},
				"The package limit for this account has been reached"))
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
		SourceKind:   req.Source.Kind,
		SourceRepo:   req.Source.Repo,
		SourceBranch: req.Source.Branch,
	}
	if err := s.store.CreateWebsite(site); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not record the website")
		return
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
		SSL:              req.SSL,
		TunnelEnabled:    req.TunnelEnabled,
		Source:           deploy.SourceSpec{Kind: req.Source.Kind, Repo: req.Source.Repo, Branch: req.Source.Branch},
		Database:         toDatabaseSpec(req.Database),
		Cache:            toCacheSpec(req.Cache),
		Automation:       req.AutomationSteps,
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

	out, runErr := s.host.ServiceAction(r.Context(), action, slug)
	if runErr != nil && s.host.Materialises() {
		writeError(w, http.StatusBadGateway, "service_error",
			fmt.Sprintf("systemctl %s failed: %v (%s)", action, runErr, strings.TrimSpace(out)))
		return
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

	steps, err := s.deploy.Teardown(r.Context(), slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Teardown failed: "+err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "website.delete", slug, clientIP(r), strings.Join(steps, "; "))

	writeJSON(w, http.StatusOK, map[string]any{"slug": slug, "steps": steps, "mode": s.host.Mode()})
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
