// Package totp implements the time-based one-time passwords an authenticator app (Google
// Authenticator, Authy, 1Password…) shows. It is deliberately stdlib-only: RFC 6238 is HMAC-SHA1
// over a 30-second counter, and a dependency for forty lines would be more to audit than to write.
package totp

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// step is the standard 30-second window.
const step = 30 * time.Second

var encoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// GenerateSecret returns a new base32 secret (160 bits, the size RFC 4226 recommends).
func GenerateSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return encoding.EncodeToString(buf), nil
}

// Code computes the six-digit code for a moment.
func Code(secret string, at time.Time) (string, error) {
	key, err := decode(secret)
	if err != nil {
		return "", err
	}
	counter := uint64(at.Unix() / int64(step/time.Second))
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	// RFC 4226 §5.3: the low nibble of the last byte picks the 4-byte window.
	offset := sum[len(sum)-1] & 0x0f
	value := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", value%1000000), nil
}

// Validate accepts the code for the current step and one either side, which covers a phone clock a
// few seconds off. It compares in constant time.
func Validate(secret, code string, now time.Time) bool {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return false
	}
	for _, skew := range []time.Duration{0, -step, step} {
		want, err := Code(secret, now.Add(skew))
		if err == nil && hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// ProvisioningURI is the otpauth:// link an authenticator scans. The label carries issuer:account so
// the entry is recognisable in a list.
func ProvisioningURI(issuer, account, secret string) string {
	query := url.Values{}
	query.Set("secret", secret)
	query.Set("issuer", issuer)
	query.Set("algorithm", "SHA1")
	query.Set("digits", "6")
	query.Set("period", "30")
	return "otpauth://totp/" + url.PathEscape(issuer+":"+account) + "?" + query.Encode()
}

func decode(secret string) ([]byte, error) {
	clean := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(secret), " ", ""))
	clean = strings.TrimRight(clean, "=")
	return encoding.DecodeString(clean)
}
