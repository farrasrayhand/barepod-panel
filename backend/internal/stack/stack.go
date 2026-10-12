// Package stack owns the host-level platform choices: which web server is the
// ingress, and which PHP / Node / database versions are installed. Installs run
// through an allowlist — the daemon never accepts a free-form command from a client.
package stack

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// JobSlug is the synthetic owner of an install job (a job needs no website).
const JobSlug = "stack"

// Component is one installable thing.
type Component struct {
	Name        string   `json:"name"`
	Label       string   `json:"label"`
	Kind        string   `json:"kind"` // web | runtime | database
	Versions    []string `json:"versions"`
	Description string   `json:"description"`
}

// Catalog is the allowlist: only these can be installed, and only with the commands
// Commands returns.
func Catalog() []Component {
	return []Component{
		{Name: "nginx", Label: "Nginx", Kind: "web", Description: "High-concurrency web server and reverse proxy"},
		{Name: "caddy", Label: "Caddy", Kind: "web", Description: "Automatic HTTPS and HTTP/3 in one binary"},
		{Name: "php", Label: "PHP-FPM", Kind: "runtime", Versions: []string{"8.3", "8.2", "8.1"}, Description: "PHP runtime (one pool per site)"},
		{Name: "node", Label: "Node.js", Kind: "runtime", Versions: []string{"22", "20", "18"}, Description: "Node.js runtime for JavaScript sites"},
		{Name: "python", Label: "Python", Kind: "runtime", Versions: []string{"3.12", "3.11", "3.10"}, Description: "Python runtime (Flask, FastAPI, Django)"},
		{Name: "ruby", Label: "Ruby", Kind: "runtime", Description: "Ruby runtime (Rails, Sinatra)"},
		{Name: "go", Label: "Go", Kind: "runtime", Description: "Go toolchain"},
		{Name: "rust", Label: "Rust", Kind: "runtime", Description: "Rust toolchain (cargo)"},
		{Name: "postgresql", Label: "PostgreSQL", Kind: "database", Versions: []string{"16", "15"}, Description: "Relational database"},
		{Name: "mariadb", Label: "MariaDB", Kind: "database", Description: "MySQL-compatible relational database"},
		{Name: "mongodb", Label: "MongoDB", Kind: "database", Description: "Document database"},
		{Name: "redis", Label: "Redis", Kind: "database", Description: "In-memory cache and store"},
	}
}

// Lookup finds a component by name.
func Lookup(name string) (Component, bool) {
	for _, c := range Catalog() {
		if strings.EqualFold(c.Name, strings.TrimSpace(name)) {
			return c, true
		}
	}
	return Component{}, false
}

// Commands is the allowlisted command list for a component (and version, where the
// distro provides one). An unknown component or version is refused.
func Commands(component, version string) ([][]string, error) {
	c, ok := Lookup(component)
	if !ok {
		return nil, fmt.Errorf("stack: %q is not a component this panel installs", component)
	}
	version = strings.TrimSpace(version)
	if len(c.Versions) > 0 && version == "" {
		return nil, fmt.Errorf("stack: %s needs a version (%s)", c.Name, strings.Join(c.Versions, ", "))
	}
	if version != "" && len(c.Versions) > 0 && !containsString(c.Versions, version) {
		return nil, fmt.Errorf("stack: %s %s is not offered (choose %s)", c.Name, version, strings.Join(c.Versions, ", "))
	}

	apt := func(pkgs ...string) [][]string {
		return [][]string{append([]string{"apt-get", "install", "-y"}, pkgs...)}
	}
	switch c.Name {
	case "nginx":
		return apt("nginx"), nil
	case "caddy":
		// Debian/Ubuntu ship caddy in universe.
		return apt("caddy"), nil
	case "php":
		pkgs := []string{
			"php" + version + "-fpm", "php" + version + "-cli", "php" + version + "-mysql",
			"php" + version + "-pgsql", "php" + version + "-curl", "php" + version + "-mbstring",
			"php" + version + "-xml", "php" + version + "-zip",
		}
		return apt(pkgs...), nil
	case "node":
		// NodeSource is the least surprising way to get a chosen major on Debian/Ubuntu.
		return [][]string{
			{"bash", "-c", "curl -fsSL https://deb.nodesource.com/setup_" + version + ".x | bash -"},
			{"apt-get", "install", "-y", "nodejs"},
		}, nil
	case "python":
		return apt("python"+version, "python"+version+"-venv", "python3-pip"), nil
	case "ruby":
		return apt("ruby", "ruby-dev", "build-essential"), nil
	case "go":
		return apt("golang-go"), nil
	case "rust":
		return apt("rustc", "cargo"), nil
	case "postgresql":
		return apt("postgresql-" + version), nil
	case "mariadb":
		return apt("mariadb-server"), nil
	case "redis":
		return apt("redis-server"), nil
	case "mongodb":
		return [][]string{
			{"bash", "-c", "apt-get install -y gnupg curl && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor"},
			{"bash", "-c", `echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list`},
			{"apt-get", "update"},
			{"apt-get", "install", "-y", "mongodb-org"},
		}, nil
	}
	return nil, fmt.Errorf("stack: %s has no install recipe", c.Name)
}

func containsString(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

// Installer runs an install as a job with a live log, reusing the deploy job store.
type Installer struct {
	store *store.Store
	host  *host.Host
}

func New(st *store.Store, h *host.Host) *Installer { return &Installer{store: st, host: h} }

// Start records the job and runs it in the background.
func (i *Installer) Start(component, version string) (*store.DeployJob, error) {
	commands, err := Commands(component, version)
	if err != nil {
		return nil, err
	}
	job := &store.DeployJob{
		ID:         id.New(),
		Slug:       JobSlug,
		Mode:       i.host.Mode(),
		Status:     "pending",
		TotalSteps: len(commands),
		CreatedAt:  now(),
	}
	if err := i.store.CreateDeployJob(job); err != nil {
		return nil, err
	}
	snapshot := *job
	go i.run(job, component, version, commands)
	return &snapshot, nil
}

func (i *Installer) run(job *store.DeployJob, component, version string, commands [][]string) {
	defer func() { _, _ = i.store.PruneDeployJobs(JobSlug, 5) }()

	job.Status = "running"
	_ = i.store.UpdateDeployJob(job)
	log := func(stream, line string) { _, _ = i.store.AppendDeployLog(job.ID, stream, line) }

	label := component
	if version != "" {
		label += " " + version
	}
	log("stdout", fmt.Sprintf("installing %s (mode=%s)", label, job.Mode))
	if !i.host.Materialises() {
		log("stdout", "[dry-run] nothing is installed on this host — the commands below are recorded only")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()

	for n, argv := range commands {
		job.Step = n + 1
		job.CurrentStep = strings.Join(argv, " ")
		_ = i.store.UpdateDeployJob(job)
		log("step", fmt.Sprintf("-> [%d/%d] %s", n+1, len(commands), job.CurrentStep))
		out, err := i.host.Run(ctx, argv)
		for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
			if strings.TrimSpace(line) != "" {
				log("stdout", line)
			}
		}
		if err != nil {
			job.Status = "failed"
			job.Error = fmt.Sprintf("%s failed: %v", argv[0], err)
			job.FinishedAt = now()
			_ = i.store.UpdateDeployJob(job)
			log("stderr", "FAILED: "+job.Error)
			log("status", "failed")
			return
		}
	}
	job.Status = "success"
	job.FinishedAt = now()
	_ = i.store.UpdateDeployJob(job)
	log("stdout", "installed: "+label)
	log("status", "success")
	i.recordChoice(component, version)
}

// recordChoice remembers what an install decided, so the rest of the panel uses the
// version that was actually installed: a runtime's default, or an engine's version.
func (i *Installer) recordChoice(component, version string) {
	if strings.TrimSpace(version) == "" {
		return // nothing was chosen (the distro decided); detection reports the truth
	}
	switch {
	case component == "php":
		_ = i.store.SavePanelSetting("default_php_version", version)
	case component == "node":
		_ = i.store.SavePanelSetting("default_node_version", version)
	default:
		if c, ok := Lookup(component); ok && c.Kind == "database" {
			_ = i.store.SavePanelSetting("db_version_"+c.Name, version)
		}
	}
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// --- detection ---

// WebServerStatus is one engine's real state.
type WebServerStatus struct {
	Engine    string `json:"engine"`
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Running   bool   `json:"running"`
}

// Status is the whole picture the Stack screen shows.
type Status struct {
	WebServer struct {
		Active     string            `json:"active"`
		Supported  []string          `json:"supported"`
		Installed  []WebServerStatus `json:"installed"`
		WebUser    string            `json:"webUser"`
		VhostsPath string            `json:"vhostsPath"`
	} `json:"webServer"`
	Components []Component       `json:"components"`
	Databases  []dbengine.Engine `json:"databases"`
	// DatabaseVersions is the version chosen for each engine (what an install recorded),
	// so the screen can show both that and the version really installed.
	DatabaseVersions map[string]string `json:"databaseVersions"`
	// Runtimes is each language's detected versions, keyed by component name (php and
	// node appear here too; their *chosen* version is in php/node).
	Runtimes map[string][]string `json:"runtimes"`
	PHP      struct {
		Installed []string `json:"installed"`
		Default   string   `json:"default"`
	} `json:"php"`
	Node struct {
		Installed []string `json:"installed"`
		Default   string   `json:"default"`
	} `json:"node"`
	Mode string `json:"mode"`
}

// Detect reports the host's real state — never a stored wish.
func Detect(ctx context.Context, st *store.Store, h *host.Host, lookPath func(string) (string, error)) Status {
	var out Status
	out.Mode = h.Mode()
	out.Components = Catalog()

	active := webserver.DefaultEngine
	if v, err := st.PanelSetting("active_web_server"); err == nil && webserver.Supported(v) {
		active = strings.ToLower(strings.TrimSpace(v))
	}
	out.WebServer.Active = active
	out.WebServer.Supported = []string{webserver.Nginx, webserver.Caddy}
	out.WebServer.WebUser = webserver.WebUser(active)
	out.WebServer.VhostsPath = h.VhostsFor(active)
	for _, engine := range out.WebServer.Supported {
		status := WebServerStatus{Engine: engine, Installed: webserver.Available(engine, lookPath)}
		if status.Installed {
			status.Running = serviceActive(ctx, h, engine)
			status.Version = engineVersion(ctx, h, engine)
		}
		out.WebServer.Installed = append(out.WebServer.Installed, status)
	}

	out.Databases = dbengine.Detect(ctx, h.Runner)
	out.DatabaseVersions = map[string]string{}
	for _, engine := range out.Databases {
		if v := setting(st, "db_version_"+engine.Name); v != "" {
			out.DatabaseVersions[engine.Name] = v
		}
	}
	out.PHP.Installed = phpVersions()
	out.PHP.Default = setting(st, "default_php_version")
	out.Node.Installed = nodeVersions(ctx, h, lookPath)
	out.Node.Default = setting(st, "default_node_version")
	out.Runtimes = map[string][]string{
		"php":    out.PHP.Installed,
		"node":   out.Node.Installed,
		"python": probeVersions(ctx, h, lookPath, "python3", []string{"python3", "--version"}),
		"ruby":   probeVersions(ctx, h, lookPath, "ruby", []string{"ruby", "--version"}),
		"go":     probeVersions(ctx, h, lookPath, "go", []string{"go", "version"}),
		"rust":   probeVersions(ctx, h, lookPath, "rustc", []string{"rustc", "--version"}),
	}
	return out
}

// runtimesVersionPattern picks the leading major.minor out of a version banner.
var runtimesVersionPattern = regexp.MustCompile(`(\d+)\.(\d+)`)

// probeVersions reports a tool's version when it is installed, or nil when it is not
// — the absence is the answer, not a guess.
func probeVersions(ctx context.Context, h *host.Host, lookPath func(string) (string, error), binary string, argv []string) []string {
	if lookPath != nil {
		if _, err := lookPath(binary); err != nil {
			return nil
		}
	}
	out, err := h.Run(ctx, argv)
	if err != nil {
		return nil
	}
	if m := runtimesVersionPattern.FindStringSubmatch(out); m != nil {
		return []string{m[1] + "." + m[2]}
	}
	return []string{strings.TrimSpace(out)}
}

func setting(st *store.Store, key string) string {
	v, _ := st.PanelSetting(key)
	return strings.TrimSpace(v)
}

func serviceActive(ctx context.Context, h *host.Host, engine string) bool {
	out, err := h.Run(ctx, []string{"systemctl", "is-active", engine})
	return err == nil && strings.TrimSpace(out) == "active"
}

func engineVersion(ctx context.Context, h *host.Host, engine string) string {
	argv := []string{"nginx", "-v"}
	if engine == webserver.Caddy {
		argv = []string{"caddy", "version"}
	}
	out, err := h.Run(ctx, argv)
	if err != nil {
		return ""
	}
	line := strings.TrimSpace(strings.Split(strings.TrimSpace(out), "\n")[0])
	return strings.TrimPrefix(line, "nginx version: ")
}

// phpVersions lists the PHP-FPM versions installed on the host (its own filesystem).
func phpVersions() []string {
	found := map[string]bool{}
	for _, pattern := range []string{"/usr/sbin/php-fpm*", "/usr/bin/php-fpm*"} {
		matches, _ := filepath.Glob(pattern)
		for _, m := range matches {
			name := strings.TrimPrefix(filepath.Base(m), "php-fpm")
			if name != "" {
				found[name] = true
			}
		}
	}
	// /etc/php/<version> is the config directory a distro package creates.
	if dirs, err := os.ReadDir("/etc/php"); err == nil {
		for _, d := range dirs {
			if d.IsDir() {
				found[d.Name()] = true
			}
		}
	}
	out := make([]string, 0, len(found))
	for v := range found {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

// nodeVersions reports the Node.js version on the host.
func nodeVersions(ctx context.Context, h *host.Host, lookPath func(string) (string, error)) []string {
	if lookPath == nil || func() bool { _, err := lookPath("node"); return err != nil }() {
		return nil
	}
	out, err := h.Run(ctx, []string{"node", "--version"})
	if err != nil {
		return nil
	}
	return []string{strings.TrimPrefix(strings.TrimSpace(out), "v")}
}
