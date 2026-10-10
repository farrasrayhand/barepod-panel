package auth

import "testing"

func TestHashAndVerify(t *testing.T) {
	const password = "correct horse battery staple"
	encoded, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if encoded == password {
		t.Fatal("hash equals the plaintext password")
	}

	ok, err := VerifyPassword(password, encoded)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if !ok {
		t.Fatal("the correct password was rejected")
	}

	ok, err = VerifyPassword("wrong password", encoded)
	if err != nil {
		t.Fatalf("VerifyPassword: %v", err)
	}
	if ok {
		t.Fatal("a wrong password was accepted")
	}
}

func TestHashIsSalted(t *testing.T) {
	a, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	b, err := HashPassword("same")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("two hashes of the same password are identical (missing salt)")
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	if _, err := VerifyPassword("x", "not-a-hash"); err == nil {
		t.Fatal("expected an error for a malformed hash")
	}
	if _, err := VerifyPassword("x", "$bcrypt$v=19$m=1,t=1,p=1$aa$bb"); err == nil {
		t.Fatal("expected an error for an unsupported algorithm")
	}
}
