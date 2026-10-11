// Package tlscert generates the panel's self-signed certificate, so the panel can
// be served over HTTPS before the operator has obtained one of their own. A
// self-signed certificate is a warning, not a lie: the browser says it cannot
// verify the issuer, which is exactly what it is.
package tlscert

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"time"
)

// Ensure returns the certificate and key paths, generating a self-signed pair in
// dir the first time and reusing it afterwards. The key is written 0600.
func Ensure(dir string) (certPath, keyPath string, err error) {
	if dir == "" {
		dir = "."
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", "", err
	}
	certPath = filepath.Join(dir, "panel-selfsigned.crt")
	keyPath = filepath.Join(dir, "panel-selfsigned.key")
	if exists(certPath) && exists(keyPath) {
		return certPath, keyPath, nil
	}

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}
	template := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "barepod-panel", Organization: []string{"BarePod Panel"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost", "barepod-panel"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
	}
	if host, err := os.Hostname(); err == nil && host != "" {
		template.DNSNames = append(template.DNSNames, host)
	}
	template.IPAddresses = append(template.IPAddresses, localIPs()...)

	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return "", "", err
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	if err := os.WriteFile(certPath, certPEM, 0o644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		return "", "", err
	}
	return certPath, keyPath, nil
}

// localIPs are this host's non-loopback addresses, so the certificate is valid for
// however the panel is reached (its LAN address, a public IP, a hostname).
func localIPs() []net.IP {
	out := []net.IP{}
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return out
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() {
			out = append(out, ipnet.IP)
		}
	}
	return out
}

func exists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// ErrorHint is the message the operator sees when a certificate cannot be prepared.
func ErrorHint(err error) error {
	return fmt.Errorf("the panel certificate could not be prepared: %w", err)
}
