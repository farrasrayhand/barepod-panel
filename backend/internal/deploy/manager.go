// Package deploy runs website provisioning as an asynchronous job.
//
// Every line is persisted, so a client can reconnect (or simply poll) and still
// receive the full log in order. That is what makes the SSE stream safe to
// interrupt: nothing depends on the client being connected.
package deploy

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/framework"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/phpfpm"
	"github.com/farrasrayhand/barepod-panel/backend/internal/provision"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/supervisor"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// keepRecentJobs is how many deploy jobs (with their logs) are retained per
// website; older ones are pruned so a frequently redeployed site cannot grow the
// panel database without bound.
const keepRecentJobs = 10

// SourceSpec describes where the code comes from.
type SourceSpec struct {
	Kind   string // scaffold | github | upload | existing | default
	Repo   string
	Branch string
}

// DatabaseSpec is an optional database request from the deploy wizard.
type DatabaseSpec struct {
	Engine  string
	Version string
	Name    string
}

// CacheSpec is an optional cache request from the deploy wizard.
type CacheSpec struct {
	Engine  string
	Version string
}

// Request is the resolved provisioning plan.
type Request struct {
	Slug             string
	Tenant           string
	Domain           string
	Runtime          string
	Version          string
	Framework        string
	FrameworkVersion string
	WebServer        string
	Port             int
	UpstreamURL      string
	SSL              bool
	TunnelEnabled    bool
	Source           SourceSpec
	Database         *DatabaseSpec
	Cache            *CacheSpec
	Automation       []string
	BuildScript      string
	// Redeploy keeps the existing database and cache instead of provisioning them.
	Redeploy bool
	// Env contains custom or wizard-generated environment variables to seed into .env
	Env map[string]string
}

// Manager owns the deploy pipeline.
type Manager struct {
	store    *store.Store
	host     *host.Host
	key      []byte
	redisURL string
}

// NewManager builds a deploy manager.
func NewManager(st *store.Store, h *host.Host, key []byte) *Manager {
	return &Manager{store: st, host: h, key: key}
}

// SetRedisURL sets the Redis admin URL used to provision tenant ACL users.
func (m *Manager) SetRedisURL(raw string) {
	m.redisURL = strings.TrimSpace(raw)
}

// Mode is the execution mode of the underlying host: "real" or "dry-run".
func (m *Manager) Mode() string { return m.host.Mode() }

// Start records the job and runs the pipeline in the background.
func (m *Manager) Start(req Request) (*store.DeployJob, error) {
	steps := plan(req)
	job := &store.DeployJob{
		ID:          id.New(),
		Slug:        req.Slug,
		Mode:        m.host.Mode(),
		Status:      "pending",
		TotalSteps:  len(steps),
		CurrentStep: "queued",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	if site, err := m.store.WebsiteBySlug(req.Slug); err == nil {
		job.WebsiteID = site.ID
	}
	if err := m.store.CreateDeployJob(job); err != nil {
		return nil, err
	}
	// The pipeline mutates the job while it runs, so hand the caller a snapshot.
	snapshot := *job
	go m.run(job, req, steps)
	return &snapshot, nil
}

// state carries what the steps need to share.
type state struct {
	m         *Manager
	job       *store.DeployJob
	req       Request
	siteDir   string
	envPath   string
	dbName    string
	dbUser    string
	dbPass    string
	cacheUser string
	cachePass string
}

type step struct {
	name string
	fn   func(ctx context.Context, s *state) error
}

func plan(req Request) []step {
	if req.Runtime == "proxy" {
		return []step{
			{"Prepare site directory", stepPrepareDirs},
			{"Write web-server vhost", stepWriteVhost},
			{"Health check", stepHealthCheck},
		}
	}
	return []step{
		{"Prepare site directory", stepPrepareDirs},
		{"Fetch source code", stepFetchSource},
		{"Write environment file", stepWriteEnv},
		{"Provision database", stepProvisionDatabase},
		{"Provision cache", stepProvisionCache},
		{"Build automation", stepRunBuildScript},
		{"Write PHP-FPM pool", stepWritePhpPool},
		{"Write web-server vhost", stepWriteVhost},
		{"Render service unit", stepRenderUnit},
		{"Start service", stepStartService},
		{"Health check", stepHealthCheck},
	}
}

func (m *Manager) run(job *store.DeployJob, req Request, steps []step) {
	// Bound the job history whether the deploy succeeds or fails.
	defer func() {
		if removed, err := m.store.PruneDeployJobs(job.Slug, keepRecentJobs); err == nil && removed > 0 {
			log.Printf("deploy: pruned %d old job(s) for %s", removed, job.Slug)
		}
	}()

	job.Status = "running"
	_ = m.store.UpdateDeployJob(job)

	s := &state{m: m, job: job, req: req}
	s.log("stdout", fmt.Sprintf(
		"plan: runtime=%s %s framework=%s web=%s domain=%s port=%d ssl=%t tunnel=%t source=%s mode=%s",
		req.Runtime, req.Version, orDash(req.Framework), req.WebServer, req.Domain,
		req.Port, req.SSL, req.TunnelEnabled, req.Source.Kind, job.Mode))
	for _, a := range req.Automation {
		s.log("stdout", "automation step queued: "+a)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	for i, st := range steps {
		job.Step = i + 1
		job.CurrentStep = st.name
		_ = m.store.UpdateDeployJob(job)
		s.log("step", fmt.Sprintf("-> [%d/%d] %s", i+1, len(steps), st.name))

		if err := st.fn(ctx, s); err != nil {
			job.Status = "failed"
			job.Error = err.Error()
			job.FinishedAt = time.Now().UTC().Format(time.RFC3339)
			_ = m.store.UpdateDeployJob(job)
			s.log("stderr", "FAILED: "+err.Error())
			_ = m.store.SetWebsiteRuntimeState(req.Slug, "error", "failed")
			s.log("status", "failed")
			return
		}
	}

	job.Status = "success"
	job.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	_ = m.store.UpdateDeployJob(job)

	// In dry-run no service was started, so the website must not claim to be running.
	status := "running"
	if !m.host.Materialises() {
		status = "stopped"
	}
	_ = m.store.SetWebsiteRuntimeState(req.Slug, status, "ready")
	s.log("stdout", "deploy finished: status="+status+" deployStatus=ready")
	s.log("status", "success")
}

// websiteHasCacheRecord reports whether this website already has a cache row in the ledger, so a
// redeploy does not create a second row for the same cache.
func (s *state) websiteHasCacheRecord() bool {
	records, err := s.m.store.DatabasesForTenant(store.KindCache, s.req.Tenant, false)
	if err != nil {
		return false
	}
	for _, record := range records {
		if record.WebsiteSlug == s.req.Slug {
			return true
		}
	}
	return false
}

func (s *state) log(stream, line string) {
	if _, err := s.m.store.AppendDeployLog(s.job.ID, stream, line); err != nil {
		return
	}
}

func (s *state) logOutput(out string) {
	for _, line := range strings.Split(strings.TrimRight(out, "\n"), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		s.log("stdout", line)
	}
}

func (s *state) runInSite(ctx context.Context, argv []string) error {
	s.log("stdout", "run: "+strings.Join(argv, " "))
	out, err := s.m.host.RunInSite(ctx, s.req.Tenant, s.req.Slug, argv)
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("%s failed: %w", argv[0], err)
	}
	return nil
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// --- steps ---

func stepPrepareDirs(ctx context.Context, s *state) error {
	// "existing" means the code is already there: creating the directory would
	// silently turn an empty deploy into a valid one, so check before touching it.
	if s.req.Source.Kind == "existing" {
		path := s.m.host.SitePath(s.req.Tenant, s.req.Slug)
		if !s.m.host.SiteExists(s.req.Tenant, s.req.Slug) {
			return fmt.Errorf("no directory found at %s — create it from the deploy wizard (or use GitHub / Upload as the source), then deploy again", path)
		}
		count, err := s.m.host.SiteDirEntries(s.req.Tenant, s.req.Slug)
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("the directory %s is empty — upload your files first with the File Manager, then deploy again", path)
		}
		s.siteDir = path
		s.log("stdout", fmt.Sprintf("using the existing directory %s (%d entries)", path, count))
		return nil
	}

	dir, err := s.m.host.EnsureSiteDir(ctx, s.req.Tenant, s.req.Slug)
	if err != nil {
		return err
	}
	s.siteDir = dir
	s.log("stdout", "site directory: "+dir)
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] ownership for tenant "+s.req.Tenant+" was not applied")
	}
	return nil
}

func stepFetchSource(ctx context.Context, s *state) error {
	if s.req.Runtime == "proxy" {
		s.log("stdout", "skipped: reverse proxy site has no source code")
		return nil
	}
	// "default" has no code to fetch: the panel writes one placeholder page, so a website
	// can be created (and answer on its address) before its application exists.
	if s.req.Source.Kind == "default" {
		return s.writeDefaultPage(ctx)
	}
	cmds, err := s.m.host.FetchSource(ctx, s.req.Tenant, s.req.Slug, s.req.Source.Kind, s.req.Source.Repo, s.req.Source.Branch)
	for _, c := range cmds {
		s.log("stdout", "run: "+c)
	}
	if err != nil {
		return err
	}
	// Whatever the source was — a clone, a scaffold, an uploaded archive or code
	// that was already there — the site directory must end up belonging to the
	// tenant. This also repairs directories left root-owned by earlier versions.
	if err := s.m.host.ChownSite(ctx, s.req.Tenant, s.req.Slug); err != nil {
		return err
	}
	if s.req.Source.Kind != "scaffold" {
		return nil
	}

	if isAlreadyScaffolded(s.siteDir, s.req.Framework) {
		s.log("stdout", "project files already present — skipping fresh scaffold download")
	} else {
		scaffoldVer := s.req.FrameworkVersion
		if s.req.Runtime == "python" && s.req.Version != "" {
			scaffoldVer = s.req.Version
		}
		argv := provision.Scaffold(s.req.Framework, scaffoldVer)
		if len(argv) == 0 {
			s.log("stdout", "no automated download for this template — use a GitHub repository or upload the code instead")
			return nil
		}
		if err := s.runInSite(ctx, argv); err != nil {
			return err
		}
		for _, extra := range provision.PostScaffold(s.req.Framework) {
			if err := s.runInSite(ctx, extra); err != nil {
				return err
			}
		}
	}
	// A framework download without an entrypoint would start and immediately
	// fail, so write the starter file the preset implies (never overwriting an
	// existing one, so uploaded or cloned code is safe).
	if err := s.writeStarterFiles(ctx); err != nil {
		return err
	}
	// Starter files are written by the daemon itself (as root), so hand them over.
	return s.m.host.ChownSite(ctx, s.req.Tenant, s.req.Slug)
}

func isAlreadyScaffolded(siteDir, framework string) bool {
	fw := strings.ToLower(strings.TrimSpace(framework))
	switch {
	case strings.Contains(fw, "laravel"):
		if _, err := os.Stat(filepath.Join(siteDir, "artisan")); err == nil {
			return true
		}
		if _, err := os.Stat(filepath.Join(siteDir, "composer.json")); err == nil {
			return true
		}
	case strings.Contains(fw, "symfony"):
		if _, err := os.Stat(filepath.Join(siteDir, "bin", "console")); err == nil {
			return true
		}
		if _, err := os.Stat(filepath.Join(siteDir, "composer.json")); err == nil {
			return true
		}
	case strings.Contains(fw, "wordpress"):
		if _, err := os.Stat(filepath.Join(siteDir, "wp-settings.php")); err == nil {
			return true
		}
	case strings.Contains(fw, "django"):
		if _, err := os.Stat(filepath.Join(siteDir, "manage.py")); err == nil {
			return true
		}
	default:
		for _, marker := range []string{"composer.json", "package.json", "requirements.txt", "go.mod"} {
			if _, err := os.Stat(filepath.Join(siteDir, marker)); err == nil {
				return true
			}
		}
	}
	return false
}

// writeDefaultPage puts a single index.html in the site directory: the web server that
// serves a directory answers it, so a site that has no application yet answers
// something that says so — instead of the server's own error page, or nothing at all.
func (s *state) writeDefaultPage(ctx context.Context) error {
	page := provision.DefaultPage(s.req.Slug, s.req.Domain)
	target := filepath.Join(s.siteDir, "index.html")
	if _, err := os.Stat(target); err == nil {
		s.log("stdout", "kept the existing index.html")
		return nil
	}
	if err := os.WriteFile(target, []byte(page), 0o644); err != nil {
		return fmt.Errorf("could not write the default page: %w", err)
	}
	if s.m.host.Materialises() {
		if out, err := s.m.host.Run(ctx, []string{"chown", s.req.Tenant + ":" + s.req.Tenant, target}); err != nil {
			return fmt.Errorf("chown index.html: %w (%s)", err, strings.TrimSpace(out))
		}
	}
	s.log("stdout", "wrote the default page index.html")
	return nil
}

// writeStarterFiles places the framework's entrypoint inside the site.
func (s *state) writeStarterFiles(ctx context.Context) error {
	files := provision.StarterFiles(s.req.Runtime, s.req.Framework, s.req.Port)
	if len(files) == 0 {
		return nil
	}
	for name, content := range files {
		target := filepath.Join(s.siteDir, name)
		if _, err := os.Stat(target); err == nil {
			s.log("stdout", "kept the existing "+name)
			continue
		}
		if err := os.WriteFile(target, []byte(content), 0o640); err != nil {
			return fmt.Errorf("could not write %s: %w", name, err)
		}
		if s.m.host.Materialises() {
			if out, err := s.m.host.Run(ctx, []string{"chown", s.req.Tenant + ":" + s.req.Tenant, target}); err != nil {
				return fmt.Errorf("chown %s: %w (%s)", name, err, strings.TrimSpace(out))
			}
		}
		s.log("stdout", "wrote the starter entrypoint "+name)
	}
	return nil
}

func readEnvFileMap(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	res := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.Trim(strings.TrimSpace(parts[1]), `"' `)
			if k != "" {
				res[k] = v
			}
		}
	}
	return res
}

func stepWriteEnv(ctx context.Context, s *state) error {
	if s.req.Runtime == "static" {
		s.log("stdout", "static runtime: skipping .env generation")
		existingEnv := filepath.Join(s.siteDir, ".env")
		if _, err := os.Stat(existingEnv); err == nil {
			_ = os.Remove(existingEnv)
			s.log("stdout", "static runtime: removed unwanted .env file")
		}
		return nil
	}

	existingPath := filepath.Join(s.siteDir, ".env")
	examplePath := filepath.Join(s.siteDir, ".env.example")

	// 1. Seed base map from existing .env if present, otherwise .env.example template
	env := make(map[string]string)
	if existingEnv := readEnvFileMap(existingPath); len(existingEnv) > 0 {
		for k, v := range existingEnv {
			env[k] = v
		}
	} else if exampleEnv := readEnvFileMap(examplePath); len(exampleEnv) > 0 {
		for k, v := range exampleEnv {
			env[k] = v
		}
	}

	// 2. Standard application defaults
	env["APP_NAME"] = s.req.Slug
	env["APP_DOMAIN"] = s.req.Domain
	env["APP_URL"] = "https://" + s.req.Domain
	env["PORT"] = strconv.Itoa(s.req.Port)
	if _, ok := env["APP_ENV"]; !ok || env["APP_ENV"] == "local" || env["APP_ENV"] == "" {
		env["APP_ENV"] = "production"
	}
	if _, ok := env["APP_DEBUG"]; !ok {
		env["APP_DEBUG"] = "false"
	}

	// 3. Ensure valid 32-byte base64 APP_KEY
	if existingKey := env["APP_KEY"]; existingKey != "" && strings.HasPrefix(existingKey, "base64:") && len(existingKey) >= 50 {
		// Keep existing valid APP_KEY
	} else {
		env["APP_KEY"] = "base64:" + id.Base64(32)
	}

	// 4. Custom/extra env variables passed from wizard request
	for k, v := range s.req.Env {
		if k != "" {
			env[k] = v
		}
	}

	// 5. Database configuration
	if db := s.req.Database; db != nil {
		engine := strings.ToLower(db.Engine)
		raw := db.Name
		if raw == "" {
			raw = s.req.Slug
		}
		if engine == "sqlite" {
			path := filepath.Join(s.siteDir, raw+".sqlite")
			if _, err := os.Stat(path); os.IsNotExist(err) {
				if err := os.WriteFile(path, nil, 0o600); err != nil {
					return err
				}
				s.log("stdout", "sqlite file created inside the site directory: "+path)
			}
			s.dbName = raw
			env["DATABASE_URL"] = provision.DatabaseURL("sqlite", "", "", raw, "", 0, path)
			env["DB_CONNECTION"] = "sqlite"
			env["DB_DATABASE"] = path
		} else {
			s.dbName = s.req.Tenant + "_" + raw
			s.dbUser = s.req.Tenant + "_" + raw

			// Re-use existing secret if present
			if sec, err := s.m.store.WebsiteSecret(s.req.Slug, "database_password"); err == nil && sec != "" {
				if dec, err := secrets.Decrypt(s.m.key, sec); err == nil && dec != "" {
					s.dbPass = dec
				}
			}
			if s.dbPass == "" {
				s.dbPass = id.Token(18)
				if enc, err := secrets.Encrypt(s.m.key, s.dbPass); err == nil {
					_ = s.m.store.PutWebsiteSecret(s.req.Slug, "database_password", enc)
				}
			}

			dbPort := provision.DefaultDBPort(engine)
			env["DATABASE_URL"] = provision.DatabaseURL(engine, s.dbUser, s.dbPass, s.dbName, "127.0.0.1", dbPort, "")

			// Framework and runtime-specific DB variables
			if engine == "mysql" || engine == "mariadb" {
				env["DB_CONNECTION"] = "mysql"
			} else if engine == "postgres" || engine == "postgresql" {
				env["DB_CONNECTION"] = "pgsql"
			} else {
				env["DB_CONNECTION"] = engine
			}
			env["DB_HOST"] = "127.0.0.1"
			env["DB_PORT"] = strconv.Itoa(dbPort)
			env["DB_DATABASE"] = s.dbName
			env["DB_USERNAME"] = s.dbUser
			env["DB_PASSWORD"] = s.dbPass

			s.log("stdout", "database name/user: "+s.dbName+" (tenant-prefixed to avoid shared-daemon collisions)")
			s.log("stdout", "database password stored encrypted (AES-256-GCM)")

			// If the user selected a managed database engine (mariadb/mysql/postgres) for Laravel,
			// clean up the placeholder database/database.sqlite created by composer create-project
			// so it does not get detected as a phantom secondary database.
			if strings.Contains(strings.ToLower(s.req.Framework), "laravel") {
				placeholder := filepath.Join(s.siteDir, "database", "database.sqlite")
				if fi, err := os.Stat(placeholder); err == nil && fi.Size() < 250*1024 {
					_ = os.Remove(placeholder)
					s.log("stdout", "cleaned up starter laravel database.sqlite in favor of "+engine)
				}
			}
		}
	}

	// 6. Cache & Redis configuration
	if cache := s.req.Cache; cache != nil {
		engine := strings.ToLower(cache.Engine)
		s.cacheUser = s.req.Tenant + "_" + s.req.Slug
		pass := ""
		if sec, err := s.m.store.WebsiteSecret(s.req.Slug, "cache_password"); err == nil && sec != "" {
			if dec, err := secrets.Decrypt(s.m.key, sec); err == nil && dec != "" {
				pass = dec
			}
		}
		if pass == "" {
			pass = id.Token(18)
			if enc, err := secrets.Encrypt(s.m.key, pass); err == nil {
				_ = s.m.store.PutWebsiteSecret(s.req.Slug, "cache_password", enc)
			}
		}
		s.cachePass = pass

		dbPort := provision.DefaultDBPort(engine)
		cacheHost := "127.0.0.1"
		if engine == "redis" {
			cacheHost = dbengine.RedisInstanceHostname(s.req.Slug)
		}
		env["CACHE_URL"] = provision.DatabaseURL(engine, s.cacheUser, pass, "", cacheHost, dbPort, "")
		if engine == "redis" {
			env["CACHE_STORE"] = "redis"
			env["CACHE_DRIVER"] = "redis"
			env["SESSION_DRIVER"] = "redis"
			env["QUEUE_CONNECTION"] = "redis"
			env["REDIS_CLIENT"] = "phpredis"
			env["REDIS_HOST"] = cacheHost
			env["REDIS_PORT"] = strconv.Itoa(dbPort)
			env["REDIS_USERNAME"] = s.cacheUser
			if pass != "" {
				env["REDIS_PASSWORD"] = pass
			}
		}
		s.log("stdout", "cache ("+engine+" at "+cacheHost+":"+strconv.Itoa(dbPort)+") configured in environment file")
	}

	path, err := s.m.host.WriteEnvFile(ctx, s.req.Tenant, s.req.Slug, env)
	if err != nil {
		return err
	}
	s.envPath = path
	s.log("stdout", "environment file written: "+path+" (mode 0600, owned by "+s.req.Tenant+")")
	return nil
}

func stepProvisionDatabase(ctx context.Context, s *state) error {
	db := s.req.Database
	if db == nil {
		if s.req.Redeploy {
			s.log("stdout", "skipped: redeploy keeps the existing database")
		} else {
			s.log("stdout", "skipped: no database requested")
		}
		return nil
	}
	engine := strings.ToLower(db.Engine)
	alias := db.Name
	if alias == "" {
		alias = s.req.Slug
	}

	if engine == "sqlite" {
		s.log("stdout", "skipped: sqlite is a file inside the site directory, not a daemon")
		if s.m.store != nil {
			existing, _ := s.m.store.DatabasesForWebsite(s.req.Slug)
			alreadyTracked := false
			for _, ex := range existing {
				if ex.Alias == alias {
					alreadyTracked = true
					break
				}
			}
			if !alreadyTracked {
				record := &store.Database{
					Kind:        store.KindDatabase,
					WebsiteSlug: s.req.Slug,
					TenantUser:  s.req.Tenant,
					Engine:      "sqlite",
					Alias:       alias,
					Name:        alias,
					FilePath:    filepath.Join(s.siteDir, alias+".sqlite"),
					FileBased:   true,
					Status:      "ready",
					CreatedAt:   time.Now().UTC().Format(time.RFC3339),
				}
				_ = s.m.store.CreateDatabase(record)
			}
		}
		return nil
	}

	var argv []string
	switch engine {
	case "postgres", "postgresql":
		sql := fmt.Sprintf(`DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = %q) THEN
    CREATE ROLE %q LOGIN PASSWORD %q;
  ELSE
    ALTER ROLE %q WITH LOGIN PASSWORD %q;
  END IF;
END
$$;
SELECT 'CREATE DATABASE %q OWNER %q'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = %q)\gexec`,
			s.dbUser, s.dbUser, s.dbPass, s.dbUser, s.dbPass, s.dbName, s.dbUser, s.dbName)
		argv = []string{"sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c", sql}
	case "mysql", "mariadb":
		sql := fmt.Sprintf(
			"CREATE DATABASE IF NOT EXISTS `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; "+
				"CREATE USER IF NOT EXISTS '%s'@'localhost' IDENTIFIED BY '%s'; "+
				"ALTER USER '%s'@'localhost' IDENTIFIED BY '%s'; "+
				"GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'localhost'; "+
				"CREATE USER IF NOT EXISTS '%s'@'127.0.0.1' IDENTIFIED BY '%s'; "+
				"ALTER USER '%s'@'127.0.0.1' IDENTIFIED BY '%s'; "+
				"GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'127.0.0.1'; "+
				"FLUSH PRIVILEGES;",
			s.dbName,
			s.dbUser, s.dbPass,
			s.dbUser, s.dbPass,
			s.dbName, s.dbUser,
			s.dbUser, s.dbPass,
			s.dbUser, s.dbPass,
			s.dbName, s.dbUser,
		)
		argv = []string{"mysql", "-e", sql}
	case "mongodb":
		argv = []string{"mongosh", "--quiet", "--eval",
			fmt.Sprintf(`db.getSiblingDB(%q).createUser({user:%q,pwd:%q,roles:[{role:"readWrite",db:%q}]})`, s.dbName, s.dbUser, s.dbPass, s.dbName)}
	default:
		return fmt.Errorf("engine %q is not supported yet", db.Engine)
	}

	s.log("stdout", "provisioning "+engine+" database "+s.dbName)
	out, err := s.m.host.Run(ctx, argv)
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("database provisioning failed: %w", err)
	}
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] no database daemon was contacted")
	}

	// Register or link this database with the website in store so deletion & lifecycle are tracked
	if s.m.store != nil {
		existing, _ := s.m.store.DatabasesForWebsite(s.req.Slug)
		alreadyTracked := false
		for _, ex := range existing {
			if ex.Name == s.dbName || ex.Alias == alias {
				alreadyTracked = true
				break
			}
		}
		if !alreadyTracked {
			record := &store.Database{
				Kind:        store.KindDatabase,
				WebsiteSlug: s.req.Slug,
				TenantUser:  s.req.Tenant,
				Engine:      engine,
				Alias:       alias,
				Name:        s.dbName,
				User:        s.dbUser,
				Host:        "127.0.0.1",
				Port:        provision.DefaultDBPort(engine),
				Status:      "ready",
				CreatedAt:   time.Now().UTC().Format(time.RFC3339),
			}
			if enc, err := secrets.Encrypt(s.m.key, s.dbPass); err == nil {
				record.PasswordCipher = enc
			}
			_ = s.m.store.CreateDatabase(record)
		}
	}

	if strings.Contains(strings.ToLower(s.req.Framework), "wordpress") && s.dbName != "" {
		s.log("stdout", "configuring WordPress wp-config.php with database credentials...")
		wpConfigCmd := []string{
			"wp", "config", "create",
			"--dbname=" + s.dbName,
			"--dbuser=" + s.dbUser,
			"--dbpass=" + s.dbPass,
			"--dbhost=127.0.0.1",
			"--skip-check",
			"--force",
			"--allow-root",
		}
		out, err := s.m.host.RunInSite(ctx, s.req.Tenant, s.req.Slug, wpConfigCmd)
		s.logOutput(out)
		if err != nil {
			s.log("stderr", "warning: wp config create failed: "+err.Error())
		} else {
			// Inject reverse-proxy SSL support so WordPress outputs https:// assets and avoids Mixed Content
			wpConfigPath := filepath.Join(s.siteDir, "wp-config.php")
			if content, err := os.ReadFile(wpConfigPath); err == nil {
				str := string(content)
				if !strings.Contains(str, "HTTP_X_FORWARDED_PROTO") {
					snippet := "<?php\n// Reverse proxy & Cloudflare SSL detection\nif (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strpos($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) {\n    $_SERVER['HTTPS'] = 'on';\n}\n"
					str = strings.Replace(str, "<?php", snippet, 1)
					_ = os.WriteFile(wpConfigPath, []byte(str), 0o644)
				}
			}
		}
	}

	return nil
}

func stepProvisionCache(ctx context.Context, s *state) error {
	cache := s.req.Cache
	if cache == nil {
		if s.req.Redeploy {
			s.alignExistingWebsiteCache(ctx)
			s.log("stdout", "skipped: redeploy keeps the existing cache")
		} else {
			s.log("stdout", "skipped: no cache requested")
		}
		return nil
	}
	engine := strings.ToLower(cache.Engine)
	if s.cacheUser == "" {
		s.cacheUser = s.req.Tenant + "_" + s.req.Slug
	}
	pass := s.cachePass
	if pass == "" {
		if sec, err := s.m.store.WebsiteSecret(s.req.Slug, "cache_password"); err == nil && sec != "" {
			if dec, err := secrets.Decrypt(s.m.key, sec); err == nil && dec != "" {
				pass = dec
			}
		}
	}
	if pass == "" {
		pass = id.Token(18)
		if enc, err := secrets.Encrypt(s.m.key, pass); err == nil {
			_ = s.m.store.PutWebsiteSecret(s.req.Slug, "cache_password", enc)
		}
	}
	s.cachePass = pass

	var argv []string
	var aclSave []string
	redisHost := dbengine.RedisInstanceHostname(s.req.Slug)
	redisPort := dbengine.DefaultRedisPort
	switch engine {
	case "redis":
		adminURL := s.m.redisURL
		if adminURL == "" {
			adminURL = os.Getenv("BAREPOD_REDIS_URL")
		}
		if adminURL == "" {
			if data, err := os.ReadFile("/etc/barepod/redis-admin.url"); err == nil {
				adminURL = strings.TrimSpace(string(data))
			}
		}
		host, port, adminUser, adminSecret, _ := dbengine.ParseRedisURL(adminURL)
		if host == "" {
			host = "127.0.0.1"
		}
		if port == 0 {
			port = dbengine.DefaultRedisPort
		}
		base := []string{"redis-cli", "-h", host, "-p", strconv.Itoa(port)}
		if adminUser != "" {
			base = append(base, "--user", adminUser)
		}
		if adminSecret != "" {
			base = append(base, "--no-auth-warning", "-a", adminSecret)
		}
		// Every command, minus the ones that reach past this app's own keys (see dbengine
		// for the list and why FLUSHDB is kept).
		argv = append(append([]string{}, base...), "ACL", "SETUSER", s.cacheUser, "on", ">"+pass)
		argv = append(argv, dbengine.RedisAppRules("*")...)
		// ACL SETUSER only changes memory. Without ACL SAVE the user is gone the next
		// time Redis starts — a plain host reboot did exactly that, and every app whose
		// .env still named its cache user got WRONGPASS.
		aclSave = append(append([]string{}, base...), "ACL", "SAVE")
	default:
		return fmt.Errorf("cache engine %q is not supported yet", cache.Engine)
	}

	s.log("stdout", "provisioning "+engine+" cache for "+s.req.Slug+" ("+redisHost+":"+strconv.Itoa(redisPort)+")")
	if engine == "redis" && s.m.host.Materialises() {
		if err := s.provisionIsolatedRedisProcess(ctx, redisHost, redisPort, pass); err != nil {
			return fmt.Errorf("cache provisioning failed: %w", err)
		}
		s.log("stdout", "OK")
	} else {
		out, err := s.m.host.Run(ctx, argv)
		s.logOutput(out)
		if err != nil {
			return fmt.Errorf("cache provisioning failed: %w", err)
		}
		if aclSave != nil {
			if out, err := s.m.host.Run(ctx, aclSave); err != nil {
				s.logOutput(out)
				return fmt.Errorf("persisting the cache ACL failed: %w", err)
			}
		}
	}
	// The cache belongs in the ledger, not only in the app's .env: with a row the Caches screen
	// lists it and DbGate can attach to it, exactly like a cache created from that screen. It is
	// created once — after that it is the operator's to manage (rotate, reveal, bin).
	if engine == "redis" && !s.websiteHasCacheRecord() {
		cipher, err := secrets.Encrypt(s.m.key, pass)
		if err == nil {
			err = s.m.store.CreateDatabase(&store.Database{
				Kind: store.KindCache, WebsiteSlug: s.req.Slug, TenantUser: s.req.Tenant,
				Engine: "redis", Alias: s.cacheUser, Name: s.cacheUser, User: s.cacheUser,
				PasswordCipher: cipher, Host: redisHost, Port: redisPort,
				MaxMemoryMB: dbengine.DefaultRedisMaxMemoryMB, Status: "ready",
			})
		}
		if err != nil {
			s.log("stderr", "cache provisioned, but could not be recorded for the Caches screen: "+err.Error())
		}
	}
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] no cache daemon was contacted")
	}
	return nil
}

func (s *state) provisionIsolatedRedisProcess(ctx context.Context, hostname string, port int, pass string) error {
	if !s.m.host.Materialises() {
		return nil
	}
	stateDir := "/var/lib/barepod/redis"
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return err
	}
	rawHosts, _ := os.ReadFile("/etc/hosts")
	bindIP, usedIPs := dbengine.LookupRedisHostIP(string(rawHosts), hostname, s.cacheUser)
	if bindIP == "" {
		bindIP = dbengine.NextRedisLoopbackIP(usedIPs)
	}
	_ = dbengine.SyncRedisEtcHosts("/etc/hosts", bindIP, hostname, s.cacheUser)
	_, _ = s.m.host.Run(ctx, []string{"ip", "addr", "add", bindIP + "/8", "dev", "lo"})

	confPath := filepath.Join(stateDir, s.cacheUser+".conf")
	pidPath := filepath.Join(stateDir, s.cacheUser+".pid")
	cfgContent := dbengine.RedisInstanceConfig(dbengine.RedisInstanceSpec{
		Name:        s.cacheUser,
		Hostname:    hostname,
		BindIP:      bindIP,
		Port:        port,
		User:        s.cacheUser,
		Secret:      pass,
		MaxMemoryMB: dbengine.DefaultRedisMaxMemoryMB,
		StateDir:    stateDir,
	})
	if err := os.WriteFile(confPath, []byte(cfgContent), 0o600); err != nil {
		return err
	}
	// If any existing redis-server is already bound to bindIP:port, verify whether it accepts
	// this cache's credentials; if not, terminate it before starting the new config.
	if out, err := s.m.host.Run(ctx, []string{"redis-cli", "-h", bindIP, "-p", strconv.Itoa(port), "--no-auth-warning", "--user", s.cacheUser, "-a", pass, "PING"}); err == nil && strings.Contains(strings.ToUpper(out), "PONG") {
		return nil
	}
	if rawPid, err := os.ReadFile(pidPath); err == nil {
		if pid := strings.TrimSpace(string(rawPid)); pid != "" {
			_, _ = s.m.host.Run(ctx, []string{"kill", "-TERM", pid})
		}
	}
	_, _ = s.m.host.Run(ctx, []string{"pkill", "-f", fmt.Sprintf("redis-server %s:%d", bindIP, port)})
	time.Sleep(100 * time.Millisecond)

	if out, err := s.m.host.Run(ctx, []string{"redis-server", confPath}); err != nil {
		return fmt.Errorf("starting redis-server on %s:%d failed: %s", bindIP, port, strings.TrimSpace(out))
	}
	return nil
}

func (s *state) alignExistingWebsiteCache(ctx context.Context) {
	if s.m.store == nil {
		return
	}
	records, err := s.m.store.DatabasesForTenant(store.KindCache, "", false)
	if err != nil {
		return
	}
	for i := range records {
		rec := &records[i]
		if rec.WebsiteSlug != s.req.Slug || rec.Engine != "redis" {
			continue
		}
		hostname := dbengine.RedisInstanceHostname(s.req.Slug)
		port := rec.Port
		if port <= 0 {
			port = dbengine.DefaultRedisPort
		}
		if rec.Host == "" || rec.Host == "127.0.0.1" {
			rec.Host = hostname
			_ = s.m.store.SetDatabaseAddress(rec.ID, hostname, port)
		}
		pass, _ := secrets.Decrypt(s.m.key, rec.PasswordCipher)
		envPath := filepath.Join(s.siteDir, ".env")
		user := rec.User
		if user == "" {
			user = rec.Name
		}
		_, _ = dbengine.AlignRedisEnvFile(envPath, rec.Host, port, user, pass)
		if s.m.host.Materialises() {
			_, _ = s.m.host.Run(ctx, []string{"chown", s.req.Tenant + ":" + s.req.Tenant, envPath})
		}
		return
	}
}

func stepRunBuildScript(ctx context.Context, s *state) error {
	if s.req.Runtime == "proxy" {
		s.log("stdout", "skipped: reverse proxy site has no build automation")
		return nil
	}
	script := strings.TrimSpace(s.req.BuildScript)
	if script == "" {
		if site, err := s.m.store.WebsiteBySlug(s.req.Slug); err == nil && strings.TrimSpace(site.DeployScript) != "" {
			script = strings.TrimSpace(site.DeployScript)
		} else if fw := framework.Detect(s.siteDir); fw != nil && strings.TrimSpace(fw.BuildCommand) != "" {
			script = strings.TrimSpace(fw.BuildCommand)
			s.log("stdout", fmt.Sprintf("auto-detected framework: %s (running recommended build pipeline)", fw.Title))
		}
	}

	if script == "" {
		s.log("stdout", "skipped: no build automation configured or required for this project")
		return nil
	}

	domain := s.req.Domain
	if domain == "" {
		domain = s.req.Slug + ".local"
	}

	var pre strings.Builder
	pre.WriteString("if [ -f .env ]; then set -a; . ./.env 2>/dev/null || true; set +a; fi\n")
	fmt.Fprintf(&pre, "export DOMAIN=%q\n", domain)
	fmt.Fprintf(&pre, "export SITE_NAME=%q\n", s.req.Slug)
	fmt.Fprintf(&pre, "export SLUG=%q\n", s.req.Slug)
	if s.dbName != "" {
		fmt.Fprintf(&pre, "export DB_NAME=%q\n", s.dbName)
		fmt.Fprintf(&pre, "export DB_DATABASE=%q\n", s.dbName)
	}
	if s.dbUser != "" {
		fmt.Fprintf(&pre, "export DB_USER=%q\n", s.dbUser)
		fmt.Fprintf(&pre, "export DB_USERNAME=%q\n", s.dbUser)
	}
	if s.dbPass != "" {
		fmt.Fprintf(&pre, "export DB_PASS=%q\n", s.dbPass)
		fmt.Fprintf(&pre, "export DB_PASSWORD=%q\n", s.dbPass)
	}
	fmt.Fprintf(&pre, "export DB_HOST=%q\n", "127.0.0.1")
	if s.cacheUser != "" {
		fmt.Fprintf(&pre, "export CACHE_USER=%q\n", s.cacheUser)
		fmt.Fprintf(&pre, "export REDIS_USERNAME=%q\n", s.cacheUser)
	}
	if s.cachePass != "" {
		fmt.Fprintf(&pre, "export CACHE_PASS=%q\n", s.cachePass)
		fmt.Fprintf(&pre, "export REDIS_PASSWORD=%q\n", s.cachePass)
	}

	lines := strings.Split(script, "\n")
	var cleanedLines []string
	for _, rawLine := range lines {
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" {
			continue
		}
		// Make WordPress steps resilient against existing wp-config or already-installed site
		if strings.HasPrefix(trimmed, "wp core config") || strings.HasPrefix(trimmed, "wp config create") {
			trimmed = "[ -f wp-config.php ] || " + trimmed + " --skip-check --force"
		} else if strings.HasPrefix(trimmed, "wp core install") {
			if !strings.Contains(trimmed, "--skip-email") {
				trimmed += " --skip-email"
			}
			if !strings.Contains(trimmed, "--admin_password") {
				trimmed += " --admin_password=\"${DB_PASS:-admin}\""
			}
			trimmed = "wp core is-installed || (" + trimmed + " || wp core is-installed)"
		} else if strings.HasPrefix(trimmed, "wp rewrite structure") {
			trimmed = trimmed + " || true"
		} else if strings.HasPrefix(trimmed, "composer ") {
			trimmed = "if [ -f composer.json ]; then " + trimmed + "; else echo 'skipped: composer.json not found in site root'; fi"
		} else if strings.HasPrefix(trimmed, "npm ") || strings.HasPrefix(trimmed, "pnpm ") || strings.HasPrefix(trimmed, "yarn ") {
			trimmed = "if [ -f package.json ]; then " + trimmed + "; else echo 'skipped: package.json not found in site root'; fi"
		} else if strings.HasPrefix(trimmed, "php artisan storage:link") {
			trimmed = "if [ -f artisan ]; then [ -e public/storage ] || " + trimmed + "; else echo 'skipped: artisan not found in site root'; fi"
		} else if strings.HasPrefix(trimmed, "php artisan ") {
			trimmed = "if [ -f artisan ]; then " + trimmed + "; else echo 'skipped: artisan not found in site root'; fi"
		}
		cleanedLines = append(cleanedLines, trimmed)
	}

	s.log("stdout", "running build script as tenant "+s.req.Tenant+":")
	for _, line := range cleanedLines {
		s.log("stdout", "> "+line)
	}

	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] build script execution simulated successfully")
		return nil
	}

	execScript := pre.String() + strings.Join(cleanedLines, "\n")
	out, err := s.m.host.RunInSite(ctx, s.req.Tenant, s.req.Slug, []string{"sh", "-c", execScript})
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("build script failed: %w", err)
	}
	s.log("stdout", "build automation completed successfully")
	return nil
}

// tenantLimits resolves the resource package of a tenant's group.
// An unknown account or group means "unlimited", never a missing limit.
func (m *Manager) tenantLimits(tenant string) resources.Limits {
	account, err := m.store.UserByUsername(tenant)
	if err != nil {
		return resources.Limits{}
	}
	group, err := m.store.GroupByName(account.GroupName)
	if err != nil {
		return resources.Limits{}
	}
	return group.Limits
}

// stepWritePhpPool writes the per-site PHP-FPM pool. The unit's ExecStart already
// points php-fpm at <siteDir>/php-fpm.conf; without this file the master cannot start.
func stepWritePhpPool(ctx context.Context, s *state) error {
	if s.req.Runtime != "php" {
		return nil
	}
	limits := s.m.tenantLimits(s.req.Tenant)
	spec := phpfpm.Spec{
		Tenant:      s.req.Tenant,
		SiteDir:     s.siteDir,
		Socket:      phpfpm.SocketIn(s.siteDir),
		MaxChildren: phpfpm.MaxChildren(limits.MemoryMB),
		MemoryMB:    limits.MemoryMB,
	}
	path, err := phpfpm.Write(ctx, s.m.host, spec)
	if err != nil {
		return err
	}
	s.log("stdout", "php-fpm pool: "+path)
	s.log("stdout", fmt.Sprintf("pool socket %s; limits from the package: pm.max_children=%d memory_limit=%dM",
		spec.Socket, spec.MaxChildren, spec.MemoryMB))
	return nil
}

// ActiveEngine is the host-level web server the panel writes vhosts for: one engine
// owns :80 at a time, so a site's engine is the host's, not its own choice.
func (m *Manager) ActiveEngine() string {
	if v, err := m.store.PanelSetting("active_web_server"); err == nil && webserver.Supported(v) {
		return strings.ToLower(strings.TrimSpace(v))
	}
	return webserver.DefaultEngine
}

// stepWriteVhost writes the site's vhost and reloads the web server, so the site is
// reachable by its domain.
func stepWriteVhost(ctx context.Context, s *state) error {
	engine := s.m.ActiveEngine()
	if !webserver.Supported(engine) {
		return fmt.Errorf("%s is not supported yet — only nginx and caddy are implemented", engine)
	}

	// Laravel and Symfony serve from public/; everything else from the site root.
	home := filepath.Join(s.m.host.SitesRoot, s.req.Tenant)
	if err := webserver.GrantRead(ctx, s.m.host, home, s.siteDir, webserver.WebUser(engine)); err != nil {
		return err
	}
	dir := s.m.host.VhostsFor(engine)
	if _, err := webserver.WriteDefault(engine, dir); err != nil {
		s.log("stdout", "note: the catch-all vhost was not written: "+err.Error())
	}
	spec := webserver.SpecFor(s.req.Slug, s.req.Domain, s.req.Runtime, s.siteDir, s.req.Port)
	upstream := s.req.UpstreamURL
	if upstream == "" && s.m.store != nil {
		if site, err := s.m.store.WebsiteBySlug(s.req.Slug); err == nil && site.UpstreamURL != "" {
			upstream = site.UpstreamURL
		}
	}
	if upstream == "" && s.m.store != nil {
		if raw, err := s.m.store.PanelSetting("site_runtime_config:" + s.req.Slug); err == nil && raw != "" {
			var cfg map[string]any
			if err := json.Unmarshal([]byte(raw), &cfg); err == nil {
				if u, ok := cfg["upstreamUrl"].(string); ok && strings.TrimSpace(u) != "" {
					upstream = strings.TrimSpace(u)
				}
			}
		}
	}
	spec = spec.WithUpstream(upstream)
	if domains, err := s.m.store.ListDomainsForSite(s.req.Slug); err == nil && len(domains) > 0 {
		var aliases []string
		var certPath, keyPath string
		var sslEnabled, forceHTTPS, hsts bool
		for _, d := range domains {
			if !d.IsPrimary {
				aliases = append(aliases, d.Domain)
			} else {
				certPath = d.SSLCertPath
				keyPath = d.SSLKeyPath
				sslEnabled = d.SSLEnabled
				forceHTTPS = d.ForceHTTPS
				hsts = d.HSTSEnabled
			}
		}
		spec = spec.WithSSL(aliases, certPath, keyPath, sslEnabled, forceHTTPS, hsts)
	}
	if sec, err := s.m.store.GetWebsiteSecurity(s.req.Slug); err == nil && sec != nil {
		htpasswdPath := ""
		if sec.BasicAuthEnabled && sec.BasicAuthPasswordHash != "" {
			htpasswdPath = filepath.Join(webserver.AuthDir, sec.WebsiteSlug+".htpasswd")
		}
		spec = spec.WithSecurity(webserver.SecuritySpec{
			MaintenanceMode:      sec.MaintenanceMode,
			MaintenanceTitle:     sec.MaintenanceTitle,
			MaintenanceMessage:   sec.MaintenanceMessage,
			MaintenanceBypassIPs: webserver.ParseIPList(sec.MaintenanceBypassIPs),
			BasicAuthEnabled:     sec.BasicAuthEnabled,
			BasicAuthUser:        sec.BasicAuthUser,
			BasicAuthHash:        sec.BasicAuthPasswordHash,
			BasicAuthFile:        htpasswdPath,
			BasicAuthRealm:       sec.BasicAuthRealm,
			BasicAuthBypassIPs:   webserver.ParseIPList(sec.BasicAuthBypassIPs),
			IPRestrictionMode:    sec.IPRestrictionMode,
			IPRestrictionList:    webserver.ParseIPList(sec.IPRestrictionList),
			RateLimitEnabled:     sec.RateLimitEnabled,
			RateLimitReqPerSec:   sec.RateLimitReqPerSec,
			RateLimitBurst:       sec.RateLimitBurst,
		})
	}
	path, err := webserver.Apply(ctx, engine, dir, s.m.host, spec)
	if err != nil {
		return err
	}
	s.log("stdout", "vhost written and "+engine+" reloaded: "+path)
	s.log("stdout", fmt.Sprintf("the site is served on %s (docroot %s)", s.req.Domain, spec.DocRoot))
	return nil
}

func stepRenderUnit(ctx context.Context, s *state) error {
	if s.req.Runtime == "proxy" {
		s.log("stdout", "skipped: reverse proxy site has no background daemon to supervise")
		return nil
	}
	// cgroup v2 limits come from the tenant's package (group), never hardcoded.
	limits := s.m.tenantLimits(s.req.Tenant)
	spec := supervisor.Spec{
		Slug:      s.req.Slug,
		Tenant:    s.req.Tenant,
		Runtime:   s.req.Runtime,
		Version:   s.req.Version,
		Framework: s.req.Framework,
		WorkDir:   s.siteDir,
		EnvFile:   s.envPath,
		// The tenant's whole home is writable by its service: a tool the app runs may
		// keep state beside the site (composer, npm cache), and it is the tenant's own
		// space — not another account's.
		ReadWritePath: filepath.Join(s.m.host.SitesRoot, s.req.Tenant),
		ExecStart:     provision.ExecStart(s.req.Runtime, s.req.Version, s.req.Framework, s.siteDir, s.req.Port),
		Port:          s.req.Port,
		MemoryMaxMB:   limits.MemoryMB,
		CPUQuota:      limits.CPUQuotaPercent,
		TasksMax:      limits.TasksMax,
	}

	templatePath, dropInPath, err := supervisor.Write(s.m.host.UnitsDir, spec)
	if err != nil {
		return err
	}
	s.log("stdout", "resource limits from the package: "+limits.Describe())
	s.log("stdout", "unit template: "+templatePath)
	s.log("stdout", "per-site override: "+dropInPath)
	s.log("stdout", "exec: "+strings.Join(spec.ExecStart, " "))

	out, err := s.m.host.ReloadUnits(ctx)
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("systemctl daemon-reload failed: %w", err)
	}
	return nil
}

func stepStartService(ctx context.Context, s *state) error {
	if s.req.Runtime == "proxy" {
		s.log("stdout", "skipped: reverse proxy site has no background daemon to start")
		return nil
	}
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] systemctl enable --now barepod-app@"+s.req.Slug+".service was NOT executed")
		s.log("stdout", "[dry-run] the website stays stopped — run the daemon on Linux with systemd and BAREPOD_DRY_RUN=false for real provisioning")
		return nil
	}
	out, err := s.m.host.EnableService(ctx, s.req.Slug)
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("starting the service failed: %w", err)
	}
	return nil
}

func stepHealthCheck(ctx context.Context, s *state) error {
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] health check skipped (no service was started)")
		return nil
	}
	if s.req.Runtime == "proxy" {
		if err := checkVhost(ctx, s); err != nil {
			target := s.req.UpstreamURL
			if target == "" {
				target = fmt.Sprintf("http://127.0.0.1:%d", s.req.Port)
			}
			s.log("stdout", fmt.Sprintf("warning: upstream %s was not reachable during deploy (%s)", target, err.Error()))
			s.log("stdout", "the vhost is active and proxying; verify that your upstream server/container is running and accepting traffic on "+target)
			return nil
		}
		return nil
	}
	// A site with a vhost is asked for by name through the web server: that is the
	// real proof it is served (a PHP site's FPM listens on a socket, not a port).
	if webserver.Supported(s.m.ActiveEngine()) && strings.TrimSpace(s.req.Domain) != "" {
		return checkVhost(ctx, s)
	}
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(s.req.Port))
	deadline := time.Now().Add(30 * time.Second)
	for {
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err == nil {
			_ = conn.Close()
			s.log("stdout", "healthy: "+addr+" accepted a connection")
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("health check failed: %s did not accept connections", addr)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// checkVhost asks the web server for the site by its domain on loopback and accepts
// any answer below 500 — a site that renders an error page is still being served.
func checkVhost(ctx context.Context, s *state) error {
	client := &http.Client{Timeout: 3 * time.Second}
	deadline := time.Now().Add(30 * time.Second)
	last := "no response"
	for {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1/", nil)
		if err != nil {
			return err
		}
		req.Host = s.req.Domain
		resp, err := client.Do(req)
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode < 500 {
				s.log("stdout", fmt.Sprintf("healthy: http://%s/ answered %d through the web server", s.req.Domain, resp.StatusCode))
				return nil
			}
			last = fmt.Sprintf("HTTP %d", resp.StatusCode)
		} else {
			last = err.Error()
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("health check failed: http://%s/ did not answer (last: %s)", s.req.Domain, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
