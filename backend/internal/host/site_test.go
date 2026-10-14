package host

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMigrateLegacyTenants(t *testing.T) {
	root := t.TempDir()
	tenant := "tenant_tester"
	home := filepath.Join(root, tenant)
	appsDir := filepath.Join(home, "apps")
	siteDir := filepath.Join(appsDir, "old-site")

	if err := os.MkdirAll(siteDir, 0o750); err != nil {
		t.Fatal(err)
	}
	sampleFile := filepath.Join(siteDir, "index.html")
	if err := os.WriteFile(sampleFile, []byte("<h1>Legacy</h1>"), 0o640); err != nil {
		t.Fatal(err)
	}

	h := &Host{Runner: &DryRunner{}, SitesRoot: root}
	if err := h.MigrateLegacyTenants(context.Background()); err != nil {
		t.Fatalf("MigrateLegacyTenants failed: %v", err)
	}

	// Target web/old-site must now exist and hold the file
	targetFile := filepath.Join(home, "web", "old-site", "index.html")
	if data, err := os.ReadFile(targetFile); err != nil || string(data) != "<h1>Legacy</h1>" {
		t.Errorf("expected migrated file in web/old-site: %v", err)
	}

	// apps/ must now be a symlink to web
	fi, err := os.Lstat(appsDir)
	if err != nil {
		t.Fatalf("apps dir missing: %v", err)
	}
	if fi.Mode()&os.ModeSymlink == 0 {
		t.Errorf("expected apps to be a symlink to web")
	}

	// SitePath must return the web path
	got := h.SitePath(tenant, "old-site")
	want := filepath.Join(home, "web", "old-site")
	if got != want {
		t.Errorf("SitePath = %q, want %q", got, want)
	}
}

func TestEnsureDeployKeyGeneratesValidKey(t *testing.T) {
	root := t.TempDir()
	tenant := "deploy_user"
	slug := "test-app"

	h := &Host{Runner: &DryRunner{}, SitesRoot: root}
	key1, err := h.EnsureDeployKey(context.Background(), tenant, slug)
	if err != nil {
		t.Fatalf("EnsureDeployKey failed: %v", err)
	}
	if key1.Algorithm != "ED25519" {
		t.Errorf("expected algorithm ED25519, got %q", key1.Algorithm)
	}
	if !strings.HasPrefix(key1.PublicKey, "ssh-ed25519") {
		t.Errorf("expected public key to start with ssh-ed25519, got %q", key1.PublicKey)
	}
	if !strings.HasPrefix(key1.Fingerprint, "SHA256:") {
		t.Errorf("expected fingerprint to start with SHA256:, got %q", key1.Fingerprint)
	}

	// Calling EnsureDeployKey again returns the same key
	key2, err := h.EnsureDeployKey(context.Background(), tenant, slug)
	if err != nil {
		t.Fatalf("second EnsureDeployKey failed: %v", err)
	}
	if key2.PublicKey != key1.PublicKey {
		t.Errorf("expected identical public key, got %q vs %q", key2.PublicKey, key1.PublicKey)
	}

	// RotateDeployKey produces a new key
	key3, err := h.RotateDeployKey(context.Background(), tenant, slug)
	if err != nil {
		t.Fatalf("RotateDeployKey failed: %v", err)
	}
	if key3.PublicKey == key1.PublicKey {
		t.Errorf("expected rotated public key to differ from original")
	}
}

func TestFetchSourceExistingGitRepoUsesFetchAndReset(t *testing.T) {
	root := t.TempDir()
	tenant := "repo_tenant"
	slug := "my-repo"

	runner := &DryRunner{}
	h := &Host{Runner: runner, SitesRoot: root}
	siteDir, err := h.EnsureSiteDir(context.Background(), tenant, slug)
	if err != nil {
		t.Fatal(err)
	}

	// Simulate existing .git directory
	gitDir := filepath.Join(siteDir, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}

	cmds, err := h.FetchSource(context.Background(), tenant, slug, "github", "https://github.com/org/repo.git", "main")
	if err != nil {
		t.Fatalf("FetchSource failed: %v", err)
	}

	joined := strings.Join(cmds, " ")
	if strings.Contains(joined, "clone") {
		t.Errorf("existing git repo should NOT clone again: %s", joined)
	}
	if !strings.Contains(joined, "fetch origin main") {
		t.Errorf("expected git fetch origin main, got %s", joined)
	}
	if !strings.Contains(joined, "reset --hard origin/main") {
		t.Errorf("expected git reset --hard origin/main, got %s", joined)
	}
}

func TestDetectGit(t *testing.T) {
	root := t.TempDir()
	tenant := "git_detect_user"
	slug := "detect-app"

	runner := &DryRunner{}
	h := &Host{Runner: runner, SitesRoot: root}
	siteDir, err := h.EnsureSiteDir(context.Background(), tenant, slug)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Without .git, should not detect
	res, err := h.DetectGit(context.Background(), tenant, slug)
	if err != nil {
		t.Fatal(err)
	}
	if res.Detected {
		t.Errorf("expected detected=false when .git is absent")
	}

	// 2. With .git directory, should detect
	gitDir := filepath.Join(siteDir, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}

	res, err = h.DetectGit(context.Background(), tenant, slug)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Detected {
		t.Errorf("expected detected=true when .git exists")
	}
}

