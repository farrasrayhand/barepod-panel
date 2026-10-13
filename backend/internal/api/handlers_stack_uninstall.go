package api

import (
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handleStackUninstall removes an installed runtime version, and refuses when a project is
// using it: an uninstall must never be the thing that takes a site down.
func (s *Server) handleStackUninstall(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Component string `json:"component"`
		Version   string `json:"version"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	req.Component = strings.TrimSpace(req.Component)
	req.Version = strings.TrimSpace(req.Version)

	inUse, err := s.stackUsage(req.Component, req.Version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read what uses this version")
		return
	}
	if len(inUse) > 0 {
		writeError(w, http.StatusConflict, "version_in_use",
			req.Component+" "+req.Version+" is used by "+strings.Join(inUse, ", ")+" — move them off it first")
		return
	}
	// The only condition is that nothing uses it. Removing the last copy of a runtime is
	// allowed — an operator who does not want Rust should be able to say so — but it is a
	// removal the screen warns about first, and the log shows what rustup or apt says.
	job, err := s.installs.StartRemoval(req.Component, req.Version)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "stack.uninstall", req.Component+" "+req.Version, clientIP(r), job.ID)
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

// stackUsage names everything that would break if a version went away: the websites whose
// runtime and version match, the databases on that engine, and the ingress.
func (s *Server) stackUsage(component, version string) ([]string, error) {
	var out []string
	if runtime := stack.SiteRuntime(component); runtime != "" {
		sites, err := s.store.ListWebsites()
		if err != nil {
			return nil, err
		}
		for _, site := range sites {
			if site.Runtime == runtime && stack.VersionMatches(site.Version, version) {
				out = append(out, "website "+site.Slug)
			}
		}
	}
	if stack.DatabaseEngine(component) {
		databases, err := s.store.AllDatabases()
		if err != nil {
			return nil, err
		}
		for _, database := range databases {
			if database.Engine == component {
				out = append(out, "database "+database.Alias)
			}
		}
	}
	if component == "nginx" || component == "caddy" || component == "apache" || component == "openlitespeed" {
		if component == s.deploy.ActiveEngine() {
			out = append(out, "the active edge ingress (every site is served by it)")
		}
		sites, err := s.store.ListWebsites()
		if err == nil {
			for _, site := range sites {
				if site.WebServer == component {
					out = append(out, "website "+site.Slug)
				}
			}
		}
	}
	return out, nil
}

// handleStackPlan is the dry run: what a switch or removal would do, and what it would
// touch, without changing anything. An operator can look before they leap — which matters
// most for a database, where the answer may be "this needs a dump first".
func (s *Server) handleStackPlan(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	component := strings.TrimSpace(r.URL.Query().Get("component"))
	version := strings.TrimSpace(r.URL.Query().Get("version"))

	inUse, err := s.stackUsage(component, version)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read what uses this component")
		return
	}
	status := stack.Detect(r.Context(), s.store, s.host, s.lookPath)
	installed := ""
	if runtime, ok := status.Runtimes[component]; ok && len(runtime.Installed) > 0 {
		installed = strings.Join(runtime.Installed, ", ")
	}
	if db, ok := status.DatabaseVersions[component]; ok {
		installed = db
	}

	steps := []string{}
	warnings := []string{}
	if version != "" && version != installed {
		steps = append(steps, "install "+component+" "+version)
	}
	switch {
	case stack.DatabaseEngine(component):
		steps = append(steps, "stop the "+component+" service")
		steps = append(steps, "migrate the existing data to "+version)
		steps = append(steps, "start "+component+" "+version, "verify it answers")
		warnings = append(warnings,
			"a database holds data: the migration copies it, it does not reinstall it")
		if len(inUse) > 0 {
			warnings = append(warnings,
				"take a dump first — "+strings.Join(inUse, ", ")+" would otherwise be at risk")
		}
		if stack.DatabaseEngine(component) && component == "mongodb" {
			steps = append(steps[:0], "pull the image mongo:"+version, "start a container on it", "copy the data across", "point the panel at the new port")
		}
	case component == "nginx" || component == "caddy":
		if component == status.WebServer.Active {
			warnings = append(warnings, "this is the active ingress: every site is served by it during the switch")
		}
	default:
		steps = append(steps, "leave the installed version in place")
	}

	_ = s.store.Audit("", "stack.plan", component+" "+version, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{
		"component": component,
		"version":   version,
		"installed": installed,
		"steps":     steps,
		"uses":      inUse,
		"warnings":  warnings,
		"safeToRun": len(inUse) == 0 && !(component == status.WebServer.Active && version == ""),
		"mode":      s.host.Mode(),
	})
}
