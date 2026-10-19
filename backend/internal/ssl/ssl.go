// Package ssl manages TLS certificates, self-signed generation, ACME Let's Encrypt issuance,
// custom certificate upload validation, and certificate lifecycle inspection.
package ssl

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	ACMEDir    = "/var/lib/barepod/acme"
	CertsDir   = "/etc/barepod/ssl"
	LetsDir    = "/etc/letsencrypt/live"
)

// CertInfo describes parsed certificate metadata for the UI and vhost configuration.
type CertInfo struct {
	Domain       string    `json:"domain"`
	Issuer       string    `json:"issuer"`
	Subject      string    `json:"subject"`
	SANs         []string  `json:"sans"`
	NotBefore    time.Time `json:"notBefore"`
	NotAfter     time.Time `json:"notAfter"`
	DaysLeft     int       `json:"daysLeft"`
	IsExpired    bool      `json:"isExpired"`
	IsSelfSigned bool      `json:"isSelfSigned"`
	CertPath     string    `json:"certPath"`
	KeyPath      string    `json:"keyPath"`
}

// EnsureACMEDir creates the ACME webroot challenge directory for HTTP-01 validations.
func EnsureACMEDir() (string, error) {
	challengeDir := filepath.Join(ACMEDir, ".well-known", "acme-challenge")
	if err := os.MkdirAll(challengeDir, 0o755); err != nil {
		return "", fmt.Errorf("ssl: ensure acme dir: %w", err)
	}
	return challengeDir, nil
}

// EnsureCertsDir creates the BarePod custom certificate storage directory.
func EnsureCertsDir() (string, error) {
	parent := filepath.Dir(CertsDir)
	_ = os.MkdirAll(parent, 0o755)
	_ = os.Chmod(parent, 0o755)
	if err := os.MkdirAll(CertsDir, 0o755); err != nil {
		return "", fmt.Errorf("ssl: ensure certs dir: %w", err)
	}
	_ = os.Chmod(CertsDir, 0o755)
	return CertsDir, nil
}

// ReadCertInfo parses an x509 PEM certificate file from disk and returns its metadata.
func ReadCertInfo(certPath, keyPath string) (*CertInfo, error) {
	data, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("ssl: read cert: %w", err)
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("ssl: no PEM block found in certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("ssl: parse x509 certificate: %w", err)
	}

	now := time.Now()
	daysLeft := int(cert.NotAfter.Sub(now).Hours() / 24)
	isExpired := now.After(cert.NotAfter)
	isSelfSigned := cert.Issuer.String() == cert.Subject.String()

	issuer := cert.Issuer.CommonName
	if issuer == "" && len(cert.Issuer.Organization) > 0 {
		issuer = cert.Issuer.Organization[0]
	}
	if issuer == "" {
		issuer = cert.Issuer.String()
	}

	return &CertInfo{
		Domain:       cert.Subject.CommonName,
		Issuer:       issuer,
		Subject:      cert.Subject.CommonName,
		SANs:         cert.DNSNames,
		NotBefore:    cert.NotBefore,
		NotAfter:     cert.NotAfter,
		DaysLeft:     daysLeft,
		IsExpired:    isExpired,
		IsSelfSigned: isSelfSigned,
		CertPath:     certPath,
		KeyPath:      keyPath,
	}, nil
}

// ValidateKeyPair ensures that the provided certificate PEM and private key PEM match.
func ValidateKeyPair(certPEM, keyPEM []byte) error {
	_, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		return fmt.Errorf("ssl: invalid keypair: %w", err)
	}
	return nil
}

// GenerateSelfSigned generates a modern ECDSA P-256 self-signed certificate on disk.
func GenerateSelfSigned(domain string, aliases []string, outCertPath, outKeyPath string) (*CertInfo, error) {
	_, _ = EnsureCertsDir()
	certDir := filepath.Dir(outCertPath)
	if err := os.MkdirAll(certDir, 0o755); err != nil {
		return nil, fmt.Errorf("ssl: mkdir cert: %w", err)
	}
	_ = os.Chmod(certDir, 0o755)

	keyDir := filepath.Dir(outKeyPath)
	if err := os.MkdirAll(keyDir, 0o755); err != nil {
		return nil, fmt.Errorf("ssl: mkdir key: %w", err)
	}
	_ = os.Chmod(keyDir, 0o755)

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("ssl: generate ecdsa key: %w", err)
	}

	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	serialNumber, err := rand.Int(rand.Reader, serialLimit)
	if err != nil {
		return nil, fmt.Errorf("ssl: generate serial: %w", err)
	}

	now := time.Now()
	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   domain,
			Organization: []string{"BarePod Panel Self-Signed"},
		},
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              now.Add(365 * 24 * time.Hour), // 1 year
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}

	// Add SANs
	sanMap := map[string]bool{domain: true}
	template.DNSNames = append(template.DNSNames, domain)
	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias != "" && !sanMap[alias] {
			sanMap[alias] = true
			template.DNSNames = append(template.DNSNames, alias)
		}
	}
	if ip := net.ParseIP(domain); ip != nil {
		template.IPAddresses = append(template.IPAddresses, ip)
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return nil, fmt.Errorf("ssl: create certificate: %w", err)
	}

	// Write cert PEM
	certOut, err := os.OpenFile(outCertPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, fmt.Errorf("ssl: open cert file: %w", err)
	}
	defer certOut.Close()
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		return nil, fmt.Errorf("ssl: encode cert pem: %w", err)
	}

	// Write key PEM
	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("ssl: marshal ec private key: %w", err)
	}
	keyOut, err := os.OpenFile(outKeyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return nil, fmt.Errorf("ssl: open key file: %w", err)
	}
	defer keyOut.Close()
	if err := pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes}); err != nil {
		return nil, fmt.Errorf("ssl: encode key pem: %w", err)
	}

	return ReadCertInfo(outCertPath, outKeyPath)
}

// PreflightDNS resolves the domain to check if it points to a reachable IP.
func PreflightDNS(domain string) (ip string, resolved bool, err error) {
	domain = strings.TrimSpace(domain)
	if domain == "" || domain == "localhost" || strings.HasSuffix(domain, ".local") {
		return "127.0.0.1", true, nil
	}
	if parsed := net.ParseIP(domain); parsed != nil {
		return parsed.String(), true, nil
	}

	ips, err := net.LookupIP(domain)
	if err != nil || len(ips) == 0 {
		return "", false, fmt.Errorf("domain %s does not resolve in DNS", domain)
	}
	return ips[0].String(), true, nil
}

// InstallCustomCert writes validated custom certificate and private key to disk.
func InstallCustomCert(domain string, certPEM, keyPEM []byte, baseDir ...string) (*CertInfo, error) {
	if err := ValidateKeyPair(certPEM, keyPEM); err != nil {
		return nil, err
	}

	targetBase := CertsDir
	if len(baseDir) > 0 && baseDir[0] != "" {
		targetBase = baseDir[0]
	} else {
		_, _ = EnsureCertsDir()
	}

	dir := filepath.Join(targetBase, domain)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("ssl: mkdir custom cert dir: %w", err)
	}
	_ = os.Chmod(dir, 0o755)

	certPath := filepath.Join(dir, "fullchain.pem")
	keyPath := filepath.Join(dir, "privkey.pem")

	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return nil, fmt.Errorf("ssl: write fullchain: %w", err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o644); err != nil {
		return nil, fmt.Errorf("ssl: write privkey: %w", err)
	}

	return ReadCertInfo(certPath, keyPath)
}

// IssueLetsEncrypt runs certbot in webroot mode against the shared ACMEDir.
func IssueLetsEncrypt(ctx context.Context, domain string, aliases []string, email string) (*CertInfo, error) {
	// Pre-flight DNS check to avoid Let's Encrypt rate limiting
	_, resolved, err := PreflightDNS(domain)
	if !resolved {
		return nil, fmt.Errorf("pre-flight DNS check failed: %w. Point domain DNS A-record to this host before requesting Let's Encrypt", err)
	}

	webrootDir, err := EnsureACMEDir()
	if err != nil {
		return nil, err
	}

	// Check if certbot exists
	certbotPath, err := exec.LookPath("certbot")
	if err != nil {
		return nil, errors.New("certbot is not installed on this host (run 'apt-get install -y certbot' or install via Stack)")
	}

	args := []string{
		"certonly",
		"--webroot",
		"-w", webrootDir,
		"-d", domain,
		"--non-interactive",
		"--agree-tos",
	}

	for _, alias := range aliases {
		alias = strings.TrimSpace(alias)
		if alias != "" && alias != domain {
			args = append(args, "-d", alias)
		}
	}

	if email != "" {
		args = append(args, "-m", email)
	} else {
		args = append(args, "--register-unsafely-without-email")
	}

	cmd := exec.CommandContext(ctx, certbotPath, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		outStr := string(out)
		if idx := strings.Index(outStr, "The Certificate Authority reported these problems:"); idx != -1 {
			part := outStr[idx:]
			if endIdx := strings.Index(part, "Hint:"); endIdx != -1 {
				part = part[:endIdx]
			}
			return nil, fmt.Errorf("%s (Ensure your domain DNS A/AAAA record points directly to this server)", strings.TrimSpace(part))
		}
		return nil, fmt.Errorf("certbot failed: %s: %w", outStr, err)
	}

	certPath := filepath.Join(LetsDir, domain, "fullchain.pem")
	keyPath := filepath.Join(LetsDir, domain, "privkey.pem")

	return ReadCertInfo(certPath, keyPath)
}
