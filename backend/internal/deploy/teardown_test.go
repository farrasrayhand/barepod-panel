package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestTeardownRemovesServiceFilesAndRecords(t *testing.T) {
	m, st, h, _, _ := newTestManager(t)

	site := &store.Website{
		Slug: "to-remove", Domain: "remove.example.com", TenantUser: "tester",
		Runtime: "nodejs", Version: "22", WebServer: "caddy",
		Status: "running", DeployStatus: "ready", Port: 4002,
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}
	dir, err := h.EnsureSiteDir(context.Background(), "tester", "to-remove")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("// app"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := st.PutWebsiteSecret("to-remove", "database_password", "v1:ciphertext"); err != nil {
		t.Fatal(err)
	}

	steps, err := m.Teardown(context.Background(), "to-remove")
	if err != nil {
		t.Fatalf("Teardown: %v", err)
	}
	if len(steps) == 0 {
		t.Error("teardown reported no steps")
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("the site directory still exists: %v", err)
	}
	if _, err := st.WebsiteBySlug("to-remove"); err != store.ErrNotFound {
		t.Errorf("the website row survived: %v", err)
	}
	if _, err := st.WebsiteSecret("to-remove", "database_password"); err != store.ErrNotFound {
		t.Errorf("the stored secret survived: %v", err)
	}
	if !strings.Contains(strings.Join(steps, " "), "deleted") {
		t.Errorf("steps = %v, want the deletion reported", steps)
	}
}

func TestTeardownUnknownSite(t *testing.T) {
	m, _, _, _, _ := newTestManager(t)
	if _, err := m.Teardown(context.Background(), "nope"); err != store.ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestGuardedRemoveRefusesDangerousPaths(t *testing.T) {
	root := t.TempDir()
	tenantHome := filepath.Join(root, "tester")
	siteDir := filepath.Join(tenantHome, "apps", "demo")
	if err := os.MkdirAll(siteDir, 0o750); err != nil {
		t.Fatal(err)
	}

	// The root itself, a tenant home and anything outside the root are refused.
	for _, target := range []string{root, tenantHome, filepath.Dir(root), "/etc"} {
		if err := guardedRemoveAll(root, target); err == nil {
			t.Errorf("guardedRemoveAll(%q) was allowed", target)
		}
	}
	// A real site directory is removed.
	if err := guardedRemoveAll(root, siteDir); err != nil {
		t.Fatalf("guardedRemoveAll(site) = %v", err)
	}
	if _, err := os.Stat(siteDir); !os.IsNotExist(err) {
		t.Error("the site directory was not removed")
	}
	// A sibling that merely shares the prefix must not be touched.
	sibling := root + "-evil"
	if err := os.MkdirAll(sibling, 0o750); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.RemoveAll(sibling) }()
	if err := guardedRemoveAll(root, sibling); err == nil {
		t.Error("a sibling sharing the prefix was allowed")
	}
	if _, err := os.Stat(sibling); err != nil {
		t.Errorf("the sibling directory was removed: %v", err)
	}
}

func TestRedeployKeepsExistingDatabaseAndCache(t *testing.T) {
	// A redeploy must not try to create the database or the cache again: the
	// steps say so instead of quietly re-provisioning.
	_, st, h, _, _ := newTestManager(t)
	site := &store.Website{
		Slug: "keep-db", Domain: "keep.example.com", TenantUser: "tester",
		Runtime: "nodejs", Version: "22", WebServer: "caddy",
		Status: "running", DeployStatus: "ready", Port: 4003, SourceKind: "existing",
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}
	if _, err := h.EnsureSiteDir(context.Background(), "tester", "keep-db"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.SitePath("tester", "keep-db"), "index.js"), []byte("//x"), 0o640); err != nil {
		t.Fatal(err)
	}

	m := NewManager(st, h, make([]byte, 32))
	job, err := m.Start(Request{
		Slug: "keep-db", Tenant: "tester", Domain: "keep.example.com",
		Runtime: "nodejs", Version: "22", WebServer: "caddy", Port: 4003,
		Source: SourceSpec{Kind: "existing"}, Redeploy: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	finished := waitForJob(t, st, job.ID)
	if finished.Status != "success" {
		t.Fatalf("redeploy status = %q, error = %q", finished.Status, finished.Error)
	}
	logs, _ := st.DeployLogs(job.ID, 0)
	joined := ""
	for _, l := range logs {
		joined += l.Line + "\n"
	}
	if !strings.Contains(joined, "redeploy keeps the existing database") {
		t.Errorf("the log does not explain the skipped database:\n%s", joined)
	}
}
