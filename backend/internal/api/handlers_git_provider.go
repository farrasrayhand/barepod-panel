package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

type testGitProviderRequest struct {
	Provider string `json:"provider"`
	APIURL   string `json:"apiUrl,omitempty"`
	Token    string `json:"token"`
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

	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	if provider == "" {
		provider = "github"
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch provider {
	case "github":
		reqURL := "https://api.github.com/user"
		httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Accept", "application/vnd.github+json")
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		client := &http.Client{}
		resp, err := client.Do(httpReq)
		if err != nil {
			writeJSON(w, http.StatusOK, testGitProviderResponse{
				Valid:   false,
				Message: fmt.Sprintf("Failed to reach GitHub API: %v", err),
			})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			writeJSON(w, http.StatusOK, testGitProviderResponse{
				Valid:   false,
				Message: fmt.Sprintf("GitHub returned status HTTP %d (invalid or expired token)", resp.StatusCode),
			})
			return
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

		writeJSON(w, http.StatusOK, testGitProviderResponse{
			Valid:     true,
			Username:  ghUser.Login,
			AvatarURL: ghUser.AvatarURL,
			Scopes:    scopes,
			Message:   "Successfully authenticated with GitHub",
		})

	case "gitlab":
		baseURL := strings.TrimRight(req.APIURL, "/")
		if baseURL == "" {
			baseURL = "https://gitlab.com"
		}
		reqURL := baseURL + "/api/v4/user"
		httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		httpReq.Header.Set("PRIVATE-TOKEN", token)
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		client := &http.Client{}
		resp, err := client.Do(httpReq)
		if err != nil || resp.StatusCode != http.StatusOK {
			writeJSON(w, http.StatusOK, testGitProviderResponse{
				Valid:   false,
				Message: "Failed to authenticate with GitLab",
			})
			return
		}
		defer resp.Body.Close()

		var glUser struct {
			Username  string `json:"username"`
			AvatarURL string `json:"avatar_url"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&glUser)

		writeJSON(w, http.StatusOK, testGitProviderResponse{
			Valid:     true,
			Username:  glUser.Username,
			AvatarURL: glUser.AvatarURL,
			Message:   "Successfully authenticated with GitLab",
		})

	default:
		writeJSON(w, http.StatusOK, testGitProviderResponse{
			Valid:   true,
			Message: "Generic provider configured",
		})
	}
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

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	var repos []gitRepoItem

	switch p.Provider {
	case "github":
		reqURL := "https://api.github.com/user/repos?per_page=100&sort=updated"
		httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Accept", "application/vnd.github+json")
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		client := &http.Client{}
		resp, err := client.Do(httpReq)
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub error: %v", err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub returned HTTP %d", resp.StatusCode))
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
		if err := json.NewDecoder(resp.Body).Decode(&rawRepos); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse repository list")
			return
		}

		for _, r := range rawRepos {
			repos = append(repos, gitRepoItem{
				Name:          r.Name,
				FullName:      r.FullName,
				DefaultBranch: r.DefaultBranch,
				Private:       r.Private,
				CloneURL:      r.CloneURL,
				SSHURL:        r.SSHURL,
				HTMLURL:       r.HTMLURL,
				Description:   r.Description,
			})
		}

	default:
		repos = []gitRepoItem{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": repos,
		"total": len(repos),
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

	switch p.Provider {
	case "github":
		reqURL := fmt.Sprintf("https://api.github.com/repos/%s/branches?per_page=100", repo)
		httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", err.Error())
			return
		}
		httpReq.Header.Set("Authorization", "Bearer "+token)
		httpReq.Header.Set("Accept", "application/vnd.github+json")
		httpReq.Header.Set("User-Agent", "BarePod-Panel")

		client := &http.Client{}
		resp, err := client.Do(httpReq)
		if err != nil {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub error: %v", err))
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			writeError(w, http.StatusBadGateway, "upstream_error", fmt.Sprintf("GitHub returned HTTP %d", resp.StatusCode))
			return
		}

		var rawBranches []struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&rawBranches); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not parse branch list")
			return
		}

		for _, b := range rawBranches {
			branches = append(branches, b.Name)
		}

	default:
		branches = []string{"main", "master"}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"repo":     repo,
		"branches": branches,
	})
}
