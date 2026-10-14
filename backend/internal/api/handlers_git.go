package api

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
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

	// 3. Inspect branch if provided in JSON payload
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1024*1024))
	if len(body) > 0 {
		var payload struct {
			Ref string `json:"ref"` // e.g. "refs/heads/main"
		}
		if err := json.Unmarshal(body, &payload); err == nil && payload.Ref != "" {
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
	})
	if err != nil {
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
// webhook URL, and deploy key.
type WebsiteGitStatus struct {
	Detected        bool                `json:"detected"`
	Repo            string              `json:"repo"`
	Branch          string              `json:"branch"`
	Commit          string              `json:"commit,omitempty"`
	CommitMessage   string              `json:"commitMessage,omitempty"`
	AutoDeploy      bool                `json:"autoDeploy"`
	DeployHookToken string              `json:"deployHookToken"`
	WebhookURL      string              `json:"webhookUrl"`
	DeployKey       *host.DeployKeyInfo `json:"deployKey,omitempty"`
}

// handleGetWebsiteGit returns the full git status, auto-detected repository,
// webhook URL, and deploy key.
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
		_ = s.store.UpdateWebsiteGit(site.Slug, activeRepo, detectedInfo.Branch, site.AutoDeploy)
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

	status := WebsiteGitStatus{
		Detected:        detectedInfo.Detected || activeRepo != "",
		Repo:            activeRepo,
		Branch:          activeBranch,
		Commit:          detectedInfo.Commit,
		CommitMessage:   detectedInfo.CommitMessage,
		AutoDeploy:      site.AutoDeploy,
		DeployHookToken: site.DeployHookToken,
		WebhookURL:      webhookURL,
		DeployKey:       keyInfo,
	}

	writeJSON(w, http.StatusOK, status)
}

type updateGitPayload struct {
	Repo       *string `json:"repo"`
	Branch     *string `json:"branch"`
	AutoDeploy *bool   `json:"autoDeploy"`
}

// handleUpdateWebsiteGit updates repository, branch, and auto_deploy settings.
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

	if err := s.store.UpdateWebsiteGit(site.Slug, newRepo, newBranch, autoDeploy); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save git settings")
		return
	}

	updated, err := s.store.WebsiteBySlug(site.Slug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not reload website")
		return
	}

	_ = s.store.Audit(user.ID, "website.update_git", site.Slug, clientIP(r), fmt.Sprintf("repo=%s, branch=%s, autoDeploy=%t", newRepo, newBranch, autoDeploy))
	writeJSON(w, http.StatusOK, updated)
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

	cipher := ""
	if req.Token != "" {
		var err error
		cipher, err = secrets.Encrypt(s.key, req.Token)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not encrypt token")
			return
		}
	}

	p := &store.UserGitProvider{
		UserID:      user.ID,
		Provider:    prov,
		Name:        name,
		APIURL:      strings.TrimSpace(req.APIURL),
		TokenCipher: cipher,
		Username:    strings.TrimSpace(req.Username),
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
