package api

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// publicIPTTL keeps the answer fresh without asking an external service on every
// sidebar render or settings page. A forced refresh bypasses it.
const publicIPTTL = 5 * time.Minute

type publicIPResult struct {
	IP        string `json:"ip"`
	Source    string `json:"source"` // "interface" (directly assigned) or "egress" (NAT/public lookup)
	Inbound   bool   `json:"inbound"`
	CheckedAt string `json:"checkedAt"`
	Cached    bool   `json:"cached"`
	Stale     bool   `json:"stale,omitempty"`
	Message   string `json:"message,omitempty"`
}

// handlePublicIP reports the server's public address. It is separate from the
// address the browser happens to use: a panel opened at a domain was showing the
// domain as if it were an IP.
func (s *Server) handlePublicIP(w http.ResponseWriter, r *http.Request, _ *store.User, _ *store.Session) {
	force := r.URL.Query().Get("refresh") == "1" || r.URL.Query().Get("refresh") == "true"
	result, err := s.resolvePublicIP(r.Context(), force)
	if err != nil {
		writeError(w, http.StatusBadGateway, "public_ip_unavailable", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) resolvePublicIP(ctx context.Context, force bool) (publicIPResult, error) {
	s.publicIPMu.Lock()
	defer s.publicIPMu.Unlock()

	now := time.Now().UTC()
	if !force && s.publicIP != "" && now.Sub(s.publicIPAt) < publicIPTTL {
		return publicIPResult{
			IP: s.publicIP, Source: s.publicIPSource, Inbound: s.publicIPSource == "interface",
			CheckedAt: s.publicIPAt.Format(time.RFC3339), Cached: true,
		}, nil
	}

	ip, source, err := detectPublicIP(ctx)
	if err != nil {
		// A refresh that cannot reach the internet is not a reason to erase the
		// last good answer; say that it is stale instead.
		if s.publicIP != "" {
			return publicIPResult{
				IP: s.publicIP, Source: s.publicIPSource, Inbound: s.publicIPSource == "interface",
				CheckedAt: s.publicIPAt.Format(time.RFC3339), Stale: true, Message: err.Error(),
			}, nil
		}
		return publicIPResult{}, err
	}

	s.publicIP, s.publicIPSource, s.publicIPAt = ip, source, now
	return publicIPResult{
		IP: ip, Source: source, Inbound: source == "interface",
		CheckedAt: now.Format(time.RFC3339),
	}, nil
}

// detectPublicIP first trusts a globally routable address assigned to an
// interface (a real VPS), then asks fixed, well-known echo services for the
// egress address (a host behind NAT). No user input reaches these URLs.
func detectPublicIP(ctx context.Context) (string, string, error) {
	interfaceIP := interfacePublicIP()
	egressIP, egressErr := lookupEgressIP(ctx)
	if egressErr == nil {
		ip, source := resolvePublicIP(interfaceIP, egressIP)
		return ip, source, nil
	}
	if interfaceIP != "" {
		// The echo service is unreachable, so the interface is the only evidence.
		return interfaceIP, "interface", nil
	}
	return "", "", egressErr
}

// resolvePublicIP prefers egress whenever it is available: an address that is
// globally routable by flags can still be provider-internal (for example
// 192.10.5.60 in a private cloud). Only when egress equals the interface address
// is the host directly addressed and inbound.
func resolvePublicIP(interfaceIP, egressIP string) (string, string) {
	if egressIP != "" {
		if interfaceIP == egressIP {
			return interfaceIP, "interface"
		}
		return egressIP, "egress"
	}
	if interfaceIP != "" {
		return interfaceIP, "interface"
	}
	return "", ""
}

func lookupEgressIP(ctx context.Context) (string, error) {
	client := &http.Client{Timeout: 4 * time.Second}
	endpoints := []struct {
		url   string
		trace bool
	}{
		{"https://api.ipify.org", false},
		{"https://icanhazip.com", false},
		{"https://ifconfig.me/ip", false},
		{"https://www.cloudflare.com/cdn-cgi/trace", true},
	}
	var lastErr error
	for _, endpoint := range endpoints {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.url, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "BarePod-Panel")
		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("%s returned HTTP %d", endpoint.url, resp.StatusCode)
			continue
		}
		candidate := strings.TrimSpace(string(body))
		if endpoint.trace {
			candidate = traceIP(candidate)
		}
		if ip := net.ParseIP(candidate); ip != nil && isPublicIP(ip) {
			return ip.String(), nil
		}
		lastErr = fmt.Errorf("%s did not return a public IP", endpoint.url)
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no public IP detected")
	}
	return "", lastErr
}

func interfacePublicIP() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	var ipv6 string
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ip := ipFromAddr(addr)
			if ip == nil || !isPublicIP(ip) {
				continue
			}
			if ip.To4() != nil {
				return ip.String()
			}
			if ipv6 == "" {
				ipv6 = ip.String()
			}
		}
	}
	return ipv6
}

func ipFromAddr(addr net.Addr) net.IP {
	switch value := addr.(type) {
	case *net.IPNet:
		return value.IP
	case *net.IPAddr:
		return value.IP
	}
	host, _, err := net.SplitHostPort(addr.String())
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}

// isPublicIP rejects everything that cannot be a globally routable address,
// including carrier-grade NAT (100.64/10).
func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return false
		}
	}
	return true
}

func traceIP(body string) string {
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "ip=") {
			return strings.TrimPrefix(line, "ip=")
		}
	}
	return ""
}
