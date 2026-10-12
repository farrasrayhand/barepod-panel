package api

import (
	"context"
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
	// The last copy of a runtime is not removable: a host with no PHP, no Rust or no Node
	// cannot run the sites that need one, and — as happened here — removing rustup's
	// default toolchain leaves `rustc` failing for everything.
	installed := s.installedVersions(req.Component)
	if len(installed) == 1 && stack.VersionMatches(installed[0], req.Version) {
		writeError(w, http.StatusConflict, "last_version",
			req.Component+" "+req.Version+" is the only "+req.Component+" on this host — install another version first if you mean to move off it")
		return
	}
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

// handleSetStackDefault records the explicit choice: which version new sites get. An
// install does not decide this any more — it only fills an empty choice.
func (s *Server) handleSetStackDefault(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		Component string `json:"component"`
		Version   string `json:"version"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if err := s.installs.SetDefault(req.Component, req.Version); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	_ = s.store.Audit(user.ID, "stack.default", req.Component+" "+req.Version, clientIP(r), "")
	writeJSON(w, http.StatusOK, stack.Detect(r.Context(), s.store, s.host, s.lookPath))
}

// installedVersions is what the host says it has for a component, read the same way the
// Stack screen reads it.
func (s *Server) installedVersions(component string) []string {
	status := stack.Detect(context.Background(), s.store, s.host, s.lookPath)
	runtime, ok := status.Runtimes[component]
	if !ok {
		return nil
	}
	return runtime.Installed
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
	if component == "nginx" || component == "caddy" {
		if component == s.deploy.ActiveEngine() {
			out = append(out, "the active web server (every site is served by it)")
		}
	}
	return out, nil
}
