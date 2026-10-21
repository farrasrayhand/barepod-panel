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
	if _, err := Commands("tomcat", ""); err == nil {
		t.Error("an engine outside the allowlist was accepted")
	}
	// Apache and OpenLiteSpeed are in it: the version manager offers them.
	if _, err := Commands("openlitespeed", ""); err != nil {
		t.Errorf("openlitespeed is allowed but was refused: %v", err)
	}
	if _, err := Commands("php", ""); err == nil {
		t.Error("php without a version was accepted")
	}
	if _, err := Commands("php", "8.3; rm -rf /"); err == nil {
		t.Error("a version that is not a version was accepted")
	}
	if _, err := Commands("nginx", "1.2"); err != nil {
		t.Errorf("nginx takes a version but was refused: %v", err)
	}

	// A web server install first adds the project's own repository (the distribution pins
	// one version), then installs the package.
	caddy, err := Commands("caddy", "")
	if err != nil || len(caddy) < 2 || !strings.Contains(strings.Join(flatten(caddy), " "), "apt-get") {
		t.Fatalf("caddy commands = %v (%v)", caddy, err)
	}
	joinedCaddy := strings.Join(flatten(caddy), " ")
	if !strings.Contains(joinedCaddy, "caddy-stable") {
		t.Errorf("caddy commands do not add caddy's own repository: %v", caddy)
	}
	// And asking for one version pins it through what the repository carries.
	pinned, _ := Commands("caddy", "2.10")
	joinedPinned := strings.Join(flatten(pinned), " ")
	if !strings.Contains(joinedPinned, "apt-cache madison caddy") || !strings.Contains(joinedPinned, `caddy="$V"`) {
		t.Errorf("a pinned caddy install does not resolve the version: %v", pinned)
	}
	php, _ := Commands("php", "8.3")
	joinedPHP := strings.Join(flatten(php), " ")
	if !strings.Contains(joinedPHP, "php8.3-fpm") {
		t.Errorf("php commands do not install the fpm package: %v", php)
	}
	// A PHP install installs the core packages and scans available repository extensions.
	for _, want := range []string{"packages.sury.org", "php8.3-cli", "php8.3-fpm", "apt-cache search"} {
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

func TestInstallRefusesAVersionTheHostDoesNotOffer(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	runner := &host.DryRunner{}
	h := &host.Host{Runner: runner, SitesRoot: filepath.Join(dir, "home"), VHostsDir: filepath.Join(dir, "vhosts")}
	installer := New(st, h)

	// A dry-run host's repositories answer nothing, so the catalog's list stands in for
	// them: what it names works, what it does not is refused.
	if _, err := installer.Start("php", "8.0"); err == nil {
		t.Error("a PHP version the host does not offer was accepted")
	}
	if _, err := installer.Start("php", "8.3"); err != nil {
		t.Errorf("a PHP version the host offers was refused: %v", err)
	}
}

func TestOnlyOneInstallRunsAtATime(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h := &host.Host{Runner: &host.DryRunner{}, SitesRoot: filepath.Join(dir, "home"), VHostsDir: filepath.Join(dir, "vhosts")}
	installer := New(st, h)

	// Two installs at once share one package lock, so the second is refused with the name
	// of the first rather than being left to fail on dpkg.
	first, err := installer.Start("caddy", "")
	if err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if _, err := installer.Start("nginx", ""); err == nil {
		t.Error("a second install was accepted while the first was running")
	}
	_ = first

	deadline := time.Now().Add(5 * time.Second)
	for installer.claim("probe") != nil {
		if time.Now().After(deadline) {
			t.Fatal("the first install never released its claim")
		}
		time.Sleep(20 * time.Millisecond)
	}
	installer.release()
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
	// The command carries the lock wait: an install must queue behind apt, not fail on it.
	for _, want := range []string{"apt-get", "install", "-y", "caddy", "DPkg::Lock::Timeout=600"} {
		if !strings.Contains(joined, want) {
			t.Errorf("the install command is missing %q: %s", want, joined)
		}
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

func TestDetectCachedAndInvalidation(t *testing.T) {
	dir := t.TempDir()
	st, err := store.Open(filepath.Join(dir, "panel.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	h := &host.Host{Runner: &host.DryRunner{}, SitesRoot: filepath.Join(dir, "home")}

	InvalidateCache()
	res1 := DetectCached(context.Background(), st, h, func(string) (string, error) { return "", os.ErrNotExist }, false)
	if res1.WebServer.Active != "nginx" {
		t.Fatalf("res1 active = %q, want nginx", res1.WebServer.Active)
	}

	// Cache hit should return immediately
	res2 := DetectCached(context.Background(), st, h, func(string) (string, error) { return "", os.ErrNotExist }, false)
	if res2.WebServer.Active != "nginx" {
		t.Fatalf("res2 active = %q, want nginx", res2.WebServer.Active)
	}

	// Change panel setting
	_ = st.SavePanelSetting("active_web_server", "caddy")
	res3 := DetectCached(context.Background(), st, h, func(string) (string, error) { return "", os.ErrNotExist }, false)
	if res3.WebServer.Active != "caddy" {
		t.Fatalf("res3 active = %q, want caddy to reflect active store setting", res3.WebServer.Active)
	}

	// Invalidation clears cache
	InvalidateCache()
	res4 := DetectCached(context.Background(), st, h, func(string) (string, error) { return "", os.ErrNotExist }, false)
	if res4.WebServer.Active != "caddy" {
		t.Fatalf("res4 active = %q, want caddy after fresh detect", res4.WebServer.Active)
	}
}

// scriptRunner answers only the systemctl probes databaseUnit needs.
type scriptRunner struct {
	active    map[string]string
	installed map[string]bool
}

func (r scriptRunner) Run(_ context.Context, _ string, name string, args ...string) (string, error) {
	if name == "systemctl" && len(args) >= 2 {
		unit := args[1]
		switch args[0] {
		case "is-active":
			return r.active[unit], nil
		case "status":
			if r.installed[unit] {
				return "loaded", nil
			}
			return "Unit " + unit + ".service could not be found.", os.ErrNotExist
		}
	}
	return "", nil
}
func (r scriptRunner) RunAs(context.Context, string, string, string, ...string) (string, error) {
	return "", nil
}
func (r scriptRunner) RunEnv(context.Context, string, []string, string, ...string) (string, error) {
	return "", nil
}
func (r scriptRunner) Mode() string { return "test" }

func TestDatabaseUnitHandlesMySQLAndMariaDB(t *testing.T) {
	mysql := scriptRunner{active: map[string]string{"mysql": "active", "mariadb": ""}, installed: map[string]bool{"mysql": true}}
	if unit, active, installed := databaseUnit(context.Background(), mysql); unit != "mysql" || !active || !installed {
		t.Fatalf("mysql host = (%q, %v, %v), want (mysql, true, true)", unit, active, installed)
	}
	maria := scriptRunner{active: map[string]string{"mysql": "", "mariadb": "active"}, installed: map[string]bool{"mariadb": true}}
	if unit, active, installed := databaseUnit(context.Background(), maria); unit != "mariadb" || !active || !installed {
		t.Fatalf("mariadb host = (%q, %v, %v), want (mariadb, true, true)", unit, active, installed)
	}
	// Installed but stopped: the caller must be able to start the right unit.
	stopped := scriptRunner{active: map[string]string{"mysql": "inactive"}, installed: map[string]bool{"mysql": true}}
	if unit, active, installed := databaseUnit(context.Background(), stopped); unit != "mysql" || active || !installed {
		t.Fatalf("stopped mysql = (%q, %v, %v), want (mysql, false, true)", unit, active, installed)
	}
	// Neither unit: do not claim a repair.
	none := scriptRunner{active: map[string]string{}, installed: map[string]bool{}}
	if _, active, installed := databaseUnit(context.Background(), none); active || installed {
		t.Fatalf("absent database = active=%v installed=%v, want false/false", active, installed)
	}
}
