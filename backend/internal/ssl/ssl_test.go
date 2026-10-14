package ssl

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGenerateAndReadSelfSigned(t *testing.T) {
	tmp := t.TempDir()
	certPath := filepath.Join(tmp, "fullchain.pem")
	keyPath := filepath.Join(tmp, "privkey.pem")

	info, err := GenerateSelfSigned("demo.example.com", []string{"www.demo.example.com", "api.demo.example.com"}, certPath, keyPath)
	if err != nil {
		t.Fatalf("GenerateSelfSigned failed: %v", err)
	}

	if info.Domain != "demo.example.com" {
		t.Errorf("expected domain demo.example.com, got %s", info.Domain)
	}
	if !info.IsSelfSigned {
		t.Errorf("expected isSelfSigned to be true")
	}
	if info.DaysLeft < 360 {
		t.Errorf("expected ~365 days left, got %d", info.DaysLeft)
	}
	if len(info.SANs) < 3 {
		t.Errorf("expected at least 3 SANs (domain + 2 aliases), got %v", info.SANs)
	}

	// Validate Keypair
	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}

	if err := ValidateKeyPair(certPEM, keyPEM); err != nil {
		t.Errorf("ValidateKeyPair failed on generated pair: %v", err)
	}

	// Test invalid keypair
	if err := ValidateKeyPair(certPEM, []byte("invalid-key")); err == nil {
		t.Errorf("expected error for invalid key")
	}
}

func TestPreflightDNSLocalhost(t *testing.T) {
	ip, resolved, err := PreflightDNS("localhost")
	if err != nil || !resolved || ip == "" {
		t.Errorf("PreflightDNS localhost failed: ip=%s, resolved=%v, err=%v", ip, resolved, err)
	}
}
