package deploy

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func newTestManager(t *testing.T) (*Manager, *store.Store, *host.Host, []byte, string) {
	t.Helper()
	dir := t.TempDir()

	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	h := &host.Host{
		Runner:    &host.DryRunner{},
		SitesRoot: filepath.Join(dir, "home"),
		UnitsDir:  filepath.Join(dir, "units"),
	}
	key := make([]byte, 32)
	return NewManager(st, h, key), st, h, key, dir
}

func waitForJob(t *testing.T, st *store.Store, id string) *store.DeployJob {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		job, err := st.DeployJob(id)
		if err != nil {
			t.Fatalf("load job: %v", err)
		}
		if isTerminal(job.Status) {
			return job
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("deploy job did not finish in time")
	return nil
}

func isTerminal(status string) bool { return status == "success" || status == "failed" }

func TestPipelineDryRunSucceeds(t *testing.T) {
	m, st, h, key, _ := newTestManager(t)

	site := &store.Website{
		Slug: "demo-app", Domain: "demo.example.com", TenantUser: "tester",
		Runtime: "laravel", Version: "12", Framework: "laravel", WebServer: "nginx",
		Status: "stopped", DeployStatus: "pending", Port: 8001, SSL: true,
	}
	site.Runtime = "php"
	if err := st.CreateWebsite(site); err != nil {
		t.Fatalf("create website: %v", err)
	}

	job, err := m.Start(Request{
		Slug: "demo-app", Tenant: "tester", Domain: "demo.example.com",
		Runtime: "php", Version: "8.4", Framework: "laravel", FrameworkVersion: "12",
		WebServer: "nginx", Port: 8001, SSL: true,
		Source:   SourceSpec{Kind: "scaffold"},
		Database: &DatabaseSpec{Engine: "sqlite", Name: "demo"},
		Cache:    &CacheSpec{Engine: "redis", Version: "7.2"},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if job.Mode != "dry-run" {
		t.Fatalf("job mode = %q, want dry-run", job.Mode)
	}

	finished := waitForJob(t, st, job.ID)
	if finished.Status != "success" {
		logs, _ := st.DeployLogs(job.ID, 0)
		var b strings.Builder
		for _, l := range logs {
			b.WriteString(l.Stream + ": " + l.Line + "\n")
		}
		t.Fatalf("job status = %q, error = %q\n%s", finished.Status, finished.Error, b.String())
	}
	if finished.Step != finished.TotalSteps || finished.TotalSteps != 8 {
		t.Fatalf("finished at step %d/%d, want 8/8", finished.Step, finished.TotalSteps)
	}

	logs, err := st.DeployLogs(job.ID, 0)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	var stepCount int
	var sawLastStep, sawDryRunNote bool
	for _, l := range logs {
		if l.Stream == "step" {
			stepCount++
		}
		if strings.Contains(l.Line, "[8/8]") {
			sawLastStep = true
		}
		if strings.Contains(l.Line, "[dry-run]") {
			sawDryRunNote = true
		}
	}
	if stepCount != 8 {
		t.Errorf("step lines = %d, want 8", stepCount)
	}
	if !sawLastStep {
		t.Error("log does not reach the final step")
	}
	if !sawDryRunNote {
		t.Error("dry-run ran without telling the user")
	}

	// A dry-run must not claim the website is running.
	updated, err := st.WebsiteBySlug("demo-app")
	if err != nil {
		t.Fatal(err)
	}
	if updated.DeployStatus != "ready" {
		t.Errorf("deployStatus = %q, want ready", updated.DeployStatus)
	}
	if updated.Status != "stopped" {
		t.Errorf("status = %q, want stopped (nothing was started in dry-run)", updated.Status)
	}

	siteDir := h.SitePath("tester", "demo-app")
	if _, err := os.Stat(filepath.Join(siteDir, ".env")); err != nil {
		t.Errorf(".env was not written: %v", err)
	}
	env, err := os.ReadFile(filepath.Join(siteDir, ".env"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"APP_DOMAIN=demo.example.com", "DB_CONNECTION=sqlite", "CACHE_URL=redis://"} {
		if !strings.Contains(string(env), want) {
			t.Errorf(".env is missing %q", want)
		}
	}
	if _, err := os.Stat(filepath.Join(siteDir, "demo.sqlite")); err != nil {
		t.Errorf("sqlite file was not created: %v", err)
	}
	if _, err := os.Stat(filepath.Join(h.UnitsDir, "barepod-app@demo-app.service.d", "override.conf")); err != nil {
		t.Errorf("systemd drop-in was not written: %v", err)
	}

	// The cache password must be stored encrypted and be recoverable with the key.
	ciphertext, err := st.WebsiteSecret("demo-app", "cache_password")
	if err != nil {
		t.Fatalf("cache secret missing: %v", err)
	}
	if strings.Contains(ciphertext, "redis://") || !strings.HasPrefix(ciphertext, "v1:") {
		t.Errorf("cache secret does not look encrypted: %q", ciphertext)
	}
	plain, err := secrets.Decrypt(key, ciphertext)
	if err != nil {
		t.Fatalf("decrypt cache secret: %v", err)
	}
	if plain == "" {
		t.Error("decrypted cache password is empty")
	}
}

func TestPipelineFailsWhenExistingDirectoryIsEmpty(t *testing.T) {
	m, st, h, _, _ := newTestManager(t)

	// The directory exists (the panel created it) but nothing was uploaded yet.
	if _, err := h.EnsureSiteDir(context.Background(), "tester", "empty-app"); err != nil {
		t.Fatal(err)
	}
	site := &store.Website{
		Slug: "empty-app", Domain: "empty.example.com", TenantUser: "tester",
		Runtime: "nodejs", Version: "22", WebServer: "caddy",
		Status: "stopped", DeployStatus: "pending", Port: 4000,
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}

	job, err := m.Start(Request{
		Slug: "empty-app", Tenant: "tester", Domain: "empty.example.com",
		Runtime: "nodejs", Version: "22", WebServer: "caddy", Port: 4000,
		Source: SourceSpec{Kind: "existing"},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	finished := waitForJob(t, st, job.ID)
	if finished.Status != "failed" {
		t.Fatalf("status = %q, want failed for an empty directory", finished.Status)
	}
	if !strings.Contains(finished.Error, "is empty") {
		t.Errorf("error = %q, want an empty-directory message", finished.Error)
	}
}

func TestPipelineUsesExistingFiles(t *testing.T) {
	m, st, h, _, _ := newTestManager(t)

	// Simulate: directory created from the panel, code uploaded by the File Manager.
	if _, err := h.EnsureSiteDir(context.Background(), "tester", "uploaded-app"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.SitePath("tester", "uploaded-app"), "index.js"), []byte("// app"), 0o640); err != nil {
		t.Fatal(err)
	}
	site := &store.Website{
		Slug: "uploaded-app", Domain: "uploaded.example.com", TenantUser: "tester",
		Runtime: "nodejs", Version: "22", WebServer: "caddy",
		Status: "stopped", DeployStatus: "pending", Port: 4001,
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}

	job, err := m.Start(Request{
		Slug: "uploaded-app", Tenant: "tester", Domain: "uploaded.example.com",
		Runtime: "nodejs", Version: "22", WebServer: "caddy", Port: 4001,
		Source: SourceSpec{Kind: "existing"},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	finished := waitForJob(t, st, job.ID)
	if finished.Status != "success" {
		logs, _ := st.DeployLogs(job.ID, 0)
		var b strings.Builder
		for _, l := range logs {
			b.WriteString(l.Stream + ": " + l.Line + "\n")
		}
		t.Fatalf("status = %q, error = %q\n%s", finished.Status, finished.Error, b.String())
	}
	if !h.SiteExists("tester", "uploaded-app") {
		t.Error("existing files were not preserved")
	}
}

func TestPipelineFailsWhenExistingDirectoryIsMissing(t *testing.T) {
	m, st, _, _, _ := newTestManager(t)

	site := &store.Website{
		Slug: "no-files", Domain: "nofiles.example.com", TenantUser: "tester",
		Runtime: "nodejs", Version: "22", WebServer: "caddy",
		Status: "stopped", DeployStatus: "pending", Port: 3000,
	}
	if err := st.CreateWebsite(site); err != nil {
		t.Fatal(err)
	}

	job, err := m.Start(Request{
		Slug: "no-files", Tenant: "tester", Domain: "nofiles.example.com",
		Runtime: "nodejs", Version: "22", WebServer: "caddy", Port: 3000,
		Source: SourceSpec{Kind: "existing"},
	})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	finished := waitForJob(t, st, job.ID)
	if finished.Status != "failed" {
		t.Fatalf("status = %q, want failed", finished.Status)
	}
	if !strings.Contains(finished.Error, "no directory found") {
		t.Errorf("error = %q, want a missing-directory message", finished.Error)
	}

	updated, err := st.WebsiteBySlug("no-files")
	if err != nil {
		t.Fatal(err)
	}
	if updated.DeployStatus != "failed" {
		t.Errorf("deployStatus = %q, want failed", updated.DeployStatus)
	}
}
