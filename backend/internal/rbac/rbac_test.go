package rbac

import "testing"

func TestDefaultGroupsCoverEveryCapability(t *testing.T) {
	groups := DefaultGroups()
	if len(groups) == 0 {
		t.Fatal("no default groups")
	}
	for _, g := range groups {
		normalised := g.Permissions.Normalised()
		for _, capability := range All {
			if _, ok := normalised[capability]; !ok {
				t.Errorf("group %q is missing capability %q", g.Name, capability)
			}
		}
		if g.Name == "" || g.Description == "" {
			t.Errorf("group %+v needs a name and a description", g)
		}
		if !g.IsDefault || !g.IsSystem {
			t.Errorf("group %q must be marked default+system", g.Name)
		}
	}
}

func TestRootGroupGrantsEverything(t *testing.T) {
	var root Group
	for _, g := range DefaultGroups() {
		if g.Name == RootGroup {
			root = g
		}
	}
	if root.Name == "" {
		t.Fatalf("no %q group", RootGroup)
	}
	for _, capability := range All {
		if !root.Permissions.Allows(capability) {
			t.Errorf("root group lacks %q", capability)
		}
	}
}

func TestBasicGroupIsLimited(t *testing.T) {
	var dev Group
	for _, g := range DefaultGroups() {
		if g.Name == "Basic" {
			dev = g
		}
	}
	if dev.Name == "" {
		t.Fatal("no Basic group")
	}
	if !dev.Permissions.Allows(CapDeployApps) {
		t.Error("Basic must be able to deploy")
	}
	if dev.Permissions.Allows(CapUsers) {
		t.Error("Basic must not be able to manage users")
	}
	if dev.Permissions.Allows(CapAPITokens) {
		t.Error("Basic must not be able to mint API tokens")
	}
}

func TestNormalisedDropsUnknownKeys(t *testing.T) {
	p := Permissions{"deployApps": true, "madeUp": true}.Normalised()
	if p.Allows("madeUp") {
		t.Error("Normalised kept an unknown capability")
	}
	if !p.Allows(CapDeployApps) {
		t.Error("Normalised dropped a real capability")
	}
	if len(p) != len(All) {
		t.Errorf("Normalised returned %d keys, want %d", len(p), len(All))
	}
}
