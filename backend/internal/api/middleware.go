package api

import (
	"log"
	"net/http"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

const sessionCookie = "barepod_session"

// sessionElevated reports whether the session holds a valid elevated (sudo) grant.
func sessionElevated(sess *store.Session) bool {
	if sess == nil || sess.ElevatedUntil == "" {
		return false
	}
	until, err := time.Parse(time.RFC3339, sess.ElevatedUntil)
	return err == nil && until.After(time.Now())
}

// requireCapability wraps a handler so the caller's group must grant capability.
// Permissions are per account (via its group), never global.
func (s *Server) requireCapability(capability string, next authedHandler) authedHandler {
	return func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session) {
		if !s.effectivePermissions(user)[capability] {
			writeError(w, http.StatusForbidden, "capability_required",
				"Your account does not have the \""+capability+"\" permission")
			return
		}
		next(w, r, user, sess)
	}
}

// canManageSite reports whether the caller owns the website (or is an admin).
// Tenant isolation is enforced on every website endpoint, not only in the UI.
func canManageSite(user *store.User, site *store.Website) bool {
	return user.Role == "admin" || site.TenantUser == user.Username
}

// authedHandler is a handler that requires a session.
type authedHandler func(w http.ResponseWriter, r *http.Request, user *store.User, sess *store.Session)

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s -> %d (%s) from %s", r.Method, r.URL.Path, rec.status, time.Since(start).Round(time.Millisecond), clientIP(r))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

// Flush forwards to the underlying writer so SSE streams are not broken by the
// logging wrapper (a plain wrapper would hide http.Flusher).
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Unwrap lets http.ResponseController reach the real writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	return r.RemoteAddr
}

// requireAuth validates the session cookie and enforces CSRF on state-changing requests.
func (s *Server) requireAuth(next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required")
			return
		}
		sess, err := s.store.SessionByID(cookie.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Session is invalid or expired")
			return
		}
		user, err := s.store.UserByID(sess.UserID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Account no longer exists")
			return
		}
		if user.Status != "active" {
			writeError(w, http.StatusForbidden, "suspended", "This account is suspended")
			return
		}

		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			// safe methods need no CSRF token
		default:
			if r.Header.Get("X-CSRF-Token") != sess.CSRFToken {
				writeError(w, http.StatusForbidden, "csrf", "Missing or invalid CSRF token")
				return
			}
		}

		_ = s.store.TouchSession(sess.ID)
		next(w, r, user, sess)
	}
}
