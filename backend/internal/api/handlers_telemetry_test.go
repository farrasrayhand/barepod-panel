package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/telemetry"
)

func TestHandleWebsiteTelemetry(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/panel.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	// Seed website
	site := &store.Website{
		Slug:       "test-telemetry-site",
		Domain:     "test-telemetry.local",
		TenantUser: "admin",
		Runtime:    "nodejs",
		WebServer:  "caddy",
		Status:     "running",
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatalf("failed to create website: %v", err)
	}

	// Prepare mock log file in temp dir
	tmpDir := t.TempDir()
	logPath := filepath.Join(tmpDir, "barepod-test-telemetry-site.access.log")
	logContent := `127.0.0.1 - - [14/Oct/2026:10:15:30 +0800] "GET / HTTP/1.1" 200 1200 "-" "Curl"
127.0.0.1 - - [14/Oct/2026:10:15:31 +0800] "GET /app.js HTTP/1.1" 200 400 "-" "Curl"
`
	if err := os.WriteFile(logPath, []byte(logContent), 0644); err != nil {
		t.Fatalf("failed to write mock log: %v", err)
	}

	server := &Server{
		store:     st,
		telemetry: telemetry.NewService(st),
	}

	adminUser := &store.User{
		ID:       "usr_admin",
		Username: "admin",
		Role:     "admin",
	}

	req := httptest.NewRequest("GET", "/api/v1/websites/test-telemetry-site/telemetry", nil)
	req.SetPathValue("slug", "test-telemetry-site")
	rec := httptest.NewRecorder()

	server.handleWebsiteTelemetry(rec, req, adminUser, nil)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload telemetry.WebsiteTelemetry
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("failed to parse JSON response: %v", err)
	}

	if payload.Slug != "test-telemetry-site" {
		t.Errorf("payload.Slug = %q, want test-telemetry-site", payload.Slug)
	}
}
