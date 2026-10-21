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
