// Package files implements the website file manager.
//
// The security model has two layers:
//
//  1. Path jail — every incoming path is relative, cleaned, run through
//     filepath.IsLocal, resolved with EvalSymlinks on its deepest existing
//     ancestor, and finally compared against the site root with a
//     separator-safe prefix test. A symlink pointing outside the root is
//     therefore refused, and "site-evil" can never pass as "site".
//  2. Ownership — on Linux the daemon runs as root, so every operation can be
//     executed through a helper process started with the tenant's UID/GID
//     (Ops implementation HelperOps). The kernel then enforces ownership on top
//     of the jail, instead of root silently writing root-owned files.
package files

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ErrOutsideRoot is returned when a path escapes the website root.
var ErrOutsideRoot = errors.New("files: path is outside the website directory")

// ErrSymlinkEscape is returned when a symlink resolves outside the website root.
var ErrSymlinkEscape = errors.New("files: symlink points outside the website directory")

// Entry is one item in a directory listing.
type Entry struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	Type          string `json:"type"` // file | directory | symlink
	Size          int64  `json:"size"`
	Mode          string `json:"mode"`
	ModifiedAt    string `json:"modifiedAt"`
	SymlinkTarget string `json:"symlinkTarget,omitempty"`
	// Protected marks a path the browser may read but never change.
	Protected bool `json:"protected,omitempty"`
}

// Ops performs the actual filesystem work, so it can run in-process or inside a
// helper process holding the tenant's credentials.
type Ops interface {
	List(dir string) ([]Entry, error)
	ReadFile(p string) ([]byte, error)
	WriteFile(p string, data []byte, mode os.FileMode) error
	MkdirAll(p string) error
	Remove(p string) error
	Rename(oldPath, newPath string) error
	Stat(p string) (os.FileInfo, error)
}

// Manager is the file manager for one website root.
type Manager struct {
	root           string // absolute, symlink-resolved
	ops            Ops
	maxUploadBytes int64
	policy         Policy // empty for a site root: everything inside it is writable
}

// NewManager builds a manager for a site root. The root is resolved once so the
// prefix comparison later cannot be fooled by a symlinked root.
func NewManager(root string, ops Ops, maxUploadBytes int64) (*Manager, error) {
	if ops == nil {
		ops = DirectOps{}
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	resolved := abs
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		resolved = real
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if maxUploadBytes <= 0 {
		maxUploadBytes = 64 << 20 // 64 MiB
	}
	return &Manager{root: filepath.Clean(resolved), ops: ops, maxUploadBytes: maxUploadBytes}, nil
}

// NewManagerGuarded is NewManager with a write policy, for browsers that reach
// outside a site (a tenant's home, or the whole host).
func NewManagerGuarded(root string, ops Ops, maxUploadBytes int64, policy Policy) (*Manager, error) {
	manager, err := NewManager(root, ops, maxUploadBytes)
	if err != nil {
		return nil, err
	}
	manager.policy = policy
	return manager, nil
}

// Root is the resolved site root.
func (m *Manager) Root() string { return m.root }

// MaxUploadBytes is the upload ceiling for one file.
func (m *Manager) MaxUploadBytes() int64 { return m.maxUploadBytes }

// Resolve turns a request path into an absolute, jailed path.
//
// relative:"": the site root itself.
func (m *Manager) Resolve(relative string) (string, error) {
	if strings.ContainsRune(relative, 0) {
		return "", ErrOutsideRoot
	}
	relative = strings.TrimSpace(relative)
	if relative == "" || relative == "." || relative == "/" {
		return m.root, nil
	}

	// Reject absolute paths, drive letters and Windows-style escapes outright.
	if filepath.IsAbs(relative) {
		return "", ErrOutsideRoot
	}
	cleaned := filepath.Clean(relative)
	if cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", ErrOutsideRoot
	}
	if !filepath.IsLocal(cleaned) {
		return "", ErrOutsideRoot
	}

	target := filepath.Join(m.root, cleaned)

	// Resolve symlinks on the deepest part that exists, then re-attach the rest:
	// a path that does not exist yet (a new file) cannot itself be a symlink.
	if err := m.checkAncestry(target); err != nil {
		return "", err
	}
	return target, nil
}

// checkAncestry walks up to the deepest existing ancestor, resolves it, and makes
// sure the result is still inside the site root.
func (m *Manager) checkAncestry(target string) error {
	probe := target
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(probe)
		if err == nil {
			// Re-build the full logical path and verify the prefix.
			full := filepath.Join(append([]string{resolved}, missing...)...)
			if !insideRoot(m.root, full) {
				return ErrSymlinkEscape
			}
			return nil
		}
		if !os.IsNotExist(err) {
			return err
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return ErrOutsideRoot
		}
		missing = append([]string{filepath.Base(probe)}, missing...)
		probe = parent
	}
}

// insideRoot is the separator-safe containment test: "/home/u/apps/site-evil"
// must NOT be considered inside "/home/u/apps/site".
func insideRoot(root, candidate string) bool {
	root = filepath.Clean(root)
	candidate = filepath.Clean(candidate)
	if candidate == root {
		return true
	}
	// The host root contains everything: it must not be turned into a "//" prefix,
	// which would reject every path (used by the host-wide file browser).
	if root == string(filepath.Separator) {
		return filepath.IsAbs(candidate)
	}
	return strings.HasPrefix(candidate, root+string(filepath.Separator))
}

// --- operations ---

// List returns the entries of a directory (directories first, then name).
func (m *Manager) List(relative string) ([]Entry, error) {
	abs, err := m.Resolve(relative)
	if err != nil {
		return nil, err
	}
	entries, err := m.ops.List(abs)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		entries[i].Path = relativePath(relative, entries[i].Name)
		entries[i].Protected = m.policy.Protects(filepath.Join(abs, entries[i].Name))
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Type == "directory") != (entries[j].Type == "directory") {
			return entries[i].Type == "directory"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// Read returns a file's contents plus metadata.
func (m *Manager) Read(relative string) ([]byte, os.FileInfo, error) {
	abs, err := m.Resolve(relative)
	if err != nil {
		return nil, nil, err
	}
	info, err := m.ops.Stat(abs)
	if err != nil {
		return nil, nil, err
	}
	if info.IsDir() {
		return nil, nil, fmt.Errorf("files: %s is a directory", relative)
	}
	data, err := m.ops.ReadFile(abs)
	if err != nil {
		return nil, nil, err
	}
	return data, info, nil
}

// Write stores a file (creating parents) and returns its metadata.
func (m *Manager) Write(relative string, data []byte) (os.FileInfo, error) {
	abs, err := m.Resolve(relative)
	if err != nil {
		return nil, err
	}
	if err := m.assertWritable(abs); err != nil {
		return nil, err
	}
	if err := m.ops.MkdirAll(filepath.Dir(abs)); err != nil {
		return nil, err
	}
	if err := m.ops.WriteFile(abs, data, 0o644); err != nil {
		return nil, err
	}
	return m.ops.Stat(abs)
}

// Mkdir creates a directory (and its parents).
func (m *Manager) Mkdir(relative string) error {
	abs, err := m.Resolve(relative)
	if err != nil {
		return err
	}
	if abs == m.root {
		return errors.New("files: the site root already exists")
	}
	if err := m.assertWritable(abs); err != nil {
		return err
	}
	return m.ops.MkdirAll(abs)
}

// Rename renames an entry inside the same directory.
func (m *Manager) Rename(relative, newName string) (string, error) {
	if newName == "" || strings.ContainsAny(newName, `/\`) || newName == "." || newName == ".." {
		return "", errors.New("files: invalid name")
	}
	source, err := m.Resolve(relative)
	if err != nil {
		return "", err
	}
	if source == m.root {
		return "", errors.New("files: cannot rename the site root")
	}
	dest, err := m.Resolve(path.Join(path.Dir(relative), newName))
	if err != nil {
		return "", err
	}
	if err := m.assertWritable(source); err != nil {
		return "", err
	}
	if err := m.assertWritable(dest); err != nil {
		return "", err
	}
	if err := m.ops.Rename(source, dest); err != nil {
		return "", err
	}
	return relativePath(path.Dir(relative), newName), nil
}

// relativePath joins path segments without a leading slash, so every path the
// API returns is relative to the site root (never an absolute host path).
func relativePath(dir, name string) string {
	joined := path.Join("/", dir, name)
	joined = strings.TrimPrefix(joined, "/")
	if joined == "." {
		return ""
	}
	return joined
}

// Copy duplicates a file or directory tree inside the site.
func (m *Manager) Copy(relative, toRelative string) error {
	source, err := m.Resolve(relative)
	if err != nil {
		return err
	}
	if source == m.root {
		return errors.New("files: cannot copy the site root")
	}
	dest, err := m.Resolve(toRelative)
	if err != nil {
		return err
	}
	if insideRoot(source, dest) {
		return errors.New("files: cannot copy a directory into itself")
	}
	if err := m.assertWritable(dest); err != nil {
		return err
	}
	return m.copyTree(source, dest)
}

// Move relocates a file or directory inside the site.
func (m *Manager) Move(relative, toRelative string) error {
	source, err := m.Resolve(relative)
	if err != nil {
		return err
	}
	if source == m.root {
		return errors.New("files: cannot move the site root")
	}
	dest, err := m.Resolve(toRelative)
	if err != nil {
		return err
	}
	if insideRoot(source, dest) {
		return errors.New("files: cannot move a directory into itself")
	}
	if err := m.assertWritable(source); err != nil {
		return err
	}
	if err := m.assertWritable(dest); err != nil {
		return err
	}
	if err := m.ops.Rename(source, dest); err == nil {
		return nil
	}
	// Different filesystem or cross-device: copy then remove.
	if err := m.copyTree(source, dest); err != nil {
		return err
	}
	return m.ops.Remove(source)
}

// Delete removes a file or directory (recursively) inside the site.
func (m *Manager) Delete(relative string) error {
	abs, err := m.Resolve(relative)
	if err != nil {
		return err
	}
	if abs == m.root {
		return errors.New("files: cannot delete the site root")
	}
	if err := m.assertWritable(abs); err != nil {
		return err
	}
	return m.ops.Remove(abs)
}

// Exists reports whether a path exists inside the site.
func (m *Manager) Exists(relative string) (bool, error) {
	abs, err := m.Resolve(relative)
	if err != nil {
		return false, err
	}
	if _, err := m.ops.Stat(abs); err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (m *Manager) copyTree(source, dest string) error {
	info, err := m.ops.Stat(source)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		if err := m.ops.MkdirAll(filepath.Dir(dest)); err != nil {
			return err
		}
		data, err := m.ops.ReadFile(source)
		if err != nil {
			return err
		}
		return m.ops.WriteFile(dest, data, info.Mode().Perm())
	}

	if err := m.ops.MkdirAll(dest); err != nil {
		return err
	}
	entries, err := m.ops.List(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := m.copyTree(filepath.Join(source, entry.Name), filepath.Join(dest, entry.Name)); err != nil {
			return err
		}
	}
	return nil
}

// --- helpers shared by the implementations ---

func entryFromInfo(dir, name string, info os.FileInfo) Entry {
	full := filepath.Join(dir, name)
	entry := Entry{
		Name:       name,
		Size:       info.Size(),
		Mode:       fmt.Sprintf("%04o", info.Mode().Perm()),
		ModifiedAt: info.ModTime().UTC().Format(time.RFC3339),
	}
	switch {
	case info.IsDir():
		entry.Type = "directory"
	case info.Mode()&os.ModeSymlink != 0:
		entry.Type = "symlink"
		if target, err := os.Readlink(full); err == nil {
			entry.SymlinkTarget = target
		}
	default:
		entry.Type = "file"
	}
	return entry
}

func isBinary(data []byte) bool {
	limit := len(data)
	if limit > 8000 {
		limit = 8000
	}
	for _, b := range data[:limit] {
		if b == 0 {
			return true
		}
	}
	return false
}

// IsBinary reports whether a payload should be shown as text in the editor.
func IsBinary(data []byte) bool { return isBinary(data) }

// LimitReader wraps a reader with the upload ceiling.
func (m *Manager) LimitReader(r io.Reader) io.Reader {
	return io.LimitReader(r, m.maxUploadBytes)
}
