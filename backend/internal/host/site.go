package host

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/framework"
	"golang.org/x/crypto/ssh"
)

// ErrSiteMissing is returned when a source kind expects an existing directory.
var ErrSiteMissing = errors.New("host: site directory does not exist")

// DefaultVhostsDir is where Debian/Ubuntu nginx already includes *.conf from, so a
// panel vhost needs no edit to nginx.conf itself.
const DefaultVhostsDir = "/etc/nginx/sites-enabled"

// DefaultCaddySitesDir is the panel-owned directory the Caddyfile imports.
const DefaultCaddySitesDir = "/etc/caddy/sites"

// DefaultCaddyDir is where Caddy's configuration lives.
const DefaultCaddyDir = "/etc/caddy"

// DefaultWebUser is the user nginx runs as on Debian/Ubuntu.
const DefaultWebUser = "www-data"

// DefaultSSLDir is where custom and self-signed certificates live.
const DefaultSSLDir = "/etc/barepod/ssl"

// Host owns the on-disk layout and the service lifecycle of websites.
type Host struct {
	Runner    Runner
	SitesRoot string // e.g. /home
	UnitsDir  string // e.g. /etc/systemd/system
	// VHostsDir is where the web server includes its vhosts; empty means the engine's
	// own default.
	VHostsDir string
	// WebUser is the user the web server runs as; empty means the default. A site is
	// granted read access to this user so the web server can serve it.
	WebUser string
	// CaddyConfigDir is where Caddy's Caddyfile lives (default /etc/caddy).
	CaddyConfigDir string
	// SSLDir is where custom & self-signed certificates live (default /etc/barepod/ssl).
	SSLDir string
}

// VhostsFor returns the configured vhost directory, or the engine's default.
func (h *Host) VhostsFor(engine string) string {
	if h.VHostsDir != "" {
		return h.VHostsDir
	}
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "caddy":
		return DefaultCaddySitesDir
	case "apache", "apache2":
		return "/etc/apache2/sites-enabled"
	case "openlitespeed", "lsws":
		return "/usr/local/lsws/conf/vhosts"
	default:
		return DefaultVhostsDir
	}
}

// CaddyDir is where Caddy's Caddyfile lives.
func (h *Host) CaddyDir() string {
	if h.CaddyConfigDir != "" {
		return h.CaddyConfigDir
	}
	return DefaultCaddyDir
}

// SSLDirFor returns the configured SSL directory or DefaultSSLDir.
func (h *Host) SSLDirFor() string {
	if h.SSLDir != "" {
		return h.SSLDir
	}
	return DefaultSSLDir
}

// EffectiveWebUser returns the configured web-server user, or the default.
func (h *Host) EffectiveWebUser() string {
	if h.WebUser != "" {
		return h.WebUser
	}
	return DefaultWebUser
}

// Mode reports how privileged commands are handled: "real" or "dry-run".
func (h *Host) Mode() string {
	if h.Runner == nil {
		return "dry-run"
	}
	return h.Runner.Mode()
}

// Materialises reports whether the host actually runs services.
func (h *Host) Materialises() bool { return h.Mode() == "real" }

// SitePath is the working directory of a website:
// <sitesRoot>/<tenant>/web/<slug>. If legacy <sitesRoot>/<tenant>/apps/<slug>
// exists as a physical directory and web/<slug> does not, it migrates it to web.
func (h *Host) SitePath(tenant, slug string) string {
	home := filepath.Join(h.SitesRoot, tenant)
	web := filepath.Join(home, "web", slug)
	legacy := filepath.Join(home, "apps", slug)

	// If legacy apps/<slug> exists as a real directory and web/<slug> does not, auto-migrate to web!
	if fi, err := os.Lstat(legacy); err == nil && fi.Mode()&os.ModeSymlink == 0 {
		if _, errTarget := os.Stat(web); os.IsNotExist(errTarget) {
			_ = os.MkdirAll(filepath.Dir(web), 0o750)
			_ = os.Rename(legacy, web)
		}
	}
	return web
}

// MigrateLegacyTenants scans the sites root for legacy tenant layouts (apps/ directory)
// and cleanly migrates all sites to web/, creating a backward-compatible symlink apps -> web.
func (h *Host) MigrateLegacyTenants(ctx context.Context) error {
	entries, err := os.ReadDir(h.SitesRoot)
	if err != nil {
		return nil
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		tenant := entry.Name()
		home := filepath.Join(h.SitesRoot, tenant)
		legacyApps := filepath.Join(home, "apps")

		fi, err := os.Lstat(legacyApps)
		if err != nil {
			continue
		}
		// If legacyApps is already a symlink, nothing to migrate
		if fi.Mode()&os.ModeSymlink != 0 {
			continue
		}
		if !fi.IsDir() {
			continue
		}

		// legacyApps is a real directory: migrate all sites inside it to web/
		webDir := filepath.Join(home, "web")
		if err := os.MkdirAll(webDir, 0o750); err != nil {
			continue
		}

		appEntries, err := os.ReadDir(legacyApps)
		if err == nil {
			for _, appEntry := range appEntries {
				src := filepath.Join(legacyApps, appEntry.Name())
				dst := filepath.Join(webDir, appEntry.Name())
				if _, errDst := os.Stat(dst); os.IsNotExist(errDst) {
					_ = os.Rename(src, dst)
				}
			}
		}

		// Remove legacyApps if empty, and replace with symlink apps -> web
		_ = os.Remove(legacyApps)
		if _, err := os.Lstat(legacyApps); os.IsNotExist(err) {
			_ = os.Symlink("web", legacyApps)
		}
	}
	return nil
}

// EnsureSiteDir creates the tenant/site layout and returns the site path.
// If legacy apps/<slug> exists and web/<slug> does not, it migrates it cleanly.
func (h *Host) EnsureSiteDir(ctx context.Context, tenant, slug string) (string, error) {
	home := filepath.Join(h.SitesRoot, tenant)
	webDir := filepath.Join(home, "web")
	_ = os.MkdirAll(webDir, 0o750)

	legacy := filepath.Join(home, "apps", slug)
	target := filepath.Join(webDir, slug)

	// Auto-migrate from apps/<slug> to web/<slug> if legacy exists
	if _, err := os.Stat(legacy); err == nil {
		if _, errTarget := os.Stat(target); os.IsNotExist(errTarget) {
			_ = os.Rename(legacy, target)
		}
	}

	legacyApps := filepath.Join(home, "apps")
	if _, err := os.Lstat(legacyApps); os.IsNotExist(err) {
		_ = os.Symlink("web", legacyApps)
	}

	path := h.SitePath(tenant, slug)
	if err := os.MkdirAll(path, 0o750); err != nil {
		return "", fmt.Errorf("host: create %s: %w", path, err)
	}
	if h.Materialises() {
		if out, err := h.Runner.Run(ctx, "", "chown", "-R", tenant+":"+tenant, home); err != nil {
			return "", fmt.Errorf("host: chown %s: %w (%s)", tenant, err, strings.TrimSpace(out))
		}
	}
	return path, nil
}

// SiteExists reports whether the site directory already exists.
func (h *Host) SiteExists(tenant, slug string) bool {
	info, err := os.Stat(h.SitePath(tenant, slug))
	return err == nil && info.IsDir()
}

// SiteDirEntries returns the number of entries inside a site directory.
func (h *Host) SiteDirEntries(tenant, slug string) (int, error) {
	entries, err := os.ReadDir(h.SitePath(tenant, slug))
	if err != nil {
		return 0, err
	}
	return len(entries), nil
}

// WriteEnvFile writes <site>/.env atomically and returns its path.
//
// The file belongs to the tenant, not to root: systemd reads EnvironmentFile as
// root, but the app itself (Laravel, Node dotenv, …) reads .env at runtime as the
// tenant, so a root-owned 0600 file would break it with "permission denied".
func (h *Host) WriteEnvFile(ctx context.Context, tenant, slug string, env map[string]string) (string, error) {
	dir := h.SitePath(tenant, slug)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	b.WriteString("# Generated by BarePod Panel — do not edit by hand.\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "%s=%s\n", k, quoteEnv(env[k]))
	}

	path := filepath.Join(dir, ".env")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", err
	}
	if h.Materialises() {
		if out, err := h.Runner.Run(ctx, "", "chown", tenant+":"+tenant, path); err != nil {
			return "", fmt.Errorf("host: chown the environment file: %w (%s)", err, strings.TrimSpace(out))
		}
	}
	return path, nil
}

func quoteEnv(v string) string {
	if strings.ContainsAny(v, " \t\"'") {
		return `"` + strings.ReplaceAll(v, `"`, `\"`) + `"`
	}
	return v
}

// DeployKeyInfo contains public key details for git repository deploy keys.
type DeployKeyInfo struct {
	Algorithm   string `json:"algorithm"`
	PublicKey   string `json:"publicKey"`
	Fingerprint string `json:"fingerprint"`
	CreatedAt   string `json:"createdAt"`
}

// DeployKeyPath returns the path to a website's private ED25519 deploy key.
func (h *Host) DeployKeyPath(tenant, slug string) string {
	return filepath.Join(h.SitesRoot, tenant, ".ssh", "id_ed25519_"+slug)
}

// EnsureDeployKey returns the existing deploy key or generates a new ED25519 keypair for the site.
func (h *Host) EnsureDeployKey(ctx context.Context, tenant, slug string) (*DeployKeyInfo, error) {
	privPath := h.DeployKeyPath(tenant, slug)
	pubPath := privPath + ".pub"

	if pubBytes, err := os.ReadFile(pubPath); err == nil {
		pubStr := strings.TrimSpace(string(pubBytes))
		pubKey, _, _, _, err := ssh.ParseAuthorizedKey(pubBytes)
		fp := ""
		if err == nil {
			fp = ssh.FingerprintSHA256(pubKey)
		}
		stat, _ := os.Stat(pubPath)
		created := ""
		if stat != nil {
			created = stat.ModTime().UTC().Format(time.RFC3339)
		}
		return &DeployKeyInfo{
			Algorithm:   "ED25519",
			PublicKey:   pubStr,
			Fingerprint: fp,
			CreatedAt:   created,
		}, nil
	}

	return h.RotateDeployKey(ctx, tenant, slug)
}

// RotateDeployKey generates a brand new ED25519 keypair for the website deploy key.
func (h *Host) RotateDeployKey(ctx context.Context, tenant, slug string) (*DeployKeyInfo, error) {
	sshDir := filepath.Join(h.SitesRoot, tenant, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		return nil, fmt.Errorf("host: create .ssh dir: %w", err)
	}

	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("host: generate ed25519 key: %w", err)
	}

	pemBlock, err := ssh.MarshalPrivateKey(privKey, "barepod-"+slug)
	if err != nil {
		return nil, fmt.Errorf("host: marshal private key: %w", err)
	}

	privPath := h.DeployKeyPath(tenant, slug)
	pubPath := privPath + ".pub"

	privBytes := pem.EncodeToMemory(pemBlock)
	if err := os.WriteFile(privPath, privBytes, 0o600); err != nil {
		return nil, fmt.Errorf("host: write private key: %w", err)
	}

	sshPub, err := ssh.NewPublicKey(pubKey)
	if err != nil {
		return nil, fmt.Errorf("host: create ssh public key: %w", err)
	}
	authPub := ssh.MarshalAuthorizedKey(sshPub)
	if err := os.WriteFile(pubPath, authPub, 0o644); err != nil {
		return nil, fmt.Errorf("host: write public key: %w", err)
	}

	if h.Materialises() {
		_, _ = h.Runner.Run(ctx, "", "chown", "-R", tenant+":"+tenant, sshDir)
		_, _ = h.Runner.Run(ctx, "", "chmod", "700", sshDir)
		_, _ = h.Runner.Run(ctx, "", "chmod", "600", privPath)
		_, _ = h.Runner.Run(ctx, "", "chmod", "644", pubPath)
	}

	fp := ssh.FingerprintSHA256(sshPub)
	return &DeployKeyInfo{
		Algorithm:   "ED25519",
		PublicKey:   strings.TrimSpace(string(authPub)),
		Fingerprint: fp,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// FetchSource materialises the chosen deployment source inside the site directory.
func (h *Host) FetchSource(ctx context.Context, tenant, slug, kind, repo, branch string) ([]string, error) {
	dir := h.SitePath(tenant, slug)
	switch strings.ToLower(kind) {
	case "github", "gitlab", "bitbucket", "gitea", "custom", "git":
		if repo == "" {
			return nil, errors.New("host: a repository is required for a git source")
		}
		if branch == "" {
			branch = "main"
		}

		keyPath := h.DeployKeyPath(tenant, slug)
		sshCmd := fmt.Sprintf("ssh -i %s -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new", keyPath)
		hasDeployKey := false
		if _, err := os.Stat(keyPath); err == nil {
			hasDeployKey = true
		}

		gitDir := filepath.Join(dir, ".git")
		isGitRepo := false
		if fi, err := os.Stat(gitDir); err == nil && fi.IsDir() {
			isGitRepo = true
		}

		var commands []string

		if isGitRepo {
			// Existing git repo: smart pull / reset
			// 1. Update remote URL in case it changed
			setRemote := []string{"git", "remote", "set-url", "origin", repo}
			if _, err := h.Runner.RunAs(ctx, tenant, dir, setRemote[0], setRemote[1:]...); err != nil {
				_, _ = h.Runner.RunAs(ctx, tenant, dir, "git", "remote", "add", "origin", repo)
			}
			commands = append(commands, strings.Join(setRemote, " "))

			// 2. Fetch origin branch
			fetchArgs := []string{"git"}
			if hasDeployKey {
				fetchArgs = append(fetchArgs, "-c", "core.sshCommand="+sshCmd)
			}
			fetchArgs = append(fetchArgs, "fetch", "origin", branch)
			out, err := h.Runner.RunAs(ctx, tenant, dir, fetchArgs[0], fetchArgs[1:]...)
			if err != nil {
				return commands, fmt.Errorf("host: git fetch failed: %w (%s)", err, strings.TrimSpace(out))
			}
			commands = append(commands, strings.Join(fetchArgs, " "))

			// 3. Checkout branch
			checkoutArgs := []string{"git", "checkout", "-f", branch}
			out, err = h.Runner.RunAs(ctx, tenant, dir, checkoutArgs[0], checkoutArgs[1:]...)
			if err != nil {
				checkoutArgs = []string{"git", "checkout", "-f", "-B", branch, "origin/" + branch}
				out, err = h.Runner.RunAs(ctx, tenant, dir, checkoutArgs[0], checkoutArgs[1:]...)
				if err != nil {
					return commands, fmt.Errorf("host: git checkout failed: %w (%s)", err, strings.TrimSpace(out))
				}
			}
			commands = append(commands, strings.Join(checkoutArgs, " "))

			// 4. Reset hard to origin/branch (clean working tree)
			resetArgs := []string{"git", "reset", "--hard", "origin/" + branch}
			out, err = h.Runner.RunAs(ctx, tenant, dir, resetArgs[0], resetArgs[1:]...)
			if err != nil {
				return commands, fmt.Errorf("host: git reset failed: %w (%s)", err, strings.TrimSpace(out))
			}
			commands = append(commands, strings.Join(resetArgs, " "))

			// 5. Update submodules if any
			submArgs := []string{"git", "submodule", "update", "--init", "--recursive"}
			_, _ = h.Runner.RunAs(ctx, tenant, dir, submArgs[0], submArgs[1:]...)

			return commands, nil
		}

		// Fresh checkout: check if directory has files
		entries, _ := os.ReadDir(dir)
		hasFiles := len(entries) > 0

		if !hasFiles {
			cloneArgs := []string{"git"}
			if hasDeployKey {
				cloneArgs = append(cloneArgs, "-c", "core.sshCommand="+sshCmd)
			}
			cloneArgs = append(cloneArgs, "clone", "--depth", "1", "--branch", branch, repo, ".")
			out, err := h.Runner.RunAs(ctx, tenant, dir, cloneArgs[0], cloneArgs[1:]...)
			if err != nil {
				return nil, fmt.Errorf("host: git clone failed: %w (%s)", err, strings.TrimSpace(out))
			}
			return []string{strings.Join(cloneArgs, " ")}, nil
		}

		// Non-empty directory: git init + fetch + checkout
		initArgs := []string{"git", "init"}
		if _, err := h.Runner.RunAs(ctx, tenant, dir, initArgs[0], initArgs[1:]...); err != nil {
			return nil, fmt.Errorf("host: git init failed: %w", err)
		}
		commands = append(commands, strings.Join(initArgs, " "))

		remoteArgs := []string{"git", "remote", "add", "origin", repo}
		_, _ = h.Runner.RunAs(ctx, tenant, dir, remoteArgs[0], remoteArgs[1:]...)
		commands = append(commands, strings.Join(remoteArgs, " "))

		fetchArgs := []string{"git"}
		if hasDeployKey {
			fetchArgs = append(fetchArgs, "-c", "core.sshCommand="+sshCmd)
		}
		fetchArgs = append(fetchArgs, "fetch", "--depth", "1", "origin", branch)
		out, err := h.Runner.RunAs(ctx, tenant, dir, fetchArgs[0], fetchArgs[1:]...)
		if err != nil {
			return commands, fmt.Errorf("host: git fetch failed: %w (%s)", err, strings.TrimSpace(out))
		}
		commands = append(commands, strings.Join(fetchArgs, " "))

		coArgs := []string{"git", "checkout", "-f", "-B", branch, "origin/" + branch}
		out, err = h.Runner.RunAs(ctx, tenant, dir, coArgs[0], coArgs[1:]...)
		if err != nil {
			return commands, fmt.Errorf("host: git checkout failed: %w (%s)", err, strings.TrimSpace(out))
		}
		commands = append(commands, strings.Join(coArgs, " "))

		return commands, nil
	case "existing":
		if !h.SiteExists(tenant, slug) {
			return nil, ErrSiteMissing
		}
		return nil, nil
	case "upload":
		// The wizard's own screen promises "the archive is extracted into the website
		// directory on deploy", and nothing extracted anything — a zip simply sat there. It
		// is unpacked in place, as the tenant, so the unpacked tree belongs to the account.
		script := `set -e; for f in *.zip; do [ -e "$f" ] || continue; unzip -oq "$f"; rm -f "$f"; done; ` +
			`for f in *.tar.gz *.tgz; do [ -e "$f" ] || continue; tar xzf "$f"; rm -f "$f"; done`
		if _, err := h.RunInSite(ctx, tenant, slug, []string{"sh", "-c", script}); err != nil {
			return nil, fmt.Errorf("host: the uploaded archive could not be extracted: %w", err)
		}
		return []string{"sh -c <extract archive>"}, nil
	case "scaffold":
		return nil, nil
	default:
		return nil, fmt.Errorf("host: unknown source kind %q", kind)
	}
}

// RunInSite executes a command inside the site directory **as the tenant**.
//
// Deploys used to run here as root, which left root-owned artifacts inside the
// site (a scaffolded `.venv`, its installed packages) that the tenant could not
// write to — the site kept serving, but `pip install`/`npm install` from the
// tenant's own shell failed.
func (h *Host) RunInSite(ctx context.Context, tenant, slug string, argv []string) (string, error) {
	if len(argv) == 0 {
		return "", nil
	}
	return h.Runner.RunAs(ctx, tenant, h.SitePath(tenant, slug), argv[0], argv[1:]...)
}

// ChownSite gives the whole site directory back to its tenant.
//
// Belt and braces after a deploy step that writes files: it repairs directories
// that were left root-owned by earlier versions, and guarantees the documented
// rule "everything inside a site belongs to the tenant".
func (h *Host) ChownSite(ctx context.Context, tenant, slug string) error {
	if !h.Materialises() {
		return nil
	}
	dir := h.SitePath(tenant, slug)
	if _, err := os.Stat(dir); err != nil {
		return nil
	}
	if out, err := h.Runner.Run(ctx, "", "chown", "-R", tenant+":"+tenant, dir); err != nil {
		return fmt.Errorf("host: chown -R %s: %w (%s)", dir, err, strings.TrimSpace(out))
	}
	return nil
}

// Run executes a command from the daemon's own working directory.
func (h *Host) Run(ctx context.Context, argv []string) (string, error) {
	if len(argv) == 0 {
		return "", nil
	}
	return h.Runner.Run(ctx, "", argv[0], argv[1:]...)
}

// RunDetached runs a command as a transient systemd unit, so the work belongs to the
// system rather than to the daemon: a restart — a deploy — no longer kills an install
// mid-flight. --pipe streams its output back the way Run does, and --collect removes the
// unit afterwards. On a dry-run host it is simply Run.
func (h *Host) RunDetached(ctx context.Context, unit string, argv []string) (string, error) {
	if len(argv) == 0 {
		return "", nil
	}
	if h.Runner == nil || h.Runner.Mode() != "real" {
		return h.Run(ctx, argv)
	}
	args := append([]string{
		"systemd-run",
		"--unit=" + unit,
		"--collect",
		"--wait",
		"--pipe",
		"--property=Type=oneshot",
		// Nothing here has a terminal: a package that asks a question would otherwise read
		// EOF and abort the install half-way.
		"--setenv=DEBIAN_FRONTEND=noninteractive",
		"--",
	}, argv...)
	return h.Run(ctx, args)
}

// RunAs executes a command as another user from the daemon's working directory.
func (h *Host) RunAs(ctx context.Context, username string, argv []string) (string, error) {
	if len(argv) == 0 {
		return "", nil
	}
	return h.Runner.RunAs(ctx, username, "", argv[0], argv[1:]...)
}

// ReloadUnits asks systemd to re-read unit files.
func (h *Host) ReloadUnits(ctx context.Context) (string, error) {
	return h.Runner.Run(ctx, "", "systemctl", "daemon-reload")
}

// ServiceAction applies a systemd action to a website's unit.
func (h *Host) ServiceAction(ctx context.Context, action, slug string) (string, error) {
	return h.Runner.Run(ctx, "", "systemctl", action, "barepod-app@"+slug+".service")
}

// EnableService enables and starts the website unit in one step.
func (h *Host) EnableService(ctx context.Context, slug string) (string, error) {
	return h.Runner.Run(ctx, "", "systemctl", "enable", "--now", "barepod-app@"+slug+".service")
}

// RunCronCommand executes a scheduled task command inside the website directory as the tenant user.
func (h *Host) RunCronCommand(ctx context.Context, tenant, siteSlug, command string) (string, error) {
	siteDir := h.SitePath(tenant, siteSlug)
	if !h.SiteExists(tenant, siteSlug) {
		return "", ErrSiteMissing
	}
	return h.Runner.RunAs(ctx, tenant, siteDir, "sh", "-c", command)
}

// GitDetectInfo holds auto-detected git repository metadata from the site directory.
type GitDetectInfo struct {
	Detected      bool   `json:"detected"`
	Repo          string `json:"repo"`
	Branch        string `json:"branch"`
	Commit        string `json:"commit,omitempty"`
	CommitMessage string `json:"commitMessage,omitempty"`
}

// DetectGit inspects a website's directory to see if a .git repository exists,
// extracting remote url, current branch, and latest commit info if found.
func (h *Host) DetectGit(ctx context.Context, tenant, slug string) (*GitDetectInfo, error) {
	dir := h.SitePath(tenant, slug)
	gitDir := filepath.Join(dir, ".git")

	fi, err := os.Stat(gitDir)
	if err != nil {
		return &GitDetectInfo{Detected: false}, nil
	}
	if !fi.IsDir() && fi.Mode()&os.ModeType != 0 {
		return &GitDetectInfo{Detected: false}, nil
	}

	info := &GitDetectInfo{Detected: true}
	if h.Runner == nil {
		return info, nil
	}

	// 1. Remote URL
	if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "remote", "get-url", "origin"); err == nil {
		info.Repo = strings.TrimSpace(out)
	} else if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "config", "--get", "remote.origin.url"); err == nil {
		info.Repo = strings.TrimSpace(out)
	}

	// 2. Branch
	if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "branch", "--show-current"); err == nil && strings.TrimSpace(out) != "" {
		info.Branch = strings.TrimSpace(out)
	} else if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "rev-parse", "--abbrev-ref", "HEAD"); err == nil && strings.TrimSpace(out) != "" {
		info.Branch = strings.TrimSpace(out)
	}

	// 3. Short commit hash
	if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "rev-parse", "--short", "HEAD"); err == nil {
		info.Commit = strings.TrimSpace(out)
	}

	// 4. Commit subject message
	if out, err := h.Runner.RunAs(ctx, tenant, dir, "git", "log", "-1", "--pretty=format:%s"); err == nil {
		info.CommitMessage = strings.TrimSpace(out)
	}

	return info, nil
}

// DetectFramework inspects a website's working directory on disk and returns the detected framework.
func (h *Host) DetectFramework(tenant, slug string) *framework.DetectedFramework {
	dir := h.SitePath(tenant, slug)
	return framework.Detect(dir)
}

