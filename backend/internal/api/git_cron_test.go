package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestGitAndDeployKeyEndpoints(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// 1. Get Deploy Key
	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/git/deploy-key", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get deploy-key status = %d (%s)", resp.StatusCode, body)
	}
	var keyInfo struct {
		Algorithm   string `json:"algorithm"`
		PublicKey   string `json:"publicKey"`
		Fingerprint string `json:"fingerprint"`
	}
	if err := json.Unmarshal([]byte(body), &keyInfo); err != nil {
		t.Fatalf("unmarshal deploy-key: %v", err)
	}
	if keyInfo.Algorithm != "ED25519" || !strings.HasPrefix(keyInfo.PublicKey, "ssh-ed25519") {
		t.Errorf("unexpected deploy key: %+v", keyInfo)
	}

	// 2. Rotate Deploy Key
	resp, rotateBody := panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/deploy-key/rotate", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rotate deploy-key status = %d (%s)", resp.StatusCode, rotateBody)
	}
	var rotatedKey struct {
		PublicKey string `json:"publicKey"`
	}
	_ = json.Unmarshal([]byte(rotateBody), &rotatedKey)
	if rotatedKey.PublicKey == keyInfo.PublicKey {
		t.Errorf("expected rotated key to differ from original key")
	}

	// 3. Update Git Settings
	updatePayload := map[string]any{
		"repo":       "https://github.com/myorg/custom-repo.git",
		"branch":     "production",
		"autoDeploy": true,
	}
	resp, updateBody := panel.do(t, http.MethodPatch, "/api/v1/websites/alex-site/git", updatePayload)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch git settings status = %d (%s)", resp.StatusCode, updateBody)
	}

	// 4. Verify updated site and get DeployHookToken
	site, err := panel.store.WebsiteBySlug("alex-site")
	if err != nil {
		t.Fatalf("get alex-site: %v", err)
	}
	if site.SourceRepo != "https://github.com/myorg/custom-repo.git" || site.SourceBranch != "production" || !site.AutoDeploy {
		t.Errorf("site git fields not updated: %+v", site)
	}
	if site.DeployHookToken == "" {
		t.Fatalf("expected non-empty DeployHookToken")
	}

	// 5. Test Public Webhook Ping
	reqPing, _ := http.NewRequest(http.MethodPost, panel.server.URL+"/api/v1/webhooks/deploy/alex-site?token="+site.DeployHookToken, nil)
	reqPing.Header.Set("X-GitHub-Event", "ping")
	pingResp, err := http.DefaultClient.Do(reqPing)
	if err != nil {
		t.Fatalf("do webhook ping: %v", err)
	}
	if pingResp.StatusCode != http.StatusOK {
		t.Errorf("webhook ping status = %d, want 200", pingResp.StatusCode)
	}

	// 6. Test Public Webhook Invalid Token
	reqBad, _ := http.NewRequest(http.MethodPost, panel.server.URL+"/api/v1/webhooks/deploy/alex-site?token=wrong_token", nil)
	badResp, err := http.DefaultClient.Do(reqBad)
	if err != nil {
		t.Fatalf("do webhook bad: %v", err)
	}
	if badResp.StatusCode != http.StatusUnauthorized {
		t.Errorf("webhook bad token status = %d, want 401", badResp.StatusCode)
	}

	// 7. Test Public Webhook Trigger Redeploy
	pushBody := strings.NewReader(`{"ref": "refs/heads/production"}`)
	reqPush, _ := http.NewRequest(http.MethodPost, panel.server.URL+"/api/v1/webhooks/deploy/alex-site?token="+site.DeployHookToken, pushBody)
	reqPush.Header.Set("Content-Type", "application/json")
	pushResp, err := http.DefaultClient.Do(reqPush)
	if err != nil {
		t.Fatalf("do webhook push: %v", err)
	}
	if pushResp.StatusCode != http.StatusAccepted {
		t.Errorf("webhook push status = %d, want 202", pushResp.StatusCode)
	}
	time.Sleep(100 * time.Millisecond)
}

func TestGitAutoDeployModeAndDeployHistory(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// The contract name is repoUrl; it must behave like repo and leave auto-deploy off when asked.
	resp, body := panel.do(t, http.MethodPatch, "/api/v1/websites/alex-site/git", map[string]any{
		"repoUrl":    "https://github.com/myorg/custom-repo.git",
		"branch":     "production",
		"autoDeploy": false,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch git (repoUrl) status = %d (%s)", resp.StatusCode, body)
	}
	site, err := panel.store.WebsiteBySlug("alex-site")
	if err != nil {
		t.Fatalf("get alex-site: %v", err)
	}
	if site.SourceRepo != "https://github.com/myorg/custom-repo.git" || site.AutoDeployMode != "none" {
		t.Errorf("repoUrl/autoDeploy not applied: %+v", site)
	}

	// Poll mode needs no inbound port, so it is the deterministic path to assert in a test.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{
		"enabled":         true,
		"mode":            "poll",
		"pollIntervalSec": 120,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enable auto-deploy status = %d (%s)", resp.StatusCode, body)
	}
	var auto struct {
		Mode              string `json:"mode"`
		WebhookRegistered bool   `json:"webhookRegistered"`
		PollIntervalSec   int    `json:"pollIntervalSec"`
	}
	_ = json.Unmarshal([]byte(body), &auto)
	if auto.Mode != "poll" || auto.WebhookRegistered || auto.PollIntervalSec != 120 {
		t.Errorf("unexpected auto-deploy response: %+v", auto)
	}

	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/git", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get git status = %d (%s)", resp.StatusCode, body)
	}
	var status WebsiteGitStatus
	_ = json.Unmarshal([]byte(body), &status)
	if status.AutoDeployMode != "poll" || status.AutoDeployPollSec != 120 {
		t.Errorf("git status did not expose the resolved mode: %+v", status)
	}

	// Deployment history reads the persisted job fields.
	if err := panel.store.CreateDeployJob(&store.DeployJob{
		ID: "dep_test_history", Slug: "alex-site", Mode: "dry-run", Status: "success",
		Trigger: "poll", CommitSHA: "0123456789abcdef", CommitMessage: "fix: ship it",
		CommitAuthor: "alice", DurationMs: 1234, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("create deploy job: %v", err)
	}

	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/deploy/history?limit=5", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("deploy history status = %d (%s)", resp.StatusCode, body)
	}
	var history struct {
		Items []store.DeployJob `json:"items"`
		Total int               `json:"total"`
	}
	if err := json.Unmarshal([]byte(body), &history); err != nil {
		t.Fatalf("unmarshal history: %v", err)
	}
	if history.Total != 1 || len(history.Items) != 1 {
		t.Fatalf("expected one history item, got %+v", history)
	}
	row := history.Items[0]
	if row.Trigger != "poll" || row.CommitSHA != "0123456789abcdef" ||
		row.CommitMessage != "fix: ship it" || row.CommitAuthor != "alice" || row.DurationMs != 1234 {
		t.Errorf("history row lost its metadata: %+v", row)
	}

	// Disabling clears the mode so the watcher stops looking at this site.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{"enabled": false})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disable auto-deploy status = %d (%s)", resp.StatusCode, body)
	}
	site, _ = panel.store.WebsiteBySlug("alex-site")
	if site.AutoDeploy || site.AutoDeployMode != "none" {
		t.Errorf("auto-deploy was not disabled: %+v", site)
	}
}

func TestWebsiteRoutesLifecycleRendersVhost(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/admin-site/routes", map[string]any{
		"path": "/api", "upstream": "http://127.0.0.1:9000",
		"description": "API service", "websocket": true, "stripPrefix": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create route status = %d (%s)", resp.StatusCode, body)
	}
	var route store.WebsiteRoute
	_ = json.Unmarshal([]byte(body), &route)
	if route.ID == "" || route.Path != "/api/" {
		t.Fatalf("unexpected route: %+v", route)
	}

	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/routes", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list routes status = %d (%s)", resp.StatusCode, body)
	}
	var list struct {
		Items []store.WebsiteRoute `json:"items"`
	}
	_ = json.Unmarshal([]byte(body), &list)
	if len(list.Items) != 1 {
		t.Fatalf("expected one route, got %+v", list.Items)
	}

	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/vhost/preview?engine=nginx", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("vhost preview status = %d (%s)", resp.StatusCode, body)
	}
	var preview struct {
		Config string `json:"config"`
	}
	_ = json.Unmarshal([]byte(body), &preview)
	if !strings.Contains(preview.Config, "location ^~ /api/ {") || !strings.Contains(preview.Config, "127.0.0.1:9000") {
		t.Errorf("route is missing from the rendered vhost:\n%s", preview.Config)
	}

	resp, body = panel.do(t, http.MethodDelete, "/api/v1/websites/admin-site/routes/"+route.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete route status = %d (%s)", resp.StatusCode, body)
	}
	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/routes", nil)
	_ = json.Unmarshal([]byte(body), &list)
	if resp.StatusCode != http.StatusOK || len(list.Items) != 0 {
		t.Errorf("route was not removed: %s", body)
	}
}

func TestListWebsitesOwnerFilterAndSort(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites?owner=alex&sort_by=name&order=asc", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list status = %d (%s)", resp.StatusCode, body)
	}
	var result struct {
		Items []store.Website `json:"items"`
	}
	_ = json.Unmarshal([]byte(body), &result)
	if len(result.Items) != 1 || result.Items[0].TenantUser != "alex" {
		t.Errorf("owner filter did not scope to alex: %+v", result.Items)
	}

	resp, body = panel.do(t, http.MethodGet, "/api/v1/websites?sort_by=name&order=desc", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("sorted list status = %d (%s)", resp.StatusCode, body)
	}
	_ = json.Unmarshal([]byte(body), &result)
	if len(result.Items) < 2 || result.Items[0].Slug < result.Items[1].Slug {
		t.Errorf("descending name order was not applied: %+v", result.Items)
	}

	resp, _ = panel.do(t, http.MethodGet, "/api/v1/websites?sort_by=size", nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("unsupported website sort should be 400, got %d", resp.StatusCode)
	}
}

func TestWebsiteLogsDryRun(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/logs?lines=50", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("logs status = %d (%s)", resp.StatusCode, body)
	}
	var result struct {
		Unit  string   `json:"unit"`
		Mode  string   `json:"mode"`
		Lines []string `json:"lines"`
		Note  string   `json:"note"`
	}
	_ = json.Unmarshal([]byte(body), &result)
	if result.Unit != "barepod-app@admin-site.service" {
		t.Errorf("unit = %q", result.Unit)
	}
	if result.Mode != "dry-run" || result.Note == "" {
		t.Errorf("expected an honest dry-run note, got %+v", result)
	}

	panel.login(t, "alex")
	resp, _ = panel.do(t, http.MethodGet, "/api/v1/websites/admin-site/logs", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("cross-tenant logs status = %d, want 404", resp.StatusCode)
	}
}

func TestPingWebsiteUsesStoredUpstream(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()

	panel := newTestPanel(t)
	panel.login(t, "admin")
	if err := panel.store.UpdateWebsiteUpstream("admin-site", upstream.URL); err != nil {
		t.Fatalf("set upstream: %v", err)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/admin-site/ping", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ping status = %d (%s)", resp.StatusCode, body)
	}
	var result struct {
		OK        bool   `json:"ok"`
		Status    int    `json:"statusCode"`
		LatencyMs int64  `json:"latencyMs"`
		Target    string `json:"target"`
		Error     string `json:"error"`
	}
	_ = json.Unmarshal([]byte(body), &result)
	if !result.OK || result.Status != http.StatusNoContent || result.Target != upstream.URL {
		t.Errorf("unexpected ping result: %+v (%s)", result, body)
	}

	// A tenant must not be able to probe another site's upstream.
	panel.login(t, "alex")
	resp, _ = panel.do(t, http.MethodPost, "/api/v1/websites/admin-site/ping", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("cross-tenant ping status = %d, want 404", resp.StatusCode)
	}
}

func TestLegacyAutoDeployDoesNotClaimPolling(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// A row from before V27: auto_deploy is on, but there is no resolved mode. The old column
	// default was 1, so upgrade must not make the watcher start deploying this site.
	if err := panel.store.UpdateWebsiteGit("alex-site", "https://github.com/acme/legacy.git", "main", true, "github"); err != nil {
		t.Fatalf("seed legacy site: %v", err)
	}
	site, err := panel.store.WebsiteBySlug("alex-site")
	if err != nil {
		t.Fatalf("reload site: %v", err)
	}
	if site.AutoDeployMode != "" {
		t.Fatalf("expected an unset mode, got %q", site.AutoDeployMode)
	}
	if site.SourceKind != "github" {
		t.Fatalf("saving a repo must move the site onto the Git path, got source kind %q", site.SourceKind)
	}

	resp, body := panel.do(t, http.MethodGet, "/api/v1/websites/alex-site/git", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("git status = %d (%s)", resp.StatusCode, body)
	}
	var status WebsiteGitStatus
	if err := json.Unmarshal([]byte(body), &status); err != nil {
		t.Fatalf("unmarshal status: %v", err)
	}
	if !status.AutoDeploy {
		t.Fatalf("fixture should have autoDeploy on")
	}
	if status.AutoDeployMode != "none" {
		t.Errorf("legacy row must report mode none, got %q", status.AutoDeployMode)
	}
}

func TestGitHubWebhookLifecycle(t *testing.T) {
	var (
		mu          sync.Mutex
		hookURL     string
		postCalls   int
		patchCalls  int
		deleteCalls int
	)

	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()

		switch {
		case r.URL.Path == "/user":
			_ = json.NewEncoder(w).Encode(map[string]string{"login": "alice"})
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodGet:
			if hookURL == "" {
				_ = json.NewEncoder(w).Encode([]any{})
				return
			}
			_ = json.NewEncoder(w).Encode([]map[string]any{{
				"id": 7, "active": true, "config": map[string]string{"url": hookURL},
			}})
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodPost:
			postCalls++
			var payload struct {
				Config struct {
					URL string `json:"url"`
				} `json:"config"`
			}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			hookURL = payload.Config.URL
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"id":7}`))
		case strings.Contains(r.URL.Path, "/hooks/7") && r.Method == http.MethodPatch:
			patchCalls++
			var payload struct {
				Config struct {
					URL string `json:"url"`
				} `json:"config"`
			}
			_ = json.NewDecoder(r.Body).Decode(&payload)
			hookURL = payload.Config.URL
			_, _ = w.Write([]byte(`{"id":7}`))
		case strings.Contains(r.URL.Path, "/hooks/7") && r.Method == http.MethodDelete:
			deleteCalls++
			hookURL = ""
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer fake.Close()

	oldBase := githubAPIBase
	githubAPIBase = fake.URL
	defer func() { githubAPIBase = oldBase }()

	panel := newTestPanel(t)
	panel.login(t, "admin")

	if resp, body := panel.do(t, http.MethodPost, "/api/v1/git/providers", map[string]any{
		"provider": "github", "token": "ghp_fake", "name": "GitHub",
	}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create provider status = %d (%s)", resp.StatusCode, body)
	}

	if resp, body := panel.do(t, http.MethodPatch, "/api/v1/websites/alex-site/git", map[string]any{
		"repoUrl": "https://github.com/acme/app.git", "branch": "main", "autoDeploy": false,
	}); resp.StatusCode != http.StatusOK {
		t.Fatalf("set repo status = %d (%s)", resp.StatusCode, body)
	}

	// First enable: no hook exists, so the panel creates one.
	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{
		"enabled": true, "mode": "webhook", "pollIntervalSec": 120,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("enable webhook status = %d (%s)", resp.StatusCode, body)
	}
	var first struct {
		Mode              string `json:"mode"`
		WebhookRegistered bool   `json:"webhookRegistered"`
	}
	_ = json.Unmarshal([]byte(body), &first)
	if first.Mode != "webhook" || !first.WebhookRegistered {
		t.Fatalf("unexpected enable response: %+v (%s)", first, body)
	}

	// Simulate a panel hostname change: the stored hook points somewhere else, so the next enable
	// must PATCH the existing hook instead of creating a second one.
	mu.Lock()
	hookURL = "https://old.example/api/v1/webhooks/deploy/alex-site?token=stale"
	mu.Unlock()

	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{
		"enabled": true, "mode": "webhook", "pollIntervalSec": 120,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update webhook status = %d (%s)", resp.StatusCode, body)
	}

	mu.Lock()
	gotPost, gotPatch := postCalls, patchCalls
	mu.Unlock()
	if gotPost != 1 || gotPatch != 1 {
		t.Errorf("expected one create and one update, got post=%d patch=%d", gotPost, gotPatch)
	}

	// Disabling must remove the hook, not just forget it.
	resp, body = panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{"enabled": false})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("disable status = %d (%s)", resp.StatusCode, body)
	}
	mu.Lock()
	gotDelete := deleteCalls
	finalURL := hookURL
	mu.Unlock()
	if gotDelete != 1 || finalURL != "" {
		t.Errorf("expected the hook to be deleted, delete=%d url=%q", gotDelete, finalURL)
	}
}

func TestGitHubWebhookDuplicateIsSuccess(t *testing.T) {
	fake := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/user":
			_ = json.NewEncoder(w).Encode(map[string]string{"login": "alice"})
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodGet:
			// A list failure forces the create path, which is where a 422 can happen.
			w.WriteHeader(http.StatusInternalServerError)
		case strings.HasSuffix(r.URL.Path, "/hooks") && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"message":"Hook already exists on this repository"}`))
		}
	}))
	defer fake.Close()

	oldBase := githubAPIBase
	githubAPIBase = fake.URL
	defer func() { githubAPIBase = oldBase }()

	panel := newTestPanel(t)
	panel.login(t, "admin")
	if resp, body := panel.do(t, http.MethodPost, "/api/v1/git/providers", map[string]any{
		"provider": "github", "token": "ghp_fake", "name": "GitHub",
	}); resp.StatusCode != http.StatusCreated {
		t.Fatalf("create provider status = %d (%s)", resp.StatusCode, body)
	}
	if resp, body := panel.do(t, http.MethodPatch, "/api/v1/websites/alex-site/git", map[string]any{
		"repoUrl": "https://github.com/acme/app.git", "autoDeploy": false,
	}); resp.StatusCode != http.StatusOK {
		t.Fatalf("set repo status = %d (%s)", resp.StatusCode, body)
	}

	resp, body := panel.do(t, http.MethodPost, "/api/v1/websites/alex-site/git/auto-deploy", map[string]any{
		"enabled": true, "mode": "webhook",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("duplicate hook should be accepted, got %d (%s)", resp.StatusCode, body)
	}
}

func TestUnifiedCronJobLifecycle(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	// 1. List cron jobs (initially returns system jobs + empty website jobs)
	resp, body := panel.do(t, http.MethodGet, "/api/v1/cron/jobs", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get cron jobs status = %d (%s)", resp.StatusCode, body)
	}
	var initialList struct {
		SystemJobs  []any `json:"systemJobs"`
		WebsiteJobs []any `json:"websiteJobs"`
	}
	if err := json.Unmarshal([]byte(body), &initialList); err != nil {
		t.Fatalf("unmarshal cron list: %v", err)
	}
	if len(initialList.SystemJobs) == 0 {
		t.Errorf("expected non-empty systemJobs")
	}

	// 2. Create website cron job
	createPayload := map[string]any{
		"websiteSlug": "alex-site",
		"name":        "Laravel Task Schedule",
		"schedule":    "* * * * *",
		"command":     "echo 'running laravel schedule'",
		"enabled":     true,
	}
	resp, createBody := panel.do(t, http.MethodPost, "/api/v1/cron/jobs", createPayload)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create cron job status = %d (%s)", resp.StatusCode, createBody)
	}
	var createdJob struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal([]byte(createBody), &createdJob)
	if createdJob.ID == "" {
		t.Fatalf("expected non-empty created job ID")
	}

	// 3. Run the cron job immediately
	resp, runBody := panel.do(t, http.MethodPost, "/api/v1/cron/jobs/"+createdJob.ID+"/run", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("run cron job status = %d (%s)", resp.StatusCode, runBody)
	}
	var runResult struct {
		OK     bool   `json:"ok"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal([]byte(runBody), &runResult)
	if !runResult.OK || runResult.Status != "success" {
		t.Errorf("expected cron run success, got: %+v (%s)", runResult, runBody)
	}

	// 4. Update cron job
	updatePayload := map[string]any{
		"schedule": "*/5 * * * *",
	}
	resp, _ = panel.do(t, http.MethodPut, "/api/v1/cron/jobs/"+createdJob.ID, updatePayload)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("update cron job status = %d", resp.StatusCode)
	}

	// 5. Delete cron job
	resp, _ = panel.do(t, http.MethodDelete, "/api/v1/cron/jobs/"+createdJob.ID, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete cron job status = %d", resp.StatusCode)
	}
}
