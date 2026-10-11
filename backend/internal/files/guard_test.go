package files

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSystemPolicyProtectsTheMachineAndNotUserData(t *testing.T) {
	policy := SystemPolicy()

	for _, protected := range []string{
		"/etc", "/etc/nginx/nginx.conf", "/usr/bin/apt", "/boot/vmlinuz",
		"/lib/x86_64-linux-gnu/libc.so.6", "/var/lib/barepod/barepod.db",
		"/etc/barepod/secret.key", "/proc/self/environ", "/sys/kernel", "/dev/sda",
	} {
		if err := policy.Protect(protected); err == nil {
			t.Errorf("%s should be read-only", protected)
		}
	}

	for _, writable := range []string{
		"/home/bptest/apps/web-flask/app.py", "/var/www/html/index.php",
		"/tmp/scratch", "/srv/data", "/opt/app/bin", "/root/notes.txt",
		"/etcx/not-system", "/var/libx/other",
	} {
		if err := policy.Protect(writable); err != nil {
			t.Errorf("%s should be writable: %v", writable, err)
		}
	}
}

func TestPolicyIsNotFooledByASymlinkIntoAProtectedTree(t *testing.T) {
	base := t.TempDir()
	system := filepath.Join(base, "system")
	writable := filepath.Join(base, "writable")
	if err := os.MkdirAll(filepath.Join(system, "nginx"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(writable, 0o755); err != nil {
		t.Fatal(err)
	}
	// A link in a writable directory that points into the protected tree: writing
	// "writable/away/hosts" would otherwise land in system/nginx.
	if err := os.Symlink(system, filepath.Join(writable, "away")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	policy := Policy{ReadOnlyPrefixes: []string{system}}
	if err := policy.Protect(filepath.Join(system, "nginx", "nginx.conf")); err == nil {
		t.Error("a direct path into the protected tree was allowed")
	}
	if err := policy.Protect(filepath.Join(writable, "away", "nginx", "nginx.conf")); err == nil {
		t.Error("a symlink into the protected tree was allowed")
	}
	if err := policy.Protect(filepath.Join(writable, "own.txt")); err != nil {
		t.Errorf("a plain file in a writable directory was refused: %v", err)
	}
}

func TestGuardedManagerRefusesEveryMutationInAProtectedTree(t *testing.T) {
	base := t.TempDir()
	system := filepath.Join(base, "etc")
	if err := os.MkdirAll(filepath.Join(system, "nginx"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(system, "hosts"), []byte("127.0.0.1 localhost\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	manager, err := NewManagerGuarded(base, DirectOps{}, 1<<20, Policy{ReadOnlyPrefixes: []string{system}})
	if err != nil {
		t.Fatal(err)
	}

	// Reading a protected path is what the admin is allowed to do.
	if _, _, err := manager.Read("etc/hosts"); err != nil {
		t.Fatalf("reading a protected file failed: %v", err)
	}
	if entries, err := manager.List("etc"); err != nil {
		t.Fatalf("listing a protected directory failed: %v", err)
	} else {
		for _, entry := range entries {
			if !entry.Protected {
				t.Errorf("%s should be marked protected in a listing", entry.Name)
			}
		}
	}

	attempts := map[string]func() error{
		"write":  func() error { _, err := manager.Write("etc/hosts", []byte("evil")); return err },
		"delete": func() error { return manager.Delete("etc/hosts") },
		"mkdir":  func() error { return manager.Mkdir("etc/panel") },
		"rename": func() error { _, err := manager.Rename("etc/hosts", "hosts.bak"); return err },
		"move out": func() error {
			return manager.Move("etc/hosts", "moved-hosts")
		},
		"copy in": func() error {
			return manager.Copy("moved-hosts", "etc/copied")
		},
	}
	for name, attempt := range attempts {
		if err := attempt(); !errors.Is(err, ErrProtected) {
			t.Errorf("%s into the protected tree was allowed (err = %v)", name, err)
		}
	}

	// Nothing changed on disk.
	content, err := os.ReadFile(filepath.Join(system, "hosts"))
	if err != nil || string(content) != "127.0.0.1 localhost\n" {
		t.Errorf("the protected file was modified: %q (%v)", content, err)
	}
	if _, err := os.Stat(filepath.Join(system, "panel")); !os.IsNotExist(err) {
		t.Error("a directory was created inside the protected tree")
	}
}

func TestSiteManagersKeepWritingFreely(t *testing.T) {
	// A website root carries no policy: everything inside it stays writable.
	root := t.TempDir()
	manager, err := NewManager(root, DirectOps{}, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Write("app.py", []byte("print('hi')\n")); err != nil {
		t.Fatalf("a site write was refused: %v", err)
	}
	if err := manager.Mkdir("uploads"); err != nil {
		t.Fatalf("a site mkdir was refused: %v", err)
	}
	if err := manager.Delete("uploads"); err != nil {
		t.Fatalf("a site delete was refused: %v", err)
	}
	if got := manager.policy.Protect(filepath.Join(root, "anything")); got != nil {
		t.Errorf("a site root must have no policy: %v", got)
	}
	// The root is resolved once (on macOS /var is a link to /private/var), so the
	// check is that it points at the same directory, not at the same string.
	if resolved, err := filepath.EvalSymlinks(root); err == nil && manager.Root() != resolved {
		t.Errorf("root = %s, want %s", manager.Root(), resolved)
	}
}
