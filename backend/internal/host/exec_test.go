package host

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// realRecorder pretends to be a real host so tests can see what would be run.
type realRecorder struct{ commands []string }

func (r *realRecorder) Run(_ context.Context, dir, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	if dir != "" {
		line = "(cd " + dir + " && " + line + ")"
	}
	r.commands = append(r.commands, line)
	return "", nil
}

func (r *realRecorder) RunAs(_ context.Context, username, dir, name string, args ...string) (string, error) {
	r.commands = append(r.commands, "(as "+username+", cd "+dir+" && "+name+" "+strings.Join(args, " ")+")")
	return "", nil
}

func (r *realRecorder) RunEnv(_ context.Context, dir string, env []string, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	if len(env) > 0 {
		line = "(env " + strings.Join(env, " ") + ") " + line
	}
	r.commands = append(r.commands, line)
	return "", nil
}

func (*realRecorder) Mode() string { return "real" }

func TestDryRunnerRecordsTheUserItWouldRunAs(t *testing.T) {
	runner := &DryRunner{}
	if _, err := runner.RunAs(context.Background(), "bptest", "/home/bptest/apps/demo", "python3", "-m", "venv", ".venv"); err != nil {
		t.Fatalf("RunAs: %v", err)
	}

	commands := runner.Commands()
	want := "(as bptest, cd /home/bptest/apps/demo && python3 -m venv .venv)"
	if len(commands) != 1 || commands[0] != want {
		t.Errorf("commands = %v, want [%q]", commands, want)
	}
}

func TestDryRunnerLeavesPlainCommandsAlone(t *testing.T) {
	runner := &DryRunner{}
	if _, err := runner.Run(context.Background(), "/tmp", "ls", "-la"); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := runner.Commands()[0]; got != "(cd /tmp && ls -la)" {
		t.Errorf("command = %q", got)
	}
}

func TestRealRunnerRunAsRejectsUnknownUsers(t *testing.T) {
	// The daemon must fail loudly instead of silently running as root.
	if _, err := (RealRunner{}).RunAs(context.Background(), "barepod-no-such-user", "", "true"); err == nil {
		t.Fatal("RunAs accepted a user that does not exist")
	}
}

func TestRunInSiteRunsAsTheTenant(t *testing.T) {
	runner := &DryRunner{}
	h := &Host{Runner: runner, SitesRoot: filepath.Join(t.TempDir(), "home"), UnitsDir: t.TempDir()}

	if _, err := h.RunInSite(context.Background(), "bptest", "demo", []string{"python3", "-m", "venv", ".venv"}); err != nil {
		t.Fatalf("RunInSite: %v", err)
	}

	joined := strings.Join(runner.Commands(), "\n")
	if !strings.Contains(joined, "as bptest") {
		t.Errorf("the site command does not run as the tenant:\n%s", joined)
	}
	if !strings.Contains(joined, h.SitePath("bptest", "demo")) {
		t.Errorf("the site command does not run inside the site directory:\n%s", joined)
	}
}

func TestFetchSourceClonesAsTheTenant(t *testing.T) {
	runner := &DryRunner{}
	h := &Host{Runner: runner, SitesRoot: filepath.Join(t.TempDir(), "home"), UnitsDir: t.TempDir()}
	if _, err := h.EnsureSiteDir(context.Background(), "bptest", "demo"); err != nil {
		t.Fatal(err)
	}

	if _, err := h.FetchSource(context.Background(), "bptest", "demo", "github", "https://example.com/repo.git", "main"); err != nil {
		t.Fatalf("FetchSource: %v", err)
	}
	joined := strings.Join(runner.Commands(), "\n")
	if !strings.Contains(joined, "as bptest") || !strings.Contains(joined, "git clone") {
		t.Errorf("the clone does not belong to the tenant:\n%s", joined)
	}
}

func TestChownSiteOnlyRunsOnARealHost(t *testing.T) {
	dir := t.TempDir()
	dry := &Host{Runner: &DryRunner{}, SitesRoot: dir, UnitsDir: dir}
	if err := dry.ChownSite(context.Background(), "bptest", "demo"); err != nil {
		t.Fatalf("ChownSite (dry-run): %v", err)
	}

	recorder := &realRecorder{}
	real := &Host{Runner: recorder, SitesRoot: dir, UnitsDir: dir}
	if err := os.MkdirAll(real.SitePath("bptest", "demo"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := real.ChownSite(context.Background(), "bptest", "demo"); err != nil {
		t.Fatalf("ChownSite (real): %v", err)
	}
	joined := strings.Join(recorder.commands, "\n")
	if !strings.Contains(joined, "chown -R bptest:bptest "+real.SitePath("bptest", "demo")) {
		t.Errorf("no chown was issued for the site:\n%s", joined)
	}
}

func TestChownSiteIgnoresAMissingDirectory(t *testing.T) {
	recorder := &realRecorder{}
	h := &Host{Runner: recorder, SitesRoot: filepath.Join(t.TempDir(), "home"), UnitsDir: t.TempDir()}
	if err := h.ChownSite(context.Background(), "bptest", "never-deployed"); err != nil {
		t.Fatalf("ChownSite: %v", err)
	}
	if len(recorder.commands) != 0 {
		t.Errorf("a missing directory should not be chowned: %v", recorder.commands)
	}
}
