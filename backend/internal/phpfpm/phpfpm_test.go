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
		"listen.mode = 0666",
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
	cases := []struct{ memoryMB, want int }{{64, 2}, {512, 8}, {4096, 20}}
	for _, c := range cases {
		if got := MaxChildren(c.memoryMB); got != c.want {
			t.Errorf("MaxChildren(%d) = %d, want %d", c.memoryMB, got, c.want)
		}
	}
}

func TestAutoMaxChildrenScalesWithHostSpecs(t *testing.T) {
	cases := []struct {
		name               string
		pkgMB, hostMB, cpu int
		want               int
	}{
		{"unknown host fallback", 0, 0, 0, 10},
		{"1GB 1vCPU", 0, 1024, 1, 5},
		{"2GB 2vCPU", 0, 2048, 2, 8},
		{"4GB 2vCPU", 0, 4096, 2, 8},
		{"8GB 4vCPU", 0, 7937, 4, 16},
		{"16GB 8vCPU", 0, 16384, 8, 32},
		{"64GB 16vCPU capped", 0, 65536, 16, 32},
		{"package limit overrides host", 512, 7937, 4, 8},
	}
	for _, c := range cases {
		if got := AutoMaxChildren(c.pkgMB, c.hostMB, c.cpu); got != c.want {
			t.Errorf("%s: AutoMaxChildren(%d, %d, %d) = %d, want %d", c.name, c.pkgMB, c.hostMB, c.cpu, got, c.want)
		}
	}
}

func TestAutoTuneScalesMemoryAndIdleTimeout(t *testing.T) {
	small := AutoTune(0, 1024, 1)
	if small.MemoryLimitMB != 256 || small.ProcessIdleTimeout != "10s" || small.MaxRequests != 500 {
		t.Errorf("unexpected small host profile: %+v", small)
	}
	medium := AutoTune(0, 4096, 4)
	if medium.MemoryLimitMB != 384 || medium.ProcessIdleTimeout != "20s" || medium.MaxRequests != 1000 {
		t.Errorf("unexpected medium host profile: %+v", medium)
	}
	large := AutoTune(0, 7937, 4)
	if large.MaxChildren != 16 || large.MemoryLimitMB != 512 || large.ProcessIdleTimeout != "30s" || large.MaxRequests != 1000 {
		t.Errorf("unexpected large host profile: %+v", large)
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
