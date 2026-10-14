package store

import (
	"path/filepath"
	"testing"
)

func TestWebsiteSecurityRoundTrip(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer s.DB.Close()

	slug := "my-secure-app"

	// 1. Initial should return defaults with HasPassword=false
	sec, err := s.GetWebsiteSecurity(slug)
	if err != nil {
		t.Fatalf("get initial security: %v", err)
	}
	if sec.MaintenanceMode {
		t.Errorf("expected maintenanceMode=false by default")
	}
	if sec.HasPassword {
		t.Errorf("expected hasPassword=false by default")
	}

	// 2. Save customized security
	sec.MaintenanceMode = true
	sec.MaintenanceTitle = "Scheduled Upgrades"
	sec.MaintenanceMessage = "Down for migration."
	sec.MaintenanceBypassIPs = "127.0.0.1, 10.0.0.1"
	sec.BasicAuthEnabled = true
	sec.BasicAuthUser = "admin"
	sec.BasicAuthPasswordHash = "$2a$12$somehashedsecret"
	sec.BasicAuthRealm = "Protected Staging"
	sec.IPRestrictionMode = "allowlist"
	sec.IPRestrictionList = "10.0.0.0/8, 192.168.1.1"
	sec.RateLimitEnabled = true
	sec.RateLimitReqPerSec = 25
	sec.RateLimitBurst = 50

	if err := s.SaveWebsiteSecurity(sec); err != nil {
		t.Fatalf("save website security: %v", err)
	}

	// 3. Retrieve and verify
	loaded, err := s.GetWebsiteSecurity(slug)
	if err != nil {
		t.Fatalf("get updated security: %v", err)
	}
	if !loaded.MaintenanceMode || loaded.MaintenanceTitle != "Scheduled Upgrades" {
		t.Errorf("maintenance settings mismatch: %+v", loaded)
	}
	if !loaded.BasicAuthEnabled || loaded.BasicAuthUser != "admin" || !loaded.HasPassword {
		t.Errorf("basic auth settings mismatch: %+v", loaded)
	}
	if loaded.RateLimitReqPerSec != 25 || loaded.RateLimitBurst != 50 {
		t.Errorf("rate limit settings mismatch: %+v", loaded)
	}

	// 4. Test ToggleMaintenanceMode
	mState, err := s.ToggleMaintenanceMode(slug)
	if err != nil {
		t.Fatalf("toggle maintenance: %v", err)
	}
	if mState {
		t.Errorf("expected maintenance mode to be toggled to false, got %v", mState)
	}

	// 5. Test ToggleBasicAuth
	aState, err := s.ToggleBasicAuth(slug)
	if err != nil {
		t.Fatalf("toggle basic auth: %v", err)
	}
	if aState {
		t.Errorf("expected basic auth to be toggled to false, got %v", aState)
	}
}
