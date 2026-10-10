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
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// Version is the panel/daemon version (prototype line, see MASTER_PLAN §0).
const Version = "0.1.0-prototype"

// Server holds the handler dependencies.
type Server struct {
	cfg     config.Config
	store   *store.Store
	key     []byte
	tickets *ticketStore
}

// New builds the daemon HTTP handler.
func New(cfg config.Config, st *store.Store, key []byte) http.Handler {
	s := &Server{cfg: cfg, store: st, key: key, tickets: newTicketStore()}

	mux := http.NewServeMux()

	// Public
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)

	// Authenticated
	mux.HandleFunc("POST /api/v1/auth/logout", s.requireAuth(s.handleLogout))
	mux.HandleFunc("GET /api/v1/auth/me", s.requireAuth(s.handleMe))
	mux.HandleFunc("POST /api/v1/auth/verify", s.requireAuth(s.handleVerify))
	mux.HandleFunc("GET /api/v1/system/capabilities", s.requireAuth(s.handleCapabilities))

	mux.HandleFunc("GET /api/v1/sessions", s.requireAuth(s.handleListSessions))
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.requireAuth(s.handleRevokeSession))

	mux.HandleFunc("GET /api/v1/websites", s.requireAuth(s.handleListWebsites))
	mux.HandleFunc("GET /api/v1/websites/{slug}", s.requireAuth(s.handleGetWebsite))

	mux.HandleFunc("POST /api/v1/ws/ticket", s.requireAuth(s.handleWSTicket))

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

// Key returns the loaded secrets key (parity helper for future modules).
func (s *Server) Key() []byte { return s.key }

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
		"time":    time.Now().UTC().Format(time.RFC3339),
	})
}
