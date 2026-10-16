package dbengine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRedisInstanceHostnameAndLoopbackAllocator(t *testing.T) {
	if got := RedisInstanceHostname("toko_kita"); got != "redis-toko-kita" {
		t.Errorf("RedisInstanceHostname(toko_kita) = %q, want redis-toko-kita", got)
	}
	if got := RedisInstanceHostname("redis-demo-app"); got != "redis-demo-app" {
		t.Errorf("RedisInstanceHostname(redis-demo-app) = %q, want redis-demo-app", got)
	}

	first := NextRedisLoopbackIP(nil)
	if first != "127.0.0.2" {
		t.Fatalf("first loopback IP = %q, want 127.0.0.2", first)
	}
	if !IsDedicatedLoopbackIP(first) || IsDedicatedLoopbackIP("127.0.0.1") {
		t.Errorf("IsDedicatedLoopbackIP check wrong for %q", first)
	}

	// Ensure .53 and .54 (systemd-resolved stub listeners) are skipped.
	var used []string
	for i := 2; i <= 52; i++ {
		used = append(used, "127.0.0."+strings.TrimSpace(string(rune('0'+i/10)))+string(rune('0'+i%10)))
	}
	// Simpler explicit check around 52 -> 55:
	used52 := make([]string, 0, 51)
	for i := 2; i <= 52; i++ {
		used52 = append(used52, "127.0.0."+itoa(i))
	}
	if got := NextRedisLoopbackIP(used52); got != "127.0.0.55" {
		t.Errorf("expected allocator to skip .53 and .54, got %q", got)
	}
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

func TestRedisInstanceConfigIsLoopbackDisklessAndMemoryBounded(t *testing.T) {
	cfg := RedisInstanceConfig(RedisInstanceSpec{
		Name:        "admin_shop",
		Hostname:    "redis-shop",
		BindIP:      "127.0.0.2",
		Port:        6379,
		User:        "admin_shop",
		Secret:      "s3cret-pass",
		MaxMemoryMB: 96,
		StateDir:    "/var/lib/barepod/redis",
	})
	for _, want := range []string{
		"bind 127.0.0.2",
		"port 6379",
		`save ""`,
		"appendonly no",
		"databases 1",
		"maxmemory 96mb",
		"maxmemory-policy allkeys-lru",
		`requirepass "s3cret-pass"`,
		"user admin_shop on >s3cret-pass ~*",
		"-flushall",
		"-config",
		"-acl",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("RedisInstanceConfig missing %q:\n%s", want, cfg)
		}
	}
}

func TestUpsertAndRemoveRedisHostLine(t *testing.T) {
	base := "127.0.0.1\tlocalhost\n"
	withFirst := UpsertRedisHostLine(base, "127.0.0.2", "redis-shop", "01HAAA")
	if !strings.Contains(withFirst, "127.0.0.2\tredis-shop\t# barepod-cache 01HAAA") {
		t.Fatalf("missing host entry:\n%s", withFirst)
	}
	// Updating the same tag replaces in place rather than duplicating.
	updated := UpsertRedisHostLine(withFirst, "127.0.0.3", "redis-shop", "01HAAA")
	if strings.Count(updated, "redis-shop") != 1 || !strings.Contains(updated, "127.0.0.3") {
		t.Fatalf("duplicate or stale entry:\n%s", updated)
	}
	ip, used := LookupRedisHostIP(updated, "redis-shop", "01HAAA")
	if ip != "127.0.0.3" || len(used) != 1 || used[0] != "127.0.0.3" {
		t.Errorf("LookupRedisHostIP = (%q, %v)", ip, used)
	}
	cleaned := RemoveRedisHostLine(updated, "redis-shop", "01HAAA")
	if strings.Contains(cleaned, "redis-shop") || !strings.Contains(cleaned, "localhost") {
		t.Errorf("RemoveRedisHostLine left stale entry or removed localhost:\n%s", cleaned)
	}
}

func TestAlignRedisEnvFileRewritesCacheKeysInPlace(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	initial := strings.Join([]string{
		"# App settings",
		"APP_NAME=shop",
		"APP_KEY=base64:keep-me-untouched",
		"REDIS_HOST=127.0.0.1",
		"REDIS_PORT=6379",
		"REDIS_USERNAME=old_user",
		"REDIS_PASSWORD=old_pass",
		"CACHE_URL=redis://old_user:old_pass@127.0.0.1:6379",
		"CUSTOM_FLAG=true",
	}, "\n") + "\n"
	if err := os.WriteFile(envPath, []byte(initial), 0o600); err != nil {
		t.Fatal(err)
	}

	changed, err := AlignRedisEnvFile(envPath, "redis-shop", 6379, "admin_shop", "new_s3cret_pass")
	if err != nil {
		t.Fatalf("AlignRedisEnvFile: %v", err)
	}
	if !changed {
		t.Fatal("expected AlignRedisEnvFile to report changed=true")
	}

	raw, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	for _, want := range []string{
		"# App settings",
		"APP_KEY=base64:keep-me-untouched",
		"CUSTOM_FLAG=true",
		"REDIS_HOST=redis-shop",
		"REDIS_PORT=6379",
		"REDIS_USERNAME=admin_shop",
		"REDIS_PASSWORD=new_s3cret_pass",
		"CACHE_URL=redis://admin_shop:new_s3cret_pass@redis-shop:6379",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("aligned .env is missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "old_pass") {
		t.Errorf("aligned .env still contains old password:\n%s", got)
	}
}
