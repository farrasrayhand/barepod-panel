// Package api wires the HTTP router, middleware and handlers of the daemon.
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
)

// Version is the panel/daemon version (prototype line, see MASTER_PLAN §0).
const Version = "0.3.0-prototype"

// Deps are the dependencies the HTTP layer needs.
type Deps struct {
	Config         config.Config
	Store          *store.Store
	Key            []byte
	Host           *host.Host
	Deploy         *deploy.Manager
	Tenants        *tenant.Manager
	Metrics        *metrics.Sampler
	SiteMetrics    *metrics.SiteSampler
	MaxUploadBytes int64
	// Tools is the supervisor for the on-demand database managers. Nil means no
	// manager can be hosted (the gate still reports honestly).
	Tools *dbtools.Supervisor
	// LookPath finds a tool's binary; nil means exec.LookPath (tests inject one so
	// availability does not depend on the machine).
	LookPath func(string) (string, error)
}

// Server holds the handler dependencies.
type Server struct {
	cfg            config.Config
	store          *store.Store
	key            []byte
	host           *host.Host
	deploy         *deploy.Manager
	tenants        *tenant.Manager
	metrics        *metrics.Sampler
	siteMetrics    *metrics.SiteSampler
	tickets        *ticketStore
	maxUploadBytes int64
	// engines is the single-flight orchestrator for containerised engines.
	engines engineOrchestrator
	// tools runs the on-demand database managers, and lookPath decides whether one
	// is offered at all.
	tools    *dbtools.Supervisor
	lookPath func(string) (string, error)
	// guiMu serialises switching a manager between databases; guiServed records
	// which database each running manager is scoped to.
	guiMu     sync.Mutex
	guiServed map[string]string
}

// New builds the daemon HTTP handler.
func New(d Deps) http.Handler {
	maxUpload := d.MaxUploadBytes
	if maxUpload <= 0 {
		maxUpload = 64 << 20 // 64 MiB default
	}
	lookPath := d.LookPath
	if lookPath == nil {
		lookPath = exec.LookPath
	}
	s := &Server{
		cfg:            d.Config,
		store:          d.Store,
		key:            d.Key,
		host:           d.Host,
		deploy:         d.Deploy,
		tenants:        d.Tenants,
		metrics:        d.Metrics,
		siteMetrics:    d.SiteMetrics,
		tickets:        newTicketStore(),
		maxUploadBytes: maxUpload,
		tools:          d.Tools,
		lookPath:       lookPath,
	}

	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)

	// Session & account
	mux.HandleFunc("POST /api/v1/auth/logout", s.requireAuth(s.handleLogout))
	mux.HandleFunc("GET /api/v1/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/v1/auth/verify", s.requireAuth(s.handleVerify))
	mux.HandleFunc("GET /api/v1/sessions", s.requireAuth(s.handleListSessions))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.requireAuth(s.handleRevokeSession))
	mux.HandleFunc("GET /api/v1/audit", s.requireAuth(s.handleListAudit))

	// Permission groups / tenant packages (the only built-in data) — "users" capability
	mux.HandleFunc("GET /api/v1/groups", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleListGroups)))
	mux.HandleFunc("PATCH /api/v1/groups/{name}", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleUpdateGroup)))
	mux.HandleFunc("GET /api/v1/system/capacity", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleCapacity)))

	// System — "monitoring" capability
	mux.HandleFunc("GET /api/v1/system/capabilities", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleCapabilities)))
	mux.HandleFunc("GET /api/v1/system/metrics", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleSystemMetrics)))
	mux.HandleFunc("POST /api/v1/ws/ticket", s.requireAuth(s.handleWSTicket))

	// Interactive terminals. Auth uses the one-time ticket (never a long-lived
	// token in the URL); the handlers re-check capability and ownership.
	mux.HandleFunc("GET /api/v1/websites/{slug}/pty", s.handleWebsitePTY)
	mux.HandleFunc("GET /api/v1/system/pty", s.handleHostPTY)

	// Websites — "deployApps" capability, scoped to the caller's own websites
	// (admins see every tenant).
	deploy := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapDeployApps, h))
	}
	mux.HandleFunc("GET /api/v1/websites", deploy(s.handleListWebsites))
	mux.HandleFunc("POST /api/v1/websites", deploy(s.handleCreateWebsite))
	mux.HandleFunc("POST /api/v1/websites/prepare-directory", deploy(s.handlePrepareDirectory))
	mux.HandleFunc("GET /api/v1/websites/{slug}", deploy(s.handleGetWebsite))
	mux.HandleFunc("DELETE /api/v1/websites/{slug}", deploy(s.handleDeleteWebsite))
	mux.HandleFunc("POST /api/v1/websites/{slug}/redeploy", deploy(s.handleRedeployWebsite))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy", deploy(s.handleLatestDeploy))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/stream", deploy(s.handleDeployStream))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/{id}", deploy(s.handleDeployJob))
	mux.HandleFunc("GET /api/v1/websites/{slug}/metrics", deploy(s.handleWebsiteMetrics))
	mux.HandleFunc("GET /api/v1/websites/{slug}/secrets", deploy(s.handleListSecrets))
	mux.HandleFunc("POST /api/v1/websites/{slug}/secrets/{name}/reveal", deploy(s.handleRevealSecret))

	for _, action := range []string{"start", "stop", "restart"} {
		mux.HandleFunc("POST /api/v1/websites/{slug}/"+action, deploy(
			func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
				s.handleWebsiteAction(w, r, user, sess, action)
			}))
	}

	// File manager — "fileManager" capability, scoped to the caller's own site.
	files := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapFileManager, h))
	}
	mux.HandleFunc("GET /api/v1/websites/{slug}/files", files(s.handleListFiles))
	mux.HandleFunc("GET /api/v1/websites/{slug}/files/content", files(s.handleReadFile))
	mux.HandleFunc("PUT /api/v1/websites/{slug}/files/content", files(s.handleWriteFile))
	mux.HandleFunc("GET /api/v1/websites/{slug}/files/download", files(s.handleDownloadFile))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/upload", files(s.handleUploadFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/create", files(s.handleCreateFile))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/mkdir", files(s.handleMkdir))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/rename", files(s.handleRenameFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/copy", files(s.handleCopyFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/move", files(s.handleMoveFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/delete", files(s.handleDeleteFiles))
	mux.HandleFunc("POST /api/v1/websites/{slug}/files/compress", files(s.handleCompressFiles))

	// Host-wide browser. An admin may look anywhere; the daemon enforces that the
	// system trees (/etc, /usr, /boot, /var/lib, /proc, /sys, …) are read-only, so
	// a panel can never brick its own machine by mistake.
	mux.HandleFunc("GET /api/v1/files", files(s.handleScopedList))
	mux.HandleFunc("GET /api/v1/files/content", files(s.handleScopedRead))
	mux.HandleFunc("PUT /api/v1/files/content", files(s.handleScopedWrite))
	mux.HandleFunc("GET /api/v1/files/download", files(s.handleScopedDownload))
	mux.HandleFunc("POST /api/v1/files/upload", files(s.handleScopedUpload))
	mux.HandleFunc("POST /api/v1/files/create", files(s.handleScopedCreate))
	mux.HandleFunc("POST /api/v1/files/mkdir", files(s.handleScopedMkdir))
	mux.HandleFunc("POST /api/v1/files/rename", files(s.handleScopedRename))
	mux.HandleFunc("POST /api/v1/files/copy", files(func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		s.handleScopedTransfer(w, r, user, "copy")
	}))
	mux.HandleFunc("POST /api/v1/files/move", files(func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		s.handleScopedTransfer(w, r, user, "move")
	}))
	mux.HandleFunc("POST /api/v1/files/delete", files(s.handleScopedDelete))
	mux.HandleFunc("POST /api/v1/files/compress", files(s.handleScopedCompress))
	// The picker behind the host-wide browser: which accounts have a home.
	mux.HandleFunc("GET /api/v1/tenants", files(s.handleListTenants))

	// Databases and caches: one ledger, two families (a cache is a database with
	// different commands). "databases" capability; reveals need elevated mode.
	databases := func(h authedHandler) http.HandlerFunc {
		return s.requireAuth(s.requireCapability(rbac.CapDatabases, h))
	}
	mux.HandleFunc("GET /api/v1/db-engines", databases(s.handleDbEngines))

	mux.HandleFunc("GET /api/v1/databases", databases(s.handleListDatabases(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases", databases(s.handleCreateDatabase(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/recycle-bin", databases(s.handleListRecycleBin(store.KindDatabase)))
	mux.HandleFunc("DELETE /api/v1/databases/recycle-bin", databases(s.handleEmptyRecycleBin(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}", databases(s.handleGetDatabase(store.KindDatabase)))
	mux.HandleFunc("PATCH /api/v1/databases/{id}", databases(s.handlePatchDatabase(store.KindDatabase)))
	mux.HandleFunc("DELETE /api/v1/databases/{id}", databases(s.handleBinDatabase(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/rotate-password", databases(s.handleRotateDatabasePassword(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/reveal", databases(s.handleRevealDatabase(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/connection-string", databases(s.handleConnectionString(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/restore", databases(s.handleRestoreDatabase(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/purge", databases(s.handlePurgeDatabase(store.KindDatabase)))
	// Data browsing, served by the daemon itself: no extra port, no GUI process —
	// the panel's own session, capability and audit apply.
	mux.HandleFunc("GET /api/v1/databases/{id}/tables", databases(s.handleListTables(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/query", databases(s.handleDatabaseQuery(store.KindDatabase)))
	// Managers live behind the panel's own session: no port, no direct link.
	mux.HandleFunc("GET /api/v1/databases/{id}/gui", databases(s.handleDatabaseGui(store.KindDatabase)))
	mux.HandleFunc("GET /api/v1/databases/{id}/gui/{tool}", databases(s.handleDatabaseGui(store.KindDatabase)))
	// The manager's own pages and assets run under the same session. Its client
	// cannot carry our CSRF header, so this subtree validates the session without
	// it and the handler issues a path-scoped SameSite=Strict cookie instead.
	proxy := func(h authedHandler) http.HandlerFunc {
		return s.requireSession(false, s.requireCapability(rbac.CapDatabases, h))
	}
	mux.HandleFunc("GET /api/v1/databases/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindDatabase)))
	mux.HandleFunc("POST /api/v1/databases/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindDatabase)))

	mux.HandleFunc("GET /api/v1/caches", databases(s.handleListDatabases(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches", databases(s.handleCreateDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/recycle-bin", databases(s.handleListRecycleBin(store.KindCache)))
	mux.HandleFunc("DELETE /api/v1/caches/recycle-bin", databases(s.handleEmptyRecycleBin(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}", databases(s.handleGetDatabase(store.KindCache)))
	mux.HandleFunc("PATCH /api/v1/caches/{id}", databases(s.handlePatchDatabase(store.KindCache)))
	mux.HandleFunc("DELETE /api/v1/caches/{id}", databases(s.handleBinDatabase(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/rotate-password", databases(s.handleRotateDatabasePassword(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/reveal", databases(s.handleRevealDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/connection-string", databases(s.handleConnectionString(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/restore", databases(s.handleRestoreDatabase(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/purge", databases(s.handlePurgeDatabase(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/tables", databases(s.handleListTables(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/query", databases(s.handleDatabaseQuery(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui", databases(s.handleDatabaseGui(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui/{tool}", databases(s.handleDatabaseGui(store.KindCache)))
	mux.HandleFunc("GET /api/v1/caches/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindCache)))
	mux.HandleFunc("POST /api/v1/caches/{id}/gui/{tool}/{path...}", proxy(s.handleDatabaseGuiProxy(store.KindCache)))
	// The cache browser is ours: keys are read with the pure-Go client, so no
	// redis-cli (and no redis-commander) has to exist anywhere.
	mux.HandleFunc("GET /api/v1/caches/{id}/key", databases(s.handleRedisKey(store.KindCache)))

	// Everything else: SPA (path-based routes need index.html fallback).
	mux.HandleFunc("/", s.handleSPA)

	return withLogging(mux)
}

// ---- helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v != nil {
		if err := json.NewEncoder(w).Encode(v); err != nil {
			log.Printf("api: encode response: %v", err)
		}
	}
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]apiError{"error": {Code: code, Message: message}})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	return dec.Decode(dst)
}

// handleSPA serves the built frontend, falling back to index.html so that
// deep links such as /websites/<name>/logs keep working on refresh.
func (s *Server) handleSPA(w http.ResponseWriter, r *http.Request) {
	// An unknown API route must not fall through to the SPA: a client asking for
	// JSON has to get a JSON 404, not a page.
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeError(w, http.StatusNotFound, "not_found", "API route not found")
		return
	}

	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "API route not found (frontend build not present)")
		return
	}
	clean := filepath.Clean(r.URL.Path)
	candidate := filepath.Join(s.cfg.StaticDir, filepath.FromSlash(clean))
	if clean != "/" {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			// A build fingerprints everything it emits under /assets, so those
			// files can be cached hard: a new build never reuses a name.
			if strings.HasPrefix(clean, string(filepath.Separator)+"assets"+string(filepath.Separator)) {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeFile(w, r, candidate)
			return
		}
	}
	// index.html must always be revalidated: it names the hashed bundle, and a
	// cached copy pins the browser to an old build, which makes a deploy look as
	// though it changed nothing.
	w.Header().Set("Cache-Control", "no-cache, must-revalidate")
	http.ServeFile(w, r, index)
}

// ---- health ----

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": Version,
		"mode":    s.host.Mode(),
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
