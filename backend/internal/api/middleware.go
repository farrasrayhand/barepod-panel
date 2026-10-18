package api

import (
	"bufio"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
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

// sessionLifetime is how long a browser session may live, counted from its creation. An unset or
// invalid value means the 24-hour default.
func (s *Server) sessionLifetime() time.Duration {
	raw, err := s.store.PanelSetting(sessionTimeoutHoursKey)
	if err != nil {
		return 24 * time.Hour
	}
	return time.Duration(parseSessionHours(raw)) * time.Hour
}

// sessionExpired reports whether a session has outlived the configured lifetime.
func (s *Server) sessionExpired(sess *store.Session) bool {
	created, err := time.Parse(time.RFC3339, sess.CreatedAt)
	if err != nil {
		return false
	}
	return time.Since(created) > s.sessionLifetime()
}

// requestIP is the address the panel decides access with: the direct peer, except when that peer is
// loopback — which is where a local reverse proxy (cloudflared, a local nginx) connects — in which
// case the first X-Forwarded-For hop is used. A non-local peer's X-Forwarded-For is ignored on
// purpose: it is client-controlled and would otherwise let anyone claim an allowed address.
func requestIP(r *http.Request) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	remote = strings.Trim(remote, "[]")
	if ip := net.ParseIP(remote); ip != nil && ip.IsLoopback() {
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
			if host, _, err := net.SplitHostPort(first); err == nil {
				first = host
			}
			if parsed := net.ParseIP(strings.Trim(first, "[]")); parsed != nil {
				return parsed.String()
			}
		}
	}
	return remote
}

// panelAccessGuard keeps the panel to the addresses an operator listed, one address or network per
// line. An empty list allows every address. Loopback is always allowed, so a bad list cannot take
// away the way back in over an SSH tunnel, and the health endpoint stays reachable because it is what
// monitoring and the updater read.
func (s *Server) panelAccessGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/health" {
			next.ServeHTTP(w, r)
			return
		}
		raw, err := s.store.PanelSetting(panelIPAllowlistKey)
		if err != nil || strings.TrimSpace(raw) == "" {
			next.ServeHTTP(w, r)
			return
		}
		remote := requestIP(r)
		ip := net.ParseIP(remote)
		if ip != nil && ip.IsLoopback() {
			next.ServeHTTP(w, r)
			return
		}
		for _, entry := range strings.Split(raw, "\n") {
			entry = strings.TrimSpace(entry)
			if entry == "" {
				continue
			}
			if ip != nil && ip.Equal(net.ParseIP(entry)) {
				next.ServeHTTP(w, r)
				return
			}
			if _, network, err := net.ParseCIDR(entry); err == nil && ip != nil && network.Contains(ip) {
				next.ServeHTTP(w, r)
				return
			}
		}
		writeError(w, http.StatusForbidden, "ip_not_allowed",
			"this panel does not accept connections from "+remote)
	})
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

// Hijack forwards to the underlying writer so a protocol upgrade (WebSocket)
// still works: a plain wrapper would hide http.Hijacker and the upgrade would
// fail with a 500 — the same trap as hiding http.Flusher for SSE.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("api: the underlying ResponseWriter cannot be hijacked")
	}
	return hijacker.Hijack()
}

func clientIP(r *http.Request) string {
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return fwd
	}
	return r.RemoteAddr
}

// wantsHTML reports whether this request is a browser asking for a page rather than a
// client asking for data: a navigation sends Accept: text/html, fetch/XHR does not.
func wantsHTML(r *http.Request) bool {
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// requestScheme is the scheme the visitor is really on, which is not necessarily the
// scheme of the last hop: behind a tunnel or reverse proxy (Cloudflare Tunnel, nginx)
// the daemon is reached over plain HTTP while the visitor is on HTTPS, and
// X-Forwarded-Proto is the only honest answer. A manager's absolute URLs (phpMyAdmin's
// PmaAbsoluteUri) and the session cookie's Secure flag have to follow the visitor, not
// the hop.
func requestScheme(r *http.Request) string {
	proto := r.Header.Get("X-Forwarded-Proto")
	if idx := strings.Index(proto, ","); idx >= 0 {
		proto = proto[:idx]
	}
	if proto = strings.TrimSpace(proto); proto != "" {
		return proto
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

// requireAuth validates the session cookie and enforces CSRF on state-changing requests.
func (s *Server) requireAuth(next authedHandler) http.HandlerFunc {
	return s.requireSession(true, next)
}

// requireSession validates the session cookie (the caller adds the capability
// check). csrf=false is used only for the proxied database-manager subtree, whose
// own client cannot carry our X-CSRF-Token header: there the panel issues a
// path-scoped, SameSite=Strict cookie instead (see handleDatabaseGuiProxy), so a
// cross-site request still cannot run a statement.
func (s *Server) requireSession(csrf bool, next authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || cookie.Value == "" {
			// A browser that lands here — an incognito tab opened straight on a manager's
			// path, say — is sent to the sign-in screen the contract promises it, instead of
			// being shown raw JSON. The frontend remembers the path it was asked for, so
			// signing in returns there.
			if wantsHTML(r) {
				http.Redirect(w, r, "/login", http.StatusFound)
				return
			}
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required")
			return
		}
		sess, err := s.store.SessionByID(cookie.Value)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Session is invalid or expired")
			return
		}
		if s.sessionExpired(sess) {
			// Deleted on the way out: an expired row has no further use, and leaving it would keep
			// reporting a session the operator can no longer use.
			_ = s.store.DeleteSession(sess.ID)
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Session expired — sign in again")
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
			if csrf && r.Header.Get("X-CSRF-Token") != sess.CSRFToken {
				writeError(w, http.StatusForbidden, "csrf", "Missing or invalid CSRF token")
				return
			}
		}

		_ = s.store.TouchSession(sess.ID)
		next(w, r, user, sess)
	}
}
