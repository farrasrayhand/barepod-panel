package api

import (
	"log"
	"net/http"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

const sessionCookie = "barepod_session"

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
