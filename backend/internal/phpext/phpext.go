// Package phpext reports what PHP extensions this host really has, per version: the ones
// its packages installed (the mods-available entries, which is exactly what phpenmod and
// phpdismod act on), which of them are switched on (the conf.d symlink the same tools
// create), and what the repositories still offer that is not installed here. Nothing is
// kept in code, so the screen shows the host's condition rather than a catalog's.
package phpext

import (
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// Extension is one extension as this host has it.
type Extension struct {
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}

// Report is the whole answer for one PHP version.
type Report struct {
	Version     string      `json:"version"`
	Extensions  []Extension `json:"extensions"`
	Installable []string    `json:"installable"`
}

var (
	versionPattern = regexp.MustCompile(`^\d+\.\d+$`)
	namePattern    = regexp.MustCompile(`^[a-z0-9_]+$`)
)

// notExtensions are packages that carry the interpreter itself rather than an extension.
var notExtensions = map[string]bool{
	"fpm": true, "cli": true, "common": true, "dev": true, "dbg": true, "phpdbg": true,
	"cgi": true, "pear": true, "apache2": true,
	"mysql": true, // a metapackage: the real modules are mysqli, pdo_mysql and mysqlnd
}

// List reads the host: the mods-available directory is the set of extensions that can be
// toggled, the fpm conf.d directory is the set that is on, and the repository's package
// list says what could still be installed.
func List(ctx context.Context, h *host.Host, version string) (Report, error) {
	version = strings.TrimSpace(version)
	if !versionPattern.MatchString(version) {
		return Report{}, fmt.Errorf("phpext: %q is not a PHP version", version)
	}
	report := Report{Version: version, Extensions: []Extension{}, Installable: []string{}}
	if !h.Materialises() {
		return report, nil // a dry-run host has no PHP to report on
	}

	modsDir := "/etc/php/" + version + "/mods-available"
	mods, _ := h.Run(ctx, []string{"bash", "-c", "ls " + modsDir + "/*.ini 2>/dev/null"})
	confd, _ := h.Run(ctx, []string{"bash", "-c", "ls /etc/php/" + version + "/fpm/conf.d/ 2>/dev/null"})

	on := map[string]bool{}
	for _, line := range strings.Split(confd, "\n") {
		if name := iniName(line); name != "" {
			on[name] = true
		}
	}
	have := map[string]bool{}
	for _, line := range strings.Split(mods, "\n") {
		name := iniName(line)
		if name == "" {
			continue
		}
		have[name] = true
		report.Extensions = append(report.Extensions, Extension{Name: name, Enabled: on[name]})
	}
	sort.Slice(report.Extensions, func(i, j int) bool { return report.Extensions[i].Name < report.Extensions[j].Name })

	installed := installedPackages(ctx, h, version)
	available, _ := h.Run(ctx, []string{"bash", "-c",
		"apt-cache search --names-only '^php" + version + "-[a-z0-9]+$' | awk '{print $1}'"})
	for _, pkg := range strings.Split(available, "\n") {
		pkg = strings.TrimSpace(pkg)
		prefix := "php" + version + "-"
		if !strings.HasPrefix(pkg, prefix) || installed[pkg] {
			continue
		}
		extension := strings.TrimPrefix(pkg, prefix)
		// A package whose name is also a mod this host already has adds nothing new: xsl,
		// for one, arrives with php-xml.
		if notExtensions[extension] || have[extension] {
			continue
		}
		report.Installable = append(report.Installable, extension)
	}
	sort.Strings(report.Installable)
	return report, nil
}

// Set switches one extension on or off for a version, exactly as an administrator would
// from a shell: phpenmod (or phpdismod), then a reload so the pools pick it up. The name
// must be one this host actually has, so a client cannot ask for an arbitrary one.
func Set(ctx context.Context, h *host.Host, version, name string, enabled bool) error {
	version = strings.TrimSpace(version)
	name = strings.TrimSpace(strings.ToLower(name))
	if !versionPattern.MatchString(version) || !namePattern.MatchString(name) {
		return fmt.Errorf("phpext: %q is not a PHP extension name", name)
	}
	report, err := List(ctx, h, version)
	if err != nil {
		return err
	}
	var found bool
	for _, extension := range report.Extensions {
		if extension.Name == name {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("phpext: this host has no %s extension for PHP %s", name, version)
	}
	if !h.Materialises() {
		return nil
	}
	verb := "phpenmod"
	if !enabled {
		verb = "phpdismod"
	}
	// phpenmod exits non-zero when nothing changes, so only a failed *make-nothing-change*
	// is fine; the reload is what makes it take effect for the running pools.
	script := "set -e\n" + verb + " -v " + version + " -s fpm " + name +
		" || " + verb + " -v " + version + " " + name +
		"\nsystemctl reload php" + version + "-fpm 2>/dev/null || true"
	_, err = h.Run(ctx, []string{"bash", "-c", script})
	return err
}

// InstalledVersions lists the PHP versions this host has: a distro package is visible
// both as its fpm binary and as /etc/php/<version>, and either one is enough.
func InstalledVersions() []string {
	found := map[string]bool{}
	for _, pattern := range []string{"/usr/sbin/php-fpm*", "/usr/bin/php-fpm*"} {
		matches, _ := filepath.Glob(pattern)
		for _, m := range matches {
			if name := strings.TrimPrefix(filepath.Base(m), "php-fpm"); name != "" {
				found[name] = true
			}
		}
	}
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

// iniName turns "/etc/php/8.3/mods-available/curl.ini" or "20-curl.ini" into "curl".
func iniName(line string) string {
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	name := strings.TrimSuffix(path.Base(line), ".ini")
	if i := strings.Index(name, "-"); i >= 0 && isDigits(name[:i]) {
		name = name[i+1:]
	}
	if !namePattern.MatchString(name) {
		return ""
	}
	return name
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func installedPackages(ctx context.Context, h *host.Host, version string) map[string]bool {
	out, err := h.Run(ctx, []string{"bash", "-c",
		"dpkg-query -W -f='${db:Status-Status} ${binary:Package}\\n' 'php" + version + "-*' 2>/dev/null"})
	installed := map[string]bool{}
	if err != nil {
		return installed
	}
	for _, line := range strings.Split(out, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[0] == "installed" {
			installed[fields[1]] = true
		}
	}
	return installed
}
