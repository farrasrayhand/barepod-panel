package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// A port is not opened while nothing can keep brute-force out of it. This is the whole point of
// the gate: the panel would otherwise be the thing that exposed a database and could not
// explain what it did about the attempts that followed.
func TestExposureIsRefusedWhileTheLockoutIsNotEnforcing(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	record := &store.Database{
		Kind: store.KindDatabase, TenantUser: "admin", Engine: "postgresql", Alias: "Reports DB",
		Name: "admin_reports_db", User: "admin_reports_db", Host: "127.0.0.1", Port: 5432,
		Status: "ready",
	}
	if err := panel.store.CreateDatabase(record); err != nil {
		t.Fatal(err)
	}

	// Switched off is enough to refuse: the daemon reports "not enforcing" with a reason.
	settings, err := panel.store.GuardSettings()
	if err != nil {
		t.Fatal(err)
	}
	settings.Enabled = false
	if err := panel.store.SaveGuardSettings(settings); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases/"+record.ID+"/exposure",
		map[string]string{"exposure": "public"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d (%s), want a refusal", resp.StatusCode, body)
	}
	var refusal struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &refusal); err != nil {
		t.Fatal(err)
	}
	if refusal.Error.Code != "guard_required" {
		t.Errorf("unexpected refusal: %+v", refusal)
	}
	if refusal.Error.Message == "" || len(refusal.Error.Message) < 30 {
		t.Errorf("the refusal does not explain itself: %q", refusal.Error.Message)
	}
	// And nothing was recorded, so the record cannot claim a port it never opened.
	stored, err := panel.store.DatabaseByID(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Exposure == store.ExposurePublic {
		t.Errorf("a refused opening was recorded anyway: %+v", stored)
	}
}

// Closing is always allowed, and a file database has no port at all: both are refused or
// accepted for reasons the screen can show.
func TestExposureRefusesAFileDatabaseAndAcceptsAnUnknownValueNever(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	file := &store.Database{
		Kind: store.KindDatabase, TenantUser: "admin", Engine: "sqlite", Alias: "UI Shop DB",
		Name: "bptest_ui_shop_db", FilePath: "/home/admin/site/bptest_ui_shop_db.sqlite", Status: "ready",
	}
	if err := panel.store.CreateDatabase(file); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/databases/"+file.ID+"/exposure",
		map[string]string{"exposure": "public"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("a file database answered %d (%s)", resp.StatusCode, body)
	}

	resp, body = panel.do(t, http.MethodPost, "/api/v1/databases/"+file.ID+"/exposure",
		map[string]string{"exposure": "whenever"})
	if resp.StatusCode != http.StatusConflict && resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("an unknown exposure answered %d (%s)", resp.StatusCode, body)
	}
}

// The log endpoint answers in the engine's own words plus the panel's own trail, and never
// invents either: where there is no log to read, it says so.
func TestTheDatabaseLogEndpointSaysWhatItCanShow(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	record := &store.Database{
		Kind: store.KindDatabase, TenantUser: "admin", Engine: "postgresql", Alias: "Reports DB",
		Name: "admin_reports_db", User: "admin_reports_db", Host: "127.0.0.1", Port: 5432,
		Status: "ready",
	}
	if err := panel.store.CreateDatabase(record); err != nil {
		t.Fatal(err)
	}
	if err := panel.store.Audit(panel.adminID, "database.exposure", record.Name, "127.0.0.1", "private: closed"); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodGet, "/api/v1/databases/"+record.ID+"/log", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Engine string             `json:"engine"`
		Source string             `json:"source"`
		Note   string             `json:"note"`
		Lines  []string           `json:"lines"`
		Audit  []store.AuditEntry `json:"audit"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Engine != "postgresql" {
		t.Errorf("the wrong engine was reported: %+v", payload)
	}
	if len(payload.Lines) == 0 && payload.Note == "" {
		t.Error("neither a log nor a reason was given")
	}
	found := false
	for _, entry := range payload.Audit {
		if entry.Action == "database.exposure" {
			found = true
		}
	}
	if !found {
		t.Errorf("the record's own audit trail was not included: %+v", payload.Audit)
	}

	// SQLite returns its embedded file path and an explanation instead of failing
	sqliteRecord := &store.Database{
		Kind: store.KindDatabase, TenantUser: "admin", Engine: "sqlite", Alias: "Shop",
		Name: "bptest_shop", FilePath: "/tmp/test.sqlite", Status: "ready",
	}
	if err := panel.store.CreateDatabase(sqliteRecord); err != nil {
		t.Fatal(err)
	}
	resp, body = panel.do(t, http.MethodGet, "/api/v1/databases/"+sqliteRecord.ID+"/log", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sqlite status = %d (%s)", resp.StatusCode, body)
	}
	var sqlitePayload struct {
		Engine string   `json:"engine"`
		Source string   `json:"source"`
		Note   string   `json:"note"`
		Lines  []string `json:"lines"`
	}
	if err := json.Unmarshal(body, &sqlitePayload); err != nil {
		t.Fatal(err)
	}
	if sqlitePayload.Engine != "sqlite" || sqlitePayload.Note == "" || sqlitePayload.Source != "/tmp/test.sqlite" {
		t.Errorf("expected sqlite file info and explanation: %+v", sqlitePayload)
	}
}

// The exposure of a record is one value with one note, written together, so a record can never
// claim to be public while the panel did nothing.
func TestExposureRoundTripsThroughTheStore(t *testing.T) {
	st := newTestPanel(t).store
	record := &store.Database{
		Kind: store.KindDatabase, TenantUser: "admin", Engine: "postgresql",
		Alias: "Reports DB", Name: "admin_reports_db", User: "admin_reports_db", Port: 5432,
		Status: "ready",
	}
	if err := st.CreateDatabase(record); err != nil {
		t.Fatal(err)
	}
	if err := st.SetDatabaseExposure(record.ID, store.ExposurePublic, "a pg_hba rule was added"); err != nil {
		t.Fatal(err)
	}
	stored, err := st.DatabaseByID(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Exposure != store.ExposurePublic || stored.ExposureNote == "" || stored.ExposedAt == "" {
		t.Fatalf("the decision was not kept with its outcome: %+v", stored)
	}
	if _, err := time.Parse(time.RFC3339, stored.ExposedAt); err != nil {
		t.Errorf("the moment it was opened was not recorded: %q", stored.ExposedAt)
	}
	if err := st.SetDatabaseExposure(record.ID, store.ExposurePrivate, "closed again"); err != nil {
		t.Fatal(err)
	}
	stored, err = st.DatabaseByID(record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Exposure != store.ExposurePrivate || stored.ExposedAt != "" {
		t.Errorf("closing did not clear the opening: %+v", stored)
	}
}
