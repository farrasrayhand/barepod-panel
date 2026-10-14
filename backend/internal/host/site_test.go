package host

import (
	"context"
	"os"
	"path/filepath"
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
