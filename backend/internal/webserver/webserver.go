// Package webserver renders and installs the virtual host that puts a website on
// its domain. nginx is the engine implemented today; the others (openlitespeed,
// caddy, apache) are still refused by name rather than silently ignored.
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

// Name is the engine this package implements today.
const Name = "nginx"

// DefaultVhostsDir is where Debian/Ubuntu nginx already includes *.conf from, so a
// panel vhost needs no edit to nginx.conf itself.
const DefaultVhostsDir = host.DefaultVhostsDir

// Spec describes one website's vhost.
type Spec struct {
	Slug    string
	Domain  string
	Kind    string // php | static | proxy | nodejs | python | go | ruby | rust
	DocRoot string // the directory nginx serves (or hands to PHP)
	Socket  string // php-fpm unix socket, when Kind is php
	Port    int    // the site's own port, for everything but php and static
}

// Supported reports whether this engine can be generated today.
func Supported(engine string) bool { return strings.EqualFold(strings.TrimSpace(engine), Name) }

// Available reports whether nginx is installed, using the caller's LookPath so the
// answer does not depend on the machine (the daemon injects its own).
func Available(lookPath func(string) (string, error)) bool {
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	_, err := lookPath("nginx")
	return err == nil
}

// InstallHint is what to tell the operator when nginx is missing.
const InstallHint = "install it first: apt-get install -y nginx"

// FileName is the panel-owned vhost file for a site (prefixed so it cannot collide
// with the operator's own vhosts).
func FileName(slug string) string { return "barepod-" + slug + ".conf" }

// Path is the vhost path for a site under vhostsDir.
func Path(vhostsDir, slug string) string { return filepath.Join(vhostsDir, FileName(slug)) }

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

// Nginx renders the server block for a site.
func Nginx(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(s.Slug) + ").\n")
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
		// Everything that runs its own process is reached through its port. The
		// upgrade headers are set so a WebSocket app works through the vhost too.
		fmt.Fprintf(&b, "    location / {\n")
		fmt.Fprintf(&b, "        proxy_pass http://127.0.0.1:%d;\n", s.Port)
		b.WriteString("        proxy_http_version 1.1;\n")
		b.WriteString("        proxy_set_header Host $host;\n")
		b.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
		b.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
		b.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
		b.WriteString("        proxy_set_header Upgrade $http_upgrade;\n")
		b.WriteString("        proxy_set_header Connection \"upgrade\";\n")
		fmt.Fprintf(&b, "    }\n")
	}

	b.WriteString("\n    location ~ /\\.(?!well-known) {\n        deny all;\n    }\n")
	b.WriteString("}\n")
	return b.String()
}

// Default renders the catch-all vhost, so the port still answers "nothing is hosted
// here" once nginx owns it (the panel's own status page steps aside).
func Default() string {
	return `# Managed by BarePod Panel — the catch-all site (barepod-default.conf).
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 404 "Nothing is hosted here yet.\n";
}
`
}

// Write writes a site's vhost atomically. It is root-owned (nginx reads it as root),
// unlike a site's own files.
func Write(vhostsDir string, s Spec) (string, error) {
	if strings.TrimSpace(s.Domain) == "" {
		return "", fmt.Errorf("webserver: a domain is required for a vhost")
	}
	if s.Kind == "php" && strings.TrimSpace(s.Socket) == "" {
		return "", fmt.Errorf("webserver: a php site needs a php-fpm socket")
	}
	if err := os.MkdirAll(vhostsDir, 0o755); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	path := Path(vhostsDir, s.Slug)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(Nginx(s)), 0o644); err != nil {
		return "", fmt.Errorf("webserver: write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	return path, nil
}

// WriteDefault writes the catch-all vhost.
func WriteDefault(vhostsDir string) (string, error) {
	if err := os.MkdirAll(vhostsDir, 0o755); err != nil {
		return "", fmt.Errorf("webserver: %w", err)
	}
	// The distribution's stock "default" vhost also claims default_server on :80, and
	// nginx refuses to load that twice. It is moved aside — kept, not deleted, and
	// hidden with a leading dot so `include sites-enabled/*` no longer reads it — so
	// the panel's own catch-all can answer the port.
	stock := filepath.Join(vhostsDir, "default")
	if _, err := os.Lstat(stock); err == nil {
		if err := os.Rename(stock, filepath.Join(vhostsDir, ".default.barepod-disabled")); err != nil {
			return "", fmt.Errorf("webserver: move the stock default vhost aside: %w", err)
		}
	}
	path := filepath.Join(vhostsDir, "barepod-default.conf")
	if _, err := os.Stat(path); err == nil {
		return path, nil // never overwrite one the operator may have edited
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(Default()), 0o644); err != nil {
		return "", err
	}
	return path, os.Rename(tmp, path)
}

// Remove deletes a site's vhost.
func Remove(vhostsDir, slug string) error {
	if err := os.Remove(Path(vhostsDir, slug)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// GrantRead lets the web server's user serve a site without widening the tenant's own
// access: the site directory becomes group-readable by that user, with the setgid bit
// so files the tenant creates later inherit the group too. The tenant home and its
// apps directory are only made *traversable* — nginx can reach the site but cannot
// list a sibling's contents.
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

// Test validates the whole nginx configuration (`nginx -t`).
func Test(ctx context.Context, h *host.Host) error {
	out, err := h.Run(ctx, []string{"nginx", "-t"})
	if err == nil {
		return nil
	}
	if errors.Is(err, exec.ErrNotFound) {
		return fmt.Errorf("nginx is not installed — %s", InstallHint)
	}
	return fmt.Errorf("nginx -t rejected the configuration: %s", strings.TrimSpace(out))
}

// Reload asks nginx to load the new configuration without dropping connections.
func Reload(ctx context.Context, h *host.Host) error {
	out, err := h.Run(ctx, []string{"nginx", "-s", "reload"})
	if err != nil {
		return fmt.Errorf("nginx -s reload failed: %s", strings.TrimSpace(out))
	}
	return nil
}

// Apply writes a site's vhost, validates the whole server, and rolls the file back
// if validation fails — a panel-written config must never leave nginx unable to
// start. On success it reloads.
func Apply(ctx context.Context, h *host.Host, vhostsDir string, s Spec) (string, error) {
	path := Path(vhostsDir, s.Slug)
	previous, hadPrevious := os.ReadFile(path)

	if _, err := Write(vhostsDir, s); err != nil {
		return "", err
	}
	if err := Test(ctx, h); err != nil {
		if hadPrevious == nil {
			_ = os.WriteFile(path, previous, 0o644)
		} else {
			_ = os.Remove(path)
		}
		return "", err
	}
	if err := Reload(ctx, h); err != nil {
		return "", err
	}
	return path, nil
}
