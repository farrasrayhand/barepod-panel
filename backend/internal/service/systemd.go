// Package service installs the daemon itself as a systemd service.
//
// It is the counterpart of internal/supervisor (which renders the units for the
// websites): the panel needs its own unit so it survives an SSH session, starts
// on boot and restarts if it crashes.
//
// The unit is deliberately *not* sandboxed beyond the basics: the daemon is a
// privileged control plane — it creates Linux accounts, writes units into
// /etc/systemd/system, reloads systemd and drops privileges per request — so
// ProtectSystem/PrivateTmp/NoNewPrivileges would break it instead of protecting
// anything.
package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// DefaultName is the unit name used for the daemon.
const DefaultName = "barepod"

// Spec describes how the daemon should be started.
type Spec struct {
	Name     string            // unit name (without .service), default "barepod"
	Binary   string            // absolute path to the barepod binary
	Args     []string          // arguments, normally the serve flags
	UnitsDir string            // default /etc/systemd/system
	Env      map[string]string // extra Environment= entries
}

func (s Spec) name() string {
	if s.Name == "" {
		return DefaultName
	}
	return s.Name
}

// UnitPath is the file systemd reads.
func (s Spec) UnitPath() string {
	dir := s.UnitsDir
	if dir == "" {
		dir = "/etc/systemd/system"
	}
	return filepath.Join(dir, s.name()+".service")
}

// Unit renders the unit file.
func (s Spec) Unit() string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel (`barepod service install`) — edits are overwritten.\n")
	b.WriteString("[Unit]\n")
	fmt.Fprintf(&b, "Description=BarePod Panel daemon (%s)\n", s.name())
	b.WriteString("Documentation=https://github.com/farrasrayhand/barepod-panel\n")
	b.WriteString("After=network-online.target\n")
	b.WriteString("Wants=network-online.target\n")
	// systemd stops retrying after five rapid restarts by default, which turned a transient
	// crash into a panel that stayed down. Restart=always is only real if the limit is removed.
	b.WriteString("StartLimitIntervalSec=0\n\n")

	b.WriteString("[Service]\n")
	b.WriteString("Type=simple\n")
	fmt.Fprintf(&b, "ExecStart=%s %s\n", s.Binary, strings.Join(s.Args, " "))
	for _, k := range sortedKeys(s.Env) {
		fmt.Fprintf(&b, "Environment=%s=%s\n", k, s.Env[k])
	}
	// Restart always: the panel must come back after a crash, not only on failure.
	b.WriteString("Restart=always\n")
	b.WriteString("RestartSec=3\n")
	b.WriteString("TimeoutStopSec=20\n")
	b.WriteString("KillMode=mixed\n")
	b.WriteString("LimitNOFILE=65536\n")
	b.WriteString("StandardOutput=journal\n")
	b.WriteString("StandardError=journal\n")
	fmt.Fprintf(&b, "SyslogIdentifier=%s\n\n", s.name())

	b.WriteString("[Install]\n")
	b.WriteString("WantedBy=multi-user.target\n")
	return b.String()
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Result reports what happened, so the CLI can print it.
type Result struct {
	UnitPath string
	Commands []string
	Mode     string
}

// Install writes the unit, reloads systemd and enables + starts it.
func Install(ctx context.Context, runner host.Runner, spec Spec) (*Result, error) {
	if spec.Binary == "" {
		executable, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("service: cannot determine the binary path: %w", err)
		}
		spec.Binary = executable
	}
	if len(spec.Args) == 0 {
		return nil, fmt.Errorf("service: no arguments given for ExecStart")
	}

	dir := filepath.Dir(spec.UnitPath())
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(spec.UnitPath(), []byte(spec.Unit()), 0o644); err != nil {
		return nil, err
	}

	result := &Result{UnitPath: spec.UnitPath(), Mode: runner.Mode()}
	steps := [][]string{
		{"systemctl", "daemon-reload"},
		{"systemctl", "enable", "--now", spec.name() + ".service"},
	}
	for _, argv := range steps {
		out, err := runner.Run(ctx, "", argv[0], argv[1:]...)
		result.Commands = append(result.Commands, strings.Join(argv, " "))
		if err != nil {
			if msg := strings.TrimSpace(out); msg != "" {
				return result, fmt.Errorf("service: %s failed: %w (%s)", argv[0], err, msg)
			}
			return result, fmt.Errorf("service: %s failed: %w", argv[1], err)
		}
	}
	return result, nil
}

// Uninstall stops and disables the unit, then removes the file.
func Uninstall(ctx context.Context, runner host.Runner, unitsDir, name string) (*Result, error) {
	spec := Spec{Name: name, UnitsDir: unitsDir}
	result := &Result{UnitPath: spec.UnitPath(), Mode: runner.Mode()}

	if _, err := runner.Run(ctx, "", "systemctl", "disable", "--now", spec.name()+".service"); err != nil {
		// The unit may never have been enabled; keep going and remove the file.
		result.Commands = append(result.Commands, "systemctl disable --now "+spec.name()+".service (failed, continuing)")
	} else {
		result.Commands = append(result.Commands, "systemctl disable --now "+spec.name()+".service")
	}

	if err := os.Remove(spec.UnitPath()); err != nil && !os.IsNotExist(err) {
		return result, err
	}
	if _, err := runner.Run(ctx, "", "systemctl", "daemon-reload"); err != nil {
		return result, err
	}
	result.Commands = append(result.Commands, "systemctl daemon-reload")
	return result, nil
}

// Status reports whether the unit is installed, enabled and running.
type Status struct {
	Installed bool
	Active    string
	Enabled   string
}

// Query reads the unit state. It never fails on a missing unit.
func Query(ctx context.Context, runner host.Runner, unitsDir, name string) Status {
	spec := Spec{Name: name, UnitsDir: unitsDir}
	status := Status{}
	if _, err := os.Stat(spec.UnitPath()); err == nil {
		status.Installed = true
	}
	status.Active = systemctl(ctx, runner, "is-active", spec.name())
	status.Enabled = systemctl(ctx, runner, "is-enabled", spec.name())
	return status
}

func systemctl(ctx context.Context, runner host.Runner, verb, name string) string {
	out, err := runner.Run(ctx, "", "systemctl", verb, name+".service")
	value := strings.TrimSpace(out)
	if value == "" && err != nil {
		return "unknown"
	}
	return value
}
