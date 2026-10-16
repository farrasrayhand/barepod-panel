package dbengine

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// DefaultRedisPort is the standard port every per-app Redis instance listens on.
// Instances are distinguished by their loopback address (127.0.0.x) and /etc/hosts
// hostname (redis-<site>), never by non-standard port numbers.
const DefaultRedisPort = 6379

// DefaultRedisMaxMemoryMB is the per-instance memory ceiling when none was specified,
// keeping an individual cache lightweight and bounded on small hosts.
const DefaultRedisMaxMemoryMB = 64

// RedisInstanceSpec describes one isolated, loopback-only Redis cache instance.
type RedisInstanceSpec struct {
	Name        string
	Hostname    string
	BindIP      string
	Port        int
	User        string
	Secret      string
	MaxMemoryMB int
	StateDir    string
	Suspended   bool
}

// RedisInstanceHostname returns the canonical /etc/hosts name ("redis-<slug>") for a
// website slug or cache identifier.
func RedisInstanceHostname(slugOrName string) string {
	cleaned := strings.ToLower(strings.TrimSpace(slugOrName))
	cleaned = strings.TrimPrefix(cleaned, "redis-")
	cleaned = strings.TrimPrefix(cleaned, "redis_")
	var b strings.Builder
	lastDash := false
	for _, r := range cleaned {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash && b.Len() > 0 {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	res := strings.Trim(b.String(), "-")
	if res == "" {
		res = "cache"
	}
	if len(res) > 48 {
		res = strings.Trim(res[:48], "-")
	}
	return "redis-" + res
}

// NextRedisLoopbackIP picks the lowest unused loopback alias in 127.0.0.2..127.0.0.254
// (skipping .1 which belongs to the host's default loopback and .53/.54 which belong to
// systemd-resolved), spilling into 127.0.1.2..127.0.1.254 when needed.
func NextRedisLoopbackIP(used []string) string {
	taken := make(map[string]bool, len(used))
	for _, raw := range used {
		ip := strings.TrimSpace(raw)
		if ip != "" {
			taken[ip] = true
		}
	}
	for third := 0; third <= 15; third++ {
		for fourth := 2; fourth <= 254; fourth++ {
			if third == 0 && (fourth == 53 || fourth == 54) {
				continue
			}
			candidate := fmt.Sprintf("127.0.%d.%d", third, fourth)
			if !taken[candidate] {
				return candidate
			}
		}
	}
	return "127.0.16.2"
}

// IsDedicatedLoopbackIP reports whether addr is a per-instance 127.x.y.z loopback alias
// distinct from 127.0.0.1.
func IsDedicatedLoopbackIP(addr string) bool {
	ip := net.ParseIP(strings.TrimSpace(addr))
	if ip == nil {
		return false
	}
	v4 := ip.To4()
	if v4 == nil || v4[0] != 127 {
		return false
	}
	return !(v4[1] == 0 && v4[2] == 0 && v4[3] == 1)
}

// RedisInstanceConfig renders a minimal, ultra-lightweight redis-server configuration
// bound strictly to its loopback alias on port 6379 with disk persistence disabled
// (--save "" --appendonly no), a single database index, and a bounded LRU memory cap.
func RedisInstanceConfig(spec RedisInstanceSpec) string {
	bindIP := strings.TrimSpace(spec.BindIP)
	if bindIP == "" {
		bindIP = "127.0.0.2"
	}
	port := spec.Port
	if port <= 0 {
		port = DefaultRedisPort
	}
	memMB := spec.MaxMemoryMB
	if memMB <= 0 {
		memMB = DefaultRedisMaxMemoryMB
	}
	stateDir := strings.TrimSpace(spec.StateDir)
	if stateDir == "" {
		stateDir = "/var/lib/barepod/redis"
	}
	name := slugifyInstanceName(spec.Name)
	if name == "" {
		name = strings.TrimPrefix(RedisInstanceHostname(spec.Hostname), "redis-")
	}
	pidFile := filepath.Join(stateDir, name+".pid")
	logFile := filepath.Join(stateDir, name+".log")

	userState := "on"
	if spec.Suspended {
		userState = "off"
	}
	appRules := strings.Join(RedisAppRules("*"), " ")

	lines := []string{
		"# Managed by BarePod Panel — per-app lightweight Redis cache (" + name + ")",
		"bind " + bindIP,
		"port " + strconv.Itoa(port),
		"protected-mode yes",
		"tcp-backlog 128",
		"timeout 0",
		"tcp-keepalive 60",
		"daemonize yes",
		"supervised auto",
		"pidfile " + pidFile,
		"loglevel notice",
		"logfile " + logFile,
		"dir " + stateDir,
		"databases 1",
		"hz 10",
		"dynamic-hz yes",
		`save ""`,
		"appendonly no",
		"stop-writes-on-bgsave-error no",
		"jemalloc-bg-thread no",
		fmt.Sprintf("maxmemory %dmb", memMB),
		"maxmemory-policy allkeys-lru",
	}
	if spec.Secret != "" {
		quotedSecret := quoteRedisConfigToken(spec.Secret)
		lines = append(lines,
			"requirepass "+quotedSecret,
			fmt.Sprintf("user default %s >%s ~* &* +@all", userState, spec.Secret),
		)
		if spec.User != "" && spec.User != "default" {
			lines = append(lines,
				fmt.Sprintf("user %s %s >%s %s", spec.User, userState, spec.Secret, appRules),
			)
		}
	}
	return strings.Join(lines, "\n") + "\n"
}

func quoteRedisConfigToken(v string) string {
	escaped := strings.ReplaceAll(v, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `"`, `\"`)
	return `"` + escaped + `"`
}

func slugifyInstanceName(v string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(v)) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// UpsertRedisHostLine inserts or updates a `# barepod-cache <tag>` mapping in /etc/hosts content.
func UpsertRedisHostLine(existing, ip, hostname, tag string) string {
	ip = strings.TrimSpace(ip)
	hostname = strings.TrimSpace(hostname)
	tag = strings.TrimSpace(tag)
	if ip == "" || hostname == "" {
		return existing
	}
	marker := "# barepod-cache"
	if tag != "" {
		marker += " " + tag
	}
	newLine := fmt.Sprintf("%s\t%s\t%s", ip, hostname, marker)

	var kept []string
	replaced := false
	for _, line := range strings.Split(strings.TrimRight(existing, "\n"), "\n") {
		if line == "" && len(kept) == 0 && strings.TrimSpace(existing) == "" {
			continue
		}
		if matchesRedisHostLine(line, hostname, tag) {
			if !replaced {
				kept = append(kept, newLine)
				replaced = true
			}
			continue
		}
		kept = append(kept, line)
	}
	if !replaced {
		kept = append(kept, newLine)
	}
	return strings.Join(kept, "\n") + "\n"
}

// RemoveRedisHostLine removes any `# barepod-cache` line matching hostname or tag.
func RemoveRedisHostLine(existing, hostname, tag string) string {
	hostname = strings.TrimSpace(hostname)
	tag = strings.TrimSpace(tag)
	var kept []string
	for _, line := range strings.Split(strings.TrimRight(existing, "\n"), "\n") {
		if matchesRedisHostLine(line, hostname, tag) {
			continue
		}
		kept = append(kept, line)
	}
	if len(kept) == 0 {
		return ""
	}
	return strings.Join(kept, "\n") + "\n"
}

// LookupRedisHostIP extracts the loopback IP for a given hostname or tag from /etc/hosts content,
// and also lists all loopback IPs currently assigned to `# barepod-cache` entries.
func LookupRedisHostIP(existing, hostname, tag string) (foundIP string, usedIPs []string) {
	hostname = strings.TrimSpace(hostname)
	tag = strings.TrimSpace(tag)
	for _, line := range strings.Split(existing, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) < 2 {
			continue
		}
		ip := fields[0]
		if strings.Contains(trimmed, "# barepod-cache") || strings.HasPrefix(fields[1], "redis-") {
			usedIPs = append(usedIPs, ip)
		}
		if matchesRedisHostLine(line, hostname, tag) && foundIP == "" {
			foundIP = ip
		}
	}
	return foundIP, usedIPs
}

func matchesRedisHostLine(line, hostname, tag string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return false
	}
	if tag != "" && strings.Contains(trimmed, "# barepod-cache "+tag) {
		return true
	}
	if hostname == "" {
		return false
	}
	fields := strings.Fields(trimmed)
	if len(fields) < 2 {
		return false
	}
	for _, f := range fields[1:] {
		if strings.HasPrefix(f, "#") {
			break
		}
		if strings.EqualFold(f, hostname) {
			return true
		}
	}
	return false
}

// SyncRedisEtcHosts ensures /etc/hosts maps hostname -> ip for tag.
func SyncRedisEtcHosts(hostsPath, ip, hostname, tag string) error {
	if hostsPath == "" {
		hostsPath = "/etc/hosts"
	}
	raw, err := os.ReadFile(hostsPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	updated := UpsertRedisHostLine(string(raw), ip, hostname, tag)
	if updated == string(raw) {
		return nil
	}
	return os.WriteFile(hostsPath, []byte(updated), 0o644)
}

// RemoveRedisEtcHosts removes a cache's mapping from /etc/hosts.
func RemoveRedisEtcHosts(hostsPath, hostname, tag string) error {
	if hostsPath == "" {
		hostsPath = "/etc/hosts"
	}
	raw, err := os.ReadFile(hostsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	updated := RemoveRedisHostLine(string(raw), hostname, tag)
	if updated == string(raw) {
		return nil
	}
	return os.WriteFile(hostsPath, []byte(updated), 0o644)
}

// FormatRedisCacheURL builds the canonical CACHE_URL for an application's .env.
func FormatRedisCacheURL(user, password, host string, port int) string {
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = DefaultRedisPort
	}
	u := &url.URL{
		Scheme: "redis",
		Host:   net.JoinHostPort(host, strconv.Itoa(port)),
	}
	if user != "" || password != "" {
		u.User = url.UserPassword(user, password)
	}
	return u.String()
}

// AlignRedisEnvContent rewrites CACHE_URL, REDIS_HOST, REDIS_PORT, REDIS_USERNAME, and
// REDIS_PASSWORD in place inside an existing .env file's content, preserving comments,
// ordering, and every unrelated key.
func AlignRedisEnvContent(existing, host string, port int, user, password string) (string, bool) {
	if host == "" {
		host = "127.0.0.1"
	}
	if port <= 0 {
		port = DefaultRedisPort
	}
	updates := map[string]string{
		"CACHE_URL":      FormatRedisCacheURL(user, password, host, port),
		"REDIS_HOST":     host,
		"REDIS_PORT":     strconv.Itoa(port),
		"REDIS_USERNAME": user,
		"REDIS_PASSWORD": password,
	}
	order := []string{"CACHE_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_USERNAME", "REDIS_PASSWORD"}
	seen := map[string]bool{}
	changed := false

	rawLines := strings.Split(strings.TrimRight(existing, "\n"), "\n")
	if strings.TrimSpace(existing) == "" {
		rawLines = nil
	}
	out := make([]string, 0, len(rawLines)+len(order))
	for _, line := range rawLines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			out = append(out, line)
			continue
		}
		key, _, ok := strings.Cut(trimmed, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			out = append(out, line)
			continue
		}
		if desired, match := updates[key]; match {
			seen[key] = true
			replacement := key + "=" + formatEnvValue(desired)
			if line != replacement {
				changed = true
			}
			out = append(out, replacement)
			continue
		}
		out = append(out, line)
	}
	for _, key := range order {
		if !seen[key] {
			out = append(out, key+"="+formatEnvValue(updates[key]))
			changed = true
		}
	}
	result := strings.Join(out, "\n") + "\n"
	return result, changed
}

// AlignRedisEnvFile updates a website's .env file in place with the cache's host, port,
// username, and password, preserving its existing file mode and ownership.
func AlignRedisEnvFile(envPath, host string, port int, user, password string) (bool, error) {
	info, err := os.Stat(envPath)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	raw, err := os.ReadFile(envPath)
	if err != nil {
		return false, err
	}
	updated, changed := AlignRedisEnvContent(string(raw), host, port, user, password)
	if !changed {
		return false, nil
	}
	mode := info.Mode().Perm()
	if mode == 0 {
		mode = 0o600
	}
	if err := os.WriteFile(envPath, []byte(updated), mode); err != nil {
		return false, err
	}
	return true, nil
}

func formatEnvValue(v string) string {
	if strings.ContainsAny(v, " \t#\"'") {
		escaped := strings.ReplaceAll(v, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `"`, `\"`)
		return `"` + escaped + `"`
	}
	return v
}
