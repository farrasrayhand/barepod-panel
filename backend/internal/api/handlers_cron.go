package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// SystemCronJobItem represents a built-in server level maintenance schedule.
type SystemCronJobItem struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Desc     string `json:"desc"`
	Schedule string `json:"schedule"`
	Enabled  bool   `json:"enabled"`
	Category string `json:"category"`
}

var defaultSystemCronJobs = []SystemCronJobItem{
	{ID: "metrics_prune", Label: "Metrics & log retention prune", Desc: "Trim time-series metrics and rotated logs past retention.", Schedule: "0 3 * * *", Enabled: true, Category: "maintenance"},
	{ID: "system_junk", Label: "System junk cleanup", Desc: "Clear /tmp, orphan build artifacts, and expired snapshots.", Schedule: "0 4 * * *", Enabled: true, Category: "maintenance"},
	{ID: "docker_prune", Label: "Docker system prune", Desc: "Dangling images, stopped containers, and build cache.", Schedule: "30 4 * * *", Enabled: true, Category: "docker"},
	{ID: "ssl_renew", Label: "SSL certificate renewal", Desc: "Renew Let's Encrypt / Caddy certificates before expiry.", Schedule: "0 0,12 * * *", Enabled: true, Category: "security"},
	{ID: "security_updates", Label: "Security OS updates", Desc: "Unattended security upgrades (apt unattended-upgrades).", Schedule: "0 5 * * *", Enabled: true, Category: "security"},
	{ID: "logrotate", Label: "Log rotation", Desc: "Rotate and compress service logs.", Schedule: "0 2 * * *", Enabled: true, Category: "system"},
	{ID: "db_maintenance", Label: "Database maintenance", Desc: "PostgreSQL VACUUM ANALYZE & MariaDB table optimize.", Schedule: "0 3 * * 0", Enabled: true, Category: "database"},
	{ID: "fstrim", Label: "SSD TRIM (fstrim)", Desc: "Discard unused blocks to keep NVMe/SSD performance.", Schedule: "0 2 * * 0", Enabled: true, Category: "system"},
	{ID: "service_watchdog", Label: "Service watchdog", Desc: "Restart nginx/caddy/php-fpm/docker/cloudflared if down.", Schedule: "*/5 * * * *", Enabled: true, Category: "watchdog"},
}

// handleListCronJobs returns both system-level cron jobs and website-level scheduled tasks.
func (s *Server) handleListCronJobs(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	siteSlug := strings.TrimSpace(r.URL.Query().Get("websiteSlug"))

	var sites []store.Website
	var err error
	if user.Role == "admin" {
		sites, err = s.store.ListWebsites()
	} else {
		sites, err = s.store.ListWebsitesByTenant(user.Username)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not query websites")
		return
	}

	var allWebsiteJobs []store.WebsiteCronJob
	for _, site := range sites {
		if siteSlug != "" && site.Slug != siteSlug {
			continue
		}
		jobs, err := s.store.ListWebsiteCronJobs(site.Slug)
		if err == nil {
			allWebsiteJobs = append(allWebsiteJobs, jobs...)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"systemJobs":  defaultSystemCronJobs,
		"websiteJobs": allWebsiteJobs,
	})
}

type createCronJobRequest struct {
	WebsiteSlug string `json:"websiteSlug"`
	Name        string `json:"name"`
	Schedule    string `json:"schedule"`
	Command     string `json:"command"`
	Enabled     *bool  `json:"enabled"`
	TimeoutSec  int    `json:"timeoutSec"`
}

// handleCreateCronJob creates a new scheduled task for a website.
func (s *Server) handleCreateCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req createCronJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	req.WebsiteSlug = strings.TrimSpace(req.WebsiteSlug)
	req.Name = strings.TrimSpace(req.Name)
	req.Schedule = strings.TrimSpace(req.Schedule)
	req.Command = strings.TrimSpace(req.Command)

	if req.WebsiteSlug == "" || req.Name == "" || req.Schedule == "" || req.Command == "" {
		writeError(w, http.StatusBadRequest, "missing_fields", "websiteSlug, name, schedule, and command are required")
		return
	}

	site, err := s.store.WebsiteBySlug(req.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	if req.TimeoutSec <= 0 {
		req.TimeoutSec = 300
	}

	job := &store.WebsiteCronJob{
		WebsiteSlug: site.Slug,
		Name:        req.Name,
		Schedule:    req.Schedule,
		Command:     req.Command,
		Enabled:     enabled,
		TimeoutSec:  req.TimeoutSec,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	if err := s.store.CreateWebsiteCronJob(job); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not create cron job: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "cron.create", job.ID, clientIP(r), "site="+site.Slug+", cmd="+job.Command)
	writeJSON(w, http.StatusCreated, job)
}

// handleUpdateCronJob updates a scheduled task.
func (s *Server) handleUpdateCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	job, err := s.store.WebsiteCronJobByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Cron job not found")
		return
	}

	site, err := s.store.WebsiteBySlug(job.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req createCronJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	if req.Name != "" {
		job.Name = strings.TrimSpace(req.Name)
	}
	if req.Schedule != "" {
		job.Schedule = strings.TrimSpace(req.Schedule)
	}
	if req.Command != "" {
		job.Command = strings.TrimSpace(req.Command)
	}
	if req.Enabled != nil {
		job.Enabled = *req.Enabled
	}
	if req.TimeoutSec > 0 {
		job.TimeoutSec = req.TimeoutSec
	}

	if err := s.store.UpdateWebsiteCronJob(job); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not update cron job: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "cron.update", job.ID, clientIP(r), "")
	writeJSON(w, http.StatusOK, job)
}

// handleDeleteCronJob removes a scheduled task.
func (s *Server) handleDeleteCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	job, err := s.store.WebsiteCronJobByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Cron job not found")
		return
	}

	site, err := s.store.WebsiteBySlug(job.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	if err := s.store.DeleteWebsiteCronJob(site.Slug, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not delete cron job")
		return
	}

	_ = s.store.Audit(user.ID, "cron.delete", id, clientIP(r), "site="+site.Slug)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRunCronJob executes a scheduled task immediately and returns the execution output.
func (s *Server) handleRunCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	job, err := s.store.WebsiteCronJobByID(id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Cron job not found")
		return
	}

	site, err := s.store.WebsiteBySlug(job.WebsiteSlug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	start := time.Now()
	out, err := s.host.RunCronCommand(r.Context(), site.TenantUser, site.Slug, job.Command)
	duration := time.Since(start)

	status := "success"
	if err != nil {
		status = "failed"
		if out == "" {
			out = err.Error()
		} else {
			out = out + "\n" + err.Error()
		}
	}

	_ = s.store.RecordWebsiteCronRun(job.ID, status, strings.TrimSpace(out))
	_ = s.store.Audit(user.ID, "cron.run", job.ID, clientIP(r), "status="+status)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         status == "success",
		"status":     status,
		"output":     out,
		"durationMs": duration.Milliseconds(),
		"runAt":      time.Now().UTC().Format(time.RFC3339),
	})
}
