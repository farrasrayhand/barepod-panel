package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestRuntimeConfig_GetAndPut(t *testing.T) {
	p := newTestPanel(t)
	p.login(t, "admin")

	// 1. GET runtime config for pre-existing nodejs site "admin-site"
	req, err := http.NewRequest(http.MethodGet, p.server.URL+"/api/v1/websites/admin-site/runtime/config", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for GET nodejs config, got %d: %s", resp.StatusCode, string(b))
	}
	var nodeRes struct {
		Runtime string                 `json:"runtime"`
		Version string                 `json:"version"`
		Config  map[string]interface{} `json:"config"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&nodeRes); err != nil {
		t.Fatal(err)
	}
	if nodeRes.Runtime != "nodejs" {
		t.Fatalf("expected runtime nodejs, got %s", nodeRes.Runtime)
	}

	// 2. PUT runtime config for nodejs site
	putNodePayload := map[string]interface{}{
		"config": map[string]interface{}{
			"packageManager": "pnpm",
			"startScript":    "start:prod",
			"maxMemoryMb":    1024,
		},
	}
	buf, _ := json.Marshal(putNodePayload)
	req, err = http.NewRequest(http.MethodPut, p.server.URL+"/api/v1/websites/admin-site/runtime/config", bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for PUT nodejs config, got %d: %s", resp.StatusCode, string(b))
	}

	// 3. GET again and verify updated config persisted
	req, err = http.NewRequest(http.MethodGet, p.server.URL+"/api/v1/websites/admin-site/runtime/config", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var updatedNodeRes struct {
		Config map[string]interface{} `json:"config"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&updatedNodeRes); err != nil {
		t.Fatal(err)
	}
	if updatedNodeRes.Config["packageManager"] != "pnpm" {
		t.Fatalf("expected packageManager pnpm, got %v", updatedNodeRes.Config["packageManager"])
	}
	if updatedNodeRes.Config["startScript"] != "start:prod" {
		t.Fatalf("expected startScript start:prod, got %v", updatedNodeRes.Config["startScript"])
	}

	// 4. Create a PHP site and test PHP FPM directives
	phpSite := store.Website{
		Slug:         "php-site",
		Domain:       "php.example.com",
		TenantUser:   "admin",
		Runtime:      "php",
		Version:      "8.3",
		WebServer:    "caddy",
		Status:       "running",
		DeployStatus: "ready",
		Port:         9000,
	}
	if err := p.store.CreateWebsite(&phpSite); err != nil {
		t.Fatal(err)
	}
	// Also ensure site dir
	if err := os.MkdirAll(filepath.Join(p.home, "admin", "apps", "php-site"), 0755); err != nil {
		t.Fatal(err)
	}

	putPhpPayload := map[string]interface{}{
		"config": map[string]interface{}{
			"memoryLimit":        "512M",
			"uploadMaxSize":      "128M",
			"postMaxSize":        "128M",
			"maxExecutionTime":   120,
			"maxInputVars":       5000,
			"maxInputTime":       120,
			"processIdleTimeout": "30s",
			"pm":                 "dynamic",
			"maxChildren":        10,
		},
	}
	buf, _ = json.Marshal(putPhpPayload)
	req, err = http.NewRequest(http.MethodPut, p.server.URL+"/api/v1/websites/php-site/runtime/config", bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for PUT php config, got %d: %s", resp.StatusCode, string(b))
	}

	// 5. Test Python site "alex-site"
	putPyPayload := map[string]interface{}{
		"config": map[string]interface{}{
			"runner":         "uvicorn",
			"appModule":      "main:app",
			"workers":        4,
			"timeoutSeconds": 90,
		},
	}
	buf, _ = json.Marshal(putPyPayload)
	req, err = http.NewRequest(http.MethodPut, p.server.URL+"/api/v1/websites/alex-site/runtime/config", bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for PUT python config, got %d: %s", resp.StatusCode, string(b))
	}

	// 6. Test Go site
	goSite := store.Website{
		Slug:         "go-site",
		Domain:       "go.example.com",
		TenantUser:   "admin",
		Runtime:      "go",
		Version:      "1.22",
		WebServer:    "caddy",
		Status:       "running",
		DeployStatus: "ready",
		Port:         8080,
	}
	if err := p.store.CreateWebsite(&goSite); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(p.home, "admin", "apps", "go-site"), 0755); err != nil {
		t.Fatal(err)
	}

	putGoPayload := map[string]interface{}{
		"config": map[string]interface{}{
			"binaryPath": "./bin/server",
			"args":       "-env=prod -debug=false",
		},
	}
	buf, _ = json.Marshal(putGoPayload)
	req, err = http.NewRequest(http.MethodPut, p.server.URL+"/api/v1/websites/go-site/runtime/config", bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for PUT go config, got %d: %s", resp.StatusCode, string(b))
	}

	// 7. Test Static site
	staticSite := store.Website{
		Slug:         "static-site",
		Domain:       "static.example.com",
		TenantUser:   "admin",
		Runtime:      "static",
		WebServer:    "caddy",
		Status:       "running",
		DeployStatus: "ready",
	}
	if err := p.store.CreateWebsite(&staticSite); err != nil {
		t.Fatal(err)
	}
	putStaticPayload := map[string]interface{}{
		"config": map[string]interface{}{
			"spaFallback": true,
			"docRoot":     "dist",
		},
	}
	buf, _ = json.Marshal(putStaticPayload)
	req, err = http.NewRequest(http.MethodPut, p.server.URL+"/api/v1/websites/static-site/runtime/config", bytes.NewReader(buf))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", p.csrf)
	resp, err = p.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("expected 200 OK for PUT static config, got %d: %s", resp.StatusCode, string(b))
	}
}
