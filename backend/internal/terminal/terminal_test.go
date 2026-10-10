package terminal

import (
	"bytes"
	"strings"
	"sync"
	"testing"
	"time"
)

// collector drains the terminal in the background.
type collector struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (c *collector) write(p []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buf.Write(p)
}

func (c *collector) contains(marker string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return strings.Contains(c.buf.String(), marker)
}

func (c *collector) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buf.String()
}

// waitFor polls until the terminal echoed the marker, or fails the test.
func (c *collector) waitFor(t *testing.T, marker string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if c.contains(marker) {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the terminal never printed %q\n--- output so far ---\n%s", marker, c.String())
}

func TestSessionEchoAndResize(t *testing.T) {
	dir := t.TempDir()
	session, err := Start(Options{Shell: DefaultShell(), Dir: dir})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	out := &collector{}
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				out.write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	if _, err := session.Write([]byte("echo BAREPOD-TERMINAL-OK\n")); err != nil {
		t.Fatalf("Write: %v", err)
	}
	out.waitFor(t, "BAREPOD-TERMINAL-OK")

	// A resize must reach the shell: `stty size` reports "<rows> <cols>".
	if err := session.Resize(120, 40); err != nil {
		t.Fatalf("Resize: %v", err)
	}
	if _, err := session.Write([]byte("stty size\n")); err != nil {
		t.Fatal(err)
	}
	out.waitFor(t, "40 120")
}

func TestSessionRunsInTheGivenDirectory(t *testing.T) {
	dir := t.TempDir()
	session, err := Start(Options{Shell: DefaultShell(), Dir: dir})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })

	out := &collector{}
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				out.write(buf[:n])
			}
			if err != nil {
				return
			}
		}
	}()

	// pwd resolves symlinks (macOS /var -> /private/var), so compare the base.
	base := dir
	if idx := strings.LastIndex(strings.TrimRight(dir, "/"), "/"); idx >= 0 {
		base = dir[idx+1:]
	}
	if _, err := session.Write([]byte("pwd\n")); err != nil {
		t.Fatal(err)
	}
	out.waitFor(t, base)
}

func TestStartRejectsUnsafeOptions(t *testing.T) {
	dir := t.TempDir()

	if _, err := Start(Options{Shell: "/usr/bin/env", Dir: dir}); err == nil {
		t.Error("a shell outside the allow-list was started")
	}
	if _, err := Start(Options{Shell: DefaultShell(), Dir: dir + "/missing"}); err == nil {
		t.Error("a missing working directory was accepted")
	}
}

func TestCloseIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	session, err := Start(Options{Shell: DefaultShell(), Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if err := session.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if err := session.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	if _, err := session.Write([]byte("echo nope\n")); err == nil {
		t.Error("writing to a closed session succeeded")
	}
}

func TestUserAndShellReporting(t *testing.T) {
	dir := t.TempDir()
	session, err := Start(Options{Shell: DefaultShell(), Dir: dir})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })

	if session.User() == "" {
		t.Error("User() is empty")
	}
	if session.Shell() == "" {
		t.Error("Shell() is empty")
	}
}
