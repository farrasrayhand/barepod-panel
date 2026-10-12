package phpext

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

func TestIniNameReadsBothForms(t *testing.T) {
	cases := map[string]string{
		"20-curl.ini":    "curl",
		"10-opcache.ini": "opcache",
		"/etc/php/8.3/mods-available/pdo_mysql.ini": "pdo_mysql",
		"/etc/php/8.3/fpm/conf.d/20-intl.ini":       "intl",
		"":                                          "",
		"20-bad name.ini":                           "",
	}
	for in, want := range cases {
		if got := iniName(in); got != want {
			t.Errorf("iniName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSetRefusesWhatTheHostDoesNotHave(t *testing.T) {
	dir := t.TempDir()
	h := &host.Host{Runner: &host.DryRunner{}, SitesRoot: filepath.Join(dir, "home")}

	// A dry-run host reports no extensions, so nothing may be switched.
	if err := Set(context.Background(), h, "8.3", "curl", true); err == nil {
		t.Error("an extension this host does not have was accepted")
	}
	if err := Set(context.Background(), h, "not-a-version", "curl", true); err == nil {
		t.Error("a version that is not a version was accepted")
	}
	if err := Set(context.Background(), h, "8.3", "curl; rm -rf /", true); err == nil {
		t.Error("an extension name that is not a name was accepted")
	}
}

func TestListReportsAValidatedVersion(t *testing.T) {
	dir := t.TempDir()
	h := &host.Host{Runner: &host.DryRunner{}, SitesRoot: filepath.Join(dir, "home")}

	report, err := List(context.Background(), h, "8.3")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if report.Version != "8.3" || len(report.Extensions) != 0 || report.Installable == nil {
		t.Errorf("a dry-run host should report the version and nothing else: %+v", report)
	}
	if _, err := List(context.Background(), h, "8"); err == nil {
		t.Error("a version that is not X.Y was accepted")
	}
}
