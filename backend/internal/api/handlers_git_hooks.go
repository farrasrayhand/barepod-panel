package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// gitHookRef is the common shape the panel needs from any provider's hook list.
type gitHookRef struct {
	ID  string
	URL string
}

// repoHost extracts the hostname from HTTPS and scp-like SSH repository URLs.
func repoHost(repo string) string {
	repo = strings.TrimSpace(repo)
	if repo == "" {
		return ""
	}
	if u, err := url.Parse(repo); err == nil && u.Host != "" {
		return strings.ToLower(u.Hostname())
	}
	// git@github.com:owner/repo.git
	if at := strings.Index(repo, "@"); at >= 0 {
		rest := repo[at+1:]
		if colon := strings.Index(rest, ":"); colon > 0 {
			return strings.ToLower(rest[:colon])
		}
	}
	return ""
}

// repoPathAfterHost returns the provider's project path: owner/repo, or a nested GitLab path.
func repoPathAfterHost(repo string) string {
	repo = strings.TrimSuffix(strings.TrimSpace(repo), ".git")
	if repo == "" {
		return ""
	}
	if u, err := url.Parse(repo); err == nil && u.Host != "" {
		return strings.Trim(strings.TrimPrefix(u.Path, "/"), "/")
	}
	if at := strings.Index(repo, "@"); at >= 0 {
		if colon := strings.Index(repo[at:], ":"); colon >= 0 {
			return strings.Trim(repo[at+colon+1:], "/")
		}
	}
	return strings.Trim(repo, "/")
}

// siteGitProviders lists the site owner's providers first, then the caller's (an admin deploying
// for a tenant may hold the token).
func (s *Server) siteGitProviders(site *store.Website, caller *store.User) []store.UserGitProvider {
	ids := []string{}
	if owner, err := s.store.UserByUsername(site.TenantUser); err == nil {
		ids = append(ids, owner.ID)
	}
	if caller != nil && caller.ID != "" && (len(ids) == 0 || ids[0] != caller.ID) {
		ids = append(ids, caller.ID)
	}
	all := []store.UserGitProvider{}
	for _, id := range ids {
		providers, err := s.store.ListUserGitProviders(id)
		if err != nil {
			continue
		}
		all = append(all, providers...)
	}
	return all
}

// detectGitProvider decides which provider owns this repository. A provider whose configured base
// URL matches the repository host wins, then the well-known cloud hosts, then the source kind.
func (s *Server) detectGitProvider(site *store.Website, caller *store.User) (string, *store.UserGitProvider) {
	host := repoHost(site.SourceRepo)
	providers := s.siteGitProviders(site, caller)
	for i := range providers {
		provider := providers[i]
		base := strings.TrimRight(strings.TrimSpace(provider.APIURL), "/")
		if base != "" {
			if u, err := url.Parse(base); err == nil && strings.EqualFold(u.Hostname(), host) {
				return strings.ToLower(provider.Provider), &provider
			}
		}
	}
	cloud := func(suffix, name string) (string, *store.UserGitProvider) {
		for i := range providers {
			if strings.EqualFold(providers[i].Provider, name) {
				return name, &providers[i]
			}
		}
		return name, nil
	}
	switch {
	case strings.HasSuffix(host, "github.com"):
		return cloud("github.com", "github")
	case strings.HasSuffix(host, "gitlab.com"):
		return cloud("gitlab.com", "gitlab")
	case strings.HasSuffix(host, "bitbucket.org"):
		return cloud("bitbucket.org", "bitbucket")
	}
	switch strings.ToLower(strings.TrimSpace(site.SourceKind)) {
	case "github", "gitlab", "gitea", "forgejo", "bitbucket":
		return cloud("", strings.ToLower(strings.TrimSpace(site.SourceKind)))
	}
	return "custom", nil
}

func (s *Server) providerToken(site *store.Website, caller *store.User, provider string) string {
	for _, candidate := range s.siteGitProviders(site, caller) {
		name := strings.ToLower(candidate.Provider)
		// Forgejo speaks the Gitea API; either label must find the other's token.
		sameForge := (provider == "gitea" || provider == "forgejo") && (name == "gitea" || name == "forgejo")
		if (name != provider && !sameForge) || candidate.TokenCipher == "" {
			continue
		}
		if decrypted, err := secrets.Decrypt(s.key, candidate.TokenCipher); err == nil {
			return decrypted
		}
	}
	return ""
}

func (s *Server) providerAPIBase(site *store.Website, caller *store.User, provider string) string {
	for _, candidate := range s.siteGitProviders(site, caller) {
		name := strings.ToLower(candidate.Provider)
		sameForge := (provider == "gitea" || provider == "forgejo") && (name == "gitea" || name == "forgejo")
		if (name == provider || sameForge) && strings.TrimSpace(candidate.APIURL) != "" {
			return strings.TrimRight(strings.TrimSpace(candidate.APIURL), "/")
		}
	}
	switch provider {
	case "github":
		return githubAPIBase
	case "gitlab":
		return "https://gitlab.com"
	case "bitbucket":
		return "https://api.bitbucket.org/2.0"
	}
	return ""
}

// providerRequest is the shared provider HTTP call with an optional JSON body.
func providerRequest(ctx context.Context, method, endpoint string, headers map[string]string, payload any) ([]byte, int, error) {
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
	req.Header.Set("User-Agent", "BarePod-Panel")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return data, resp.StatusCode, nil
}

// hookMatchesSite requires a slug boundary. A plain substring test would let site "mae" claim
// the hook of "mae2", which means an update could move or delete another tenant's hook.
func hookMatchesSite(hookURL, slug string) bool {
	for _, marker := range []string{"/webhooks/deploy/" + slug, "/webhook/" + slug + "/deploy"} {
		if at := strings.Index(hookURL, marker); at >= 0 {
			rest := hookURL[at+len(marker):]
			if rest == "" || rest[0] == '?' || rest[0] == '/' {
				return true
			}
		}
	}
	return false
}

func providerHookRefusal(provider string, status int, data []byte) string {
	switch status {
	case http.StatusUnauthorized:
		return provider + " rejected the token (401); reconnect it in Profile"
	case http.StatusForbidden:
		return provider + " refused (403): the token needs permission to manage repository hooks"
	case http.StatusNotFound:
		return provider + " cannot see this repository (404); check the URL and the token's access"
	}
	return fmt.Sprintf("%s returned HTTP %d: %s", provider, status, strings.TrimSpace(string(data)))
}

// --- GitLab ---

func gitlabHookHeaders(token string) map[string]string {
	return map[string]string{"PRIVATE-TOKEN": token}
}

func (s *Server) gitlabHooks(ctx context.Context, base, token, project string) ([]gitHookRef, error) {
	data, status, err := providerRequest(ctx, http.MethodGet,
		base+"/api/v4/projects/"+url.PathEscape(project)+"/hooks", gitlabHookHeaders(token), nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%s", providerHookRefusal("GitLab", status, data))
	}
	var raw []struct {
		ID  int64  `json:"id"`
		URL string `json:"url"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := make([]gitHookRef, 0, len(raw))
	for _, hook := range raw {
		out = append(out, gitHookRef{ID: fmt.Sprintf("%d", hook.ID), URL: hook.URL})
	}
	return out, nil
}

func (s *Server) registerGitLabWebhook(ctx context.Context, site *store.Website, caller *store.User, webhookURL string) (bool, string) {
	base := s.providerAPIBase(site, caller, "gitlab")
	token := s.providerToken(site, caller, "gitlab")
	if token == "" {
		return false, "connect a GitLab token in Profile (api scope) to register webhooks"
	}
	project := repoPathAfterHost(site.SourceRepo)
	payload := map[string]any{"url": webhookURL, "push_events": true, "enable_ssl_verification": true}
	hooksURL := base + "/api/v4/projects/" + url.PathEscape(project) + "/hooks"

	if hooks, err := s.gitlabHooks(ctx, base, token, project); err == nil {
		for _, hook := range hooks {
			if !hookMatchesSite(hook.URL, site.Slug) {
				continue
			}
			if hook.URL == webhookURL {
				return true, "GitLab webhook already registered"
			}
			data, status, err := providerRequest(ctx, http.MethodPut, hooksURL+"/"+hook.ID, gitlabHookHeaders(token), payload)
			if err != nil {
				return false, err.Error()
			}
			if status == http.StatusOK {
				return true, "GitLab webhook updated"
			}
			return false, providerHookRefusal("GitLab", status, data)
		}
	}
	data, status, err := providerRequest(ctx, http.MethodPost, hooksURL, gitlabHookHeaders(token), payload)
	if err != nil {
		return false, err.Error()
	}
	if status == http.StatusCreated || status == http.StatusOK {
		return true, "GitLab webhook registered"
	}
	return false, providerHookRefusal("GitLab", status, data)
}

func (s *Server) unregisterGitLabWebhook(ctx context.Context, site *store.Website, caller *store.User) (int, string) {
	base := s.providerAPIBase(site, caller, "gitlab")
	token := s.providerToken(site, caller, "gitlab")
	if token == "" {
		return 0, ""
	}
	project := repoPathAfterHost(site.SourceRepo)
	hooksURL := base + "/api/v4/projects/" + url.PathEscape(project) + "/hooks"
	hooks, err := s.gitlabHooks(ctx, base, token, project)
	if err != nil {
		return 0, err.Error()
	}
	removed := 0
	for _, hook := range hooks {
		if !hookMatchesSite(hook.URL, site.Slug) {
			continue
		}
		data, status, err := providerRequest(ctx, http.MethodDelete, hooksURL+"/"+hook.ID, gitlabHookHeaders(token), nil)
		if err != nil {
			return removed, err.Error()
		}
		if status == http.StatusNoContent || status == http.StatusOK {
			removed++
			continue
		}
		return removed, providerHookRefusal("GitLab", status, data)
	}
	return removed, fmt.Sprintf("removed %d hook(s)", removed)
}

// --- Gitea / Forgejo ---

func giteaHookHeaders(token string) map[string]string {
	return map[string]string{"Authorization": "token " + token}
}

func (s *Server) giteaHooks(ctx context.Context, base, token, project string) ([]gitHookRef, error) {
	data, status, err := providerRequest(ctx, http.MethodGet, base+"/api/v1/repos/"+project+"/hooks", giteaHookHeaders(token), nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%s", providerHookRefusal("Gitea", status, data))
	}
	var raw []struct {
		ID     int64 `json:"id"`
		Config struct {
			URL string `json:"url"`
		} `json:"config"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	out := make([]gitHookRef, 0, len(raw))
	for _, hook := range raw {
		out = append(out, gitHookRef{ID: fmt.Sprintf("%d", hook.ID), URL: hook.Config.URL})
	}
	return out, nil
}

func (s *Server) registerGiteaWebhook(ctx context.Context, site *store.Website, caller *store.User, webhookURL string) (bool, string) {
	base := s.providerAPIBase(site, caller, "gitea")
	token := s.providerToken(site, caller, "gitea")
	if base == "" || token == "" {
		return false, "set the Gitea base URL and token in Profile to register webhooks"
	}
	project := repoPathAfterHost(site.SourceRepo)
	hooksURL := base + "/api/v1/repos/" + project + "/hooks"
	payload := map[string]any{
		"type": "gitea", "active": true, "events": []string{"push"},
		"config": map[string]string{"url": webhookURL, "content_type": "json"},
	}

	if hooks, err := s.giteaHooks(ctx, base, token, project); err == nil {
		for _, hook := range hooks {
			if !hookMatchesSite(hook.URL, site.Slug) {
				continue
			}
			if hook.URL == webhookURL {
				return true, "Gitea webhook already registered"
			}
			data, status, err := providerRequest(ctx, http.MethodPatch, hooksURL+"/"+hook.ID, giteaHookHeaders(token), payload)
			if err != nil {
				return false, err.Error()
			}
			if status == http.StatusOK {
				return true, "Gitea webhook updated"
			}
			return false, providerHookRefusal("Gitea", status, data)
		}
	}
	data, status, err := providerRequest(ctx, http.MethodPost, hooksURL, giteaHookHeaders(token), payload)
	if err != nil {
		return false, err.Error()
	}
	if status == http.StatusCreated || status == http.StatusOK {
		return true, "Gitea webhook registered"
	}
	return false, providerHookRefusal("Gitea", status, data)
}

func (s *Server) unregisterGiteaWebhook(ctx context.Context, site *store.Website, caller *store.User) (int, string) {
	base := s.providerAPIBase(site, caller, "gitea")
	token := s.providerToken(site, caller, "gitea")
	if base == "" || token == "" {
		return 0, ""
	}
	project := repoPathAfterHost(site.SourceRepo)
	hooksURL := base + "/api/v1/repos/" + project + "/hooks"
	hooks, err := s.giteaHooks(ctx, base, token, project)
	if err != nil {
		return 0, err.Error()
	}
	removed := 0
	for _, hook := range hooks {
		if !hookMatchesSite(hook.URL, site.Slug) {
			continue
		}
		data, status, err := providerRequest(ctx, http.MethodDelete, hooksURL+"/"+hook.ID, giteaHookHeaders(token), nil)
		if err != nil {
			return removed, err.Error()
		}
		if status == http.StatusNoContent || status == http.StatusOK {
			removed++
			continue
		}
		return removed, providerHookRefusal("Gitea", status, data)
	}
	return removed, fmt.Sprintf("removed %d hook(s)", removed)
}

// --- Bitbucket ---

func bitbucketHookHeaders(token string) map[string]string {
	return map[string]string{"Authorization": "Bearer " + token}
}

func (s *Server) bitbucketHooks(ctx context.Context, base, token, project string) ([]gitHookRef, error) {
	data, status, err := providerRequest(ctx, http.MethodGet, base+"/repositories/"+project+"/hooks", bitbucketHookHeaders(token), nil)
	if err != nil {
		return nil, err
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("%s", providerHookRefusal("Bitbucket", status, data))
	}
	var payload struct {
		Values []struct {
			ID  int    `json:"id"`
			URL string `json:"url"`
		} `json:"values"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, err
	}
	out := make([]gitHookRef, 0, len(payload.Values))
	for _, hook := range payload.Values {
		out = append(out, gitHookRef{ID: fmt.Sprintf("%d", hook.ID), URL: hook.URL})
	}
	return out, nil
}

func (s *Server) registerBitbucketWebhook(ctx context.Context, site *store.Website, caller *store.User, webhookURL string) (bool, string) {
	base := s.providerAPIBase(site, caller, "bitbucket")
	token := s.providerToken(site, caller, "bitbucket")
	if token == "" {
		return false, "connect a Bitbucket token in Profile to register webhooks"
	}
	project := repoPathAfterHost(site.SourceRepo)
	hooksURL := base + "/repositories/" + project + "/hooks"
	payload := map[string]any{
		"description": "BarePod Panel", "url": webhookURL, "active": true,
		"events": []string{"repo:push"},
	}

	if hooks, err := s.bitbucketHooks(ctx, base, token, project); err == nil {
		for _, hook := range hooks {
			if !hookMatchesSite(hook.URL, site.Slug) {
				continue
			}
			if hook.URL == webhookURL {
				return true, "Bitbucket webhook already registered"
			}
			data, status, err := providerRequest(ctx, http.MethodPut, hooksURL+"/"+hook.ID, bitbucketHookHeaders(token), payload)
			if err != nil {
				return false, err.Error()
			}
			if status == http.StatusOK {
				return true, "Bitbucket webhook updated"
			}
			return false, providerHookRefusal("Bitbucket", status, data)
		}
	}
	data, status, err := providerRequest(ctx, http.MethodPost, hooksURL, bitbucketHookHeaders(token), payload)
	if err != nil {
		return false, err.Error()
	}
	if status == http.StatusCreated || status == http.StatusOK {
		return true, "Bitbucket webhook registered"
	}
	return false, providerHookRefusal("Bitbucket", status, data)
}

func (s *Server) unregisterBitbucketWebhook(ctx context.Context, site *store.Website, caller *store.User) (int, string) {
	base := s.providerAPIBase(site, caller, "bitbucket")
	token := s.providerToken(site, caller, "bitbucket")
	if token == "" {
		return 0, ""
	}
	project := repoPathAfterHost(site.SourceRepo)
	hooksURL := base + "/repositories/" + project + "/hooks"
	hooks, err := s.bitbucketHooks(ctx, base, token, project)
	if err != nil {
		return 0, err.Error()
	}
	removed := 0
	for _, hook := range hooks {
		if !hookMatchesSite(hook.URL, site.Slug) {
			continue
		}
		data, status, err := providerRequest(ctx, http.MethodDelete, hooksURL+"/"+hook.ID, bitbucketHookHeaders(token), nil)
		if err != nil {
			return removed, err.Error()
		}
		if status == http.StatusNoContent || status == http.StatusOK {
			removed++
			continue
		}
		return removed, providerHookRefusal("Bitbucket", status, data)
	}
	return removed, fmt.Sprintf("removed %d hook(s)", removed)
}

// --- dispatcher ---

// registerWebhook selects the provider's own hook API. Custom Git has no standard hook endpoint,
// so it answers honestly and the commit watcher remains the fallback.
func (s *Server) registerWebhook(ctx context.Context, site *store.Website, caller *store.User, webhookURL string) (bool, string) {
	provider, _ := s.detectGitProvider(site, caller)
	switch provider {
	case "github":
		return s.registerGitHubWebhook(ctx, site, caller, webhookURL)
	case "gitlab":
		return s.registerGitLabWebhook(ctx, site, caller, webhookURL)
	case "gitea", "forgejo":
		return s.registerGiteaWebhook(ctx, site, caller, webhookURL)
	case "bitbucket":
		return s.registerBitbucketWebhook(ctx, site, caller, webhookURL)
	default:
		return false, "auto-registration is not supported for " + provider + "; commit polling will be used"
	}
}

func (s *Server) unregisterWebhook(ctx context.Context, site *store.Website, caller *store.User) (int, string) {
	provider, _ := s.detectGitProvider(site, caller)
	switch provider {
	case "github":
		return s.unregisterGitHubWebhook(ctx, site, caller)
	case "gitlab":
		return s.unregisterGitLabWebhook(ctx, site, caller)
	case "gitea", "forgejo":
		return s.unregisterGiteaWebhook(ctx, site, caller)
	case "bitbucket":
		return s.unregisterBitbucketWebhook(ctx, site, caller)
	default:
		return 0, ""
	}
}
