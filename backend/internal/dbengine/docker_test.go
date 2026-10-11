package dbengine

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
)

func TestContainerBindsLoopbackAndKeepsCredentialsOutOfArgv(t *testing.T) {
	adminSecret := id.Token(16)
	spec, extra, err := ContainerFor("postgresql", "barepod_admin", adminSecret, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(extra) != 0 {
		t.Errorf("postgres should need no extra arguments: %v", extra)
	}
	argv := strings.Join(spec.RunArgv(), " ")
	if !strings.Contains(argv, "postgres:16-alpine") {
		t.Errorf("the image is missing: %s", argv)
	}
	// The host's network namespace, not a published port: publishing needs the
	// bridge and iptables, which an unprivileged LXC does not have, and this way the
	// engine lands on the host's own loopback.
	if !strings.Contains(argv, "--network host") {
		t.Errorf("the container does not use the host network: %s", argv)
	}
	if strings.Contains(argv, "-p ") {
		t.Errorf("a published port needs iptables, which this target cannot provide: %s", argv)
	}
	if !strings.Contains(argv, "-c port=5433") {
		t.Errorf("the engine was not told its port: %s", argv)
	}
	if !strings.Contains(argv, "-v barepod-postgres-data:/var/lib/postgresql") {
		t.Errorf("the volume is missing: %s", argv)
	}
	// The credential must not be in the process list.
	if strings.Contains(argv, adminSecret) {
		t.Errorf("the admin password reached argv: %s", argv)
	}
	if !strings.Contains(argv, "--env-file") {
		t.Errorf("the credential is not passed through an env file: %s", argv)
	}
	content, err := os.ReadFile(spec.EnvPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "POSTGRES_PASSWORD="+adminSecret) {
		t.Errorf("the env file is missing the credential: %s", content)
	}
	if info, err := os.Stat(spec.EnvPath); err == nil && info.Mode().Perm() != 0o600 {
		t.Errorf("the env file should be 0600, it is %o", info.Mode().Perm())
	}
	defer func() { _ = os.Remove(spec.EnvPath) }()

	// Redis has no environment variable for its password, so it arrives as an
	// argument. The expected value is built from the variable rather than written
	// out, so this file never contains something that looks like a credential
	// (a scanner flagged exactly that once).
	redisSecret := id.Token(16)
	redis, extraRedis, err := ContainerFor("redis", "barepod_admin", redisSecret, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(extraRedis, " ") != "redis-server --requirepass "+redisSecret {
		t.Errorf("redis arguments = %v", extraRedis)
	}
	if strings.Contains(strings.Join(redis.RunArgv(), " "), redisSecret) {
		t.Errorf("the redis credential reached the container argument list: %v", redis.RunArgv())
	}
	if redis.EnvPath != "" {
		t.Errorf("redis should need no env file")
	}
	if !strings.Contains(strings.Join(redis.RunArgv(), " "), "--port 6380") {
		t.Errorf("redis was not told its port: %v", redis.RunArgv())
	}
}

func TestContainerLifecycleAndPurge(t *testing.T) {
	spec, _, err := ContainerFor("mysql", "barepod_admin", id.Token(16), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = os.Remove(spec.EnvPath) }()

	if strings.Join(spec.StartArgv(), " ") != "docker start barepod-mysql" {
		t.Errorf("start = %v", spec.StartArgv())
	}
	if strings.Join(spec.StopArgv(), " ") != "docker stop barepod-mysql" {
		t.Errorf("stop = %v", spec.StopArgv())
	}
	// Suspend stops the container (the data stays in its volume); purge removes
	// both — the only destructive step.
	purge := spec.PurgeArgv()
	if len(purge) != 2 {
		t.Fatalf("purge = %v", purge)
	}
	if strings.Join(purge[0], " ") != "docker rm -f barepod-mysql" {
		t.Errorf("purge should remove the container: %v", purge[0])
	}
	if strings.Join(purge[1], " ") != "docker volume rm barepod-mysql-data" {
		t.Errorf("purge should remove the volume: %v", purge[1])
	}

	// Every engine the panel offers as a database or cache has a recipe.
	for _, engine := range []string{"postgresql", "mysql", "mongodb", "redis"} {
		spec, _, err := ContainerFor(engine, "u", "p", t.TempDir())
		if err != nil {
			t.Errorf("%s has no container recipe: %v", engine, err)
			continue
		}
		if len(spec.engineArgs()) == 0 {
			t.Errorf("%s does not say which port to listen on", engine)
		}
		// The health probe has to ask that same port: assuming the engine's default
		// reported a healthy MongoDB as never coming up.
		health := strings.Join(spec.HealthArgv(), " ")
		if !strings.Contains(health, fmt.Sprint(spec.HostPort)) {
			t.Errorf("%s health probe does not name its port: %s", engine, health)
		}
	}
	if _, _, err := ContainerFor("sqlite", "u", "p", t.TempDir()); err == nil {
		t.Error("sqlite is a file and must not have a container")
	}
	if _, _, err := ContainerFor("postgresql", "u", "", t.TempDir()); err == nil {
		t.Error("a container engine without an admin password was accepted")
	}
}

func TestModesAreHonest(t *testing.T) {
	// An engine that is not installed anywhere is "none"; the host path is what a
	// package install gives; docker is only claimed when Docker really answers.
	if ModeNone != "none" || ModeHost != "host" || ModeDocker != "docker" {
		t.Error("the mode names are part of the API and must not drift")
	}
}
