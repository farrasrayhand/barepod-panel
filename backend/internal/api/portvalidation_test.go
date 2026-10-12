package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The endpoint that moves the panel to another port rewrites the unit systemd starts it with, so the
// port it accepts has to be a port before anything is written: a zero, a number above the range, the
// port already in use, or a port the daemon cannot bind without root are all refusals with a reason.
func TestOnlyARealPortIsAccepted(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/api/v1/system/ports/panel", nil)
	cases := []struct {
		name    string
		port    int
		current int
		want    string
	}{
		{"empty", 0, 8443, "a port is between 1 and 65535"},
		{"above the range", 65536, 8443, "a port is between 1 and 65535"},
		{"the port already in use", 8443, 8443, "that is the port the panel is already using"},
		{"a privileged port", 80, 8443, "ports below 1024 need root and are best left to the system"},
		{"a port it can bind", 9443, 8443, ""},
	}
	for _, c := range cases {
		if got := validatePort(r, c.port, c.current); got != c.want {
			t.Errorf("%s: want %q, got %q", c.name, c.want, got)
		}
	}
}
