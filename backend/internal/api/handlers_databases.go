package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/files"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// databaseUserPattern is what a requested engine account may look like: it becomes an
// identifier in the engine's own namespace, so it is validated instead of trusted.
var databaseUserPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// databaseRequest is the create payload for a database or a cache.
type databaseRequest struct {
	Engine  string `json:"engine"`
	Version string `json:"version"`
	Alias   string `json:"alias"`
	// Username is the engine account the operator asked for. Empty means the panel
	// derives one from the database name.
	Username       string `json:"username"`
	WebsiteSlug    string `json:"websiteSlug"`
	Password       string `json:"password"`
	MaxConnections int    `json:"maxConnections"`
	MaxMemoryMB    int    `json:"maxMemoryMb"`
}

type rotateRequest struct {
	Password string `json:"password"`
}

type databasePatch struct {
	Alias          string `json:"alias"`
	MaxConnections int    `json:"maxConnections"`
	MaxMemoryMB    int    `json:"maxMemoryMb"`
}

// handleDbEngines reports the engines this host can really run.
func (s *Server) handleDbEngines(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	writeJSON(w, http.StatusOK, map[string]any{"items": dbengine.Detect(r.Context(), s.host.Runner)})
}

// databaseScope resolves which records a caller may see: an admin sees every
// account's, everyone else only their own.
func databaseScope(user *store.User) string {
	if user.Role == "admin" {
		return ""
	}
	return user.Username
}

// canManageDatabase is the ownership rule: an admin, or the account that owns it.
func canManageDatabase(user *store.User, db *store.Database) bool {
	return user.Role == "admin" || db.TenantUser == user.Username
}

// findDatabase loads a record and answers 404 for anything the caller may not
// touch (404, not 403: the panel never confirms that someone else's resource
// exists).
func (s *Server) findDatabase(w http.ResponseWriter, r *http.Request, user *store.User, kind string) (*store.Database, bool) {
	id := r.PathValue("id")
	if dbengine.IsDetectedID(id) {
		record, ok := s.detectedDatabase(id, kind, user)
		if !ok {
			writeError(w, http.StatusNotFound, "not_found", "No such record")
			return nil, false
		}
		return record, true
	}
	record, err := s.store.DatabaseByID(id)
	if err != nil || record.Kind != kind || !canManageDatabase(user, record) {
		writeError(w, http.StatusNotFound, "not_found", "No such record")
		return nil, false
	}
	return record, true
}

// withSizes fills in the size of file-based databases. A daemon engine would need
// a query per row, so it keeps 0 and the UI shows that it is unknown.
func withSizes(items []store.Database) []store.Database {
	for i := range items {
		if items[i].FilePath == "" {
			continue
		}
		if info, err := os.Stat(items[i].FilePath); err == nil {
			items[i].SizeBytes = info.Size()
		}
	}
	return items
}

// withLiveEngineMetadata fills in the size of file-based databases and updates
// daemon-based databases with the live engine and version currently running on the
// host or in container.
func (s *Server) withLiveEngineMetadata(ctx context.Context, items []store.Database) []store.Database {
	items = withSizes(items)
	for i := range items {
		if items[i].FileBased {
			continue
		}
		engName := items[i].Engine
		if engName == "postgres" {
			engName = "postgresql"
		} else if engName == "mysql" {
			engName = "mariadb"
		}
		if eng, ok := s.engineFor(ctx, engName); ok {
			if eng.Installed != "" {
				items[i].Version = eng.Installed
			}
			if eng.Running {
				items[i].Status = "ready"
			}
		}
	}
	return items
}

// detectedDatabase turns a "det:" id back into a record, re-checking that the file
// is still inside a website the caller may manage and that it really is a SQLite
// database. Nothing is stored for it.
func (s *Server) detectedDatabase(id, kind string, user *store.User) (*store.Database, bool) {
	slug, relative, ok := dbengine.ParseDetectedID(id)
	if !ok {
		return nil, false
	}
	site, err := s.store.WebsiteBySlug(slug)
	if err != nil || !canManageSite(user, site) {
		return nil, false
	}
	root := s.host.SitePath(site.TenantUser, site.Slug)
	full := filepath.Join(root, filepath.FromSlash(relative))
	cleanRoot, cleanFull := filepath.Clean(root), filepath.Clean(full)
	if !strings.HasPrefix(cleanFull, cleanRoot+string(filepath.Separator)) {
		return nil, false // a relative path that climbed out of the site
	}
	if !dbengine.FileHasSQLiteHeader(cleanFull) {
		return nil, false
	}
	info, err := os.Stat(cleanFull)
	if err != nil || info.IsDir() {
		return nil, false
	}
	ver := dbengine.SQLiteFileVersion(cleanFull)
	if ver == "" {
		ver = "3"
	}
	return &store.Database{
		ID: id, Kind: kind, Engine: "sqlite", Version: ver, FileBased: true, Detected: true,
		WebsiteSlug: site.Slug, TenantUser: site.TenantUser,
		Alias: filepath.Base(relative), Name: filepath.Base(relative),
		FilePath: cleanFull, Status: "ready", SizeBytes: info.Size(),
		CreatedAt: info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
	}, true
}

// detectedFor lists the SQLite files inside the websites a caller may manage.
func (s *Server) detectedFor(user *store.User, kind string) []store.Database {
	if kind != store.KindDatabase {
		return nil
	}
	sites, err := s.store.ListWebsites()
	if err != nil {
		return nil
	}
	// A file the ledger already knows about is not "detected": otherwise a database
	// the panel created shows up twice (once as managed, once as found).
	known := map[string]bool{}
	if records, err := s.store.DatabasesForTenant(kind, "", false); err == nil {
		for _, record := range records {
			if record.FilePath != "" {
				known[filepath.Clean(record.FilePath)] = true
			}
		}
	}
	out := []store.Database{}
	for i := range sites {
		site := &sites[i]
		if !canManageSite(user, site) {
			continue
		}
		root := s.host.SitePath(site.TenantUser, site.Slug)
		found, err := dbengine.ScanSQLiteFiles(root, site.Slug, site.TenantUser, 3, 25)
		if err != nil {
			continue
		}
		for _, file := range found {
			if known[filepath.Clean(file.Path)] || !dbengine.FileHasSQLiteHeader(file.Path) {
				continue
			}
			ver := file.Version
			if ver == "" {
				ver = "3"
			}
			out = append(out, store.Database{
				ID: dbengine.DetectedID(file.SiteSlug, file.Relative), Kind: kind,
				Engine: "sqlite", Version: ver, FileBased: true, Detected: true,
				WebsiteSlug: file.SiteSlug, TenantUser: file.TenantUser,
				Alias: filepath.Base(file.Relative), Name: filepath.Base(file.Relative),
				FilePath: file.Path, Status: "ready", SizeBytes: file.SizeBytes,
				CreatedAt: file.ModifiedAt,
			})
		}
	}
	return out
}

// refuseDetected explains why an application's own database cannot be changed from
// here (the File Manager is the honest way to delete a file).
func refuseDetected(w http.ResponseWriter, record *store.Database) bool {
	if !record.Detected {
		return false
	}
	writeError(w, http.StatusConflict, "app_managed",
		"This database belongs to the application, not to the panel: browse and query it here, and delete the file from the File Manager if you really mean to")
	return true
}

// engineFor answers with the engine as this host really has it. The catalog entry
// never knows what is installed, so every lifecycle decision goes through here.
func (s *Server) engineFor(ctx context.Context, name string) (dbengine.Engine, bool) {
	s.engineMu.Lock()
	if entry, ok := s.engineCache[name]; ok && time.Since(entry.at) < engineCacheTTL {
		s.engineMu.Unlock()
		return entry.engine, entry.engine.Name != ""
	}
	s.engineMu.Unlock()

	found := dbengine.Engine{}
	known := false
	for _, candidate := range dbengine.Detect(ctx, s.host.Runner) {
		if strings.EqualFold(candidate.Name, name) {
			found, known = candidate, true
			break
		}
	}
	s.engineMu.Lock()
	if s.engineCache == nil {
		s.engineCache = map[string]cachedEngine{}
	}
	s.engineCache[name] = cachedEngine{engine: found, at: time.Now()}
	s.engineMu.Unlock()
	return found, known
}

// resourceFor builds a plan target for a record, adding the admin connection a
// shared Redis needs (PostgreSQL and MySQL are reached locally as root).
func (s *Server) resourceFor(record *store.Database, secret string) dbengine.Resource {
	resource := dbengine.Resource{
		Engine: record.Engine, Name: record.Name, User: record.User,
		Secret: secret, Port: record.Port, MaxConn: record.MaxConns,
	}
	if record.Engine == "redis" {
		host, port, adminSecret, err := dbengine.ParseRedisURL(s.cfg.RedisURL)
		if err == nil {
			resource.AdminHost, resource.AdminPort, resource.AdminSecret = host, port, adminSecret
		}
	}
	// A containerised engine is administered over loopback as the administrator
	// account the panel created for it — no socket, no peer authentication.
	if credential, err := s.store.EngineCredential(record.Engine); err == nil {
		if password, derr := secrets.Decrypt(s.key, credential.Ciphertext); derr == nil {
			resource.Mode = dbengine.ModeDocker
			resource.AdminHost, resource.AdminPort = credential.Host, credential.Port
			resource.AdminUser, resource.AdminSecret = credential.AdminUser, password
		}
	}
	return resource
}

// handleListDatabases: /databases and /caches, optionally the recycle bin.
func (s *Server) handleListDatabases(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		binned := strings.EqualFold(r.URL.Query().Get("bin"), "true")
		// ?detached=true narrows the list to databases that outlived their website.
		detachedOnly := strings.EqualFold(r.URL.Query().Get("detached"), "true")
		items, err := s.store.DatabasesForTenant(kind, databaseScope(user), binned)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not list the records")
			return
		}
		if detachedOnly {
			kept := items[:0]
			for _, item := range items {
				if item.DetachedAt != "" {
					kept = append(kept, item)
				}
			}
			items = kept
		} else if !binned {
			// Files the application created belong in the answer: a page that says
			// "no databases" while the app has one is worse than useless.
			items = append(items, s.detectedFor(user, kind)...)
		}
		sort.SliceStable(items, func(i, j int) bool { return items[i].Alias < items[j].Alias })
		response := map[string]any{
			"items":         s.withLiveEngineMetadata(r.Context(), items),
			"bin":           binned,
			"retentionDays": 30,
		}
		// An account under a package limit is told what it is: the panel's own screens
		// can then say "2 of 2 used" instead of letting a create fail unexplained.
		if !binned {
			if tenant := databaseScope(user); tenant != "" {
				if limits := s.limitsForTenant(tenant); limits.MaxDatabases > 0 {
					if used, err := s.store.CountDatabasesByTenant(tenant); err == nil {
						response["quota"] = map[string]int{"maxDatabases": limits.MaxDatabases, "usedDatabases": used}
					}
				}
			}
		}
		writeJSON(w, http.StatusOK, response)
	}
}

// enforceDatabaseQuota applies the account's package limit before another record is
// created or restored: the group's MaxDatabases, where 0 means unlimited and an admin's
// group has no ceiling. Only live records count — a binned one is not in use — so a
// restore is checked too, or the recycle bin would be a way around the limit.
func (s *Server) enforceDatabaseQuota(w http.ResponseWriter, tenant string) bool {
	limits := s.limitsForTenant(tenant)
	if limits.MaxDatabases <= 0 {
		return true
	}
	used, err := s.store.CountDatabasesByTenant(tenant)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not check the package limits")
		return false
	}
	if used >= limits.MaxDatabases {
		writeError(w, http.StatusConflict, "quota_exceeded", fmt.Sprintf(
			"this account may own at most %d databases and it already has %d — the package limit for this account has been reached",
			limits.MaxDatabases, used))
		return false
	}
	return true
}

// handleListRecycleBin is the same listing, forced to binned items.
func (s *Server) handleListRecycleBin(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		items, err := s.store.DatabasesForTenant(kind, databaseScope(user), true)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not read the recycle bin")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": s.withLiveEngineMetadata(r.Context(), items), "bin": true, "retentionDays": 30})
	}
}

// handleCreateDatabase provisions a database or cache.
//
// Three honest outcomes: SQLite is a file the daemon creates inside the site; a
// daemon engine whose client is installed gets its SQL run; anything else is
// recorded with a note that says what is missing, instead of pretending.
func (s *Server) handleCreateDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		var req databaseRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
			return
		}

		// Availability has to come from a detection run, not from the catalog: the
		// catalog entry does not know what is installed on this host.
		var engine dbengine.Engine
		for _, candidate := range dbengine.Detect(r.Context(), s.host.Runner) {
			if strings.EqualFold(candidate.Name, strings.TrimSpace(req.Engine)) {
				engine = candidate
				break
			}
		}
		if engine.Name == "" || engine.Kind != kind {
			writeError(w, http.StatusBadRequest, "validation_error", "Unknown engine for this resource")
			return
		}
		alias := strings.TrimSpace(req.Alias)
		if alias == "" {
			writeError(w, http.StatusBadRequest, "validation_error", "A name is required")
			return
		}

		tenant := user.Username
		// The version is the one the Stack recorded for this engine (or the one really
		// installed), so the record stops carrying an inert string.
		version := strings.TrimSpace(req.Version)
		if version == "" {
			if chosen, err := s.store.PanelSetting("db_version_" + engine.Name); err == nil {
				version = strings.TrimSpace(chosen)
			}
		}
		if version == "" {
			version = engine.Installed
		}
		record := &store.Database{
			Kind:        kind,
			Engine:      engine.Name,
			Version:     version,
			Alias:       alias,
			TenantUser:  tenant,
			Host:        "",
			Port:        engine.DefaultPort,
			MaxConns:    req.MaxConnections,
			MaxMemoryMB: req.MaxMemoryMB,
			Status:      "ready",
		}

		// A website may own the database; then the tenant is that website's owner.
		if slug := strings.TrimSpace(req.WebsiteSlug); slug != "" {
			site, err := s.store.WebsiteBySlug(slug)
			if err != nil || !canManageSite(user, site) {
				writeError(w, http.StatusNotFound, "not_found", "Website not found")
				return
			}
			record.WebsiteSlug = site.Slug
			record.TenantUser = site.TenantUser
		}

		if _, err := s.store.DatabaseByAlias(kind, record.TenantUser, alias); err == nil {
			writeError(w, http.StatusConflict, "already_exists", "That name is already in use")
			return
		}
		// The owner must be a real panel account (a website could carry an owner
		// string that no longer names anyone).
		if _, err := s.store.UserByUsername(record.TenantUser); err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", "The owner account does not exist")
			return
		}
		// Package guard, exactly as for websites: the account's group may cap how many
		// databases it owns, and it is checked before anything is provisioned.
		if !s.enforceDatabaseQuota(w, record.TenantUser) {
			return
		}

		// The engine-side name is prefixed with the account, so two accounts can
		// both call their database "shop" without colliding.
		record.Name = s.uniqueDatabaseName(record.TenantUser, alias)

		// A username the form offered is honoured rather than ignored (it used to be, for
		// every engine): the engine account is what the operator asked for, and the name
		// the panel derived is only the fallback.
		if requested := strings.TrimSpace(req.Username); requested != "" {
			if !databaseUserPattern.MatchString(requested) {
				writeError(w, http.StatusBadRequest, "validation_error",
					"A username may use lower-case letters, digits and underscores, must start with a letter, and is at most 32 characters")
				return
			}
			record.User = requested
		}

		if err := s.provisionDatabase(r.Context(), user, record, req.Password, engine); err != nil {
			writeError(w, http.StatusBadRequest, "validation_error", err.Error())
			return
		}
		if err := s.store.CreateDatabase(record); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not record the database")
			return
		}

		_ = s.store.Audit(user.ID, "database.create", record.Name, clientIP(r),
			fmt.Sprintf("engine=%s status=%s", record.Engine, record.Status))

		// A new record is private, and that has to be true in the kernel from the first second —
		// not only after the next restart. Reconciliation at start covers what already exists;
		// this covers what is created while the panel runs, and for a containerised engine it is
		// the difference between a promise and a fact (measured: its port was otherwise open from
		// the network until somebody moved the switch or the panel restarted).
		if err := s.holdPortPrivate(r.Context(), record); err != nil {
			writeError(w, http.StatusBadGateway, "firewall_error",
				"the record was created, but its port could not be made private: "+err.Error())
			return
		}

		// The generated password is shown exactly once, here.
		response := map[string]any{"database": record}
		if record.PasswordCipher != "" {
			if plain, err := secrets.Decrypt(s.key, record.PasswordCipher); err == nil && req.Password == "" {
				response["password"] = plain
				response["passwordShownOnce"] = true
			}
		}
		writeJSON(w, http.StatusCreated, response)
	}
}

// slugify turns a display name into an identifier an engine accepts: lowercase,
// digits and underscores only, so nothing that reaches SQL can need quoting.
func slugify(value string) string {
	var out strings.Builder
	lastUnderscore := false
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out.WriteRune(r)
			lastUnderscore = false
		default:
			if !lastUnderscore && out.Len() > 0 {
				out.WriteByte('_')
				lastUnderscore = true
			}
		}
	}
	return strings.Trim(out.String(), "_")
}

// uniqueDatabaseName builds "<tenant>_<alias>" and adds a suffix if taken.
func (s *Server) uniqueDatabaseName(tenant, alias string) string {
	base := slugify(tenant + "_" + alias)
	if base == "" {
		base = "db"
	}
	name := base
	for suffix := 2; suffix < 50; suffix++ {
		inUse, err := s.store.DatabaseNameInUse(name)
		if err != nil || !inUse {
			return name
		}
		name = fmt.Sprintf("%s_%d", base, suffix)
	}
	return base + "_" + id.Token(4)
}

// provisionDatabase fills in the credential and brings the engine-side object
// into existence as far as this host allows.
func (s *Server) provisionDatabase(ctx context.Context, user *store.User, record *store.Database, supplied string, engine dbengine.Engine) error {
	password := supplied
	if password == "" {
		password = id.Token(24)
	} else if len(password) < 12 {
		return errors.New("a password must be at least 12 characters")
	}
	ciphertext, err := secrets.Encrypt(s.key, password)
	if err != nil {
		return errors.New("the credential could not be stored")
	}
	record.PasswordCipher = ciphertext

	switch {
	case engine.FileBased:
		// SQLite lives inside the site: create the file as the tenant so it
		// belongs to the account, not to the daemon.
		root := s.databaseFileDir(record)
		if root == "" {
			return errors.New("a SQLite database needs a website to live in")
		}
		record.User, record.Host = "", ""
		record.FilePath = s.databaseFilePath(record, root)
		record.FileBased = true
		return s.createSQLiteFile(ctx, record)

	case engine.Mode == dbengine.ModeDocker:
		// A container engine is brought up first: "not installed" does not apply to
		// it, because the panel runs it itself (one container per engine). The record
		// keeps the container's own loopback port, not the engine's default one —
		// otherwise the connection it hands out (and the port the UI prints) points
		// at nothing.
		credential, err := s.ensureEngineRunning(ctx, engine)
		if err != nil {
			record.Status = "failed"
			record.Note = err.Error()
			return nil
		}
		if credential != nil {
			record.Host, record.Port = credential.Host, credential.Port
		}
		if engine.Name == "mongodb" {
			// MongoDB is administered through the panel's driver, not a client: the
			// user is created inside the running container. A username the form asked
			// for is kept; otherwise the engine-side name is the record's own.
			if record.User == "" {
				record.User = record.Name
			}
			return s.provisionMongo(ctx, user, record, password, engine)
		}
	case !engine.Available:
		record.Status = "pending"
		record.Note = fmt.Sprintf("%s is not installed on this host, so the %s was recorded but not created. Install it and rotate the password to finish.",
			engine.Client, strings.ToLower(engine.Label))
		return nil

	case !s.host.Materialises():
		record.Status = "pending"
		record.Note = "The daemon is in dry-run mode: the credentials were stored and the SQL was not run."
		return nil
	}

	if record.User == "" {
		record.User = record.Name
	}
	record.Host = "127.0.0.1"
	if engine.Name == "redis" && engine.Mode != dbengine.ModeDocker {
		// A host cache reports the address a client should use, which the admin URL
		// names. A containerised one already kept the container's own loopback port
		// from the credential, and must not be pointed at the host's Redis.
		if host, port, _, err := dbengine.ParseRedisURL(s.cfg.RedisURL); err == nil {
			record.Host, record.Port = host, port
		}
	}
	plan, err := dbengine.PlanFor(dbengine.StepProvision, s.resourceFor(record, password))
	if err != nil {
		return err
	}
	if len(plan.Commands) == 0 {
		record.Status = "pending"
		record.Note = plan.Note
		return nil
	}
	if err := s.runDatabasePlan(ctx, plan); err != nil {
		record.Status = "failed"
		record.Note = err.Error()
		return nil
	}
	// The connection limit asked for at create time is applied with the engine, not
	// only stored: the provision plan creates the role, this is what limits it.
	if record.MaxConns > 0 {
		if err := s.applyConnectionLimit(ctx, record, record.MaxConns); err != nil {
			record.Note = "The connection limit was not applied: " + err.Error()
		}
	}
	_ = s.store.Audit(user.ID, "database.provision", record.Name, "", fmt.Sprintf("%s %s", engine.Name, record.Version))
	return nil
}

// ensureDatabaseProvisioned re-runs the provision plan for a daemon database using its
// existing decrypted password to ensure the user and database exist in the engine.
func (s *Server) ensureDatabaseProvisioned(ctx context.Context, record *store.Database, password string, engine dbengine.Engine) error {
	if record.FileBased || !engine.Running || !s.host.Materialises() {
		return nil
	}
	plan, err := dbengine.PlanFor(dbengine.StepProvision, s.resourceFor(record, password))
	if err != nil || len(plan.Commands) == 0 {
		return err
	}
	return s.runDatabasePlan(ctx, plan)
}

// databaseFileDir is where a file-based database belongs: inside the website it
// was created for.
func (s *Server) databaseFileDir(record *store.Database) string {
	if record.WebsiteSlug == "" {
		return ""
	}
	site, err := s.store.WebsiteBySlug(record.WebsiteSlug)
	if err != nil {
		return ""
	}
	return s.host.SitePath(site.TenantUser, site.Slug)
}

// createSQLiteFile makes the database file, owned by the tenant.
func (s *Server) createSQLiteFile(ctx context.Context, record *store.Database) error {
	site, err := s.store.WebsiteBySlug(record.WebsiteSlug)
	if err != nil {
		return errors.New("the website could not be loaded")
	}
	manager := s.fileManagerForSite(site)
	if manager == nil {
		return errors.New("the website directory could not be opened")
	}
	relative := strings.TrimPrefix(strings.TrimPrefix(record.FilePath, s.host.SitePath(site.TenantUser, site.Slug)), "/")
	if _, err := manager.Write(relative, []byte{}); err != nil {
		record.Status = "failed"
		record.Note = err.Error()
		return nil
	}
	if err := s.host.ChownSite(ctx, site.TenantUser, site.Slug); err != nil {
		return err
	}
	return nil
}

// fileManagerForSite builds a file manager rooted at one website.
func (s *Server) fileManagerForSite(site *store.Website) *files.Manager {
	root := s.host.SitePath(site.TenantUser, site.Slug)
	manager, err := files.NewManager(root, s.fileOps(site.TenantUser), s.maxUploadBytes)
	if err != nil {
		return nil
	}
	return manager
}

// runDatabasePlan executes the SQL a lifecycle step needs.
func (s *Server) runDatabasePlan(ctx context.Context, plan dbengine.Plan) error {
	for _, argv := range plan.Commands {
		var out string
		var err error
		if plan.RunAs != "" {
			out, err = s.host.RunAs(ctx, plan.RunAs, argv)
		} else {
			out, err = s.host.Run(ctx, argv)
		}
		if err != nil {
			message := strings.TrimSpace(out)
			if message == "" {
				message = err.Error()
			}
			return fmt.Errorf("%s failed: %s", argv[0], message)
		}
	}
	return nil
}

// applyConnectionLimit tells the engine about a per-database connection limit as
// that database's own user. A file-based engine, a missing client, or a dry-run
// host has nowhere to apply it, so the number stays in the ledger.
func (s *Server) applyConnectionLimit(ctx context.Context, record *store.Database, limit int) error {
	engine, found := s.engineFor(ctx, record.Engine)
	if !found || engine.FileBased || !engine.Available || !s.host.Materialises() {
		return nil
	}
	updated := *record
	updated.MaxConns = limit
	plan, err := dbengine.PlanFor(dbengine.StepLimits, s.resourceFor(&updated, ""))
	if err != nil {
		return err
	}
	if len(plan.Commands) == 0 {
		return nil
	}
	return s.runDatabasePlan(ctx, plan)
}

// handleGetDatabase returns one record.
func (s *Server) handleGetDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"database": s.withLiveEngineMetadata(r.Context(), []store.Database{*record})[0]})
	}
}

// handlePatchDatabase changes the alias and the limits.
func (s *Server) handlePatchDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		var patch databasePatch
		if err := decodeJSON(r, &patch); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
			return
		}
		alias := record.Alias
		if strings.TrimSpace(patch.Alias) != "" {
			alias = strings.TrimSpace(patch.Alias)
		}
		// A changed connection limit is told to the engine, not merely stored: a
		// number that never reaches the server would be a promise the panel cannot
		// keep. An engine with nowhere to apply it (a file, a missing client,
		// dry-run) keeps the number in the ledger.
		if patch.MaxConnections > 0 && patch.MaxConnections != record.MaxConns {
			if err := s.applyConnectionLimit(r.Context(), record, patch.MaxConnections); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", "The connection limit was not applied: "+err.Error())
				return
			}
		}
		if err := s.store.SetDatabaseLimits(record.ID, alias, patch.MaxConnections, patch.MaxMemoryMB); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not save the change")
			return
		}
		_ = s.store.Audit(user.ID, "database.update", record.Name, clientIP(r), alias)
		updated, _ := s.store.DatabaseByID(record.ID)
		response := map[string]any{"database": updated}
		// A memory limit is recorded and never applied, and saying so is the difference between a
		// field that means something and one that implies a promise. No engine here enforces a
		// per-database memory ceiling — PostgreSQL and MariaDB have none, and Redis's is per
		// instance — so the number is kept as the ledger's note of what the operator allowed, and
		// the response says exactly that. Measured: this was the one wire field that silently did
		// nothing.
		if patch.MaxMemoryMB > 0 && patch.MaxMemoryMB != record.MaxMemoryMB {
			response["note"] = "maxMemoryMb is recorded, not applied: no engine here enforces a per-database memory limit (connection limits are applied — see applyConnectionLimit)."
			_ = s.store.Audit(user.ID, "database.limits", record.Name, clientIP(r),
				fmt.Sprintf("maxConnections=%d (applied), maxMemoryMb=%d (recorded only)", patch.MaxConnections, patch.MaxMemoryMB))
		}
		writeJSON(w, http.StatusOK, response)
	}
}

// handleRotateDatabasePassword sets a new credential and, when possible, tells
// the engine about it.
func (s *Server) handleRotateDatabasePassword(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if refuseDetected(w, record) {
			return
		}
		var req rotateRequest
		if r.ContentLength > 0 {
			if err := decodeJSON(r, &req); err != nil {
				writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
				return
			}
		}
		password := strings.TrimSpace(req.Password)
		if password == "" {
			password = id.Token(24)
		} else if len(password) < 12 {
			writeError(w, http.StatusBadRequest, "validation_error", "A password must be at least 12 characters")
			return
		}

		engine, _ := s.engineFor(r.Context(), record.Engine)
		if engine.Name == "mongodb" && engine.Mode == dbengine.ModeDocker && s.host.Materialises() {
			if err := s.rotateMongo(r.Context(), record, password, engine); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", fmt.Sprintf("the password was not changed in MongoDB: %v", err))
				return
			}
			// A rotate is what the panel's note tells the operator to do to finish a
			// record that was never created, so a success makes it usable.
			_ = s.store.SetDatabaseStatus(record.ID, "ready", "")
		} else if !engine.FileBased && engine.Available && s.host.Materialises() {
			// A record from before the engine account was named has no user at all, and the
			// create plan refuses an empty one — so finishing it would fail with "a name and
			// a user are required" instead of creating anything. Give it the name the panel
			// would have used, exactly as a create does.
			if record.User == "" {
				record.User = record.Name
				if err := s.store.SetDatabaseUser(record.ID, record.User); err != nil {
					writeError(w, http.StatusInternalServerError, "internal", "Could not record the account name")
					return
				}
			}
			// A record that was never really created (its create ran while the engine
			// was not installed) is finished here instead of refused: the note the panel
			// left on it points at exactly this action, and the create plan — not an
			// ALTER on a role that does not exist — is what makes it real.
			step := dbengine.StepRotate
			finishing := record.Status != "ready" && record.Status != "suspended"
			if finishing {
				step = dbengine.StepProvision
			}
			plan, err := dbengine.PlanFor(step, s.resourceFor(record, password))
			if err != nil {
				writeError(w, http.StatusBadRequest, "validation_error", err.Error())
				return
			}
			if err := s.runDatabasePlan(r.Context(), plan); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
			if finishing {
				_ = s.store.SetDatabaseStatus(record.ID, "ready", "")
			}
		}

		ciphertext, err := secrets.Encrypt(s.key, password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not store the credential")
			return
		}
		if err := s.store.UpdateDatabasePassword(record.ID, ciphertext); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not save the credential")
			return
		}
		// A manager that is already open holds the password it was started with, so it
		// would keep failing with the old one until it restarted: drop it here.
		s.dropManagers(r.Context(), record)
		_ = s.store.Audit(user.ID, "database.rotate_password", record.Name, clientIP(r), "")
		writeJSON(w, http.StatusOK, map[string]any{"id": record.ID, "password": password})
	}
}

// handleRevealDatabase returns the credential after a fresh panel-password check.
func (s *Server) handleRevealDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		// Ownership first: another account's record must answer 404 even for an
		// unelevated caller, or the refusal itself would confirm it exists.
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if refuseDetected(w, record) {
			return
		}
		if !sessionElevated(sess) {
			writeError(w, http.StatusForbidden, "elevation_required",
				"Confirm your panel password again before revealing a credential")
			return
		}
		plain, err := secrets.Decrypt(s.key, record.PasswordCipher)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
			return
		}
		_ = s.store.Audit(user.ID, "database.reveal", record.Name, clientIP(r), "")
		writeJSON(w, http.StatusOK, map[string]any{
			"id":        record.ID,
			"user":      record.User,
			"password":  plain,
			"expiresIn": 60,
		})
	}
}

// handleConnectionString composes what a client needs, including the password,
// so it needs the same fresh check as a reveal.
func (s *Server) handleConnectionString(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if !sessionElevated(sess) {
			writeError(w, http.StatusForbidden, "elevation_required",
				"Confirm your panel password again before revealing a connection string")
			return
		}
		password, err := secrets.Decrypt(s.key, record.PasswordCipher)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
			return
		}
		_ = s.store.Audit(user.ID, "database.connection_string", record.Name, clientIP(r), "")
		writeJSON(w, http.StatusOK, map[string]any{
			"string": connectionString(*record, password),
			"engine": record.Engine,
		})
	}
}

// connectionString builds the DSN a developer would paste into a config file.
func connectionString(record store.Database, password string) string {
	switch record.Engine {
	case "postgresql":
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s", record.User, password, record.Host, record.Port, record.Name)
	case "mysql", "mariadb":
		return fmt.Sprintf("mysql://%s:%s@%s:%d/%s", record.User, password, record.Host, record.Port, record.Name)
	case "mongodb":
		return fmt.Sprintf("mongodb://%s:%s@%s:%d/%s", record.User, password, record.Host, record.Port, record.Name)
	case "redis":
		return fmt.Sprintf("redis://:%s@%s:%d", password, record.Host, record.Port)
	case "sqlite":
		return "file:" + record.FilePath
	}
	return ""
}

// handleExportDatabase streams a logical dump of one database. There is no
// separate "export" service: the daemon runs the engine's own dumper as that
// database's user, with the credential in the environment (never in argv), and
// the bytes go straight back. SQLite is a file, so its dump is a copy of it.
func (s *Server) handleExportDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if record.Engine == "redis" || record.Engine == "mongodb" {
			writeError(w, http.StatusConflict, "not_applicable",
				"There is no logical dump for a key-value or document store — use its data browser")
			return
		}
		if record.FileBased {
			data, err := os.ReadFile(record.FilePath)
			if err != nil {
				writeError(w, http.StatusConflict, "not_ready", "The database file could not be read")
				return
			}
			_ = s.store.Audit(user.ID, "database.export", record.Name, clientIP(r), "sqlite")
			writeDatabaseDownload(w, record.Name+"."+strings.TrimPrefix(filepath.Ext(record.FilePath), "."), data)
			return
		}
		engine, found := s.engineFor(r.Context(), record.Engine)
		if !found || !engine.Available || !s.host.Materialises() {
			writeError(w, http.StatusConflict, "not_available",
				fmt.Sprintf("The %s client is not installed on this host, so it cannot be dumped", engine.Client))
			return
		}
		password := ""
		if record.PasswordCipher != "" {
			plain, err := secrets.Decrypt(s.key, record.PasswordCipher)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
				return
			}
			password = plain
		}
		argv, env := exportArgv(*record, password)
		if len(argv) == 0 {
			writeError(w, http.StatusConflict, "not_applicable", "No export for this engine")
			return
		}
		out, err := s.host.Runner.RunEnv(r.Context(), "", env, argv[0], argv[1:]...)
		if err != nil {
			message := strings.TrimSpace(out)
			if message == "" {
				message = err.Error()
			}
			writeError(w, http.StatusBadGateway, "service_error", "The dump failed: "+message)
			return
		}
		_ = s.store.Audit(user.ID, "database.export", record.Name, clientIP(r), record.Engine)
		writeDatabaseDownload(w, record.Name+".sql", []byte(out))
	}
}

// exportArgv is the engine's own dumper, run as the database's user. The password
// travels in the environment (PGPASSWORD / MYSQL_PWD), never in the argument list,
// and --no-defaults / an explicit host keep it from reading root's own config.
func exportArgv(record store.Database, password string) ([]string, []string) {
	switch record.Engine {
	case "postgresql":
		return []string{
				"pg_dump", "--no-owner", "--no-privileges", "--host", "127.0.0.1",
				"--port", fmt.Sprint(record.Port), "--username", record.User, "--dbname", record.Name,
			},
			[]string{"PGPASSWORD=" + password}
	case "mysql", "mariadb":
		return []string{
				"mysqldump", "--no-defaults", "--skip-comments", "--single-transaction",
				"--host", "127.0.0.1", "--port", fmt.Sprint(record.Port), "--user", record.User, record.Name,
			},
			[]string{"MYSQL_PWD=" + password}
	}
	return nil, nil
}

// writeDatabaseDownload hands the dump back as an attachment; the body is the
// dump itself, not JSON.
func writeDatabaseDownload(w http.ResponseWriter, filename string, data []byte) {
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}

// handleBinDatabase is the soft delete: nothing is dropped, the data is kept and
// the engine is told to stop serving it.
func (s *Server) handleBinDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if refuseDetected(w, record) {
			return
		}
		if err := s.suspendDatabase(r.Context(), record); err != nil {
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		if err := s.store.BinDatabase(record.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not bin the record")
			return
		}
		_ = s.store.Audit(user.ID, "database.bin", record.Name, clientIP(r), "")
		writeJSON(w, http.StatusOK, map[string]any{"id": record.ID, "deletedAt": "now", "status": "suspended"})
	}
}

// suspendDatabase stops the engine from serving the database, keeping the data.
func (s *Server) suspendDatabase(ctx context.Context, record *store.Database) error {
	engine, _ := s.engineFor(ctx, record.Engine)
	if engine.FileBased {
		// SQLite: move the file into the site's own trash, so a wrong bin click
		// never loses the data.
		return s.moveSQLiteFile(ctx, record, true)
	}
	if engine.Name == "mongodb" && engine.Mode == dbengine.ModeDocker && s.host.Materialises() {
		return s.suspendMongo(ctx, record, engine)
	}
	if !engine.Available || !s.host.Materialises() {
		record.Note = "Suspended in the panel; the engine was not told because its client is unavailable on this host."
		return nil
	}
	plan, err := dbengine.PlanFor(dbengine.StepSuspend, s.resourceFor(record, ""))
	if err != nil {
		return err
	}
	return s.runDatabasePlan(ctx, plan)
}

// handleRestoreDatabase takes a record out of the recycle bin.
func (s *Server) handleRestoreDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		// Restoring puts the record back in use, so the package limit applies here too.
		if !s.enforceDatabaseQuota(w, record.TenantUser) {
			return
		}
		engine, _ := s.engineFor(r.Context(), record.Engine)
		if engine.FileBased {
			if err := s.moveSQLiteFile(r.Context(), record, false); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
		} else if engine.Name == "mongodb" && engine.Mode == dbengine.ModeDocker && s.host.Materialises() {
			password, derr := secrets.Decrypt(s.key, record.PasswordCipher)
			if derr != nil {
				writeError(w, http.StatusInternalServerError, "internal", "Could not decrypt the credential")
				return
			}
			if err := s.restoreMongo(r.Context(), record, password, engine); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
		} else if engine.Available && s.host.Materialises() {
			plan, err := dbengine.PlanFor(dbengine.StepRestore, s.resourceFor(record, ""))
			if err != nil {
				writeError(w, http.StatusBadRequest, "validation_error", err.Error())
				return
			}
			if err := s.runDatabasePlan(r.Context(), plan); err != nil {
				writeError(w, http.StatusBadGateway, "service_error", err.Error())
				return
			}
		}
		if err := s.store.RestoreDatabase(record.ID); err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not restore the record")
			return
		}
		_ = s.store.Audit(user.ID, "database.restore", record.Name, clientIP(r), "")
		restored, _ := s.store.DatabaseByID(record.ID)
		writeJSON(w, http.StatusOK, map[string]any{"database": restored})
	}
}

// handlePurgeDatabase is the only destructive step, and it is explicit.
func (s *Server) handlePurgeDatabase(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		record, ok := s.findDatabase(w, r, user, kind)
		if !ok {
			return
		}
		if refuseDetected(w, record) {
			return
		}
		if err := s.purgeDatabase(r.Context(), record); err != nil {
			writeError(w, http.StatusBadGateway, "service_error", err.Error())
			return
		}
		_ = s.store.Audit(user.ID, "database.purge", record.Name, clientIP(r), record.Engine)
		writeJSON(w, http.StatusOK, map[string]any{"id": record.ID, "purged": true})
	}
}

func isIgnorablePurgeError(msg string) bool {
	low := strings.ToLower(msg)
	return strings.Contains(low, "could not find tuple for role") ||
		strings.Contains(low, "does not exist") ||
		strings.Contains(low, "doesn't exist") ||
		strings.Contains(low, "unknown database") ||
		strings.Contains(low, "operation drop user failed")
}

func (s *Server) purgeDatabase(ctx context.Context, record *store.Database) error {
	engine, _ := s.engineFor(ctx, record.Engine)
	if engine.FileBased {
		if err := s.purgeSQLite(ctx, record); err != nil {
			return err
		}
	} else if engine.Name == "mongodb" && engine.Mode == dbengine.ModeDocker && s.host.Materialises() {
		if err := s.purgeMongo(ctx, record, engine); err != nil {
			return err
		}
	} else if engine.Available && s.host.Materialises() {
		plan, err := dbengine.PlanFor(dbengine.StepPurge, s.resourceFor(record, ""))
		if err != nil {
			return err
		}
		if err := s.runDatabasePlan(ctx, plan); err != nil {
			if !isIgnorablePurgeError(err.Error()) {
				return err
			}
		}
	}
	return s.store.DeleteDatabase(record.ID)
}

// handleEmptyRecycleBin purges everything that was binned.
func (s *Server) handleEmptyRecycleBin(kind string) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
		items, err := s.store.DatabasesForTenant(kind, databaseScope(user), true)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "internal", "Could not read the recycle bin")
			return
		}
		purged := []string{}
		var lastErr error
		for i := range items {
			if err := s.purgeDatabase(r.Context(), &items[i]); err != nil {
				lastErr = err
				continue
			}
			purged = append(purged, items[i].Name)
		}
		if len(purged) == 0 && lastErr != nil && len(items) > 0 {
			writeError(w, http.StatusBadGateway, "service_error", lastErr.Error())
			return
		}
		_ = s.store.Audit(user.ID, "database.recycle_bin_empty", kind, clientIP(r), strings.Join(purged, ", "))
		writeJSON(w, http.StatusOK, map[string]any{"purged": purged})
	}
}

// databaseFilePath is where a file-based database lives when it is in use.
func (s *Server) databaseFilePath(record *store.Database, siteRoot string) string {
	return path.Join(siteRoot, path.Base(record.Name)+".sqlite")
}

// trashPath is where a binned file-based database waits.
func (s *Server) trashPath(siteRoot string, record *store.Database) string {
	return path.Join(siteRoot, ".trash", path.Base(record.Name)+".sqlite")
}

// moveSQLiteFile moves a file-based database into (or out of) the site's trash.
//
// Both locations are derived from the record's name, so a bin followed by a
// restore cannot end up comparing a path with itself.
func (s *Server) moveSQLiteFile(ctx context.Context, record *store.Database, intoTrash bool) error {
	site, err := s.store.WebsiteBySlug(record.WebsiteSlug)
	if err != nil {
		return errors.New("the website could not be loaded")
	}
	manager := s.fileManagerForSite(site)
	if manager == nil {
		return errors.New("the website directory could not be opened")
	}
	root := s.host.SitePath(site.TenantUser, site.Slug)
	live := s.databaseFilePath(record, root)
	trashed := s.trashPath(root, record)

	from, to := live, trashed
	if !intoTrash {
		from, to = trashed, live
	}
	fromRel := strings.TrimPrefix(strings.TrimPrefix(from, root), "/")
	toRel := strings.TrimPrefix(strings.TrimPrefix(to, root), "/")
	if fromRel == "" || toRel == "" {
		return errors.New("the database file path is not inside the website")
	}

	if exists, err := manager.Exists(fromRel); err != nil || !exists {
		return fmt.Errorf("the database file is not where it should be (%s)", fromRel)
	}
	if intoTrash {
		if err := manager.Mkdir(path.Dir(toRel)); err != nil {
			return err
		}
	}
	if err := manager.Move(fromRel, toRel); err != nil {
		return err
	}
	return s.host.ChownSite(ctx, site.TenantUser, site.Slug)
}

// purgeSQLite removes the file wherever it currently is.
func (s *Server) purgeSQLite(ctx context.Context, record *store.Database) error {
	site, err := s.store.WebsiteBySlug(record.WebsiteSlug)
	if err != nil {
		return nil // the website is gone; the record can go too
	}
	manager := s.fileManagerForSite(site)
	if manager == nil {
		return nil
	}
	root := s.host.SitePath(site.TenantUser, site.Slug)
	for _, candidate := range []string{s.databaseFilePath(record, root), s.trashPath(root, record)} {
		relative := strings.TrimPrefix(strings.TrimPrefix(candidate, root), "/")
		if relative == "" {
			continue
		}
		exists, err := manager.Exists(relative)
		if err != nil || !exists {
			continue
		}
		if err := manager.Delete(relative); err != nil {
			return err
		}
	}
	return nil
}
