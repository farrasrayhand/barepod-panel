package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
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
