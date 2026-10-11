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
	"os"
	"path/filepath"
	"strconv"
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
	// Prefix is the path the tool is served under, without a leading slash
	// (pgweb prepends "/" itself). The proxy sets it per database so the tool's
	// own links and assets stay inside the panel's path; empty means the default.
	Prefix string
	// Strip is set for a tool that serves from its own root and has no prefix
	// option: the proxy removes the mount before forwarding, so the tool sees
	// "/index.php" and is told its public base another way (phpMyAdmin's
	// PmaAbsoluteUri). A tool that handles its own prefix (pgweb) leaves it false.
	Strip bool
	// DocRoot is the document root for a tool that is run by a generic server
	// (php -S), set by the API to where the app was installed.
	DocRoot string
	// Match, when set, is what pkill matches on the command line instead of the
	// exact binary name: two PHP apps both run as "php", so "php" alone would let
	// one stop the other.
	Match string
	// Container marks a tool the panel runs as a Docker container instead of a
	// process: it is started with `docker run` (publishing its port on loopback
	// only) and stopped with `docker rm -f`.
	Container bool
	// Image is the container image, and ContainerName the name it is run under.
	Image         string
	ContainerName string
	// EnvFile is the --env-file the container is started with; the API writes it
	// per database (credential, scope, and the path it is served under).
	EnvFile string
	// Volumes are -v mounts (a SQLite file's directory has to reach the container),
	// and User is an optional --user (so the container writes as the tenant).
	Volumes []string
	User    string
	// Note explains what the tool is for, in the API's own words.
	Note string
}

// DefaultPrefix is the panel path a tool is served under when a request does not
// provide one (e.g. the supervisor's own Sweep/Reconcile never starts a tool).
func DefaultPrefix(name string) string { return "api/v1/gui/" + name }

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
		"phpmyadmin": {
			Name:       "phpmyadmin",
			Engines:    []string{"mysql", "mariadb"},
			Binary:     "php",
			Port:       8791,
			HealthPath: "/",
			Strip:      true,
			Match:      "php -S 127.0.0.1:8791",
			Note:       "The familiar PHP manager for MySQL/MariaDB, run by PHP's own small server — one process, no Apache or PHP-FPM, loopback only.",
		},
		"dbgate": {
			Name:          "dbgate",
			Engines:       []string{"sqlite", "mongodb", "redis"},
			Port:          8793,
			HealthPath:    "/",
			Container:     true,
			Image:         "dbgate/dbgate:latest",
			ContainerName: "barepod-dbgate",
			Note:          "A click-and-browse manager for SQLite, MongoDB and Redis, run as a container with its port published on loopback only and scoped to this one database; started on first access and removed when idle.",
		},
	}
}

// stopArgv is how a running tool is stopped: by its exact binary name, or — when
// the tool declares one — by a command-line pattern, so a tool that shares a
// binary with another (both PHP apps run as "php") stops only its own process.
func stopArgv(spec Spec) []string {
	if spec.Container {
		return []string{"docker", "rm", "-f", spec.ContainerName}
	}
	if spec.Match != "" {
		return []string{"pkill", "-f", spec.Match}
	}
	return []string{"pkill", "-x", spec.Binary}
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
	runner      host.Runner
	idleTimeout time.Duration
	// LogDir is where a tool's output is captured (one small file per tool), so a
	// start that fails can say why. Empty discards it (/dev/null).
	LogDir        string
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
	// A container start returns on its own (`docker run -d`), so it is run directly:
	// its failure (a taken port, a bad image) is then the reason the panel reports,
	// instead of being hidden behind the background wrapper.
	start := argv
	if !spec.Container {
		start = DetachedArgv(argv, s.logPathFor(spec))
	}
	if out, err := s.runner.Run(ctx, "", start[0], start[1:]...); err != nil {
		return fmt.Errorf("%s could not be started: %s", spec.Name, strings.TrimSpace(out))
	}

	s.mu.Lock()
	s.startedByTool[spec.Name] = true
	s.lastAccess[spec.Name] = s.now()
	s.mu.Unlock()

	// A started process is not yet a usable page.
	deadline := s.now().Add(startupWait)
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
	// The tool started and then died (a database that was never created, a server
	// that is down): its own output is the reason, so it is reported rather than
	// left as a bare timeout.
	if detail := s.logTail(spec); detail != "" {
		return fmt.Errorf("%s did not answer within %s on 127.0.0.1:%d: %s", spec.Name, startupWait, spec.Port, detail)
	}
	return fmt.Errorf("%s did not answer within %s on 127.0.0.1:%d", spec.Name, startupWait, spec.Port)
}

// startupWait is how long a freshly started tool may take to answer.
const startupWait = 20 * time.Second

// logPathFor is where a tool's output is captured: one small file per tool, so a
// start that fails can say why. An empty LogDir discards it.
func (s *Supervisor) logPathFor(spec Spec) string {
	if s.LogDir == "" {
		return os.DevNull
	}
	return filepath.Join(s.LogDir, "dbtools-"+spec.Name+".log")
}

// logTail is the end of a tool's output, which is where the reason usually is.
func (s *Supervisor) logTail(spec Spec) string {
	if s.LogDir == "" {
		return ""
	}
	data, err := os.ReadFile(s.logPathFor(spec))
	if err != nil {
		return ""
	}
	text := strings.TrimSpace(string(data))
	const limit = 400
	if len(text) > limit {
		text = "…" + text[len(text)-limit:]
	}
	return text
}

// running asks the tool whether it answers on its loopback port.
//
// Any HTTP answer counts, not only a 2xx: a tool served under a per-database
// prefix answers 404 at "/", and the probe must not depend on a path (curl -f
// would report a running tool as down).
func (s *Supervisor) running(ctx context.Context, spec Spec) bool {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := s.runner.Run(probe, "", "curl", "-sS", "-o", "/dev/null",
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
	argv := stopArgv(spec)
	out, err := s.runner.Run(ctx, "", argv[0], argv[1:]...)
	// pkill exits non-zero with no output when nothing matched: that is nothing to
	// stop, not a failure.
	if err != nil && strings.TrimSpace(out) != "" && !strings.Contains(out, "no process found") {
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
			argv := stopArgv(spec)
			_, _ = s.runner.Run(ctx, "", argv[0], argv[1:]...)
		}
	}
}

// DetachedArgv wraps a tool's command so the daemon does not wait for it. A
// manager runs until it is stopped, while the host runner waits for the command
// it runs to finish — starting one with the plain argv would block the request
// until it exits (forever). The tool is put in its own session, its output goes
// to logPath (which the panel reads back when a start fails), and the arguments
// are passed positionally after a shell script that only refers to them as "$@",
// so a credential with shell metacharacters cannot change the command.
func DetachedArgv(argv []string, logPath string) []string {
	if len(argv) == 0 {
		return nil
	}
	if logPath == "" {
		logPath = os.DevNull
	}
	return append([]string{"sh", "-c", fmt.Sprintf(`setsid "$@" >%s 2>&1 &`, logPath), "dbtools"}, argv...)
}

// StartArgv is the command line for a tool, which is also what the tests assert.
//
// pgweb is told the exact path it is served under (--prefix) and that it is
// scoped to a single connection (--lock-session): the panel injects that
// database's credential as --url, so the browser never types it and cannot point
// the tool at another database. The prefix must have no leading slash — pgweb
// prepends "/" itself, and a leading one makes every request answer 404.
func StartArgv(spec Spec, connectionURL string) []string {
	switch spec.Name {
	case "pgweb":
		prefix := spec.Prefix
		if prefix == "" {
			prefix = DefaultPrefix(spec.Name)
		}
		// pgweb separates host and port: --bind is the interface, --listen the port
		// (a uint). The old "--listen 127.0.0.1:8790" was refused outright.
		argv := []string{"pgweb", "--bind", "127.0.0.1", "--listen", strconv.Itoa(spec.Port), "--skip-open",
			"--lock-session", "--prefix", strings.TrimPrefix(prefix, "/")}
		if connectionURL != "" {
			argv = append(argv, "--url", connectionURL)
		}
		return argv
	case "dbgate":
		// A container manager, started on demand with its port published on loopback
		// only: the per-database env file carries the single connection it is scoped
		// to and the path it is served under.
		argv := []string{"docker", "run", "-d", "--name", spec.ContainerName}
		if spec.Port != 0 {
			argv = append(argv, "-p", fmt.Sprintf("127.0.0.1:%d:3000", spec.Port))
		}
		for _, volume := range spec.Volumes {
			argv = append(argv, "-v", volume)
		}
		if spec.User != "" {
			argv = append(argv, "--user", spec.User)
		}
		if spec.EnvFile != "" {
			argv = append(argv, "--env-file", spec.EnvFile)
		}
		return append(argv, spec.Image)
	case "phpmyadmin":
		// PHP's own built-in server: one process, no Apache or PHP-FPM. The document
		// root is where the app was installed; the panel writes the scoped config
		// there (with PmaAbsoluteUri pointing at this database's mount) before the
		// start, and the proxy strips the mount so phpMyAdmin sees its own root.
		argv := []string{"php", "-S", fmt.Sprintf("127.0.0.1:%d", spec.Port)}
		if spec.DocRoot != "" {
			argv = append(argv, "-t", spec.DocRoot)
		}
		return argv
	}
	return nil
}
