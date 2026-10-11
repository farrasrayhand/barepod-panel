package host

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Runner executes host commands inside a specific working directory.
type Runner interface {
	// Run executes a command in dir and returns its combined output.
	Run(ctx context.Context, dir string, name string, args ...string) (string, error)
	// RunAs executes a command as another user, so everything a deploy writes
	// into a site directory belongs to the tenant instead of root.
	RunAs(ctx context.Context, username, dir, name string, args ...string) (string, error)
	// RunEnv executes a command with extra environment variables. Credentials
	// travel this way so they never appear in a process list.
	RunEnv(ctx context.Context, dir string, env []string, name string, args ...string) (string, error)
	// Mode is "real" or "dry-run".
	Mode() string
}

// RealRunner executes commands on the host.
type RealRunner struct{}

// Mode implements Runner.
func (RealRunner) Mode() string { return "real" }

// Run implements Runner.
func (RealRunner) Run(ctx context.Context, dir, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// RunEnv implements Runner.
func (RealRunner) RunEnv(ctx context.Context, dir string, env []string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// DryRunner records commands instead of executing them.
type DryRunner struct {
	mu       sync.Mutex
	commands []string
}

// Mode implements Runner.
func (*DryRunner) Mode() string { return "dry-run" }

// Run implements Runner.
func (d *DryRunner) Run(_ context.Context, dir, name string, args ...string) (string, error) {
	line := d.render("", dir, name, args)
	d.mu.Lock()
	d.commands = append(d.commands, line)
	d.mu.Unlock()
	return "[dry-run] " + line + "\n", nil
}

// RunAs implements Runner: the command is recorded with the user it would run
// as, so a dry-run shows the tenant and never hides the ownership.
func (d *DryRunner) RunAs(_ context.Context, username, dir, name string, args ...string) (string, error) {
	line := d.render(username, dir, name, args)
	d.mu.Lock()
	d.commands = append(d.commands, line)
	d.mu.Unlock()
	return "[dry-run] " + line + "\n", nil
}

// RunEnv implements Runner: the recorded line names the variables but never their
// values, so a dry-run log cannot leak a credential.
func (d *DryRunner) RunEnv(_ context.Context, dir string, env []string, name string, args ...string) (string, error) {
	keys := make([]string, 0, len(env))
	for _, entry := range env {
		if key, _, found := strings.Cut(entry, "="); found {
			keys = append(keys, key+"=***")
		}
	}
	line := d.render("", dir, name, args)
	if len(keys) > 0 {
		line = "(env " + strings.Join(keys, " ") + ") " + line
	}
	d.mu.Lock()
	d.commands = append(d.commands, line)
	d.mu.Unlock()
	return "[dry-run] " + line + "\n", nil
}

func (*DryRunner) render(username, dir, name string, args []string) string {
	line := name
	if len(args) > 0 {
		line += " " + strings.Join(args, " ")
	}
	parts := []string{}
	if username != "" {
		parts = append(parts, "as "+username)
	}
	if dir != "" {
		parts = append(parts, "cd "+dir)
	}
	if len(parts) == 0 {
		return line
	}
	return "(" + strings.Join(parts, ", ") + " && " + line + ")"
}

// Commands returns the recorded commands of a dry-run.
func (d *DryRunner) Commands() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.commands...)
}
