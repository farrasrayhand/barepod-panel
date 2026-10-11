package dbtools

import (
	"context"
	"errors"
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

	// Never published: loopback only.
	if !strings.Contains(argv, "--listen 127.0.0.1:8790") {
		t.Errorf("the tool is not bound to loopback: %s", argv)
	}
	// It must know it is served under the panel's own path, or its assets break.
	if !strings.Contains(argv, "--prefix /api/v1/gui/pgweb") {
		t.Errorf("the tool does not know its prefix: %s", argv)
	}
	for _, want := range []string{"--skip-open", "--url postgres://u:p@127.0.0.1:5432/db"} {
		if !strings.Contains(argv, want) {
			t.Errorf("the command is missing %q: %s", want, argv)
		}
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
	if starts := strings.Count(runner.log(), "pgweb --listen"); starts != 1 {
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
	if starts := strings.Count(runner.log(), "pgweb --listen"); starts != 2 {
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
	// knows how long they have been idle.
	supervisor.Reconcile(context.Background())
	if !strings.Contains(runner.log(), "pkill -x pgweb") {
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
