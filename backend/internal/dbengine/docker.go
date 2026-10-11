package dbengine

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// EngineMode says where an engine runs. The panel supports both because the host
// decides: a plain VPS can run containers, while an unprivileged LXC (no Docker)
// can only use packages.
type EngineMode string

const (
	ModeHost   EngineMode = "host"   // packages on the host, administered over sockets
	ModeDocker EngineMode = "docker" // a container per engine, administered over TCP
	ModeNone   EngineMode = "none"   // not available at all
)

// ContainerSpec is how one engine runs as a container.
//
// One container per engine (not per database) on purpose: it removes the host's
// packaging differences — peer auth on a socket, unix_socket authentication, a
// root role to create by hand — at the cost of a single process per engine, while
// each database still gets its own user inside it.
type ContainerSpec struct {
	Engine        string
	Image         string
	Name          string
	Volume        string
	HostPort      int
	ContainerPort int
	Env           []string // passed through an env file, never as -e on the command line
	// EnvPath is where that file was written; RunArgv must use the same path.
	EnvPath string `json:"envPath,omitempty"`
}

// containerImages pins the engine containers the panel knows how to run.
func containerImages() map[string]ContainerSpec {
	return map[string]ContainerSpec{
		"postgresql": {
			Engine: "postgresql", Image: "postgres:16-alpine", Name: "barepod-postgres",
			Volume: "barepod-postgres-data", HostPort: 5433, ContainerPort: 5432,
			Env: []string{"POSTGRES_USER=barepod_admin", "POSTGRES_DB=postgres"},
		},
		"mysql": {
			Engine: "mysql", Image: "mysql:8.0", Name: "barepod-mysql",
			Volume: "barepod-mysql-data", HostPort: 3307, ContainerPort: 3306,
			Env: []string{"MYSQL_ROOT_HOST=%"},
		},
		"mongodb": {
			Engine: "mongodb", Image: "mongo:7.0", Name: "barepod-mongo",
			Volume: "barepod-mongo-data", HostPort: 27018, ContainerPort: 27017,
			Env: []string{"MONGO_INITDB_ROOT_USERNAME=barepod_admin"},
		},
		"redis": {
			Engine: "redis", Image: "redis:7-alpine", Name: "barepod-redis",
			Volume: "barepod-redis-data", HostPort: 6380, ContainerPort: 6379,
			Env: nil, // Redis takes its credential as a command argument below
		},
	}
}

// ContainerFor builds the spec for an engine, with the admin credential the panel
// generated. The credential is written to a 0600 env file: `docker run -e
// POSTGRES_PASSWORD=…` would put it in the process list, which is what we avoided
// for the host engines as well.
func ContainerFor(engine, adminUser, adminPassword, envDir string) (ContainerSpec, []string, error) {
	spec, ok := containerImages()[strings.ToLower(engine)]
	if !ok {
		return ContainerSpec{}, nil, fmt.Errorf("dbengine: no container recipe for %q", engine)
	}
	if adminPassword == "" {
		return ContainerSpec{}, nil, fmt.Errorf("dbengine: a container engine needs an admin password")
	}

	env := []string{}
	for _, entry := range spec.Env {
		env = append(env, entry)
	}
	switch spec.Engine {
	case "postgresql":
		env = append(env, "POSTGRES_PASSWORD="+adminPassword)
	case "mysql":
		env = append(env, "MYSQL_ROOT_PASSWORD="+adminPassword)
	case "mongodb":
		env = append(env, "MONGO_INITDB_ROOT_PASSWORD="+adminPassword)
	}
	spec.Env = env

	// Redis has no environment variable for a password: it is a command argument,
	// so the container starts with an explicit --requirepass.
	extraArgv := []string{}
	if spec.Engine == "redis" {
		extraArgv = []string{"redis-server", "--requirepass", adminPassword}
	}

	var envPath string
	if len(env) > 0 {
		if envDir == "" {
			envDir = os.TempDir()
		}
		envPath = filepath.Join(envDir, spec.Name+".env")
		var builder strings.Builder
		for _, entry := range env {
			builder.WriteString(entry)
			builder.WriteString("\n")
		}
		if err := os.WriteFile(envPath, []byte(builder.String()), 0o600); err != nil {
			return ContainerSpec{}, nil, err
		}
	}
	spec.Env = env
	spec.EnvPath = envPath
	return spec, extraArgv, nil
}

// RunArgv is the command that starts the container.
//
// It uses the host's network namespace on purpose. Publishing a port
// (`-p 127.0.0.1:5433:5432`) needs the docker bridge and iptables, and an
// unprivileged LXC has neither — while running on the host network puts the engine
// directly on the host's loopback, which is where the tenant's application expects
// it anyway. Each engine is therefore told to listen on its own port.
func (c ContainerSpec) RunArgv() []string {
	argv := []string{
		"docker", "run", "-d", "--restart", "unless-stopped",
		"--name", c.Name,
		"--network", "host",
		"-v", c.Volume + ":/var/lib/" + c.Engine,
	}
	if c.EnvPath != "" {
		argv = append(argv, "--env-file", c.EnvPath)
	}
	argv = append(argv, c.Image)
	argv = append(argv, c.engineArgs()...)
	return argv
}

// engineArgs tells the engine inside the container which port to use, so several
// engines can share the host's loopback without colliding with the host's own.
func (c ContainerSpec) engineArgs() []string {
	switch c.Engine {
	case "postgresql":
		return []string{"-c", fmt.Sprintf("port=%d", c.HostPort)}
	case "mysql":
		return []string{"--port", fmt.Sprint(c.HostPort)}
	case "mongodb":
		return []string{"--port", fmt.Sprint(c.HostPort)}
	case "redis":
		return []string{"--port", fmt.Sprint(c.HostPort)}
	}
	return nil
}

// HealthArgv is how the panel asks the engine whether it is ready. It must name the
// port the container was told to listen on: the first version assumed each engine's
// default, so a healthy MongoDB on 27018 was reported as never coming up.
func (c ContainerSpec) HealthArgv() []string {
	switch c.Engine {
	case "postgresql":
		return []string{"pg_isready", "-q", "-p", fmt.Sprint(c.HostPort)}
	case "mysql":
		return []string{"mysqladmin", "ping", "--silent", "--port", fmt.Sprint(c.HostPort)}
	case "mongodb":
		return []string{"mongosh", "--quiet", "--port", fmt.Sprint(c.HostPort), "--eval", "db.runCommand({ping:1}).ok"}
	case "redis":
		return []string{"redis-cli", "-p", fmt.Sprint(c.HostPort), "ping"}
	}
	return nil
}

// LifecycleArgv are the other verbs the panel needs.
func (c ContainerSpec) StartArgv() []string  { return []string{"docker", "start", c.Name} }
func (c ContainerSpec) StopArgv() []string   { return []string{"docker", "stop", c.Name} }
func (c ContainerSpec) RemoveArgv() []string { return []string{"docker", "rm", "-f", c.Name} }
func (c ContainerSpec) ExistsArgv() []string {
	return []string{"docker", "inspect", "-f", "{{.State.Running}}", c.Name}
}
func (c ContainerSpec) LogsArgv() []string { return []string{"docker", "logs", "--tail", "50", c.Name} }

// PurgeArgv also removes the volume, which is the only destructive step.
func (c ContainerSpec) PurgeArgv() [][]string {
	return [][]string{
		{"docker", "rm", "-f", c.Name},
		{"docker", "volume", "rm", c.Volume},
	}
}

// DockerAvailable reports whether this host can run containers at all: the mode
// the panel offers depends on it, and an unprivileged LXC simply cannot.
func DockerAvailable(ctx context.Context, runner interface {
	Run(context.Context, string, string, ...string) (string, error)
	Mode() string
}) bool {
	if runner == nil || runner.Mode() != "real" {
		return false
	}
	if _, err := runner.Run(ctx, "", "docker", "info"); err != nil {
		return false
	}
	return true
}
