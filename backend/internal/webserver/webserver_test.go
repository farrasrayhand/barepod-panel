package webserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNginxPhpVhostSendsToFpm(t *testing.T) {
	cfg, err := Render(Nginx, Spec{
		Slug: "shop", Domain: "shop.example.com", Kind: "php",
		DocRoot: "/home/alex/apps/shop", Socket: "/home/alex/apps/shop/fpm.sock",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"server_name shop.example.com;",
		"root /home/alex/apps/shop;",
		"fastcgi_pass unix:/home/alex/apps/shop/fpm.sock;",
		"try_files $uri $uri/ /index.php?$query_string;",
		"barepod-shop.access.log",
		"client_max_body_size 128M;",
		"gzip on;",
		"add_header X-Content-Type-Options \"nosniff\" always;",
		"add_header Cache-Control \"public, no-transform\";",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("nginx php vhost is missing %q:\n%s", want, cfg)
		}
	}
}

func TestNginxRuntimeVhostProxiesToItsPort(t *testing.T) {
	cfg, _ := Render(Nginx, Spec{Slug: "api", Domain: "api.example.com", Kind: "nodejs", Port: 4010})
	if !strings.Contains(cfg, "proxy_pass http://127.0.0.1:4010;") {
		t.Errorf("runtime vhost does not proxy to its port:\n%s", cfg)
	}
	if !strings.Contains(cfg, "proxy_set_header Upgrade $http_upgrade;") {
		t.Errorf("runtime vhost does not pass WebSocket upgrades:\n%s", cfg)
	}
}

func TestNginxSSLAndForceHTTPS(t *testing.T) {
	s := Spec{
		Slug:        "app",
		Domain:      "app.example.com",
		Aliases:     []string{"www.app.example.com"},
		Kind:        "static",
		DocRoot:     "/var/www/app",
		SSLEnabled:  true,
		SSLCertPath: "/etc/barepod/ssl/app.example.com/cert.pem",
		SSLKeyPath:  "/etc/barepod/ssl/app.example.com/key.pem",
		ForceHTTPS:  true,
		HSTS:        true,
	}
	cfg, err := Render(Nginx, s)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"server_name app.example.com www.app.example.com;",
		"return 301 https://$host$request_uri;",
		"listen 443 ssl;",
		"ssl_certificate /etc/barepod/ssl/app.example.com/cert.pem;",
		"ssl_certificate_key /etc/barepod/ssl/app.example.com/key.pem;",
		"Strict-Transport-Security",
		"location ^~ /.well-known/acme-challenge/",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("nginx SSL vhost is missing %q:\n%s", want, cfg)
		}
	}
}

func TestCaddySSL(t *testing.T) {
	s := Spec{
		Slug:        "app",
		Domain:      "app.example.com",
		Aliases:     []string{"www.app.example.com"},
		Kind:        "static",
		DocRoot:     "/var/www/app",
		SSLEnabled:  true,
		SSLCertPath: "/etc/barepod/ssl/app.example.com/cert.pem",
		SSLKeyPath:  "/etc/barepod/ssl/app.example.com/key.pem",
	}
	cfg, err := Render(Caddy, s)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"app.example.com, www.app.example.com {",
		"tls /etc/barepod/ssl/app.example.com/cert.pem /etc/barepod/ssl/app.example.com/key.pem",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("caddy SSL vhost is missing %q:\n%s", want, cfg)
		}
	}
}


func TestCaddyVhosts(t *testing.T) {
	php, err := Render(Caddy, Spec{
		Slug: "shop", Domain: "shop.example.com", Kind: "php",
		DocRoot: "/home/alex/apps/shop", Socket: "/home/alex/apps/shop/fpm.sock",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"shop.example.com:80 {",
		"root * /home/alex/apps/shop",
		"php_fastcgi unix//home/alex/apps/shop/fpm.sock",
		"file_server",
		"encode zstd gzip",
		"X-Content-Type-Options nosniff",
		`header @static Cache-Control "public, max-age=2592000, must-revalidate"`,
	} {
		if !strings.Contains(php, want) {
			t.Errorf("caddy php vhost is missing %q:\n%s", want, php)
		}
	}

	proxy, _ := Render(Caddy, Spec{Slug: "api", Domain: "api.example.com", Kind: "python", Port: 8000})
	if !strings.Contains(proxy, "reverse_proxy 127.0.0.1:8000") {
		t.Errorf("caddy runtime vhost does not proxy:\n%s", proxy)
	}
}

func TestSupportedEngines(t *testing.T) {
	for _, engine := range []string{"nginx", "caddy", "apache", "openlitespeed", "NGINX", " Caddy ", "Apache", "OpenLiteSpeed"} {
		if !Supported(engine) {
			t.Errorf("Supported(%q) = false, want true", engine)
		}
	}
	for _, engine := range []string{"iis", "caddy2", "", "tomcat"} {
		if Supported(engine) {
			t.Errorf("Supported(%q) = true, want false", engine)
		}
	}
}

func TestApacheVhost(t *testing.T) {
	cfg, err := Render(Apache, Spec{
		Slug: "blog", Domain: "blog.example.com", Kind: "php",
		DocRoot: "/home/alex/apps/blog", Socket: "/home/alex/apps/blog/fpm.sock",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"<VirtualHost 127.0.0.1:8080>",
		"ServerName blog.example.com",
		"DocumentRoot /home/alex/apps/blog",
		"proxy:unix:/home/alex/apps/blog/fpm.sock|fcgi://localhost",
		"KeepAlive On",
		"AddOutputFilterByType DEFLATE",
		"Header always set X-Content-Type-Options \"nosniff\"",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("apache php vhost missing %q:\n%s", want, cfg)
		}
	}
}

func TestOpenLiteSpeedVhost(t *testing.T) {
	cfg, err := Render(OpenLiteSpeed, Spec{
		Slug: "blog", Domain: "blog.example.com", Kind: "php",
		DocRoot: "/home/alex/apps/blog", Socket: "/home/alex/apps/blog/fpm.sock",
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"docRoot                   /home/alex/apps/blog",
		"extprocessor phpfpm {",
		"unix:/home/alex/apps/blog/fpm.sock",
		"enableGzip                1",
		"enableBr                  1",
		"maxKeepAliveReq           1000",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("openlitespeed php vhost missing %q:\n%s", want, cfg)
		}
	}
}

func TestWriteAndRemovePerEngine(t *testing.T) {
	dir := t.TempDir()
	path, err := Write(Nginx, dir, Spec{Slug: "shop", Domain: "shop.example.com", Kind: "static", DocRoot: "/srv/shop"})
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if path != filepath.Join(dir, "barepod-shop.conf") {
		t.Errorf("nginx path = %q", path)
	}
	caddyPath, err := Write(Caddy, dir, Spec{Slug: "shop", Domain: "shop.example.com", Kind: "static", DocRoot: "/srv/shop"})
	if err != nil {
		t.Fatal(err)
	}
	if caddyPath != filepath.Join(dir, "barepod-shop.caddy") {
		t.Errorf("caddy path = %q", caddyPath)
	}
	// A php vhost without a socket is refused rather than written half-formed.
	if _, err := Write(Nginx, dir, Spec{Slug: "bad", Domain: "bad.example.com", Kind: "php"}); err == nil {
		t.Error("a php vhost with no socket was accepted")
	}
	if err := Remove(Nginx, dir, "shop"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the nginx vhost still exists after Remove")
	}
	if err := Remove(Nginx, dir, "shop"); err != nil {
		t.Errorf("removing a missing vhost must be harmless: %v", err)
	}
}

// Ubuntu ships sites-enabled/default claiming default_server; leaving it in place
// made `nginx -t` fail with "a duplicate default server".
func TestWriteDefaultMovesTheStockVhostAside(t *testing.T) {
	dir := t.TempDir()
	stock := filepath.Join(dir, "default")
	if err := os.WriteFile(stock, []byte("server { listen 80 default_server; }\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteDefault(Nginx, dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stock); !os.IsNotExist(err) {
		t.Error("the stock default vhost is still in place")
	}
	if _, err := os.Stat(filepath.Join(dir, ".default.barepod-disabled")); err != nil {
		t.Errorf("the stock vhost was not kept aside: %v", err)
	}
}

func TestCaddyConfigTakesOverTheStockFile(t *testing.T) {
	root := t.TempDir()
	sites := filepath.Join(root, "sites")
	// The Caddyfile sits beside the sites directory, as on a real host (/etc/caddy).
	caddyfile := filepath.Join(root, "Caddyfile")
	if err := os.WriteFile(caddyfile, []byte(":80 {\n\trespond \"welcome\"\n}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteDefault(Caddy, sites); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(caddyfile)
	if !strings.Contains(string(body), "import "+filepath.Join(sites, "*.caddy")) {
		t.Errorf("the Caddyfile does not import the sites dir:\n%s", body)
	}
	if strings.Contains(string(body), "welcome") {
		t.Error("the stock :80 site is still in the panel Caddyfile (that is what made it ambiguous)")
	}
	// The operator's file is kept, not deleted.
	backup, err := os.ReadFile(caddyfile + ".barepod-bak")
	if err != nil || !strings.Contains(string(backup), "welcome") {
		t.Errorf("the stock Caddyfile was not kept: %v", err)
	}
	// Idempotent.
	if _, err := WriteDefault(Caddy, sites); err != nil {
		t.Fatal(err)
	}
	again, _ := os.ReadFile(caddyfile)
	if strings.Count(string(again), "import ") != 1 {
		t.Errorf("the import line was added twice:\n%s", again)
	}
}

func TestAvailableUsesTheInjectedLookPath(t *testing.T) {
	if !Available(Caddy, func(name string) (string, error) { return "/usr/bin/" + name, nil }) {
		t.Error("caddy reported missing though LookPath found it")
	}
	if Available(Nginx, func(string) (string, error) { return "", os.ErrNotExist }) {
		t.Error("nginx reported present though LookPath failed")
	}
}

func TestSecurityDirectivesNginxAndCaddy(t *testing.T) {
	spec := Spec{
		Slug:    "portal",
		Domain:  "portal.local",
		Kind:    "nodejs",
		Port:    3000,
		Security: SecuritySpec{
			MaintenanceMode:      true,
			MaintenanceTitle:     "Portal Updating",
			MaintenanceMessage:   "We are upgrading the database.",
			MaintenanceBypassIPs: []string{"10.0.0.1", "192.168.1.100"},
			BasicAuthEnabled:     true,
			BasicAuthUser:        "operator",
			BasicAuthHash:        "$2a$12$abcdefg",
			BasicAuthFile:        "/etc/barepod/auth/portal.htpasswd",
			BasicAuthRealm:       "Portal Internal",
			IPRestrictionMode:    "allowlist",
			IPRestrictionList:    []string{"10.0.0.0/8", "192.168.1.50"},
			RateLimitEnabled:     true,
			RateLimitReqPerSec:   15,
			RateLimitBurst:       30,
		},
	}

	// 1. Nginx
	nginxCfg, err := Render(Nginx, spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"limit_req_zone $binary_remote_addr zone=bp_rl_portal:10m rate=15r/s;",
		"geo $bp_maint_bypass_portal",
		"10.0.0.1 0;",
		"192.168.1.100 0;",
		"limit_req zone=bp_rl_portal burst=30 nodelay;",
		"auth_basic \"Portal Internal\";",
		"auth_basic_user_file /etc/barepod/auth/portal.htpasswd;",
		"allow 10.0.0.0/8;",
		"allow 192.168.1.50;",
		"deny all;",
		"error_page 503 /barepod_503.html;",
		"location = /barepod_503.html",
		"if ($bp_maint_bypass_portal)",
		"return 503;",
	} {
		if !strings.Contains(nginxCfg, want) {
			t.Errorf("nginx vhost missing expected security rule %q:\n%s", want, nginxCfg)
		}
	}

	// 2. Caddy
	caddyCfg, err := Render(Caddy, spec)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"@ipDenied not client_ip 10.0.0.0/8 192.168.1.50",
		"respond @ipDenied \"Access Denied\" 403",
		"basic_auth {",
		"operator $2a$12$abcdefg",
		"@maintenance not client_ip 10.0.0.1 192.168.1.100",
		"handle @maintenance {",
		"header Retry-After 300",
		"503",
		"Portal Updating",
		"We are upgrading the database",
		"handle {",
		"reverse_proxy 127.0.0.1:3000",
	} {
		if !strings.Contains(caddyCfg, want) {
			t.Errorf("caddy vhost missing expected security rule %q:\n%s", want, caddyCfg)
		}
	}
}
