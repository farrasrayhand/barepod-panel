// Package validate contains the input rules shared by the API handlers.
package validate

import (
	"regexp"
	"strings"
)

var (
	slugRe   = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`)
	labelRe  = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)
	tenantRe = regexp.MustCompile(`^[a-z_][a-z0-9_-]{0,31}$`)
)

// Slug accepts lowercase alphanumerics and inner dashes (2–40 chars).
func Slug(s string) bool {
	return len(s) >= 2 && len(s) <= 40 && slugRe.MatchString(s)
}

// FQDN validates a fully-qualified domain name: at least two labels, no
// underscores, and a TLD of two or more letters.
func FQDN(s string) bool {
	s = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(s, ".")))
	if len(s) < 4 || len(s) > 253 || strings.ContainsAny(s, " /:@") {
		return false
	}
	parts := strings.Split(s, ".")
	if len(parts) < 2 {
		return false
	}
	for _, p := range parts {
		if !labelRe.MatchString(p) {
			return false
		}
	}
	tld := parts[len(parts)-1]
	if len(tld) < 2 {
		return false
	}
	for _, r := range tld {
		if r < 'a' || r > 'z' {
			return false
		}
	}
	return true
}

// TenantUser validates a Linux account name usable for a tenant.
func TenantUser(s string) bool { return tenantRe.MatchString(s) }

var runtimes = map[string]bool{
	"php": true, "nodejs": true, "python": true, "go": true,
	"ruby": true, "rust": true, "static": true,
	// A reverse-proxy-only site has no runtime of its own: it forwards to an
	// upstream. It is a valid site type, but it has no shell, docroot or build.
	"proxy": true,
}

// Runtime reports whether a runtime name is supported.
func Runtime(s string) bool { return runtimes[strings.ToLower(s)] }

// Versionless reports whether a site type has no runtime version to choose: a static
// site is files served by the web server, and a reverse proxy forwards to an upstream.
func Versionless(runtime string) bool {
	switch strings.ToLower(runtime) {
	case "static", "proxy":
		return true
	}
	return false
}

// HasRuntime reports whether a site type runs a process of its own. A reverse
// proxy does not, so shell/file/CI endpoints must refuse it.
func HasRuntime(runtime string) bool {
	switch strings.ToLower(runtime) {
	case "proxy", "":
		return false
	}
	return true
}

var webServers = map[string]bool{
	"openlitespeed": true, "nginx": true, "caddy": true, "apache": true,
}

// WebServer reports whether a web server engine is supported.
func WebServer(s string) bool { return webServers[strings.ToLower(s)] }

var engines = map[string]bool{
	"postgres": true, "postgresql": true, "mysql": true, "mariadb": true,
	"mongodb": true, "redis": true, "sqlite": true,
}

// Engine reports whether a database/cache engine is supported.
func Engine(s string) bool { return engines[strings.ToLower(s)] }

// SourceKind reports whether a deployment source is supported.
func SourceKind(s string) bool {
	switch strings.ToLower(s) {
	// "default" has no code behind it: the panel writes one placeholder page, so a
	// website can exist before its application does.
	case "scaffold", "github", "upload", "existing", "default":
		return true
	}
	return false
}
