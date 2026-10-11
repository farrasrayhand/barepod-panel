package files

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ErrProtected is returned for every write that targets a protected path. The
// API maps it to 403 system_path_protected.
var ErrProtected = errors.New("files: this path is protected")

// Policy marks the absolute paths a browser may look at but never change. It is
// the guardrail that stops a hosting panel from bricking the machine with one
// mistaken click: an admin can read /etc to debug, and cannot overwrite it.
type Policy struct {
	ReadOnlyPrefixes []string
}

// SystemPolicy is the rule for a host-wide browser. Everything a distribution or
// this panel needs to keep working is read-only; user data (/home, /var/www,
// /tmp, /srv, /opt, /root) stays writable.
func SystemPolicy() Policy {
	return Policy{ReadOnlyPrefixes: []string{
		"/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32",
		"/boot", "/etc", "/usr", "/proc", "/sys", "/dev", "/run",
		"/var/lib", "/var/cache", "/var/spool", "/var/log",
		"/lost+found",
		// Belt and braces: the panel's own state is inside /etc and /var/lib, but
		// naming it makes the intent obvious to anyone reading this list.
		"/etc/barepod", "/var/lib/barepod",
	}}
}

// Protect reports an error when abs is inside a protected tree.
//
// Both the literal path and its symlink-resolved form are tested, on both sides:
// /etc is protected even where it is a symlink (macOS: /private/etc), and a link
// planted in a writable directory cannot be used to reach into a protected tree.
func (p Policy) Protect(abs string) error {
	candidates := []string{filepath.Clean(abs), resolvedForPolicy(abs)}
	for _, prefix := range p.ReadOnlyPrefixes {
		clean := filepath.Clean(prefix)
		resolved := resolvedForPolicy(clean)
		for _, candidate := range candidates {
			if within(candidate, clean) || within(candidate, resolved) {
				return fmt.Errorf("%w: %s", ErrProtected, candidate)
			}
		}
	}
	return nil
}

// within reports whether path is root itself or inside it.
func within(path, root string) bool {
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}

// Protects is the boolean form, used to mark entries in a listing.
func (p Policy) Protects(abs string) bool { return p.Protect(abs) != nil }

// resolvedForPolicy resolves every symlink that already exists and re-attaches
// the part that does not (a file being created cannot be a link itself).
func resolvedForPolicy(abs string) string {
	probe := abs
	missing := []string{}
	for {
		resolved, err := filepath.EvalSymlinks(probe)
		if err == nil {
			return filepath.Join(append([]string{resolved}, missing...)...)
		}
		if !os.IsNotExist(err) {
			return abs
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return abs
		}
		missing = append([]string{filepath.Base(probe)}, missing...)
		probe = parent
	}
}

// assertWritable is the Manager's single gate for every mutation.
func (m *Manager) assertWritable(abs string) error {
	return m.policy.Protect(abs)
}
