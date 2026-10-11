package api

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// engineOrchestrator brings a containerised engine up when something needs it.
//
// One container serves every database of that engine, so this is the only place
// that starts one, and it is single-flight: two requests arriving together must
// not race into two `docker run`s with the same name.
type engineOrchestrator struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func (o *engineOrchestrator) lock(engine string) *sync.Mutex {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.locks == nil {
		o.locks = map[string]*sync.Mutex{}
	}
	if o.locks[engine] == nil {
		o.locks[engine] = &sync.Mutex{}
	}
	return o.locks[engine]
}

// healthWait is how long a freshly started engine may take to answer.
const healthWait = 30 * time.Second

// ensureEngineRunning makes sure the container for an engine is up and answers,
// and returns the administrator credential the panel uses to administer it.
func (s *Server) ensureEngineRunning(ctx context.Context, engine dbengine.Engine) (*store.EngineCredential, error) {
	// A host engine needs none of this: it is administered over its own socket.
	if engine.Mode != dbengine.ModeDocker {
		return nil, nil
	}
	s.engines.lock(engine.Name).Lock()
	defer s.engines.lock(engine.Name).Unlock()

	credential, err := s.engineCredentialFor(ctx, engine)
	if err != nil {
		return nil, err
	}

	adminPassword, err := secrets.Decrypt(s.key, credential.Ciphertext)
	if err != nil {
		return nil, errors.New("the engine administrator credential could not be decrypted")
	}
	spec, extra, err := dbengine.ContainerFor(engine.Name, credential.AdminUser, adminPassword, "")
	if err != nil {
		return nil, err
	}
	_ = extra

	running, exists := s.containerState(ctx, spec)
	switch {
	case running:
		return credential, nil
	case exists:
		// Already there, just stopped: start it, never `run` it again (the name and
		// the volume are taken).
		if out, err := s.host.Run(ctx, spec.StartArgv()); err != nil {
			return nil, fmt.Errorf("starting %s failed: %s", spec.Name, strings.TrimSpace(out))
		}
	default:
		if out, err := s.host.Run(ctx, spec.RunArgv()); err != nil {
			return nil, fmt.Errorf("creating %s failed: %s", spec.Name, strings.TrimSpace(out))
		}
	}

	if err := s.waitHealthy(ctx, spec); err != nil {
		logs, _ := s.host.Run(ctx, spec.LogsArgv())
		return nil, fmt.Errorf("%v (last output: %s)", err, tail(strings.TrimSpace(logs), 600))
	}
	_ = s.store.Audit("", "engine.start", engine.Name, "", fmt.Sprintf("container=%s mode=docker", spec.Name))
	return credential, nil
}

// tail keeps the end of an engine's log, which is where the reason usually is.
func tail(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return "…" + text[len(text)-limit:]
}

// containerState answers whether the container runs, and whether it exists at all.
func (s *Server) containerState(ctx context.Context, spec dbengine.ContainerSpec) (running, exists bool) {
	out, err := s.host.Run(ctx, spec.ExistsArgv())
	if err != nil {
		return false, false // inspect fails when there is no such container
	}
	return strings.TrimSpace(out) == "true", true
}

// waitHealthy asks the engine inside the container until it answers, because a
// started container is not a ready database.
func (s *Server) waitHealthy(ctx context.Context, spec dbengine.ContainerSpec) error {
	deadline := time.Now().Add(healthWait)
	var last string
	for time.Now().Before(deadline) {
		argv := append([]string{"docker", "exec", spec.Name}, spec.HealthArgv()...)
		out, err := s.host.Run(ctx, argv)
		if err == nil {
			return nil
		}
		last = strings.TrimSpace(out)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	if last == "" {
		last = "no answer"
	}
	return fmt.Errorf("%s did not become healthy within %s: %s", spec.Name, healthWait, last)
}

// engineCredentialFor loads the administrator credential of a container engine,
// creating (and storing) a fresh one the first time it is needed.
func (s *Server) engineCredentialFor(ctx context.Context, engine dbengine.Engine) (*store.EngineCredential, error) {
	if stored, err := s.store.EngineCredential(engine.Name); err == nil {
		return stored, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}

	spec, _, err := dbengine.ContainerFor(engine.Name, "barepod_admin", id.Token(24), os.TempDir())
	if err != nil {
		return nil, err
	}
	password := ""
	for _, entry := range spec.Env {
		if _, value, found := strings.Cut(entry, "="); found && strings.HasSuffix(entry, "PASSWORD="+value) {
			password = value
		}
	}
	if password == "" {
		// Engines without an environment variable (Redis) carry it as an argument;
		// the spec wrote it into the env file either way, so read it back.
		content, readErr := os.ReadFile(spec.EnvPath)
		if readErr != nil {
			return nil, readErr
		}
		for _, line := range strings.Split(string(content), "\n") {
			if _, value, found := strings.Cut(line, "PASSWORD="); found {
				password = value
			}
		}
	}
	if password == "" {
		return nil, errors.New("the engine credential could not be prepared")
	}

	ciphertext, err := secrets.Encrypt(s.key, password)
	if err != nil {
		return nil, err
	}
	credential := &store.EngineCredential{
		Engine: engine.Name, AdminUser: "barepod_admin", Ciphertext: ciphertext,
		Host: "127.0.0.1", Port: containerPort(engine.Name),
	}
	if err := s.store.PutEngineCredential(*credential); err != nil {
		return nil, err
	}
	return credential, nil
}

// containerPort is the loopback port that engine's container listens on.
func containerPort(engine string) int {
	spec, _, err := dbengine.ContainerFor(engine, "u", "p", os.TempDir())
	if err != nil {
		return 0
	}
	return spec.HostPort
}

// engineAddress is where an engine's records really live. An engine the panel runs
// as a container answers on the port that container publishes, not on the engine's
// standard one, and a record created while the engine was a host install keeps the
// standard port — so the stored address cannot be trusted on its own. A MongoDB
// record saying 27017 while mongod listened on 27018 was exactly this, and every
// connection handed out for it was refused.
func engineAddress(engine dbengine.Engine, record *store.Database) (host string, port int, changed bool) {
	if record.FileBased {
		return "", 0, false
	}
	host = record.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port = record.Port
	if engine.Mode == dbengine.ModeDocker {
		if published := containerPort(engine.Name); published != 0 {
			port = published
		}
	}
	return host, port, host != record.Host || port != record.Port
}

// ReconcileDatabaseAddresses repairs records whose stored address predates the
// engine's current mode. It runs once at daemon start (the detection behind it is
// too expensive to repeat per request) and returns how many records it corrected.
func (s *Server) ReconcileDatabaseAddresses(ctx context.Context) int {
	records, err := s.store.AllDatabases()
	if err != nil {
		return 0
	}
	engines := map[string]dbengine.Engine{}
	fixed := 0
	for i := range records {
		record := &records[i]
		if record.FileBased {
			continue
		}
		engine, seen := engines[record.Engine]
		if !seen {
			engine, _ = s.engineFor(ctx, record.Engine)
			engines[record.Engine] = engine
		}
		if engine.Name == "" {
			continue
		}
		host, port, changed := engineAddress(engine, record)
		if !changed {
			continue
		}
		if err := s.store.SetDatabaseAddress(record.ID, host, port); err == nil {
			fixed++
		}
	}
	return fixed
}

// containerGateway is the address a container reaches the host on: the docker bridge
// gateway. DbGate is a container, so 127.0.0.1 inside it is its own loopback, not the
// host's — an engine running as a container (which shares the host network) is
// reached there.
func (s *Server) containerGateway(ctx context.Context) string {
	probe, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := s.host.Runner.Run(probe, "", "docker", "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}
