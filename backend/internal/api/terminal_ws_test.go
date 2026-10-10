package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func (p *testPanel) ticket(t *testing.T) string {
	t.Helper()
	resp, body := p.do(t, http.MethodPost, "/api/v1/ws/ticket", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("ticket status = %d (%s)", resp.StatusCode, body)
	}
	var payload struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Ticket == "" {
		t.Fatal("the ticket is empty")
	}
	return payload.Ticket
}

func (p *testPanel) wsURL(path, ticket string) string {
	return "ws" + strings.TrimPrefix(p.server.URL, "http") + path + "?ticket=" + ticket
}

func dial(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial %s: %v", url, err)
	}
	return conn
}

// readUntil reads frames until the payload contains marker.
func readUntil(t *testing.T, conn *websocket.Conn, marker string) string {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	seen := strings.Builder{}
	for time.Now().Before(deadline) {
		_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		_, message, err := conn.ReadMessage()
		if err != nil {
			break
		}
		seen.Write(message)
		if strings.Contains(seen.String(), marker) {
			return seen.String()
		}
	}
	t.Fatalf("the terminal never produced %q; saw:\n%s", marker, seen.String())
	return ""
}

func TestTerminalRunsAsTenantAndAcceptsInput(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")

	conn := dial(t, panel.wsURL("/api/v1/websites/admin-site/pty", panel.ticket(t)))
	defer func() { _ = conn.Close() }()

	// The first frame describes the session so the UI can show what it is.
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	_, banner, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("reading the banner: %v", err)
	}
	var ready struct {
		Type   string `json:"type"`
		Target string `json:"target"`
		Shell  string `json:"shell"`
		User   string `json:"user"`
		Mode   string `json:"mode"`
	}
	if err := json.Unmarshal(banner, &ready); err != nil || ready.Type != "ready" {
		t.Fatalf("banner = %s (err %v)", banner, err)
	}
	if ready.Target != "admin-site" || ready.Shell == "" || ready.User == "" {
		t.Fatalf("banner is incomplete: %+v", ready)
	}

	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("echo WS-MARKER-OK\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	readUntil(t, conn, "WS-MARKER-OK")

	// A resize control frame must be accepted without breaking the session.
	frame, err := json.Marshal(controlMessage{Type: "resize", Cols: 120, Rows: 40})
	if err != nil {
		t.Fatal(err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, frame); err != nil {
		t.Fatalf("resize: %v", err)
	}
	if err := conn.WriteMessage(websocket.BinaryMessage, []byte("stty size\n")); err != nil {
		t.Fatal(err)
	}
	readUntil(t, conn, "40 120")

	// The session was audited.
	if !auditActions(t, panel)["terminal.open"] {
		t.Errorf("terminal.open was not audited")
	}
}

func TestTerminalTicketIsSingleUse(t *testing.T) {
	panel := newTestPanel(t)
	panel.login(t, "admin")
	ticket := panel.ticket(t)

	conn := dial(t, panel.wsURL("/api/v1/websites/admin-site/pty", ticket))
	defer func() { _ = conn.Close() }()

	if _, _, err := websocket.DefaultDialer.Dial(panel.wsURL("/api/v1/websites/admin-site/pty", ticket), nil); err == nil {
		t.Fatal("the same ticket was accepted twice")
	}
}

func TestTerminalRequiresOwnershipAndTicket(t *testing.T) {
	panel := newTestPanel(t)

	// No ticket at all.
	if _, _, err := websocket.DefaultDialer.Dial(
		"ws"+strings.TrimPrefix(panel.server.URL, "http")+"/api/v1/websites/admin-site/pty", nil); err == nil {
		t.Fatal("a terminal opened without a ticket")
	}

	panel.login(t, "alex")

	// alex may not open the admin's website shell ...
	if _, _, err := websocket.DefaultDialer.Dial(
		panel.wsURL("/api/v1/websites/admin-site/pty", panel.ticket(t)), nil); err == nil {
		t.Fatal("alex opened a terminal on the admin's website")
	}

	// ... and the host console is for administrators only.
	if _, _, err := websocket.DefaultDialer.Dial(
		panel.wsURL("/api/v1/system/pty", panel.ticket(t)), nil); err == nil {
		t.Fatal("a non-admin opened the host console")
	}

	// Their own website still works.
	conn := dial(t, panel.wsURL("/api/v1/websites/alex-site/pty", panel.ticket(t)))
	_ = conn.Close()
}

// auditActions reads the audit log through the store.
func auditActions(t *testing.T, panel *testPanel) map[string]bool {
	t.Helper()
	rows, err := panel.store.DB.Query(`SELECT action FROM audit_log`)
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	defer func() { _ = rows.Close() }()

	actions := map[string]bool{}
	for rows.Next() {
		var action string
		if err := rows.Scan(&action); err != nil {
			t.Fatal(err)
		}
		actions[action] = true
	}
	return actions
}
