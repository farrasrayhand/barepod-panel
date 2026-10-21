package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// githubAPIBase is the public API in production. It is a variable only so tests can point every
// provider call at an httptest server instead of the real GitHub.
var githubAPIBase = "https://api.github.com"

// providerGET is the one HTTP shape the provider clients share: context-bound, a bounded
// response body, and the caller's auth header. A provider's own error text stays available so
// the UI can say why discovery failed instead of returning an empty list.
func providerGET(ctx context.Context, endpoint string, headers map[string]string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", "BarePod-Panel")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return data, resp.StatusCode, nil
}

type testGitProviderRequest struct {
	Provider string `json:"provider"`
	APIURL   string `json:"apiUrl,omitempty"`
	// BaseURL is the contract's name for a self-hosted instance; apiUrl is kept for the panel's
	// own client and older clients.
	BaseURL string `json:"baseUrl,omitempty"`
	Token   string `json:"token"`
}

type testGitProviderResponse struct {
	Valid     bool     `json:"valid"`
	Username  string   `json:"username,omitempty"`
	AvatarURL string   `json:"avatarUrl,omitempty"`
	Scopes    []string `json:"scopes,omitempty"`
	Message   string   `json:"message,omitempty"`
}

type gitRepoItem struct {
	Name          string `json:"name"`
	FullName      string `json:"fullName"`
	DefaultBranch string `json:"defaultBranch"`
	Private       bool   `json:"isPrivate"`
	CloneURL      string `json:"cloneUrl"`
	SSHURL        string `json:"sshUrl"`
	HTMLURL       string `json:"htmlUrl"`
	Description   string `json:"description,omitempty"`
}

type gitBranchItem struct {
	Name      string `json:"name"`
	IsDefault bool   `json:"isDefault"`
}

// verifyGitProviderToken asks the provider who the token belongs to. It is shared by the "test"
// endpoint and by provider creation, so a token that cannot authenticate is never stored.
func verifyGitProviderToken(ctx context.Context, provider, apiURL, token string) testGitProviderResponse {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		provider = "github"
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	switch provider {
	case "github":
		httpReq, err := http.NewRequestWithContext(ctx, "GET", githubAPIBase+"/user", nil)
		if err != nil {
			return testGitProviderResponse{Message: err.Error()}
		}
		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Accept", "application/vnd.github+json")
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		resp, err := (&http.Client{}).Do(httpReq)
		if err != nil {
			return testGitProviderResponse{Message: fmt.Sprintf("Failed to reach GitHub API: %v", err)}
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return testGitProviderResponse{Message: fmt.Sprintf("GitHub returned status HTTP %d (invalid or expired token)", resp.StatusCode)}
		}

		var ghUser struct {
			Login     string `json:"login"`
			AvatarURL string `json:"avatar_url"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&ghUser)

		var scopes []string
		if scopeHdr := resp.Header.Get("X-OAuth-Scopes"); scopeHdr != "" {
			for _, sc := range strings.Split(scopeHdr, ",") {
				if trimmed := strings.TrimSpace(sc); trimmed != "" {
					scopes = append(scopes, trimmed)
				}
			}
		}
		return testGitProviderResponse{
			Valid: true, Username: ghUser.Login, AvatarURL: ghUser.AvatarURL,
			Scopes: scopes, Message: "Successfully authenticated with GitHub",
		}

	case "gitlab":
		baseURL := strings.TrimRight(strings.TrimSpace(apiURL), "/")
		if baseURL == "" {
			baseURL = "https://gitlab.com"
		}
		httpReq, err := http.NewRequestWithContext(ctx, "GET", baseURL+"/api/v4/user", nil)
		if err != nil {
			return testGitProviderResponse{Message: err.Error()}
		}
		httpReq.Header.Set("PRIVATE-TOKEN", token)
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		resp, err := (&http.Client{}).Do(httpReq)
		if err != nil {
			return testGitProviderResponse{Message: "Failed to reach GitLab: " + err.Error()}
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return testGitProviderResponse{Message: fmt.Sprintf("GitLab returned HTTP %d (invalid or expired token)", resp.StatusCode)}
		}

		var glUser struct {
			Username  string `json:"username"`
			AvatarURL string `json:"avatar_url"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&glUser)
		return testGitProviderResponse{
			Valid: true, Username: glUser.Username, AvatarURL: glUser.AvatarURL,
			Message: "Successfully authenticated with GitLab",
		}

	default:
		// A custom/Gitea/Bitbucket server has no single user endpoint the panel can assume, so it
		// is recorded without a network check and the repository call reports the truth later.
		return testGitProviderResponse{Valid: true, Message: "Generic provider configured"}
	}
}

// handleTestUserGitProvider tests token validity and retrieves account info from upstream Git provider.
func (s *Server) handleTestUserGitProvider(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	var req testGitProviderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_json", "Unusable JSON body")
		return
	}

	token := strings.TrimSpace(req.Token)
	if token == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "Personal access token is required")
		return
	}

	apiURL := firstNonEmpty(req.APIURL, req.BaseURL)
	writeJSON(w, http.StatusOK, verifyGitProviderToken(r.Context(), req.Provider, apiURL, token))
}

// firstNonEmpty returns the first non-blank value; it keeps the two field names from fighting.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// handleListGitProviderRepos fetches accessible repositories from upstream Git API using saved credentials.
func (s *Server) handleListGitProviderRepos(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	p, err := s.store.GetUserGitProvider(user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Git provider not found")
		return
	}

	token := ""
	if p.TokenCipher != "" {
		dec, err := secrets.Decrypt(s.key, p.TokenCipher)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt provider token")
			return
		}
		token = dec
	}

	// Pagination is applied locally: GitHub's page is fetched at its maximum size, which keeps
	// `total` truthful for the usual account and avoids sending the browser a total it cannot use.
	page, perPage := 1, 30
	if raw := r.URL.Query().Get("page"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 {
			page = n
		}
	}
	if raw := r.URL.Query().Get("per_page"); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil && n > 0 && n <= 100 {
			perPage = n
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var repos []gitRepoItem

	switch p.Provider {
	case "github":
		data, status, err := providerGET(ctx, githubAPIBase+"/user/repos?per_page=100&sort=updated", map[string]string{
			"Authorization": "Bearer " + token,
			"Accept":        "application/vnd.github+json",
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "GitHub error: "+err.Error())
			return
		}
		if status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub returned HTTP %d", status))
			return
		}
		var rawRepos []struct {
			Name          string `json:"name"`
			FullName      string `json:"full_name"`
			DefaultBranch string `json:"default_branch"`
			Private       bool   `json:"private"`
			CloneURL      string `json:"clone_url"`
			SSHURL        string `json:"ssh_url"`
			HTMLURL       string `json:"html_url"`
			Description   string `json:"description"`
		}
		if err := json.Unmarshal(data, &rawRepos); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse repository list")
			return
		}
		for _, r := range rawRepos {
			repos = append(repos, gitRepoItem{
				Name: r.Name, FullName: r.FullName, DefaultBranch: r.DefaultBranch, Private: r.Private,
				CloneURL: r.CloneURL, SSHURL: r.SSHURL, HTMLURL: r.HTMLURL, Description: r.Description,
			})
		}

	case "gitlab":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			base = "https://gitlab.com"
		}
		data, status, err := providerGET(ctx, base+"/api/v4/projects?membership=true&per_page=100&order_by=updated_at", map[string]string{
			"PRIVATE-TOKEN": token,
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "GitLab error: "+err.Error())
			return
		}
		if status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitLab returned HTTP %d", status))
			return
		}
		var rawRepos []struct {
			Name              string `json:"name"`
			PathWithNamespace string `json:"path_with_namespace"`
			DefaultBranch     string `json:"default_branch"`
			Visibility        string `json:"visibility"`
			HTTPURLToRepo     string `json:"http_url_to_repo"`
			SSHURLToRepo      string `json:"ssh_url_to_repo"`
			WebURL            string `json:"web_url"`
			Description       string `json:"description"`
		}
		if err := json.Unmarshal(data, &rawRepos); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse repository list")
			return
		}
		for _, r := range rawRepos {
			repos = append(repos, gitRepoItem{
				Name: r.Name, FullName: r.PathWithNamespace, DefaultBranch: r.DefaultBranch,
				Private: strings.EqualFold(r.Visibility, "private"), CloneURL: r.HTTPURLToRepo,
				SSHURL: r.SSHURLToRepo, HTMLURL: r.WebURL, Description: r.Description,
			})
		}

	case "gitea":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			writeError(w, http.StatusBadRequest, "missing_base_url", "Gitea/Forgejo needs a base URL")
			return
		}
		data, status, err := providerGET(ctx, base+"/api/v1/user/repos?limit=50&page=1", map[string]string{
			"Authorization": "token " + token,
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "Gitea error: "+err.Error())
			return
		}
		if status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("Gitea returned HTTP %d", status))
			return
		}
		var rawRepos []struct {
			Name          string `json:"name"`
			FullName      string `json:"full_name"`
			DefaultBranch string `json:"default_branch"`
			Private       bool   `json:"private"`
			CloneURL      string `json:"clone_url"`
			SSHURL        string `json:"ssh_url"`
			HTMLURL       string `json:"html_url"`
			Description   string `json:"description"`
		}
		if err := json.Unmarshal(data, &rawRepos); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse repository list")
			return
		}
		for _, r := range rawRepos {
			repos = append(repos, gitRepoItem{
				Name: r.Name, FullName: r.FullName, DefaultBranch: r.DefaultBranch, Private: r.Private,
				CloneURL: r.CloneURL, SSHURL: r.SSHURL, HTMLURL: r.HTMLURL, Description: r.Description,
			})
		}

	case "bitbucket":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			base = "https://api.bitbucket.org/2.0"
		}
		data, status, err := providerGET(ctx, base+"/repositories?pagelen=100", map[string]string{
			"Authorization": "Bearer " + token,
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "Bitbucket error: "+err.Error())
			return
		}
		if status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("Bitbucket returned HTTP %d", status))
			return
		}
		var payload struct {
			Values []struct {
				Name        string `json:"name"`
				FullName    string `json:"full_name"`
				IsPrivate   bool   `json:"is_private"`
				Description string `json:"description"`
				MainBranch  struct {
					Name string `json:"name"`
				} `json:"mainbranch"`
				Links struct {
					Clone []struct {
						Name string `json:"name"`
						Href string `json:"href"`
					} `json:"clone"`
					HTML struct {
						Href string `json:"href"`
					} `json:"html"`
				} `json:"links"`
			} `json:"values"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse repository list")
			return
		}
		for _, r := range payload.Values {
			item := gitRepoItem{
				Name: r.Name, FullName: r.FullName, DefaultBranch: r.MainBranch.Name,
				Private: r.IsPrivate, HTMLURL: r.Links.HTML.Href, Description: r.Description,
			}
			for _, clone := range r.Links.Clone {
				switch strings.ToLower(clone.Name) {
				case "https":
					item.CloneURL = clone.Href
				case "ssh":
					item.SSHURL = clone.Href
				}
			}
			repos = append(repos, item)
		}

	default:
		repos = []gitRepoItem{}
	}

	total := len(repos)
	start := (page - 1) * perPage
	if start > total {
		start = total
	}
	end := start + perPage
	if end > total {
		end = total
	}

	// `items` is kept beside `repos` so a client written against the pre-0.3.9 shape keeps working;
	// the contract documents `repos`.
	writeJSON(w, http.StatusOK, map[string]any{
		"items":   repos[start:end],
		"repos":   repos[start:end],
		"page":    page,
		"perPage": perPage,
		"total":   total,
	})
}

// handleListGitProviderBranches fetches branches for a specific repository from upstream Git API.
func (s *Server) handleListGitProviderBranches(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	id := r.PathValue("id")
	repo := r.URL.Query().Get("repo")
	if repo == "" {
		writeError(w, http.StatusBadRequest, "missing_repo", "Query parameter 'repo' (owner/repo) is required")
		return
	}

	p, err := s.store.GetUserGitProvider(user.ID, id)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "Git provider not found")
		return
	}

	token := ""
	if p.TokenCipher != "" {
		dec, err := secrets.Decrypt(s.key, p.TokenCipher)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt provider token")
			return
		}
		token = dec
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var branches []string
	defaultBranch := ""

	switch p.Provider {
	case "github":
		data, status, err := providerGET(ctx, fmt.Sprintf("%s/repos/%s/branches?per_page=100", githubAPIBase, repo), map[string]string{
			"Authorization": "Bearer " + token,
			"Accept":        "application/vnd.github+json",
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", "GitHub error: "+err.Error())
			return
		}
		if status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub returned HTTP %d", status))
			return
		}
		var rawBranches []struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &rawBranches); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse branch list")
			return
		}
		for _, b := range rawBranches {
			branches = append(branches, b.Name)
		}
		defaultBranch = githubDefaultBranch(ctx, token, repo)

	case "gitlab":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			base = "https://gitlab.com"
		}
		escaped := url.PathEscape(repo)
		data, status, err := providerGET(ctx, base+"/api/v4/projects/"+escaped+"/repository/branches?per_page=100", map[string]string{"PRIVATE-TOKEN": token})
		if err != nil || status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitLab branch lookup failed (HTTP %d): %v", status, err))
			return
		}
		var rawBranches []struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &rawBranches); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse branch list")
			return
		}
		for _, b := range rawBranches {
			branches = append(branches, b.Name)
		}
		if body, code, err := providerGET(ctx, base+"/api/v4/projects/"+escaped, map[string]string{"PRIVATE-TOKEN": token}); err == nil && code == http.StatusOK {
			var project struct {
				DefaultBranch string `json:"default_branch"`
			}
			_ = json.Unmarshal(body, &project)
			defaultBranch = project.DefaultBranch
		}

	case "gitea":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			writeError(w, http.StatusBadRequest, "missing_base_url", "Gitea/Forgejo needs a base URL")
			return
		}
		data, status, err := providerGET(ctx, base+"/api/v1/repos/"+repo+"/branches?limit=100", map[string]string{"Authorization": "token " + token})
		if err != nil || status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("Gitea branch lookup failed (HTTP %d): %v", status, err))
			return
		}
		var rawBranches []struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(data, &rawBranches); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse branch list")
			return
		}
		for _, b := range rawBranches {
			branches = append(branches, b.Name)
		}
		if body, code, err := providerGET(ctx, base+"/api/v1/repos/"+repo, map[string]string{"Authorization": "token " + token}); err == nil && code == http.StatusOK {
			var project struct {
				DefaultBranch string `json:"default_branch"`
			}
			_ = json.Unmarshal(body, &project)
			defaultBranch = project.DefaultBranch
		}

	case "bitbucket":
		base := strings.TrimRight(strings.TrimSpace(p.APIURL), "/")
		if base == "" {
			base = "https://api.bitbucket.org/2.0"
		}
		data, status, err := providerGET(ctx, base+"/repositories/"+repo+"/refs/branches?pagelen=100", map[string]string{"Authorization": "Bearer " + token})
		if err != nil || status != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("Bitbucket branch lookup failed (HTTP %d): %v", status, err))
			return
		}
		var payload struct {
			Values []struct {
				Name string `json:"name"`
			} `json:"values"`
		}
		if err := json.Unmarshal(data, &payload); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse branch list")
			return
		}
		for _, b := range payload.Values {
			branches = append(branches, b.Name)
		}
		if body, code, err := providerGET(ctx, base+"/repositories/"+repo, map[string]string{"Authorization": "Bearer " + token}); err == nil && code == http.StatusOK {
			var project struct {
				MainBranch struct {
					Name string `json:"name"`
				} `json:"mainbranch"`
			}
			_ = json.Unmarshal(body, &project)
			defaultBranch = project.MainBranch.Name
		}

	default:
		branches = []string{"main", "master"}
		defaultBranch = "main"
	}

	if defaultBranch == "" {
		for _, candidate := range []string{"main", "master"} {
			for _, b := range branches {
				if b == candidate {
					defaultBranch = candidate
					break
				}
			}
			if defaultBranch != "" {
				break
			}
		}
	}
	if defaultBranch == "" && len(branches) > 0 {
		defaultBranch = branches[0]
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"repo":          repo,
		"branches":      branches,
		"defaultBranch": defaultBranch,
	})
}

// githubDefaultBranch reads the repository's default branch. An unavailable value is not fatal:
// the caller falls back to main/master.
func githubDefaultBranch(ctx context.Context, token, repo string) string {
	req, err := http.NewRequestWithContext(ctx, "GET", githubAPIBase+"/repos/"+repo, nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "BarePod-Panel")

	resp, err := (&http.Client{}).Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		return ""
	}
	defer resp.Body.Close()

	var payload struct {
		DefaultBranch string `json:"default_branch"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return ""
	}
	return strings.TrimSpace(payload.DefaultBranch)
}
