package api

import (
	"context"
	"encoding/base64"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/framework"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// probeRepoURL accepts only a remote git can reach without a shell or a flag in disguise.
func probeRepoURL(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || strings.HasPrefix(raw, "-") || strings.ContainsAny(raw, " \t\r\n") {
		return "", false
	}
	if strings.HasPrefix(raw, "https://") || strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "git@") || strings.HasPrefix(raw, "ssh://") {
		return raw, true
	}
	return "", false
}

// probeGitArgs adds the connected provider's token for an https GitHub remote, so a private
// repository can be listed and inspected before the site exists.
func (s *Server) probeGitArgs(user *store.User, providerID, repo string) []string {
	if providerID == "" || !strings.HasPrefix(repo, "https://github.com/") {
		return nil
	}
	p, err := s.store.GetUserGitProvider(user.ID, providerID)
	if err != nil || p.TokenCipher == "" {
		return nil
	}
	token, err := secrets.Decrypt(s.key, p.TokenCipher)
	if err != nil || token == "" {
		return nil
	}
	basic := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
	return []string{"-c", "http.extraHeader=Authorization: Basic " + basic}
}

func runGitProbe(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "GIT_SSH_COMMAND=ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// handleRemoteBranches lists the branches of any repository URL, with or without a connected
// provider, so the wizard can offer a branch list for a pasted URL.
func (s *Server) handleRemoteBranches(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	repo, ok := probeRepoURL(r.URL.Query().Get("repo"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid_repo", "A https:// or git@ repository URL is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	args := append(s.probeGitArgs(user, r.URL.Query().Get("provider"), repo), "ls-remote", "--symref", "--heads", "--", repo, "HEAD")
	out, err := runGitProbe(ctx, "", args...)
	if err != nil {
		writeError(w, http.StatusBadGateway, "upstream_error", "Could not read the repository (private, or the URL is wrong): "+strings.TrimSpace(out))
		return
	}
	branches := []string{}
	defaultBranch := ""
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "ref: refs/heads/"):
			defaultBranch = strings.TrimSuffix(strings.TrimPrefix(line, "ref: refs/heads/"), "\tHEAD")
		case strings.Contains(line, "\trefs/heads/"):
			branches = append(branches, line[strings.Index(line, "\trefs/heads/")+len("\trefs/heads/"):])
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"repo": repo, "branches": branches, "defaultBranch": defaultBranch})
}

// detectFrameworkFromRepo shallow-clones one branch into a scratch directory and inspects it.
func (s *Server) detectFrameworkFromRepo(ctx context.Context, user *store.User, providerID, repoRaw, branch string) (*framework.DetectedFramework, error) {
	repo, ok := probeRepoURL(repoRaw)
	if !ok {
		return nil, os.ErrInvalid
	}
	dir, err := os.MkdirTemp("", "barepod-detect-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	args := s.probeGitArgs(user, providerID, repo)
	args = append(args, "clone", "--depth", "1", "--single-branch", "--no-tags")
	if b := strings.TrimSpace(branch); b != "" && !strings.HasPrefix(b, "-") {
		args = append(args, "--branch", b)
	}
	args = append(args, "--", repo, dir)
	if out, err := runGitProbe(ctx, "", args...); err != nil {
		return nil, &probeError{strings.TrimSpace(out)}
	}
	return framework.Detect(dir), nil
}

type probeError struct{ msg string }

func (e *probeError) Error() string { return e.msg }

// detectFromGitPayload serves the Git branch of POST /websites/detect-framework.
func (s *Server) detectFromGitPayload(w http.ResponseWriter, r *http.Request, user *store.User, repo, branch, providerID string) {
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	fw, err := s.detectFrameworkFromRepo(ctx, user, providerID, repo, branch)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "framework": nil, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "framework": fw})
}
