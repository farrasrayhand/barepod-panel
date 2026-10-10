// Package api wires the HTTP router, middleware and handlers of the daemon.
package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
)

// Version is the panel/daemon version (prototype line, see MASTER_PLAN §0).
const Version = "0.1.0-prototype"

// Deps are the dependencies the HTTP layer needs.
type Deps struct {
	Config         config.Config
	Store          *store.Store
	Key            []byte
	Host           *host.Host
	Deploy         *deploy.Manager
	Tenants        *tenant.Manager
	MaxUploadBytes int64
}

// Server holds the handler dependencies.
type Server struct {
	cfg            config.Config
	store          *store.Store
	key            []byte
	host           *host.Host
	deploy         *deploy.Manager
	tenants        *tenant.Manager
	tickets        *ticketStore
	maxUploadBytes int64
}

// New builds the daemon HTTP handler.
func New(d Deps) http.Handler {
	maxUpload := d.MaxUploadBytes
	if maxUpload <= 0 {
		maxUpload = 64 << 20 // 64 MiB default
	}
	s := &Server{
		cfg:            d.Config,
		store:          d.Store,
		key:            d.Key,
		host:           d.Host,
		deploy:         d.Deploy,
		tenants:        d.Tenants,
		tickets:        newTicketStore(),
		maxUploadBytes: maxUpload,
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

	// Permission groups / tenant packages (the only built-in data) — "users" capability
	mux.HandleFunc("GET /api/v1/groups", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleListGroups)))
	mux.HandleFunc("PATCH /api/v1/groups/{name}", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleUpdateGroup)))
	mux.HandleFunc("GET /api/v1/system/capacity", s.requireAuth(s.requireCapability(rbac.CapUsers, s.handleCapacity)))

	// System — "monitoring" capability
	mux.HandleFunc("GET /api/v1/system/capabilities", s.requireAuth(s.requireCapability(rbac.CapMonitoring, s.handleCapabilities)))
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
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy", deploy(s.handleLatestDeploy))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/stream", deploy(s.handleDeployStream))
	mux.HandleFunc("GET /api/v1/websites/{slug}/deploy/{id}", deploy(s.handleDeployJob))
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
	index := filepath.Join(s.cfg.StaticDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		writeError(w, http.StatusNotFound, "not_found", "API route not found (frontend build not present)")
		return
	}
	clean := filepath.Clean(r.URL.Path)
	candidate := filepath.Join(s.cfg.StaticDir, filepath.FromSlash(clean))
	if clean != "/" {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			http.ServeFile(w, r, candidate)
			return
		}
	}
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
