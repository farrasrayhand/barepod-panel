package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

// A refusal has to say who holds the port. "Already in use" sends the operator to look up which of a
// dozen services it was; naming it ends the question. The field that matters is the local address, not
// the peer one, so a connection *from* that port in ss output must not be mistaken for a listener on it.
func TestAHolderIsNamed(t *testing.T) {
	ss := strings.Join([]string{
		"State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process",
		"LISTEN 0      511          127.0.0.1:6379      0.0.0.0:*    users:((\"redis-server\",pid=1,fd=6))",
		"LISTEN 0      4096               *:22            *:*    users:((\"sshd\",pid=742,fd=3))",
		"ESTAB   0      0      172.19.1.26:8443   172.19.1.100:59930 users:((\"barepod\",pid=9,fd=8))",
		"LISTEN 0      4096               *:8443          *:*    users:((\"barepod\",pid=9,fd=7))",
	}, "\n")
	cases := []struct {
		port int
		want string
	}{
		{6379, "redis-server"},
		{22, "sshd"},
		{8443, "barepod"},
		{5432, ""},
	}
	for _, c := range cases {
		if got := parsePortHolder(ss, c.port); got != c.want {
			t.Errorf("port %d: want %q, got %q", c.port, c.want, got)
		}
	}
}
