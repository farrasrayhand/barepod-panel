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
	"regexp"
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
	// Installed is the version actually on this host, probed from the engine's own
	// binary — empty when nothing is installed or the probe cannot answer. It is the
	// truth the Stack screen shows, not the catalog's wish list.
	Installed string `json:"installedVersion,omitempty"`
}

// versionProbe is the command that reports an engine's installed version.
func versionProbe(engine Engine) []string {
	switch engine.Name {
	case "postgresql":
		return []string{"psql", "--version"}
	case "mysql":
		return []string{"mysql", "--version"}
	case "mariadb":
		return []string{"mariadb", "--version"}
	case "mongodb":
		return []string{"mongod", "--version"}
	case "redis":
		return []string{"redis-server", "--version"}
	}
	return nil
}

// versionPattern picks the leading major.minor out of a version banner
// ("psql (PostgreSQL) 16.4" → "16.4", "Redis server v=7.0.15" → "7.0").
var versionPattern = regexp.MustCompile(`(\d+)\.(\d+)`)

// distribPattern is preferred when present: MariaDB's client banner starts with the
// *protocol* version ("Ver 15.1 Distrib 10.11.6-MariaDB" or "mariadb from 11.4.13-MariaDB"),
// so matching the server version prefix is preferred.
var distribPattern = regexp.MustCompile(`(?:Distrib |from )(\d+)\.(\d+)`)

func probeVersion(ctx context.Context, runner host.Runner, engine Engine) string {
	if runner == nil || runner.Mode() != "real" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	if engine.Name == "postgresql" {
		// Prefer the actual running PostgreSQL server version over the psql client package
		if srvOut, err := runner.Run(cctx, "", "sudo", "-u", "postgres", "psql", "-t", "-A", "-c", "SHOW server_version"); err == nil && strings.TrimSpace(srvOut) != "" {
			if m := versionPattern.FindStringSubmatch(srvOut); m != nil {
				return m[1] + "." + m[2]
			}
		}
	}

	argv := versionProbe(engine)
	if argv == nil {
		return ""
	}
	out, err := runner.Run(cctx, "", argv[0], argv[1:]...)
	if err != nil {
		return ""
	}
	if m := distribPattern.FindStringSubmatch(out); m != nil {
		return m[1] + "." + m[2]
	}
	if m := versionPattern.FindStringSubmatch(out); m != nil {
		return m[1] + "." + m[2]
	}
	return ""
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
			Versions: []string{"18", "17", "16", "15", "14"}, DefaultPort: 5432,
			Client: "psql", Daemon: "postgresql", Automated: true,
		},
		{
			Name: "mysql", Label: "MySQL", Kind: "database",
			Versions: []string{"8.4", "8.0"}, DefaultPort: 3306,
			Client: "mysql", Daemon: "mysql", Automated: true,
		},
		{
			Name: "mariadb", Label: "MariaDB", Kind: "database",
			Versions: []string{"13.0", "12.3", "11.8", "11.4", "10.11"}, DefaultPort: 3306,
			Client: "mariadb", Daemon: "mariadb", Automated: true,
		},
		{
			Name: "mongodb", Label: "MongoDB", Kind: "database",
			Versions: []string{"9.0", "8.0", "7.0", "6.0"}, DefaultPort: 27017,
			Client: "mongosh", Daemon: "mongod", Automated: true,
			Note: "The panel administers MongoDB through its own driver: a database's user is created inside the container, and its role is granted or withheld for the recycle bin.",
		},
		{
			Name: "redis", Label: "Redis", Kind: "cache",
			Versions: []string{"8.10", "8.0", "7.4", "7.2", "7.0", "6.2"}, DefaultPort: 6379,
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

// detectMySQLFlavour says which server the MySQL-compatible client on this host belongs to.
//
// MariaDB ships `mysql` and `mysqld` as well, so the presence of those binaries says nothing
// about which server is here — on a MariaDB host the panel used to list MySQL as installed and
// running, reporting MariaDB's own version (10.11) under it. The version banner does tell them
// apart: MariaDB prints "...-MariaDB", Oracle's build does not. "" means the host has neither.
func detectMySQLFlavour(ctx context.Context, runner host.Runner) string {
	if runner == nil || runner.Mode() != "real" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := runner.Run(cctx, "", "mysql", "--version")
	if err != nil {
		return ""
	}
	if strings.Contains(out, "MariaDB") || strings.Contains(out, "mariadb") {
		return "mariadb"
	}
	if strings.Contains(out, "MySQL") || strings.Contains(out, "mysql") {
		return "mysql"
	}
	return ""
}

// Detect reports every engine with what this host can really do, so the UI can
// disable what is not installed instead of failing later.
func Detect(ctx context.Context, runner host.Runner) []Engine {
	engines := catalog()
	real := runner != nil && runner.Mode() == "real"
	mysqlFlavour := detectMySQLFlavour(ctx, runner)
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
				// Nothing is installed, but the panel can run it as a container here — so it
				// *is* available: availability means the panel can provide it, and the mode
				// says how. Reporting "not installed" kept the UI from offering an engine the
				// panel runs perfectly well (MongoDB was locked out while its container was
				// up, and creating one from the API worked all along).
				engine.Available = true
				engine.Mode = ModeDocker
				engine.Running = containerEngineRunning(ctx, runner, engine.Name)
				if engine.Running {
					engine.Installed = probeDockerRunningTag(ctx, runner, engine.Name)
				}
				engine.Note = fmt.Sprintf("Nothing is installed, but this host runs containers: the panel starts %s as a container (%s, bound to 127.0.0.1).",
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
		engine.Installed = probeVersion(ctx, runner, *engine)
		// The MySQL family is one server: whichever banner this host answers with is the one
		// that is actually installed.
		if (engine.Name == "mysql" || engine.Name == "mariadb") && mysqlFlavour != "" && mysqlFlavour != engine.Name {
			engine.Available = false
			engine.Running = false
			engine.Installed = ""
			engine.Mode = ModeNone
			engine.Note = fmt.Sprintf("%s is not installed on this host — the MySQL-compatible client here belongs to %s.",
				engine.Label, map[string]string{"mysql": "MySQL", "mariadb": "MariaDB"}[mysqlFlavour])
			continue
		}
		if containers && containerised && (!engine.Running || engine.Installed == "") {
			if containerEngineRunning(ctx, runner, engine.Name) {
				engine.Mode = ModeDocker
				engine.Running = true
				engine.Installed = probeDockerRunningTag(ctx, runner, engine.Name)
			} else {
				engine.Note = fmt.Sprintf("%s is installed but its server did not answer; this host can also run it as a container (%s).",
					engine.Client, recipe.Image)
			}
		}
	}
	return engines
}

// probeDockerRunningTag detects the tag of the running container image for an engine.
func probeDockerRunningTag(ctx context.Context, runner host.Runner, engine string) string {
	repo := map[string]string{
		"mongodb": "mongo", "mariadb": "mariadb", "mysql": "mysql",
		"postgresql": "postgres", "redis": "redis",
	}[engine]
	if repo == "" || runner == nil || runner.Mode() != "real" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	out, err := runner.Run(cctx, "", "bash", "-c",
		"docker ps --format '{{.Image}}' 2>/dev/null | grep -E '^"+repo+"(:|$)' | head -1")
	if err != nil {
		return ""
	}
	image := strings.TrimSpace(out)
	if _, tag, found := strings.Cut(image, ":"); found && tag != "latest" {
		return tag
	}
	return ""
}

// containerEngineRunning reports whether the container the panel runs an engine in is
// already up, so the panel can say "running" rather than guess. A failure answers
// false: not knowing is not the same as knowing it runs.
func containerEngineRunning(ctx context.Context, runner host.Runner, engine string) bool {
	if runner == nil {
		return false
	}
	spec, _, err := ContainerFor(engine, "u", "p", os.TempDir())
	if err != nil {
		return false
	}
	probe, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	out, err := runner.Run(probe, "", "docker", "ps", "--filter", "name="+spec.Name, "--filter", "status=running", "-q")
	return err == nil && strings.TrimSpace(out) != ""
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
		if strings.Contains(out, "NOAUTH") {
			return true, ""
		}
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
