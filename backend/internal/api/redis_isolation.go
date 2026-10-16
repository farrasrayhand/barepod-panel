package api

import (
	"context"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

// redisStateDir returns the directory where per-app Redis instance configs, PIDs, and
// logs live. In tests (where DbtoolsDir is inside t.TempDir()), it lives alongside
// DbtoolsDir; in production it lives at /var/lib/barepod/redis.
func (s *Server) redisStateDir() string {
	if s.cfg.DbtoolsDir != "" {
		return filepath.Join(filepath.Dir(s.cfg.DbtoolsDir), "redis")
	}
	return "/var/lib/barepod/redis"
}

func (s *Server) redisHostsPath() string {
	if s.host == nil || !s.host.Materialises() {
		return filepath.Join(s.redisStateDir(), "hosts")
	}
	return "/etc/hosts"
}

func (s *Server) redisInstanceLogPath(record *store.Database) string {
	if record == nil || record.Name == "" {
		return ""
	}
	return filepath.Join(s.redisStateDir(), record.Name+".log")
}

func (s *Server) redisInstanceConfPath(record *store.Database) string {
	if record == nil || record.Name == "" {
		return ""
	}
	return filepath.Join(s.redisStateDir(), record.Name+".conf")
}

func (s *Server) redisInstancePidPath(record *store.Database) string {
	if record == nil || record.Name == "" {
		return ""
	}
	return filepath.Join(s.redisStateDir(), record.Name+".pid")
}

// assignRedisIdentity determines the per-app hostname ("redis-<site>" or "redis-<alias>")
// and standard port (6379) for a Redis cache record.
func (s *Server) assignRedisIdentity(record *store.Database) (hostname string, bindIP string, port int) {
	baseName := record.WebsiteSlug
	if baseName == "" {
		baseName = record.Alias
	}
	if baseName == "" {
		baseName = record.Name
	}
	hostname = dbengine.RedisInstanceHostname(baseName)
	port = dbengine.DefaultRedisPort

	hostsPath := s.redisHostsPath()
	rawHosts, _ := os.ReadFile(hostsPath)
	foundIP, usedIPs := dbengine.LookupRedisHostIP(string(rawHosts), hostname, record.Name)
	if foundIP != "" {
		bindIP = foundIP
	} else {
		bindIP = dbengine.NextRedisLoopbackIP(usedIPs)
	}
	return hostname, bindIP, port
}

// resolveRedisConnectTarget resolves the IP/host a local client or health check should
// dial for a Redis cache record.
func (s *Server) resolveRedisConnectTarget(record *store.Database) (host string, port int) {
	port = record.Port
	if port <= 0 {
		port = dbengine.DefaultRedisPort
	}
	host = strings.TrimSpace(record.Host)
	if host == "" {
		if parsedHost, parsedPort, _, _, err := dbengine.ParseRedisURL(s.cfg.RedisURL); err == nil && parsedHost != "" {
			return parsedHost, parsedPort
		}
		return "127.0.0.1", port
	}
	if strings.HasPrefix(host, "redis-") {
		rawHosts, err := os.ReadFile(s.redisHostsPath())
		if err == nil {
			if ip, _ := dbengine.LookupRedisHostIP(string(rawHosts), host, record.Name); ip != "" {
				return ip, port
			}
		}
	}
	return host, port
}

// ensureRedisInstance materialises the per-app loopback alias, /etc/hosts entry, and
// lightweight diskless redis-server process (--save "" --appendonly no, maxmemory +
// allkeys-lru) when the host runner is in real mode.
func (s *Server) ensureRedisInstance(ctx context.Context, record *store.Database, password string, suspended bool) error {
	hostname, bindIP, port := s.assignRedisIdentity(record)
	if record.Host == "" || record.Host == "127.0.0.1" {
		record.Host = hostname
	}
	if record.Port <= 0 {
		record.Port = port
	}
	stateDir := s.redisStateDir()
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return err
	}
	_ = dbengine.SyncRedisEtcHosts(s.redisHostsPath(), bindIP, hostname, record.Name)

	confPath := s.redisInstanceConfPath(record)
	cfgContent := dbengine.RedisInstanceConfig(dbengine.RedisInstanceSpec{
		Name:        record.Name,
		Hostname:    hostname,
		BindIP:      bindIP,
		Port:        port,
		User:        record.User,
		Secret:      password,
		MaxMemoryMB: record.MaxMemoryMB,
		StateDir:    stateDir,
		Suspended:   suspended,
	})
	if err := os.WriteFile(confPath, []byte(cfgContent), 0o600); err != nil {
		return err
	}
	if !s.host.Materialises() {
		return nil
	}

	// Ensure the loopback alias exists on lo (Linux routes 127.0.0.0/8 on lo natively,
	// and adding the explicit /8 address is idempotent).
	_, _ = s.host.Run(ctx, []string{"ip", "addr", "add", bindIP + "/8", "dev", "lo"})

	if redisAddrListening(bindIP, port) {
		return s.reconfigureRunningRedisInstance(ctx, bindIP, port, record, password, suspended)
	}
	if out, err := s.host.Run(ctx, []string{"redis-server", confPath}); err != nil {
		return fmt.Errorf("starting per-app redis-server (%s on %s:%d) failed: %s",
			hostname, bindIP, port, strings.TrimSpace(out))
	}
	return nil
}

func (s *Server) reconfigureRunningRedisInstance(ctx context.Context, bindIP string, port int, record *store.Database, password string, suspended bool) error {
	memMB := record.MaxMemoryMB
	if memMB <= 0 {
		memMB = dbengine.DefaultRedisMaxMemoryMB
	}
	base := []string{"redis-cli", "-h", bindIP, "-p", strconv.Itoa(port)}
	if password != "" {
		base = append(base, "--no-auth-warning", "-a", password)
	}
	stateWord := "on"
	if suspended {
		stateWord = "off"
	}
	if record.User != "" && password != "" {
		rules := append([]string{"ACL", "SETUSER", record.User, "reset", stateWord, ">" + password}, dbengine.RedisAppRules("*")...)
		_, _ = s.host.Run(ctx, append(append([]string{}, base...), rules...))
	} else if record.User != "" {
		_, _ = s.host.Run(ctx, append(append([]string{}, base...), "ACL", "SETUSER", record.User, stateWord))
	}
	_, _ = s.host.Run(ctx, append(append([]string{}, base...), "CONFIG", "SET", "maxmemory", fmt.Sprintf("%dmb", memMB)))
	_, _ = s.host.Run(ctx, append(append([]string{}, base...), "CONFIG", "SET", "maxmemory-policy", "allkeys-lru"))
	return nil
}

// stopRedisInstance terminates a per-app Redis instance and removes its config and
// /etc/hosts entry on purge.
func (s *Server) stopRedisInstance(ctx context.Context, record *store.Database) {
	if record == nil || record.Engine != "redis" {
		return
	}
	closeRedisGatewayBridge(record.ID)
	confPath := s.redisInstanceConfPath(record)
	pidPath := s.redisInstancePidPath(record)
	if s.host != nil && s.host.Materialises() && confPath != "" {
		_, _ = s.host.Run(ctx, []string{"pkill", "-f", confPath})
	}
	if confPath != "" {
		_ = os.Remove(confPath)
	}
	if pidPath != "" {
		_ = os.Remove(pidPath)
	}
	_ = dbengine.RemoveRedisEtcHosts(s.redisHostsPath(), record.Host, record.Name)
}

// alignWebsiteRedisEnv rewrites CACHE_URL, REDIS_HOST, REDIS_PORT, REDIS_USERNAME, and
// REDIS_PASSWORD in place inside the linked website's .env file (without a full redeploy)
// and restarts the website's unit when running on a real host.
func (s *Server) alignWebsiteRedisEnv(ctx context.Context, record *store.Database, password string) (bool, error) {
	if record == nil || record.Engine != "redis" || strings.TrimSpace(record.WebsiteSlug) == "" {
		return false, nil
	}
	site, err := s.store.WebsiteBySlug(record.WebsiteSlug)
	if err != nil || site == nil {
		return false, nil
	}
	if record.PasswordCipher != "" {
		_ = s.store.PutWebsiteSecret(site.Slug, "cache_password", record.PasswordCipher)
	}
	siteDir := s.host.SitePath(site.TenantUser, site.Slug)
	envPath := filepath.Join(siteDir, ".env")
	host := record.Host
	if host == "" || host == "127.0.0.1" {
		host = dbengine.RedisInstanceHostname(site.Slug)
	}
	port := record.Port
	if port <= 0 {
		port = dbengine.DefaultRedisPort
	}
	user := record.User
	if user == "" {
		user = record.Name
	}
	changed, err := dbengine.AlignRedisEnvFile(envPath, host, port, user, password)
	if err != nil {
		return false, err
	}
	if changed && s.host.Materialises() {
		_, _ = s.host.Run(ctx, []string{"chown", site.TenantUser + ":" + site.TenantUser, envPath})
		// If a Laravel config cache file exists, remove it so the updated .env is read immediately.
		_ = os.Remove(filepath.Join(siteDir, "bootstrap", "cache", "config.php"))
		_, _ = s.host.Run(ctx, []string{"systemctl", "restart", "barepod-app@" + site.Slug + ".service"})
	}
	return changed, nil
}

func redisAddrListening(ip string, port int) bool {
	if ip == "" || port <= 0 {
		return false
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip, strconv.Itoa(port)), 250*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// reconcileRedisCaches runs at daemon startup to ensure every Redis cache record has its
// per-app hostname (redis-<site>), /etc/hosts loopback alias, running diskless redis-server
// instance, and aligned website .env file.
func (s *Server) reconcileRedisCaches() {
	if s.store == nil || s.host == nil || !s.host.Materialises() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	for _, binned := range []bool{false, true} {
		items, err := s.store.DatabasesForTenant(store.KindCache, "", binned)
		if err != nil {
			continue
		}
		for i := range items {
			rec := items[i]
			if rec.Engine != "redis" {
				continue
			}
			plain, err := secrets.Decrypt(s.key, rec.PasswordCipher)
			if err != nil {
				continue
			}
			hostname, _, port := s.assignRedisIdentity(&rec)
			if rec.Host == "" || rec.Host == "127.0.0.1" || rec.Port != port {
				_ = s.store.SetDatabaseAddress(rec.ID, hostname, port)
				rec.Host = hostname
				rec.Port = port
			}
			if err := s.ensureRedisInstance(ctx, &rec, plain, binned || rec.Status == "suspended"); err != nil {
				continue
			}
			if !binned {
				_, _ = s.alignWebsiteRedisEnv(ctx, &rec, plain)
			}
		}
	}
}

