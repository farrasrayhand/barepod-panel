package api

import (
	"net/http"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// resolutionFor picks the rollup tier the chart needs: minute rows for a day,
// five-minute rows for a month, and hourly rows beyond that.
func resolutionFor(window time.Duration) string {
	switch {
	case window <= 24*time.Hour:
		return "1m"
	case window <= 31*24*time.Hour:
		return "5m"
	default:
		return "1h"
	}
}

func (s *Server) persistedMaxRange() time.Duration {
	if s.metricsDB == nil {
		return 0
	}
	return 365 * 24 * time.Hour
}

// handleSystemMetrics returns the host time series. The hottest window comes
// from memory; longer windows come from the separate metrics.db rollups, so a
// daemon restart no longer erases everything.
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
	source := "memory"
	resolution := "live"
	if r.URL.Query().Get("live") != "1" {
		samples = s.metrics.Range(time.Now().Add(-window))
		if s.metricsDB != nil && window > s.metrics.MaxRange() {
			resolution = resolutionFor(window)
			if persisted, err := s.metricsDB.QueryHost(resolution, time.Now().Add(-window)); err == nil && len(persisted) > 0 {
				samples = persisted
				source = "sqlite"
			}
		}
	}

	maxRange := s.metrics.MaxRange()
	if persisted := s.persistedMaxRange(); persisted > maxRange {
		maxRange = persisted
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"latest":          latest,
		"items":           samples,
		"range":           rangeKey,
		"resolution":      resolution,
		"storage":         source,
		"windowSeconds":   int(window.Seconds()),
		"intervalSeconds": int(s.metrics.Interval().Seconds()),
		"buffered":        s.metrics.Count(),
		"maxRangeSeconds": int(maxRange.Seconds()),
		"source":          s.metrics.Collector().Mode(),
		"metricsDbBytes":  s.metricsDBSize(),
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

	samples := s.siteMetrics.Range(slug, time.Now().Add(-window))
	source := "memory"
	resolution := "live"
	if s.metricsDB != nil && window > s.metrics.MaxRange() {
		resolution = resolutionFor(window)
		if persisted, err := s.metricsDB.QuerySite(slug, resolution, time.Now().Add(-window)); err == nil && len(persisted) > 0 {
			samples = persisted
			source = "sqlite"
		}
	}

	maxRange := s.metrics.MaxRange()
	if persisted := s.persistedMaxRange(); persisted > maxRange {
		maxRange = persisted
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"latest":          latest,
		"items":           samples,
		"range":           rangeKey,
		"resolution":      resolution,
		"storage":         source,
		"windowSeconds":   int(window.Seconds()),
		"intervalSeconds": int(s.metrics.Interval().Seconds()),
		"maxRangeSeconds": int(maxRange.Seconds()),
		"metricsDbBytes":  s.metricsDBSize(),
		"site":            site.Slug,
		"unit":            metrics.UnitName(site.Slug),
		"checkedAt":       time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) metricsDBSize() int64 {
	if s.metricsDB == nil {
		return 0
	}
	return s.metricsDB.SizeBytes()
}

// handleDaemonMetrics returns the panel process's own RSS, heap, goroutine and
// file-descriptor history. The latest point is read live; older points come
// from the separate metrics.db, so this survives a daemon restart.
//
//	GET /system/metrics/daemon?range=24h
//	GET /system/metrics/daemon?live=1
func (s *Server) handleDaemonMetrics(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	rangeKey := r.URL.Query().Get("range")
	window := metrics.ParseRange(rangeKey, time.Hour)
	latest := metrics.SampleDaemon()

	items := []metrics.DaemonSnapshot{}
	storage := "none"
	maxRange := time.Duration(0)
	resolution := resolutionFor(window)
	if s.metricsDB != nil {
		maxRange = s.persistedMaxRange()
		if r.URL.Query().Get("live") != "1" {
			if persisted, err := s.metricsDB.QueryDaemon(resolution, time.Now().Add(-window)); err == nil && len(persisted) > 0 {
				items = persisted
				storage = "sqlite"
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"latest":          latest,
		"items":           items,
		"range":           rangeKey,
		"resolution":      resolution,
		"storage":         storage,
		"windowSeconds":   int(window.Seconds()),
		"intervalSeconds": 60,
		"maxRangeSeconds": int(maxRange.Seconds()),
		"metricsDbBytes":  s.metricsDBSize(),
		"checkedAt":       time.Now().UTC().Format(time.RFC3339),
	})
}
