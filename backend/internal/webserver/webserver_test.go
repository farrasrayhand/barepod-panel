package webserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNginxPhpVhostSendsToFpm(t *testing.T) {
	cfg := Nginx(Spec{
		Slug: "shop", Domain: "shop.example.com", Kind: "php",
		DocRoot: "/home/alex/apps/shop", Socket: "/home/alex/apps/shop/fpm.sock",
	})
	for _, want := range []string{
		"server_name shop.example.com;",
		"root /home/alex/apps/shop;",
		"fastcgi_pass unix:/home/alex/apps/shop/fpm.sock;",
		"try_files $uri $uri/ /index.php?$query_string;",
		"barepod-shop.access.log",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("php vhost is missing %q:\n%s", want, cfg)
		}
	}
}

func TestNginxRuntimeVhostProxiesToItsPort(t *testing.T) {
	cfg := Nginx(Spec{Slug: "api", Domain: "api.example.com", Kind: "nodejs", Port: 4010})
	if !strings.Contains(cfg, "proxy_pass http://127.0.0.1:4010;") {
		t.Errorf("runtime vhost does not proxy to its port:\n%s", cfg)
	}
	if !strings.Contains(cfg, "proxy_set_header Upgrade $http_upgrade;") {
		t.Errorf("runtime vhost does not pass WebSocket upgrades:\n%s", cfg)
	}
}

func TestDefaultVhostIsTheCatchAll(t *testing.T) {
	if !strings.Contains(Default(), "listen 80 default_server;") {
		t.Errorf("default vhost is not the catch-all:\n%s", Default())
	}
}

func TestWriteAndRemove(t *testing.T) {
	dir := t.TempDir()
	spec := Spec{Slug: "shop", Domain: "shop.example.com", Kind: "static", DocRoot: "/srv/shop"}
	path, err := Write(dir, spec)
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if path != filepath.Join(dir, "barepod-shop.conf") {
		t.Errorf("path = %q, want the panel-owned name", path)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("the vhost was not written: %v", err)
	}
	// A php vhost without a socket is refused rather than written half-formed.
	if _, err := Write(dir, Spec{Slug: "bad", Domain: "bad.example.com", Kind: "php"}); err == nil {
		t.Error("a php vhost with no socket was accepted")
	}
	if err := Remove(dir, "shop"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("the vhost still exists after Remove")
	}
	if err := Remove(dir, "shop"); err != nil {
		t.Errorf("removing a missing vhost must be harmless: %v", err)
	}
}

func TestWriteDefaultDoesNotOverwrite(t *testing.T) {
	dir := t.TempDir()
	path, err := WriteDefault(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("# operator edit\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := WriteDefault(dir); err != nil {
		t.Fatal(err)
	}
	body, _ := os.ReadFile(path)
	if strings.TrimSpace(string(body)) != "# operator edit" {
		t.Errorf("WriteDefault overwrote the operator's file: %q", body)
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
	if _, err := WriteDefault(dir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(stock); !os.IsNotExist(err) {
		t.Error("the stock default vhost is still in place")
	}
	// Renamed out of the include glob (a leading dot), not deleted.
	if _, err := os.Stat(filepath.Join(dir, ".default.barepod-disabled")); err != nil {
		t.Errorf("the stock vhost was not kept aside: %v", err)
	}
}

func TestAvailableUsesTheInjectedLookPath(t *testing.T) {
	if !Available(func(string) (string, error) { return "/usr/sbin/nginx", nil }) {
		t.Error("nginx reported missing though LookPath found it")
	}
	if Available(func(string) (string, error) { return "", os.ErrNotExist }) {
		t.Error("nginx reported present though LookPath failed")
	}
}
