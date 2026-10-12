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
		// Same response for unknown user and wrong password — and the refusal is recorded, with the
		// address it came from. Measured: a failed panel login left no trace at all, so nothing could
		// count them and a brute-force attempt against the panel was invisible in its own audit trail.
		_ = s.store.Audit("", "auth.login_refused", req.Username, clientIP(r), "unknown account")
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid username or password")
		return
	}
	ok, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !ok {
		_ = s.store.Audit("", "auth.login_refused", user.Username, clientIP(r), "wrong password")
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
	setSessionCookie(w, sess.ID, 0, requestScheme(r) == "https")
	_ = s.store.Audit(user.ID, "auth.login", user.Username, clientIP(r), "")
	// Where an operator signs in from is a place the lockout must never ban: banning it would take
	// away the way back in — measured, an operator's own brute-force test banned their address and
	// with it went SSH. Remembered automatically, because nobody will think to whitelist themselves
	// before the lockout they are trying to test.
	if address := stripPort(clientIP(r)); address != "" {
		_ = s.store.AddTrustedAddress(address)
	}
	writeJSON(w, http.StatusOK, sessionResponse{User: user, CSRFToken: sess.CSRFToken})
}

// handleChangePassword sets a new panel password, after checking the current one. The
// Profile screen used to report success without calling anything at all; this is what it
// calls. Every other session is signed out, because they were opened with the old
// password.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request, user *store.User, _ *store.Session) {
	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Invalid JSON body")
		return
	}
	if len(req.NewPassword) < 12 {
		writeError(w, http.StatusBadRequest, "validation_error", "A panel password must be at least 12 characters")
		return
	}
	ok, err := auth.VerifyPassword(req.CurrentPassword, user.PasswordHash)
	if err != nil || !ok {
		_ = s.store.Audit(user.ID, "auth.password_change_refused", user.Username, clientIP(r), "")
		writeError(w, http.StatusForbidden, "invalid_credentials", "The current password is not right")
		return
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not hash the new password")
		return
	}
	// The store's own rule: a password change invalidates every session for that account,
	// this one included. That is the panel's established behaviour (the CLI does it too),
	// so the answer says it rather than pretending the caller stays signed in.
	if _, err := s.store.SetUserPassword(user.Username, hash); err != nil {
		writeError(w, http.StatusInternalServerError, "internal", "Could not save the new password")
		return
	}
	_ = s.store.Audit(user.ID, "auth.password_change", user.Username, clientIP(r), "every session signed out")
	writeJSON(w, http.StatusOK, map[string]any{"status": "changed", "signedOutEverywhere": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
	_ = s.store.DeleteSession(sess.ID)
	setSessionCookie(w, "", -1, requestScheme(r) == "https")
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
