package dbtools

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeRunner stands in for the host: it has a port that is down until something
// starts listening on it, which is exactly what the supervisor has to cope with.
type fakeRunner struct {
	mu       sync.Mutex
	commands []string
	up       bool
	failNext bool
	// containerEnv is what `docker inspect --format {{json .Config.Env}}` answers,
	// which is how the supervisor tells which database a shared container serves.
	containerEnv string
}

func (f *fakeRunner) Mode() string { return "fake" }

func (f *fakeRunner) Run(_ context.Context, dir, name string, args ...string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.commands = append(f.commands, strings.TrimSpace(name+" "+strings.Join(args, " ")))

	switch name {
	case "curl":
		if f.up {
			return "200\n", nil
		}
		return "curl: (7) Connection refused\n", errors.New("exit status 7")
	case "pkill":
		f.up = false
		return "", nil
	case "docker":
		if len(args) > 0 && args[0] == "inspect" {
			return f.containerEnv + "\n", nil
		}
		if len(args) > 0 && args[0] == "rm" {
			f.up = false
			return "", nil
		}
		f.up = true // docker run
		return "", nil
	default: // the tool itself
		if f.failNext {
			f.failNext = false
			return "cannot bind", errors.New("exit status 1")
		}
		f.up = true
		return "", nil
	}
}

func (f *fakeRunner) RunAs(_ context.Context, _ string, _ string, name string, args ...string) (string, error) {
	return f.Run(context.Background(), "", name, args...)
}

func (f *fakeRunner) RunEnv(_ context.Context, _ string, _ []string, name string, args ...string) (string, error) {
	return f.Run(context.Background(), "", name, args...)
}

func (f *fakeRunner) log() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return strings.Join(f.commands, "\n")
}

func TestPgwеbIsStartedOnLoopbackBehindThePanelPath(t *testing.T) {
	spec := Registry()["pgweb"]
	argv := strings.Join(StartArgv(spec, "postgres://u:p@127.0.0.1:5432/db"), " ")

	// Never published: loopback only. pgweb takes the host and the port as two
	// separate flags (--bind host, --listen port), not "host:port".
	for _, want := range []string{"--bind 127.0.0.1", "--listen 8790"} {
		if !strings.Contains(argv, want) {
			t.Errorf("the tool is not bound to loopback (%q missing): %s", want, argv)
		}
	}
	if strings.Contains(argv, "--listen 127.0.0.1") {
		t.Errorf("--listen must be a port, not host:port: %s", argv)
	}
	// It must know it is served under the panel's own path, or its assets break.
	// No leading slash: pgweb adds the "/" itself, and a leading one 404s.
	if !strings.Contains(argv, "--prefix api/v1/gui/pgweb") {
		t.Errorf("the tool does not know its prefix: %s", argv)
	}
	// One connection only: the panel injects the credential, so the browser must
	// not be able to point the tool at another database.
	if !strings.Contains(argv, "--lock-session") {
		t.Errorf("the tool is not locked to the injected connection: %s", argv)
	}
	for _, want := range []string{"--skip-open", "--url postgres://u:p@127.0.0.1:5432/db"} {
		if !strings.Contains(argv, want) {
			t.Errorf("the command is missing %q: %s", want, argv)
		}
	}
}

// The proxy serves one database under its own path: the tool has to be told that
// exact mount, so its links and assets stay inside the panel's path.
func TestStartArgvCarriesTheMountPrefix(t *testing.T) {
	spec := Registry()["pgweb"]
	spec.Prefix = "/api/v1/databases/01H/gui/pgweb"
	argv := strings.Join(StartArgv(spec, ""), " ")
	if !strings.Contains(argv, "--prefix api/v1/databases/01H/gui/pgweb") {
		t.Errorf("the per-database prefix was not passed through: %s", argv)
	}
	if strings.Contains(argv, "--prefix /") {
		t.Errorf("the prefix still has a leading slash, which pgweb 404s on: %s", argv)
	}
}

// A manager runs forever, so it must be detached; and the credential is passed
// positionally, so a password with shell metacharacters cannot change the command.
func TestDetachedArgvDoesNotLetTheCredentialChangeTheCommand(t *testing.T) {
	argv := StartArgv(Registry()["pgweb"], "postgres://u:p'w&d@127.0.0.1:5432/db")
	wrapped := DetachedArgv(argv, "/var/lib/barepod/dbtools-pgweb.log")
	if len(wrapped) != 4+len(argv) || wrapped[0] != "sh" || wrapped[1] != "-c" {
		t.Fatalf("the wrapper is wrong: %v", wrapped)
	}
	if !strings.Contains(wrapped[2], `"$@"`) {
		t.Errorf("the script must run the arguments, not embed them: %s", wrapped[2])
	}
	if strings.Contains(wrapped[2], `'w&d`) {
		t.Errorf("the credential was inlined into the script: %s", wrapped[2])
	}
	if !strings.Contains(wrapped[2], "/var/lib/barepod/dbtools-pgweb.log") {
		t.Errorf("the output is not captured where the panel can read it: %s", wrapped[2])
	}
	if wrapped[4] != argv[0] {
		t.Errorf("the tool command is not passed positionally: %v", wrapped)
	}
	if DetachedArgv(nil, "x") != nil {
		t.Error("nothing must wrap to nothing")
	}
	if wrapped := DetachedArgv([]string{"pgweb"}, ""); !strings.Contains(wrapped[2], os.DevNull) {
		t.Errorf("an empty log path must discard the output: %s", wrapped[2])
	}
}

// phpMyAdmin runs on PHP's built-in server, and because it shares the "php"
// binary with any other PHP manager, it is stopped by its own command line rather
// than by "php" (which would let one manager stop the other).
func TestPhpMyAdminRunsOnTheBuiltinServerAndStopsByItsOwnPattern(t *testing.T) {
	spec := Registry()["phpmyadmin"]
	if spec.Binary != "php" || !spec.Strip {
		t.Fatalf("unexpected phpmyadmin spec: %+v", spec)
	}
	spec.DocRoot = "/var/lib/barepod/dbtools/phpmyadmin"
	argv := strings.Join(StartArgv(spec, ""), " ")
	if !strings.Contains(argv, "php -S 127.0.0.1:8791") || !strings.Contains(argv, "-t /var/lib/barepod/dbtools/phpmyadmin") {
		t.Errorf("phpMyAdmin is not run by the built-in server on loopback: %s", argv)
	}
	if got := strings.Join(stopArgv(spec), " "); got != "pkill -f php -S 127.0.0.1:8791" {
		t.Errorf("phpMyAdmin is not stopped by its own pattern: %s", got)
	}
	if got := strings.Join(stopArgv(Registry()["pgweb"]), " "); got != "pkill -x pgweb" {
		t.Errorf("pgweb must still be stopped by its exact binary name: %s", got)
	}
}

// DbGate is a container: it publishes its port on loopback only, mounts what it
// needs (a SQLite file's directory), runs as the tenant, and is *removed* to stop
// (a container is not a process to signal).
func TestDbGateRunsAsAContainerOnLoopbackOnlyAndIsRemovedToStop(t *testing.T) {
	spec := Registry()["dbgate"]
	if !spec.Container || spec.ContainerName == "" {
		t.Fatalf("unexpected dbgate spec: %+v", spec)
	}
	spec.EnvFile = "/var/lib/barepod/dbtools/dbgate-01H.env"
	spec.Volumes = []string{"/home/t/apps/site:/dbgate-sqlite"}
	spec.User = "1001:1001"
	argv := strings.Join(StartArgv(spec, ""), " ")
	for _, want := range []string{
		"docker run -d --name barepod-dbgate",
		"-p 127.0.0.1:8793:3000",
		"-v /home/t/apps/site:/dbgate-sqlite",
		"--user 1001:1001",
		"--env-file /var/lib/barepod/dbtools/dbgate-01H.env",
		"dbgate/dbgate:latest",
	} {
		if !strings.Contains(argv, want) {
			t.Errorf("the DbGate command is missing %q: %s", want, argv)
		}
	}
	if got := strings.Join(stopArgv(spec), " "); got != "docker rm -f barepod-dbgate" {
		t.Errorf("DbGate is not removed by its own name: %s", got)
	}
}

// A shared container is scoped to one database at a time. One left over from
// another database (or from an earlier daemon) must be replaced rather than reused:
// the port answering says nothing about which database it serves, so reusing it
// answers every request with the other database's page — DbGate's own "Cannot GET
// /api/v1/databases/<this one>/gui/dbgate/".
func TestASharedContainerScopedElsewhereIsReplacedNotReused(t *testing.T) {
	ctx := context.Background()
	spec := Registry()["dbgate"]
	spec.Prefix = "/api/v1/databases/MINE/gui/dbgate"
	spec.EnvFile = "/var/lib/barepod/dbtools/dbgate-MINE.env"

	other := &fakeRunner{up: true, containerEnv: `["PORT=3000","WEB_ROOT=/api/v1/databases/OTHER/gui/dbgate"]`}
	if err := New(other, time.Minute).Ensure(ctx, spec, ""); err != nil {
		t.Fatalf("Ensure failed: %v", err)
	}
	if !strings.Contains(other.log(), "docker rm -f barepod-dbgate") {
		t.Errorf("the container scoped to another database was reused:\n%s", other.log())
	}
	if starts := strings.Count(other.log(), "docker run -d"); starts != 1 {
		t.Errorf("the container was not started for this database (%d starts):\n%s", starts, other.log())
	}

	mine := &fakeRunner{up: true, containerEnv: `["PORT=3000","WEB_ROOT=/api/v1/databases/MINE/gui/dbgate"]`}
	if err := New(mine, time.Minute).Ensure(ctx, spec, ""); err != nil {
		t.Fatalf("Ensure failed: %v", err)
	}
	if log := mine.log(); strings.Contains(log, "docker rm") || strings.Contains(log, "docker run") {
		t.Errorf("a container already scoped to this database was restarted:\n%s", log)
	}
}

func TestEnsureStartsOnceAndIdleSweepStopsIt(t *testing.T) {
	runner := &fakeRunner{}
	supervisor := New(runner, 30*time.Minute)
	now := time.Now()
	supervisor.SetClock(func() time.Time { return now })

	spec := Registry()["pgweb"]
	ctx := context.Background()
	if err := supervisor.Ensure(ctx, spec, "postgres://u:p@127.0.0.1:5432/db"); err != nil {
		t.Fatalf("Ensure failed: %v", err)
	}

	// In use: a second request must reuse the process, not spawn another one.
	if err := supervisor.Ensure(ctx, spec, "postgres://u:p@127.0.0.1:5432/db"); err != nil {
		t.Fatalf("the second Ensure failed: %v", err)
	}
	if starts := strings.Count(runner.log(), "pgweb --bind"); starts != 1 {
		t.Errorf("the tool was started %d times:\n%s", starts, runner.log())
	}
	if stopped := supervisor.Sweep(ctx); len(stopped) != 0 {
		t.Errorf("a tool in use was stopped: %v", stopped)
	}

	// Idle past the timeout: it goes away, and the caller is told why.
	now = now.Add(31 * time.Minute)
	stopped := supervisor.Sweep(ctx)
	if len(stopped) != 1 || stopped[0] != "pgweb" {
		t.Fatalf("the idle tool was not stopped: %v", stopped)
	}
	if !strings.Contains(runner.log(), "pkill -x pgweb") {
		t.Errorf("the tool was not actually stopped:\n%s", runner.log())
	}

	// A new request brings it back.
	now = now.Add(time.Minute)
	if err := supervisor.Ensure(ctx, spec, ""); err != nil {
		t.Fatalf("the tool did not come back: %v", err)
	}
	if starts := strings.Count(runner.log(), "pgweb --bind"); starts != 2 {
		t.Errorf("the tool was not restarted on demand (%d starts):\n%s", starts, runner.log())
	}
}

func TestStopNeverKillsWhatThePanelDidNotStart(t *testing.T) {
	runner := &fakeRunner{up: true} // something else is already listening
	supervisor := New(runner, time.Minute)
	spec := Registry()["pgweb"]

	if err := supervisor.Stop(context.Background(), spec); err != nil {
		t.Errorf("stopping an unstarted tool failed: %v", err)
	}
	if strings.Contains(runner.log(), "pkill") {
		t.Errorf("the supervisor killed a process it did not start:\n%s", runner.log())
	}
	// Reconcile, however, is allowed to clear leftovers: after a restart nothing
	// knows how long they have been idle. (Which tool it reaches first is
	// unspecified — the registry has more than one and the fake port is shared —
	// so this only asserts that a leftover was killed at all.)
	supervisor.Reconcile(context.Background())
	if !strings.Contains(runner.log(), "pkill") {
		t.Errorf("reconcile did not clear a leftover process:\n%s", runner.log())
	}
}

func TestAStartThatFailsIsReportedNotHidden(t *testing.T) {
	runner := &fakeRunner{failNext: true}
	supervisor := New(runner, time.Minute)
	err := supervisor.Ensure(context.Background(), Registry()["pgweb"], "")
	if err == nil || !strings.Contains(err.Error(), "could not be started") {
		t.Fatalf("a failed start must be reported: %v", err)
	}
}

func TestRegistryOnlyOffersEnginesTheToolCanOpen(t *testing.T) {
	spec := Registry()["pgweb"]
	if len(spec.Engines) != 1 || spec.Engines[0] != "postgresql" {
		t.Errorf("pgweb should declare exactly the engines it opens: %v", spec.Engines)
	}
	if spec.Port == 0 || spec.HealthPath == "" {
		t.Errorf("a spec needs a loopback port and a health path: %+v", spec)
	}
	if StartArgv(Spec{Name: "unknown"}, "x") != nil {
		t.Error("an unknown tool must not produce a command")
	}
	if _, ok := Available(Spec{Binary: "pgweb"}, func(string) (string, error) { return "", errors.New("no") }); ok {
		t.Error("a missing binary must not be offered")
	}
}
