package phpfpm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

func TestConfigConfinesThePoolToItsSite(t *testing.T) {
	siteDir := "/home/alex/apps/shop"
	cfg := Config(Spec{Tenant: "alex", SiteDir: siteDir, Socket: SocketIn(siteDir), MemoryMB: 512})
	for _, want := range []string{
		"listen = " + siteDir + "/fpm.sock",
		"listen.mode = 0660",
		"user = alex",
		"group = alex",
		"open_basedir] = " + siteDir + ":/tmp",
		"memory_limit] = 512M",
		"chdir = " + siteDir,
		"pm = ondemand",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("pool config is missing %q:\n%s", want, cfg)
		}
	}
}

func TestMaxChildrenFollowsTheMemoryPackage(t *testing.T) {
	cases := []struct{ memoryMB, want int }{{0, 5}, {64, 2}, {512, 8}, {4096, 20}}
	for _, c := range cases {
		if got := MaxChildren(c.memoryMB); got != c.want {
			t.Errorf("MaxChildren(%d) = %d, want %d", c.memoryMB, got, c.want)
		}
	}
}

func TestWritePlacesThePoolInTheSite(t *testing.T) {
	dir := t.TempDir()
	siteDir := filepath.Join(dir, "shop")
	if err := os.MkdirAll(siteDir, 0o750); err != nil {
		t.Fatal(err)
	}
	h := &host.Host{Runner: &host.DryRunner{}}
	path, err := Write(context.Background(), h, Spec{Tenant: "alex", SiteDir: siteDir, Socket: SocketIn(siteDir)})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if path != filepath.Join(siteDir, "php-fpm.conf") {
		t.Errorf("path = %q, want <site>/php-fpm.conf (what the unit's ExecStart reads)", path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the pool config was not written: %v", err)
	}
	if _, err := Write(context.Background(), h, Spec{SiteDir: siteDir}); err == nil {
		t.Error("a pool with no tenant was accepted")
	}
}
