package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// userRow mirrors what GET /users answers for one account.
type userRow struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	GroupName string `json:"groupName"`
	Status    string `json:"status"`
	Sites     struct {
		Used int `json:"used"`
		Max  int `json:"max"`
	} `json:"sites"`
	Databases struct {
		Used int `json:"used"`
		Max  int `json:"max"`
	} `json:"databases"`
	Password string `json:"password"`
}

func firstUser(t *testing.T, body []byte, username string) userRow {
	t.Helper()
	var payload struct {
		Items []userRow `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("decode users: %v (%s)", err, body)
	}
	for _, item := range payload.Items {
		if item.Username == username {
			return item
		}
	}
	t.Fatalf("account %q not in the list: %s", username, body)
	return userRow{}
}

func contains(commands []string, needle string) bool {
	for _, c := range commands {
		if strings.Contains(c, needle) {
			return true
		}
	}
	return false
}

func TestCreateUserProvisionsTheLinuxAccountAndListsIt(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/users", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d (%s)", resp.StatusCode, body)
	}
	if got := firstUser(t, body, "alex"); got.GroupName != "Developer" {
		t.Errorf("alex group = %q, want Developer", got.GroupName)
	}

	resp, body = panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{
		"username": "carol", "email": "carol@example.com", "groupName": "Developer",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d (%s)", resp.StatusCode, body)
	}
	var created userRow
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	if created.GroupName != "Developer" || created.Role != "user" {
		t.Errorf("created = %+v, want Developer/user", created)
	}
	if created.Password == "" {
		t.Error("a generated password should be returned once")
	}

	// The account exists in the store and its Linux account was asked for on the host.
	if _, err := panel.store.UserByUsername("carol"); err != nil {
		t.Fatalf("carol was not stored: %v", err)
	}
	if !contains(panel.runner.Commands(), "useradd") || !contains(panel.runner.Commands(), "carol") {
		t.Errorf("expected a useradd for carol, recorded: %v", panel.runner.Commands())
	}

	entries, _ := panel.store.ListAudit("", 50)
	found := false
	for _, e := range entries {
		if e.Action == "user.create" && e.Target == "carol" {
			found = true
		}
	}
	if !found {
		t.Error("user.create was not audited")
	}
}

func TestCreateUserRefusesUnknownGroupAndDuplicate(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{
		"username": "dave", "groupName": "No Such Package",
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("unknown group status = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "no_such_group") {
		t.Errorf("expected no_such_group, got %s", body)
	}

	resp, body = panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{
		"username": "alex", "groupName": "Developer",
	})
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(body), "already_exists") {
		t.Fatalf("duplicate status = %d (%s)", resp.StatusCode, body)
	}
}

func TestUpdateUserChangesPackageLocksAndSuspends(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	_, body := panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{
		"username": "carol", "groupName": "Developer",
	})
	var carol userRow
	if err := json.Unmarshal(body, &carol); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodPatch, "/api/v1/users/"+carol.ID, map[string]any{"groupName": "Read Only"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("group change status = %d (%s)", resp.StatusCode, body)
	}
	var afterGroup userRow
	if err := json.Unmarshal(body, &afterGroup); err != nil {
		t.Fatal(err)
	}
	if afterGroup.GroupName != "Read Only" {
		t.Fatalf("group = %q, want Read Only", afterGroup.GroupName)
	}

	resp, body = panel.do(t, http.MethodPatch, "/api/v1/users/"+carol.ID, map[string]any{"status": "suspended"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("suspend status = %d (%s)", resp.StatusCode, body)
	}
	var afterSuspend userRow
	if err := json.Unmarshal(body, &afterSuspend); err != nil {
		t.Fatal(err)
	}
	if afterSuspend.Status != "suspended" {
		t.Fatalf("status = %q, want suspended", afterSuspend.Status)
	}
	if !contains(panel.runner.Commands(), "usermod") || !contains(panel.runner.Commands(), "carol") {
		t.Errorf("expected usermod --lock for carol, recorded: %v", panel.runner.Commands())
	}
}

func TestUserSelfActionsAreRefused(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPatch, "/api/v1/users/"+panel.adminID, map[string]any{"status": "suspended"})
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "self_action") {
		t.Fatalf("self suspend = %d (%s)", resp.StatusCode, body)
	}

	resp, body = panel.do(t, http.MethodDelete, "/api/v1/users/"+panel.adminID, nil)
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "self_action") {
		t.Fatalf("self delete = %d (%s)", resp.StatusCode, body)
	}
}

func TestDeleteUserRefusesWhenItOwnsResources(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodDelete, "/api/v1/users/"+panel.alexID, nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("delete owner status = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "has_resources") || !strings.Contains(string(body), "alex-site") {
		t.Errorf("expected has_resources naming alex-site, got %s", body)
	}

	// An account with nothing to its name is deleted for real.
	_, body = panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{"username": "carol", "groupName": "Developer"})
	var carol userRow
	if err := json.Unmarshal(body, &carol); err != nil {
		t.Fatal(err)
	}
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/users/"+carol.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete empty status = %d (%s)", resp.StatusCode, body)
	}
	if _, err := panel.store.UserByUsername("carol"); err == nil {
		t.Error("carol still exists after delete")
	}
}

func TestGroupsCreateGuardAndDelete(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPost, "/api/v1/groups", map[string]any{
		"name":        "Starter",
		"description": "one site",
		"permissions": map[string]bool{"deployApps": true},
		"limits":      map[string]int{"maxSites": 1, "memoryMb": 256},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create group status = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "Starter") {
		t.Errorf("created group not returned: %s", body)
	}

	// A built-in package cannot be deleted.
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/groups/Developer", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("delete built-in status = %d (%s)", resp.StatusCode, body)
	}

	// A package with members is refused.
	_, _ = panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{"username": "carol", "groupName": "Starter"})
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/groups/Starter", nil)
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(body), "has_members") {
		t.Fatalf("delete non-empty status = %d (%s)", resp.StatusCode, body)
	}

	// An empty package is deleted.
	_, _ = panel.do(t, http.MethodPost, "/api/v1/groups", map[string]any{"name": "Empty"})
	resp, body = panel.do(t, http.MethodDelete, "/api/v1/groups/Empty", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete empty group status = %d (%s)", resp.StatusCode, body)
	}
}

func TestNonAdminCannotManageUsers(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "alex") // Developer: no `users` capability

	if resp, _ := panel.do(t, http.MethodGet, "/api/v1/users", nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("alex list users = %d, want 403", resp.StatusCode)
	}
	resp, body := panel.do(t, http.MethodPost, "/api/v1/users", map[string]any{"username": "x", "groupName": "Developer"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("alex create user = %d (%s), want 403", resp.StatusCode, body)
	}
}

func TestPrepareDirectoryRejectsUnknownOwner(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/prepare-directory", map[string]any{
		"slug": "ghost-site", "tenantUser": "ghost",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown owner status = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "tenantUser") {
		t.Errorf("expected a tenantUser field error, got %s", body)
	}
}

func TestSuspendingAnAccountStopsAndMarksItsWebsites(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// alex owns alex-site (running in the seed).
	resp, body := panel.do(t, http.MethodPatch, "/api/v1/users/"+panel.alexID, map[string]any{"status": "suspended"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("suspend = %d (%s)", resp.StatusCode, body)
	}
	site, err := panel.store.WebsiteBySlug("alex-site")
	if err != nil {
		t.Fatal(err)
	}
	if site.Status != "suspended" {
		t.Fatalf("site status = %q, want suspended", site.Status)
	}
	if !contains(panel.runner.Commands(), "stop barepod-app@alex-site") {
		t.Errorf("expected the unit to be stopped, recorded: %v", panel.runner.Commands())
	}

	// Starting a suspended owner's website is refused, so the suspension holds.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/start", nil)
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(body), "owner_suspended") {
		t.Fatalf("start while suspended = %d (%s)", resp.StatusCode, body)
	}

	// Reactivating releases the site to `stopped` (not started by itself).
	resp, body = panel.do(t, http.MethodPatch, "/api/v1/users/"+panel.alexID, map[string]any{"status": "active"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activate = %d (%s)", resp.StatusCode, body)
	}
	site, _ = panel.store.WebsiteBySlug("alex-site")
	if site.Status != "stopped" {
		t.Fatalf("released status = %q, want stopped", site.Status)
	}
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/start", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("start after activate = %d (%s)", resp.StatusCode, body)
	}
}

func TestMaxSitesRefusalUsesQuotaExceeded(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// alex already owns one website; cap the Developer package at one.
	resp, body := panel.do(t, http.MethodPatch, "/api/v1/groups/Developer", map[string]any{
		"limits": map[string]int{"cpuQuotaPercent": 100, "memoryMb": 1024, "tasksMax": 256, "diskQuotaGb": 10, "maxSites": 1, "maxDatabases": 2},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch group status = %d (%s)", resp.StatusCode, body)
	}

	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites", map[string]any{
		"slug": "one-too-many", "domain": "one.example.com", "tenantUser": "alex",
		"runtime": "static", "webServer": "caddy", "source": map[string]string{"kind": "default"},
	})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("over-quota create = %d (%s)", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "quota_exceeded") {
		t.Errorf("expected quota_exceeded, got %s", body)
	}
}
