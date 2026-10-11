//go:build !linux

package terminal

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
)

// probeJail: a mount namespace jail is a Linux feature. Everywhere else the
// panel runs in dry-run and opens an unnested shell.
func probeJail() (bool, string) {
	return false, "site shells can only be confined on Linux"
}

// newJailedCommand is not available off Linux.
func newJailedCommand(Options, string, string, []string) (*exec.Cmd, *os.File, func(), error) {
	return nil, nil, nil, errors.New("terminal: confining a shell is only supported on Linux")
}

// Confine is not available off Linux.
func Confine(string, string) error {
	return errors.New("terminal: confining a shell is only supported on Linux")
}

// Mask is not available off Linux.
func Mask([]string) ([]string, error) {
	return nil, errors.New("terminal: confining a shell is only supported on Linux")
}

// DropPrivileges is not available off Linux (no uid switching without Linux).
func DropPrivileges(int, int) error {
	return errors.New("terminal: dropping privileges is only supported on Linux")
}

// MountProbe is not available off Linux.
func MountProbe() error {
	return errors.New("terminal: mount namespaces are only supported on Linux")
}

// SiteDirFor mirrors the Linux helper.
func SiteDirFor(sitesRoot, tenant, slug string) string {
	return filepath.Join(sitesRoot, tenant, "apps", slug)
}

// Exec replaces the process with the shell (used by the helper on any platform
// so the command still builds and its errors are honest).
func Exec(string, []string, []string, string) error {
	return errors.New("terminal: replacing the process with a shell is only supported on Linux")
}

// Abs mirrors the Linux helper.
func Abs(path string) string {
	if path == "" {
		return path
	}
	if filepath.IsAbs(path) {
		return path
	}
	out, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return out
}
