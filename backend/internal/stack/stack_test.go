package stack

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestCommandsAreAllowlisted(t *testing.T) {
	if _, err := Commands("openlitespeed", ""); err == nil {
		t.Error("an engine outside the allowlist was accepted")
	}
	if _, err := Commands("php", ""); err == nil {
		t.Error("php without a version was accepted")
	}
	if _, err := Commands("php", "9.9"); err == nil {
		t.Error("a version the panel does not offer was accepted")
	}
	if _, err := Commands("nginx", "1.2"); err != nil {
		t.Errorf("nginx takes no version but was refused: %v", err)
	}

	caddy, err := Commands("caddy", "")
	if err != nil || len(caddy) != 1 || caddy[0][0] != "apt-get" {
		t.Fatalf("caddy commands = %v (%v)", caddy, err)
	}
	php, _ := Commands("php", "8.3")
	joinedPHP := strings.Join(flatten(php), " ")
	if !strings.Contains(joinedPHP, "php8.3-fpm") {
		t.Errorf("php commands do not install the fpm package: %v", php)
	}
	// A PHP install is full: the extensions Settings toggles later must already be there.
	for _, want := range []string{"php8.3-gd", "php8.3-intl", "php8.3-mysql", "php8.3-opcache", "sury.org"} {
		if !strings.Contains(joinedPHP, want) {
			t.Errorf("php commands are missing %q", want)
		}
	}
	node, _ := Commands("node", "22")
	joinedNode := strings.Join(flatten(node), " ")
	if !strings.Contains(joinedNode, "nodejs.org/dist") || !strings.Contains(joinedNode, "\\.[0-9.]*") {
		t.Errorf("node is not installed from the official tarball for the major: %v", node)
	}
}

func flatten(cmds [][]string) []string {
	out := make([]string, 0, len(cmds))
	for _, c := range cmds {
		out = append(out, strings.Join(c, " "))
	}
	return out
}

func TestInstallerDryRunRecordsAndInstallsNothing(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	runner := &host.DryRunner{}
	h := &host.Host{Runner: runner, SitesRoot: filepath.Join(dir, "home"), VHostsDir: filepath.Join(dir, "vhosts")}

	job, err := New(st, h).Start("caddy", "")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		current, err := st.DeployJob(job.ID)
		if err != nil {
			t.Fatal(err)
		}
		if current.Status == "success" || current.Status == "failed" {
			if current.Status != "success" {
				t.Fatalf("install job failed: %s", current.Error)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("install job did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
	joined := strings.Join(runner.Commands(), " | ")
	if !strings.Contains(joined, "apt-get install -y caddy") {
		t.Errorf("the install command was not recorded: %s", joined)
	}
	logs, _ := st.DeployLogs(job.ID, 0)
	var sawDryRun bool
	for _, l := range logs {
		if strings.Contains(l.Line, "[dry-run]") {
			sawDryRun = true
		}
	}
	if !sawDryRun {
		t.Error("a dry-run install did not say that nothing was installed")
	}
}

func TestDetectReportsBothEnginesAndTheActiveOne(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h := &host.Host{Runner: &host.DryRunner{}, SitesRoot: filepath.Join(dir, "home")}

	got := Detect(context.Background(), st, h, func(string) (string, error) { return "", os.ErrNotExist })
	if got.WebServer.Active != "nginx" {
		t.Errorf("active engine = %q, want the default nginx", got.WebServer.Active)
	}
	if len(got.WebServer.Supported) != 2 {
		t.Fatalf("supported engines = %v, want nginx and caddy", got.WebServer.Supported)
	}
	if len(got.Components) == 0 {
		t.Error("no components were offered")
	}
	for _, status := range got.WebServer.Installed {
		if status.Installed {
			t.Errorf("%s reported installed though LookPath failed", status.Engine)
		}
	}
}
