package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The backup must not land where the uninstall deletes, and the check has to see through a symlink: a
// path that looks outside can resolve inside, which is exactly how a backup gets deleted by its own run.
func TestABackupInsideWhatWeDeleteIsRefused(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "var", "lib", "barepod")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name   string
		child  string
		parent string
		want   bool
	}{
		{"the directory itself", dataDir, dataDir, true},
		{"inside it", filepath.Join(dataDir, "backups"), dataDir, true},
		{"beside it", filepath.Join(root, "var", "lib", "barepod-backups"), dataDir, false},
		{"somewhere else entirely", filepath.Join(root, "var", "backups", "barepod"), dataDir, false},
	}
	for _, c := range cases {
		if got := pathInside(c.child, c.parent); got != c.want {
			t.Errorf("%s: want %v, got %v", c.name, c.want, got)
		}
	}
	// a symlink into the doomed directory is still inside it
	link := filepath.Join(root, "innocent")
	if err := os.Symlink(dataDir, link); err != nil {
		t.Fatal(err)
	}
	if !pathInside(link, dataDir) {
		t.Error("a symlink pointing into the directory was not seen as inside it")
	}
}

// Restoring an engine by hand-editing its configuration: only the lines the callback claims change, the
// file keeps a copy of itself, and a file whose lines are already right is left alone.
func TestEngineConfigurationIsRewrittenOnlyWhereClaimed(t *testing.T) {
	dir := t.TempDir()
	redis := filepath.Join(dir, "redis.conf")
	original := "port 6379\nbind 127.0.0.1 -::1 172.17.0.1\naclfile /etc/redis/users.acl\nmaxmemory-policy allkeys-lru\n"
	if err := os.WriteFile(redis, []byte(original), 0o644); err != nil {
		t.Fatal(err)
	}
	err := rewriteConfigFile(redis, func(line string) (string, bool) {
		switch {
		case strings.HasPrefix(strings.TrimSpace(line), "aclfile"):
			return "# aclfile (removed by the BarePod uninstall)", true
		case strings.HasPrefix(strings.TrimSpace(line), "bind"):
			return "bind 127.0.0.1 -::1", true
		}
		return line, false
	})
	if err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(redis)
	got := string(body)
	if strings.Contains(got, "aclfile /etc/redis") || !strings.Contains(got, "# aclfile (removed") {
		t.Errorf("the aclfile directive was left pointing at a file we delete:\n%s", got)
	}
	if !strings.Contains(got, "bind 127.0.0.1 -::1\n") {
		t.Errorf("bind was not put back to loopback:\n%s", got)
	}
	if !strings.Contains(got, "maxmemory-policy allkeys-lru") || !strings.Contains(got, "port 6379") {
		t.Errorf("lines nobody claimed were touched:\n%s", got)
	}
	if _, err := os.Stat(redis + ".barepod-uninstall.bak"); err != nil {
		t.Errorf("no copy of the original was kept: %v", err)
	}
	// running it again changes nothing further
	if err := rewriteConfigFile(redis, func(line string) (string, bool) { return line, false }); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(redis)
	if string(again) != got {
		t.Error("a second pass with nothing to claim rewrote the file anyway")
	}
}
