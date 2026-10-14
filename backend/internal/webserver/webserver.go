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
	Slug        string
	Domain      string
	Aliases     []string
	Kind        string // php | static | proxy | nodejs | python | go | ruby | rust
	DocRoot     string // the directory nginx serves (or hands to PHP)
	Socket      string // php-fpm unix socket, when Kind is php
	Port        int    // the site's own port, for everything but php and static
	SSLEnabled  bool
	SSLCertPath string
	SSLKeyPath  string
	ForceHTTPS  bool
	HSTS        bool
	Security    SecuritySpec
}

// SecuritySpec describes per-app access control, maintenance, basic auth, and rate limits.
type SecuritySpec struct {
	MaintenanceMode      bool
	MaintenanceTitle     string
	MaintenanceMessage   string
	MaintenanceBypassIPs []string
	BasicAuthEnabled     bool
	BasicAuthUser        string
	BasicAuthPassword    string // raw password for generating htpasswd
	BasicAuthHash        string // bcrypt hash for caddy
	BasicAuthFile        string // path to .htpasswd file for nginx/apache
	BasicAuthRealm       string
	BasicAuthBypassIPs   []string
	IPRestrictionMode    string // none | allowlist | denylist
	IPRestrictionList    []string
	RateLimitEnabled     bool
	RateLimitReqPerSec   int
	RateLimitBurst       int
}

// AllDomains returns the primary domain plus any unique non-empty aliases.
func (s Spec) AllDomains() []string {
	var out []string
	if d := strings.TrimSpace(s.Domain); d != "" {
		out = append(out, d)
	}
	for _, a := range s.Aliases {
		a = strings.TrimSpace(a)
		if a != "" && a != s.Domain {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		return []string{"_"}
	}
	return out
}

// ServerName returns all domains space-separated for server_name directives.
func (s Spec) ServerName() string {
	return strings.Join(s.AllDomains(), " ")
}

// WithSSL returns a copy of Spec configured with SSL and alias options.
func (s Spec) WithSSL(aliases []string, certPath, keyPath string, sslEnabled, forceHTTPS, hsts bool) Spec {
	s.Aliases = aliases
	s.SSLCertPath = certPath
	s.SSLKeyPath = keyPath
	s.SSLEnabled = sslEnabled
	s.ForceHTTPS = forceHTTPS
	s.HSTS = hsts
	return s
}

// WithSecurity returns a copy of Spec configured with security directives.
func (s Spec) WithSecurity(sec SecuritySpec) Spec {
	s.Security = sec
	return s
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

func nginxSecurityHeader(b *strings.Builder, s Spec) {
	slugSafe := sanitizeSlug(s.Slug)
	if s.Security.RateLimitEnabled {
		rate := s.Security.RateLimitReqPerSec
		if rate <= 0 {
			rate = 10
		}
		fmt.Fprintf(b, "limit_req_zone $binary_remote_addr zone=bp_rl_%s:10m rate=%dr/s;\n\n", slugSafe, rate)
	}
	if s.Security.MaintenanceMode && len(s.Security.MaintenanceBypassIPs) > 0 {
		fmt.Fprintf(b, "geo $bp_maint_bypass_%s {\n", slugSafe)
		b.WriteString("    default 1;\n")
		for _, ip := range s.Security.MaintenanceBypassIPs {
			if ip = strings.TrimSpace(ip); ip != "" {
				fmt.Fprintf(b, "    %s 0;\n", ip)
			}
		}
		b.WriteString("}\n\n")
	}
}

func nginxSecurityDirectives(b *strings.Builder, s Spec) {
	slugSafe := sanitizeSlug(s.Slug)
	if s.Security.RateLimitEnabled {
		burst := s.Security.RateLimitBurst
		if burst <= 0 {
			burst = 20
		}
		fmt.Fprintf(b, "    limit_req zone=bp_rl_%s burst=%d nodelay;\n", slugSafe, burst)
	}

	if s.Security.IPRestrictionMode == "allowlist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("\n    # IP Access Control (Allowlist)\n")
		for _, ip := range s.Security.IPRestrictionList {
			if ip = strings.TrimSpace(ip); ip != "" {
				fmt.Fprintf(b, "    allow %s;\n", ip)
			}
		}
		b.WriteString("    deny all;\n")
	} else if s.Security.IPRestrictionMode == "denylist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("\n    # IP Access Control (Denylist)\n")
		for _, ip := range s.Security.IPRestrictionList {
			if ip = strings.TrimSpace(ip); ip != "" {
				fmt.Fprintf(b, "    deny %s;\n", ip)
			}
		}
		b.WriteString("    allow all;\n")
	}

	if s.Security.BasicAuthEnabled && s.Security.BasicAuthFile != "" {
		realm := strings.TrimSpace(s.Security.BasicAuthRealm)
		if realm == "" {
			realm = "Restricted Area"
		}
		b.WriteString("\n    # HTTP Basic Authentication\n")
		fmt.Fprintf(b, "    auth_basic \"%s\";\n", realm)
		fmt.Fprintf(b, "    auth_basic_user_file %s;\n", s.Security.BasicAuthFile)
	}

	if s.Security.MaintenanceMode {
		b.WriteString("\n    # Maintenance Mode (HTTP 503)\n")
		b.WriteString("    error_page 503 /barepod_503.html;\n")
		fmt.Fprintf(b, "    location = /barepod_503.html {\n        root /var/lib/barepod/maintenance/%s;\n        internal;\n    }\n", slugSafe)
	}
}

func nginxTuningDirectives(b *strings.Builder, s Spec) {
	b.WriteString("    # Optimization & Buffer Tuning\n")
	b.WriteString("    client_max_body_size 128M;\n")
	b.WriteString("    client_body_buffer_size 128k;\n")
	b.WriteString("    sendfile on;\n")
	b.WriteString("    tcp_nopush on;\n")
	b.WriteString("    tcp_nodelay on;\n")
	b.WriteString("    keepalive_timeout 65;\n")
	b.WriteString("    open_file_cache max=10000 inactive=30s;\n")
	b.WriteString("    open_file_cache_valid 60s;\n")
	b.WriteString("    open_file_cache_min_uses 2;\n")
	b.WriteString("    open_file_cache_errors on;\n\n")

	b.WriteString("    # Gzip Compression\n")
	b.WriteString("    gzip on;\n")
	b.WriteString("    gzip_vary on;\n")
	b.WriteString("    gzip_proxied any;\n")
	b.WriteString("    gzip_comp_level 5;\n")
	b.WriteString("    gzip_min_length 256;\n")
	b.WriteString("    gzip_types text/plain text/css application/javascript application/json application/xml application/xml+rss text/javascript image/svg+xml;\n\n")

	b.WriteString("    # Security Headers\n")
	b.WriteString("    add_header X-Content-Type-Options \"nosniff\" always;\n")
	b.WriteString("    add_header X-Frame-Options \"SAMEORIGIN\" always;\n")
	b.WriteString("    add_header X-XSS-Protection \"1; mode=block\" always;\n")
	b.WriteString("    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;\n\n")
}

func nginxLocations(b *strings.Builder, s Spec) {
	slugSafe := sanitizeSlug(s.Slug)
	maintCheck := ""
	if s.Security.MaintenanceMode {
		if len(s.Security.MaintenanceBypassIPs) > 0 {
			maintCheck = fmt.Sprintf("        if ($bp_maint_bypass_%s) {\n            return 503;\n        }\n", slugSafe)
		} else {
			maintCheck = "        return 503;\n"
		}
	}

	switch s.Kind {
	case "php":
		fmt.Fprintf(b, "    root %s;\n", s.DocRoot)
		b.WriteString("    index index.php index.html index.htm;\n\n")
		b.WriteString("    location / {\n")
		if maintCheck != "" {
			b.WriteString(maintCheck)
		}
		b.WriteString("        try_files $uri $uri/ /index.php?$query_string;\n")
		b.WriteString("    }\n\n")
		b.WriteString("    location ~ \\.php$ {\n")
		if maintCheck != "" {
			b.WriteString(maintCheck)
		}
		b.WriteString("        include fastcgi_params;\n")
		fmt.Fprintf(b, "        fastcgi_pass unix:%s;\n", s.Socket)
		b.WriteString("        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;\n")
		b.WriteString("        fastcgi_param DOCUMENT_ROOT $document_root;\n")
		b.WriteString("        fastcgi_buffer_size 128k;\n")
		b.WriteString("        fastcgi_buffers 4 256k;\n")
		b.WriteString("        fastcgi_busy_buffers_size 256k;\n")
		b.WriteString("        fastcgi_temp_file_write_size 256k;\n")
		b.WriteString("        fastcgi_connect_timeout 60s;\n")
		b.WriteString("        fastcgi_send_timeout 180s;\n")
		b.WriteString("        fastcgi_read_timeout 180s;\n")
		b.WriteString("    }\n")
	case "static":
		fmt.Fprintf(b, "    root %s;\n", s.DocRoot)
		b.WriteString("    index index.html index.htm;\n\n")
		b.WriteString("    location / {\n")
		if maintCheck != "" {
			b.WriteString(maintCheck)
		}
		b.WriteString("        try_files $uri $uri/ =404;\n")
		b.WriteString("    }\n")
	default:
		b.WriteString("    location / {\n")
		if maintCheck != "" {
			b.WriteString(maintCheck)
		}
		fmt.Fprintf(b, "        proxy_pass http://127.0.0.1:%d;\n", s.Port)
		b.WriteString("        proxy_http_version 1.1;\n")
		b.WriteString("        proxy_set_header Host $host;\n")
		b.WriteString("        proxy_set_header X-Real-IP $remote_addr;\n")
		b.WriteString("        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n")
		b.WriteString("        proxy_set_header X-Forwarded-Proto $scheme;\n")
		b.WriteString("        proxy_set_header Upgrade $http_upgrade;\n")
		b.WriteString("        proxy_set_header Connection \"upgrade\";\n")
		b.WriteString("        proxy_buffer_size 128k;\n")
		b.WriteString("        proxy_buffers 4 256k;\n")
		b.WriteString("        proxy_busy_buffers_size 256k;\n")
		b.WriteString("        proxy_connect_timeout 60s;\n")
		b.WriteString("        proxy_send_timeout 180s;\n")
		b.WriteString("        proxy_read_timeout 180s;\n")
		b.WriteString("    }\n")
	}

	if s.Kind == "php" || s.Kind == "static" {
		b.WriteString("\n    # Static Assets Browser Caching\n")
		b.WriteString("    location ~* \\.(ico|css|js|gif|jpeg|jpg|png|webp|svg|woff|woff2|ttf|eot)$ {\n")
		b.WriteString("        expires 30d;\n")
		b.WriteString("        add_header Cache-Control \"public, no-transform\";\n")
		b.WriteString("        access_log off;\n")
		b.WriteString("        log_not_found off;\n")
		b.WriteString("    }\n")
	}

	b.WriteString("\n    location ~ /\\.(?!well-known) {\n        deny all;\n    }\n")
}

func nginxServerBody(b *strings.Builder, s Spec) {
	fmt.Fprintf(b, "    access_log /var/log/nginx/barepod-%s.access.log;\n", s.Slug)
	fmt.Fprintf(b, "    error_log  /var/log/nginx/barepod-%s.error.log;\n\n", s.Slug)
	nginxTuningDirectives(b, s)
	b.WriteString("    location ^~ /.well-known/acme-challenge/ {\n")
	b.WriteString("        default_type \"text/plain\";\n")
	b.WriteString("        root /var/lib/barepod/acme;\n")
	b.WriteString("    }\n\n")
	nginxSecurityDirectives(b, s)
	nginxLocations(b, s)
}

func nginxVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Nginx, s.Slug) + ").\n")

	// Global / http-level definitions (limit_req_zone, geo blocks)
	nginxSecurityHeader(&b, s)

	serverName := s.ServerName()
	hasSSL := s.SSLEnabled && s.SSLCertPath != "" && s.SSLKeyPath != ""

	// Port 80 server block (clean plain HTTP)
	b.WriteString("server {\n")
	b.WriteString("    listen 80;\n")
	b.WriteString("    listen [::]:80;\n")
	fmt.Fprintf(&b, "    server_name %s;\n\n", serverName)
	b.WriteString("    location ^~ /.well-known/acme-challenge/ {\n")
	b.WriteString("        default_type \"text/plain\";\n")
	b.WriteString("        root /var/lib/barepod/acme;\n")
	b.WriteString("    }\n\n")

	if hasSSL && s.ForceHTTPS {
		b.WriteString("    location / {\n")
		b.WriteString("        if ($http_x_forwarded_proto = \"https\") {\n")
		b.WriteString("            break;\n")
		b.WriteString("        }\n")
		b.WriteString("        return 301 https://$host$request_uri;\n")
		b.WriteString("    }\n")
	} else {
		nginxServerBody(&b, s)
	}
	b.WriteString("}\n\n")

	// Port 443 server block if SSL enabled (clean HTTPS)
	if hasSSL {
		b.WriteString("server {\n")
		b.WriteString("    listen 443 ssl;\n")
		b.WriteString("    listen [::]:443 ssl;\n")
		fmt.Fprintf(&b, "    server_name %s;\n\n", serverName)
		fmt.Fprintf(&b, "    ssl_certificate %s;\n", s.SSLCertPath)
		fmt.Fprintf(&b, "    ssl_certificate_key %s;\n", s.SSLKeyPath)
		b.WriteString("    ssl_protocols TLSv1.2 TLSv1.3;\n")
		b.WriteString("    ssl_ciphers HIGH:!aNULL:!MD5;\n")
		b.WriteString("    ssl_prefer_server_ciphers on;\n")
		b.WriteString("    ssl_session_cache shared:SSL:10m;\n")
		b.WriteString("    ssl_session_timeout 10m;\n")
		if s.HSTS {
			b.WriteString("    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;\n")
		}
		b.WriteString("\n")
		nginxServerBody(&b, s)
		b.WriteString("}\n")
	}

	return b.String()
}

// --- Caddy ---

func caddyAppLocations(b *strings.Builder, s Spec, indent string) {
	switch s.Kind {
	case "php":
		fmt.Fprintf(b, "%sroot * %s\n", indent, s.DocRoot)
		fmt.Fprintf(b, "%sphp_fastcgi unix/%s\n", indent, s.Socket)
		fmt.Fprintf(b, "%sfile_server\n", indent)
	case "static":
		fmt.Fprintf(b, "%sroot * %s\n", indent, s.DocRoot)
		fmt.Fprintf(b, "%sfile_server\n", indent)
	default:
		fmt.Fprintf(b, "%sreverse_proxy 127.0.0.1:%d\n", indent, s.Port)
	}
}

func caddyVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Caddy, s.Slug) + ").\n")
	allDomains := s.AllDomains()
	hasSSL := s.SSLEnabled && s.SSLCertPath != "" && s.SSLKeyPath != ""

	snippetName := fmt.Sprintf("barepod_%s_common", sanitizeSlug(s.Slug))

	b.WriteString("(" + snippetName + ") {\n")
	fmt.Fprintf(&b, "\tlog {\n\t\toutput file /var/log/caddy/barepod-%s.access.log\n\t}\n\n", s.Slug)

	// Optimization & Compression
	b.WriteString("\t# Compression (Zstandard & Gzip)\n\tencode zstd gzip\n\n")

	// Security Headers
	b.WriteString("\t# Security Headers\n")
	b.WriteString("\theader {\n")
	b.WriteString("\t\tX-Content-Type-Options nosniff\n")
	b.WriteString("\t\tX-Frame-Options SAMEORIGIN\n")
	b.WriteString("\t\tReferrer-Policy strict-origin-when-cross-origin\n")
	b.WriteString("\t}\n\n")

	// Static Assets Browser Caching
	if s.Kind == "php" || s.Kind == "static" {
		b.WriteString("\t# Static Assets Browser Caching\n")
		b.WriteString("\t@static path *.ico *.css *.js *.gif *.jpg *.jpeg *.png *.svg *.woff *.woff2 *.webp\n")
		b.WriteString("\theader @static Cache-Control \"public, max-age=2592000, must-revalidate\"\n\n")
	}

	// 1. IP Access Control
	if s.Security.IPRestrictionMode == "allowlist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("\t@ipDenied not client_ip " + strings.Join(s.Security.IPRestrictionList, " ") + "\n")
		b.WriteString("\trespond @ipDenied \"Access Denied\" 403\n\n")
	} else if s.Security.IPRestrictionMode == "denylist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("\t@ipBlocked client_ip " + strings.Join(s.Security.IPRestrictionList, " ") + "\n")
		b.WriteString("\trespond @ipBlocked \"Access Denied\" 403\n\n")
	}

	// 2. HTTP Basic Authentication
	if s.Security.BasicAuthEnabled && s.Security.BasicAuthHash != "" {
		user := strings.TrimSpace(s.Security.BasicAuthUser)
		if user == "" {
			user = "admin"
		}
		b.WriteString("\tbasic_auth {\n")
		fmt.Fprintf(&b, "\t\t%s %s\n", user, s.Security.BasicAuthHash)
		b.WriteString("\t}\n\n")
	}

	// 3. Maintenance Mode
	if s.Security.MaintenanceMode {
		htmlBody := RenderMaintenanceHTML(s.Security.MaintenanceTitle, s.Security.MaintenanceMessage)
		escaped := strings.ReplaceAll(htmlBody, "\"", "\\\"")
		escaped = strings.ReplaceAll(escaped, "\n", " ")
		escaped = strings.ReplaceAll(escaped, "\r", "")

		if len(s.Security.MaintenanceBypassIPs) > 0 {
			bypass := s.Security.MaintenanceBypassIPs
			fmt.Fprintf(&b, "\t@maintenance not client_ip %s\n", strings.Join(bypass, " "))
			b.WriteString("\thandle @maintenance {\n")
			b.WriteString("\t\theader Retry-After 300\n")
			b.WriteString("\t\theader Content-Type \"text/html; charset=utf-8\"\n")
			fmt.Fprintf(&b, "\t\trespond \"%s\" 503\n", escaped)
			b.WriteString("\t}\n")
			b.WriteString("\thandle {\n")
			caddyAppLocations(&b, s, "\t\t")
			b.WriteString("\t}\n")
		} else {
			b.WriteString("\thandle {\n")
			b.WriteString("\t\theader Retry-After 300\n")
			b.WriteString("\t\theader Content-Type \"text/html; charset=utf-8\"\n")
			fmt.Fprintf(&b, "\t\trespond \"%s\" 503\n", escaped)
			b.WriteString("\t}\n")
		}
	} else {
		caddyAppLocations(&b, s, "\t")
	}

	b.WriteString("}\n\n")

	// TLS block if SSL is configured
	if hasSSL {
		fmt.Fprintf(&b, "%s {\n", strings.Join(allDomains, ", "))
		fmt.Fprintf(&b, "\ttls %s %s\n", s.SSLCertPath, s.SSLKeyPath)
		fmt.Fprintf(&b, "\timport %s\n", snippetName)
		b.WriteString("}\n\n")
	}

	// Plain HTTP block on port 80 (prevents automatic HTTP->HTTPS 308 redirect loop behind Cloudflare tunnels / proxies)
	var httpDomains []string
	for _, d := range allDomains {
		httpDomains = append(httpDomains, d+":80")
	}
	fmt.Fprintf(&b, "%s {\n", strings.Join(httpDomains, ", "))
	fmt.Fprintf(&b, "\timport %s\n", snippetName)
	b.WriteString("}\n")

	return b.String()
}

// --- Apache ---

func apacheVhost(s Spec) string {
	var b strings.Builder
	b.WriteString("# Managed by BarePod Panel — do not edit by hand (" + FileName(Apache, s.Slug) + ").\n")
	b.WriteString("<VirtualHost 127.0.0.1:8080>\n")
	fmt.Fprintf(&b, "    ServerName %s\n", s.Domain)
	if len(s.Aliases) > 0 {
		fmt.Fprintf(&b, "    ServerAlias %s\n", strings.Join(s.Aliases, " "))
	}
	if s.SSLEnabled && s.SSLCertPath != "" && s.SSLKeyPath != "" {
		b.WriteString("    SSLEngine on\n")
		fmt.Fprintf(&b, "    SSLCertificateFile %s\n", s.SSLCertPath)
		fmt.Fprintf(&b, "    SSLCertificateKeyFile %s\n", s.SSLKeyPath)
	}
	if s.DocRoot != "" {
		fmt.Fprintf(&b, "    DocumentRoot %s\n", s.DocRoot)
	}
	b.WriteString("\n")
	fmt.Fprintf(&b, "    CustomLog /var/log/apache2/barepod-%s.access.log combined\n", s.Slug)
	fmt.Fprintf(&b, "    ErrorLog  /var/log/apache2/barepod-%s.error.log\n\n", s.Slug)

	// Optimization & KeepAlive
	b.WriteString("    # Optimization & KeepAlive\n")
	b.WriteString("    KeepAlive On\n")
	b.WriteString("    MaxKeepAliveRequests 100\n")
	b.WriteString("    KeepAliveTimeout 5\n\n")

	// Deflate (Gzip) Compression
	b.WriteString("    # Deflate (Gzip) Compression\n")
	b.WriteString("    <IfModule mod_deflate.c>\n")
	b.WriteString("        AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript application/json image/svg+xml\n")
	b.WriteString("    </IfModule>\n\n")

	// Security Headers
	b.WriteString("    # Security Headers\n")
	b.WriteString("    <IfModule mod_headers.c>\n")
	b.WriteString("        Header always set X-Content-Type-Options \"nosniff\"\n")
	b.WriteString("        Header always set X-Frame-Options \"SAMEORIGIN\"\n")
	b.WriteString("        Header always set Referrer-Policy \"strict-origin-when-cross-origin\"\n")
	b.WriteString("    </IfModule>\n\n")

	// Static Assets Cache-Control
	if s.Kind == "php" || s.Kind == "static" {
		b.WriteString("    # Static Assets Browser Caching\n")
		b.WriteString("    <IfModule mod_expires.c>\n")
		b.WriteString("        ExpiresActive On\n")
		b.WriteString("        ExpiresByType image/jpg \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType image/jpeg \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType image/gif \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType image/png \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType image/webp \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType image/svg+xml \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType text/css \"access plus 1 month\"\n")
		b.WriteString("        ExpiresByType application/javascript \"access plus 1 month\"\n")
		b.WriteString("    </IfModule>\n\n")
	}

	// Access control & Basic Auth for Apache
	if s.Security.BasicAuthEnabled && s.Security.BasicAuthFile != "" {
		realm := strings.TrimSpace(s.Security.BasicAuthRealm)
		if realm == "" {
			realm = "Restricted Area"
		}
		b.WriteString("    <Location />\n")
		b.WriteString("        AuthType Basic\n")
		fmt.Fprintf(&b, "        AuthName \"%s\"\n", realm)
		fmt.Fprintf(&b, "        AuthUserFile %s\n", s.Security.BasicAuthFile)
		b.WriteString("        Require valid-user\n")
		b.WriteString("    </Location>\n\n")
	}
	if s.Security.IPRestrictionMode == "allowlist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("    <Location />\n")
		fmt.Fprintf(&b, "        Require ip %s\n", strings.Join(s.Security.IPRestrictionList, " "))
		b.WriteString("    </Location>\n\n")
	} else if s.Security.IPRestrictionMode == "denylist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("    <Location />\n")
		fmt.Fprintf(&b, "        Require not ip %s\n", strings.Join(s.Security.IPRestrictionList, " "))
		b.WriteString("    </Location>\n\n")
	}
	if s.Security.MaintenanceMode {
		fmt.Fprintf(&b, "    ErrorDocument 503 /barepod_503.html\n")
		fmt.Fprintf(&b, "    Alias /barepod_503.html /var/lib/barepod/maintenance/%s/index.html\n\n", sanitizeSlug(s.Slug))
	}

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
	if len(s.Aliases) > 0 {
		fmt.Fprintf(&b, "vhAliases                 %s\n", strings.Join(s.Aliases, ", "))
	}
	if s.SSLEnabled && s.SSLCertPath != "" && s.SSLKeyPath != "" {
		fmt.Fprintf(&b, "keyFile                   %s\n", s.SSLKeyPath)
		fmt.Fprintf(&b, "certFile                  %s\n", s.SSLCertPath)
	}
	b.WriteString("enableGzip                1\n")
	b.WriteString("enableBr                  1\n")
	b.WriteString("keepAliveTimeout          5\n")
	b.WriteString("smartKeepAlive            1\n")
	b.WriteString("maxKeepAliveReq           1000\n\n")

	if s.Security.IPRestrictionMode == "allowlist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("accessControl {\n")
		fmt.Fprintf(&b, "    allow                   %s\n", strings.Join(s.Security.IPRestrictionList, ", "))
		b.WriteString("    deny                    all\n")
		b.WriteString("}\n\n")
	} else if s.Security.IPRestrictionMode == "denylist" && len(s.Security.IPRestrictionList) > 0 {
		b.WriteString("accessControl {\n")
		fmt.Fprintf(&b, "    deny                    %s\n", strings.Join(s.Security.IPRestrictionList, ", "))
		b.WriteString("}\n\n")
	}

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
		if _, err := os.Stat("/usr/local/lsws/Example"); err == nil {
			_, _ = h.Run(ctx, []string{"chown", "-R", "lsadm:lsadm", "/usr/local/lsws/Example"})
		}
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

	// Ensure webserver log directories and access log files exist with appropriate permissions
	ensureLogPermissions(ctx, engine, s.Slug, h)

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

func ensureLogPermissions(ctx context.Context, engine, slug string, h *host.Host) {
	if h == nil || h.Runner == nil || h.Runner.Mode() != "real" {
		return
	}
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case Caddy:
		_ = os.MkdirAll("/var/log/caddy", 0o755)
		logFile := fmt.Sprintf("/var/log/caddy/barepod-%s.access.log", slug)
		if _, err := os.Stat(logFile); err == nil {
			_ = os.Chmod(logFile, 0o664)
		} else {
			f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o664)
			if err == nil {
				f.Close()
			}
		}
		_, _ = h.Run(ctx, []string{"chown", "-R", "caddy:caddy", "/var/log/caddy"})
	case Nginx:
		_ = os.MkdirAll("/var/log/nginx", 0o755)
		logFile := fmt.Sprintf("/var/log/nginx/barepod-%s.access.log", slug)
		if _, err := os.Stat(logFile); err == nil {
			_ = os.Chmod(logFile, 0o664)
		} else {
			f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o664)
			if err == nil {
				f.Close()
			}
		}
		_, _ = h.Run(ctx, []string{"chown", "www-data:adm", logFile})
	case Apache:
		_ = os.MkdirAll("/var/log/apache2", 0o755)
		logFile := fmt.Sprintf("/var/log/apache2/barepod-%s.access.log", slug)
		if _, err := os.Stat(logFile); err == nil {
			_ = os.Chmod(logFile, 0o664)
		} else {
			f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o664)
			if err == nil {
				f.Close()
			}
		}
		_, _ = h.Run(ctx, []string{"chown", "www-data:adm", logFile})
	case OpenLiteSpeed:
		_ = os.MkdirAll("/usr/local/lsws/logs", 0o755)
		logFile := fmt.Sprintf("/usr/local/lsws/logs/barepod-%s.access.log", slug)
		if _, err := os.Stat(logFile); err == nil {
			_ = os.Chmod(logFile, 0o664)
		} else {
			f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o664)
			if err == nil {
				f.Close()
			}
		}
		_, _ = h.Run(ctx, []string{"chown", "nobody:nogroup", logFile})
	}
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
	webGroup := webUser
	if webUser == "nobody" {
		webGroup = "nogroup"
		_, _ = h.Run(ctx, []string{"usermod", "-a", "-G", "nogroup", "caddy"})
	}
	run := func(argv ...string) error {
		out, err := h.Run(ctx, argv)
		if err != nil {
			return fmt.Errorf("webserver: %s: %w (%s)", argv[0], err, strings.TrimSpace(out))
		}
		return nil
	}
	parentDir := filepath.Dir(siteDir)
	dirs := []string{"chmod", "o+x", home}
	if parentDir != "" && parentDir != home {
		dirs = append(dirs, parentDir)
	}
	for _, sub := range []string{"web", "apps"} {
		d := filepath.Join(home, sub)
		if _, err := os.Stat(d); err == nil {
			dirs = append(dirs, d)
		}
	}
	if err := run(dirs...); err != nil {
		return err
	}
	if err := run("chgrp", "-R", webGroup, siteDir); err != nil {
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
