package api

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// handleStackStatus reports the host-level platform choices and what is really
// installed — the screen shows the truth, not a stored wish.
func (s *Server) handleStackStatus(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	force := r.URL.Query().Get("refresh") == "true" || r.URL.Query().Get("refresh") == "1"
	status := stack.DetectCached(r.Context(), s.store, s.host, s.lookPath, force)
	// So "nothing is running" is never a guess: the screen can name what holds the queue.
	status.InstallRunning, status.ActiveJobID = s.installs.Running()
	writeJSON(w, http.StatusOK, status)
}

// handleStackInstall runs an allowlisted install as a job with a live log.
func (s *Server) handleStackInstall(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Component string `json:"component"`
		Version   string `json:"version"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	job, err := s.installs.Start(req.Component, req.Version)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "stack.install", req.Component+" "+req.Version, clientIP(r), job.ID)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"jobId":      job.ID,
		"component":  req.Component,
		"version":    req.Version,
		"status":     job.Status,
		"totalSteps": job.TotalSteps,
		"mode":       job.Mode,
		"stream":     "/api/v1/system/stack/jobs/stream?id=" + job.ID,
	})
}

// stackJob resolves an install job by id (no website is involved).
func (s *Server) stackJob(w http.ResponseWriter, r *http.Request) (*store.DeployJob, bool) {
	job, err := s.store.DeployJob(r.PathValue("id"))
	if err != nil || job.Slug != stack.JobSlug {
		writeError(w, http.StatusNotFound, "not_found", "Install job not found")
		return nil, false
	}
	return job, true
}

func (s *Server) handleStackJob(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	job, ok := s.stackJob(w, r)
	if !ok {
		return
	}
	after, _ := strconv.ParseInt(r.URL.Query().Get("after"), 10, 64)
	logs, err := s.store.DeployLogs(job.ID, after)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the install log")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"job": job, "log": logs})
}

// handleStackJobStream replays an install job's log and follows it over SSE, exactly
// as a deploy does — every line is persisted, so a reconnect loses nothing.
func (s *Server) handleStackJobStream(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	id := r.URL.Query().Get("id")
	job, err := s.store.DeployJob(id)
	if err != nil || job.Slug != stack.JobSlug {
		writeError(w, http.StatusNotFound, "not_found", "Install job not found")
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

// regrantFor puts every site back in the hands of the engine that is still serving
// them, after a switch failed part-way.
func regrantFor(ctx context.Context, s *Server, sites []store.Website, engine string) {
	for _, site := range sites {
		home := filepath.Join(s.host.SitesRoot, site.TenantUser)
		siteDir := s.host.SitePath(site.TenantUser, site.Slug)
		_ = webserver.GrantRead(ctx, s.host, home, siteDir, webserver.WebUser(engine))
	}
}

// handleSetWebServer switches the host's ingress: every site's vhost is rewritten for
// the new engine, validated once, and only then are the services swapped — so a bad
// configuration cannot take the port down.
func (s *Server) handleSetWebServer(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Engine string `json:"engine"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	engine := strings.ToLower(strings.TrimSpace(req.Engine))
	if !webserver.Supported(engine) {
		writeError(w, http.StatusNotImplemented, "not_supported_yet", engine+" is not supported yet — choose nginx or caddy")
		return
	}
	if !webserver.Available(engine, s.lookPath) {
		writeError(w, http.StatusConflict, "engine_not_installed", engine+" is not installed — "+webserver.InstallHint(engine))
		return
	}
	previous := s.deploy.ActiveEngine()
	if engine == previous {
		writeJSON(w, http.StatusOK, stack.Detect(r.Context(), s.store, s.host, s.lookPath))
		return
	}

	sites, err := s.store.ListWebsites()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the websites")
		return
	}
	dir := s.host.VhostsFor(engine)

	// Keep what we overwrite, so a failed validation leaves the host as it was.
	type undo struct {
		path    string
		prev    []byte
		existed bool
	}
	var undos []undo
	rollback := func() {
		for _, u := range undos {
			if u.existed {
				_ = os.WriteFile(u.path, u.prev, 0o644)
			} else {
				_ = os.Remove(u.path)
			}
		}
	}

	for _, site := range sites {
		siteDir := s.host.SitePath(site.TenantUser, site.Slug)
		spec := webserver.SpecFor(site.Slug, site.Domain, site.Runtime, siteDir, site.Port)
		path := webserver.Path(engine, dir, site.Slug)
		prev, readErr := os.ReadFile(path)
		undos = append(undos, undo{path: path, prev: prev, existed: readErr == nil})
		if _, err := webserver.Write(engine, dir, spec); err != nil {
			rollback()
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
	}
	if _, err := webserver.WriteDefault(engine, dir); err != nil {
		rollback()
		writeError(w, http.StatusInternalServerError, "internal", err.Error())
		return
	}
	if err := webserver.Test(r.Context(), engine, s.host); err != nil {
		rollback()
		writeError(w, http.StatusBadGateway, "service_error", err.Error())
		return
	}
	// Only now that the configuration is known-good do the sites change hands: granting
	// read before validating is what left a site owned by the wrong web user when the
	// validation failed.
	for _, site := range sites {
		home := filepath.Join(s.host.SitesRoot, site.TenantUser)
		siteDir := s.host.SitePath(site.TenantUser, site.Slug)
		if err := webserver.GrantRead(r.Context(), s.host, home, siteDir, webserver.WebUser(engine)); err != nil {
			regrantFor(r.Context(), s, sites, previous)
			rollback()
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
	}
	// Swap the ingress. Stop the previous edge ingress so port 80/443 is freed:
	if _, err := s.host.Run(r.Context(), []string{"systemctl", "stop", previous}); err != nil && s.host.Materialises() {
		regrantFor(r.Context(), s, sites, previous)
		rollback()
		writeError(w, http.StatusBadGateway, "service_error", "could not stop "+previous)
		return
	}

	if engine == "caddy" {
		// Nginx moves to internal backend port 127.0.0.1:8082 so it never collides with Caddy on :80/:443
		reconfigNginx := "sed -i 's/listen [0-9.]*:80;/listen 127.0.0.1:8082;/g; s/listen 80 /listen 127.0.0.1:8082 /g; s/listen 80;/listen 127.0.0.1:8082;/g; s/listen \\[::\\]:80;/listen [::1]:8082;/g; s/listen \\[::1\\]:80;/listen [::1]:8082;/g' /etc/nginx/sites-enabled/*.conf /etc/nginx/conf.d/*.conf 2>/dev/null || true"
		_, _ = s.host.Run(r.Context(), []string{"bash", "-c", reconfigNginx})
		cleanCaddyPort := "sed -i '/http_port 8081/d' /etc/caddy/Caddyfile 2>/dev/null || true; sed -i '/{\\s*}/d' /etc/caddy/Caddyfile 2>/dev/null || true"
		_, _ = s.host.Run(r.Context(), []string{"bash", "-c", cleanCaddyPort})
	} else if engine == "nginx" {
		// Nginx takes edge ingress on :80 and :443
		reconfigNginx := "sed -i 's/listen 127.0.0.1:8082;/listen 80;/g; s/listen 127.0.0.1:8082 default_server;/listen 80 default_server;/g; s/listen \\[::1\\]:8082;/listen [::]:80;/g; s/listen \\[::1\\]:8082 default_server;/listen [::]:80 default_server;/g' /etc/nginx/sites-enabled/*.conf /etc/nginx/conf.d/*.conf 2>/dev/null || true"
		_, _ = s.host.Run(r.Context(), []string{"bash", "-c", reconfigNginx})
		// Caddy moves to internal backend port 8081
		caddyPortCmd := "if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'http_port' /etc/caddy/Caddyfile; then sed -i '1s/^/{\\n    http_port 8081\\n}\\n/' /etc/caddy/Caddyfile 2>/dev/null || true; fi"
		_, _ = s.host.Run(r.Context(), []string{"bash", "-c", caddyPortCmd})
	}

	// Start the new edge ingress engine
	if out, err := s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", engine}); err != nil && s.host.Materialises() {
		_, _ = s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", previous})
		regrantFor(r.Context(), s, sites, previous)
		rollback()
		writeError(w, http.StatusBadGateway, "service_error", engine+" did not start: "+strings.TrimSpace(out))
		return
	}

	// Bring the standby engine (nginx or caddy) back up on its internal port
	if engine == "caddy" {
		_, _ = s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", "nginx"})
	} else if engine == "nginx" {
		_, _ = s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", "caddy"})
	}

	// Ensure all backend engines remain active and enabled
	_, _ = s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", "apache2"})
	_, _ = s.host.Run(r.Context(), []string{"systemctl", "enable", "--now", "lshttpd"})
	if err := webserver.Reload(r.Context(), engine, s.host); err != nil && s.host.Materialises() {
		// The engine started, so the config it read is the one we wrote; a reload failing
		// here is not fatal, and saying so beats pretending.
		_ = s.store.Audit(user.ID, "stack.web_server_reload_failed", engine, clientIP(r), err.Error())
	}

	if err := s.store.SavePanelSetting("active_web_server", engine); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not record the choice")
		return
	}
	_ = s.store.Audit(user.ID, "stack.web_server", engine, clientIP(r), "was "+previous)

	stack.InvalidateCache()
	writeJSON(w, http.StatusOK, stack.DetectCached(r.Context(), s.store, s.host, s.lookPath, true))
}
