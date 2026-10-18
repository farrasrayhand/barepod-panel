package store

import (
	"path/filepath"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "panel.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

// TestMigrationsAreIdempotent guards the in-place update path: the daemon migrates on every
// start, so re-opening an already-migrated database must apply nothing and fail on nothing.
func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "panel.db")

	first, err := Open(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	_ = first.Close()

	second, err := Open(path)
	if err != nil {
		t.Fatalf("re-open of a migrated database: %v", err)
	}
	t.Cleanup(func() { _ = second.Close() })

	var applied int
	if err := second.DB.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if applied != len(migrations) {
		t.Fatalf("schema_migrations has %d rows, want %d", applied, len(migrations))
	}
}

// TestGroupCPUWeightRoundTrip proves the package keeps its quota and its share side by side, so
// switching the allocation mode does not lose either value.
func TestGroupCPUWeightRoundTrip(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.EnsureDefaultGroups(); err != nil {
		t.Fatal(err)
	}

	limits := resources.Limits{CPUQuotaPercent: 100, CPUWeight: 250, MemoryMB: 1024}
	if _, err := st.CreateGroup("Pro", "pro plan", rbac.Permissions{}, limits); err != nil {
		t.Fatal(err)
	}
	group, err := st.GroupByName("Pro")
	if err != nil {
		t.Fatal(err)
	}
	if group.Limits.CPUQuotaPercent != 100 || group.Limits.CPUWeight != 250 {
		t.Fatalf("stored limits = %+v, want quota 100 and weight 250", group.Limits)
	}

	limits.CPUWeight = 400
	if err := st.UpdateGroup("Pro", "pro plan", rbac.Permissions{}, limits); err != nil {
		t.Fatal(err)
	}
	group, err = st.GroupByName("Pro")
	if err != nil {
		t.Fatal(err)
	}
	if group.Limits.CPUWeight != 400 {
		t.Fatalf("cpuWeight after update = %d, want 400", group.Limits.CPUWeight)
	}
}

func TestBuiltInBasicCarriesACPUWeight(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.EnsureDefaultGroups(); err != nil {
		t.Fatal(err)
	}
	group, err := st.GroupByName("Basic")
	if err != nil {
		t.Fatal(err)
	}
	if group.Limits.CPUWeight != 100 {
		t.Fatalf("Basic cpuWeight = %d, want 100", group.Limits.CPUWeight)
	}
}

func TestSharingDefaultsToReservedAndRoundTrips(t *testing.T) {
	st := newTestStore(t)

	policy, err := st.Sharing()
	if err != nil {
		t.Fatal(err)
	}
	if policy != (resources.Sharing{}) {
		t.Fatalf("a fresh install shares %+v, want every resource reserved", policy)
	}

	if err := st.SavePanelSetting(OvercommitSettingKey, "cpu,ram"); err != nil {
		t.Fatal(err)
	}
	policy, err = st.Sharing()
	if err != nil {
		t.Fatal(err)
	}
	if !policy.CPU || !policy.RAM || policy.Disk {
		t.Fatalf("policy = %+v, want cpu and ram shared, disk reserved", policy)
	}
}

func TestEnsureDefaultGroupsIsIdempotent(t *testing.T) {
	st := newTestStore(t)

	inserted, err := st.EnsureDefaultGroups()
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if inserted != len(rbac.DefaultGroups()) {
		t.Fatalf("inserted %d groups, want %d", inserted, len(rbac.DefaultGroups()))
	}

	inserted, err = st.EnsureDefaultGroups()
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if inserted != 0 {
		t.Fatalf("second call inserted %d groups, want 0", inserted)
	}

	groups, err := st.ListGroups()
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != len(rbac.DefaultGroups()) {
		t.Fatalf("stored %d groups, want %d", len(groups), len(rbac.DefaultGroups()))
	}
}

func TestGroupPermissionsRoundTrip(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.EnsureDefaultGroups(); err != nil {
		t.Fatal(err)
	}

	root, err := st.GroupByName(rbac.RootGroup)
	if err != nil {
		t.Fatalf("GroupByName: %v", err)
	}
	for _, capability := range rbac.All {
		if !root.Permissions.Allows(capability) {
			t.Errorf("root group lost %q after a database round trip", capability)
		}
	}
}

func TestGroupMemberCount(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.EnsureDefaultGroups(); err != nil {
		t.Fatal(err)
	}

	if _, err := st.CreateUser("alex", "alex@example.com", "hash", "user", "Basic"); err != nil {
		t.Fatal(err)
	}
	group, err := st.GroupByName("Basic")
	if err != nil {
		t.Fatal(err)
	}
	if group.Members != 1 {
		t.Fatalf("Basic has %d members, want 1", group.Members)
	}
}

func TestGroupNotFound(t *testing.T) {
	st := newTestStore(t)
	if _, err := st.GroupByName("Nope"); err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestListWebsitesByTenantIsScoped(t *testing.T) {
	st := newTestStore(t)

	if err := st.CreateWebsite(&Website{Slug: "mine", Domain: "mine.example.com", TenantUser: "alex", Runtime: "nodejs", Version: "22", WebServer: "caddy", Status: "stopped", DeployStatus: "ready", Port: 3000}); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateWebsite(&Website{Slug: "theirs", Domain: "theirs.example.com", TenantUser: "sam", Runtime: "nodejs", Version: "22", WebServer: "caddy", Status: "stopped", DeployStatus: "ready", Port: 3001}); err != nil {
		t.Fatal(err)
	}

	all, err := st.ListWebsites()
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("ListWebsites returned %d, want 2", len(all))
	}

	mine, err := st.ListWebsitesByTenant("alex")
	if err != nil {
		t.Fatal(err)
	}
	if len(mine) != 1 || mine[0].Slug != "mine" {
		t.Fatalf("ListWebsitesByTenant(alex) = %+v, want only \"mine\"", mine)
	}
}
