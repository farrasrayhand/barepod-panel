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
	"net"
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
	// Image is the container image, and ContainerName the name it is run under. A
	// container tool that is scoped to one record carries a per-record name, which is
	// what makes it an instance of its own (see Key).
	Image         string
	ContainerName string
	// PortMin/PortMax, when set on a container tool, let the supervisor hand the
	// instance a free loopback port: several databases can then have this manager
	// open at once, each on its own port, instead of one shared container that has to
	// be restarted for the second one.
	PortMin int
	PortMax int
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

// Key is what the supervisor tracks the tool by. For a container that is scoped to
// one record the container's own name is the instance, so each database is its own
// running manager; a tool that is a single process keeps being tracked by name.
func (s Spec) Key() string {
	if s.ContainerName != "" {
		return s.ContainerName
	}
	return s.Name
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
			Name:       "dbgate",
			Engines:    []string{"sqlite", "mongodb", "redis", "postgresql", "mysql", "mariadb"},
			Port:       8793, // the first port of the range below, and the default
			HealthPath: "/",
			Container:  true,
			// Pinned, not `latest`, and pinned on the operator's own operating history: they
			// ran 7.3.1 and found it steadier than the 7.2 line, so that is what the panel
			// uses. There is no LTS tag to lean on (DbGate publishes `latest`, `beta` and
			// version tags only), so every candidate is measured against what this panel
			// depends on — the socket fields read from env (CONNECTION_<id>_authType/socketPath)
			// and WEB_ROOT handling. 7.3.1, 7.3.2, 7.2.6 and 7.1.13 all pass; **6.0.0 does
			// not** (its env loader ignores those fields, which would drop PostgreSQL, MySQL
			// and MariaDB back to an unreachable TCP loopback). The alpine variant is 30 MB
			// lighter and loads its SQLite module in a direct require, but the reported musl
			// loader error is not worth the risk on the one file-based engine. The image is
			// DbGate's community edition, the only edition there is: its "premium" items are
			// licence upsells inside that same image, and no setting removes them.
			Image:         "dbgate/dbgate:7.3.1",
			ContainerName: "barepod-dbgate",
			// The API names each instance after its record and takes a port from this
			// range, so several databases can have DbGate open at once.
			PortMin: 8793,
			PortMax: 8892,
			Note:    "A click-and-browse manager for every engine here, run as one container per database on its own loopback-only port and scoped to that database; started on first access and removed when idle, so several can be open at once.",
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
	// active is the spec each running instance was started with, so the idle sweeper
	// can stop it: it cannot be derived from the registry, because a container tool
	// may have several instances (one per database).
	active map[string]Spec
	// ports is the loopback port each instance was given, released when it stops.
	ports map[string]int
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
		active:        map[string]Spec{},
		ports:         map[string]int{},
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
	key := spec.Key()
	lock := s.lock(key)
	lock.Lock()
	defer lock.Unlock()

	// A container tool scoped to one record gets its own loopback port, so a second
	// database's manager is a second instance rather than a replacement for the first
	// — replacing it would close the page somebody already has open.
	if spec.Container && spec.Port == 0 && spec.PortMin > 0 {
		port, ok := s.reservePort(key, spec.PortMin, spec.PortMax)
		if !ok {
			return fmt.Errorf("%s has no free loopback port left (%d–%d are in use)", spec.Name, spec.PortMin, spec.PortMax)
		}
		spec.Port = port
	}

	if s.running(ctx, spec) {
		// The port answering says something is listening; the container's own WEB_ROOT
		// says it is *this* database's instance, which is what a page needs.
		if !spec.Container || s.containerMatches(ctx, spec) {
			s.Touch(key)
			return nil
		}
		_, _ = s.runner.Run(ctx, "", "docker", "rm", "-f", spec.ContainerName)
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
		if !spec.Container {
			return fmt.Errorf("%s could not be started: %s", spec.Name, strings.TrimSpace(out))
		}
		// Docker refuses a container *instantly* while its name or its loopback port is
		// still held by the one that was just removed — which is exactly the moment
		// somebody opens a manager right after another one went away, and it surfaced as a
		// 502 in 171 ms rather than as the startup wait it looked like. One retry reduced
		// that (1 failure in 3 measured attempts) without removing it, so this clears the
		// name and tries a few times: a refusal the operator sees is worse than a start
		// that takes a second or two.
		startErr, detail := err, strings.TrimSpace(out)
		for attempt := 0; attempt < containerStartAttempts && startErr != nil; attempt++ {
			_, _ = s.runner.Run(ctx, "", "docker", "rm", "-f", spec.ContainerName)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(containerRetryWait):
			}
			var retryOut string
			retryOut, startErr = s.runner.Run(ctx, "", start[0], start[1:]...)
			if startErr != nil {
				detail = strings.TrimSpace(retryOut)
			}
		}
		if startErr != nil {
			return fmt.Errorf("%s could not be started: %s", spec.Name, detail)
		}
	}

	s.mu.Lock()
	s.startedByTool[key] = true
	s.lastAccess[key] = s.now()
	s.active[key] = spec
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

// containerRetryWait is how long to let Docker release a name and a loopback port before
// starting the replacement for a container that was just removed, and
// containerStartAttempts is how many times that replacement is attempted before the
// refusal is reported.
const (
	containerRetryWait     = 1200 * time.Millisecond
	containerStartAttempts = 4
)

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
// Any HTTP status counts, not only a 2xx: a tool served under a per-database prefix
// answers 404 at "/", so the test must not depend on the status — but it must be a
// *status*. This used to accept anything that was not literally "connection refused",
// and a published container port accepts a TCP connection before the application inside
// it is listening: the probe collected a reset, called the tool up, and the request that
// followed was refused — the "dbgate did not answer on loopback: dial tcp 127.0.0.1:8794:
// connect: connection refused" an operator saw on the first open. curl prints 000 and
// fails when no response arrived, which is the honest answer.
func (s *Supervisor) running(ctx context.Context, spec Spec) bool {
	probe, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := s.runner.Run(probe, "", "curl", "-sS", "-o", "/dev/null", "-w", "%{http_code}",
		fmt.Sprintf("http://127.0.0.1:%d%s", spec.Port, spec.HealthPath))
	if err != nil {
		return false
	}
	code := strings.TrimSpace(out)
	return len(code) == 3 && code != "000"
}

// containerMatches reports whether the running container is scoped to this spec's
// mount. A container is shared between databases (one loopback port), so the port
// answering is not enough: the WEB_ROOT it was started with has to be this one, or
// the page being served belongs to another database's mount.
func (s *Supervisor) containerMatches(ctx context.Context, spec Spec) bool {
	if spec.Prefix == "" {
		return true // nothing scopes it, so the port probe is all there is to go on
	}
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := s.runner.Run(probe, "", "docker", "inspect", "--format", "{{json .Config.Env}}", spec.ContainerName)
	if err != nil {
		return false
	}
	return strings.Contains(out, `"WEB_ROOT=`+spec.Prefix+`"`)
}

// Stop stops a tool the panel started, and refuses to touch anything else.
func (s *Supervisor) Stop(ctx context.Context, spec Spec) error {
	lock := s.lock(spec.Key())
	lock.Lock()
	defer lock.Unlock()
	return s.stopLocked(ctx, spec)
}

func (s *Supervisor) stopLocked(ctx context.Context, spec Spec) error {
	key := spec.Key()
	s.mu.Lock()
	started := s.startedByTool[key]
	s.mu.Unlock()
	if !started {
		return nil // a tool the panel did not start is not the panel's to stop
	}
	argv := stopArgv(spec)
	out, err := s.runner.Run(ctx, "", argv[0], argv[1:]...)
	// pkill exits non-zero with no output when nothing matched, and `docker rm -f`
	// complains about a container that is already gone: neither is a failure.
	if err != nil && strings.TrimSpace(out) != "" &&
		!strings.Contains(out, "no process found") && !strings.Contains(out, "No such container") {
		return fmt.Errorf("%s could not be stopped: %s", spec.Name, strings.TrimSpace(out))
	}
	s.mu.Lock()
	s.startedByTool[key] = false
	delete(s.lastAccess, key)
	delete(s.active, key)
	delete(s.ports, key)
	s.mu.Unlock()
	return nil
}

// Port is the loopback port an instance listens on: the same one while it is open, a
// fresh one otherwise. The caller needs it to proxy to the instance, and the
// supervisor releases it when that instance stops.
func (s *Supervisor) Port(spec Spec) (int, bool) {
	key := spec.Key()
	s.mu.Lock()
	if port, ok := s.ports[key]; ok {
		s.mu.Unlock()
		return port, true
	}
	s.mu.Unlock()
	return s.reservePort(key, spec.PortMin, spec.PortMax)
}

// reservePort hands an instance a free loopback port and remembers it, so the same
// database reuses the port while it is open. It goes back into the pool when the
// instance stops, so the pool only ever holds what is really running.
func (s *Supervisor) reservePort(key string, min, max int) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if port, ok := s.ports[key]; ok {
		return port, true
	}
	used := map[int]bool{}
	for _, port := range s.ports {
		used[port] = true
	}
	for port := min; port <= max; port++ {
		if !used[port] {
			s.ports[key] = port
			return port, true
		}
	}
	return 0, false
}

// Sweep stops every tool idle for longer than the timeout, and returns the ones it stopped so the
// caller can audit why they went away — and the ones it could not, because a stop that fails silently
// leaves a container running for as long as the host does, with nothing anywhere saying so.
func (s *Supervisor) Sweep(ctx context.Context) (stopped []string, failed []string) {
	stopped = []string{}
	// What is running is what the panel started, not what the registry knows: a
	// container tool can have one instance per database.
	s.mu.Lock()
	instances := make(map[string]Spec, len(s.active))
	for key, spec := range s.active {
		instances[key] = spec
	}
	s.mu.Unlock()

	for key, spec := range instances {
		s.mu.Lock()
		last, tracked := s.lastAccess[key]
		s.mu.Unlock()
		if !tracked || s.now().Sub(last) < s.idleTimeout {
			continue
		}
		lock := s.lock(key)
		lock.Lock()
		// Re-check under the lock: a request may have arrived while we waited.
		s.mu.Lock()
		last, tracked = s.lastAccess[key]
		s.mu.Unlock()
		if !tracked || s.now().Sub(last) < s.idleTimeout {
			lock.Unlock()
			continue
		}
		if err := s.stopLocked(ctx, spec); err == nil {
			stopped = append(stopped, key)
		} else {
			failed = append(failed, key+": "+err.Error())
		}
		lock.Unlock()
	}
	return stopped, failed
}

// Reconcile deals with what a previous daemon left behind.
//
// A manager that is a process is stopped: its arguments carry the credential it was
// given, and there is nothing to read them back from (the tool's own command line is
// not ours to reconstruct), so a cold start is the honest choice.
//
// A container is *adopted* instead. It is named after the database it serves and it
// holds its own configuration inside itself, so the new daemon can recognise it, take
// it over and keep serving whoever has the page open — removing them, as this used to,
// closed every open manager the moment the panel restarted, which is exactly when an
// operator notices "it is not stable". An adopted instance is given a fresh idle
// window, so the sweeper still stops it once nobody comes back.
// Reconcile deals with what a previous daemon left behind, and reports what it adopted: a manager
// running with nobody tracking it is a container nobody will ever stop, which is exactly how one was
// found still up three hours after its last use, with no log line to explain it.
func (s *Supervisor) Reconcile(ctx context.Context) []string {
	adoptedNames := []string{}
	for _, spec := range Registry() {
		if spec.Container {
			continue // adopted below, never removed
		}
		if s.running(ctx, spec) {
			argv := stopArgv(spec)
			_, _ = s.runner.Run(ctx, "", argv[0], argv[1:]...)
		}
	}
	for _, spec := range Registry() {
		if !spec.Container || spec.ContainerName == "" {
			continue
		}
		out, err := s.runner.Run(ctx, "", "docker", "ps",
			"--filter", "name="+spec.ContainerName, "--format", "{{.Names}}\t{{.Ports}}")
		if err != nil {
			continue
		}
		for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
			name, ports, _ := strings.Cut(strings.TrimSpace(line), "\t")
			if name == "" {
				continue
			}
			adopted := spec
			adopted.ContainerName = name
			adopted.Port = publishedPort(ports)
			s.mu.Lock()
			s.active[name] = adopted
			s.startedByTool[name] = true
			s.lastAccess[name] = s.now()
			if adopted.Port != 0 {
				s.ports[name] = adopted.Port
			}
			s.mu.Unlock()
			adoptedNames = append(adoptedNames, name)
		}
	}
	return adoptedNames
}

// publishedPort reads the loopback port out of `docker ps --format {{.Ports}}`, e.g.
// "127.0.0.1:8793->3000/tcp" -> 8793. Zero means it publishes nothing (the instance is
// then still adoptable, it just does not reserve a port).
func publishedPort(ports string) int {
	for _, field := range strings.Fields(ports) {
		host, rest, ok := strings.Cut(field, "->")
		if !ok {
			continue
		}
		if _, port, err := net.SplitHostPort(host); err == nil {
			if n, err := strconv.Atoi(port); err == nil {
				_ = rest
				return n
			}
		}
	}
	return 0
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
