package validate

import "testing"

func TestFQDN(t *testing.T) {
	valid := []string{
		"example.com",
		"api.mycompany.com",
		"a-b.example.co.id",
		"sub.domain.example.io",
		"EXAMPLE.com",
		"example.com.",
	}
	for _, s := range valid {
		if !FQDN(s) {
			t.Errorf("FQDN(%q) = false, want true", s)
		}
	}

	invalid := []string{
		"",
		"localhost",
		"http://example.com",
		"example com",
		"example_.com",
		"-example.com",
		"example-.com",
		"example.c",
		"example.123",
		"user@example.com",
		"/etc/passwd",
		"example.com/path",
	}
	for _, s := range invalid {
		if FQDN(s) {
			t.Errorf("FQDN(%q) = true, want false", s)
		}
	}
}

func TestSlug(t *testing.T) {
	for _, s := range []string{"ab", "my-site", "site123", "a1"} {
		if !Slug(s) {
			t.Errorf("Slug(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", "a", "My-Site", "-site", "site-", "si te", "site_name", "site.name"} {
		if Slug(s) {
			t.Errorf("Slug(%q) = true, want false", s)
		}
	}
}

func TestTenantUser(t *testing.T) {
	for _, s := range []string{"farras", "tenant_alex", "_svc", "a1-2"} {
		if !TenantUser(s) {
			t.Errorf("TenantUser(%q) = false, want true", s)
		}
	}
	for _, s := range []string{"", "Farras", "1user", "user name", "user;rm", "../../etc"} {
		if TenantUser(s) {
			t.Errorf("TenantUser(%q) = true, want false", s)
		}
	}
}

func TestEnums(t *testing.T) {
	if !Runtime("PHP") || Runtime("perl") {
		t.Error("Runtime() mismatch")
	}
	if !WebServer("Caddy") || WebServer("iis") {
		t.Error("WebServer() mismatch")
	}
	if !Engine("PostgreSQL") || !Engine("sqlite") || Engine("oracle") {
		t.Error("Engine() mismatch")
	}
	if !SourceKind("github") || SourceKind("ftp") {
		t.Error("SourceKind() mismatch")
	}
}
