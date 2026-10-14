package dbengine

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCalculateProfileAdaptsToRAM(t *testing.T) {
	tests := []struct {
		ramMB            int
		wantMariaPool    int
		wantPgShared     int
		wantRedisMem     int
	}{
		{ramMB: 1024, wantMariaPool: 256, wantPgShared: 256, wantRedisMem: 128},
		{ramMB: 2048, wantMariaPool: 512, wantPgShared: 512, wantRedisMem: 245},
		{ramMB: 4096, wantMariaPool: 1536, wantPgShared: 1024, wantRedisMem: 491},
		{ramMB: 8192, wantMariaPool: 3072, wantPgShared: 2048, wantRedisMem: 983},
		{ramMB: 16384, wantMariaPool: 6553, wantPgShared: 4096, wantRedisMem: 1966},
	}

	for _, tt := range tests {
		profile := CalculateProfile(tt.ramMB)
		if profile.MariaDB.BufferPoolSizeMB != tt.wantMariaPool {
			t.Errorf("RAM %dMB: MariaDB pool got %d, want %d", tt.ramMB, profile.MariaDB.BufferPoolSizeMB, tt.wantMariaPool)
		}
		if profile.PostgreSQL.SharedBuffersMB != tt.wantPgShared {
			t.Errorf("RAM %dMB: PostgreSQL shared_buffers got %d, want %d", tt.ramMB, profile.PostgreSQL.SharedBuffersMB, tt.wantPgShared)
		}
		if profile.Redis.MaxMemoryMB != tt.wantRedisMem {
			t.Errorf("RAM %dMB: Redis maxmemory got %d, want %d", tt.ramMB, profile.Redis.MaxMemoryMB, tt.wantRedisMem)
		}
		if profile.Redis.MaxMemoryPolicy != "allkeys-lru" {
			t.Errorf("expected allkeys-lru, got %s", profile.Redis.MaxMemoryPolicy)
		}
	}
}

func TestRenderMariaDBConfig(t *testing.T) {
	profile := CalculateProfile(8192)
	cfg := RenderMariaDBConfig(profile.MariaDB, 8192)

	for _, want := range []string{
		"innodb_buffer_pool_size         = 3072M",
		"innodb_buffer_pool_instances    = 3",
		"innodb_flush_log_at_trx_commit  = 2",
		"innodb_flush_method             = O_DIRECT",
		"skip-name-resolve               = 1",
		"max_connections                 = 200",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("missing %q in MariaDB config:\n%s", want, cfg)
		}
	}
}

func TestRenderPostgresConfig(t *testing.T) {
	profile := CalculateProfile(8192)
	cfg := RenderPostgresConfig(profile.PostgreSQL, 8192)

	for _, want := range []string{
		"shared_buffers                  = 2048MB",
		"effective_cache_size            = 6144MB",
		"work_mem                        = 10MB",
		"maintenance_work_mem            = 512MB",
		"checkpoint_completion_target    = 0.9",
		"random_page_cost                = 1.1",
		"effective_io_concurrency        = 200",
		"max_connections                 = 200",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("missing %q in Postgres config:\n%s", want, cfg)
		}
	}
}

func TestEnsureRedisConf(t *testing.T) {
	tmpDir := t.TempDir()
	confPath := filepath.Join(tmpDir, "redis.conf")

	initial := "port 6379\nbind 127.0.0.1\n"
	if err := os.WriteFile(confPath, []byte(initial), 0o644); err != nil {
		t.Fatal(err)
	}

	ensureRedisConf(confPath, 1024, "allkeys-lru")
	data, _ := os.ReadFile(confPath)
	content := string(data)

	if !strings.Contains(content, "maxmemory 1024mb") {
		t.Errorf("redis.conf missing maxmemory line: %s", content)
	}
	if !strings.Contains(content, "maxmemory-policy allkeys-lru") {
		t.Errorf("redis.conf missing maxmemory-policy line: %s", content)
	}

	// Re-run with updated size and ensure it updates cleanly in place
	ensureRedisConf(confPath, 2048, "volatile-lru")
	data, _ = os.ReadFile(confPath)
	content = string(data)

	if !strings.Contains(content, "maxmemory 2048mb") {
		t.Errorf("redis.conf not updated to 2048mb: %s", content)
	}
	if strings.Contains(content, "maxmemory 1024mb") {
		t.Errorf("redis.conf still contains old 1024mb: %s", content)
	}
	if !strings.Contains(content, "maxmemory-policy volatile-lru") {
		t.Errorf("redis.conf not updated to volatile-lru: %s", content)
	}
}
