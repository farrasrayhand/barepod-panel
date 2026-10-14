package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// handleGetWebsiteSecurity returns the current security & access control configuration for a site.
func (s *Server) handleGetWebsiteSecurity(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	sec, err := s.store.GetWebsiteSecurity(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to retrieve security configuration")
		return
	}
	writeJSON(w, http.StatusOK, sec)
}

type updateSecurityRequest struct {
	MaintenanceMode       *bool   `json:"maintenanceMode"`
	MaintenanceTitle      *string `json:"maintenanceTitle"`
	MaintenanceMessage    *string `json:"maintenanceMessage"`
	MaintenanceBypassIPs  *string `json:"maintenanceBypassIps"`
	BasicAuthEnabled      *bool   `json:"basicAuthEnabled"`
	BasicAuthUser         *string `json:"basicAuthUser"`
	BasicAuthPassword     *string `json:"basicAuthPassword"`
	BasicAuthRealm        *string `json:"basicAuthRealm"`
	BasicAuthBypassIPs    *string `json:"basicAuthBypassIps"`
	IPRestrictionMode     *string `json:"ipRestrictionMode"`
	IPRestrictionList     *string `json:"ipRestrictionList"`
	RateLimitEnabled      *bool   `json:"rateLimitEnabled"`
	RateLimitReqPerSec    *int    `json:"rateLimitReqPerSec"`
	RateLimitBurst        *int    `json:"rateLimitBurst"`
	AntiBruteforceEnabled *bool   `json:"antiBruteforceEnabled"`
	AntiBruteforceMax     *int    `json:"antiBruteforceMax"`
	AntiBruteforceBanMins *int    `json:"antiBruteforceBanMins"`
}

// handleSaveWebsiteSecurity updates security parameters, writes supporting config files (.htpasswd, 503 HTML),
// regenerates the active webserver vhost and hot-reloads it.
func (s *Server) handleSaveWebsiteSecurity(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}

	var req updateSecurityRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid request body")
		return
	}

	sec, err := s.store.GetWebsiteSecurity(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to retrieve security configuration")
		return
	}

	if req.MaintenanceMode != nil {
		sec.MaintenanceMode = *req.MaintenanceMode
	}
	if req.MaintenanceTitle != nil {
		sec.MaintenanceTitle = strings.TrimSpace(*req.MaintenanceTitle)
	}
	if req.MaintenanceMessage != nil {
		sec.MaintenanceMessage = strings.TrimSpace(*req.MaintenanceMessage)
	}
	if req.MaintenanceBypassIPs != nil {
		sec.MaintenanceBypassIPs = strings.TrimSpace(*req.MaintenanceBypassIPs)
	}
	if req.BasicAuthEnabled != nil {
		sec.BasicAuthEnabled = *req.BasicAuthEnabled
	}
	if req.BasicAuthUser != nil {
		u := strings.TrimSpace(*req.BasicAuthUser)
		if u != "" {
			sec.BasicAuthUser = u
		}
	}
	if req.BasicAuthRealm != nil {
		sec.BasicAuthRealm = strings.TrimSpace(*req.BasicAuthRealm)
	}
	if req.BasicAuthBypassIPs != nil {
		sec.BasicAuthBypassIPs = strings.TrimSpace(*req.BasicAuthBypassIPs)
	}
	if req.IPRestrictionMode != nil {
		mode := strings.ToLower(strings.TrimSpace(*req.IPRestrictionMode))
		if mode == "allowlist" || mode == "denylist" {
			sec.IPRestrictionMode = mode
		} else {
			sec.IPRestrictionMode = "none"
		}
	}
	if req.IPRestrictionList != nil {
		sec.IPRestrictionList = strings.TrimSpace(*req.IPRestrictionList)
	}
	if req.RateLimitEnabled != nil {
		sec.RateLimitEnabled = *req.RateLimitEnabled
	}
	if req.RateLimitReqPerSec != nil {
		sec.RateLimitReqPerSec = *req.RateLimitReqPerSec
	}
	if req.RateLimitBurst != nil {
		sec.RateLimitBurst = *req.RateLimitBurst
	}
	if req.AntiBruteforceEnabled != nil {
		sec.AntiBruteforceEnabled = *req.AntiBruteforceEnabled
	}
	if req.AntiBruteforceMax != nil {
		sec.AntiBruteforceMax = *req.AntiBruteforceMax
	}
	if req.AntiBruteforceBanMins != nil {
		sec.AntiBruteforceBanMins = *req.AntiBruteforceBanMins
	}

	// Password update or initial creation
	if req.BasicAuthPassword != nil && strings.TrimSpace(*req.BasicAuthPassword) != "" {
		hash, err := webserver.HashPassword(*req.BasicAuthPassword)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "crypto_error", "Failed to hash password")
			return
		}
		sec.BasicAuthPasswordHash = hash
		sec.HasPassword = true
	}

	// If basic auth enabled but no password set yet: error
	if sec.BasicAuthEnabled && sec.BasicAuthPasswordHash == "" {
		writeError(w, http.StatusBadRequest, "password_required", "A password must be set before enabling HTTP Basic Authentication")
		return
	}

	// Write .htpasswd file if basic auth is enabled
	if sec.BasicAuthEnabled && sec.BasicAuthPasswordHash != "" {
		if _, err := webserver.WriteHtpasswd(site.Slug, sec.BasicAuthUser, sec.BasicAuthPasswordHash); err != nil {
			writeError(w, http.StatusInternalServerError, "file_error", fmt.Sprintf("Failed to write .htpasswd: %v", err))
			return
		}
	} else if !sec.BasicAuthEnabled {
		_ = webserver.RemoveHtpasswd(site.Slug)
	}

	// Write maintenance 503 HTML file
	if sec.MaintenanceMode {
		if _, err := webserver.WriteMaintenancePage(site.Slug, sec.MaintenanceTitle, sec.MaintenanceMessage); err != nil {
			writeError(w, http.StatusInternalServerError, "file_error", fmt.Sprintf("Failed to write maintenance page: %v", err))
			return
		}
	}

	// Persist to store
	if err := s.store.SaveWebsiteSecurity(sec); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to persist security configuration")
		return
	}

	// Re-apply vhost to active web server
	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", fmt.Sprintf("Failed to apply webserver configuration: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, sec)
}

// handleToggleMaintenance quickly flips maintenance mode on or off.
func (s *Server) handleToggleMaintenance(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	sec, err := s.store.GetWebsiteSecurity(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to retrieve security configuration")
		return
	}

	sec.MaintenanceMode = !sec.MaintenanceMode
	if sec.MaintenanceMode {
		if _, err := webserver.WriteMaintenancePage(site.Slug, sec.MaintenanceTitle, sec.MaintenanceMessage); err != nil {
			writeError(w, http.StatusInternalServerError, "file_error", fmt.Sprintf("Failed to write maintenance page: %v", err))
			return
		}
	}

	if err := s.store.SaveWebsiteSecurity(sec); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to persist security configuration")
		return
	}

	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", fmt.Sprintf("Failed to reload webserver: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"maintenanceMode": sec.MaintenanceMode,
		"security":        sec,
	})
}

// handleToggleBasicAuth quickly flips HTTP Basic Auth on or off.
func (s *Server) handleToggleBasicAuth(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	site, ok := s.siteOr404(w, r, user)
	if !ok {
		return
	}
	sec, err := s.store.GetWebsiteSecurity(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to retrieve security configuration")
		return
	}

	if !sec.BasicAuthEnabled && sec.BasicAuthPasswordHash == "" {
		writeError(w, http.StatusBadRequest, "password_required", "A password must be set before enabling HTTP Basic Authentication")
		return
	}

	sec.BasicAuthEnabled = !sec.BasicAuthEnabled
	if sec.BasicAuthEnabled {
		if _, err := webserver.WriteHtpasswd(site.Slug, sec.BasicAuthUser, sec.BasicAuthPasswordHash); err != nil {
			writeError(w, http.StatusInternalServerError, "file_error", fmt.Sprintf("Failed to write .htpasswd: %v", err))
			return
		}
	} else {
		_ = webserver.RemoveHtpasswd(site.Slug)
	}

	if err := s.store.SaveWebsiteSecurity(sec); err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "Failed to persist security configuration")
		return
	}

	if err := s.applyVhost(r, site); err != nil {
		writeError(w, http.StatusInternalServerError, "webserver_error", fmt.Sprintf("Failed to reload webserver: %v", err))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"basicAuthEnabled": sec.BasicAuthEnabled,
		"security":         sec,
	})
}
