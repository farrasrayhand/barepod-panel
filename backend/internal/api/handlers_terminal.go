package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/farrasrayhand/barepod-panel/backend/internal/rbac"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/terminal"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

const (
	// ptyIdleTimeout closes a shell nobody is using (a browser tab can be left
	// open for days; an idle root shell must not stay alive that long).
	ptyIdleTimeout = 30 * time.Minute
	ptyWriteWait   = 15 * time.Second
	ptyReadLimit   = 1 << 20 // 1 MiB per frame
)

// controlMessage is the JSON a client sends on a text frame.
type controlMessage struct {
	Type string `json:"type"` // resize | ping
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// ptyTarget describes the shell to start.
type ptyTarget struct {
	Title    string
	Dir      string
	UID, GID int
	Host     bool
	// Tenant and Slug identify the site whose shell this is, so the session can
	// be confined to that one directory (a host shell is never confined).
	Tenant string
	Slug   string
}

// upgrader allows the same host or a loopback origin (the Vite dev server runs
// on a different port), and rejects everything else.
func (s *Server) upgrader() websocket.Upgrader {
	return websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // non-browser client (CLI, tests)
			}
			parsed, err := url.Parse(origin)
			if err != nil {
				return false
			}
			if parsed.Host == r.Host {
				return true
			}
			switch parsed.Hostname() {
			case "127.0.0.1", "localhost", "::1":
				return true
			}
			return false
		},
	}
}

// authenticateTicket redeems the one-time WebSocket ticket. Tickets are short
// lived and single use, which is why the session token never appears in a URL.
func (s *Server) authenticateTicket(w http.ResponseWriter, r *http.Request) (*store.User, *store.Session, bool) {
	token := r.URL.Query().Get("ticket")
	if token == "" {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "A WebSocket ticket is required (POST /ws/ticket)")
		return nil, nil, false
	}
	sessionID, ok := s.tickets.redeem(token)
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "The ticket is invalid, expired or already used")
		return nil, nil, false
	}
	sess, err := s.store.SessionByID(sessionID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "The session behind this ticket has ended")
		return nil, nil, false
	}
	user, err := s.store.UserByID(sess.UserID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthenticated", "The account no longer exists")
		return nil, nil, false
	}
	if user.Status != "active" {
		writeError(w, http.StatusForbidden, "suspended", "This account is suspended")
		return nil, nil, false
	}
	return user, sess, true
}

// handleWebsitePTY opens a shell inside a website, running as the tenant.
func (s *Server) handleWebsitePTY(w http.ResponseWriter, r *http.Request) {
	user, _, ok := s.authenticateTicket(w, r)
	if !ok {
		return
	}
	if !s.effectivePermissions(user)[rbac.CapTerminal] {
		writeError(w, http.StatusForbidden, "capability_required", "Your account does not have the \"terminal\" permission")
		return
	}

	site, err := s.store.WebsiteBySlug(r.PathValue("slug"))
	if err != nil || !canManageSite(user, site) {
		writeError(w, http.StatusNotFound, "not_found", "Website not found")
		return
	}
	// A reverse proxy has no runtime to shell into (the UI hides the button, the
	// API refuses the request).
	if !validate.HasRuntime(site.Runtime) {
		writeError(w, http.StatusConflict, "not_applicable",
			"A reverse proxy has no runtime of its own — open a shell on the upstream pod instead")
		return
	}

	target := ptyTarget{
		Title:  site.Slug,
		Dir:    s.host.SitePath(site.TenantUser, site.Slug),
		Tenant: site.TenantUser,
		Slug:   site.Slug,
	}
	// The shell must run as the site's owner, not as root.
	if s.tenants != nil {
		if account, ok := s.tenants.Lookup(r.Context(), site.TenantUser); ok {
			target.UID, target.GID = account.UID, account.GID
		}
	}
	s.servePTY(w, r, user, target, site.Slug)
}

// handleHostPTY opens a root shell for administrators only.
func (s *Server) handleHostPTY(w http.ResponseWriter, r *http.Request) {
	user, _, ok := s.authenticateTicket(w, r)
	if !ok {
		return
	}
	if user.Role != "admin" {
		writeError(w, http.StatusForbidden, "forbidden", "The host console is for administrators only")
		return
	}
	if !s.effectivePermissions(user)[rbac.CapTerminal] {
		writeError(w, http.StatusForbidden, "capability_required", "Your account does not have the \"terminal\" permission")
		return
	}

	home := "/root"
	if _, err := os.Stat(home); err != nil {
		home = "/"
	}
	s.servePTY(w, r, user, ptyTarget{Title: "host", Dir: home, Host: true}, "host")
}

// wsConn serialises writes: gorilla allows only one concurrent writer, and the
// PTY pump and the control loop both write.
type wsConn struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (c *wsConn) binary(payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(ptyWriteWait))
	return c.conn.WriteMessage(websocket.BinaryMessage, payload)
}

func (c *wsConn) json(value any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(ptyWriteWait))
	return c.conn.WriteJSON(value)
}

// servePTY upgrades the connection and pumps data between the browser and the shell.
func (s *Server) servePTY(w http.ResponseWriter, r *http.Request, user *store.User, target ptyTarget, auditTarget string) {
	upgrader := s.upgrader()
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already answered the request
	}
	ws := &wsConn{conn: conn}
	defer func() { _ = conn.Close() }()

	session, err := terminal.Start(terminal.Options{
		Shell:     terminal.DefaultShell(),
		Dir:       target.Dir,
		UID:       target.UID,
		GID:       target.GID,
		Cols:      100,
		Rows:      30,
		Tenant:    target.Tenant,
		Site:      target.Slug,
		SitesRoot: s.host.SitesRoot,
	})
	if err != nil {
		_ = ws.json(map[string]any{"type": "error", "message": err.Error()})
		return
	}
	defer func() { _ = session.Close() }()

	jailed, masked := session.Jailed()
	_ = s.store.Audit(user.ID, "terminal.open", auditTarget, clientIP(r),
		fmt.Sprintf("shell=%s as %s jailed=%t masked=%d", session.Shell(), session.User(), jailed, masked))

	note := "This shell runs as the website's owner account."
	if target.Host {
		note = "This is a host shell: commands run with the daemon's privileges (root)."
	} else if jailed {
		note = fmt.Sprintf("This shell runs as the website's owner and is confined to %s — the account's other folders (%d) are hidden.", target.Dir, masked)
	} else {
		note = "This shell runs as the website's owner, but this host cannot confine it (no mount namespaces), so it can also reach the account's other folders."
	}
	_ = ws.json(map[string]any{
		"type":   "ready",
		"target": target.Title,
		"dir":    target.Dir,
		"jailed": jailed,
		"masked": masked,
		"shell":  session.Shell(),
		"user":   session.User(),
		"mode":   s.host.Mode(),
		"note":   note,
	})

	conn.SetReadLimit(ptyReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(ptyIdleTimeout))

	// PTY -> browser. Two stages so a slow websocket never blocks the shell:
	//   pump    : reads the terminal into a buffered channel
	//   writer  : drains the channel into websocket frames
	output := make(chan []byte, 64)
	stopPump := make(chan struct{})
	pumpDone := make(chan struct{})
	writerDone := make(chan struct{})

	go func() {
		defer close(pumpDone)
		buf := make([]byte, 32*1024)
		for {
			n, err := session.Read(buf)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buf[:n])
				select {
				case output <- chunk:
				case <-stopPump:
					return
				case <-r.Context().Done():
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	go func() {
		defer close(writerDone)
		for chunk := range output {
			if err := ws.binary(chunk); err != nil {
				return
			}
		}
	}()

	defer func() {
		// Order matters: stop the producer, wait for it, then let the consumer finish.
		close(stopPump)
		<-pumpDone
		close(output)
		<-writerDone
	}()

	// browser -> PTY (binary = stdin, text = control)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(ptyIdleTimeout))
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		switch messageType {
		case websocket.BinaryMessage:
			if _, err := session.Write(payload); err != nil {
				break
			}
		case websocket.TextMessage:
			var message controlMessage
			if err := json.Unmarshal(payload, &message); err != nil {
				continue
			}
			switch message.Type {
			case "resize":
				_ = session.Resize(message.Cols, message.Rows)
			case "ping":
				_ = ws.json(map[string]any{"type": "pong", "ts": time.Now().UTC().Format(time.RFC3339)})
			}
		}
	}
	_ = s.store.Audit(user.ID, "terminal.close", auditTarget, clientIP(r), "")
}
