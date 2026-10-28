package webserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEnsureNginxIncludeAddsSitesEnabledOnce(t *testing.T) {
	dir := t.TempDir()
	conf := filepath.Join(dir, "nginx.conf")
	stock := "http {\n    include       /etc/nginx/mime.types;\n    # include /etc/nginx/sites-enabled/*.conf;\n    include /etc/nginx/conf.d/*.conf;\n}\n"
	if err := os.WriteFile(conf, []byte(stock), 0o644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := EnsureNginxInclude(conf, "/etc/nginx/sites-enabled"); err != nil {
			t.Fatal(err)
		}
	}
	got, _ := os.ReadFile(conf)
	if n := strings.Count(string(got), "    include /etc/nginx/sites-enabled/*.conf;"); n != 1 {
		t.Fatalf("want exactly one active include, got %d:\n%s", n, got)
	}
	if !strings.Contains(string(got), "conf.d/*.conf;\n    include /etc/nginx/sites-enabled/*.conf;") {
		t.Fatalf("include not placed after conf.d:\n%s", got)
	}
}
