package store

import (
	"database/sql"
	"errors"
	"time"
)

// DefaultSecurity returns initial security settings for a site when no customized row exists.
func DefaultSecurity(slug string) *WebsiteSecurity {
	return &WebsiteSecurity{
		WebsiteSlug:           slug,
		MaintenanceMode:       false,
		MaintenanceTitle:      "System Maintenance",
		MaintenanceMessage:    "We are performing routine infrastructure maintenance and system updates. Service will be back online shortly.",
		MaintenanceBypassIPs:  "127.0.0.1",
		BasicAuthEnabled:      false,
		BasicAuthUser:         "admin",
		BasicAuthPasswordHash: "",
		HasPassword:           false,
		BasicAuthRealm:        "Restricted Area",
		BasicAuthBypassIPs:    "",
		IPRestrictionMode:     "none",
		IPRestrictionList:     "",
		RateLimitEnabled:      false,
		RateLimitReqPerSec:    10,
		RateLimitBurst:        20,
		AntiBruteforceEnabled: true,
		AntiBruteforceMax:     5,
		AntiBruteforceBanMins: 15,
		UpdatedAt:             now(),
	}
}

// GetWebsiteSecurity loads the access control and security config for a website.
// If not found in database, it returns safe defaults.
func (s *Store) GetWebsiteSecurity(slug string) (*WebsiteSecurity, error) {
	var sec WebsiteSecurity
	err := s.DB.QueryRow(`
		SELECT website_slug, maintenance_mode, maintenance_title, maintenance_message, maintenance_bypass_ips,
		       basic_auth_enabled, basic_auth_user, basic_auth_password_hash, basic_auth_realm, basic_auth_bypass_ips,
		       ip_restriction_mode, ip_restriction_list,
		       rate_limit_enabled, rate_limit_req_per_sec, rate_limit_burst,
		       anti_bruteforce_enabled, anti_bruteforce_max, anti_bruteforce_ban_mins,
		       updated_at
		FROM website_security WHERE website_slug = ?`, slug,
	).Scan(
		&sec.WebsiteSlug, &sec.MaintenanceMode, &sec.MaintenanceTitle, &sec.MaintenanceMessage, &sec.MaintenanceBypassIPs,
		&sec.BasicAuthEnabled, &sec.BasicAuthUser, &sec.BasicAuthPasswordHash, &sec.BasicAuthRealm, &sec.BasicAuthBypassIPs,
		&sec.IPRestrictionMode, &sec.IPRestrictionList,
		&sec.RateLimitEnabled, &sec.RateLimitReqPerSec, &sec.RateLimitBurst,
		&sec.AntiBruteforceEnabled, &sec.AntiBruteforceMax, &sec.AntiBruteforceBanMins,
		&sec.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultSecurity(slug), nil
	}
	if err != nil {
		return nil, err
	}
	sec.HasPassword = sec.BasicAuthPasswordHash != ""
	return &sec, nil
}

// SaveWebsiteSecurity upserts the security configuration for a website.
func (s *Store) SaveWebsiteSecurity(sec *WebsiteSecurity) error {
	sec.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	_, err := s.DB.Exec(`
		INSERT INTO website_security (
			website_slug, maintenance_mode, maintenance_title, maintenance_message, maintenance_bypass_ips,
			basic_auth_enabled, basic_auth_user, basic_auth_password_hash, basic_auth_realm, basic_auth_bypass_ips,
			ip_restriction_mode, ip_restriction_list,
			rate_limit_enabled, rate_limit_req_per_sec, rate_limit_burst,
			anti_bruteforce_enabled, anti_bruteforce_max, anti_bruteforce_ban_mins,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(website_slug) DO UPDATE SET
			maintenance_mode = excluded.maintenance_mode,
			maintenance_title = excluded.maintenance_title,
			maintenance_message = excluded.maintenance_message,
			maintenance_bypass_ips = excluded.maintenance_bypass_ips,
			basic_auth_enabled = excluded.basic_auth_enabled,
			basic_auth_user = excluded.basic_auth_user,
			basic_auth_password_hash = CASE WHEN excluded.basic_auth_password_hash != '' THEN excluded.basic_auth_password_hash ELSE website_security.basic_auth_password_hash END,
			basic_auth_realm = excluded.basic_auth_realm,
			basic_auth_bypass_ips = excluded.basic_auth_bypass_ips,
			ip_restriction_mode = excluded.ip_restriction_mode,
			ip_restriction_list = excluded.ip_restriction_list,
			rate_limit_enabled = excluded.rate_limit_enabled,
			rate_limit_req_per_sec = excluded.rate_limit_req_per_sec,
			rate_limit_burst = excluded.rate_limit_burst,
			anti_bruteforce_enabled = excluded.anti_bruteforce_enabled,
			anti_bruteforce_max = excluded.anti_bruteforce_max,
			anti_bruteforce_ban_mins = excluded.anti_bruteforce_ban_mins,
			updated_at = excluded.updated_at
	`,
		sec.WebsiteSlug, sec.MaintenanceMode, sec.MaintenanceTitle, sec.MaintenanceMessage, sec.MaintenanceBypassIPs,
		sec.BasicAuthEnabled, sec.BasicAuthUser, sec.BasicAuthPasswordHash, sec.BasicAuthRealm, sec.BasicAuthBypassIPs,
		sec.IPRestrictionMode, sec.IPRestrictionList,
		sec.RateLimitEnabled, sec.RateLimitReqPerSec, sec.RateLimitBurst,
		sec.AntiBruteforceEnabled, sec.AntiBruteforceMax, sec.AntiBruteforceBanMins,
		sec.UpdatedAt,
	)
	return err
}

// ToggleMaintenanceMode toggles maintenance mode on or off.
func (s *Store) ToggleMaintenanceMode(slug string) (bool, error) {
	sec, err := s.GetWebsiteSecurity(slug)
	if err != nil {
		return false, err
	}
	sec.MaintenanceMode = !sec.MaintenanceMode
	if err := s.SaveWebsiteSecurity(sec); err != nil {
		return false, err
	}
	return sec.MaintenanceMode, nil
}

// ToggleBasicAuth toggles HTTP basic auth on or off.
func (s *Store) ToggleBasicAuth(slug string) (bool, error) {
	sec, err := s.GetWebsiteSecurity(slug)
	if err != nil {
		return false, err
	}
	sec.BasicAuthEnabled = !sec.BasicAuthEnabled
	if err := s.SaveWebsiteSecurity(sec); err != nil {
		return false, err
	}
	return sec.BasicAuthEnabled, nil
}
