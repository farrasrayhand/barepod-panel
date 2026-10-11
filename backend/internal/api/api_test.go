package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
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
		Tools:          dbtools.New(runner, time.Minute),
		// Availability must not depend on the machine running the tests: here no
		// third-party manager is installed, so the gate is deterministic.
		LookPath: func(string) (string, error) { return "", errors.New("not installed") },
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

func TestAuditIsScopedToTheCaller(t *testing.T) {
	panel := newTestPanel(t)

	// Signing in as two accounts leaves one auth.login entry each.
	panel.login(t, "admin")
	panel.login(t, "alex")
	// Back to the admin, whose session is the one that asks for the log.
	panel.login(t, "admin")

	// An admin sees every account's activity (the single documented exception).
	resp, body := panel.do(t, http.MethodGet, "/api/v1/audit?limit=50", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("audit status = %d (%s)", resp.StatusCode, body)
	}
	var adminView struct {
		Everything bool `json:"everything"`
		Items      []struct {
			Action   string `json:"action"`
			Username string `json:"username"`
			IP       string `json:"ip"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &adminView); err != nil {
		t.Fatal(err)
	}
	if !adminView.Everything {
		t.Error("an admin should see every account")
	}
	if len(adminView.Items) < 2 {
		t.Fatalf("admin sees %d entries, want at least 2: %s", len(adminView.Items), body)
	}
	seen := map[string]bool{}
	for _, item := range adminView.Items {
		seen[item.Username] = true
	}
	for _, want := range []string{"admin", "alex"} {
		if !seen[want] {
			t.Errorf("the admin log is missing %q: %s", want, body)
		}
	}

	// A tenant sees only its own activity.
	panel.login(t, "alex")
	resp, body = panel.do(t, http.MethodGet, "/api/v1/audit?limit=50", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tenant audit status = %d (%s)", resp.StatusCode, body)
	}
	var tenantView struct {
		Everything bool `json:"everything"`
		Items      []struct {
			Username string `json:"username"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &tenantView); err != nil {
		t.Fatal(err)
	}
	if tenantView.Everything {
		t.Error("a tenant must not see every account")
	}
	if len(tenantView.Items) == 0 {
		t.Fatalf("the tenant sees no activity of its own: %s", body)
	}
	for _, item := range tenantView.Items {
		if item.Username != "alex" {
			t.Errorf("a tenant can read another account's activity: %s", body)
			break
		}
	}
}

func TestAuditHonoursTheLimit(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	for i := 0; i < 3; i++ {
		panel.do(t, http.MethodGet, "/api/v1/auth/me", nil)
	}

	resp, body := panel.do(t, http.MethodGet, "/api/v1/audit?limit=1", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Items []json.RawMessage `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) != 1 {
		t.Errorf("limit=1 returned %d entries", len(payload.Items))
	}
}

func TestSessionsListFlagsTheCurrentOne(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/sessions", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sessions status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		CurrentID string `json:"currentId"`
		Items     []struct {
			ID    string `json:"id"`
			Agent string `json:"userAgent"`
			IP    string `json:"ip"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.CurrentID == "" || len(payload.Items) == 0 {
		t.Fatalf("sessions payload = %s", body)
	}
	// The CSRF token must never travel through this endpoint.
	if bytes.Contains(body, []byte("csrfToken")) || bytes.Contains(body, []byte("csrf_token")) {
		t.Errorf("the session list leaked a CSRF token: %s", body)
	}

	// Revoking another session removes it immediately.
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/sessions/"+payload.Items[0].ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("revoke status = %d (%s)", resp.StatusCode, body)
	}
	if _, err := panel.store.SessionByID(payload.Items[0].ID); err != store.ErrNotFound {
		t.Errorf("the revoked session is still in the store: %v", err)
	}
}

func TestDownloadIsAudited(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// Put a file in the site, then take a copy out of the panel.
	resp, body := panel.do(t, http.MethodPut, "/api/v1/websites/admin-site/files/content", map[string]string{
		"path":    "secret.txt",
		"content": "creds",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("write status = %d (%s)", resp.StatusCode, body)
	}
	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/files/download?path=secret.txt", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("download status = %d (%s)", resp.StatusCode, body)
	}

	// Downloads are how data leaves the panel, so they must leave a trail.
	_, auditBody := panel.do(t, http.MethodGet, "/api/v1/audit?limit=10", nil)
	var audit struct {
		Items []struct {
			Action string `json:"action"`
			Target string `json:"target"`
			Detail string `json:"detail"`
		} `json:"items"`
	}
	if err := json.Unmarshal(auditBody, &audit); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range audit.Items {
		if item.Action == "files.download" && item.Target == "admin-site/secret.txt" {
			found = true
			if item.Detail != "5 bytes" {
				t.Errorf("download detail = %q, want the size", item.Detail)
			}
		}
	}
	if !found {
		t.Errorf("the download was not audited: %s", auditBody)
	}
}

func TestHostScopeIsAdminOnlyAndSystemPathsAreReadOnly(t *testing.T) {
	panel := newTestPanel(t)

	// A normal account may not browse the host at all.
	panel.login(t, "alex")
	resp, _ := panel.do(t, http.MethodGet, "/api/v1/files?scope=host&path=etc", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("a tenant browsed the host: %d", resp.StatusCode)
	}

	panel.login(t, "admin")
	resp, body := panel.do(t, http.MethodGet, "/api/v1/files?scope=host&path=etc", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listing /etc as admin = %d (%s)", resp.StatusCode, body)
	}
	var listing struct {
		ReadOnly bool   `json:"readOnly"`
		Scope    string `json:"scope"`
		Items    []struct {
			Name      string `json:"name"`
			Protected bool   `json:"protected"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &listing); err != nil {
		t.Fatal(err)
	}
	if listing.Scope != "host" || !listing.ReadOnly {
		t.Errorf("listing should say it is a read-only host scope: %s", body)
	}
	if len(listing.Items) == 0 {
		t.Fatalf("no entries under /etc: %s", body)
	}
	for _, item := range listing.Items {
		if !item.Protected {
			t.Errorf("%s under /etc is not marked protected", item.Name)
		}
	}

	// Writing into a system path is refused, whatever the admin intends.
	resp, body = panel.do(t, http.MethodPut, "/api/v1/files/content?scope=host", map[string]string{
		"path":    "etc/hosts",
		"content": "changed by a mistake\n",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("writing /etc/hosts = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "system_path_protected") {
		t.Errorf("the refusal should name the reason: %s", body)
	}

	// Deleting a system path is refused too.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/files/delete?scope=host", map[string]any{
		"paths": []string{"etc/hosts", "usr/bin"},
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("deleting a system path = %d (%s)", resp.StatusCode, body)
	}

	// Reading a system path is allowed and leaves a trace.
	resp, body = panel.do(t, http.MethodGet, "/api/v1/files/content?scope=host&path=etc/passwd", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reading /etc/passwd = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), `"writable":false`) {
		t.Errorf("a protected file must say it cannot be edited: %s", body)
	}
	_, auditBody := panel.do(t, http.MethodGet, "/api/v1/audit?limit=20", nil)
	for _, want := range []string{"files.read_system", "files.blocked"} {
		if !strings.Contains(string(auditBody), want) {
			t.Errorf("the audit trail is missing %q: %s", want, auditBody)
		}
	}
}

func TestTenantScopeSeesTheWholeHome(t *testing.T) {
	panel := newTestPanel(t)

	// The junk an admin could not see before living outside apps/.
	junk := filepath.Join(panel.home, "admin", "downloads.tar.gz")
	if err := os.WriteFile(junk, []byte("2 GB of leftovers"), 0o640); err != nil {
		t.Fatal(err)
	}

	panel.login(t, "admin")
	resp, body := panel.do(t, http.MethodGet, "/api/v1/files?scope=tenant&tenant=admin&path=", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("listing the tenant home = %d (%s)", resp.StatusCode, body)
	}
	for _, want := range []string{`"name":"apps"`, "downloads.tar.gz"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("the home listing is missing %s: %s", want, body)
		}
	}
	if !strings.Contains(string(body), `"readOnly":false`) {
		t.Errorf("a tenant home is the account's own data and stays writable: %s", body)
	}

	// A tenant may browse its own home, never another account's.
	panel.login(t, "alex")
	resp, _ = panel.do(t, http.MethodGet, "/api/v1/files?scope=tenant&tenant=alex&path=", nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("a tenant could not open its own home: %d", resp.StatusCode)
	}
	resp, _ = panel.do(t, http.MethodGet, "/api/v1/files?scope=tenant&tenant=admin&path=", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("a tenant opened another account's home: %d", resp.StatusCode)
	}

	// The scope is mandatory and must be known.
	resp, _ = panel.do(t, http.MethodGet, "/api/v1/files?path=", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a missing scope should be a bad request: %d", resp.StatusCode)
	}
}

func TestSQLiteDatabaseLifecycle(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// Create: the daemon makes the file inside the website and shows the
	// generated password exactly once.
	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine":      "sqlite",
		"alias":       "Shop DB",
		"websiteSlug": "admin-site",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d (%s)", resp.StatusCode, body)
	}
	var created struct {
		Database struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			FilePath  string `json:"path"`
			FileBased bool   `json:"fileBased"`
			Status    string `json:"status"`
		} `json:"database"`
		Password        string `json:"password"`
		PasswordShownAt bool   `json:"passwordShownOnce"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	if created.Password == "" || !created.PasswordShownAt {
		t.Errorf("the generated password should be shown once: %s", body)
	}
	if !created.Database.FileBased || created.Database.Name != "admin_shop_db" {
		t.Errorf("unexpected record: %s", body)
	}
	if _, err := os.Stat(created.Database.FilePath); err != nil {
		t.Fatalf("the database file was not created: %v", err)
	}

	// The credential never travels in a listing.
	_, listBody := panel.do(t, http.MethodGet, "/api/v1/databases", nil)
	if strings.Contains(string(listBody), created.Password) {
		t.Errorf("the listing leaked the password: %s", listBody)
	}
	if strings.Contains(string(listBody), "password_cipher") {
		t.Errorf("the listing leaked the encrypted credential: %s", listBody)
	}

	// Reveal needs a fresh panel-password check.
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/reveal", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("reveal without elevation = %d, want 403", resp.StatusCode)
	}
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/auth/verify", map[string]string{"password": testPassword})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("verify = %d", resp.StatusCode)
	}
	resp, revealBody := panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/reveal", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reveal = %d (%s)", resp.StatusCode, revealBody)
	}
	if !strings.Contains(string(revealBody), created.Password) {
		t.Errorf("reveal did not return the stored password: %s", revealBody)
	}

	// Rotation: a custom password must be long enough, and it replaces the old.
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/rotate-password",
		map[string]string{"password": "short"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("a short password was accepted: %d", resp.StatusCode)
	}
	resp, rotateBody := panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/rotate-password",
		map[string]string{"password": "brand-new-secret"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rotate = %d (%s)", resp.StatusCode, rotateBody)
	}
	_, revealBody = panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/reveal", nil)
	if !strings.Contains(string(revealBody), "brand-new-secret") {
		t.Errorf("the rotation did not take effect: %s", revealBody)
	}

	// Bin: nothing is dropped, and a file-based database moves into the trash.
	resp, _ = panel.do(t, http.MethodDelete, "/api/v1/databases/"+created.Database.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("bin = %d", resp.StatusCode)
	}
	if _, err := os.Stat(created.Database.FilePath); !os.IsNotExist(err) {
		t.Errorf("the file should have moved into the trash: %v", err)
	}
	_, liveBody := panel.do(t, http.MethodGet, "/api/v1/databases", nil)
	if strings.Contains(string(liveBody), created.Database.ID) {
		t.Errorf("a binned database is still listed as live: %s", liveBody)
	}
	_, binBody := panel.do(t, http.MethodGet, "/api/v1/databases/recycle-bin", nil)
	if !strings.Contains(string(binBody), created.Database.ID) || !strings.Contains(string(binBody), "deletedAt") {
		t.Errorf("the recycle bin does not show the item: %s", binBody)
	}

	// Restore brings the file back.
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/restore", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("restore = %d", resp.StatusCode)
	}
	if _, err := os.Stat(created.Database.FilePath); err != nil {
		t.Errorf("the file did not come back: %v", err)
	}

	// Purge is the only destructive step.
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/purge", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("purge = %d", resp.StatusCode)
	}
	if _, err := os.Stat(created.Database.FilePath); !os.IsNotExist(err) {
		t.Errorf("purge left the file behind: %v", err)
	}
	if _, err := panel.store.DatabaseByID(created.Database.ID); err != store.ErrNotFound {
		t.Errorf("purge left the record behind: %v", err)
	}
}

func TestDatabasesAreScopedToTheirOwner(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	_, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "Admin DB", "websiteSlug": "admin-site",
	})
	var created struct {
		Database struct {
			ID string `json:"id"`
		} `json:"database"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}

	panel.login(t, "alex")
	// Another account's record answers 404, not 403: the panel must not confirm it.
	for _, call := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/databases/" + created.Database.ID},
		{http.MethodDelete, "/api/v1/databases/" + created.Database.ID},
		{http.MethodPost, "/api/v1/databases/" + created.Database.ID + "/rotate-password"},
		{http.MethodPost, "/api/v1/databases/" + created.Database.ID + "/reveal"},
	} {
		resp, _ := panel.do(t, call.method, call.path, nil)
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s = %d, want 404", call.method, call.path, resp.StatusCode)
		}
	}
	_, listBody := panel.do(t, http.MethodGet, "/api/v1/databases", nil)
	if strings.Contains(string(listBody), created.Database.ID) {
		t.Errorf("a tenant can list another account's database: %s", listBody)
	}

	// A tenant may create one for its own website.
	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "My DB", "websiteSlug": "alex-site",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("a tenant could not create a database for its own site: %d (%s)", resp.StatusCode, body)
	}
	// And it may not create one for someone else's website.
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "Sneaky", "websiteSlug": "admin-site",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("a tenant created a database on another account's site: %d", resp.StatusCode)
	}
}

func TestDbEnginesReportWhatTheHostCanReallyDo(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/db-engines", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("db-engines = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Items []struct {
			Engine    string `json:"engine"`
			Kind      string `json:"kind"`
			FileBased bool   `json:"fileBased"`
			Available bool   `json:"available"`
			Automated bool   `json:"automated"`
			Note      string `json:"note"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, engine := range payload.Items {
		seen[engine.Engine] = true
		if !engine.Available && engine.Note == "" {
			t.Errorf("%s is unavailable without a reason", engine.Engine)
		}
		if !engine.Automated && engine.Note == "" {
			t.Errorf("%s is not automated without a reason", engine.Engine)
		}
	}
	for _, want := range []string{"sqlite", "postgresql", "mysql", "mariadb", "mongodb", "redis"} {
		if !seen[want] {
			t.Errorf("the engine list is missing %s", want)
		}
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

func TestStaticFilesTellTheBrowserHowToCacheThem(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "assets"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("<html>app</html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "assets", "index-abc123.js"), []byte("console.log(1)"), 0o644); err != nil {
		t.Fatal(err)
	}
	server := &Server{cfg: config.Config{StaticDir: dir}}

	// The SPA shell (and any deep link that falls back to it) must be revalidated.
	for _, target := range []string{"/", "/files", "/apps/web-flask2/files"} {
		recorder := httptest.NewRecorder()
		server.handleSPA(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if got := recorder.Header().Get("Cache-Control"); !strings.Contains(got, "no-cache") {
			t.Errorf("%s -> Cache-Control %q, want no-cache", target, got)
		}
	}

	// A fingerprinted asset may be cached for a year.
	recorder := httptest.NewRecorder()
	server.handleSPA(recorder, httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil))
	if got := recorder.Header().Get("Cache-Control"); !strings.Contains(got, "immutable") {
		t.Errorf("an asset -> Cache-Control %q, want immutable", got)
	}

	// An unknown /api route still answers JSON, never the SPA.
	recorder = httptest.NewRecorder()
	server.handleSPA(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("an unknown API route = %d, want 404", recorder.Code)
	}
}

func TestSQLiteDataBrowserReadsTheFileItself(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	_, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "Browser DB", "websiteSlug": "admin-site",
	})
	var created struct {
		Database struct {
			ID string `json:"id"`
		} `json:"database"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	id := created.Database.ID

	// A statement creates a table and fills it — the daemon runs it itself, so no
	// client has to be installed for SQLite.
	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{
		"sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create table = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), `"kind":"exec"`) {
		t.Errorf("a non-select should report itself as exec: %s", body)
	}
	if _, body = panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{
		"sql": "INSERT INTO posts (title) VALUES ('halo'), ('dunia')",
	}); resp.StatusCode != http.StatusOK {
		t.Fatalf("insert = %d (%s)", resp.StatusCode, body)
	}

	// Tables list.
	resp, body = panel.do(t, http.MethodGet, "/api/v1/databases/"+id+"/tables", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tables = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), `"posts"`) || !strings.Contains(string(body), `"browser":"daemon"`) {
		t.Errorf("the table list is wrong: %s", body)
	}

	// A SELECT comes back as a grid, with NULLs made explicit.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{
		"sql": "SELECT id, title, NULL AS kosong FROM posts ORDER BY id",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("select = %d (%s)", resp.StatusCode, body)
	}
	var grid struct {
		Columns []string   `json:"columns"`
		Rows    [][]string `json:"rows"`
		Kind    string     `json:"kind"`
	}
	if err := json.Unmarshal(body, &grid); err != nil {
		t.Fatal(err)
	}
	if grid.Kind != "select" || len(grid.Columns) != 3 || len(grid.Rows) != 2 {
		t.Fatalf("the grid is wrong: %s", body)
	}
	if grid.Rows[0][1] != "halo" || grid.Rows[1][1] != "dunia" || grid.Rows[0][2] != "NULL" {
		t.Errorf("the values are wrong: %v", grid.Rows)
	}

	// A broken statement is a clear error, not a 200 with nothing in it.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{
		"sql": "SELECT FROM WHERE",
	})
	if resp.StatusCode == http.StatusOK {
		t.Errorf("a broken statement was accepted: %s", body)
	}

	// The query is audited, and the statement text is not stored.
	_, auditBody := panel.do(t, http.MethodGet, "/api/v1/audit?limit=20", nil)
	if !strings.Contains(string(auditBody), "database.query") {
		t.Errorf("the query was not audited: %s", auditBody)
	}
	if strings.Contains(string(auditBody), "CREATE TABLE posts") {
		t.Errorf("the statement text was stored in the audit trail: %s", auditBody)
	}
}

func TestDataBrowserRefusesWhatItCannotDoYet(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// A daemon engine: no browsing until the panel can scope arbitrary SQL.
	_, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "postgresql", "version": "16", "alias": "Reports",
	})
	var created struct {
		Database struct {
			ID string `json:"id"`
		} `json:"database"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases/"+created.Database.ID+"/query", map[string]string{
		"sql": "SELECT 1",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("a pending daemon database accepted arbitrary SQL: %d (%s)", resp.StatusCode, body)
	}

	// Another account's database is still a 404.
	panel.login(t, "alex")
	resp, _ = panel.do(t, http.MethodGet, "/api/v1/databases/"+created.Database.ID+"/tables", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("a tenant browsed another account's database: %d", resp.StatusCode)
	}
}

// databaseIDFrom pulls the ULID out of a create response.
func databaseIDFrom(t *testing.T, body []byte) string {
	t.Helper()
	for _, field := range strings.Split(string(body), `"id":"`) {
		if len(field) > 26 {
			return field[:26]
		}
	}
	t.Fatalf("no id in %s", body)
	return ""
}

func TestDatabaseGuiNeedsThePanelSession(t *testing.T) {
	panel := newTestPanel(t)

	// Nothing is reachable without a session: not the tool list, not a tool, and
	// not the manager's own path — including its pages and assets.
	for _, path := range []string{
		"/api/v1/databases/gui",
		"/api/v1/databases/anything/gui",
		"/api/v1/databases/anything/gui/pgweb",
		"/api/v1/databases/anything/gui/pgweb/",
		"/api/v1/databases/anything/gui/pgweb/static/js/app.js",
	} {
		resp, body := panel.do(t, http.MethodGet, path, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s without a session = %d (%s), want 401", path, resp.StatusCode, body)
		}
	}

	panel.login(t, "admin")
	_, created := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "Gui DB", "websiteSlug": "admin-site",
	})
	id := databaseIDFrom(t, created)

	// The gate lists the managers the daemon knows. The panel's own browser needs
	// nothing; pgweb's binary is not installed on this test host, so it is listed
	// but not available — the reason is reported, not hidden.
	resp, body := panel.do(t, http.MethodGet, "/api/v1/databases/"+id+"/gui", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tool list = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), `"tool":"browser"`) || !strings.Contains(string(body), `"available":true`) {
		t.Errorf("the tool list is wrong: %s", body)
	}
	for _, tool := range []string{"browser", "pgweb", "dbgate"} {
		if !strings.Contains(string(body), `"tool":"`+tool+`"`) {
			t.Errorf("the tool list is missing %s: %s", tool, body)
		}
	}
	if !strings.Contains(string(body), "not hosted yet") && !strings.Contains(string(body), "not hosted by this daemon yet") {
		t.Errorf("the unavailable dbgate should say why: %s", body)
	}
	// The path must use the real route segment ("databases"), not the ledger's
	// internal kind ("database"), or the UI would open a 404.
	if !strings.Contains(string(body), `"path":"/api/v1/databases/`+id+`/gui/browser"`) {
		t.Errorf("the browser path is wrong: %s", body)
	}

	// The built-in browser is the panel's own API, not a proxied page.
	resp, body = panel.do(t, http.MethodGet, "/api/v1/databases/"+id+"/gui/browser", nil)
	if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "/api/v1/databases/"+id+"/tables") {
		t.Errorf("browser gate = %d (%s)", resp.StatusCode, body)
	}

	// A manager that is not hosted is refused with the rule, not exposed on a port
	// of its own. The refusal is audited.
	resp, body = panel.do(t, http.MethodGet, "/api/v1/databases/"+id+"/gui/dbgate", nil)
	if resp.StatusCode != http.StatusNotImplemented {
		t.Errorf("dbgate = %d (%s), want 501", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "never on a port") {
		t.Errorf("the refusal should state the rule: %s", body)
	}
	_, auditBody := panel.do(t, http.MethodGet, "/api/v1/audit?limit=10", nil)
	if !strings.Contains(string(auditBody), "database.gui_open") {
		t.Errorf("opening a manager was not audited: %s", auditBody)
	}
}

// A record that was never actually created (a create whose client was missing),
// or one in the recycle bin, has no server to open — the panel says so at once,
// with the record's own note, instead of starting a tool that dies and waits out
// its timeout.
func TestGuiRecordBlockedExplainsWhy(t *testing.T) {
	if reason, blocked := guiRecordBlocked(&store.Database{Status: "ready"}); blocked {
		t.Errorf("a ready database must not be blocked: %q", reason)
	}
	reason, blocked := guiRecordBlocked(&store.Database{Status: "pending", Note: "psql is not installed on this host"})
	if !blocked || reason != "psql is not installed on this host" {
		t.Errorf("pending: blocked=%v reason=%q", blocked, reason)
	}
	reason, blocked = guiRecordBlocked(&store.Database{Status: "failed"})
	if !blocked || !strings.Contains(reason, "failed") {
		t.Errorf("failed: blocked=%v reason=%q", blocked, reason)
	}
	reason, blocked = guiRecordBlocked(&store.Database{Status: "ready", DeletedAt: "now"})
	if !blocked || !strings.Contains(reason, "recycle bin") {
		t.Errorf("binned: blocked=%v reason=%q", blocked, reason)
	}
}

// A PostgreSQL database is what pgweb can open: with the binary missing the panel
// says so (both at the gate and on the proxied path) instead of pretending.
func TestDatabaseGuiProxyRefusesWhenTheToolIsMissing(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	_, created := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "postgresql", "alias": "Proxy PG",
	})
	id := databaseIDFrom(t, created)

	for _, path := range []string{
		"/api/v1/databases/" + id + "/gui/pgweb",
		"/api/v1/databases/" + id + "/gui/pgweb/",
		"/api/v1/databases/" + id + "/gui/pgweb/static/js/app.js",
	} {
		resp, body := panel.do(t, http.MethodGet, path, nil)
		if resp.StatusCode != http.StatusNotImplemented {
			t.Errorf("%s = %d (%s), want 501 while pgweb is missing", path, resp.StatusCode, body)
		}
		if !strings.Contains(string(body), "not installed") {
			t.Errorf("%s should name the missing tool: %s", path, body)
		}
	}
}

// A manager the daemon cannot run for this engine is refused with that reason,
// and a file database is never mistaken for a server.
func TestDatabaseGuiProxyRefusesTheWrongEngine(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	_, created := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "sqlite", "alias": "Proxy SQLite", "websiteSlug": "admin-site",
	})
	id := databaseIDFrom(t, created)

	resp, body := panel.do(t, http.MethodGet, "/api/v1/databases/"+id+"/gui/pgweb/", nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("pgweb on sqlite = %d (%s), want 409", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "not_applicable") {
		t.Errorf("the refusal should carry not_applicable: %s", body)
	}
}

func TestGuiConnectionStringEncodesTheCredential(t *testing.T) {
	// A password with special characters must not change the meaning of the DSN.
	dsn := guiConnectionString(store.Database{
		Engine: "postgresql", User: "admin_shop", Name: "admin_shop_db",
		Host: "127.0.0.1", Port: 5432,
	}, "p@ss:w/rd?#")
	if !strings.HasPrefix(dsn, "postgres://admin_shop:") {
		t.Fatalf("the scheme or user is wrong: %s", dsn)
	}
	if strings.Contains(dsn, "p@ss:w/rd") && !strings.Contains(dsn, "p%40ss") {
		t.Errorf("the password was not encoded: %s", dsn)
	}
	if !strings.Contains(dsn, "@127.0.0.1:5432/admin_shop_db") {
		t.Errorf("the host, port or database is wrong: %s", dsn)
	}
}

// pgweb is told its prefix, but a root-absolute asset path or Location that it
// still emits is pointed at the mount — once, never twice.
func TestGuiResponseIsRebasedOntoTheMount(t *testing.T) {
	mount := "/api/v1/databases/01H/gui/pgweb"
	prefix := mount + "/"

	if got := rebaseGuiPath("/static/js/app.js", prefix); got != prefix+"static/js/app.js" {
		t.Errorf("root-absolute location = %q", got)
	}
	if got := rebaseGuiPath(prefix+"api/info", prefix); got != prefix+"api/info" {
		t.Errorf("an already-mounted location was changed: %q", got)
	}
	if got := rebaseGuiPath("static/js/app.js", prefix); got != "static/js/app.js" {
		t.Errorf("a relative location must be left alone: %q", got)
	}
	if got := rebaseGuiPath("https://example.com/x", prefix); got != "https://example.com/x" {
		t.Errorf("another origin must be left alone: %q", got)
	}

	html := `<link href="/static/css/app.css"><script src="` + prefix + `static/js/app.js"></script>`
	got := rebaseGuiRootPaths(html, prefix)
	want := `<link href="` + prefix + `static/css/app.css"><script src="` + prefix + `static/js/app.js"></script>`
	if got != want {
		t.Errorf("html rebasing wrong:\n got %s\nwant %s", got, want)
	}
}

func TestScopedQueryRefusesWhatItMust(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// A daemon engine on a host whose client is missing: honest, with the reason.
	_, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "postgresql", "version": "16", "alias": "Scoped",
	})
	var created struct {
		Database struct {
			ID string `json:"id"`
		} `json:"database"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	id := created.Database.ID

	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{"sql": "SELECT 1"})
	if resp.StatusCode == http.StatusOK {
		t.Fatalf("a statement was accepted: %s", body)
	}
	if !strings.Contains(string(body), "not installed") && !strings.Contains(string(body), "dry-run") {
		t.Errorf("the refusal should name the reason: %s", body)
	}

	// A suspended database is not queryable: that is what suspending means.
	if err := panel.store.BinDatabase(id); err != nil {
		t.Fatal(err)
	}
	resp, body = panel.do(t, http.MethodPost, "/api/v1/databases/"+id+"/query", map[string]string{"sql": "SELECT 1"})
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(body), "recycle bin") {
		t.Errorf("a binned database was queried: %d (%s)", resp.StatusCode, body)
	}

	// A detected file (the application's own) is queryable but not deletable.
	resp, _ = panel.do(t, http.MethodDelete, "/api/v1/databases/"+id, nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("binning a managed database = %d", resp.StatusCode)
	}
}

func TestDbEnginesSayWhereEachEngineRuns(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	_, body := panel.do(t, http.MethodGet, "/api/v1/db-engines", nil)
	var payload struct {
		Items []struct {
			Engine string `json:"engine"`
			Mode   string `json:"mode"`
			Note   string `json:"note"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Items) == 0 {
		t.Fatal("no engines reported")
	}
	for _, engine := range payload.Items {
		if engine.Mode == "" {
			t.Errorf("%s does not say where it runs: %s", engine.Engine, body)
		}
		if engine.Mode != "host" && engine.Mode != "docker" && engine.Mode != "none" {
			t.Errorf("%s reported an unknown mode %q", engine.Engine, engine.Mode)
		}
	}
	// On a test host without Docker, an engine that is nowhere must say so.
	for _, engine := range payload.Items {
		if engine.Mode == "none" && engine.Note == "" {
			t.Errorf("%s is in no mode without a reason", engine.Engine)
		}
	}
}
