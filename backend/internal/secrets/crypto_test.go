package secrets

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}

	const plaintext = "p@ssw0rd-with-\"quotes\" and spaces"
	sealed, err := Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if sealed == plaintext {
		t.Fatal("ciphertext equals plaintext")
	}

	got, err := Decrypt(key, sealed)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != plaintext {
		t.Fatalf("Decrypt = %q, want %q", got, plaintext)
	}
}

func TestEncryptIsRandomised(t *testing.T) {
	key := make([]byte, 32)
	a, err := Encrypt(key, "same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Encrypt(key, "same")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("two encryptions of the same value produced identical ciphertext (nonce reuse?)")
	}
}

func TestDecryptRejectsWrongKey(t *testing.T) {
	key := make([]byte, 32)
	other := make([]byte, 32)
	other[0] = 1
	sealed, err := Encrypt(key, "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Decrypt(other, sealed); err == nil {
		t.Fatal("Decrypt with the wrong key succeeded")
	}
}

func TestDecryptRejectsTampering(t *testing.T) {
	key := make([]byte, 32)
	sealed, err := Encrypt(key, "secret")
	if err != nil {
		t.Fatal(err)
	}
	tampered := []byte(sealed)
	// Flip one base64 character in the middle, so the change is guaranteed to differ:
	// replacing the tail with a fixed suffix was a no-op whenever the ciphertext
	// already ended that way, which made this test flaky.
	mid := len(tampered) / 2
	if tampered[mid] == 'A' {
		tampered[mid] = 'B'
	} else {
		tampered[mid] = 'A'
	}
	if _, err := Decrypt(key, string(tampered)); err == nil {
		t.Fatal("Decrypt accepted tampered ciphertext")
	}
}

func TestLoadOrCreateKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "secret.key")

	key, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if len(key) != keySize {
		t.Fatalf("key length = %d, want %d", len(key), keySize)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("key mode = %o, want 600", perm)
	}

	again, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if string(again) != string(key) {
		t.Fatal("key was regenerated instead of reused")
	}
}
