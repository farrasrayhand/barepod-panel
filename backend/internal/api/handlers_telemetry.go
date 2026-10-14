package api

import (
	"net/http"
	"strconv"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/telemetry"
)

// handleWebsiteTelemetry returns the aggregated visitor nodes, request summary, and recent logs for a site.
func (s *Server) handleWebsiteTelemetry(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	limit := 300
	if rawLimit := r.URL.Query().Get("limit"); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil && parsed > 0 && parsed <= 1000 {
			limit = parsed
		}
	}

	svc := s.telemetry
	if svc == nil {
		svc = telemetry.NewService(s.store)
	}

	data, err := svc.GetWebsiteTelemetry(r.Context(), slug, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "telemetry_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, data)
}

// handleWebsiteTelemetryStream streams live access log events using Server-Sent Events (SSE).
func (s *Server) handleWebsiteTelemetryStream(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	svc := s.telemetry
	if svc == nil {
		svc = telemetry.NewService(s.store)
	}

	_ = svc.StreamWebsiteTelemetry(r.Context(), slug, w, r)
}
