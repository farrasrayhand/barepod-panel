package validate

import "testing"

func TestHasRuntime(t *testing.T) {
	// A reverse proxy is a valid site type but runs no process of its own.
	for _, runtime := range []string{"php", "nodejs", "python", "go", "ruby", "rust", "static"} {
		if !HasRuntime(runtime) {
			t.Errorf("HasRuntime(%q) = false, want true", runtime)
		}
	}
	for _, runtime := range []string{"proxy", "PROXY", ""} {
		if HasRuntime(runtime) {
			t.Errorf("HasRuntime(%q) = true, want false", runtime)
		}
	}
}

func TestProxyIsAValidSiteType(t *testing.T) {
	if !Runtime("proxy") {
		t.Error("a reverse-proxy site type must pass validation")
	}
}
