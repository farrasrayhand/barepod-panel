// Package secrets encrypts values that must be readable back (DB passwords,
// tunnel tokens, cloud credentials) using AES-256-GCM with a local key file.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const keySize = 32
const versionPrefix = "v1:"

// LoadOrCreateKey reads a 32-byte key, creating it with 0600 permissions when absent.
func LoadOrCreateKey(path string) ([]byte, error) {
	if data, err := os.ReadFile(path); err == nil {
		if len(data) != keySize {
			return nil, fmt.Errorf("secrets: key at %s must be %d bytes (got %d)", path, keySize, len(data))
		}
		return data, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}

	key := make([]byte, keySize)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

// Encrypt seals plaintext and returns a versioned, base64 payload.
func Encrypt(key []byte, plaintext string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	return versionPrefix + base64.RawStdEncoding.EncodeToString(append(nonce, sealed...)), nil
}

// Decrypt opens a payload produced by Encrypt.
func Decrypt(key []byte, payload string) (string, error) {
	if !strings.HasPrefix(payload, versionPrefix) {
		return "", errors.New("secrets: unknown ciphertext version")
	}
	raw, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(payload, versionPrefix))
	if err != nil {
		return "", err
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("secrets: ciphertext too short")
	}
	nonce, ciphertext := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != keySize {
		return nil, fmt.Errorf("secrets: key must be %d bytes", keySize)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
