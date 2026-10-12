package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// A record that says private must be private from the second it exists: its port enters the
// panel's firewall set as part of the create, not at the next restart. Measured before this: a
// containerised engine's port stayed reachable from the network until somebody moved the switch.
func TestCreatingARecordMakesItsPortPrivateImmediately(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases", map[string]any{
		"engine": "postgresql", "alias": "Reports DB", "name": "admin_reports_db",
		"user": "admin_reports_db",
	})
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status = %d (%s)", resp.StatusCode, body)
	}
	var created struct {
		Database struct {
			Port int `json:"port"`
		} `json:"database"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	if created.Database.Port == 0 {
		t.Skip("this engine's record carries no port, so there is nothing to make private")
	}
	joined := strings.Join(panel.runner.Commands(), " | ")
	if !strings.Contains(joined, "private_ports") || !strings.Contains(joined, fmt.Sprint(created.Database.Port)) {
		t.Errorf("the new record's port %d was not made private: %s", created.Database.Port, joined)
	}
}

// testGuard is the watchdog as these tests need it: no host underneath, an nft that answers,
// and the real store, so what the panel decides is what the tests can read back.
func testGuard(st *store.Store) *guard.Guard {
	return NewGuard(func(context.Context, string, ...string) (string, error) { return "", nil },
		st, time.Minute, nil)
}

type guardStatus struct {
	Enabled   bool              `json:"enabled"`
	MaxRetry  int               `json:"maxRetry"`
	FindTime  string            `json:"findTime"`
	BanTime   string            `json:"banTime"`
	Enforcing bool              `json:"enforcing"`
	Reason    string            `json:"reason"`
	Bans      []guard.Ban       `json:"bans"`
	Sources   map[string]string `json:"sources"`
	LastError string            `json:"lastError"`
	Interval  string            `json:"interval"`
	Table     string            `json:"table"`
	Set       string            `json:"set"`
}

// A fresh panel is protected before anybody visits a screen, and the status says where the
// ban is actually enforced.
func TestGuardStatusReportsDefaultsAndWhereBansLive(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/system/guard", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d (%s)", resp.StatusCode, body)
	}
	var status guardStatus
	if err := json.Unmarshal(body, &status); err != nil {
		t.Fatal(err)
	}
	if !status.Enabled || status.MaxRetry != 5 || status.FindTime != "10m0s" || status.BanTime != "1h0m0s" {
		t.Errorf("unexpected defaults: %+v", status)
	}
	if !status.Enforcing {
		t.Errorf("a host whose nft answers is enforcing: %+v", status)
	}
	if status.Table != "barepod" || status.Set != "banned" {
		t.Errorf("the status does not name the kernel's table: %+v", status)
	}
	if len(status.Bans) != 0 {
		t.Errorf("a fresh panel has no bans: %+v", status.Bans)
	}
}

// The numbers are the operator's to change, and the bounds exist because a window of seconds
// or a ban of a year both make the lockout pointless.
func TestGuardSettingsAreValidatedKeptAndAudited(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	for _, bad := range []map[string]any{
		{"maxRetry": 0},
		{"maxRetry": 101},
		{"findTime": "5s"},
		{"findTime": "48h"},
		{"banTime": "10s"},
		{"banTime": "1000h"},
	} {
		resp, body := panel.do(t, http.MethodPatch, "/api/v1/system/guard", bad)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%v was accepted: %d (%s)", bad, resp.StatusCode, body)
		}
	}
	// Nothing was written by any of them.
	settings, err := panel.store.GuardSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.MaxRetry != 5 || settings.FindTime != 10*time.Minute {
		t.Errorf("a refused change was kept anyway: %+v", settings)
	}

	resp, body := panel.do(t, http.MethodPatch, "/api/v1/system/guard", map[string]any{
		"maxRetry": 9, "findTime": "30m", "banTime": "12h",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch status = %d (%s)", resp.StatusCode, body)
	}
	settings, err = panel.store.GuardSettings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.MaxRetry != 9 || settings.FindTime != 30*time.Minute || settings.BanTime != 12*time.Hour {
		t.Fatalf("the change was not kept: %+v", settings)
	}

	entries, err := panel.store.ListAudit("", 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range entries {
		if entry.Action == "guard.settings" {
			found = true
			if entry.Detail == "" {
				t.Error("the audit entry does not say what was set")
			}
		}
	}
	if !found {
		t.Error("changing the lockout was not audited")
	}
}

// Letting somebody back in is a security decision: it is refused for anything that is not one
// IPv4 address, it releases the ban, and it is attributable.
func TestGuardUnbanReleasesAnAddressAndIsAudited(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	now := time.Now().UTC()
	if err := panel.store.SaveGuardBan(store.GuardBan{
		IP: "203.0.113.7", Engine: "postgresql", Reason: "5 refused logins", Hits: 5,
		BannedAt: now, ExpiresAt: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"not-an-ip", "203.0.113.7; rm -rf /", "::1", "203.0.113.0/24", ""} {
		resp, body := panel.do(t, http.MethodPost, "/api/v1/system/guard/unban", map[string]string{"ip": bad})
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%q was accepted: %d (%s)", bad, resp.StatusCode, body)
		}
	}
	bans, err := panel.store.GuardBans()
	if err != nil {
		t.Fatal(err)
	}
	if len(bans) != 1 {
		t.Fatalf("a refused release changed the bans: %+v", bans)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/system/guard/unban", map[string]string{"ip": "203.0.113.7"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("unban status = %d (%s)", resp.StatusCode, body)
	}
	bans, err = panel.store.GuardBans()
	if err != nil {
		t.Fatal(err)
	}
	if len(bans) != 0 {
		t.Errorf("the address is still banned: %+v", bans)
	}
	entries, err := panel.store.ListAudit("", 50)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, entry := range entries {
		if entry.Action == "guard.ip_unbanned" && entry.Target == "203.0.113.7" {
			found = true
		}
	}
	if !found {
		t.Error("releasing an address by hand was not audited, or not against the address")
	}
}

// The gate is only worth anything if the panel admits when it is not enforcing. With no
// watchdog wired at all — the honest state of a build that could not start one — both
// endpoints say so instead of reporting a protection that does not exist.
func TestGuardEndpointsAdmitWhenNoWatchdogRuns(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/panel.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	server := &Server{store: st}

	for _, call := range []struct {
		name   string
		handle func(http.ResponseWriter, *http.Request, *store.User, *store.Session)
	}{
		{"status", server.handleGuardStatus},
		{"unban", server.handleGuardUnban},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/v1/system/guard", nil)
		call.handle(recorder, request, &store.User{Role: "admin"}, &store.Session{})
		if recorder.Code != http.StatusServiceUnavailable {
			t.Errorf("%s answered %d, want an honest 503", call.name, recorder.Code)
		}
		if !strings.Contains(recorder.Body.String(), "lockout") {
			t.Errorf("%s did not say what is missing: %s", call.name, recorder.Body.String())
		}
	}
}
