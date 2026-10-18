package api

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/scheduler"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

// systemCronJobView is one built-in maintenance job as the panel sees it: the job registry's
// metadata joined with the operator's stored state and the last run.
type systemCronJobView struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Desc        string `json:"desc"`
	Schedule    string `json:"schedule"`
	Enabled     bool   `json:"enabled"`
	Category    string `json:"category"`
	Implemented bool   `json:"implemented"`
	LastRunAt   string `json:"lastRunAt,omitempty"`
	LastStatus  string `json:"lastStatus,omitempty"`
	LastOutput  string `json:"lastOutput,omitempty"`
}

// systemCronJobViews joins the registry with what is stored. A job with no stored row (a fresh
// install, or one whose row has not been seeded yet) is shown with its registry defaults.
func (s *Server) systemCronJobViews() ([]systemCronJobView, error) {
	stored, err := s.store.ListSystemCronJobs()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]store.SystemCronJob, len(stored))
	for _, row := range stored {
		byID[row.ID] = row
	}

	views := make([]systemCronJobView, 0, len(scheduler.Registry()))
	for _, meta := range scheduler.Registry() {
		view := systemCronJobView{
			ID:          meta.ID,
			Label:       meta.Label,
			Desc:        meta.Desc,
			Category:    meta.Category,
			Schedule:    meta.DefaultSchedule,
			Enabled:     meta.DefaultEnabled,
			Implemented: meta.Implemented,
		}
		if row, ok := byID[meta.ID]; ok {
			view.Schedule = row.Schedule
			view.Enabled = row.Enabled
			view.LastRunAt = row.LastRunAt
			view.LastStatus = row.LastStatus
			view.LastOutput = row.LastOutput
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Server) systemCronJobView(id string) (systemCronJobView, error) {
	views, err := s.systemCronJobViews()
	if err != nil {
		return systemCronJobView{}, err
	}
	for _, v := range views {
		if v.ID == id {
			return v, nil
		}
	}
	return systemCronJobView{}, store.ErrNotFound
}

// handleUpdateSystemCronJob changes one built-in job's enabled flag and/or schedule.
func (s *Server) handleUpdateSystemCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	meta, ok := scheduler.Lookup(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "No such maintenance job")
		return
	}

	var body struct {
		Enabled  *bool   `json:"enabled"`
		Schedule *string `json:"schedule"`
	}
	if err := decodeJSON(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "could not read the job")
		return
	}
	if body.Enabled == nil && body.Schedule == nil {
		writeError(w, http.StatusBadRequest, "invalid_body", "nothing to change")
		return
	}

	// Seed the row first so an update always has something to land on, even if the scheduler has
	// not run its seeding pass yet (or the row was removed by hand).
	current, err := s.store.SystemCronJobByID(id)
	if err != nil {
		if seedErr := s.store.EnsureSystemCronJobs([]store.SystemCronJob{{ID: id, Enabled: meta.DefaultEnabled, Schedule: meta.DefaultSchedule}}); seedErr != nil {
			writeError(w, http.StatusInternalServerError, "store_error", seedErr.Error())
			return
		}
		current, err = s.store.SystemCronJobByID(id)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "store_error", err.Error())
			return
		}
	}

	enabled := current.Enabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	schedule := ""
	if body.Schedule != nil {
		spec := strings.TrimSpace(*body.Schedule)
		if _, err := scheduler.Parse(spec); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_schedule", "not a valid cron expression: "+err.Error())
			return
		}
		schedule = spec
	}

	if err := s.store.UpdateSystemCronJob(id, enabled, schedule); err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	effective := current.Schedule
	if schedule != "" {
		effective = schedule
	}
	_ = s.store.Audit(user.ID, "system.cron_update", id, clientIP(r),
		fmt.Sprintf("enabled=%t schedule=%s", enabled, effective))

	view, err := s.systemCronJobView(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "store_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// handleRunSystemCronJob runs one built-in job immediately, the way the website "Run Now" does.
func (s *Server) handleRunSystemCronJob(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	meta, ok := scheduler.Lookup(id)
	if !ok {
		writeError(w, http.StatusNotFound, "not_found", "No such maintenance job")
		return
	}
	if !meta.Implemented {
		writeError(w, http.StatusNotImplemented, "not_implemented",
			meta.Label+" is not implemented by this daemon yet")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	start := time.Now()
	env := scheduler.NewEnv(s.store, s.host, s.key, sysinfo.Detect(), nil)
	out, err := scheduler.RunJob(ctx, env, id)
	status := "success"
	if err != nil {
		status = "failed"
		if out == "" {
			out = err.Error()
		} else {
			out = out + "\n" + err.Error()
		}
	}
	_ = s.store.RecordSystemCronRun(id, status, strings.TrimSpace(out))
	_ = s.store.Audit(user.ID, "system.cron_run", id, clientIP(r), status)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         err == nil,
		"status":     status,
		"output":     out,
		"durationMs": time.Since(start).Milliseconds(),
		"runAt":      time.Now().UTC().Format(time.RFC3339),
	})
}
