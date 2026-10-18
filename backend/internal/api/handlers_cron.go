package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/scheduler"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// The built-in maintenance jobs used to be a hardcoded list returned verbatim, and nothing executed
// them. They now live in internal/scheduler (the registry) backed by the system_cron_jobs table, and
// the panel reads their real state through systemCronJobViews.

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

	systemJobs, err := s.systemCronJobViews()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"systemJobs":  systemJobs,
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
	// The schedule is stored and later matched by the daemon's own cron matcher, so a spec it cannot
	// parse would be accepted here and then silently never fire. Reject it at the door instead.
	if _, err := scheduler.Parse(req.Schedule); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_schedule", "not a valid cron expression: "+err.Error())
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
		if _, err := scheduler.Parse(req.Schedule); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_schedule", "not a valid cron expression: "+err.Error())
			return
		}
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
