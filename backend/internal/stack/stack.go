// Package stack owns the host-level platform choices: which web server is the
// ingress, and which PHP / Node / database versions are installed. Installs run
// through an allowlist — the daemon never accepts a free-form command from a client.
package stack

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/phpext"
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
		{Name: "repositories", Label: "Package repositories", Kind: "repo", Description: "Sury for PHP and deadsnakes for Python — the versions Ubuntu does not ship"},
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

// dpkgRepairScript clears a half-finished dpkg transaction, and is a no-op when there is
// nothing to clear. It matters because a restart of the daemon — a deploy, say — kills
// whatever apt was running under it, and every later apt step then fails with "dpkg was
// interrupted, you must manually run 'dpkg --configure -a'" until something runs it.
const dpkgRepairScript = `dpkg --configure -a >/dev/null 2>&1 || true`

func dpkgRepair() []string { return []string{"bash", "-c", dpkgRepairScript} }

// aptWait makes an apt step wait for the dpkg lock instead of failing on it. The panel's
// own installs are serialised, but the lock can be held by something this process cannot
// see — a shell, an unattended upgrade — and failing there leaves a half-finished install
// for no reason.
var aptWait = []string{"-o", "DPkg::Lock::Timeout=600"}

// aptGet builds an apt-get argv with that wait in place.
func aptGet(args ...string) []string {
	return append(append([]string{"apt-get"}, aptWait...), args...)
}

// Commands is the allowlisted command list for a component (and version, where the
// distro provides one). An unknown component or version shape is refused. Whether a
// particular version is *offered here* is a question for the host's repositories, so it
// is answered in Installer.Start, where the host is known.
func Commands(component, version string) ([][]string, error) {
	c, ok := Lookup(component)
	if !ok {
		return nil, fmt.Errorf("stack: %q is not a component this panel installs", component)
	}
	version = strings.TrimSpace(version)
	if len(c.Versions) > 0 && version == "" {
		return nil, fmt.Errorf("stack: %s needs a version (see its repository's list)", c.Name)
	}
	// The version reaches a shell, so only the shapes the panel installs are allowed:
	// 8.3, 1.22, 3.12.1, or rustup's channels.
	if version != "" && !versionShape.MatchString(version) {
		return nil, fmt.Errorf("stack: %q is not a version this panel installs", version)
	}

	apt := func(pkgs ...string) [][]string {
		return [][]string{aptGet(append([]string{"install", "-y"}, pkgs...)...)}
	}
	switch c.Name {
	case "nginx":
		return apt("nginx"), nil
	case "caddy":
		// Debian/Ubuntu ship caddy in universe.
		return apt("caddy"), nil
	case "repositories":
		// Every source that can hold several versions at once, added in one step: the two
		// apt repositories plus the version managers for Ruby and Rust. Node's and Go's
		// versions come from their vendor tarballs, so they need nothing added.
		return [][]string{
			{"bash", "-c", suryRepoScript},
			{"bash", "-c", deadsnakesRepoScript},
			{"bash", "-c", rbenvRepoScript},
			{"bash", "-c", rustupRepoScript},
		}, nil
	case "php":
		// A PHP install is a full one: the extensions the panel's Settings screen toggles
		// (phpenmod/phpdismod) are installed here, so enabling one later is a switch rather
		// than another install.
		//
		// Only FPM and CLI are requirements. The extensions are installed one by one and a
		// missing one is named in the log: repositories do not carry the same set for every
		// version (Sury has no php8.0-sodium, for one), and an apt install is atomic, so
		// asking for them together failed the whole install over a single absent package.
		extensions := []string{
			"curl", "mbstring", "xml", "zip", "gd", "intl", "bcmath", "mysql", "pgsql",
			"sqlite3", "opcache", "soap", "sodium", "exif", "bz2", "gmp",
			"imagick", "redis", "mongodb", "ldap", "imap", "swoole", "pcntl",
		}
		script := "set -e\napt-get -o DPkg::Lock::Timeout=600 install -y php" + version + "-fpm php" + version + "-cli" +
			"\nfor e in " + strings.Join(extensions, " ") + "; do apt-get -o DPkg::Lock::Timeout=600 install -y php" + version + "-$e || echo \"skipped php" + version + "-$e (not offered by this repository)\"; done"
		// Ubuntu ships a single PHP, so the versions the panel offers come from the Sury
		// repository; it is added first and the available versions are read back from apt.
		return [][]string{{"bash", "-c", suryRepoScript}, {"bash", "-c", script}}, nil
	case "node":
		// NodeSource replaces the system node, so it cannot hold two majors at once; the
		// official tarball is unpacked under the panel's own directory instead, which is
		// what lets 20 and 22 coexist for different sites.
		return [][]string{
			{"bash", "-c", "set -e; mkdir -p /opt/barepod/node; V=$(curl -fsSL https://nodejs.org/dist/index.json | tr ',' '\\n' | grep -m1 -o '\"version\":\"v" + version + "\\.[0-9.]*\"' | cut -d'\"' -f4); test -n \"$V\"; curl -fsSL https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz | tar -xJ -C /opt/barepod/node; rm -rf /opt/barepod/node/" + version + "; mv /opt/barepod/node/node-$V-linux-x64 /opt/barepod/node/" + version},
		}, nil
	case "python":
		// Debian/Ubuntu ship one python3; the other versions come from deadsnakes.
		return append([][]string{{"bash", "-c", deadsnakesRepoScript}},
			apt("python"+version, "python"+version+"-venv")...), nil
	case "ruby":
		if version == "" {
			return nil, fmt.Errorf("stack: ruby needs a version (see the list from ruby-build)")
		}
		return [][]string{{"bash", "-c", rbenvRepoScript}, {"bash", "-c", "set -e; rbenv install -s " + version}}, nil
	case "go":
		// Each toolchain is a tarball beside the others, so two Go versions can coexist.
		if version == "" {
			return nil, fmt.Errorf("stack: go needs a version (1.22, 1.23, …)")
		}
		script := "set -e\nV=$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | tr ',' '\\n' | grep -m1 -o '\"version\":\"go" + version + "\\.[0-9.]*\"' | cut -d'\"' -f4)\ntest -n \"$V\"\ncurl -fsSL https://go.dev/dl/$V.linux-amd64.tar.gz | tar -xz -C /usr/local\nrm -rf /usr/local/go" + version + "\nmv /usr/local/go /usr/local/go" + version
		return [][]string{{"bash", "-c", script}}, nil
	case "rust":
		if version == "" {
			version = "stable"
		}
		return [][]string{{"bash", "-c", rustupRepoScript}, {"bash", "-c", "set -e; rustup toolchain install " + version}}, nil
	case "postgresql":
		return apt("postgresql-" + version), nil
	case "mariadb":
		return apt("mariadb-server"), nil
	case "redis":
		return apt("redis-server"), nil
	case "mongodb":
		return [][]string{
			{"bash", "-c", "apt-get -o DPkg::Lock::Timeout=600 install -y gnupg curl && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor"},
			{"bash", "-c", `echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-7.0.list`},
			aptGet("update"),
			aptGet("install", "-y", "mongodb-org"),
		}, nil
	}
	return nil, fmt.Errorf("stack: %s has no install recipe", c.Name)
}

// suryRepoScript adds packages.sury.org/php, which is where the PHP versions Ubuntu
// does not ship come from. The key is installed with a signed-by entry so apt does
// not accept anything else from that host.
const suryRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq lsb-release ca-certificates curl gnupg >/dev/null
curl -fsSL https://packages.sury.org/php/apt.gpg -o /usr/share/keyrings/sury-php.gpg
echo "deb [signed-by=/usr/share/keyrings/sury-php.gpg] https://packages.sury.org/php/ $(lsb_release -sc) main" > /etc/apt/sources.list.d/sury-php.list
apt-get -o DPkg::Lock::Timeout=600 update`

// deadsnakesRepoScript adds the deadsnakes PPA, where the Python versions Ubuntu does
// not ship come from.
const deadsnakesRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq software-properties-common >/dev/null
add-apt-repository -y ppa:deadsnakes/ppa
apt-get -o DPkg::Lock::Timeout=600 update`

// rbenvRepoScript installs rbenv and ruby-build into the panel's own directory, so Ruby
// versions can be installed side by side (the distro ships exactly one).
const rbenvRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq git curl build-essential libssl-dev zlib1g-dev libreadline-dev libyaml-dev libffi-dev libgdbm-dev libncurses-dev >/dev/null
[ -d /opt/barepod/rbenv ] || git clone --depth 1 https://github.com/rbenv/rbenv.git /opt/barepod/rbenv
[ -d /opt/barepod/ruby-build ] || git clone --depth 1 https://github.com/rbenv/ruby-build.git /opt/barepod/ruby-build
ln -sf /opt/barepod/rbenv/bin/rbenv /usr/local/bin/rbenv
ln -sf /opt/barepod/ruby-build/bin/ruby-build /usr/local/bin/ruby-build`

// rustupRepoScript installs rustup, which is itself the multi-toolchain manager. It uses
// rustup's own defaults (~/.cargo, ~/.rustup) so that `rustup`, `rustc` and `cargo` work
// in any root shell with no variables set — but HOME is pinned first, because the runner
// can hand this a clean environment, and "$HOME/.cargo" then expanded to "/.cargo" and
// left a symlink pointing at nothing.
const rustupRepoScript = `set -e
export HOME="${HOME:-/root}"
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl >/dev/null
export CARGO_HOME="$HOME/.cargo" RUSTUP_HOME="$HOME/.rustup"
if [ ! -x "$CARGO_HOME/bin/rustup" ]; then
  curl -fsSL https://sh.rustup.rs -o /tmp/rustup-init.sh
  sh /tmp/rustup-init.sh -y --no-modify-path --profile minimal
fi
for b in rustup rustc cargo; do ln -sf "$CARGO_HOME/bin/$b" /usr/local/bin/$b; done`

func containsString(list []string, v string) bool {
	for _, item := range list {
		if item == v {
			return true
		}
	}
	return false
}

// Installer runs an install as a job with a live log, reusing the deploy job store. One
// install runs at a time: every apt step takes the same dpkg lock, so a second one would
// only wait behind the first (or fail on it, which is what "Could not get lock
// /var/lib/dpkg/lock-frontend" was).
type Installer struct {
	store *store.Store
	host  *host.Host

	mu      sync.Mutex
	running string // the install in progress, empty when none is
}

func New(st *store.Store, h *host.Host) *Installer { return &Installer{store: st, host: h} }

// claim marks an install as running, or reports which one is in the way.
func (i *Installer) claim(label string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.running != "" {
		return fmt.Errorf("stack: %s is installing right now — wait for it to finish (two installs would share one package lock)", i.running)
	}
	i.running = label
	return nil
}

func (i *Installer) release() {
	i.mu.Lock()
	i.running = ""
	i.mu.Unlock()
}

// Start records the job and runs it in the background.
func (i *Installer) Start(component, version string) (*store.DeployJob, error) {
	if version != "" {
		// The screen draws a button per version the host offers, so a version it did not
		// draw must not be installable — and one it did draw must be (that mismatch is
		// exactly what "php 8.0 is not offered (choose 8.3, 8.2, 8.1)" was: the check used
		// a hand-kept catalog list while the screen showed the repository's).
		if offered := i.offered(context.Background(), component); len(offered) > 0 && !containsString(offered, version) {
			return nil, fmt.Errorf("stack: %s %s is not offered here (available: %s)", component, version, strings.Join(offered, ", "))
		}
	}
	commands, err := Commands(component, version)
	if err != nil {
		return nil, err
	}
	// Every install starts by clearing a half-finished dpkg transaction, so a restart of
	// the daemon during an earlier install does not poison this one.
	commands = append([][]string{dpkgRepair()}, commands...)
	label := component
	if version != "" {
		label += " " + version
	}
	// Claimed after the request is known to be valid, so a bad one cannot block the queue.
	if err := i.claim(label); err != nil {
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

// offered is what this host's repositories can install right now — the same list the
// screen shows, so a drawn button is a working button. The catalog's list is the
// fallback when a source answers nothing (a dry-run host, or repositories not added yet).
func (i *Installer) offered(ctx context.Context, component string) []string {
	c, ok := Lookup(component)
	if !ok {
		return nil
	}
	for _, r := range runtimeSources() {
		if r.name != component {
			continue
		}
		if versions := availableVersions(ctx, i.host, r); len(versions) > 0 {
			return versions
		}
		break
	}
	return c.Versions
}

func (i *Installer) run(job *store.DeployJob, component, version string, commands [][]string) {
	defer i.release()
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
	// Runtimes is each language's versions: what is installed (probed) and what this
	// host's repositories offer (read from apt, not a hardcoded list), plus whether the
	// version matters per site (interpreted) or is a build-time toolchain (compiled).
	Runtimes map[string]RuntimeStatus `json:"runtimes"`
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
	out.Runtimes = map[string]RuntimeStatus{}
	for _, r := range runtimeSources() {
		status := RuntimeStatus{PerSite: r.perSite, Source: r.source}
		switch {
		case r.name == "php":
			status.Installed = out.PHP.Installed
		case r.name == "node":
			status.Installed = nodeInstalled(ctx, h, lookPath)
		case r.name == "go":
			// Several Go toolchains coexist as /usr/local/go<version>, so the answer is a
			// list and not one probe.
			status.Installed = goInstalled(ctx, h)
		case r.name == "rust":
			status.Installed = rustInstalled(ctx, h)
		case len(r.binary) > 0:
			status.Installed = probeVersions(ctx, h, lookPath, r.probe, r.binary)
		}
		status.Available = availableVersions(ctx, h, r)
		out.Runtimes[r.name] = status
	}
	return out
}

// nodeInstalled lists the Node runtimes the panel unpacked (one directory per major)
// plus the one on PATH, so a site's version list is the truth.
func nodeInstalled(ctx context.Context, h *host.Host, lookPath func(string) (string, error)) []string {
	out := nodeVersions(ctx, h, lookPath)
	if entries, err := os.ReadDir("/opt/barepod/node"); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				out = append(out, e.Name())
			}
		}
	}
	sort.Strings(out)
	return out
}

// RuntimeStatus is one language's versions on this host.
type RuntimeStatus struct {
	Installed []string `json:"installed"`
	// Available is what this host's repositories actually offer (empty when the versions
	// come from a tarball or a toolchain manager instead).
	Available []string `json:"available"`
	// PerSite says the version matters for each site (interpreted at runtime) rather than
	// being a build-time toolchain, where one version is enough.
	PerSite bool   `json:"perSite"`
	Source  string `json:"source,omitempty"`
}

// runtimeSources describes where each language's versions come from, so the screen can
// say it and the available list can be read back from the repository rather than guessed.
type runtimeSource struct {
	name      string
	perSite   bool
	source    string
	kind      string // apt-suffixed (php8.3-fpm) | apt-single (ruby) | vendor-index | rbenv | rustup
	pkgPrefix string // apt-suffixed: package = pkgPrefix + version + pkgSuffix
	pkgSuffix string
	pkg       string // apt-single: one package, its candidate version is the version
	binary    []string
	probe     string // binary to look up before asking its version
}

func runtimeSources() []runtimeSource {
	return []runtimeSource{
		{name: "php", perSite: true, source: "apt — packages.sury.org/php", kind: "apt-suffixed",
			pkgPrefix: "php", pkgSuffix: "-fpm"},
		{name: "python", perSite: true, source: "apt — deadsnakes PPA", kind: "apt-suffixed",
			pkgPrefix: "python",
			probe:     "python3", binary: []string{"python3", "--version"}},
		{name: "node", perSite: true, source: "tarball — nodejs.org/dist (per site)", kind: "vendor-index",
			probe: "node", binary: []string{"node", "--version"}},
		{name: "ruby", perSite: true, source: "rbenv + ruby-build", kind: "rbenv",
			probe: "ruby", binary: []string{"ruby", "--version"}},
		{name: "go", perSite: false, source: "tarball — go.dev/dl (per toolchain)", kind: "vendor-index",
			probe: "go", binary: []string{"go", "version"}},
		{name: "rust", perSite: false, source: "rustup toolchains", kind: "rustup",
			probe: "rustc", binary: []string{"rustc", "--version"}},
	}
}

// availableVersions reads the repository's own answer: a candidate only counts when apt
// can actually install that package here. Dry-run and a non-real host report none — an
// unmeasured "available" would be a lie of the kind this panel avoids.
func availableVersions(ctx context.Context, h *host.Host, r runtimeSource) []string {
	if !h.Materialises() {
		return nil
	}
	switch r.kind {
	case "apt-suffixed":
		// The repository's own package list is the version list. Nothing here is kept in
		// code, so a version Sury or deadsnakes adds later appears without a release of the
		// panel — and a version it drops disappears.
		pattern := "^" + r.pkgPrefix + "[0-9]+\\.[0-9]+" + r.pkgSuffix + "$"
		res, err := h.Run(ctx, []string{"apt-cache", "search", "--names-only", pattern})
		if err != nil {
			return nil
		}
		set := map[string]bool{}
		for _, line := range strings.Split(res, "\n") {
			name := strings.TrimSpace(strings.SplitN(line, " ", 2)[0])
			if !strings.HasPrefix(name, r.pkgPrefix) {
				continue
			}
			version := strings.TrimSuffix(strings.TrimPrefix(name, r.pkgPrefix), r.pkgSuffix)
			if runtimesVersionPattern.MatchString(version) {
				set[version] = true
			}
		}
		return sortedDescending(set)
	case "vendor-index":
		// No repository owns these versions; the vendor's own index does.
		return vendorVersions(ctx, h, r.name)
	case "rbenv":
		// ruby-build ships the definitions rbenv installs from — the real list, not a
		// hand-kept one.
		if !h.Materialises() {
			return nil
		}
		out, err := h.Run(ctx, []string{"ruby-build", "--definitions"})
		if err != nil {
			return nil
		}
		// ruby-build lists oldest-first; the newest are the ones worth showing.
		set := map[string]bool{}
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if m := regexp.MustCompile(`^\d+\.\d+\.\d+$`).FindString(line); m != "" {
				set[m] = true
			}
		}
		return sortedDescending(set)
	case "rustup":
		// rustup publishes three channels, and any released version besides them can be
		// installed by name — the list below is what its toolchain index answers with.
		versions := vendorVersions(ctx, h, "rust")
		return append([]string{"stable", "beta", "nightly"}, versions...)
	}
	return nil
}

// vendorCache remembers a vendor index for a while: it is a network fetch, and the list
// changes at the pace of upstream releases, not of page loads.
var vendorCache struct {
	sync.Mutex
	at     time.Time
	byName map[string][]string
}

const vendorCacheTTL = 10 * time.Minute

// vendorVersions lists the versions a vendor publishes (Node's and Go's own indexes), so
// the screen offers the real list instead of a hand-kept one. A failed fetch answers nil
// and never an invented list.
func vendorVersions(ctx context.Context, h *host.Host, name string) []string {
	if !h.Materialises() {
		return nil // tests and dry-run stay off the network
	}
	vendorCache.Lock()
	if time.Since(vendorCache.at) < vendorCacheTTL && vendorCache.byName != nil {
		cached := vendorCache.byName[name]
		vendorCache.Unlock()
		return cached
	}
	vendorCache.Unlock()

	fetched := map[string][]string{
		"node": fetchNodeVersions(),
		"go":   fetchGoVersions(),
		"rust": fetchRustVersions(),
	}
	vendorCache.Lock()
	vendorCache.at = time.Now()
	vendorCache.byName = fetched
	vendorCache.Unlock()
	return fetched[name]
}

type nodeRelease struct {
	Version string `json:"version"`
}

func fetchNodeVersions() []string {
	body, err := httpGet("https://nodejs.org/dist/index.json")
	if err != nil {
		return nil
	}
	var releases []nodeRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil
	}
	majors := map[string]bool{}
	for _, r := range releases {
		fields := strings.Split(strings.TrimPrefix(r.Version, "v"), ".")
		if len(fields) >= 1 && fields[0] != "" {
			majors[fields[0]] = true
		}
	}
	return sortedDescending(majors)
}

type goRelease struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
}

func fetchGoVersions() []string {
	body, err := httpGet("https://go.dev/dl/?mode=json&include=all")
	if err != nil {
		return nil
	}
	var releases []goRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil
	}
	minors := map[string]bool{}
	for _, r := range releases {
		if !r.Stable {
			continue
		}
		fields := strings.Split(strings.TrimPrefix(r.Version, "go"), ".")
		if len(fields) >= 2 {
			minors[fields[0]+"."+fields[1]] = true
		}
	}
	return sortedDescending(minors)
}

func httpGet(url string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stack: %s answered %d", url, resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 4<<20))
}

// fetchRustVersions reads the Rust project's release feed: rustup installs any published
// release by name, and the channel manifests themselves cannot be listed.
func fetchRustVersions() []string {
	var releases []struct {
		TagName string `json:"tag_name"`
	}
	body, err := httpGet("https://api.github.com/repos/rust-lang/rust/releases?per_page=100")
	if err != nil {
		return nil
	}
	if err := json.Unmarshal(body, &releases); err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, release := range releases {
		if regexp.MustCompile(`^1\.\d+\.\d+$`).MatchString(release.TagName) {
			set[release.TagName] = true
		}
	}
	return sortedDescending(set)
}

// goInstalled lists the Go toolchains on this host: the ones unpacked per version under
// /usr/local (which is how several coexist) plus whatever `go` is on PATH.
func goInstalled(ctx context.Context, h *host.Host) []string {
	set := map[string]bool{}
	if entries, err := os.ReadDir("/usr/local"); err == nil {
		for _, entry := range entries {
			name := strings.TrimPrefix(entry.Name(), "go")
			if entry.IsDir() && name != entry.Name() && runtimesVersionPattern.MatchString(name) {
				set[name] = true
			}
		}
	}
	if out, err := h.Run(ctx, []string{"bash", "-c", "go version 2>/dev/null || /usr/local/go/bin/go version 2>/dev/null || true"}); err == nil {
		if m := regexp.MustCompile(`go(\d+\.\d+(\.\d+)?)`).FindStringSubmatch(out); m != nil {
			set[m[1]] = true
		}
	}
	return sortedDescending(set)
}

// rustInstalled lists what rustup actually has installed. It names toolchains with a
// target triple ("stable-x86_64-unknown-linux-gnu"), and the part a person chooses is
// only the first field.
func rustInstalled(ctx context.Context, h *host.Host) []string {
	out, err := h.Run(ctx, []string{"rustup", "toolchain", "list"})
	if err != nil {
		return nil
	}
	channels := map[string]bool{}
	set := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) == 0 {
			continue
		}
		name := strings.SplitN(fields[0], "-", 2)[0]
		if runtimesVersionPattern.MatchString(name) {
			set[name] = true
			continue
		}
		channels[name] = true
	}
	// Channels first (newest-first doesn't apply to a name), then the versions.
	return append(sortedDescending(channels), sortedDescending(set)...)
}

// sortedDescending returns the version set newest-first by numeric component, so 1.9
// sorts below 1.10.
func sortedDescending(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return compareVersions(out[i], out[j]) > 0 })
	return out
}

func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(as) || i < len(bs); i++ {
		var ai, bi int
		if i < len(as) {
			ai, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			bi, _ = strconv.Atoi(bs[i])
		}
		if ai != bi {
			if ai > bi {
				return 1
			}
			return -1
		}
	}
	return 0
}

// aptCandidate reports the version apt would install for a package, and whether it
// exists here at all ("Candidate: (none)" means the package is not in any repository).
func aptCandidate(ctx context.Context, h *host.Host, pkg string) (string, bool) {
	res, err := h.Run(ctx, []string{"apt-cache", "policy", pkg})
	if err != nil {
		return "", false
	}
	for _, line := range strings.Split(res, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "Candidate:") {
			continue
		}
		candidate := strings.TrimSpace(strings.TrimPrefix(line, "Candidate:"))
		if candidate == "" || candidate == "(none)" {
			return "", false
		}
		return candidate, true
	}
	return "", false
}

var runtimesVersionPattern = regexp.MustCompile(`(\d+)\.(\d+)`)

// versionShape is the only thing that may be pasted into an install command: a dotted
// number, or one of rustup's channels. Which of those the host actually offers is
// decided against the repositories, not here.
var versionShape = regexp.MustCompile(`^(\d+(\.\d+)*|stable|beta|nightly)$`)

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

// phpVersions lists the PHP versions this host has. The scan lives with the extensions,
// which is the other thing the host answers per version.
func phpVersions() []string { return phpext.InstalledVersions() }

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
