package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/auth"
	"github.com/farrasrayhand/barepod-panel/backend/internal/id"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

const elevatedWindow = 5 * time.Minute

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type sessionResponse struct {
	User      *store.User `json:"user"`
	CSRFToken string      `json:"csrfToken"`
}

// setSessionCookie writes the session cookie. secure follows the request: over
// HTTPS the browser refuses to send it in the clear, which is what the TLS mode of
// the panel exists for.
func setSessionCookie(w http.ResponseWriter, id string, maxAge int, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    id,
		Secure:   secure,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if req.Username == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Username and password are required")
		return
	}

	user, err := s.store.UserByUsername(req.Username)
	if err != nil {
		// Same response for unknown user and wrong password.
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid username or password")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid username or password")
		return
	}
	if user.Status != "active" {
		writeError(w, http.StatusForbidden, "suspended", "This account is suspended")
		return
	}

	sess, err := s.store.CreateSession(user.ID, r.UserAgent(), clientIP(r), id.Token(24))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not create session")
		return
	}
	setSessionCookie(w, sess.ID, 0, r.TLS != nil)
	_ = s.store.Audit(user.ID, "auth.login", user.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, sessionResponse{User: user, CSRFToken: sess.CSRFToken})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	_ = s.store.DeleteSession(sess.ID)
	setSessionCookie(w, "", -1, r.TLS != nil)
	_ = s.store.Audit(user.ID, "auth.logout", user.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "signed_out"})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	elevated := sessionElevated(sess)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":        user,
		"csrfToken":   sess.CSRFToken,
		"elevated":    elevated,
		"permissions": s.effectivePermissions(user),
	})
}

// handleVerify implements the elevated (sudo) mode used before revealing or
// rotating credentials. It lives for 5 minutes in the session.
func (s *Server) handleVerify(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !ok {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Incorrect panel password")
		return
	}
	until := time.Now().Add(elevatedWindow)
	if err := s.store.SetElevated(sess.ID, until); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not enable elevated mode")
		return
	}
	_ = s.store.Audit(user.ID, "auth.elevate", user.Username, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]any{
		"elevated":      true,
		"elevatedUntil": until.UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	sessions, err := s.store.ListSessions(user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not list sessions")
		return
	}
	// Never leak CSRF tokens through this endpoint.
	writeJSON(w, http.StatusOK, map[string]any{"items": sessions, "currentId": sess.ID})
}

// handleListAudit returns the caller's own recent activity, or every account's
// for an admin (the same single exception as everywhere else in the panel).
func (s *Server) handleListAudit(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))

	scope := user.ID
	everything := false
	if user.Role == "admin" {
		scope = ""
		everything = true
	}

	entries, err := s.store.ListAudit(scope, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not read the activity log")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": entries, "everything": everything})
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	target := r.PathValue("id")
	if target == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Session id is required")
		return
	}
	if err := s.store.DeleteSession(target); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not revoke session")
		return
	}
	_ = s.store.Audit(user.ID, "auth.session_revoke", target, clientIP(r), "")
	writeJSON(w, http.StatusOK, map[string]string{"status": "revoked"})
}
