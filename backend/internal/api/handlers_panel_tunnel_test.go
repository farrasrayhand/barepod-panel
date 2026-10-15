package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func newPanelTunnelServer(t *testing.T) *Server {
	t.Helper()
	st, err := store.Open(t.TempDir() + "/panel.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &Server{store: st, cfg: config.Config{Listen: "0.0.0.0:8443", TLS: true}}
}

// The panel's own domain may only ever be published by an administrator: a tenant's account must not
// be able to expose the panel, so every one of the three endpoints refuses a plain user.
func TestPanelTunnelIsAdminOnly(t *testing.T) {
	s := newPanelTunnelServer(t)
	calls := []struct {
		name   string
		handle authedHandler
	}{
		{"status", s.handlePanelTunnelStatus},
		{"publish", s.handlePublishPanel},
		{"unpublish", s.handleUnpublishPanel},
	}
	for _, call := range calls {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/panel/tunnel", strings.NewReader(`{"hostname":"panel.example.com"}`))
		call.handle(rec, req, &store.User{Username: "alex", Role: "user"}, &store.Session{})
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s answered %d for a non-admin, want 403", call.name, rec.Code)
		}
	}
}

// Detection: "configured" follows the admin's Cloudflare tunnel, and the saved hostname is reported.
func TestPanelTunnelStatusReportsDetection(t *testing.T) {
	s := newPanelTunnelServer(t)
	admin := &store.User{Username: "admin", Role: "admin"}

	read := func() panelTunnelStatus {
		t.Helper()
		rec := httptest.NewRecorder()
		s.handlePanelTunnelStatus(rec, httptest.NewRequest(http.MethodGet, "/api/v1/panel/tunnel", nil), admin, &store.Session{})
		var status panelTunnelStatus
		if err := json.Unmarshal(rec.Body.Bytes(), &status); err != nil {
			t.Fatalf("decode status: %v", err)
		}
		return status
	}

	status := read()
	if status.Configured {
		t.Error("configured = true with no Cloudflare tunnel saved, want false")
	}
	// The tunnel must point at the panel on loopback, on the port the daemon serves.
	if status.Service != "https://127.0.0.1:8443" {
		t.Errorf("service = %q, want https://127.0.0.1:8443", status.Service)
	}

	if _, err := s.store.UpsertCloudflareTunnel("admin", "admin-tunnel", "run-token", "api-token", "acct", "tun"); err != nil {
		t.Fatal(err)
	}
	if err := s.store.SavePanelSetting(panelFQDNKey, "panel.example.com"); err != nil {
		t.Fatal(err)
	}

	status = read()
	if !status.Configured {
		t.Error("configured = false with an API token saved, want true")
	}
	if status.FQDN != "panel.example.com" {
		t.Errorf("fqdn = %q, want the saved hostname", status.FQDN)
	}
}

// Publishing refuses a bad domain, and refuses to run before Cloudflare is configured rather than
// calling the API with empty credentials.
func TestPanelPublishValidatesDomainAndCloudflare(t *testing.T) {
	s := newPanelTunnelServer(t)
	admin := &store.User{Username: "admin", Role: "admin"}

	post := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/panel/tunnel/publish", strings.NewReader(body))
		s.handlePublishPanel(rec, req, admin, &store.Session{})
		return rec
	}

	if rec := post(`{"hostname":"not a domain"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("an invalid domain answered %d, want 400", rec.Code)
	}
	rec := post(`{"hostname":"panel.example.com"}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "cloudflare_not_configured") {
		t.Errorf("publish before Cloudflare is configured answered %d (%s), want 400 cloudflare_not_configured", rec.Code, rec.Body.String())
	}
}
