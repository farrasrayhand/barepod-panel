package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

// A host engine only accepts connections from other interfaces if its own configuration says so, and
// that line is often present but commented out — which is the state Debian ships MariaDB in. The rule
// has to handle both, and adding a second line for a setting that is already there would leave the
// file saying two different things.
func TestSettingAConfigValue(t *testing.T) {
	commented := "[mysqld]\n#bind-address            = 127.0.0.1\nport = 3306\n"
	out, changed := setConfigValue(commented, "bind-address", "0.0.0.0")
	if !changed || !strings.Contains(out, "bind-address = 0.0.0.0") || strings.Contains(out, "#bind-address") {
		t.Errorf("a commented setting was not replaced: %s", out)
	}
	if !strings.Contains(out, "port = 3306") {
		t.Errorf("the rest of the file was damaged: %s", out)
	}
	plain := "[mysqld]\nbind-address = 0.0.0.0\n"
	if out, changed := setConfigValue(plain, "bind-address", "0.0.0.0"); changed || out != plain {
		t.Errorf("a setting that was already right was rewritten: %q (changed=%v)", out, changed)
	}
	absent := "[mysqld]\nport = 3306\n"
	out, changed = setConfigValue(absent, "bind-address", "0.0.0.0")
	if !changed || !strings.Contains(out, "bind-address = 0.0.0.0") {
		t.Errorf("a missing setting was not added: %s", out)
	}
}

func TestCacheExposureIsAlwaysRefused(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	cacheRec := &store.Database{
		Kind: store.KindCache, TenantUser: "admin", Engine: "redis", Alias: "Session Cache",
		Name: "admin_session_cache", User: "admin_session_cache", Host: "redis-admin-site", Port: 6379,
		Status: "ready",
	}
	if err := panel.store.CreateDatabase(cacheRec); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/caches/"+cacheRec.ID+"/exposure",
		map[string]string{"exposure": "public"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("cache exposure answered %d (%s), want 409", resp.StatusCode, body)
	}
	if !strings.Contains(string(body), "not_applicable") || !strings.Contains(string(body), "loopback") {
		t.Errorf("unexpected refusal payload: %s", body)
	}
}

func TestRedisCacheCreateAndRotateAlignWebsiteEnvInPlace(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	siteDir := filepath.Join(panel.home, "admin", "web", "admin-site")
	if err := os.MkdirAll(siteDir, 0o750); err != nil {
		t.Fatal(err)
	}
	envPath := filepath.Join(siteDir, ".env")
	initialEnv := "APP_NAME=AdminSite\nCUSTOM_TOKEN=keep-me\nREDIS_HOST=127.0.0.1\nREDIS_PASSWORD=oldpass\n"
	if err := os.WriteFile(envPath, []byte(initialEnv), 0o600); err != nil {
		t.Fatal(err)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/caches", map[string]any{
		"engine":      "redis",
		"alias":       "Primary Cache",
		"websiteSlug": "admin-site",
		"maxMemoryMb": 128,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create cache = %d (%s)", resp.StatusCode, body)
	}
	var created struct {
		Database struct {
			ID          string `json:"id"`
			Host        string `json:"host"`
			Port        int    `json:"port"`
			User        string `json:"user"`
			MaxMemoryMB int    `json:"maxMemoryMb"`
		} `json:"database"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatal(err)
	}
	if created.Database.Host != "redis-admin-site" || created.Database.Port != 6379 {
		t.Errorf("expected per-app host redis-admin-site:6379, got %s:%d", created.Database.Host, created.Database.Port)
	}
	if created.Database.MaxMemoryMB != 128 {
		t.Errorf("expected maxMemoryMb=128, got %d", created.Database.MaxMemoryMB)
	}

	envBytes, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	envStr := string(envBytes)
	for _, want := range []string{
		"CUSTOM_TOKEN=keep-me",
		"REDIS_HOST=redis-admin-site",
		"REDIS_PORT=6379",
		"REDIS_USERNAME=" + created.Database.User,
		"REDIS_PASSWORD=" + created.Password,
		"CACHE_URL=redis://",
	} {
		if !strings.Contains(envStr, want) {
			t.Errorf(".env after create missing %q:\n%s", want, envStr)
		}
	}

	// Rotate password and verify .env is updated in-place without losing CUSTOM_TOKEN
	resp, rotBody := panel.do(t, http.MethodPost, "/api/v1/caches/"+created.Database.ID+"/rotate-password", map[string]string{
		"password": "rotated-cache-secret-99",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rotate cache password = %d (%s)", resp.StatusCode, rotBody)
	}
	if !strings.Contains(string(rotBody), `"envAligned":true`) {
		t.Errorf("expected envAligned:true in rotate response: %s", rotBody)
	}
	envAfterRot, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	afterStr := string(envAfterRot)
	if !strings.Contains(afterStr, "REDIS_PASSWORD=rotated-cache-secret-99") || !strings.Contains(afterStr, "CUSTOM_TOKEN=keep-me") {
		t.Errorf(".env not aligned after rotate:\n%s", afterStr)
	}
}

func TestWriteManagerStartingEmitsAutoPollingHeaderAndScript(t *testing.T) {
	rec := httptest.NewRecorder()
	writeManagerStarting(rec, "dbgate", "/api/v1/databases/01H/gui/dbgate/", "Pulling container image...")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("X-BarePod-Manager-Status"); got != "starting" {
		t.Errorf("X-BarePod-Manager-Status = %q, want starting", got)
	}
	body := rec.Body.String()
	for _, want := range []string{
		"Preparing dbgate",
		"Pulling container image...",
		"X-BarePod-Manager-Status",
		"window.location.replace(target)",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("starting page missing %q:\n%s", want, body)
		}
	}
}

