package tenant

import (
	"context"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

func newManager(t *testing.T, caps sysinfo.Capabilities) (*Manager, *host.DryRunner, string) {
	t.Helper()
	dir := t.TempDir()
	runner := &host.DryRunner{}
	return New(runner, dir, caps), runner, dir
}

func TestRemoveRecordsUserdelWithHome(t *testing.T) {
	m, runner, _ := newManager(t, sysinfo.Capabilities{OS: "linux", Useradd: true})

	res, err := m.Remove(context.Background(), "tenant_alex")
	if err != nil {
		t.Fatalf("Remove: %v", err)
	}
	joined := strings.Join(runner.Commands(), " | ")
	if !strings.Contains(joined, "userdel -r tenant_alex") {
		t.Errorf("expected userdel -r tenant_alex, recorded: %s", joined)
	}
	if len(res.Notes) == 0 {
		t.Error("dry-run must explain that nothing was removed")
	}

	if _, err := m.Remove(context.Background(), "not a user"); err == nil {
		t.Error("an invalid account name must be refused before the OS is touched")
	}
}

func TestProvisionDryRunRecordsCommandsAndCreatesLayout(t *testing.T) {
	m, runner, home := newManager(t, sysinfo.Capabilities{OS: "linux", Useradd: true, Quota: true, RunAsUser: true})

	var lines []string
	res, err := m.Provision(context.Background(), "tenant_alex", Options{Shell: "/bin/bash", QuotaBytes: 10 << 30}, func(l string) {
		lines = append(lines, l)
	})
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	if res.Created {
		t.Error("dry-run must not claim it created the account")
	}
	if res.QuotaSet {
		t.Error("dry-run must not claim it applied a quota")
	}
	if len(lines) == 0 {
		t.Error("no progress was reported to the log callback")
	}
	if len(res.Notes) == 0 {
		t.Error("dry-run must explain what it did not do")
	}
	if !strings.Contains(strings.Join(res.Notes, " "), "dry-run") {
		t.Errorf("notes = %v, want a dry-run explanation", res.Notes)
	}

	commands := strings.Join(runner.Commands(), "\n")
	for _, want := range []string{
		"useradd --create-home --shell /bin/bash",
		"chmod 0750",
		"chown -R tenant_alex:tenant_alex",
		"setquota -u tenant_alex",
	} {
		if !strings.Contains(commands, want) {
			t.Errorf("recorded commands are missing %q:\n%s", want, commands)
		}
	}

	if res.Home != home+"/tenant_alex" {
		t.Errorf("home = %q, want %q", res.Home, home+"/tenant_alex")
	}
	if res.Apps() != home+"/tenant_alex/apps" {
		t.Error("apps directory is not where the websites expect it")
	}
}

func TestProvisionSkipsQuotaWhenUnavailable(t *testing.T) {
	m, runner, _ := newManager(t, sysinfo.Capabilities{OS: "linux", Useradd: true, Quota: false})

	var lines []string
	res, err := m.Provision(context.Background(), "tenant_bob", Options{QuotaBytes: 1 << 30}, func(l string) { lines = append(lines, l) })
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if res.QuotaSet {
		t.Error("quota reported as set although setquota is unavailable")
	}
	if !strings.Contains(strings.Join(res.Notes, " "), "quota") {
		t.Errorf("notes = %v, want an explanation about the quota", res.Notes)
	}
	if strings.Contains(strings.Join(runner.Commands(), "\n"), "setquota") {
		t.Error("setquota was run on a host without quota tools")
	}
}

func TestProvisionRejectsDangerousNames(t *testing.T) {
	m, runner, _ := newManager(t, sysinfo.Capabilities{OS: "linux", Useradd: true})

	for _, name := range []string{"", "Root", "../../etc", "user name", "user;rm -rf /", "-oops"} {
		if _, err := m.Provision(context.Background(), name, Options{}, nil); err == nil {
			t.Errorf("Provision(%q) succeeded, want rejection", name)
		}
	}
	if len(runner.Commands()) != 0 {
		t.Errorf("a rejected name still reached the OS: %v", runner.Commands())
	}
}

func TestLockUnlock(t *testing.T) {
	m, runner, _ := newManager(t, sysinfo.Capabilities{OS: "linux", Useradd: true})

	if err := m.Lock(context.Background(), "tenant_alex"); err != nil {
		t.Fatalf("Lock: %v", err)
	}
	if err := m.Unlock(context.Background(), "tenant_alex"); err != nil {
		t.Fatalf("Unlock: %v", err)
	}

	commands := strings.Join(runner.Commands(), "\n")
	if !strings.Contains(commands, "usermod --lock tenant_alex") {
		t.Errorf("lock was not recorded:\n%s", commands)
	}
	if !strings.Contains(commands, "usermod --unlock tenant_alex") {
		t.Errorf("unlock was not recorded:\n%s", commands)
	}

	if err := m.Lock(context.Background(), "Bad Name"); err == nil {
		t.Error("Lock accepted an invalid account name")
	}
}
