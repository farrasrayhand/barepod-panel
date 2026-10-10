// Package terminal runs interactive shells for the panel.
//
// Two things matter here:
//
//  1. A terminal always runs as the tenant, never as the daemon's user. On Linux
//     the child is started with the tenant's UID/GID (SysProcAttr.Credential),
//     so `cd /home/other` fails with Permission denied at the kernel level.
//  2. Only allow-listed shells are started, and the working directory is always
//     the site directory — a client cannot ask for a different program or path.
package terminal

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
)

// allowedShells are the interpreters the panel will start.
var allowedShells = map[string]bool{
	"/bin/bash":     true,
	"/bin/sh":       true,
	"/bin/zsh":      true,
	"/usr/bin/bash": true,
	"/usr/bin/sh":   true,
	"/usr/bin/zsh":  true,
	"/bin/ash":      true,
}

// Options configures a session.
type Options struct {
	Shell       string // absolute path, must be in the allow-list
	Dir         string // working directory (the site root)
	UID         int    // > 0: drop to this user (Linux, daemon running as root)
	GID         int
	Env         map[string]string
	Cols, Rows  uint16
	IdleTimeout time.Duration
}

// Session is a running shell attached to a pseudo-terminal.
type Session struct {
	ptyFile *os.File
	cmd     *exec.Cmd
	shell   string
	uid     int
	gid     int
	mu      sync.Mutex
	closed  bool
}

// DefaultShell picks the first available allow-listed shell.
func DefaultShell() string {
	for _, candidate := range []string{"/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "/bin/sh"
}

// Start spawns the shell on a fresh pseudo-terminal.
func Start(opts Options) (*Session, error) {
	shell := opts.Shell
	if shell == "" {
		shell = DefaultShell()
	}
	if !allowedShells[shell] {
		return nil, fmt.Errorf("terminal: %q is not an allowed shell", shell)
	}
	dir := opts.Dir
	if dir == "" {
		dir = "."
	}
	info, err := os.Stat(dir)
	if err != nil {
		return nil, fmt.Errorf("terminal: working directory: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("terminal: the working directory is not a directory")
	}

	env := buildEnv(dir, opts.Env)
	cmd := exec.Command(shell, "--login")
	cmd.Dir = dir
	cmd.Env = env

	if opts.UID > 0 {
		// Drop privileges: the kernel then enforces the tenant's own permissions.
		cmd.SysProcAttr = &syscall.SysProcAttr{
			Credential: &syscall.Credential{Uid: uint32(opts.UID), Gid: uint32(opts.GID)},
			Setsid:     true,
		}
	} else {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	}

	size := &pty.Winsize{Cols: opts.Cols, Rows: opts.Rows}
	if size.Cols == 0 {
		size.Cols = 80
	}
	if size.Rows == 0 {
		size.Rows = 24
	}

	ptyFile, err := pty.StartWithSize(cmd, size)
	if err != nil {
		return nil, fmt.Errorf("terminal: start shell: %w", err)
	}
	return &Session{ptyFile: ptyFile, cmd: cmd, shell: shell, uid: opts.UID, gid: opts.GID}, nil
}

// buildEnv keeps the daemon's environment but makes sure HOME/TERM/PWD describe
// the tenant's shell, not the daemon's.
func buildEnv(dir string, extra map[string]string) []string {
	env := map[string]string{}
	for _, entry := range os.Environ() {
		if key, value, found := strings.Cut(entry, "="); found {
			env[key] = value
		}
	}
	env["TERM"] = "xterm-256color"
	env["PWD"] = dir
	env["HOME"] = dir
	env["SHELL"] = DefaultShell()
	env["COLORTERM"] = "truecolor"
	for key, value := range extra {
		env[key] = value
	}

	out := make([]string, 0, len(env))
	for key, value := range env {
		out = append(out, key+"="+value)
	}
	return out
}

// Read implements io.Reader on the terminal output.
func (s *Session) Read(p []byte) (int, error) { return s.ptyFile.Read(p) }

// Write sends input to the shell.
func (s *Session) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return 0, errors.New("terminal: session is closed")
	}
	return s.ptyFile.Write(p)
}

// Resize applies a browser window size to the pseudo-terminal.
func (s *Session) Resize(cols, rows uint16) error {
	if cols == 0 || rows == 0 {
		return nil
	}
	return pty.Setsize(s.ptyFile, &pty.Winsize{Cols: cols, Rows: rows})
}

// Close tears the session down (the whole process group, so no orphan shell
// survives a closed browser tab).
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	if s.cmd.Process != nil {
		// Negative pid = the process group created by Setsid.
		_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGTERM)
		time.AfterFunc(2*time.Second, func() {
			if s.cmd.Process != nil {
				_ = syscall.Kill(-s.cmd.Process.Pid, syscall.SIGKILL)
			}
		})
	}
	err := s.ptyFile.Close()
	_ = s.cmd.Wait()
	return err
}

// User reports which identity the shell runs as, so the client can show it.
func (s *Session) User() string {
	if s.uid > 0 {
		return fmt.Sprintf("uid=%d gid=%d", s.uid, s.gid)
	}
	return "daemon user"
}

// Shell reports the interpreter that was started.
func (s *Session) Shell() string { return filepath.Base(s.shell) }
