// Package webserver renders and installs the virtual host that puts a website on
// its domain. Two engines are implemented — nginx and Caddy — and the choice is a
// host-level one (one engine owns :80 at a time), so every entry point takes the
// engine's name.
package webserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/phpfpm"
)

// The 4 web server engines managed by BarePod Panel:
// Edge Ingress (nginx, caddy) and backend/proxy engines (apache, openlitespeed).
const (
	Nginx         = "nginx"
	Caddy         = "caddy"
	Apache        = "apache"
	OpenLiteSpeed = "openlitespeed"
)

// Supported reports whether this engine is supported.
func Supported(engine string) bool {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Nginx, Caddy, Apache, OpenLiteSpeed:
		return true
	}
	return false
}

// DefaultEngine is used when nothing has been chosen yet.
const DefaultEngine = Nginx

// WebUser is the account the engine runs as on Debian/Ubuntu.
func WebUser(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		return "caddy"
	case OpenLiteSpeed:
		return "nobody"
	default:
		return host.DefaultWebUser
	}
}

// VhostsDir default per engine (empty config falls back here).
func defaultVhostsDir(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		return "/etc/caddy/sites"
	case Apache:
		return "/etc/apache2/sites-enabled"
	case OpenLiteSpeed:
		return "/usr/local/lsws/conf/vhosts"
	default:
		return host.DefaultVhostsDir
	}
}

// Available reports whether the engine is installed, using the caller's LookPath so
// the answer does not depend on the machine (the daemon injects its own).
func Available(engine string, lookPath func(string) (string, error)) bool {
	if strings.EqualFold(engine, OpenLiteSpeed) {
		if _, err := os.Stat("/usr/local/lsws/bin/openlitespeed"); err == nil {
			return true
		}
	}
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	_, err := lookPath(engineBinary(engine))
	return err == nil
}

func engineBinary(engine string) string {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		return "caddy"
	case Apache:
		return "apache2"
	case OpenLiteSpeed:
		return "openlitespeed"
	default:
		return "nginx"
	}
}

// InstallHint is what to tell the operator when the engine is missing.
func InstallHint(engine string) string {
	return "install it first: apt-get install -y " + engineBinary(engine)
}

// Spec describes one website's vhost.
type Spec struct {
	Slug    string
	Domain  string
	Kind    string // php | static | proxy | nodejs | python | go | ruby | rust
	DocRoot string // the directory nginx serves (or hands to PHP)
	Socket  string // php-fpm unix socket, when Kind is php
	Port    int    // the site's own port, for everything but php and static
}

// FileName is the panel-owned vhost file for a site (prefixed so it cannot collide
// with the operator's own vhosts).
func FileName(engine, slug string) string {
	if strings.EqualFold(engine, Caddy) {
		return "barepod-" + slug + ".caddy"
	}
	return "barepod-" + slug + ".conf"
}

// Path is the vhost path for a site under dir.
func Path(engine, dir, slug string) string {
	return filepath.Join(dir, FileName(engine, slug))
}

// SpecFor assembles a site's vhost spec from its stored facts. Laravel and Symfony
// serve from public/; a PHP site's socket lives inside its directory (so it is
// removed with the site and inherits the web-readable group).
func SpecFor(slug, domain, kind, siteDir string, port int) Spec {
	docRoot := siteDir
	if info, err := os.Stat(filepath.Join(siteDir, "public")); err == nil && info.IsDir() {
		docRoot = filepath.Join(siteDir, "public")
	}
	s := Spec{Slug: slug, Domain: domain, Kind: kind, DocRoot: docRoot, Port: port}
	if kind == "php" {
		s.Socket = phpfpm.SocketIn(siteDir)
	}
	return s
}

// Render dispatches to the engine's renderer.
func Render(engine string, s Spec) (string, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Nginx, "":
		return nginxVhost(s), nil
	case Caddy:
		return caddyVhost(s), nil
	case Apache:
		return apacheVhost(s), nil
	case OpenLiteSpeed:
		return openlitespeedVhost(s), nil
	}
	return "", fmt.Errorf("webserver: %s is not supported yet", engine)
}

// Default renders the catch-all for an engine.
func DefaultVhost(engine string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Nginx, "":
		return `# Managed by BarePod Panel — the catch-all site (barepod-default.conf).
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 404 "Nothing is hosted here yet.\n";
}
`, nil
	case Caddy:
		return `# Managed by BarePod Panel — the catch-all site (barepod-default.caddy).
:80 {
    respond "Nothing is hosted here yet." 404
}
`, nil
	case Apache:
		return `# Managed by BarePod Panel — the catch-all site (barepod-default.conf).
<VirtualHost 127.0.0.1:8080>
    ServerName default
    ServerAlias *
    DocumentRoot /var/www/html
    <Location />
        Require all granted
    </Location>
</VirtualHost>
`, nil
	case OpenLiteSpeed:
		return `# Managed by BarePod Panel — the catch-all site (barepod-default.conf).
docRoot /var/www/html
`, nil
	}
	return "", fmt.Errorf("webserver: no catch-all for %s", engine)
}

// --- nginx ---

func nginxVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Nginx, s.Slug) + ").\n")
	b.WriteString("server {\n")
	b.WriteString("    listen 80;\n")
	b.WriteString("    listen [::]:80;\n")
	fmt.Fprintf(&b, "    server_name %s;\n", s.Domain)
	b.WriteString("\n")
	fmt.Fprintf(&b, "    access_log /var/log/nginx/barepod-%s.access.log;\n", s.Slug)
	fmt.Fprintf(&b, "    error_log  /var/log/nginx/barepod-%s.error.log;\n", s.Slug)
	b.WriteString("\n")

	switch s.Kind {
	case "php":
		fmt.Fprintf(&b, "    root %s;\n", s.DocRoot)
		b.WriteString("    index index.php index.html index.htm;\n\n")
		b.WriteString("    location / {\n")
		b.WriteString("        try_files $uri $uri/ /index.php?$query_string;\n")
		b.WriteString("    }\n\n")
		b.WriteString("    location ~ \\.php$ {\n")
		b.WriteString("        include fastcgi_params;\n")
		fmt.Fprintf(&b, "        fastcgi_pass unix:%s;\n", s.Socket)
		b.WriteString("        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n")
		b.WriteString("        fastcgi_param DOCUMENT_ROOT $document_root;\n")
		b.WriteString("    }\n")
	case "static":
		fmt.Fprintf(&b, "    root %s;\n", s.DocRoot)
		b.WriteString("    index index.html index.htm;\n\n")
		b.WriteString("    location / {\n")
		b.WriteString("        try_files $uri $uri/ =404;\n")
		b.WriteString("    }\n")
	default:
		b.WriteString("    location / {\n")
		fmt.Fprintf(&b, "        proxy_pass http://127.0.0.1:%d;\n", s.Port)
		b.WriteString("        proxy_http_version 1.1;\n")
		b.WriteString("        proxy_set_header Host $host;\n")
		b.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
		b.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
		b.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
		b.WriteString("        proxy_set_header Upgrade $http_upgrade;\n")
		b.WriteString("        proxy_set_header Connection \"upgrade\";\n")
		b.WriteString("    }\n")
	}

	b.WriteString("\n    location ~ /\\.(?!well-known) {\n        deny all;\n    }\n")
	b.WriteString("}\n")
	return b.String()
}

// --- Caddy ---

func caddyVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Caddy, s.Slug) + ").\n")
	// :80 explicitly: the panel serves HTTP first and owns no certificates yet, so a
	// site must not send Caddy off to obtain one (that lands with the TLS phase).
	fmt.Fprintf(&b, "%s:80 {\n", s.Domain)
	switch s.Kind {
	case "php":
		fmt.Fprintf(&b, "\troot * %s\n", s.DocRoot)
		fmt.Fprintf(&b, "\tphp_fastcgi unix/%s\n", s.Socket)
		b.WriteString("\tfile_server\n")
	case "static":
		fmt.Fprintf(&b, "\troot * %s\n", s.DocRoot)
		b.WriteString("\tfile_server\n")
	default:
		fmt.Fprintf(&b, "\treverse_proxy 127.0.0.1:%d\n", s.Port)
	}
	b.WriteString("}\n")
	return b.String()
}

// --- Apache ---

func apacheVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Apache, s.Slug) + ").\n")
	b.WriteString("<VirtualHost 127.0.0.1:8080>\n")
	fmt.Fprintf(&b, "    ServerName %s\n", s.Domain)
	if s.DocRoot != "" {
		fmt.Fprintf(&b, "    DocumentRoot %s\n", s.DocRoot)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "    CustomLog /var/log/apache2/barepod-%s.access.log combined\n", s.Slug)
	fmt.Fprintf(&b, "    ErrorLog  /var/log/apache2/barepod-%s.error.log\n\n", s.Slug)

	if s.DocRoot != "" {
		fmt.Fprintf(&b, "    <Directory %s>\n", s.DocRoot)
		b.WriteString("        Options -Indexes +FollowSymLinks\n")
		b.WriteString("        AllowOverride All\n")
		b.WriteString("        Require all granted\n")
		b.WriteString("    </Directory>\n\n")
	}

	switch s.Kind {
	case "php":
		b.WriteString("    <FilesMatch \\.php$>\n")
		fmt.Fprintf(&b, "        SetHandler \"proxy:unix:%s|fcgi://localhost\"\n", s.Socket)
		b.WriteString("    </FilesMatch>\n")
	case "static":
		b.WriteString("    DirectoryIndex index.html index.htm\n")
	default:
		b.WriteString("    ProxyPreserveHost On\n")
		b.WriteString("    ProxyRequests Off\n")
		fmt.Fprintf(&b, "    ProxyPass / http://127.0.0.1:%d/\n", s.Port)
		fmt.Fprintf(&b, "    ProxyPassReverse / http://127.0.0.1:%d/\n", s.Port)
	}

	b.WriteString("</VirtualHost>\n")
	return b.String()
}

// --- OpenLiteSpeed ---

func openlitespeedVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(OpenLiteSpeed, s.Slug) + ").\n")
	fmt.Fprintf(&b, "docRoot                   %s\n", s.DocRoot)
	b.WriteString("enableGzip                1\n\n")

	switch s.Kind {
	case "php":
		b.WriteString("extprocessor phpfpm {\n")
		b.WriteString("    type                    fcgi\n")
		fmt.Fprintf(&b, "    address                 unix:%s\n", s.Socket)
		b.WriteString("    maxConns                20\n")
		b.WriteString("    initTimeout             60\n")
		b.WriteString("    retryTimeout            0\n")
		b.WriteString("}\n")
	case "static":
		b.WriteString("indexFiles                index.html, index.htm\n")
	default:
		fmt.Fprintf(&b, "extprocessor %s_proxy {\n", s.Slug)
		b.WriteString("    type                    proxy\n")
		fmt.Fprintf(&b, "    address                 127.0.0.1:%d\n", s.Port)
		b.WriteString("    maxConns                200\n")
		b.WriteString("    initTimeout             60\n")
		b.WriteString("    retryTimeout            0\n")
		b.WriteString("}\n\n")
		b.WriteString("context / {\n")
		b.WriteString("    type                    proxy\n")
		fmt.Fprintf(&b, "    handler                 %s_proxy\n", s.Slug)
		b.WriteString("    addDefaultCharset       off\n")
		b.WriteString("}\n")
	}

	return b.String()
}

// --- writing / validating / reloading ---

// Write writes a site's vhost atomically. It is root-owned (the engine reads it as
// root), unlike a site's own files.
func Write(engine, dir string, s Spec) (string, error) {
	body, err := Render(engine, s)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(s.Domain) == "" {
		return "", fmt.Errorf("webserver: a domain is required for a vhost")
	}
	if s.Kind == "php" && strings.TrimSpace(s.Socket) == "" {
		return "", fmt.Errorf("webserver: a php site needs a php-fpm socket")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	path := Path(engine, dir, s.Slug)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return "", fmt.Errorf("webserver: write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	return path, nil
}

// Remove deletes a site's vhost.
func Remove(engine, dir, slug string) error {
	if err := os.Remove(Path(engine, dir, slug)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// WriteDefault writes the catch-all vhost for the engine.
func WriteDefault(engine, dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	// Ubuntu ships sites-enabled/default claiming default_server; leaving it in place
	// made `nginx -t` fail with "a duplicate default server". It is moved aside, kept,
	// and hidden with a leading dot so `include sites-enabled/*` no longer reads it.
	if strings.EqualFold(engine, Nginx) || engine == "" {
		stock := filepath.Join(dir, "default")
		if _, err := os.Lstat(stock); err == nil {
			if err := os.Rename(stock, filepath.Join(dir, ".default.barepod-disabled")); err != nil {
				return "", fmt.Errorf("webserver: move the stock default vhost aside: %w", err)
			}
		}
	}
	if strings.EqualFold(engine, Caddy) {
		if err := writeCaddyConfig(filepath.Join(filepath.Dir(dir), "Caddyfile"), dir); err != nil {
			return "", err
		}
	}
	body, err := DefaultVhost(engine)
	if err != nil {
		return "", err
	}
	path := Path(engine, dir, "default")
	if _, err := os.Stat(path); err == nil {
		return path, nil // never overwrite one the operator may have edited
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(body), 0o644); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

// caddyHeader marks the panel-owned Caddyfile.
const caddyHeader = "# Managed by BarePod Panel — do not edit by hand. The distro's own Caddyfile,\n" +
	"# which also defines a :80 site, is kept beside this file as Caddyfile.barepod-bak.\n"

// writeCaddyConfig takes the Caddyfile over: the distribution's stock config already
// defines a `:80` site, and two of them make Caddy refuse the whole file with
// "ambiguous site definition: :80". The operator's file is kept as a backup.
func writeCaddyConfig(caddyfile, sitesDir string) error {
	if err := os.MkdirAll(filepath.Dir(caddyfile), 0o755); err != nil {
		return err
	}
	want := caddyHeader + "import " + filepath.Join(sitesDir, "*.caddy") + "\n"
	current, err := os.ReadFile(caddyfile)
	if err == nil && string(current) == want {
		return nil // already ours
	}
	if err == nil {
		backup := caddyfile + ".barepod-bak"
		if _, statErr := os.Stat(backup); os.IsNotExist(statErr) {
			if writeErr := os.WriteFile(backup, current, 0o644); writeErr != nil {
				return writeErr
			}
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(caddyfile, []byte(want), 0o644)
}

// Test validates the engine's whole configuration.
func Test(ctx context.Context, engine string, h *host.Host) error {
	var argv []string
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		argv = []string{"caddy", "validate", "--config", filepath.Join(h.CaddyDir(), "Caddyfile")}
	case Apache:
		argv = []string{"apache2ctl", "configtest"}
	case OpenLiteSpeed:
		argv = []string{"/usr/local/lsws/bin/openlitespeed", "-t"}
	default:
		argv = []string{"nginx", "-t"}
	}
	out, err := h.Run(ctx, argv)
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("%s is not installed — %s", engine, InstallHint(engine))
	}
	return fmt.Errorf("%s rejected the configuration: %s", argv[0], strings.TrimSpace(out))
}

// Reload asks the engine to load the new configuration without dropping connections.
func Reload(ctx context.Context, engine string, h *host.Host) error {
	service := "nginx"
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		service = "caddy"
	case Apache:
		service = "apache2"
	case OpenLiteSpeed:
		service = "lshttpd"
	}
	out, err := h.Run(ctx, []string{"systemctl", "reload", service})
	if err != nil {
		return fmt.Errorf("systemctl reload %s failed: %s", service, strings.TrimSpace(out))
	}
	return nil
}

// Apply writes a site's vhost, validates the whole configuration, and rolls the file
// back if validation fails — a panel-written config must never leave the engine
// unable to start. On success it reloads.
func Apply(ctx context.Context, engine, dir string, h *host.Host, s Spec) (string, error) {
	path := Path(engine, dir, s.Slug)
	previous, readErr := os.ReadFile(path)

	if _, err := Write(engine, dir, s); err != nil {
		return "", err
	}
	if err := Test(ctx, engine, h); err != nil {
		if readErr == nil {
			_ = os.WriteFile(path, previous, 0o644)
		} else {
			_ = os.Remove(path)
		}
		return "", err
	}
	if err := Reload(ctx, engine, h); err != nil {
		return "", err
	}
	return path, nil
}

// GrantRead lets the web server's user serve a site without widening the tenant's own
// access: the site directory becomes group-readable by that user, with the setgid bit
// so files the tenant creates later inherit the group too. The tenant home and its
// apps directory are only made *traversable* — the engine can reach the site but
// cannot list a sibling's contents.
func GrantRead(ctx context.Context, h *host.Host, home, siteDir, webUser string) error {
	if webUser == "" {
		webUser = h.EffectiveWebUser()
	}
	run := func(argv ...string) error {
		out, err := h.Run(ctx, argv)
		if err != nil {
			return fmt.Errorf("webserver: %s: %w (%s)", argv[0], err, strings.TrimSpace(out))
		}
		return nil
	}
	if err := run("chmod", "o+x", home, filepath.Join(home, "apps")); err != nil {
		return err
	}
	if err := run("chgrp", "-R", webUser, siteDir); err != nil {
		return err
	}
	// Explicit modes rather than chmod's X: a directory needs group *search* to be
	// traversed and a file group *read* to be served, and the setgid bit on the
	// directories makes files the tenant creates later inherit the group.
	if err := run("find", siteDir, "-type", "d", "-exec", "chmod", "g+rx", "{}", "+"); err != nil {
		return err
	}
	if err := run("find", siteDir, "-type", "f", "-exec", "chmod", "g+r", "{}", "+"); err != nil {
		return err
	}
	return run("find", siteDir, "-type", "d", "-exec", "chmod", "g+s", "{}", "+")
}
