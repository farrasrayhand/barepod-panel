package files

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestManager(t *testing.T) (*Manager, string) {
	t.Helper()
	root := t.TempDir()
	// The manager resolves the root, and t.TempDir() on macOS is already behind
	// /private symlinks, so this also exercises that path.
	m, err := NewManager(root, DirectOps{}, 1<<20)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m, m.Root()
}

func TestResolveRejectsEscapes(t *testing.T) {
	m, _ := newTestManager(t)

	bad := []string{
		"../secret",
		"../../etc/passwd",
		"a/../../etc/passwd",
		"/etc/passwd",
		"files/../../../root",
		"..",
		"\x00evil",
	}
	for _, rel := range bad {
		if _, err := m.Resolve(rel); err == nil {
			t.Errorf("Resolve(%q) was allowed, want rejection", rel)
		}
	}
}

func TestResolveAllowsInside(t *testing.T) {
	m, root := newTestManager(t)

	for _, rel := range []string{"", ".", "/", "index.php", "storage/logs/laravel.log", "./a/./b.txt"} {
		got, err := m.Resolve(rel)
		if err != nil {
			t.Errorf("Resolve(%q): %v", rel, err)
			continue
		}
		if !insideRoot(root, got) {
			t.Errorf("Resolve(%q) = %q, which is outside %q", rel, got, root)
		}
	}
}

func TestResolveRefusesPrefixSibling(t *testing.T) {
	// The classic bug: "/home/u/apps/site-evil" must not pass as inside
	// "/home/u/apps/site" just because it shares the prefix.
	base := t.TempDir()
	site := filepath.Join(base, "site")
	if err := os.MkdirAll(site, 0o755); err != nil {
		t.Fatal(err)
	}
	sibling := filepath.Join(base, "site-evil")
	if err := os.MkdirAll(sibling, 0o755); err != nil {
		t.Fatal(err)
	}

	m, err := NewManager(site, DirectOps{}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.Resolve("../site-evil/secret.txt"); err == nil {
		t.Fatal("a sibling directory sharing the prefix was reachable")
	}
}

func TestResolveRefusesSymlinkEscape(t *testing.T) {
	m, root := newTestManager(t)

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("top secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	// A symlink inside the site pointing outside must not become a way out.
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := m.Resolve("escape/secret.txt"); err == nil {
		t.Fatal("a symlink pointing outside the site was followed")
	}
	if _, _, err := m.Read("escape/secret.txt"); err == nil {
		t.Fatal("Read() followed a symlink outside the site")
	}
}

func TestResolveAllowsSymlinkInside(t *testing.T) {
	m, root := newTestManager(t)

	if err := os.MkdirAll(filepath.Join(root, "current"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "current", "app.js"), []byte("// app"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "current"), filepath.Join(root, "link")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	data, _, err := m.Read("link/app.js")
	if err != nil {
		t.Fatalf("a symlink inside the site must work: %v", err)
	}
	if string(data) != "// app" {
		t.Fatalf("Read = %q", data)
	}
}

func TestWriteReadListDelete(t *testing.T) {
	m, _ := newTestManager(t)

	if _, err := m.Write("app/index.js", []byte("console.log(1)")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	data, info, err := m.Read("app/index.js")
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if string(data) != "console.log(1)" {
		t.Errorf("Read = %q", data)
	}
	if info.Size() != int64(len("console.log(1)")) {
		t.Errorf("size = %d", info.Size())
	}

	if err := m.Mkdir("app/storage"); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	entries, err := m.List("app")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 2 || entries[0].Name != "storage" || entries[0].Type != "directory" {
		t.Fatalf("List = %+v, want the directory first", entries)
	}

	if err := m.Delete("app/index.js"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if exists, _ := m.Exists("app/index.js"); exists {
		t.Error("the file still exists after Delete")
	}
	if err := m.Delete("app"); err != nil {
		t.Fatalf("Delete directory: %v", err)
	}
}

func TestRenameCopyMove(t *testing.T) {
	m, _ := newTestManager(t)

	if _, err := m.Write("a.txt", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Rename("a.txt", "b.txt"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if exists, _ := m.Exists("b.txt"); !exists {
		t.Fatal("Rename did not produce the new name")
	}

	if err := m.Copy("b.txt", "dir/c.txt"); err != nil {
		t.Fatalf("Copy: %v", err)
	}
	data, _, err := m.Read("dir/c.txt")
	if err != nil || string(data) != "hello" {
		t.Fatalf("copied file = %q, err = %v", data, err)
	}

	if err := m.Move("dir/c.txt", "d.txt"); err != nil {
		t.Fatalf("Move: %v", err)
	}
	if exists, _ := m.Exists("dir/c.txt"); exists {
		t.Error("Move left the source behind")
	}
	if exists, _ := m.Exists("d.txt"); !exists {
		t.Error("Move did not create the destination")
	}
}

func TestRenameRejectsBadNames(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Write("a.txt", []byte("x")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../escape", "sub/name", `win\name`, ".", "..", ""} {
		if _, err := m.Rename("a.txt", name); err == nil {
			t.Errorf("Rename to %q was allowed", name)
		}
	}
}

func TestCopyIntoItselfRefused(t *testing.T) {
	m, _ := newTestManager(t)
	if err := m.Mkdir("tree"); err != nil {
		t.Fatal(err)
	}
	if err := m.Copy("tree", "tree/nested"); err == nil {
		t.Fatal("copying a directory into itself was allowed")
	}
	if err := m.Move("tree", "tree/nested"); err == nil {
		t.Fatal("moving a directory into itself was allowed")
	}
}

func TestZipArchive(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Write("index.php", []byte("<?php echo 1;")); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Write("assets/app.css", []byte("body{}")); err != nil {
		t.Fatal(err)
	}

	archive, err := m.Zip([]string{"index.php", "assets"})
	if err != nil {
		t.Fatalf("Zip: %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("the archive is not readable: %v", err)
	}
	names := map[string]bool{}
	for _, f := range reader.File {
		names[f.Name] = true
	}
	for _, want := range []string{"index.php", "assets/app.css", "assets/"} {
		if !names[want] {
			t.Errorf("archive is missing %q (has %v)", want, names)
		}
	}
}

func TestZipSkipsEscapingSymlinks(t *testing.T) {
	m, root := newTestManager(t)
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("TOP-SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := m.Write("ok.txt", []byte("fine")); err != nil {
		t.Fatal(err)
	}

	// Archiving the whole site must skip the escaping symlink.
	archive, err := m.Zip([]string{""})
	if err != nil {
		t.Fatalf("Zip: %v", err)
	}
	if bytes.Contains(archive, []byte("TOP-SECRET")) {
		t.Error("the archive contains data from outside the site root")
	}

	// Asking for the escaping symlink directly is refused, not silently ignored.
	if _, err := m.Zip([]string{"escape"}); err == nil {
		t.Error("zipping a symlink that points outside the site was allowed")
	}
}

func TestIsBinary(t *testing.T) {
	if IsBinary([]byte("plain text")) {
		t.Error("text was reported as binary")
	}
	if !IsBinary([]byte("bin\x00ary")) {
		t.Error("NUL bytes were reported as text")
	}
}

func TestEntryPathsAreRelativeToTheSite(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Write("deep/nested/file.txt", []byte("x")); err != nil {
		t.Fatal(err)
	}
	entries, err := m.List("deep/nested")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("List returned %d entries", len(entries))
	}
	if entries[0].Path != "deep/nested/file.txt" {
		t.Errorf("entry path = %q, want deep/nested/file.txt", entries[0].Path)
	}
	if strings.Contains(entries[0].Path, os.TempDir()) {
		t.Error("the listing leaked an absolute host path")
	}
}
