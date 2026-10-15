package api

import (
	"net"
	"net/http"
	"strings"
)

// hostGuard binds the panel to its configured hostname. Until Cloudflare is switched on the panel
// answers on any address — that is the public-IP default. Once it is on and a hostname is set, a
// request that names a *different* hostname (another domain pointed at this box) is refused, so the
// configured domain is the only name the panel answers to.
//
// An address is always allowed: an IP literal reaches the panel whether or not Cloudflare is on, so
// the operator can still get in by IP, and — should the hostname be mistyped — over loopback.
func (s *Server) hostGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		useCloudflare, err := s.store.PanelSetting(panelUseCloudflareKey)
		if err != nil || useCloudflare != "true" {
			next.ServeHTTP(w, r)
			return
		}
		fqdn, err := s.store.PanelSetting(panelFQDNKey)
		if err != nil || fqdn == "" {
			next.ServeHTTP(w, r)
			return
		}
		host := hostOnly(r.Host)
		if host == fqdn || host == "localhost" || net.ParseIP(host) != nil {
			next.ServeHTTP(w, r)
			return
		}
		writeError(w, http.StatusForbidden, "host_not_allowed",
			"this panel answers only on its configured hostname ("+fqdn+") or its address")
	})
}

// hostOnly strips the port (and IPv6 brackets) from a Host header, lower-cased.
func hostOnly(hostport string) string {
	hostport = strings.ToLower(strings.TrimSpace(hostport))
	if host, _, err := net.SplitHostPort(hostport); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(hostport, "[]")
}
