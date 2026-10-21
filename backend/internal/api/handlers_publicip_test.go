package api

import (
	"net"
	"testing"
)

func TestPublicIPClassification(t *testing.T) {
	public := []string{"8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"}
	for _, raw := range public {
		if !isPublicIP(net.ParseIP(raw)) {
			t.Errorf("%s should be public", raw)
		}
	}
	notPublic := []string{"127.0.0.1", "10.0.0.1", "172.19.1.26", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fe80::1"}
	for _, raw := range notPublic {
		if isPublicIP(net.ParseIP(raw)) {
			t.Errorf("%s should not be public", raw)
		}
	}
}

func TestTraceIP(t *testing.T) {
	body := "fl=123\nh=www.cloudflare.com\nip=203.0.113.9\nts=1\n"
	if got := traceIP(body); got != "203.0.113.9" {
		t.Fatalf("traceIP = %q", got)
	}
	if got := traceIP("no ip line"); got != "" {
		t.Fatalf("traceIP without a line = %q", got)
	}
}

func TestResolvePublicIPPrefersMatchingInterface(t *testing.T) {
	// A global flag is not proof of inbound reachability: this provider-internal
	// address must yield the egress address instead.
	if ip, source := resolvePublicIP("192.10.5.60", "180.247.244.20"); ip != "180.247.244.20" || source != "egress" {
		t.Fatalf("mismatched interface = (%q, %q), want egress", ip, source)
	}
	if ip, source := resolvePublicIP("203.0.113.9", "203.0.113.9"); ip != "203.0.113.9" || source != "interface" {
		t.Fatalf("matching interface = (%q, %q), want interface", ip, source)
	}
	if ip, source := resolvePublicIP("203.0.113.9", ""); ip != "203.0.113.9" || source != "interface" {
		t.Fatalf("interface fallback = (%q, %q)", ip, source)
	}
	if ip, source := resolvePublicIP("", ""); ip != "" || source != "" {
		t.Fatalf("empty = (%q, %q)", ip, source)
	}
}
