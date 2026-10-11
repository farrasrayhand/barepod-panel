package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
)

const testPassword = "devpass"

// testPanel is a running daemon with one admin account (admin) and one developer
// account (alex), each with their own website.
type testPanel struct {
	server  *httptest.Server
	store   *store.Store
	home    string
	client  *http.Client
	csrf    string
	adminID string
	alexID  string
}

func newTestPanel(t *testing.T) *testPanel {
	t.Helper()
	dir := t.TempDir()

	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if _, err := st.EnsureDefaultGroups(); err != nil {
		t.Fatal(err)
	}

	hash, err := auth.HashPassword(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	admin, err := st.CreateUser("admin", "admin@example.com", hash, "admin", rbac.RootGroup)
	if err != nil {
		t.Fatal(err)
	}
	alex, err := st.CreateUser("alex", "alex@example.com", hash, "user", "Developer")
	if err != nil {
		t.Fatal(err)
	}

	runner := &host.DryRunner{}
	h := &host.Host{Runner: runner, SitesRoot: filepath.Join(dir, "home"), UnitsDir: filepath.Join(dir, "units")}
	key := make([]byte, 32)

	sites := []store.Website{
		{Slug: "admin-site", Domain: "admin.example.com", TenantUser: "admin", Runtime: "nodejs", Version: "22", WebServer: "caddy", Status: "running", DeployStatus: "ready", Port: 3000},
		{Slug: "alex-site", Domain: "alex.example.com", TenantUser: "alex", Runtime: "python", Version: "3.12", WebServer: "openlitespeed", Status: "running", DeployStatus: "ready", Port: 8000},
	}
	for i := range sites {
		if err := st.CreateWebsite(&sites[i]); err != nil {
			t.Fatal(err)
		}
		// The site directory must exist: the terminal and the file manager need a real cwd.
		if _, err := h.EnsureSiteDir(context.Background(), sites[i].TenantUser, sites[i].Slug); err != nil {
			t.Fatal(err)
		}
	}

	handler := New(Deps{
		Config:         config.Config{StaticDir: filepath.Join(dir, "nodist")},
		Store:          st,
		Key:            key,
		Host:           h,
		Deploy:         deploy.NewManager(st, h, key),
		Tenants:        tenant.New(runner, h.SitesRoot, sysinfo.Capabilities{}),
		MaxUploadBytes: 1 << 20,
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &testPanel{
		server:  server,
		store:   st,
		home:    h.SitesRoot,
		client:  &http.Client{Jar: jar},
		adminID: admin.ID,
		alexID:  alex.ID,
	}
}

// login signs a user in and remembers the CSRF token.
func (p *testPanel) login(t *testing.T, username string) {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"password":%q}`, username, testPassword)
	resp, err := p.client.Post(p.server.URL+"/api/v1/auth/login", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", resp.StatusCode)
	}
	var payload struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	p.csrf = payload.CSRFToken
}

func (p *testPanel) do(t *testing.T, method, path string, body any) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequest(method, p.server.URL+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if method != http.MethodGet {
		req.Header.Set("X-CSRF-Token", p.csrf)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

// --- file manager ---

func TestFileManagerRoundTrip(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	base := "/api/v1/websites/admin-site/files"

	resp, body := panel.do(t, http.MethodPut, base+"/content", map[string]string{
		"path": "app/index.js", "content": "console.log('hello');\n",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("write status = %d (%s)", resp.StatusCode, body)
	}

	resp, body = panel.do(t, http.MethodGet, base+"/content?path=app/index.js", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("read status = %d (%s)", resp.StatusCode, body)
	}
	var file struct {
		Content  string `json:"content"`
		Encoding string `json:"encoding"`
		Binary   bool   `json:"binary"`
	}
	if err := json.Unmarshal(body, &file); err != nil {
		t.Fatal(err)
	}
	if file.Content != "console.log('hello');\n" || file.Binary {
		t.Fatalf("read = %+v", file)
	}

	resp, body = panel.do(t, http.MethodGet, base+"?path=app", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d (%s)", resp.StatusCode, body)
	}
	var listing struct {
		Items []struct {
			Name string `json:"name"`
			Path string `json:"path"`
			Type string `json:"type"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &listing); err != nil {
		t.Fatal(err)
	}
	if len(listing.Items) != 1 || listing.Items[0].Name != "index.js" || listing.Items[0].Path != "app/index.js" {
		t.Fatalf("listing = %+v", listing.Items)
	}
}

func TestFileManagerBlocksEscapes(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	base := "/api/v1/websites/admin-site/files"

	escapes := []string{
		"../../etc/passwd",
		"/etc/passwd",
		"..%2f..%2fetc",
		"app/../../../etc/shadow",
	}
	for _, path := range escapes {
		resp, body := panel.do(t, http.MethodGet, base+"?path="+path, nil)
		if resp.StatusCode == http.StatusOK {
			t.Errorf("listing %q was allowed (%s)", path, body)
		}
	}

	// A symlink pointing outside the site must not become a way out either.
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("TOP-SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(panel.home, "admin", "apps", "admin-site", "escape")
	if err := os.Symlink(outside, link); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	resp, body := panel.do(t, http.MethodGet, base+"/content?path=escape/secret.txt", nil)
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("reading through an escaping symlink was allowed (%s)", body)
	}
}

func TestFileManagerIsScopedToTheCaller(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "alex")

	// alex may not touch the admin's website at all.
	resp, _ := panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/files?path=", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("alex listing the admin's site status = %d, want 404", resp.StatusCode)
	}

	// …but their own site works.
	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/files?path=", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("alex listing their own site status = %d (%s)", resp.StatusCode, body)
	}
}

func TestFileManagerRequiresTheCapability(t *testing.T) {
	panel := newTestPanel(t)
	group, err := panel.store.GroupByName("Developer")
	if err != nil {
		t.Fatal(err)
	}
	// Keep the package limits, drop only the file manager capability.
	if err := panel.store.UpdateGroup("Developer", "no file access",
		rbac.Permissions{rbac.CapDeployApps: true}, group.Limits); err != nil {
		t.Fatal(err)
	}
	panel.login(t, "alex")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/files?path=", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "capability_required") {
		t.Errorf("body = %s, want capability_required", body)
	}
}

func TestDeleteWebsiteRemovesEverything(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodDelete, "/api/v1/websites/admin-site", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Slug  string   `json:"slug"`
		Steps []string `json:"steps"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Slug != "admin-site" || len(payload.Steps) == 0 {
		t.Errorf("delete response = %s", body)
	}
	if _, err := panel.store.WebsiteBySlug("admin-site"); err != store.ErrNotFound {
		t.Errorf("the row survived the delete: %v", err)
	}
	if _, err := os.Stat(filepath.Join(panel.home, "admin", "apps", "admin-site")); !os.IsNotExist(err) {
		t.Errorf("the site directory survived: %v", err)
	}

	// Deleting it twice is a 404, not a crash.
	resp, _ = panel.do(t, http.MethodDelete, "/api/v1/websites/admin-site", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("second delete status = %d, want 404", resp.StatusCode)
	}
}

func TestRedeployStartsANewJob(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// The fixture records no source, so a redeploy falls back to "existing".
	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/redeploy", nil)
	if resp.StatusCode != http.StatusAccepted {
		t.Fatalf("redeploy status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Slug     string `json:"slug"`
		DeployID string `json:"deployId"`
		Mode     string `json:"mode"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.DeployID == "" || payload.Slug != "alex-site" {
		t.Errorf("redeploy response = %s", body)
	}

	// A tenant may not redeploy someone else's website.
	panel.login(t, "alex")
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/websites/admin-site/redeploy", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("cross-tenant redeploy status = %d, want 404", resp.StatusCode)
	}
}

func TestFileUploadIsConfinedToTheDirectory(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "../../evil.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write([]byte("payload")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req, err := http.NewRequest(http.MethodPost, panel.server.URL+"/api/v1/websites/admin-site/files/upload?path=", &body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-CSRF-Token", panel.csrf)
	resp, err := panel.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	payload, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("upload status = %d (%s)", resp.StatusCode, payload)
	}
	if !strings.Contains(string(payload), "evil.txt") || strings.Contains(string(payload), "..") {
		t.Fatalf("upload response = %s", payload)
	}

	// The file landed inside the site, not above it.
	if _, err := os.Stat(filepath.Join(panel.home, "admin", "apps", "admin-site", "evil.txt")); err != nil {
		t.Errorf("uploaded file is not inside the site: %v", err)
	}
	if _, err := os.Stat(filepath.Join(panel.home, "admin", "apps", "evil.txt")); err == nil {
		t.Error("upload escaped the site directory")
	}
}
