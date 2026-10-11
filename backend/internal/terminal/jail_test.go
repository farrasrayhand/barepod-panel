package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The list of what a site shell must not see is plain filesystem logic, so it is
// tested everywhere — the mounting itself needs Linux and a real host.
func TestSiblingsAreTheTenantsOtherFilesAndSites(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "bptest")
	apps := filepath.Join(home, "apps")

	for _, dir := range []string{
		filepath.Join(apps, "web-flask"),
		filepath.Join(apps, "web-flask2"),
		filepath.Join(home, "downloads"),
		filepath.Join(home, ".cache"),
	} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(home, "notes.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}

	spec := JailSpec{SitesRoot: root, Tenant: "bptest", Slug: "web-flask2"}
	siblings, err := spec.Siblings()
	if err != nil {
		t.Fatalf("Siblings: %v", err)
	}

	joined := strings.Join(siblings, "\n")
	for _, want := range []string{
		filepath.Join(home, "downloads"),
		filepath.Join(home, ".cache"),
		filepath.Join(home, "notes.txt"),
		filepath.Join(apps, "web-flask"),
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("a sibling was not masked: %s\n%s", want, joined)
		}
	}
	for _, forbidden := range []string{
		filepath.Join(apps, "web-flask2"),
		filepath.Join(home, "apps"),
		home,
	} {
		if strings.Contains(joined, forbidden+"\n") || joined == forbidden {
			t.Errorf("the site itself would be masked: %s\n%s", forbidden, joined)
		}
	}
}

func TestSiblingsHandleATenantWithoutAppsYet(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "fresh"), 0o750); err != nil {
		t.Fatal(err)
	}
	siblings, err := JailSpec{SitesRoot: root, Tenant: "fresh", Slug: "site"}.Siblings()
	if err != nil {
		t.Fatalf("Siblings: %v", err)
	}
	if len(siblings) != 0 {
		t.Errorf("a tenant with nothing but its home needs no masks: %v", siblings)
	}
}

func TestMaskRefusesToRunOutsideANamespace(t *testing.T) {
	// Masking without a private namespace would hide the real directories for the
	// whole machine, so the guard is mandatory (this process is not in one).
	dir := t.TempDir()
	if _, err := Mask([]string{dir}); err == nil {
		t.Fatal("Mask ran outside a private mount namespace")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Errorf("the directory must be untouched: %v", err)
	}
}

func TestJailSupportIsHonest(t *testing.T) {
	// Whatever the answer, it must come with a reason when it is "no".
	supported, reason := JailSupported()
	if !supported && strings.TrimSpace(reason) == "" {
		t.Error("an unsupported host must explain why")
	}
}

func TestMountNamespaceDetection(t *testing.T) {
	// Where /proc/ns is readable (Linux), a process must recognise its own
	// namespace: that is what makes "am I the daemon?" checkable.
	current := MountNamespace()
	if current == "" {
		t.Skip("this platform has no mount namespaces")
	}
	if !SharesMountNamespace(current) {
		t.Errorf("a process did not recognise its own mount namespace (%s)", current)
	}
	if SharesMountNamespace("mnt:[0]") {
		t.Error("a foreign namespace was reported as ours")
	}
	if SharesMountNamespace("") {
		t.Error("an empty namespace must never match (the daemon may not pass one)")
	}
}

func TestSiteInsideHomeDecidesTheOverlay(t *testing.T) {
	spec := JailSpec{SitesRoot: "/home", Tenant: "bptest", Slug: "own-check"}
	if !spec.SiteInsideHome() {
		t.Error("a site under the tenant's home can use the home overlay")
	}
	if spec.Home() != "/home/bptest" || spec.SiteDir() != "/home/bptest/apps/own-check" {
		t.Errorf("unexpected layout: %s / %s", spec.Home(), spec.SiteDir())
	}

	// The guard exists for a reason: a slug that climbs out of the home (or a
	// layout that puts sites elsewhere) must fall back to masking, never overlay
	// an unrelated directory on top of the account's home.
	// `..` that stays inside the home still resolves inside it, which is safe (and
	// slugs like that are refused when a website is created anyway).
	inside := JailSpec{SitesRoot: "/home", Tenant: "bptest", Slug: "sub/site"}
	if !inside.SiteInsideHome() {
		t.Error("a nested site inside the home is still inside the home")
	}
	// Climbing out of the home must never trigger the overlay: it would hide an
	// unrelated directory (here another account's home) behind the account's own.
	escaping := JailSpec{SitesRoot: "/home", Tenant: "bptest", Slug: "../../bptest2"}
	if escaping.SiteInsideHome() {
		t.Errorf("a site that leaves the home (%s) must not use the overlay", escaping.SiteDir())
	}
}
