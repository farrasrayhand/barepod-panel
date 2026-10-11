// Package dbtools runs the optional third-party database managers (pgweb today,
// DbGate when it arrives) the way the panel runs everything else: on demand, on
// loopback, and behind the panel's own session.
//
// Nothing here is ever published on a port of its own. A tool starts when its path
// is first requested, keeps working while it is being used, and is stopped once it
// has been idle — the timer slides forward on every request, so a session in use is
// never killed under someone's cursor.
package dbtools

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// Spec describes one manager.
type Spec struct {
	Name string // the name the API and the UI use
	// Engines the tool can open. A request for another engine is refused.
	Engines []string
	// Binary is looked up on PATH before the tool is offered, so the panel never
	// shows a button that cannot work.
	Binary string
	// Port is the loopback port the tool listens on; it is never published.
	Port int
	// HealthPath is fetched until the tool answers.
	HealthPath string
	// Note explains what the tool is for, in the API's own words.
	Note string
}

// Registry is what the panel knows how to run.
func Registry() map[string]Spec {
	return map[string]Spec{
		"pgweb": {
			Name:       "pgweb",
			Engines:    []string{"postgresql"},
			Binary:     "pgweb",
			Port:       8790,
			HealthPath: "/",
			Note:       "A small PostgreSQL browser (one Go binary): start it, use it, and it stops again when idle.",
		},
	}
}

// Available looks a tool up on PATH, reporting the reason when it is missing.
func Available(spec Spec, lookPath func(string) (string, error)) (string, bool) {
	if spec.Binary == "" || lookPath == nil {
		return "", false
	}
	path, err := lookPath(spec.Binary)
	if err != nil {
		return "", false
	}
	return path, true
}

// Supervisor starts tools on demand and stops the idle ones.
type Supervisor struct {
	runner        host.Runner
	idleTimeout   time.Duration
	now           func() time.Time
	mu            sync.Mutex
	locks         map[string]*sync.Mutex
	lastAccess    map[string]time.Time
	startedByTool map[string]bool
}

// New builds a supervisor. A zero timeout means the default hour.
func New(runner host.Runner, idleTimeout time.Duration) *Supervisor {
	if idleTimeout <= 0 {
		idleTimeout = time.Hour
	}
	return &Supervisor{
		runner:        runner,
		idleTimeout:   idleTimeout,
		now:           time.Now,
		locks:         map[string]*sync.Mutex{},
		lastAccess:    map[string]time.Time{},
		startedByTool: map[string]bool{},
	}
}

// SetClock is used by the tests to drive time instead of waiting for it.
func (s *Supervisor) SetClock(now func() time.Time) { s.now = now }

// IdleTimeout is what the panel reports when it explains when a tool goes away.
func (s *Supervisor) IdleTimeout() time.Duration { return s.idleTimeout }

func (s *Supervisor) lock(name string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.locks[name] == nil {
		s.locks[name] = &sync.Mutex{}
	}
	return s.locks[name]
}

// Touch records that a tool is being used, which is what keeps it alive.
func (s *Supervisor) Touch(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastAccess[name] = s.now()
}

// Ensure starts a tool if it is not running, and marks it as in use.
//
// Single-flight per tool: two requests arriving together cannot race into two
// processes fighting over the same loopback port.
func (s *Supervisor) Ensure(ctx context.Context, spec Spec, connectionURL string) error {
	lock := s.lock(spec.Name)
	lock.Lock()
	defer lock.Unlock()

	if s.running(ctx, spec) {
		s.Touch(spec.Name)
		return nil
	}
	argv := StartArgv(spec, connectionURL)
	if len(argv) == 0 {
		return fmt.Errorf("no recipe for %q", spec.Name)
	}
	if out, err := s.runner.Run(ctx, "", argv[0], argv[1:]...); err != nil {
		return fmt.Errorf("%s could not be started: %s", spec.Name, strings.TrimSpace(out))
	}

	s.mu.Lock()
	s.startedByTool[spec.Name] = true
	s.lastAccess[spec.Name] = s.now()
	s.mu.Unlock()

	// A started process is not yet a usable page.
	deadline := s.now().Add(20 * time.Second)
	for s.now().Before(deadline) {
		if s.running(ctx, spec) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
	return fmt.Errorf("%s did not answer within 20s on 127.0.0.1:%d", spec.Name, spec.Port)
}

// running asks the tool whether it answers on its loopback port.
func (s *Supervisor) running(ctx context.Context, spec Spec) bool {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := s.runner.Run(probe, "", "curl", "-fsS", "-o", "/dev/null",
		fmt.Sprintf("http://127.0.0.1:%d%s", spec.Port, spec.HealthPath))
	return err == nil && !strings.Contains(out, "refused")
}

// Stop stops a tool the panel started, and refuses to touch anything else.
func (s *Supervisor) Stop(ctx context.Context, spec Spec) error {
	lock := s.lock(spec.Name)
	lock.Lock()
	defer lock.Unlock()
	return s.stopLocked(ctx, spec)
}

func (s *Supervisor) stopLocked(ctx context.Context, spec Spec) error {
	s.mu.Lock()
	started := s.startedByTool[spec.Name]
	s.mu.Unlock()
	if !started {
		return nil // a tool the panel did not start is not the panel's to stop
	}
	out, err := s.runner.Run(ctx, "", "pkill", "-x", spec.Binary)
	if err != nil && !strings.Contains(out, "no process found") {
		return fmt.Errorf("%s could not be stopped: %s", spec.Name, strings.TrimSpace(out))
	}
	s.mu.Lock()
	s.startedByTool[spec.Name] = false
	delete(s.lastAccess, spec.Name)
	s.mu.Unlock()
	return nil
}

// Sweep stops every tool idle for longer than the timeout, and returns their names
// so the caller can audit why they went away.
func (s *Supervisor) Sweep(ctx context.Context) []string {
	stopped := []string{}
	for name, spec := range Registry() {
		s.mu.Lock()
		last, tracked := s.lastAccess[name]
		s.mu.Unlock()
		if !tracked || s.now().Sub(last) < s.idleTimeout {
			continue
		}
		lock := s.lock(name)
		lock.Lock()
		// Re-check under the lock: a request may have arrived while we waited.
		s.mu.Lock()
		last, tracked = s.lastAccess[name]
		s.mu.Unlock()
		if !tracked || s.now().Sub(last) < s.idleTimeout {
			lock.Unlock()
			continue
		}
		if err := s.stopLocked(ctx, spec); err == nil {
			stopped = append(stopped, name)
		}
		lock.Unlock()
	}
	return stopped
}

// Reconcile stops tools left running by a previous daemon: after a restart nothing
// knows how long they have been idle, and an unaccounted process is worse than a
// cold start.
func (s *Supervisor) Reconcile(ctx context.Context) {
	for _, spec := range Registry() {
		if s.running(ctx, spec) {
			_, _ = s.runner.Run(ctx, "", "pkill", "-x", spec.Binary)
		}
	}
}

// StartArgv is the command line for a tool, which is also what the tests assert.
func StartArgv(spec Spec, connectionURL string) []string {
	switch spec.Name {
	case "pgweb":
		argv := []string{"pgweb", "--listen", fmt.Sprintf("127.0.0.1:%d", spec.Port), "--skip-open",
			"--prefix", fmt.Sprintf("/api/v1/gui/%s", spec.Name)}
		if connectionURL != "" {
			argv = append(argv, "--url", connectionURL)
		}
		return argv
	}
	return nil
}
