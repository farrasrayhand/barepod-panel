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
	"path/filepath"
	"regexp"
	"slices"
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

// mongodbImage is the repository the panel pulls MongoDB from, matching the image
// dbengine.containerImages starts.
const mongodbImage = "mongo"

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
var aptWait = []string{
	"-o", "DPkg::Lock::Timeout=600",
	// A package whose configuration file the operator has edited asks what to do about it;
	// with no terminal dpkg reads EOF and aborts *mid-install*, which is what left MariaDB
	// unpacked and configured-by-nobody. Keeping the file that is on the host is both the
	// answer the prompt defaults to and the safe one.
	"-o", "Dpkg::Options::=--force-confold",
}

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
		return append([][]string{{"bash", "-c", nginxRepoScript}}, installEngine("nginx", version)...), nil
	case "caddy":
		return append([][]string{{"bash", "-c", caddyRepoScript}}, installEngine("caddy", version)...), nil
	case "repositories":
		// Every source that can hold several versions at once, added in one step: the two
		// apt repositories, the version managers for Ruby and Rust, and the database
		// engines' own repositories — a distribution carries one version of each engine,
		// so without these the database version list has one entry by construction.
		return [][]string{
			{"bash", "-c", suryRepoScript},
			{"bash", "-c", deadsnakesRepoScript},
			{"bash", "-c", rustupRepoScript},
			{"bash", "-c", pgdgRepoScript},
			{"bash", "-c", mariadbRepoScript},
			{"bash", "-c", mongodbRepoScript},
			{"bash", "-c", redisRepoScript},
			{"bash", "-c", nginxRepoScript},
			{"bash", "-c", caddyRepoScript},
			{"bash", "-c", apacheRepoScript},
			{"bash", "-c", openlitespeedRepoScript},
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
		// what lets 20 and 22 coexist for different sites. The tarball carries npm too, so
		// it is never a second install — and the plain names follow the newest major, so
		// `node` and `npm` in a shell are the ones a person just installed.
		install := "set -e; mkdir -p /opt/barepod/node; V=$(curl -fsSL https://nodejs.org/dist/index.json | tr ',' '\\n' | grep -m1 -o '\"version\":\"v" + version + "\\.[0-9.]*\"' | cut -d'\"' -f4); test -n \"$V\"; curl -fsSL https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz | tar -xJ -C /opt/barepod/node; rm -rf /opt/barepod/node/" + version + "; mv /opt/barepod/node/node-$V-linux-x64 /opt/barepod/node/" + version
		link := "set -e; newest=$(ls /opt/barepod/node | sort -V | tail -1); for b in node npm npx; do ln -sf /opt/barepod/node/$newest/bin/$b /usr/local/bin/$b; done; /usr/local/bin/node --version; /usr/local/bin/npm --version"
		return [][]string{{"bash", "-c", install}, {"bash", "-c", link}}, nil
	case "python":
		// Debian/Ubuntu ship one python3; the other versions come from deadsnakes. venv is
		// installed with it and pip is made to exist inside it, because a Python without
		// pip is not a Python anyone can use — the versioned package does not bring one on
		// its own.
		script := "set -e\napt-get " + strings.Join(aptWait, " ") + " install -y python" + version + " python" + version + "-venv python" + version + "-dev\npython" + version + " -m ensurepip --upgrade >/dev/null 2>&1 || true\npython" + version + " --version\npython" + version + " -m pip --version"
		return append([][]string{{"bash", "-c", deadsnakesRepoScript}}, [][]string{{"bash", "-c", script}}...), nil
	case "ruby":
		if version == "" {
			return nil, fmt.Errorf("stack: ruby needs a version (see its repository's list)")
		}
		// Prebuilt only: the distribution's packages install in seconds, where building Ruby
		// from source takes minutes. A version without a package is not offered at all.
		return apt("ruby"+version, "ruby"+version+"-dev"), nil
	case "go":
		// Each toolchain is a tarball beside the others, so two Go versions can coexist.
		// The index writes `"version": "go1.27.2"` — with a space after the colon, which a
		// pattern without one never matches, and a minor is offered but its patch is what
		// the tarball is named after.
		if version == "" {
			return nil, fmt.Errorf("stack: go needs a version (1.22, 1.23, …)")
		}
		script := "set -e\nV=$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' | tr ',' '\\n' | grep -m1 -o '\"version\": *\"go" + version + "\\.[0-9.]*\"' | cut -d'\"' -f4)\ntest -n \"$V\"\ncurl -fsSL https://go.dev/dl/$V.linux-amd64.tar.gz | tar -xz -C /usr/local\nrm -rf /usr/local/go" + version + "\nmv /usr/local/go /usr/local/go" + version
		return [][]string{{"bash", "-c", script}}, nil
	case "rust":
		if version == "" {
			// No version means "keep the channels current", which is how Rust is upgraded:
			// stable is a moving channel, not a fixed number. A toolchain has to exist first
			// — `rustup update` with nothing installed does nothing at all — and installing
			// a *number* when a channel already holds that version is what left two
			// toolchains holding the same release.
			return [][]string{{"bash", "-c", rustupRepoScript}, {"bash", "-c",
				"set -e; rustup toolchain install stable --profile minimal; rustup update"}}, nil
		}
		// A number is a pin. If a channel already holds that version, move the channel
		// instead of adding a second toolchain that holds the same release under a number.
		guard := "set -e; if rustc +stable --version 2>/dev/null | grep -q '" + version + "'; then echo 'stable already holds " + version + " — updating the channel instead of adding a second toolchain'; rustup update stable; else rustup toolchain install " + version + "; fi"
		return [][]string{{"bash", "-c", rustupRepoScript}, {"bash", "-c", guard}}, nil
	case "postgresql":
		return apt("postgresql-" + version), nil
	case "mariadb":
		// MariaDB upgrades its own system tables after the packages move; skipping it leaves
		// a server that starts and then refuses real work.
		script := "set -e\n" +
			"apt-get " + strings.Join(aptWait, " ") + " install -y mariadb-server\n" +
			"systemctl start mariadb 2>/dev/null || true\n" +
			"mariadb-upgrade -u root 2>&1 || mysql_upgrade -u root 2>&1 || echo 'mariadb-upgrade did not run — check the server log'"
		return [][]string{{"bash", "-c", script}}, nil
	case "redis":
		return apt("redis-server"), nil
	case "mongodb":
		// MongoDB runs in a container on hosts that have Docker, so a version is an image tag
		// and installing it is a pull; the packages are the fallback for a host without it.
		script := "set -e\nif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then\n" +
			"  echo 'this host runs MongoDB in Docker — pulling the image instead of installing packages'\n" +
			"  docker pull " + mongodbImage + ":" + version + "\n" +
			"else\n" +
			"  echo 'no Docker here — installing MongoDB " + version + " packages'\n" +
			"  apt-get " + strings.Join(aptWait, " ") + " install -y 'mongodb-org=" + version + "*'\n" +
			"fi"
		return [][]string{{"bash", "-c", mongodbRepoScript}, {"bash", "-c", script}}, nil
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

// The database engines' own repositories. Ubuntu carries one version of each, which is why
// a version list from the distribution alone is a single entry: PGDG carries one package
// per major, and the others carry the release lines they support.
const pgdgRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

const mariadbRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -fsSL https://mariadb.org/mariadb_release_signing_key.pgp -o /usr/share/keyrings/mariadb-keyring.pgp
echo "deb [signed-by=/usr/share/keyrings/mariadb-keyring.pgp] https://mirror.mariadb.org/repo/11.4/ubuntu $(lsb_release -cs) main" > /etc/apt/sources.list.d/mariadb.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

const mongodbRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc | gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/8.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-8.0.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

const redisRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -fsSL https://packages.redis.io/gpg | gpg --dearmor --yes -o /usr/share/keyrings/redis-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" > /etc/apt/sources.list.d/redis.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

// The web servers' own repositories: Ubuntu pins one nginx and one caddy, and both
// projects publish releases faster than the distribution.
const nginxRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -fsSL https://nginx.org/keys/nginx_signing.key -o /usr/share/keyrings/nginx-archive-keyring.asc
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.asc] https://nginx.org/packages/mainline/ubuntu $(lsb_release -cs) nginx" > /etc/apt/sources.list.d/nginx.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

const caddyRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get -o DPkg::Lock::Timeout=600 update >/dev/null`

// Apache and OpenLiteSpeed carry more versions than Ubuntu's single package: the ondrej
// PPA for Apache, and LiteSpeed's own repository for OpenLiteSpeed. Each one undoes itself
// if apt cannot use it, because a source that fails leaves the whole system unable to
// install anything — which is worse than a version list with one entry.
const apacheRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq software-properties-common >/dev/null
if ! add-apt-repository -y ppa:ondrej/apache2 >/dev/null 2>&1; then
  echo "the Apache PPA is not available for this release — keeping the distribution's Apache"
  add-apt-repository -y --remove ppa:ondrej/apache2 >/dev/null 2>&1 || true
  exit 0
fi
if ! apt-get -o DPkg::Lock::Timeout=600 update >/dev/null 2>&1; then
  add-apt-repository -y --remove ppa:ondrej/apache2 >/dev/null 2>&1 || true
  echo "the Apache PPA could not be updated — removed it again rather than leaving apt broken"
fi`

const openlitespeedRepoScript = `set -e
apt-get -o DPkg::Lock::Timeout=600 install -y -qq curl ca-certificates gnupg lsb-release >/dev/null
curl -fsSL https://rpms.litespeedtech.com/debian/lst_repo.gpg -o /usr/share/keyrings/lst_repo.gpg || true
echo "deb [signed-by=/usr/share/keyrings/lst_repo.gpg] http://rpms.litespeedtech.com/debian/ $(lsb_release -cs) main" > /etc/apt/sources.list.d/openlitespeed.list
if ! apt-get -o DPkg::Lock::Timeout=600 update >/dev/null 2>&1; then
  rm -f /etc/apt/sources.list.d/openlitespeed.list
  echo "OpenLiteSpeed's repository is not published for this release — removed it again rather than leaving apt broken"
fi`

// rbenvRoot is where the panel keeps rbenv.

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

// SiteRuntime maps a Stack component to the runtime name a website records, so the panel
// can ask "does any site use this version?" before removing it.
func SiteRuntime(component string) string {
	switch component {
	case "node":
		return "nodejs"
	case "php", "python", "ruby", "go", "rust":
		return component
	}
	return ""
}

// DatabaseEngine reports whether a component is a database engine.
func DatabaseEngine(component string) bool {
	switch component {
	case "postgresql", "mariadb", "mongodb", "redis":
		return true
	}
	return false
}

// Removable reports whether a component has an uninstall path at all. Every runtime, web
// server and database engine does; what decides whether one may actually go is whether a
// project uses it, which the caller checks first.
func Removable(component string) error {
	switch component {
	case "php", "python", "node", "ruby", "go", "rust",
		"nginx", "caddy", "postgresql", "mariadb", "mongodb", "redis":
		return nil
	}
	return fmt.Errorf("stack: %q has no uninstall path", component)
}

// purged removes packages and then says where the data stays. Removing an engine is not
// shredding it, and a quiet removal would be the dangerous kind: the log names the
// directories that are still there.
func purged(packages []string, dataDirs ...string) [][]string {
	args := append([]string{"purge", "-y"}, packages...)
	note := "echo 'removed; data directories were left in place: " + strings.Join(dataDirs, " ") + "'"
	return [][]string{aptGet(args...), {"bash", "-c", note}, aptGet("autoremove", "-y")}
}

// UninstallCommands is the allowlisted removal for an installed version. A database engine
// is removed one version at a time too, which is what its own packaging allows
// (postgresql-16 is a package, and a container engine's version is an image tag).
func UninstallCommands(component, version string) ([][]string, error) {
	if err := Removable(component); err != nil {
		return nil, err
	}
	version = strings.TrimSpace(version)
	if DatabaseEngine(component) && version == "" {
		return nil, fmt.Errorf("stack: %s needs the version to remove — the engines are removed one version at a time", component)
	}
	if version == "" || !versionShape.MatchString(version) {
		if DatabaseEngine(component) {
			return nil, fmt.Errorf("stack: %q is not a version this panel installs", version)
		}
		if version == "" {
			return UninstallWhole(component)
		}
		return nil, fmt.Errorf("stack: %q is not a version this panel installs", version)
	}
	// The version is already limited to digits and dots, so it is safe inside the quotes.
	apt := func(script string) [][]string {
		return [][]string{{"bash", "-c", "set -e; " + script + "; apt-get " + strings.Join(aptWait, " ") + " autoremove -y"}}
	}
	switch component {
	case "php":
		return apt("apt-get " + strings.Join(aptWait, " ") + " purge -y 'php" + version + "-*'"), nil
	case "python":
		return apt("apt-get " + strings.Join(aptWait, " ") + " purge -y 'python" + version + "' 'python" + version + "-venv' 'python" + version + "-dev'"), nil
	case "node":
		return [][]string{{"bash", "-c", "rm -rf /opt/barepod/node/" + version}}, nil
	case "go":
		return [][]string{{"bash", "-c", "rm -rf /usr/local/go" + version}}, nil
	case "ruby":
		return purged([]string{"ruby" + version + "*"}, "the gems installed against it"), nil
	case "rust":
		return [][]string{{"bash", "-c", "rustup toolchain uninstall " + version}}, nil
	case "nginx", "caddy":
		// A web server carries one version at a time — installing another replaces it — so
		// removing the installed version is removing the package, and the version is named
		// for the record.
		return [][]string{
			{"bash", "-c", "echo 'removing " + component + " " + version + " (a web server carries one version; installing another replaces this one)'"},
			append(purged([]string{component}, "/etc/"+component), nil...)[0],
		}, nil
	case "postgresql":
		// One package per major, so one version can go on its own.
		return purged([]string{"postgresql-" + version}, "/var/lib/postgresql/"+version), nil
	case "mariadb", "mysql":
		return purged([]string{"mariadb-server*"}, "/var/lib/mysql"), nil
	case "mongodb":
		// The container engine's versions are image tags, so removing one is untagging it.
		return [][]string{{"bash", "-c", "set -e; docker rmi " + mongodbImage + ":" + version + " 2>/dev/null || echo 'that image was not here'; echo 'the volume barepod-mongo-data holds the data and was left alone'"}}, nil
	case "redis":
		return purged([]string{"redis-server", "redis-tools"}, "/var/lib/redis"), nil
	}
	return nil, fmt.Errorf("stack: %q has no uninstall path", component)
}

// UninstallWhole removes something that has no per-version idea: a web server, whose
// version is switched by installing one rather than by removing an old one.
func UninstallWhole(component string) ([][]string, error) {
	switch component {
	case "nginx", "caddy":
		return purged([]string{component}, "/etc/"+component), nil
	}
	return nil, fmt.Errorf("stack: %s is removed one version at a time", component)
}

// VersionMatches reports whether a recorded version refers to an offered one: a site
// records the major it chose (node 22) while the host may offer a patch list.
func VersionMatches(recorded, version string) bool {
	recorded, version = strings.TrimSpace(recorded), strings.TrimSpace(version)
	return recorded == version || strings.HasPrefix(recorded, version+".")
}

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

	mu        sync.Mutex
	running   string    // the install in progress, empty when none is
	claimedAt time.Time // when it was claimed, so a stranded claim can be taken over
}

func New(st *store.Store, h *host.Host) *Installer { return &Installer{store: st, host: h} }

// claimTTL is how long a claim is believed. A job is given twenty minutes; past this it is
// treated as stranded — a process that died mid-job, or a claim that was never released —
// and the next install takes it over rather than being refused forever.
const claimTTL = 30 * time.Minute

// Running reports the install in progress, or empty.
func (i *Installer) Running() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	if time.Since(i.claimedAt) > claimTTL {
		return ""
	}
	return i.running
}

// claim marks an install as running, or reports which one is in the way.
func (i *Installer) claim(label string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.running != "" && time.Since(i.claimedAt) < claimTTL {
		return fmt.Errorf("stack: %s is installing right now — wait for it to finish (two installs would share one package lock)", i.running)
	}
	i.running = label
	i.claimedAt = time.Now()
	return nil
}

func (i *Installer) release() {
	i.mu.Lock()
	i.running = ""
	i.claimedAt = time.Time{}
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
		i.release() // a job that was never recorded must not hold the queue
		return nil, err
	}
	snapshot := *job
	go i.run(job, "installing", "installed", component, version, commands)
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
	// A database engine's versions come from its repositories, exactly as a runtime's do.
	// Falling through to the catalogue is what refused PostgreSQL 18 with "(available: 16,
	// 15)" while the screen, which reads the repositories, offered it.
	if DatabaseEngine(component) {
		if versions := databaseVersions(ctx, i.host, component); len(versions) > 0 {
			return versions
		}
	}
	// A web server's versions come from its own repository too.
	if _, managed := webServerPkg[component]; managed {
		if versions := webServerVersions(ctx, i.host, component); len(versions) > 0 {
			return versions
		}
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

// StartRemoval uninstalls an installed version; the caller must have established that
// nothing uses it. It takes the same one-at-a-time claim an install does, because npm,
// rustup and apt steps all touch the same files and locks.
func (i *Installer) StartRemoval(component, version string) (*store.DeployJob, error) {
	commands, err := UninstallCommands(component, version)
	if err != nil {
		return nil, err
	}
	label := component + " " + strings.TrimSpace(version)
	if err := i.claim("removing " + label); err != nil {
		return nil, err
	}
	job := &store.DeployJob{
		ID:         id.New(),
		Slug:       JobSlug,
		Mode:       i.host.Mode(),
		Status:     "pending",
		TotalSteps: len(commands) + 1, // +1 for the dpkg repair both paths start with
		CreatedAt:  now(),
	}
	if err := i.store.CreateDeployJob(job); err != nil {
		i.release()
		return nil, err
	}
	snapshot := *job
	go i.run(job, "removing", "removed", component, version, append([][]string{dpkgRepair()}, commands...))
	return &snapshot, nil
}

func (i *Installer) run(job *store.DeployJob, action, done, component, version string, commands [][]string) {
	defer i.release()
	defer func() { _, _ = i.store.PruneDeployJobs(JobSlug, 5) }()

	job.Status = "running"
	_ = i.store.UpdateDeployJob(job)
	log := func(stream, line string) { _, _ = i.store.AppendDeployLog(job.ID, stream, line) }

	label := component
	if version != "" {
		label += " " + version
	}
	log("stdout", fmt.Sprintf("%s %s (mode=%s)", action, label, job.Mode))
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
		// Each step is its own transient unit: a deploy that restarts the daemon no longer
		// kills the apt or rustup running under it.
		out, err := i.host.RunDetached(ctx, fmt.Sprintf("barepod-stack-%s-%d", job.ID, n+1), argv)
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
	log("stdout", done+": "+label)
	log("status", "success")
}

// now returns the current UTC time as a stored timestamp.
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
		// Available is what each engine's repositories carry; Latest is the newest of them.
		Available map[string][]string `json:"available"`
		Latest    map[string]string   `json:"latest"`
		// Managed is every web server the panel keeps versions for (the ingress is only
		// nginx and caddy), and ManagedInstalled is their real state.
		Managed          []string          `json:"managed"`
		ManagedInstalled []WebServerStatus `json:"managedInstalled"`
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
	// InstallRunning names an install in progress, so "nothing is running" is never a
	// guess: the screen can say what holds the queue.
	InstallRunning string `json:"installRunning,omitempty"`
	// DatabaseAvailable is what each engine's repositories offer, read the same way a
	// runtime's list is: a version is shown because apt has the package, not because a
	// catalog names it.
	DatabaseAvailable map[string][]string `json:"databaseAvailable"`
	// DatabaseLatest is the newest of those, for the screen to mark.
	DatabaseLatest map[string]string `json:"databaseLatest"`
	// Repositories says which sources the panel adds are already here.
	Repositories []RepositoryStatus `json:"repositories"`
	Mode         string             `json:"mode"`
}

// Detect reports the host's real state — never a stored wish.
func Detect(ctx context.Context, st *store.Store, h *host.Host, lookPath func(string) (string, error)) Status {
	var out Status
	out.Mode = h.Mode()
	out.Components = Catalog()
	if h.Materialises() {
		out.Repositories = Repositories()
	}

	active := webserver.DefaultEngine
	if v, err := st.PanelSetting("active_web_server"); err == nil && webserver.Supported(v) {
		active = strings.ToLower(strings.TrimSpace(v))
	}
	out.WebServer.Active = active
	// Supported is who can own :80 — the ingress. Managed is every web server the panel
	// keeps versions for, because OpenLiteSpeed and Apache are perfectly good engines that
	// simply cannot be the ingress today.
	out.WebServer.Supported = []string{webserver.Nginx, webserver.Caddy}
	out.WebServer.Managed = []string{webserver.Nginx, webserver.Caddy, "openlitespeed", "apache"}
	out.WebServer.WebUser = webserver.WebUser(active)
	out.WebServer.VhostsPath = h.VhostsFor(active)
	out.WebServer.Available = map[string][]string{}
	out.WebServer.Latest = map[string]string{}
	out.WebServer.ManagedInstalled = []WebServerStatus{}
	for _, engine := range out.WebServer.Managed {
		status := WebServerStatus{Engine: engine, Installed: webServerInstalled(engine, lookPath)}
		if status.Installed {
			status.Running = serviceActive(ctx, h, engine)
			status.Version = engineVersion(ctx, h, engine)
		}
		out.WebServer.Available[engine] = webServerVersions(ctx, h, engine)
		out.WebServer.Latest[engine] = newestOf(out.WebServer.Available[engine])
		out.WebServer.ManagedInstalled = append(out.WebServer.ManagedInstalled, status)
		if slices.Contains(out.WebServer.Supported, engine) {
			out.WebServer.Installed = append(out.WebServer.Installed, status)
		}
	}

	out.Databases = dbengine.Detect(ctx, h.Runner)
	out.DatabaseVersions = map[string]string{}
	out.DatabaseAvailable = map[string][]string{}
	out.DatabaseLatest = map[string]string{}
	for i := range out.Databases {
		engine := &out.Databases[i]
		// An engine running in a container has no binary on this host to probe, so its
		// version is the image tag Docker is running — which is what "installed" means for
		// it. Without this the screen said "—" for a MongoDB that was up.
		if engine.Mode == dbengine.ModeDocker {
			// A container's version is its image tag. A running container answers directly;
			// when none is up, the images present locally are what is installed here — which
			// is why MongoDB showed "—" while mongo:7 and mongo:7.0 sat on the host.
			if tag := dockerRunningTag(ctx, h, engine.Name); tag != "" {
				engine.Installed = tag
			} else if tag := dockerNewestLocalTag(ctx, h, engine.Name); tag != "" {
				engine.Installed = tag + " (image)"
			}
		}
		// The probe, not the catalogue: Versions is what the engine *could* run, and using
		// it here made the screen show an installed version nobody had installed (MariaDB
		// 11.4 beside an installed 10.11).
		out.DatabaseVersions[engine.Name] = strings.TrimSpace(engine.Installed)
		out.DatabaseAvailable[engine.Name] = databaseVersions(ctx, h, engine.Name)
		out.DatabaseLatest[engine.Name] = newestOf(out.DatabaseAvailable[engine.Name])
	}
	out.PHP.Installed = phpVersions()
	// There is no stored "default" version: a site's version is chosen when the site is
	// created, and the wizard always asks. What the screen shows as the default is simply
	// the newest one installed, which is what the extensions screen falls back to.
	out.PHP.Default = newestOf(out.PHP.Installed)
	out.Node.Installed = nodeInstalled(ctx, h, lookPath)
	out.Node.Default = newestOf(out.Node.Installed)
	out.Runtimes = map[string]RuntimeStatus{}
	for _, r := range runtimeSources() {
		status := RuntimeStatus{PerSite: r.perSite, Source: r.source}
		// The repository's list comes first: a version is only "installed" if it is in it
		// (Python answers per version, which is what a distribution install looks like).
		status.Available = availableVersions(ctx, h, r)
		switch {
		case r.name == "php":
			status.Installed = out.PHP.Installed
		case r.name == "node":
			status.Installed = nodeInstalled(ctx, h, lookPath)
		case r.name == "python":
			status.Installed = aptVersionedInstalled(ctx, h, "python", status.Available)
		case r.name == "ruby":
			status.Installed = aptVersionedInstalled(ctx, h, "ruby", status.Available)
		case r.name == "go":
			// Several Go toolchains coexist as /usr/local/go<version>, so the answer is a
			// list and not one probe.
			status.Installed = goInstalled(ctx, h)
		case r.name == "rust":
			status.Installed = rustInstalled(ctx, h)
		case len(r.binary) > 0:
			status.Installed = probeVersions(ctx, h, lookPath, r.probe, r.binary)
		}
		status.Latest = newestOf(status.Available)
		status.Supported = primaryVersions(r.name, status.Available)
		if r.name == "node" && h.Materialises() {
			// Node's versions mean nothing without their line: which is Current, which LTS.
			status.Labels = nodeOfferingCached().Labels
		}
		status.UpToDate = upToDate(ctx, h, r.name, status.Latest, status.Installed)
		out.Runtimes[r.name] = status
	}
	return out
}

// nodeInstalled lists the Node majors the panel unpacked, one directory per major — which
// is what a site chooses. The plain `node` on PATH is one of those same majors (the panel
// points the name at the newest), so probing it as well reported the same Node twice: once
// as "22" and once as "22.23.3".
func nodeInstalled(ctx context.Context, h *host.Host, _ func(string) (string, error)) []string {
	found := map[string]bool{}
	if entries, err := os.ReadDir("/opt/barepod/node"); err == nil {
		for _, entry := range entries {
			// A directory is named with the major alone ("22"), not with a dotted version.
			if entry.IsDir() && nodeMajorPattern.MatchString(entry.Name()) {
				found[entry.Name()] = true
			}
		}
	}
	// A Node installed by hand outside the panel still counts, reported by its major.
	if out, err := h.Run(ctx, []string{"bash", "-c", "node --version 2>/dev/null || true"}); err == nil {
		if m := nodeMajorPattern.FindString(strings.TrimPrefix(strings.TrimSpace(out), "v")); m != "" {
			found[m] = true
		}
	}
	return sortedDescending(found)
}

var nodeMajorPattern = regexp.MustCompile(`^\d+`)

// dockerRunningTag is the tag of the image the panel's container for an engine is running,
// which is that engine's version on a host whose engines live in containers.
func dockerRunningTag(ctx context.Context, h *host.Host, engine string) string {
	out, err := h.Run(ctx, []string{"bash", "-c",
		"docker ps --filter name=barepod-" + engine + " --format '{{.Image}}' 2>/dev/null | head -1"})
	if err != nil {
		return ""
	}
	image := strings.TrimSpace(out)
	if image == "" {
		return ""
	}
	if _, tag, found := strings.Cut(image, ":"); found {
		// "mongo:7.0" → 7.0; a bare repository has no tag to report.
		if tag != "latest" {
			return tag
		}
	}
	return ""
}

// dockerNewestLocalTag is the newest tag of the panel's image for an engine that is present
// on this host, which is the version installed when no container is running.
func dockerNewestLocalTag(ctx context.Context, h *host.Host, engine string) string {
	// The engine's own repository only: without this the newest tag on the host answered
	// for every engine, and MongoDB reported the tag of a MariaDB image.
	repo := map[string]string{
		"mongodb": "mongo", "mariadb": "mariadb", "mysql": "mysql",
		"postgresql": "postgres", "redis": "redis",
	}[engine]
	if repo == "" {
		return ""
	}
	out, err := h.Run(ctx, []string{"bash", "-c",
		"docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^" + repo + ":[0-9]+(\\.[0-9]+)*$' | awk -F: '{print $2}' | sort -V | tail -1"})
	if err != nil {
		return ""
	}
	return strings.TrimSpace(out)
}

// dockerImageTags lists the version tags a Docker Hub image publishes (8.0, 7.0, 6.0 …).
// A tag is what can be pulled, which is what "available" means for a container engine.
func dockerImageTags(ctx context.Context, h *host.Host, image string) []string {
	if _, err := h.Run(ctx, []string{"bash", "-c", "command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1"}); err != nil {
		return nil
	}
	body, err := httpGet("https://registry.hub.docker.com/v2/repositories/library/" + image + "/tags?page_size=100")
	if err != nil {
		return nil
	}
	var payload struct {
		Results []struct {
			Name string `json:"name"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, tag := range payload.Results {
		if regexp.MustCompile(`^\d+(\.\d+)?$`).MatchString(tag.Name) {
			set[tag.Name] = true
		}
	}
	return sortedDescending(set)
}

// installEngine installs a web server: the newest its repository carries when no version
// was asked for, and exactly that version when one was. It is one or the other — asking
// for 2.11.0 and also installing the newest was upgrading caddy to 2.11.7 first and then
// failing on the pin.
func installEngine(pkg, version string) [][]string {
	if strings.TrimSpace(version) != "" {
		return pinnedApt(pkg, version)
	}
	return [][]string{aptGet("install", "-y", pkg)}
}

// pinnedApt installs one exact version of a package, resolved from what the repositories
// actually carry: a version is offered as 1.29 and apt needs the whole 1.29.0-… string, so
// the resolver picks the first madison entry that starts with what was asked for.
func pinnedApt(pkg, version string) [][]string {
	version = strings.TrimSpace(version)
	if version == "" || !versionShape.MatchString(version) {
		return nil // no version asked for: the repository's newest is the answer
	}
	script := "set -e\nV=$(apt-cache madison " + pkg + " | awk '{print $3}' | grep -m1 '^" + version + "')\ntest -n \"$V\"\napt-get " + strings.Join(aptWait, " ") + " install -y " + pkg + "=\"$V\""
	return [][]string{{"bash", "-c", script}}
}

// webServerPkg is the package or binary name each engine is known by.
var webServerPkg = map[string]string{
	"nginx": "nginx", "caddy": "caddy", "apache": "apache2", "openlitespeed": "openlitespeed",
}

// webServerInstalled reports whether an engine is on this host, for the two the webserver
// package does not know about as well.
func webServerInstalled(engine string, lookPath func(string) (string, error)) bool {
	if webserver.Supported(engine) {
		return webserver.Available(engine, lookPath)
	}
	if lookPath == nil {
		return false
	}
	if engine == "apache" {
		if _, err := lookPath("apache2"); err == nil {
			return true
		}
		_, err := lookPath("httpd")
		return err == nil
	}
	_, err := lookPath(engine)
	return err == nil
}

// webServerVersions lists what an engine's repositories carry, so the screen can offer a
// specific version instead of whatever the distribution pinned.
func webServerVersions(ctx context.Context, h *host.Host, engine string) []string {
	if !h.Materialises() {
		return nil
	}
	pkg := webServerPkg[engine]
	if pkg == "" {
		return nil
	}
	out, err := h.Run(ctx, []string{"bash", "-c", "apt-cache madison " + pkg + " 2>/dev/null | awk '{print $3}'"})
	if err != nil {
		return nil
	}
	set := map[string]bool{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if _, after, found := strings.Cut(line, ":"); found && versionToken.MatchString(after) {
			line = after
		}
		if m := versionToken.FindString(line); m != "" {
			set[strings.TrimPrefix(m, "v")] = true
		}
	}
	return sortedDescending(set)
}

// databaseVersions lists the versions an engine's repositories offer. PostgreSQL ships
// one package per major (postgresql-16), so its list is real; the others carry a single
// version in the distribution, and asking apt is how the screen learns that instead of
// showing an empty column.
func databaseVersions(ctx context.Context, h *host.Host, engine string) []string {
	if !h.Materialises() {
		return nil
	}
	set := map[string]bool{}
	switch engine {
	case "mongodb":
		// This host runs MongoDB in a container, so its versions are image tags: asking the
		// registry is the honest answer, and the packages are only the fallback.
		if tags := dockerImageTags(ctx, h, mongodbImage); len(tags) > 0 {
			return tags
		}
	case "postgresql":
		out, err := h.Run(ctx, []string{"bash", "-c", "apt-cache search --names-only '^postgresql-[0-9]+$' | awk '{print $1}'"})
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(out, "\n") {
			if m := regexp.MustCompile(`^postgresql-(\d+)$`).FindStringSubmatch(strings.TrimSpace(line)); m != nil {
				set[m[1]] = true
			}
		}
	default:
		// One candidate: the version apt would install for the engine's package.
		pkg := map[string]string{"mariadb": "mariadb-server", "redis": "redis-server", "mongodb": "mongodb-org"}[engine]
		if pkg == "" {
			return nil
		}
		// madison lists every version the repositories can install, which is what makes a
		// second line (Redis 8 beside 7, MariaDB 11.4 beside 10.11) visible at all.
		out, err := h.Run(ctx, []string{"bash", "-c", "apt-cache madison " + pkg + " 2>/dev/null | awk '{print $3}'"})
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			// A Debian version reads 1:10.11.14-0ubuntu0.24.04.1: the epoch is not part of
			// the version a person chooses.
			if _, after, found := strings.Cut(line, ":"); found && runtimesVersionPattern.MatchString(after) {
				line = after
			}
			if m := runtimesVersionPattern.FindStringSubmatch(line); m != nil {
				set[m[1]+"."+m[2]] = true
			}
		}
		if len(set) == 0 {
			// No repository beyond the distribution's: fall back to its single candidate.
			if candidate, ok := aptCandidate(ctx, h, pkg); ok {
				if m := runtimesVersionPattern.FindStringSubmatch(candidate); m != nil {
					set[m[1]+"."+m[2]] = true
				}
			}
		}
	}
	return sortedDescending(set)
}

// RepositoryStatus is one source the panel adds for itself. The screen only offers to add
// repositories when one is actually missing, so the card is not permanent furniture.
type RepositoryStatus struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Present bool   `json:"present"`
	// Group is the tab the source belongs to (web, runtime, database), so the card that
	// offers to add it is drawn beside the versions it fills.
	Group string `json:"group"`
	Path  string `json:"path,omitempty"`
}

// Repositories reports which of the four sources are already here, by looking for what
// each one leaves behind.
func Repositories() []RepositoryStatus {
	sury := "/etc/apt/sources.list.d/sury-php.list"
	deadsnakes, _ := filepath.Glob("/etc/apt/sources.list.d/*deadsnakes*")
	rustup := "/usr/local/bin/rustup"
	pgdg := "/etc/apt/sources.list.d/pgdg.list"
	mariadb := "/etc/apt/sources.list.d/mariadb.list"
	mongodb, _ := filepath.Glob("/etc/apt/sources.list.d/mongodb-org-*.list")
	redis := "/etc/apt/sources.list.d/redis.list"
	nginx := "/etc/apt/sources.list.d/nginx.list"
	caddy, _ := filepath.Glob("/etc/apt/sources.list.d/caddy-stable.list")

	apachePath, olsPath := "", ""
	if matches, _ := filepath.Glob("/etc/apt/sources.list.d/*apache2*"); len(matches) > 0 {
		apachePath = matches[0]
	}
	if matches, _ := filepath.Glob("/etc/apt/sources.list.d/openlitespeed.list"); len(matches) > 0 {
		olsPath = matches[0]
	}
	deadPath, mongoPath, caddyPath := "", "", ""
	if len(deadsnakes) > 0 {
		deadPath = deadsnakes[0]
	}
	if len(mongodb) > 0 {
		mongoPath = mongodb[0]
	}
	if len(caddy) > 0 {
		caddyPath = caddy[0]
	}
	return []RepositoryStatus{
		{Name: "sury", Label: "Sury (PHP versions)", Present: exists(sury), Group: "runtime", Path: sury},
		{Name: "deadsnakes", Label: "deadsnakes (Python versions)", Present: deadPath != "", Group: "runtime", Path: deadPath},
		{Name: "rustup", Label: "rustup (Rust toolchains)", Present: isExecutable(rustup), Group: "runtime", Path: rustup},
		{Name: "pgdg", Label: "PGDG (PostgreSQL versions)", Present: exists(pgdg), Group: "database", Path: pgdg},
		{Name: "mariadb", Label: "MariaDB (version lines)", Present: exists(mariadb), Group: "database", Path: mariadb},
		{Name: "mongodb", Label: "MongoDB (version lines)", Present: mongoPath != "", Group: "database", Path: mongoPath},
		{Name: "redis", Label: "Redis (version lines)", Present: exists(redis), Group: "database", Path: redis},
		{Name: "nginx", Label: "nginx.org (nginx versions)", Present: exists(nginx), Group: "web", Path: nginx},
		{Name: "caddy", Label: "Cloudsmith (caddy versions)", Present: caddyPath != "", Group: "web", Path: caddyPath},
		{Name: "apache", Label: "ondrej PPA (Apache versions)", Present: apachePath != "", Group: "web", Path: apachePath},
		{Name: "openlitespeed", Label: "LiteSpeed (OpenLiteSpeed versions)", Present: olsPath != "", Group: "web", Path: olsPath},
	}
}

func exists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

// RuntimeStatus is one language's versions on this host.
type RuntimeStatus struct {
	Installed []string `json:"installed"`
	// Available is what this host's repositories actually offer (empty when the versions
	// come from a tarball or a toolchain manager instead).
	Available []string `json:"available"`
	// PerSite says the version matters for each site (interpreted at runtime) rather than
	// being a build-time toolchain, where one version is enough.
	PerSite bool `json:"perSite"`
	// Supported is the short list the screen draws first; Available is everything, kept so
	// a project that pins an older version can still reach it.
	Supported []string `json:"supported"`
	// Latest is the newest version this host can install, or empty when it cannot say.
	Latest string `json:"latest,omitempty"`
	// UpToDate says the newest installable version is already here, resolved by the daemon
	// (a Rust channel is a moving name, so the browser cannot compare it).
	UpToDate bool `json:"upToDate"`
	// Labels names a version when the number alone does not: for Node, "current" or the
	// LTS codename.
	Labels map[string]string `json:"labels,omitempty"`
	Source string            `json:"source,omitempty"`
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
			pkgPrefix: "python"},
		{name: "node", perSite: true, source: "tarball — nodejs.org/dist (per site)", kind: "vendor-index",
			probe: "node", binary: []string{"node", "--version"}},
		{name: "ruby", perSite: true, source: "apt — prebuilt (ruby3.x packages)", kind: "apt-suffixed",
			pkgPrefix: "ruby"},
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
		// No repository owns these versions; the vendor's own index does. Node's index is
		// read together with the schedule, so its list is Current plus the supported LTS
		// lines rather than twenty years of majors.
		if r.name == "node" {
			return nodeOfferingCached().Versions
		}
		return vendorVersions(ctx, h, r.name)
	case "rbenv":
		// Two sources, and the difference matters: a distribution package (ruby3.2) installs
		// in seconds, while ruby-build's list is compiled from source on this host. Both are
		// offered; the labels say which is which.
		if !h.Materialises() {
			return nil
		}
		set := map[string]bool{}
		if out, err := h.Run(ctx, []string{"bash", "-c", "apt-cache search --names-only '^ruby[0-9]+\\.[0-9]+$' | awk '{print $1}'"}); err == nil {
			for _, line := range strings.Split(out, "\n") {
				if m := regexp.MustCompile(`^ruby(\d+\.\d+)$`).FindStringSubmatch(strings.TrimSpace(line)); m != nil {
					set[m[1]] = true
				}
			}
		}
		prebuilt := map[string]bool{}
		for version := range set {
			prebuilt[version] = true
		}
		if out, err := h.Run(ctx, []string{"ruby-build", "--definitions"}); err == nil {
			for _, line := range strings.Split(out, "\n") {
				line = strings.TrimSpace(line)
				if m := regexp.MustCompile(`^\d+\.\d+\.\d+$`).FindString(line); m != "" {
					set[m] = true
				}
			}
		}
		// The prebuilt packages come first: they are what to reach for, and everything else
		// compiles on this host.
		fast := []string{}
		rest := []string{}
		for _, version := range sortedDescending(set) {
			if prebuilt[version] {
				fast = append(fast, version)
				continue
			}
			rest = append(rest, version)
		}
		return append(fast, rest...)
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
	LTS     any    `json:"lts"` // false, or the codename ("Jod") the project gave the line
}

type nodeReleaseLine struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

// nodeOffering is what the panel offers for Node, and what each line is called.
type nodeOffering struct {
	Versions []string
	Labels   map[string]string
}

var nodeOfferingCache struct {
	sync.Mutex
	at    time.Time
	value nodeOffering
}

// nodeOfferingCached answers with nodejs.org's own view — the Current release and the LTS
// lines still in support — and names each one, because "which of these is LTS?" is the
// question the version number does not answer.
func nodeOfferingCached() nodeOffering {
	nodeOfferingCache.Lock()
	if time.Since(nodeOfferingCache.at) < vendorCacheTTL && nodeOfferingCache.value.Versions != nil {
		value := nodeOfferingCache.value
		nodeOfferingCache.Unlock()
		return value
	}
	nodeOfferingCache.Unlock()

	offering := buildNodeOffering()

	nodeOfferingCache.Lock()
	nodeOfferingCache.at = time.Now()
	nodeOfferingCache.value = offering
	nodeOfferingCache.Unlock()
	return offering
}

func buildNodeOffering() nodeOffering {
	offering := nodeOffering{Labels: map[string]string{}}
	body, err := httpGet("https://nodejs.org/dist/index.json")
	if err != nil {
		return offering
	}
	var releases []nodeRelease
	if err := json.Unmarshal(body, &releases); err != nil {
		return offering
	}
	// The newest release per major, which also carries the line's codename.
	newest := map[string]nodeRelease{}
	for _, release := range releases {
		fields := strings.Split(strings.TrimPrefix(release.Version, "v"), ".")
		if len(fields) < 1 || fields[0] == "" {
			continue
		}
		major := fields[0]
		if _, seen := newest[major]; !seen {
			newest[major] = release // the index is newest-first
		}
	}

	majors := map[string]bool{}
	newestMajor := ""
	for major := range newest {
		majors[major] = true
		if newestMajor == "" || compareVersions(major, newestMajor) > 0 {
			newestMajor = major
		}
	}
	if schedule, err := nodeSchedule(); err == nil && len(schedule) > 0 {
		// Only the lines the project still supports (its schedule says when each ends) —
		// but the Current release stays whatever the schedule says, because it is what the
		// project publishes today and it is often not on the schedule yet.
		now := time.Now()
		supported := map[string]bool{}
		for line, entry := range schedule {
			if entry.End != "" {
				if end, err := time.Parse("2006-01-02", entry.End); err == nil && end.Before(now) {
					continue
				}
			}
			fields := strings.Split(strings.TrimPrefix(line, "v"), ".")
			if len(fields) > 0 && fields[0] != "" {
				supported[fields[0]] = true
			}
		}
		for major := range majors {
			if major != newestMajor && !supported[major] {
				delete(majors, major)
			}
		}
	}
	offering.Versions = sortedDescending(majors)
	for i, major := range offering.Versions {
		if i == 0 {
			offering.Labels[major] = "current"
			continue
		}
		if codename, ok := newest[major].LTS.(string); ok && codename != "" {
			offering.Labels[major] = "LTS " + codename
			continue
		}
		offering.Labels[major] = "supported"
	}
	return offering
}

func nodeSchedule() (map[string]nodeReleaseLine, error) {
	body, err := httpGet("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json")
	if err != nil {
		return nil, err
	}
	var schedule map[string]nodeReleaseLine
	if err := json.Unmarshal(body, &schedule); err != nil {
		return nil, err
	}
	return schedule, nil
}

// fetchNodeMajorReleases is the fallback when the schedule cannot be read: every major the
// project ever published, newest first.
func fetchNodeMajorReleases() []string {
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

// UpToDate says the newest version the host can install is already here. It is answered
// by the daemon rather than by comparing strings in the browser, because a Rust channel is
// a moving name: "stable" is 1.99.0 today and it has to be asked what it points at before
// calling it behind.
func upToDate(ctx context.Context, h *host.Host, name, latest string, installed []string) bool {
	if strings.TrimSpace(latest) == "" {
		return false
	}
	for _, version := range installed {
		if VersionMatches(version, latest) || VersionMatches(latest, version) {
			return true
		}
	}
	if name != "rust" {
		return false
	}
	for _, toolchain := range installed {
		if runtimesVersionPattern.MatchString(toolchain) {
			continue // already a version, and it did not match
		}
		out, err := h.Run(ctx, []string{"rustc", "+" + toolchain, "--version"})
		if err != nil {
			continue
		}
		if m := regexp.MustCompile(`(\d+\.\d+\.\d+)`).FindStringSubmatch(out); m != nil && VersionMatches(m[1], latest) {
			return true
		}
	}
	return false
}

// aptVersionedInstalled lists the versions of a package family that are installed, by
// asking each versioned binary apt creates (ruby3.2 --version, python3.15 --version). The
// plain name is one of them, not a second version.
func aptVersionedInstalled(ctx context.Context, h *host.Host, binary string, candidates []string) []string {
	found := map[string]bool{}
	for _, version := range candidates {
		out, err := h.Run(ctx, []string{binary + version, "--version"})
		if err != nil {
			continue
		}
		if m := runtimesVersionPattern.FindStringSubmatch(out); m != nil {
			found[m[1]+"."+m[2]] = true
		}
	}
	if out, err := h.Run(ctx, []string{binary, "--version"}); err == nil {
		if m := runtimesVersionPattern.FindStringSubmatch(out); m != nil {
			found[m[1]+"."+m[2]] = true
		}
	}
	return sortedDescending(found)
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
		name := fields[0]
		// rustup says "no installed toolchains" when there are none, and that message is
		// not a toolchain: a real one carries a target triple (stable-x86_64-…) or is a
		// plain version.
		if !strings.Contains(name, "-") && !runtimesVersionPattern.MatchString(name) {
			continue
		}
		base := strings.SplitN(name, "-", 2)[0]
		if runtimesVersionPattern.MatchString(base) {
			set[base] = true
			continue
		}
		channels[base] = true
	}
	// Channels first (newest-first doesn't apply to a name), then the versions.
	return append(sortedDescending(channels), sortedDescending(set)...)
}

// primaryVersions is the short list the screen draws first: what a host would sensibly
// install today. Available still carries everything, so nothing is hidden — PHP in
// particular keeps its whole list, because its sites pick a version most often and every
// Sury line is a real choice.
func primaryVersions(name string, available []string) []string {
	switch name {
	case "php":
		return available
	case "node":
		// The vendor's schedule already answers with Current plus the LTS lines still in
		// support, so that list is short by construction.
		return available
	case "rust":
		// Rust is chosen by channel; the numbered releases stay behind the disclosure.
		var channels []string
		for _, version := range available {
			if !runtimesVersionPattern.MatchString(version) {
				channels = append(channels, version)
			}
		}
		return channels
	}
	keep := 0
	switch name {
	case "go":
		keep = 3 // Go supports the two older majors beside the current one
	case "python":
		keep = 4 // the lines still receiving fixes, newest first
	case "ruby":
		// ruby-build lists every patch of every line, so four entries would all be 4.0.x.
		// A person chooses a line; the newest patch of each of the four newest lines is
		// what to offer.
		return newestPerLine(available, 4)
	}
	if keep == 0 || len(available) <= keep {
		return available
	}
	return available[:keep]
}

// newestPerLine keeps the newest patch (or minor) of each of the newest lines, so a list
// of patch releases does not bury the choice between lines.
func newestPerLine(available []string, keep int) []string {
	out := make([]string, 0, keep)
	seen := map[string]bool{}
	for _, version := range available {
		fields := strings.Split(version, ".")
		line := version
		if len(fields) >= 2 {
			line = fields[0] + "." + fields[1]
		}
		if seen[line] {
			continue
		}
		seen[line] = true
		out = append(out, version)
		if len(out) == keep {
			break
		}
	}
	return out
}

// newestOf picks the newest version from a list that may mix channels with versions:
// rustup publishes stable/beta/nightly beside release numbers, and the number is what a
// person means by "the latest". A channel is the answer only when there is no number.
func newestOf(list []string) string {
	newest := ""
	for _, version := range list {
		if !runtimesVersionPattern.MatchString(version) {
			continue
		}
		if newest == "" || compareVersions(version, newest) > 0 {
			newest = version
		}
	}
	if newest != "" {
		return newest
	}
	for _, version := range list {
		if version != "" {
			return version
		}
	}
	return ""
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

// engineVersion reads the engine's version and nothing else. Caddy writes a JSON warning
// when it cannot find a configuration directory ("neither $XDG_CONFIG_HOME nor $HOME are
// defined"), it lands in the same output, and taking the whole line put a log entry on the
// screen where a version belongs. HOME is set so it does not warn at all, and the version
// is picked out by shape either way.
func engineVersion(ctx context.Context, h *host.Host, engine string) string {
	command := "HOME=${HOME:-/root} nginx -v"
	switch engine {
	case webserver.Caddy:
		command = "HOME=${HOME:-/root} caddy version"
	case "apache":
		command = "HOME=${HOME:-/root} apache2 -v 2>&1 | head -1"
	case "openlitespeed":
		command = "HOME=${HOME:-/root} /usr/local/lsws/bin/lshttpd -v 2>&1 | head -1 || openlitespeed -v"
	}
	out, err := h.Run(ctx, []string{"bash", "-c", command + " 2>&1"})
	if err != nil {
		return ""
	}
	if m := versionToken.FindString(out); m != "" {
		return m
	}
	return ""
}

// versionToken is a version as a person writes it: v1.2.3, 1.2.3, 1.2.
var versionToken = regexp.MustCompile(`v?\d+(\.\d+)+`)

// phpVersions lists the PHP versions this host has. The scan lives with the extensions,
// which is the other thing the host answers per version.
func phpVersions() []string { return phpext.InstalledVersions() }
