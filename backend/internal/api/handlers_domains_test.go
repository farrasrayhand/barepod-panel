package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestDomainsLifecycle(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// Pre-create website in store
	site := &store.Website{
		Slug:       "test-app",
		TenantUser: "admin",
		Domain:     "test-app.com",
		Runtime:    "static",
		Status:     "ready",
	}
	if err := panel.store.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}

	// 1. List domains - should contain primary domain
	resp, body := panel.do(t, http.MethodGet, "/api/v1/domains?websiteSlug=test-app", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list domains status = %d (%s)", resp.StatusCode, body)
	}
	var listResp struct {
		Items []store.WebsiteDomain `json:"items"`
	}
	if err := json.Unmarshal(body, &listResp); err != nil {
		t.Fatal(err)
	}
	if len(listResp.Items) != 1 {
		t.Fatalf("expected 1 initial domain, got %d", len(listResp.Items))
	}
	primary := listResp.Items[0]
	if primary.Domain != "test-app.com" || !primary.IsPrimary {
		t.Fatalf("unexpected primary domain: %+v", primary)
	}

	// 2. Add an alias domain
	resp, body = panel.do(t, http.MethodPost, "/api/v1/domains", map[string]any{
		"websiteSlug": "test-app",
		"domain":      "alias.test-app.com",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("add alias domain status = %d (%s)", resp.StatusCode, body)
	}
	var added store.WebsiteDomain
	if err := json.Unmarshal(body, &added); err != nil {
		t.Fatal(err)
	}
	if added.Domain != "alias.test-app.com" || added.IsPrimary {
		t.Fatalf("unexpected added domain: %+v", added)
	}

	// 3. Duplicate domain is refused
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/domains", map[string]any{
		"websiteSlug": "test-app",
		"domain":      "alias.test-app.com",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 conflict for duplicate domain, got %d", resp.StatusCode)
	}

	// 4. Primary domain cannot be deleted
	resp, _ = panel.do(t, http.MethodDelete, "/api/v1/domains/"+primary.ID, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request deleting primary domain, got %d", resp.StatusCode)
	}

	// 5. Issue self-signed SSL for alias domain
	resp, body = panel.do(t, http.MethodPost, "/api/v1/domains/"+added.ID+"/ssl/issue", map[string]any{
		"provider":   "self_signed",
		"forceHTTPS": true,
		"hsts":       true,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("issue self-signed status = %d (%s)", resp.StatusCode, body)
	}
	var sslResp struct {
		Status      string `json:"status"`
		Provider    string `json:"provider"`
		ForceHTTPS  bool   `json:"forceHTTPS"`
		HSTSEnabled bool   `json:"hstsEnabled"`
	}
	if err := json.Unmarshal(body, &sslResp); err != nil {
		t.Fatal(err)
	}
	if sslResp.Status != "active" || sslResp.Provider != "self_signed" || !sslResp.ForceHTTPS {
		t.Fatalf("unexpected SSL issue response: %+v", sslResp)
	}

	// 6. Test custom SSL upload validation
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/domains/"+added.ID+"/ssl/custom", map[string]any{
		"certificate": "not-a-valid-cert",
		"privateKey":  "not-a-valid-key",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 bad request for invalid cert upload, got %d", resp.StatusCode)
	}

	// 7. Toggle SSL settings
	falseVal := false
	resp, body = panel.do(t, http.MethodPost, "/api/v1/domains/"+added.ID+"/ssl/toggle", map[string]any{
		"forceHTTPS": &falseVal,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("toggle ssl status = %d (%s)", resp.StatusCode, body)
	}
	var toggled store.WebsiteDomain
	if err := json.Unmarshal(body, &toggled); err != nil {
		t.Fatal(err)
	}
	if toggled.ForceHTTPS {
		t.Fatalf("expected forceHTTPS=false after toggle, got true")
	}

	// 7. Delete alias domain
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/domains/"+added.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete alias domain status = %d (%s)", resp.StatusCode, body)
	}

	// Verify alias is gone
	resp, body = panel.do(t, http.MethodGet, "/api/v1/domains?websiteSlug=test-app", nil)
	if err := json.Unmarshal(body, &listResp); err != nil {
		t.Fatal(err)
	}
	if len(listResp.Items) != 1 {
		t.Fatalf("expected 1 domain after delete, got %d", len(listResp.Items))
	}
}
