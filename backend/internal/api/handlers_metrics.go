package api

import (
	"net/http"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handleSystemMetrics returns the host time series. Numbers are raw (bytes,
// percent, per-second rates) and the frontend formats them.
//
//	GET /system/metrics?range=1h        → latest + samples
//	GET /system/metrics?live=1          → only the latest sample
func (s *Server) handleSystemMetrics(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	if s.metrics == nil {
		writeError(w, http.StatusServiceUnavailable, "metrics_unavailable", "Metrics collection is not running")
		return
	}

	rangeKey := r.URL.Query().Get("range")
	window := metrics.ParseRange(rangeKey, time.Hour)
	latest := s.metrics.Latest()

	samples := []metrics.Snapshot{}
	if r.URL.Query().Get("live") != "1" {
		samples = s.metrics.Range(time.Now().Add(-window))
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"latest":          latest,
		"items":           samples,
		"range":           rangeKey,
		"windowSeconds":   int(window.Seconds()),
		"intervalSeconds": int(s.metrics.Interval().Seconds()),
		"buffered":        s.metrics.Count(),
		"maxRangeSeconds": int(s.metrics.MaxRange().Seconds()),
		"source":          s.metrics.Collector().Mode(),
		"checkedAt":       time.Now().UTC().Format(time.RFC3339),
	})
}

// handleWebsiteMetrics returns one website's service usage (cgroup v2).
func (s *Server) handleWebsiteMetrics(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	if s.siteMetrics == nil {
		writeError(w, http.StatusServiceUnavailable, "metrics_unavailable", "Metrics collection is not running")
		return
	}
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	rangeKey := r.URL.Query().Get("range")
	window := metrics.ParseRange(rangeKey, time.Hour)

	// Refresh on demand so opening the page does not wait for the next tick.
	latest := s.siteMetrics.Collect(slug, s.metrics.Interval())

	writeJSON(w, http.StatusOK, map[string]any{
		"latest":          latest,
		"items":           s.siteMetrics.Range(slug, time.Now().Add(-window)),
		"range":           rangeKey,
		"windowSeconds":   int(window.Seconds()),
		"intervalSeconds": int(s.metrics.Interval().Seconds()),
		"site":            site.Slug,
		"unit":            metrics.UnitName(site.Slug),
		"checkedAt":       time.Now().UTC().Format(time.RFC3339),
	})
}
