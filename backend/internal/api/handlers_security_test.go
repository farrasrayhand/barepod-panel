package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestWebsiteSecurityAPI(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	site := &store.Website{
		Slug:       "sec-app",
		TenantUser: "admin",
		Domain:     "sec-app.local",
		Runtime:    "static",
		Status:     "ready",
	}
	if err := panel.store.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}

	// 1. GET initial security settings
	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/sec-app/security", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get security status = %d (%s)", resp.StatusCode, body)
	}
	var sec store.WebsiteSecurity
	if err := json.Unmarshal(body, &sec); err != nil {
		t.Fatal(err)
	}
	if sec.MaintenanceMode {
		t.Errorf("expected maintenanceMode=false by default")
	}

	// 2. PUT update security settings (enabling maintenance & IP allowlist)
	maint := true
	title := "Server Upgrades"
	msg := "Upgrading stack."
	bypass := "127.0.0.1, 10.0.0.1"
	allowMode := "allowlist"
	allowList := "10.0.0.0/8, 192.168.1.100"
	rlEnabled := true
	rlRate := 20
	rlBurst := 40

	resp, body = panel.do(t, http.MethodPut, "/api/v1/websites/sec-app/security", map[string]any{
		"maintenanceMode":      &maint,
		"maintenanceTitle":     &title,
		"maintenanceMessage":   &msg,
		"maintenanceBypassIps": &bypass,
		"ipRestrictionMode":    &allowMode,
		"ipRestrictionList":    &allowList,
		"rateLimitEnabled":     &rlEnabled,
		"rateLimitReqPerSec":   &rlRate,
		"rateLimitBurst":       &rlBurst,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put security status = %d (%s)", resp.StatusCode, body)
	}
	if err := json.Unmarshal(body, &sec); err != nil {
		t.Fatal(err)
	}
	if !sec.MaintenanceMode || sec.MaintenanceTitle != "Server Upgrades" {
		t.Errorf("unexpected updated security: %+v", sec)
	}

	// 3. Quick toggle maintenance
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/sec-app/maintenance/toggle", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("toggle maintenance status = %d (%s)", resp.StatusCode, body)
	}
	var toggleMaintResp struct {
		MaintenanceMode bool                  `json:"maintenanceMode"`
		Security        store.WebsiteSecurity `json:"security"`
	}
	if err := json.Unmarshal(body, &toggleMaintResp); err != nil {
		t.Fatal(err)
	}
	if toggleMaintResp.MaintenanceMode != false {
		t.Errorf("expected maintenanceMode to toggle to false, got true")
	}

	// 4. Test Basic Auth with password
	bAuth := true
	bUser := "superadmin"
	bPass := "SecretPass123!"
	bRealm := "Dev Preview"

	resp, body = panel.do(t, http.MethodPut, "/api/v1/websites/sec-app/security", map[string]any{
		"basicAuthEnabled":  &bAuth,
		"basicAuthUser":     &bUser,
		"basicAuthPassword": &bPass,
		"basicAuthRealm":    &bRealm,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("put basic auth status = %d (%s)", resp.StatusCode, body)
	}
	if err := json.Unmarshal(body, &sec); err != nil {
		t.Fatal(err)
	}
	if !sec.BasicAuthEnabled || sec.BasicAuthUser != "superadmin" || !sec.HasPassword {
		t.Errorf("unexpected basic auth state: %+v", sec)
	}

	// 5. Test Quick toggle basic auth
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/sec-app/basic-auth/toggle", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("toggle basic auth status = %d (%s)", resp.StatusCode, body)
	}
	var toggleAuthResp struct {
		BasicAuthEnabled bool                  `json:"basicAuthEnabled"`
		Security         store.WebsiteSecurity `json:"security"`
	}
	if err := json.Unmarshal(body, &toggleAuthResp); err != nil {
		t.Fatal(err)
	}
	if toggleAuthResp.BasicAuthEnabled != false {
		t.Errorf("expected basicAuthEnabled to toggle to false, got true")
	}

	// 6. Test preview vhost reflects security
	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/sec-app/vhost/preview?engine=nginx", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get vhost preview status = %d (%s)", resp.StatusCode, body)
	}
	var vhostResp struct {
		Config string `json:"config"`
	}
	if err := json.Unmarshal(body, &vhostResp); err != nil {
		t.Fatal(err)
	}
	if vhostResp.Config == "" {
		t.Errorf("expected vhost preview config not empty")
	}
}
