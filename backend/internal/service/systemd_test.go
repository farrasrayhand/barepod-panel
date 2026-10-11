package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

func testSpec(dir string) Spec {
	return Spec{
		Binary:   "/usr/local/bin/barepod",
		Args:     []string{"serve", "-listen", "127.0.0.1:8080", "-db", "/var/lib/barepod/barepod.db"},
		UnitsDir: dir,
		Env:      map[string]string{"BAREPOD_LOG_LEVEL": "info", "BAREPOD_LOG_LEVEL_EXTRA": "x"},
	}
}

func TestUnitRunsTheDaemonAndRestartsAlways(t *testing.T) {
	unit := testSpec(t.TempDir()).Unit()

	for _, want := range []string{
		"ExecStart=/usr/local/bin/barepod serve -listen 127.0.0.1:8080 -db /var/lib/barepod/barepod.db",
		"Restart=always",
		"WantedBy=multi-user.target",
		"Environment=BAREPOD_LOG_LEVEL=info",
		"SyslogIdentifier=barepod",
	} {
		if !strings.Contains(unit, want) {
			t.Errorf("unit is missing %q\n---\n%s", want, unit)
		}
	}
}

func TestUnitIsNotSandboxedIntoUselessness(t *testing.T) {
	// The daemon writes units into /etc/systemd/system, creates Linux accounts
	// and drops privileges per request: ProtectSystem/PrivateTmp/NoNewPrivileges
	// would break it, so the unit must not contain them.
	unit := testSpec(t.TempDir()).Unit()
	for _, forbidden := range []string{"ProtectSystem=", "PrivateTmp=", "NoNewPrivileges=", "ProtectHome="} {
		if strings.Contains(unit, forbidden) {
			t.Errorf("the daemon unit must not set %s", forbidden)
		}
	}
}

func TestInstallWritesTheUnitAndEnablesIt(t *testing.T) {
	dir := t.TempDir()
	runner := &host.DryRunner{}

	result, err := Install(context.Background(), runner, testSpec(dir))
	if err != nil {
		t.Fatalf("Install: %v", err)
	}
	if _, err := os.Stat(result.UnitPath); err != nil {
		t.Fatalf("the unit was not written: %v", err)
	}
	if filepath.Base(result.UnitPath) != "barepod.service" {
		t.Errorf("unit path = %s", result.UnitPath)
	}

	commands := strings.Join(runner.Commands(), "\n")
	for _, want := range []string{"systemctl daemon-reload", "systemctl enable --now barepod.service"} {
		if !strings.Contains(commands, want) {
			t.Errorf("recorded commands are missing %q:\n%s", want, commands)
		}
	}
}

func TestInstallRequiresArguments(t *testing.T) {
	spec := testSpec(t.TempDir())
	spec.Args = nil
	if _, err := Install(context.Background(), &host.DryRunner{}, spec); err == nil {
		t.Error("Install accepted an empty ExecStart")
	}
}

func TestUninstallRemovesTheUnitAndContinuesWhenDisabled(t *testing.T) {
	dir := t.TempDir()
	spec := testSpec(dir)
	if _, err := Install(context.Background(), &host.DryRunner{}, spec); err != nil {
		t.Fatal(err)
	}

	result, err := Uninstall(context.Background(), &host.DryRunner{}, dir, "barepod")
	if err != nil {
		t.Fatalf("Uninstall: %v", err)
	}
	if _, err := os.Stat(result.UnitPath); !os.IsNotExist(err) {
		t.Errorf("the unit file survived: %v", err)
	}
	if len(result.Commands) == 0 {
		t.Error("no commands were recorded")
	}
}

func TestDefaultNameAndPaths(t *testing.T) {
	spec := Spec{}
	if spec.name() != "barepod" {
		t.Errorf("default name = %q", spec.name())
	}
	if spec.UnitPath() != "/etc/systemd/system/barepod.service" {
		t.Errorf("default unit path = %q", spec.UnitPath())
	}
}
