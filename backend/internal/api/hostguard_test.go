package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

func TestHostGuardBindsToTheConfiguredHostname(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/panel.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })

	s := &Server{store: st}
	guard := s.hostGuard(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	call := func(host string) int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Host = host
		guard.ServeHTTP(rec, req)
		return rec.Code
	}
	set := func(key, value string) {
		t.Helper()
		if err := st.SavePanelSetting(key, value); err != nil {
			t.Fatal(err)
		}
	}

	// Cloudflare off: the panel answers on any address (the public-IP default).
	if got := call("203.0.113.9"); got != http.StatusOK {
		t.Errorf("with Cloudflare off, a bare IP answered %d, want 200", got)
	}

	// Turned on but not yet published: still open, so the operator can publish from where they are.
	set(panelUseCloudflareKey, "true")
	if got := call("203.0.113.9"); got != http.StatusOK {
		t.Errorf("with Cloudflare on but no hostname, a bare IP answered %d, want 200", got)
	}

	// Bound to the hostname: it is answered, and so is any address (IP access stays allowed), but a
	// different hostname pointed at this box is refused.
	set(panelFQDNKey, "panel.example.com")
	for _, host := range []string{"panel.example.com", "panel.example.com:8443", "203.0.113.9", "203.0.113.9:8443", "127.0.0.1:8443", "localhost"} {
		if got := call(host); got != http.StatusOK {
			t.Errorf("host %q answered %d, want 200", host, got)
		}
	}
	for _, host := range []string{"evil.example.com", "panel.example.com.evil.example.com"} {
		if got := call(host); got != http.StatusForbidden {
			t.Errorf("host %q answered %d, want 403", host, got)
		}
	}

	// Turned back off: the panel is reachable by address again.
	set(panelUseCloudflareKey, "")
	if got := call("203.0.113.9"); got != http.StatusOK {
		t.Errorf("with Cloudflare off again, a bare IP answered %d, want 200", got)
	}
}
