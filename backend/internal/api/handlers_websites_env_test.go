package api

import (
	"strings"
	"testing"
)

// TestMaskEnvSecrets covers the real file that started this: a Laravel .env whose
// secrets must not reach the browser, while the keys that answer "what does this app
// connect to" (DB_CONNECTION, DB_DATABASE) stay readable.
func TestMaskEnvSecrets(t *testing.T) {
	in := `APP_NAME=siaarta24
APP_ENV=production
APP_KEY=base64:X8n49f03jfa94klsm49v02kflasjfo32=
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=app_siaarta24
DB_USERNAME=suprion7
DB_PASSWORD="s3cret value"

# a comment
REDIS_PASSWORD=abc123
STRIPE_SECRET=sk_live_x
EMPTY_SECRET=
`
	out := MaskEnvSecrets(in)

	for _, kept := range []string{
		"APP_NAME=siaarta24",
		"DB_CONNECTION=pgsql",
		"DB_DATABASE=app_siaarta24",
		"DB_USERNAME=suprion7",
		"DB_PORT=5432",
		"# a comment",
	} {
		if !strings.Contains(out, kept) {
			t.Errorf("masking changed %q\n---\n%s", kept, out)
		}
	}
	for _, secret := range []string{
		"base64:X8n49f03jfa94klsm49v02kflasjfo32=",
		"s3cret value",
		"abc123",
		"sk_live_x",
	} {
		if strings.Contains(out, secret) {
			t.Errorf("a secret leaked through masking: %q\n---\n%s", secret, out)
		}
	}
	for _, want := range []string{"APP_KEY=********", "DB_PASSWORD=********", "REDIS_PASSWORD=********", "STRIPE_SECRET=********"} {
		if !strings.Contains(out, want) {
			t.Errorf("masked file is missing %q\n---\n%s", want, out)
		}
	}
	if strings.Count(out, "\n") != strings.Count(in, "\n") {
		t.Error("masking must not change the number of lines")
	}
}

func TestMaskEnvSecretsKeepsQuotesOutOfTheMask(t *testing.T) {
	out := MaskEnvSecrets(`DB_PASSWORD='quoted'
export API_TOKEN=abc
`)
	if !strings.Contains(out, "DB_PASSWORD=********") || !strings.Contains(out, "export API_TOKEN=********") {
		t.Errorf("unexpected masking:\n%s", out)
	}
}
