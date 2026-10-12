// Package deploy runs website provisioning as an asynchronous job.
//
// Every line is persisted, so a client can reconnect (or simply poll) and still
// receive the full log in order. That is what makes the SSE stream safe to
// interrupt: nothing depends on the client being connected.
package deploy

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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
	SSL              bool
	TunnelEnabled    bool
	Source           SourceSpec
	Database         *DatabaseSpec
	Cache            *CacheSpec
	Automation       []string
	// Redeploy keeps the existing database and cache instead of provisioning them.
	Redeploy bool
}

// Manager owns the deploy pipeline.
type Manager struct {
	store *store.Store
	host  *host.Host
	key   []byte
}

// NewManager builds a deploy manager.
func NewManager(st *store.Store, h *host.Host, key []byte) *Manager {
	return &Manager{store: st, host: h, key: key}
}

// Mode is the execution mode of the underlying host: "real" or "dry-run".
func (m *Manager) Mode() string { return m.host.Mode() }

// Start records the job and runs the pipeline in the background.
func (m *Manager) Start(req Request) (*store.DeployJob, error) {
	steps := plan()
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
	m       *Manager
	job     *store.DeployJob
	req     Request
	siteDir string
	envPath string
	dbName  string
	dbUser  string
	dbPass  string
}

type step struct {
	name string
	fn   func(ctx context.Context, s *state) error
}

func plan() []step {
	return []step{
		{"Prepare site directory", stepPrepareDirs},
		{"Fetch source code", stepFetchSource},
		{"Write environment file", stepWriteEnv},
		{"Provision database", stepProvisionDatabase},
		{"Provision cache", stepProvisionCache},
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

	argv := provision.Scaffold(s.req.Framework, s.req.FrameworkVersion)
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
	// A framework download without an entrypoint would start and immediately
	// fail, so write the starter file the preset implies (never overwriting an
	// existing one, so uploaded or cloned code is safe).
	if err := s.writeStarterFiles(ctx); err != nil {
		return err
	}
	// Starter files are written by the daemon itself (as root), so hand them over.
	return s.m.host.ChownSite(ctx, s.req.Tenant, s.req.Slug)
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

func stepWriteEnv(ctx context.Context, s *state) error {
	env := provision.EnvFileLines(s.req.Slug, s.req.Domain, s.req.Port, nil)
	env["APP_KEY"] = "base64:" + id.Token(32)

	if db := s.req.Database; db != nil {
		engine := strings.ToLower(db.Engine)
		raw := db.Name
		if raw == "" {
			raw = s.req.Slug
		}
		if engine == "sqlite" {
			path := filepath.Join(s.siteDir, raw+".sqlite")
			if err := os.WriteFile(path, nil, 0o600); err != nil {
				return err
			}
			s.dbName = raw
			s.log("stdout", "sqlite file created inside the site directory: "+path)
			env["DATABASE_URL"] = provision.DatabaseURL("sqlite", "", "", raw, "", 0, path)
			env["DB_CONNECTION"] = "sqlite"
			env["DB_DATABASE"] = path
		} else {
			// Shared-daemon isolation: names are prefixed with the tenant.
			s.dbName = s.req.Tenant + "_" + raw
			s.dbUser = s.req.Tenant + "_" + raw
			s.dbPass = id.Token(18)

			enc, err := secrets.Encrypt(s.m.key, s.dbPass)
			if err != nil {
				return err
			}
			if err := s.m.store.PutWebsiteSecret(s.req.Slug, "database_password", enc); err != nil {
				return err
			}

			dbPort := provision.DefaultDBPort(engine)
			env["DATABASE_URL"] = provision.DatabaseURL(engine, s.dbUser, s.dbPass, s.dbName, "127.0.0.1", dbPort, "")
			if strings.EqualFold(s.req.Runtime, "php") {
				env["DB_CONNECTION"] = engine
				env["DB_HOST"] = "127.0.0.1"
				env["DB_PORT"] = strconv.Itoa(dbPort)
				env["DB_DATABASE"] = s.dbName
				env["DB_USERNAME"] = s.dbUser
				env["DB_PASSWORD"] = s.dbPass
			}
			s.log("stdout", "database name/user: "+s.dbName+" (tenant-prefixed to avoid shared-daemon collisions)")
			s.log("stdout", "database password generated and stored encrypted (AES-256-GCM)")
		}
	}

	if cache := s.req.Cache; cache != nil {
		engine := strings.ToLower(cache.Engine)
		pass := id.Token(18)
		enc, err := secrets.Encrypt(s.m.key, pass)
		if err != nil {
			return err
		}
		if err := s.m.store.PutWebsiteSecret(s.req.Slug, "cache_password", enc); err != nil {
			return err
		}
		env["CACHE_URL"] = provision.DatabaseURL(engine, "default", pass, "", "127.0.0.1", provision.DefaultDBPort(engine), "")
		s.log("stdout", "cache ("+engine+") password generated and stored encrypted (AES-256-GCM)")
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
	if engine == "sqlite" {
		s.log("stdout", "skipped: sqlite is a file inside the site directory, not a daemon")
		return nil
	}

	var argv []string
	switch engine {
	case "postgres", "postgresql":
		argv = []string{"sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-c",
			fmt.Sprintf("CREATE ROLE %q LOGIN PASSWORD %q; CREATE DATABASE %q OWNER %q;", s.dbUser, s.dbPass, s.dbName, s.dbUser)}
	case "mysql", "mariadb":
		argv = []string{"mysql", "-e",
			fmt.Sprintf("CREATE DATABASE `%s`; CREATE USER '%s'@'localhost' IDENTIFIED BY '%s'; GRANT ALL ON `%s`.* TO '%s'@'localhost';",
				s.dbName, s.dbUser, s.dbPass, s.dbName, s.dbUser)}
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
	return nil
}

func stepProvisionCache(ctx context.Context, s *state) error {
	cache := s.req.Cache
	if cache == nil {
		if s.req.Redeploy {
			s.log("stdout", "skipped: redeploy keeps the existing cache")
		} else {
			s.log("stdout", "skipped: no cache requested")
		}
		return nil
	}
	engine := strings.ToLower(cache.Engine)
	pass := id.Token(18)

	var argv []string
	switch engine {
	case "redis":
		argv = []string{"redis-cli", "ACL", "SETUSER", s.req.Tenant + "_" + s.req.Slug, "on", ">" + pass, "~*", "+@all"}
	default:
		return fmt.Errorf("cache engine %q is not supported yet", cache.Engine)
	}

	s.log("stdout", "provisioning "+engine+" cache for "+s.req.Slug)
	out, err := s.m.host.Run(ctx, argv)
	s.logOutput(out)
	if err != nil {
		return fmt.Errorf("cache provisioning failed: %w", err)
	}
	if !s.m.host.Materialises() {
		s.log("stdout", "[dry-run] no cache daemon was contacted")
	}
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

// stepWriteVhost writes the site's vhost and reloads the web server, so the site is
// reachable by its domain. Only nginx is implemented; any other engine is refused by
// name rather than silently ignored.
func stepWriteVhost(ctx context.Context, s *state) error {
	engine := strings.TrimSpace(s.req.WebServer)
	if !webserver.Supported(engine) {
		return fmt.Errorf("%s is not supported yet — only nginx is implemented", engine)
	}

	// Laravel and Symfony serve from public/; everything else from the site root.
	home := filepath.Join(s.m.host.SitesRoot, s.req.Tenant)
	if err := webserver.GrantRead(ctx, s.m.host, home, s.siteDir, s.m.host.EffectiveWebUser()); err != nil {
		return err
	}
	if _, err := webserver.WriteDefault(s.m.host.Vhosts()); err != nil {
		s.log("stdout", "note: the catch-all vhost was not written: "+err.Error())
	}
	spec := webserver.SpecFor(s.req.Slug, s.req.Domain, s.req.Runtime, s.siteDir, s.req.Port)
	path, err := webserver.Apply(ctx, s.m.host, s.m.host.Vhosts(), spec)
	if err != nil {
		return err
	}
	s.log("stdout", "vhost written and the web server reloaded: "+path)
	s.log("stdout", fmt.Sprintf("the site is served on %s (docroot %s)", s.req.Domain, spec.DocRoot))
	return nil
}

func stepRenderUnit(ctx context.Context, s *state) error {
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
	// A site with a vhost is asked for by name through the web server: that is the
	// real proof it is served (a PHP site's FPM listens on a socket, not a port).
	if webserver.Supported(s.req.WebServer) && strings.TrimSpace(s.req.Domain) != "" {
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
