// Package dbengine knows which database engines this host can actually run, and
// what it would take to provision one.
//
// Two rules shape it: a report must never claim an engine is usable when it is
// not, and a name or password that comes from the panel must never be able to
// change the meaning of a SQL statement.
package dbengine

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// Engine is one engine the panel offers.
type Engine struct {
	Name        string   `json:"engine"`
	Label       string   `json:"label"`
	Kind        string   `json:"kind"` // database | cache
	Versions    []string `json:"versions"`
	DefaultPort int      `json:"port,omitempty"`
	// FileBased engines (SQLite) live inside the site: no daemon, no credentials.
	FileBased  bool   `json:"fileBased"`
	Client     string `json:"client,omitempty"`
	ClientPath string `json:"clientPath,omitempty"`
	Daemon     string `json:"daemon,omitempty"`
	// Available means the client for this engine is installed on the host.
	Available bool `json:"available"`
	// Running means the server answered a probe on this host.
	Running bool `json:"running"`
	// Automated means the panel can create/drop this engine's resources itself.
	Automated bool `json:"automated"`
	// Mode says where this engine runs on this host: a container, packages, or
	// nowhere yet. The panel never leaves that implicit.
	Mode EngineMode `json:"mode"`
	Note string     `json:"note,omitempty"`
}

// catalog is the list of engines, with the versions the panel offers.
func catalog() []Engine {
	return []Engine{
		{
			Name: "sqlite", Label: "SQLite", Kind: "database",
			Versions: []string{"3.45", "3.44"}, FileBased: true, Automated: true,
			Note: "A file inside the website directory: no daemon, no credentials, no port.",
		},
		{
			Name: "postgresql", Label: "PostgreSQL", Kind: "database",
			Versions: []string{"16", "15", "14"}, DefaultPort: 5432,
			Client: "psql", Daemon: "postgresql", Automated: true,
		},
		{
			Name: "mysql", Label: "MySQL", Kind: "database",
			Versions: []string{"8.0", "5.7"}, DefaultPort: 3306,
			Client: "mysql", Daemon: "mysql", Automated: true,
		},
		{
			Name: "mariadb", Label: "MariaDB", Kind: "database",
			Versions: []string{"11.4", "10.11"}, DefaultPort: 3306,
			Client: "mariadb", Daemon: "mariadb", Automated: true,
		},
		{
			Name: "mongodb", Label: "MongoDB", Kind: "database",
			Versions: []string{"7.0", "6.0"}, DefaultPort: 27017,
			Client: "mongosh", Daemon: "mongod", Automated: true,
			Note: "The panel administers MongoDB through its own driver: a database's user is created inside the container, and its role is granted or withheld for the recycle bin.",
		},
		{
			Name: "redis", Label: "Redis", Kind: "cache",
			Versions: []string{"7.2", "7.0", "6.2"}, DefaultPort: 6379,
			Client: "redis-cli", Daemon: "redis-server", Automated: true,
			Note: "A cache gets its own ACL user, limited to its key prefix. Keys are never flushed for you.",
		},
	}
}

// Lookup finds an engine by name.
func Lookup(name string) (Engine, bool) {
	name = strings.ToLower(strings.TrimSpace(name))
	for _, engine := range catalog() {
		if engine.Name == name {
			return engine, true
		}
	}
	return Engine{}, false
}

// Detect reports every engine with what this host can really do, so the UI can
// disable what is not installed instead of failing later.
func Detect(ctx context.Context, runner host.Runner) []Engine {
	engines := catalog()
	real := runner != nil && runner.Mode() == "real"
	// A container per engine is the tidier model — one authentication path, no
	// packaging differences — but an unprivileged LXC simply cannot, so the host's
	// answer decides the mode instead of a preference.
	containers := DockerAvailable(ctx, runner)
	recipes := containerImages()

	for i := range engines {
		engine := &engines[i]
		if engine.FileBased {
			// SQLite needs nothing from the host: the SQLite library is compiled
			// into the sites that use it.
			engine.Available = true
			engine.Running = true
			engine.Mode = ModeHost
			continue
		}

		recipe, containerised := recipes[engine.Name]
		if path, found := clientPath(engine.Client); found {
			engine.Available = true
			engine.ClientPath = path
		}
		if !engine.Available {
			engine.Mode = ModeNone
			if containers && containerised {
				// Nothing is installed, but the panel can run it as a container here.
				engine.Mode = ModeDocker
				engine.Note = fmt.Sprintf("Nothing is installed, but this host runs containers: the panel can start %s as a container (%s, bound to 127.0.0.1).",
					engine.Label, recipe.Image)
				continue
			}
			engine.Note = fmt.Sprintf("%s is not installed on this host, and this host cannot run containers (Docker is unavailable), so the panel cannot offer it yet.",
				engine.Client)
			continue
		}
		if !real {
			engine.Mode = ModeHost
			engine.Note = runnerNote(*engine)
			continue
		}
		engine.Mode = ModeHost
		engine.Running, engine.Note = probeServer(ctx, runner, *engine)
		if containers && containerised && !engine.Running {
			engine.Note = fmt.Sprintf("%s is installed but its server did not answer; this host can also run it as a container (%s).",
				engine.Client, recipe.Image)
		}
	}
	return engines
}

// clientCandidates are the places a distribution may hide a client binary. The
// daemon runs with a plain PATH (usually /usr/local/bin:/usr/bin), while Debian
// keeps PostgreSQL in /usr/lib/postgresql/<n>/bin and RHEL in /usr/pgsql-<n>/bin,
// and package managers use /snap, /opt or a brew prefix — so PATH alone reports
// "not installed" on a host that has the engine.
func clientCandidates(client string) []string {
	if client == "" {
		return nil
	}
	return []string{
		"/usr/lib/postgresql/*/bin/" + client,
		"/usr/pgsql-*/bin/" + client,
		"/usr/local/pgsql/bin/" + client,
		"/opt/homebrew/bin/" + client,
		"/home/linuxbrew/.linuxbrew/bin/" + client,
		"/snap/bin/" + client,
		"/opt/" + client + "/bin/" + client,
	}
}

// hasClient reports whether a client is runnable, and where it is.
func hasClient(engine Engine) bool {
	_, ok := clientPath(engine.Client)
	return ok
}

// clientPath finds the client: PATH first, then the distribution-specific places,
// so the answer reflects the host instead of the daemon's PATH.
func clientPath(client string) (string, bool) {
	if client == "" {
		return "", false
	}
	if found, err := exec.LookPath(client); err == nil {
		return found, true
	}
	for _, pattern := range clientCandidates(client) {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		for _, match := range matches {
			if info, err := os.Stat(match); err == nil && !info.IsDir() {
				return match, true
			}
		}
	}
	return "", false
}

func runnerNote(engine Engine) string {
	return fmt.Sprintf("The daemon is in dry-run mode, so %s was not probed.", engine.Daemon)
}

// probeServer asks the engine whether it answers, with a short timeout so a
// missing server cannot stall a request.
func probeServer(ctx context.Context, runner host.Runner, engine Engine) (bool, string) {
	argv := probeCommand(engine)
	if len(argv) == 0 {
		return false, ""
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	out, err := runner.Run(probeCtx, "", argv[0], argv[1:]...)
	if err != nil {
		if probeCtx.Err() != nil {
			return false, fmt.Sprintf("%s did not answer within 3 seconds.", engine.Daemon)
		}
		return false, fmt.Sprintf("%s is installed but its server did not answer.", engine.Client)
	}
	if strings.Contains(strings.ToLower(out), "refused") {
		return false, fmt.Sprintf("%s is installed but its server refused a connection.", engine.Client)
	}
	return true, ""
}

func probeCommand(engine Engine) []string {
	switch engine.Name {
	case "postgresql":
		if _, err := exec.LookPath("pg_isready"); err == nil {
			return []string{"pg_isready", "-q", "-h", "127.0.0.1"}
		}
		return []string{"psql", "-h", "127.0.0.1", "-c", "SELECT 1"}
	case "mysql", "mariadb":
		// Over the unix socket, as root: a fresh MariaDB/MySQL uses unix_socket
		// authentication, so probing over TCP without a password would report
		// "not running" for a server that is plainly up (it did).
		return []string{engine.Client, "-e", "SELECT 1"}
	case "mongodb":
		return []string{"mongosh", "--quiet", "--eval", "db.runCommand({ping:1})"}
	case "redis":
		return []string{"redis-cli", "-h", "127.0.0.1", "ping"}
	}
	return nil
}
