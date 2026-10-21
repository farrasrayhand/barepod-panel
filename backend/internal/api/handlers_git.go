package api

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/framework"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// handlePublicDeployWebhook is a public unauthenticated webhook receiver triggered by
// GitHub, GitLab, Gitea, or custom git services on git push.
// Authentication is performed via the site's unique secret query token: ?token=...
func (s *Server) handlePublicDeployWebhook(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if slug == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Missing website slug")
		return
	}

	site, err := s.store.WebsiteBySlug(slug)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	token := r.URL.Query().Get("token")
	if token == "" || site.DeployHookToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(site.DeployHookToken)) != 1 {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid or missing webhook token")
		return
	}

	// 1. Handle ping events (e.g. GitHub "ping", GitLab "Ping Hook")
	gitEvent := r.Header.Get("X-GitHub-Event")
	if gitEvent == "" {
		gitEvent = r.Header.Get("X-Gitlab-Event")
	}
	if strings.EqualFold(gitEvent, "ping") {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"message": "Pong! Webhook verified successfully for " + site.Slug,
			"site":    site.Slug,
		})
		return
	}

	// 2. Check auto-deploy toggle
	if !site.AutoDeploy {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      false,
			"status":  "ignored",
			"message": "Auto-deploy is disabled for this website",
		})
		return
	}

	// 3. Inspect branch if provided in JSON payload. GitHub/GitLab/Gitea send `ref`; Bitbucket
	// sends the new branch under push.changes[].new.name.
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024*1024))
	if len(body) > 0 {
		var payload struct {
			Ref  string `json:"ref"` // e.g. "refs/heads/main"
			Push struct {
				Changes []struct {
					New struct {
						Name string `json:"name"`
					} `json:"new"`
				} `json:"changes"`
			} `json:"push"`
		}
		_ = json.Unmarshal(body, &payload)
		if payload.Ref == "" && len(payload.Push.Changes) > 0 {
			payload.Ref = "refs/heads/" + payload.Push.Changes[0].New.Name
		}
		if payload.Ref != "" {
			refBranch := strings.TrimPrefix(payload.Ref, "refs/heads/")
			expectedBranch := site.SourceBranch
			if expectedBranch == "" {
				expectedBranch = "main"
			}
			if !strings.EqualFold(refBranch, expectedBranch) {
				writeJSON(w, http.StatusOK, map[string]any{
					"ok":      false,
					"status":  "ignored",
					"message": "Push to branch " + refBranch + " ignored (configured branch is " + expectedBranch + ")",
				})
				return
			}
		}
	}

	// 4. Trigger Redeployment
	kind := site.SourceKind
	if kind == "" {
		kind = "github"
	}
	job, err := s.deploy.Start(deploy.Request{
		Slug:          site.Slug,
		Tenant:        site.TenantUser,
		Domain:        site.Domain,
		Runtime:       site.Runtime,
		Version:       site.Version,
		Framework:     site.Framework,
		WebServer:     site.WebServer,
		Port:          site.Port,
		SSL:           site.SSL,
		TunnelEnabled: site.TunnelEnable,
		Source:        deploy.SourceSpec{Kind: kind, Repo: site.SourceRepo, Branch: site.SourceBranch},
		Redeploy:      true,
		Trigger:       "webhook",
	})
	if err != nil {
		// A second push while the first is still building is normal; it is not an error for the
		// provider, which would otherwise retry and log a failure on every push.
		if errors.Is(err, deploy.ErrDeployInProgress) {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":      false,
				"status":  "ignored",
				"message": err.Error(),
			})
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "Could not start the auto-deploy: "+err.Error())
		return
	}

	_ = s.store.Audit("system:webhook", "website.auto_deploy", site.Slug, clientIP(r), "job="+job.ID)

	writeJSON(w, http.StatusAccepted, map[string]any{
		"ok":         true,
		"status":     "deploying",
		"slug":       site.Slug,
		"deployId":   job.ID,
		"totalSteps": job.TotalSteps,
		"stream":     "/api/v1/websites/" + site.Slug + "/deploy/stream?id=" + job.ID,
	})
}

// handleGetDeployKey returns the ED25519 public key and fingerprint for this website.
func (s *Server) handleGetDeployKey(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	info, err := s.host.EnsureDeployKey(r.Context(), site.TenantUser, site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not load or generate deploy key: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, info)
}

// handleRotateDeployKey generates a brand new ED25519 deploy keypair for this website.
func (s *Server) handleRotateDeployKey(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	info, err := s.host.RotateDeployKey(r.Context(), site.TenantUser, site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not rotate deploy key: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "website.rotate_deploy_key", site.Slug, clientIP(r), "fp="+info.Fingerprint)
	writeJSON(w, http.StatusOK, info)
}

// WebsiteGitStatus holds comprehensive git status for a website, combining
// stored repository metadata, auto-detected disk repository info, auto-deploy toggle,
// webhook URL, detected framework CI/CD recommendations, and deploy key.
type WebsiteGitStatus struct {
	Detected      bool   `json:"detected"`
	Repo          string `json:"repo"`
	Branch        string `json:"branch"`
	Commit        string `json:"commit,omitempty"`
	CommitMessage string `json:"commitMessage,omitempty"`
	AutoDeploy    bool   `json:"autoDeploy"`
	// AutoDeployMode tells the UI which path is actually active instead of implying that every
	// auto-deploy installs a webhook: "webhook", "poll" or "none".
	AutoDeployMode    string `json:"autoDeployMode"`
	AutoDeployPollSec int    `json:"autoDeployPollSec,omitempty"`
	// LastGitPollAt lets the Deploy tab say when the watcher last looked, instead of leaving the
	// operator to guess whether polling is alive.
	LastGitPollAt   string                       `json:"lastGitPollAt,omitempty"`
	DeployHookToken string                       `json:"deployHookToken"`
	WebhookURL      string                       `json:"webhookUrl"`
	DeployScript    string                       `json:"deployScript,omitempty"`
	Framework       *framework.DetectedFramework `json:"framework,omitempty"`
	DeployKey       *host.DeployKeyInfo          `json:"deployKey,omitempty"`
}

// handleGetWebsiteGit returns the full git status, auto-detected repository,
// webhook URL, detected framework, and deploy key.
func (s *Server) handleGetWebsiteGit(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	detectedInfo, _ := s.host.DetectGit(r.Context(), site.TenantUser, site.Slug)
	if detectedInfo == nil {
		detectedInfo = &host.GitDetectInfo{Detected: false}
	}

	activeRepo := site.SourceRepo
	if activeRepo == "" && detectedInfo.Detected && detectedInfo.Repo != "" {
		activeRepo = detectedInfo.Repo
		// If website had no repo in DB but .git exists on disk, auto-sync DB
		_ = s.store.UpdateWebsiteGit(site.Slug, activeRepo, detectedInfo.Branch, site.AutoDeploy, gitSourceKind(activeRepo))
	}

	activeBranch := site.SourceBranch
	if activeBranch == "" {
		if detectedInfo.Branch != "" {
			activeBranch = detectedInfo.Branch
		} else {
			activeBranch = "main"
		}
	}

	keyInfo, _ := s.host.EnsureDeployKey(r.Context(), site.TenantUser, site.Slug)

	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	webhookURL := fmt.Sprintf("%s://%s/api/v1/webhooks/deploy/%s?token=%s", scheme, r.Host, site.Slug, site.DeployHookToken)

	detectedFw := s.host.DetectFramework(site.TenantUser, site.Slug)

	autoDeployMode := site.AutoDeployMode
	if !site.AutoDeploy {
		autoDeployMode = "none"
	} else if autoDeployMode == "" {
		// Legacy row: auto_deploy meant only "a manual webhook may call me". Reporting "poll"
		// would claim the watcher is running when it deliberately is not.
		autoDeployMode = "none"
	}

	status := WebsiteGitStatus{
		Detected:          detectedInfo.Detected || activeRepo != "",
		Repo:              activeRepo,
		Branch:            activeBranch,
		Commit:            detectedInfo.Commit,
		CommitMessage:     detectedInfo.CommitMessage,
		AutoDeploy:        site.AutoDeploy,
		AutoDeployMode:    autoDeployMode,
		AutoDeployPollSec: site.AutoDeployPollSec,
		LastGitPollAt:     site.LastGitPollAt,
		DeployHookToken:   site.DeployHookToken,
		WebhookURL:        webhookURL,
		DeployScript:      site.DeployScript,
		Framework:         detectedFw,
		DeployKey:         keyInfo,
	}

	writeJSON(w, http.StatusOK, status)
}

type updateGitPayload struct {
	Repo *string `json:"repo"`
	// RepoURL is the name the contract uses. Both are accepted so an API client written against
	// the document and the panel's own client keep working.
	RepoURL      *string `json:"repoUrl"`
	Branch       *string `json:"branch"`
	AutoDeploy   *bool   `json:"autoDeploy"`
	DeployScript *string `json:"deployScript"`
}

// handleUpdateWebsiteGit updates repository, branch, auto_deploy settings, and deploy_script.
// gitSourceKind maps a repository URL to the source kind the deploy pipeline understands.
func gitSourceKind(repo string) string {
	if strings.TrimSpace(repo) == "" {
		return ""
	}
	switch {
	case strings.HasSuffix(repoHost(repo), "github.com"):
		return "github"
	case strings.HasSuffix(repoHost(repo), "gitlab.com"):
		return "gitlab"
	case strings.HasSuffix(repoHost(repo), "bitbucket.org"):
		return "bitbucket"
	default:
		return "git"
	}
}

func (s *Server) handleUpdateWebsiteGit(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req updateGitPayload
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	newRepo := site.SourceRepo
	if req.Repo != nil {
		newRepo = strings.TrimSpace(*req.Repo)
	} else if req.RepoURL != nil {
		newRepo = strings.TrimSpace(*req.RepoURL)
	}
	newBranch := site.SourceBranch
	if req.Branch != nil {
		newBranch = strings.TrimSpace(*req.Branch)
	}
	if newBranch == "" {
		newBranch = "main"
	}
	autoDeploy := site.AutoDeploy
	if req.AutoDeploy != nil {
		autoDeploy = *req.AutoDeploy
	}

	newKind := ""
	if newRepo != "" {
		newKind = gitSourceKind(newRepo)
	} else if site.SourceRepo != "" {
		// Disconnecting Git: keep the local files but stop treating them as a checkout.
		newKind = "existing"
	}
	if err := s.store.UpdateWebsiteGit(site.Slug, newRepo, newBranch, autoDeploy, newKind); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save git settings")
		return
	}
	// Keep the mode consistent with the toggle: turning auto-deploy on without choosing a path
	// means polling (no inbound port required); turning it off clears the mode.
	mode := site.AutoDeployMode
	if !autoDeploy {
		mode = "none"
	} else if mode == "" || mode == "none" {
		mode = "poll"
	}
	_ = s.store.SetWebsiteAutoDeploy(site.Slug, autoDeploy, mode, site.AutoDeployPollSec)

	if req.DeployScript != nil {
		_ = s.store.UpdateWebsiteDeployScript(site.Slug, *req.DeployScript)
	}

	updated, err := s.store.WebsiteBySlug(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not reload website")
		return
	}

	// A webhook-mode site whose repository (or the panel's hostname) changed must update the hook
	// instead of leaving GitHub calling the old URL. Background, because saving should not wait on
	// a network round-trip.
	if updated.AutoDeploy && updated.AutoDeployMode == "webhook" {
		if base := s.publicPanelBaseURL(r); base != "" {
			siteCopy := *updated
			userCopy := *user
			webhookURL := strings.TrimSuffix(base, "/") +
				"/api/v1/webhooks/deploy/" + updated.Slug + "?token=" + updated.DeployHookToken
			go s.registerWebhookAfterCreate(&siteCopy, &userCopy, webhookURL)
		}
	}

	_ = s.store.Audit(user.ID, "website.update_git", site.Slug, clientIP(r), fmt.Sprintf("repo=%s, branch=%s, autoDeploy=%t", newRepo, newBranch, autoDeploy))
	writeJSON(w, http.StatusOK, updated)
}

// setAutoDeployRequest is the body of POST /websites/:slug/git/auto-deploy.
type setAutoDeployRequest struct {
	Enabled         bool   `json:"enabled"`
	Mode            string `json:"mode"` // auto | webhook | poll
	PollIntervalSec int    `json:"pollIntervalSec"`
}

// handleSetWebsiteAutoDeploy resolves and stores how push-to-deploy works for one site:
//   - "webhook": the panel registers a GitHub webhook using the tenant's stored PAT. It needs a
//     public panel address and a token with admin:repo_hook.
//   - "poll": the in-daemon git_commit_watcher checks the remote branch and deploys new commits.
//     It works on a private LAN where GitHub cannot reach the panel.
//   - "auto": try webhook, fall back to poll. This is the zero-config path the UI asks for.
func (s *Server) handleSetWebsiteAutoDeploy(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}

	var req setAutoDeployRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	if req.Enabled && strings.TrimSpace(site.SourceRepo) == "" {
		writeError(w, http.StatusConflict, "git_not_configured", "Connect a Git repository before enabling auto-deploy")
		return
	}

	pollSec := req.PollIntervalSec
	if pollSec == 0 {
		pollSec = 300
	}
	if pollSec < 60 || pollSec > 86400 {
		writeError(w, http.StatusBadRequest, "validation_error", "pollIntervalSec must be between 60 and 86400")
		return
	}

	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	if mode == "" {
		mode = "auto"
	}
	if mode != "auto" && mode != "webhook" && mode != "poll" {
		writeError(w, http.StatusBadRequest, "validation_error", "mode must be auto, webhook or poll")
		return
	}

	webhookURL := siteWebhookURL(r, site)
	webhookRegistered := false
	message := ""

	if !req.Enabled {
		mode = "none"
		// Removing the hook is what makes "disabled" true outside the panel too; otherwise a push
		// would still call the endpoint and be ignored. Best-effort: a provider outage must not
		// stop the operator from turning auto-deploy off locally.
		if removed, detail := s.unregisterWebhook(r.Context(), site, user); removed > 0 {
			message = fmt.Sprintf("auto-deploy disabled; %s", detail)
		} else if detail != "" {
			message = "auto-deploy disabled; hook cleanup: " + detail
		}
	} else {
		switch mode {
		case "auto":
			// Only try the webhook when the panel has an address the provider can reach;
			// otherwise registration fails for the ordinary private-LAN case and slows the request.
			if s.publicPanelBaseURL(r) != "" {
				webhookRegistered, message = s.registerWebhook(r.Context(), site, user, webhookURL)
			} else {
				message = "no public panel address detected; using commit polling"
			}
			if webhookRegistered {
				mode = "webhook"
			} else {
				mode = "poll"
			}
		case "webhook":
			webhookRegistered, message = s.registerWebhook(r.Context(), site, user, webhookURL)
			if !webhookRegistered {
				// An explicit webhook request must not silently become polling: the operator asked
				// for this path and needs the reason.
				writeError(w, http.StatusBadGateway, "webhook_registration_failed", message)
				return
			}
			mode = "webhook"
		case "poll":
			mode = "poll"
			message = "commit polling enabled"
		}
	}

	if err := s.store.SetWebsiteAutoDeploy(site.Slug, req.Enabled, mode, pollSec); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save auto-deploy settings")
		return
	}

	_ = s.store.Audit(user.ID, "website.auto_deploy_config", site.Slug, clientIP(r),
		fmt.Sprintf("enabled=%t mode=%s poll=%ds webhook=%t", req.Enabled, mode, pollSec, webhookRegistered))

	resp := map[string]any{
		"status":            "ok",
		"enabled":           req.Enabled,
		"mode":              mode,
		"webhookRegistered": webhookRegistered,
		"pollIntervalSec":   pollSec,
	}
	if mode == "webhook" {
		resp["webhookUrl"] = webhookURL
	}
	if message != "" {
		resp["message"] = message
	}
	writeJSON(w, http.StatusOK, resp)
}

// siteWebhookURL is the public endpoint GitHub (or any Git host) calls on push.
func siteWebhookURL(r *http.Request, site *store.Website) string {
	return requestBaseURL(r) + "/api/v1/webhooks/deploy/" + site.Slug + "?token=" + site.DeployHookToken
}

// requestBaseURL is the address the client used, including the forwarded scheme when a tunnel
// terminates TLS in front of the daemon.
func requestBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

// publicPanelBaseURL returns a base URL GitHub could reach, or "" when the panel is only on a
// private address. It prefers the published panel hostname because a LAN IP in a webhook URL is
// useless to GitHub.
func (s *Server) publicPanelBaseURL(r *http.Request) string {
	if fqdn, err := s.store.PanelSetting(panelFQDNKey); err == nil && strings.TrimSpace(fqdn) != "" {
		return "https://" + strings.TrimSpace(fqdn)
	}
	host := requestHostname(r.Host)
	if isPublicHostname(host) {
		return strings.TrimSuffix(requestBaseURL(r), "/")
	}
	return ""
}

func requestHostname(hostport string) string {
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(hostport, "[]")
}

func isPublicHostname(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified())
	}
	if host == "localhost" ||
		strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".lan") ||
		strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".test") {
		return false
	}
	// GitHub cannot resolve a single-label name such as "panel" or "proxmox".
	return strings.Contains(host, ".")
}

// githubRepoPath extracts owner and repository from the URL forms the wizard accepts.
func githubRepoPath(repo string) (owner, name string, ok bool) {
	repo = strings.TrimSpace(repo)
	if repo == "" {
		return "", "", false
	}
	repo = strings.TrimSuffix(repo, ".git")

	// scp-like form: git@github.com:owner/repo
	if i := strings.Index(repo, "github.com:"); i >= 0 {
		repo = repo[i+len("github.com:"):]
	} else if u, err := url.Parse(repo); err == nil && u.Host != "" {
		if !strings.EqualFold(u.Host, "github.com") && !strings.EqualFold(u.Host, "www.github.com") {
			return "", "", false
		}
		repo = strings.TrimPrefix(u.Path, "/")
	}

	parts := strings.Split(repo, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// githubTokenForSite finds a GitHub PAT the site owner connected in Profile. An admin deploying
// for a tenant uses the tenant's token first, because that is the account with access to the repo.
func (s *Server) githubTokenForSite(site *store.Website, caller *store.User) string {
	userID := caller.ID
	if owner, err := s.store.UserByUsername(site.TenantUser); err == nil {
		userID = owner.ID
	}
	find := func(id string) string {
		providers, err := s.store.ListUserGitProviders(id)
		if err != nil {
			return ""
		}
		for _, p := range providers {
			if !strings.EqualFold(p.Provider, "github") || p.TokenCipher == "" {
				continue
			}
			if token, err := secrets.Decrypt(s.key, p.TokenCipher); err == nil {
				return token
			}
		}
		return ""
	}
	if token := find(userID); token != "" {
		return token
	}
	if caller.ID != userID {
		return find(caller.ID)
	}
	return ""
}

// githubHook is the subset of GitHub's hook object the panel needs.
type githubHook struct {
	ID     int64 `json:"id"`
	Active bool  `json:"active"`
	Config struct {
		URL string `json:"url"`
	} `json:"config"`
}

// webhookPayload is shared by create and update so the two requests can never drift.
func webhookPayload(webhookURL string) map[string]any {
	return map[string]any{
		"name":   "web",
		"active": true,
		"events": []string{"push"},
		"config": map[string]string{
			"url":          webhookURL,
			"content_type": "json",
			"insecure_ssl": "0",
		},
	}
}

// gitHubRefusal turns a status into the advice an operator can act on, instead of a bare number.
func gitHubRefusal(status int, body []byte) string {
	switch status {
	case http.StatusUnauthorized:
		return "GitHub rejected the token (401); reconnect it in Profile"
	case http.StatusForbidden:
		return "GitHub refused (403): the token needs admin:repo_hook and access to this repository"
	case http.StatusNotFound:
		return "GitHub cannot see this repository (404); check the repository URL and the token's repository access"
	}
	return fmt.Sprintf("GitHub returned HTTP %d: %s", status, strings.TrimSpace(string(body)))
}

// githubHookRequest performs one API call with the panel's headers and a bounded body read.
func (s *Server) githubHookRequest(ctx context.Context, method, token, endpoint string, payload any) ([]byte, int, error) {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, 0, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "BarePod-Panel")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return data, resp.StatusCode, nil
}

// listGitHubHooks reads the repository's hooks, which is how a stale URL is updated rather than
// duplicated and how disabling auto-deploy can remove the hook it once created.
func (s *Server) listGitHubHooks(ctx context.Context, token, owner, repo string) ([]githubHook, error) {
	endpoint := githubAPIBase + "/repos/" + owner + "/" + repo + "/hooks"
	data, status, err := s.githubHookRequest(ctx, "GET", token, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%s", gitHubRefusal(status, data))
	}
	var hooks []githubHook
	if err := json.Unmarshal(data, &hooks); err != nil {
		return nil, fmt.Errorf("could not read GitHub's hook list: %w", err)
	}
	return hooks, nil
}

// findSiteHook matches the hook this panel owns for a website, whichever webhook alias it uses.
func findSiteHook(hooks []githubHook, slug string) *githubHook {
	for i := range hooks {
		url := hooks[i].Config.URL
		if hookMatchesSite(url, slug) {
			return &hooks[i]
		}
	}
	return nil
}

// registerGitHubWebhook asks GitHub to call the panel on every push. It updates an existing hook
// whose URL changed (the panel's hostname moved) instead of creating a duplicate, and treats a 422
// "already exists" as success because that is the desired end state.
func (s *Server) registerGitHubWebhook(ctx context.Context, site *store.Website, caller *store.User, webhookURL string) (bool, string) {
	owner, repo, ok := githubRepoPath(site.SourceRepo)
	if !ok {
		return false, "the repository URL is not a GitHub owner/repo"
	}
	token := s.githubTokenForSite(site, caller)
	if token == "" {
		return false, "connect a GitHub token in Profile (scope repo + admin:repo_hook) to register webhooks"
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	hooksURL := githubAPIBase + "/repos/" + owner + "/" + repo + "/hooks"

	hooks, err := s.listGitHubHooks(ctx, token, owner, repo)
	if err == nil {
		if existing := findSiteHook(hooks, site.Slug); existing != nil {
			if existing.Active && strings.TrimSpace(existing.Config.URL) == webhookURL {
				return true, "webhook already registered"
			}
			data, status, err := s.githubHookRequest(ctx, "PATCH",
				token, fmt.Sprintf("%s/%d", hooksURL, existing.ID), webhookPayload(webhookURL))
			if err != nil {
				return false, "GitHub could not be reached: " + err.Error()
			}
			if status == http.StatusOK {
				return true, "webhook updated"
			}
			return false, gitHubRefusal(status, data)
		}
	}

	data, status, err := s.githubHookRequest(ctx, "POST", token, hooksURL, webhookPayload(webhookURL))
	if err != nil {
		return false, "GitHub could not be reached: " + err.Error()
	}
	switch status {
	case http.StatusCreated, http.StatusOK:
		return true, "webhook registered"
	case http.StatusUnprocessableEntity:
		if strings.Contains(strings.ToLower(string(data)), "already exists") {
			return true, "webhook already registered"
		}
		return false, "GitHub refused the webhook: " + strings.TrimSpace(string(data))
	default:
		return false, gitHubRefusal(status, data)
	}
}

// unregisterGitHubWebhook removes the hooks this panel created for a site. The panel stores the
// repository URL rather than a hook id, so the list is matched by the webhook path.
func (s *Server) unregisterGitHubWebhook(ctx context.Context, site *store.Website, caller *store.User) (int, string) {
	owner, repo, ok := githubRepoPath(site.SourceRepo)
	if !ok {
		return 0, ""
	}
	token := s.githubTokenForSite(site, caller)
	if token == "" {
		return 0, ""
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	hooksURL := githubAPIBase + "/repos/" + owner + "/" + repo + "/hooks"

	hooks, err := s.listGitHubHooks(ctx, token, owner, repo)
	if err != nil {
		return 0, err.Error()
	}
	removed := 0
	for _, hook := range hooks {
		if findSiteHook([]githubHook{hook}, site.Slug) == nil {
			continue
		}
		data, status, err := s.githubHookRequest(ctx, "DELETE",
			token, fmt.Sprintf("%s/%d", hooksURL, hook.ID), nil)
		if err != nil {
			return removed, "GitHub could not be reached: " + err.Error()
		}
		if status == http.StatusNoContent || status == http.StatusOK {
			removed++
			continue
		}
		return removed, gitHubRefusal(status, data)
	}
	return removed, fmt.Sprintf("removed %d hook(s)", removed)
}

// handleCheckWebsiteGit runs the commit watcher's decision for one site on demand. It is what the
// Deploy tab's "Check now" button uses, so an operator does not have to wait for the next tick.
func (s *Server) handleCheckWebsiteGit(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	slug := r.PathValue("slug")
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	if strings.TrimSpace(site.SourceRepo) == "" || !isGitSourceKind(site.SourceKind) {
		writeError(w, http.StatusConflict, "git_not_configured", "This website has no Git repository to check")
		return
	}

	local, err := s.host.LocalGitSHA(site.TenantUser, site.Slug)
	if err != nil {
		writeError(w, http.StatusConflict, "not_git_checkout", "The website directory is not a Git checkout")
		return
	}
	remote, err := s.host.RemoteGitHead(r.Context(), site.TenantUser, site.Slug, site.SourceRepo, site.SourceBranch)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream_error", "Could not read the remote branch: "+err.Error())
		return
	}
	_ = s.store.TouchWebsiteGitPoll(site.Slug)

	if strings.EqualFold(strings.TrimSpace(remote), local) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "up_to_date",
			"local":  local,
			"remote": remote,
		})
		return
	}

	job, err := s.deploy.Start(deploy.Request{
		Slug:          site.Slug,
		Tenant:        site.TenantUser,
		Domain:        site.Domain,
		Runtime:       site.Runtime,
		Version:       site.Version,
		Framework:     site.Framework,
		WebServer:     site.WebServer,
		Port:          site.Port,
		SSL:           site.SSL,
		TunnelEnabled: site.TunnelEnable,
		Source:        deploy.SourceSpec{Kind: site.SourceKind, Repo: site.SourceRepo, Branch: site.SourceBranch},
		Redeploy:      true,
		Trigger:       "poll",
	})
	if err != nil {
		if errors.Is(err, deploy.ErrDeployInProgress) {
			writeError(w, http.StatusConflict, "deploy_in_progress", err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "internal", "Could not start the deploy: "+err.Error())
		return
	}

	_ = s.store.Audit(user.ID, "website.git_check", site.Slug, clientIP(r), "job="+job.ID)
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "deployed",
		"local":    local,
		"remote":   remote,
		"deployId": job.ID,
		"stream":   "/api/v1/websites/" + site.Slug + "/deploy/stream?id=" + job.ID,
	})
}

// registerWebhookAfterCreate upgrades a freshly created site from "poll" to "webhook" when GitHub
// accepts the registration. It runs in its own goroutine after the create response, so a slow or
// unreachable GitHub never delays provisioning; on failure the polling fallback stays in place.
func (s *Server) registerWebhookAfterCreate(site *store.Website, user *store.User, webhookURL string) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	ok, msg := s.registerWebhook(ctx, site, user, webhookURL)
	mode := "poll"
	if ok {
		mode = "webhook"
		_ = s.store.SetWebsiteAutoDeploy(site.Slug, true, "webhook", site.AutoDeployPollSec)
	}
	_ = s.store.Audit(user.ID, "website.auto_deploy_config", site.Slug, "",
		fmt.Sprintf("mode=%s webhook=%t detail=%s", mode, ok, msg))
}

// --- User Git Providers ---

func (s *Server) handleListUserGitProviders(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	providers, err := s.store.ListUserGitProviders(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not fetch git providers")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": providers})
}

type createGitProviderRequest struct {
	Provider string `json:"provider"`
	Name     string `json:"name"`
	APIURL   string `json:"apiUrl"`
	BaseURL  string `json:"baseUrl"`
	Token    string `json:"token"`
	Username string `json:"username"`
}

func (s *Server) handleCreateUserGitProvider(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req createGitProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	prov := strings.ToLower(strings.TrimSpace(req.Provider))
	if prov == "" {
		prov = "github"
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = strings.ToUpper(prov) + " Account"
	}

	apiURL := firstNonEmpty(req.APIURL, req.BaseURL)
	username := strings.TrimSpace(req.Username)

	// Verify before storing: a token saved without a check is a connection that looks healthy in
	// Profile and fails later during a deploy. The contract promises validation here.
	token := strings.TrimSpace(req.Token)
	if token != "" {
		check := verifyGitProviderToken(r.Context(), prov, apiURL, token)
		if !check.Valid {
			writeError(w, http.StatusBadRequest, "invalid_token",
				firstNonEmpty(check.Message, "the provider rejected this token"))
			return
		}
		if username == "" {
			username = check.Username
		}
	}

	cipher := ""
	if token != "" {
		var err error
		cipher, err = secrets.Encrypt(s.key, token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not encrypt token")
			return
		}
	}

	p := &store.UserGitProvider{
		UserID:      user.ID,
		Provider:    prov,
		Name:        name,
		APIURL:      apiURL,
		TokenCipher: cipher,
		Username:    username,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}

	if err := s.store.CreateUserGitProvider(p); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not record git provider")
		return
	}

	_ = s.store.Audit(user.ID, "git_provider.create", p.ID, clientIP(r), "provider="+p.Provider)
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handleDeleteUserGitProvider(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	if err := s.store.DeleteUserGitProvider(user.ID, id); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not delete git provider")
		return
	}
	_ = s.store.Audit(user.ID, "git_provider.delete", id, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
