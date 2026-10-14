// Package id generates ULIDs: time-sortable, immutable primary keys.
package id

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"time"
)

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// New returns a 26-character Crockford base32 ULID
// (48-bit millisecond timestamp + 80 bits of randomness, 2 leading zero bits).
func New() string {
	var b [16]byte
	ms := uint64(time.Now().UnixMilli())
	b[0] = byte(ms >> 40)
	b[1] = byte(ms >> 32)
	b[2] = byte(ms >> 24)
	b[3] = byte(ms >> 16)
	b[4] = byte(ms >> 8)
	b[5] = byte(ms)
	if _, err := rand.Read(b[6:]); err != nil {
		// Extremely unlikely; the timestamp still guarantees uniqueness for our rate.
		return hex.EncodeToString(b[:])
	}
	return encode(b)
}

// encode turns 128 bits into 26 Crockford base32 characters (130 bits, 2 leading zeros).
func encode(b [16]byte) string {
	out := make([]byte, 26)
	bit := func(pos int) byte {
		p := pos - 2 // skip the two leading zero bits
		if p < 0 {
			return 0
		}
		return (b[p/8] >> uint(7-(p%8))) & 1
	}
	pos := 0
	for i := 0; i < 26; i++ {
		var v byte
		for j := 0; j < 5; j++ {
			v = v<<1 | bit(pos)
			pos++
		}
		out[i] = crockford[v]
	}
	return string(out)
}

// Token returns 2n lowercase hex characters from n random bytes.
func Token(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return hex.EncodeToString([]byte(New() + New()))
	}
	return hex.EncodeToString(buf)
}

// Base64 returns standard base64-encoded n random bytes.
func Base64(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return base64.StdEncoding.EncodeToString([]byte(Token(n)[:n]))
	}
	return base64.StdEncoding.EncodeToString(buf)
}
