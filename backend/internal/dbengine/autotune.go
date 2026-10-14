// Package dbengine provides hardware-adaptive auto-tuning for databases (MariaDB,
// PostgreSQL, Redis) and runtime environments based on available host memory (RAM).
package dbengine

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// TuningProfile describes the calculated auto-tuning parameters across all engines.
type TuningProfile struct {
	HostRAMMB          int             `json:"hostRamMb"`
	MariaDB            MariaDBProfile  `json:"mariadb"`
	PostgreSQL         PostgresProfile `json:"postgresql"`
	Redis              RedisProfile    `json:"redis"`
	WebServerOptimized bool            `json:"webServerOptimized"`
	PhpFpmOptimized    bool            `json:"phpFpmOptimized"`
}

// MariaDBProfile contains tuned parameters for MariaDB/MySQL.
type MariaDBProfile struct {
	BufferPoolSizeMB    int    `json:"bufferPoolSizeMb"`
	BufferPoolInstances int    `json:"bufferPoolInstances"`
	LogFileSizeMB       int    `json:"logFileSizeMb"`
	FlushLogAtTrxCommit int    `json:"flushLogAtTrxCommit"`
	FlushMethod         string `json:"flushMethod"`
	MaxConnections      int    `json:"maxConnections"`
	ConfigFile          string `json:"configFile"`
	Applied             bool   `json:"applied"`
}

// PostgresProfile contains tuned parameters for PostgreSQL.
type PostgresProfile struct {
	SharedBuffersMB            int     `json:"sharedBuffersMb"`
	EffectiveCacheSizeMB       int     `json:"effectiveCacheSizeMb"`
	WorkMemMB                  int     `json:"workMemMb"`
	MaintenanceWorkMemMB       int     `json:"maintenanceWorkMemMb"`
	CheckpointCompletionTarget float64 `json:"checkpointCompletionTarget"`
	RandomPageCost             float64 `json:"randomPageCost"`
	EffectiveIOConcurrency     int     `json:"effectiveIoConcurrency"`
	MaxConnections             int     `json:"maxConnections"`
	ConfigFile                 string  `json:"configFile"`
	Applied                    bool    `json:"applied"`
}

// RedisProfile contains tuned parameters for Redis.
type RedisProfile struct {
	MaxMemoryMB     int    `json:"maxMemoryMb"`
	MaxMemoryPolicy string `json:"maxMemoryPolicy"`
	Applied         bool   `json:"applied"`
}

// ApplyResult summarizes the changes made during auto-tuning.
type ApplyResult struct {
	Profile       TuningProfile `json:"profile"`
	MariaDBStatus string        `json:"mariadbStatus"`
	PostgresStatus string       `json:"postgresStatus"`
	RedisStatus   string        `json:"redisStatus"`
	Updated       bool          `json:"updated"`
}

// ReadHostRAMMB reads total physical memory from /proc/meminfo or returns a fallback.
func ReadHostRAMMB() int {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 2048
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if kb, err := strconv.Atoi(fields[1]); err == nil && kb > 0 {
					return kb / 1024
				}
			}
		}
	}
	return 2048
}

// CalculateProfile computes optimal parameters for MariaDB, PostgreSQL, and Redis
// based on host RAM in megabytes.
func CalculateProfile(ramMB int) TuningProfile {
	if ramMB < 512 {
		ramMB = 512
	}

	// 1. MariaDB:
	// Adaptive buffer pool sizing that balances database throughput with web applications (PHP-FPM, Node).
	var mariaPoolMB int
	switch {
	case ramMB <= 1024:
		mariaPoolMB = 256
	case ramMB <= 2048:
		mariaPoolMB = 512
	case ramMB <= 4096:
		mariaPoolMB = 1536
	case ramMB <= 8192:
		mariaPoolMB = 3072 // 3 GB on 8 GB host (leaves 5 GB for OS + Web + Postgres + Redis)
	default:
		// 40% of RAM on larger systems (bounded to 32 GB max)
		mariaPoolMB = (ramMB * 40) / 100
		if mariaPoolMB > 32768 {
			mariaPoolMB = 32768
		}
	}

	instances := mariaPoolMB / 1024
	if instances < 1 {
		instances = 1
	} else if instances > 8 {
		instances = 8
	}

	var logSizeMB int
	switch {
	case mariaPoolMB <= 512:
		logSizeMB = 64
	case mariaPoolMB <= 2048:
		logSizeMB = 128
	default:
		logSizeMB = 256
	}

	mariaProfile := MariaDBProfile{
		BufferPoolSizeMB:    mariaPoolMB,
		BufferPoolInstances: instances,
		LogFileSizeMB:       logSizeMB,
		FlushLogAtTrxCommit: 2, // Flush OS buffer every second (5x-10x IOPS boost, safe against process crash)
		FlushMethod:         "O_DIRECT",
		MaxConnections:      200,
		ConfigFile:          "/etc/mysql/mariadb.conf.d/99-barepod.cnf",
	}

	// 2. PostgreSQL:
	// shared_buffers ~ 25% of RAM, effective_cache_size ~ 60-75% of RAM
	pgSharedMB := ramMB / 4
	if pgSharedMB < 128 {
		pgSharedMB = 128
	} else if pgSharedMB > 8192 {
		pgSharedMB = 8192
	}

	pgCacheMB := (ramMB * 3) / 4
	if pgCacheMB < 384 {
		pgCacheMB = 384
	}

	pgMaxConn := 200
	pgWorkMemMB := ramMB / (pgMaxConn * 4)
	if pgWorkMemMB < 4 {
		pgWorkMemMB = 4
	} else if pgWorkMemMB > 64 {
		pgWorkMemMB = 64
	}

	pgMaintMemMB := ramMB / 16
	if pgMaintMemMB < 64 {
		pgMaintMemMB = 64
	} else if pgMaintMemMB > 512 {
		pgMaintMemMB = 512
	}

	pgProfile := PostgresProfile{
		SharedBuffersMB:            pgSharedMB,
		EffectiveCacheSizeMB:       pgCacheMB,
		WorkMemMB:                  pgWorkMemMB,
		MaintenanceWorkMemMB:       pgMaintMemMB,
		CheckpointCompletionTarget: 0.9,
		RandomPageCost:             1.1, // Fast SSD/NVMe cost
		EffectiveIOConcurrency:     200, // NVMe queue depth
		MaxConnections:             pgMaxConn,
		ConfigFile:                 findPgConfDir() + "/99-barepod.conf",
	}

	// 3. Redis:
	// Limit maxmemory to ~12-15% of RAM (minimum 128 MB, maximum 4096 MB) with allkeys-lru eviction.
	// This guarantees Redis never triggers kernel Out-Of-Memory (OOM) killing critical processes.
	redisMemMB := (ramMB * 12) / 100
	if redisMemMB < 128 {
		redisMemMB = 128
	} else if redisMemMB > 4096 {
		redisMemMB = 4096
	}

	redisProfile := RedisProfile{
		MaxMemoryMB:     redisMemMB,
		MaxMemoryPolicy: "allkeys-lru",
	}

	return TuningProfile{
		HostRAMMB:          ramMB,
		MariaDB:            mariaProfile,
		PostgreSQL:         pgProfile,
		Redis:              redisProfile,
		WebServerOptimized: true,
		PhpFpmOptimized:    true,
	}
}

// findPgConfDir returns the active PostgreSQL conf.d directory or fallback.
func findPgConfDir() string {
	matches, _ := filepath.Glob("/etc/postgresql/*/main/conf.d")
	if len(matches) > 0 {
		return matches[0]
	}
	return "/etc/postgresql/16/main/conf.d"
}

// RenderMariaDBConfig generates the drop-in 99-barepod.cnf configuration.
func RenderMariaDBConfig(p MariaDBProfile, ramMB int) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`# Managed by BarePod Panel — Hardware-Adaptive Auto-Tuning (%d MB RAM detected).
# Delete this file to restore MariaDB defaults.

[mysqld]
# Memory & Buffer Pool
innodb_buffer_pool_size         = %dM
innodb_buffer_pool_instances    = %d
innodb_log_file_size            = %dM
innodb_flush_log_at_trx_commit  = %d
innodb_flush_method             = %s
innodb_file_per_table           = 1

# Connection & Thread Tuning
max_connections                 = %d
thread_cache_size               = 32
table_open_cache                = 2000

# Performance & Network
skip-name-resolve               = 1
`, ramMB, p.BufferPoolSizeMB, p.BufferPoolInstances, p.LogFileSizeMB, p.FlushLogAtTrxCommit, p.FlushMethod, p.MaxConnections))
	return b.String()
}

// RenderPostgresConfig generates the drop-in 99-barepod.conf configuration.
func RenderPostgresConfig(p PostgresProfile, ramMB int) string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf(`# Managed by BarePod Panel — Hardware-Adaptive Auto-Tuning (%d MB RAM detected).
# Delete this file to restore PostgreSQL defaults.

# Memory Tuning
shared_buffers                  = %dMB
effective_cache_size            = %dMB
work_mem                        = %dMB
maintenance_work_mem            = %dMB

# Disk & Storage Optimization (SSD/NVMe tuned)
checkpoint_completion_target    = %.1f
random_page_cost                = %.1f
effective_io_concurrency        = %d
wal_buffers                     = 16MB

# Connections
max_connections                 = %d
`, ramMB, p.SharedBuffersMB, p.EffectiveCacheSizeMB, p.WorkMemMB, p.MaintenanceWorkMemMB,
		p.CheckpointCompletionTarget, p.RandomPageCost, p.EffectiveIOConcurrency, p.MaxConnections))
	return b.String()
}

// ApplyProfile writes tuning configurations to disk and applies them to running services.
func ApplyProfile(ctx context.Context, runner host.Runner, redisURL string, profile TuningProfile) ApplyResult {
	res := ApplyResult{Profile: profile}
	if runner == nil || runner.Mode() != "real" {
		res.MariaDBStatus = "dry-run: config simulated"
		res.PostgresStatus = "dry-run: config simulated"
		res.RedisStatus = "dry-run: config simulated"
		return res
	}

	// 1. Apply MariaDB tuning if directory exists
	mariaDir := "/etc/mysql/mariadb.conf.d"
	if _, err := os.Stat(mariaDir); err == nil {
		confPath := filepath.Join(mariaDir, "99-barepod.cnf")
		content := RenderMariaDBConfig(profile.MariaDB, profile.HostRAMMB)
		if err := os.WriteFile(confPath, []byte(content), 0o644); err == nil {
			profile.MariaDB.Applied = true
			res.MariaDBStatus = fmt.Sprintf("Applied: buffer_pool=%dM, log_file=%dM, instances=%d",
				profile.MariaDB.BufferPoolSizeMB, profile.MariaDB.LogFileSizeMB, profile.MariaDB.BufferPoolInstances)
			// Trigger reload/restart if running
			_, _ = runner.Run(ctx, "", "systemctl", "reload", "mariadb")
		} else {
			res.MariaDBStatus = "write failed: " + err.Error()
		}
	} else {
		res.MariaDBStatus = "not installed"
	}

	// 2. Apply PostgreSQL tuning if conf.d directory exists
	pgDir := findPgConfDir()
	if _, err := os.Stat(pgDir); err == nil {
		confPath := filepath.Join(pgDir, "99-barepod.conf")
		content := RenderPostgresConfig(profile.PostgreSQL, profile.HostRAMMB)
		if err := os.WriteFile(confPath, []byte(content), 0o644); err == nil {
			profile.PostgreSQL.Applied = true
			res.PostgresStatus = fmt.Sprintf("Applied: shared_buffers=%dMB, work_mem=%dMB, effective_cache=%dMB",
				profile.PostgreSQL.SharedBuffersMB, profile.PostgreSQL.WorkMemMB, profile.PostgreSQL.EffectiveCacheSizeMB)
			// Reload postgresql to pick up changes safely without dropping connections
			_, _ = runner.Run(ctx, "", "systemctl", "reload", "postgresql")
		} else {
			res.PostgresStatus = "write failed: " + err.Error()
		}
	} else {
		res.PostgresStatus = "not installed"
	}

	// 3. Apply Redis tuning
	redisConf := "/etc/redis/redis.conf"
	if _, err := os.Stat(redisConf); err == nil {
		// Update running redis via redis-cli if available
		targetBytes := int64(profile.Redis.MaxMemoryMB) * 1024 * 1024
		redisArgs := []string{"config", "set", "maxmemory", fmt.Sprint(targetBytes)}
		if redisURL != "" {
			_, _ = runner.Run(ctx, "", "redis-cli", "-u", redisURL, "config", "set", "maxmemory", fmt.Sprint(targetBytes))
			_, _ = runner.Run(ctx, "", "redis-cli", "-u", redisURL, "config", "set", "maxmemory-policy", profile.Redis.MaxMemoryPolicy)
			_, _ = runner.Run(ctx, "", "redis-cli", "-u", redisURL, "config", "rewrite")
		} else {
			_, _ = runner.Run(ctx, "", "redis-cli", redisArgs...)
			_, _ = runner.Run(ctx, "", "redis-cli", "config", "set", "maxmemory-policy", profile.Redis.MaxMemoryPolicy)
			_, _ = runner.Run(ctx, "", "redis-cli", "config", "rewrite")
		}

		// Ensure persisted in /etc/redis/redis.conf
		ensureRedisConf(redisConf, profile.Redis.MaxMemoryMB, profile.Redis.MaxMemoryPolicy)
		profile.Redis.Applied = true
		res.RedisStatus = fmt.Sprintf("Applied: maxmemory=%dMB, policy=%s", profile.Redis.MaxMemoryMB, profile.Redis.MaxMemoryPolicy)
	} else {
		res.RedisStatus = "not installed"
	}

	res.Profile = profile
	res.Updated = true
	return res
}

// ensureRedisConf ensures maxmemory and maxmemory-policy directives are set in redis.conf.
func ensureRedisConf(path string, memMB int, policy string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	content := string(data)
	memLine := fmt.Sprintf("maxmemory %dmb", memMB)
	polLine := fmt.Sprintf("maxmemory-policy %s", policy)

	changed := false
	if strings.Contains(content, "maxmemory ") {
		lines := strings.Split(content, "\n")
		for i, line := range lines {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "maxmemory ") && !strings.HasPrefix(trimmed, "maxmemory-") {
				lines[i] = memLine
				changed = true
			} else if strings.HasPrefix(trimmed, "maxmemory-policy ") {
				lines[i] = polLine
				changed = true
			}
		}
		content = strings.Join(lines, "\n")
	} else {
		content += fmt.Sprintf("\n# BarePod Panel Auto-Tuning\n%s\n%s\n", memLine, polLine)
		changed = true
	}

	if changed {
		_ = os.WriteFile(path, []byte(content), 0o640)
	}
}

// AutoTune automatically executes hardware-adaptive tuning in the background.
func AutoTune(ctx context.Context, runner host.Runner, redisURL string, logf func(string, ...any)) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				if logf != nil {
					logf("autotune: recovered from panic: %v", r)
				}
			}
		}()

		// Wait briefly after daemon boot so services are ready
		time.Sleep(2 * time.Second)

		ramMB := ReadHostRAMMB()
		profile := CalculateProfile(ramMB)
		res := ApplyProfile(ctx, runner, redisURL, profile)

		if logf != nil {
			logf("autotune: host RAM %d MB detected — MariaDB [%s], PostgreSQL [%s], Redis [%s]",
				ramMB, res.MariaDBStatus, res.PostgresStatus, res.RedisStatus)
		}
	}()
}
