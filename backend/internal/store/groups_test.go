package store

import (
	"path/filepath"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
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
