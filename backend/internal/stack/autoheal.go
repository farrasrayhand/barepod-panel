package stack

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
)

// AutoHeal inspects core host database and web engine services. It repairs common
// post-reboot failures (stale pid lockfiles, incompatible configs from upgrades,
// network bind race conditions) and ensures auto-start (systemctl enable) is active.
func AutoHeal(ctx context.Context, runner host.Runner) []string {
	var actions []string

	// 1. MariaDB / MySQL Auto-Heal
	if isBinaryInstalled("mariadb") || isBinaryInstalled("mysqld") {
		// Ensure systemctl enable
		_, _ = runner.Run(ctx, "", "systemctl", "enable", "mariadb")

		// Heal incompatible provider configs if running MariaDB 10.x
		providerFiles, _ := filepath.Glob("/etc/mysql/mariadb.conf.d/provider_*.cnf")
		if len(providerFiles) > 0 {
			verOut, _ := runner.Run(ctx, "", "mariadb", "--version")
			if strings.Contains(verOut, "10.") {
				_ = os.MkdirAll("/etc/mysql/mariadb.conf.d/disabled_providers", 0755)
				for _, f := range providerFiles {
					dest := filepath.Join("/etc/mysql/mariadb.conf.d/disabled_providers", filepath.Base(f))
					_ = os.Rename(f, dest)
					actions = append(actions, fmt.Sprintf("mariadb: isolated incompatible config %s", filepath.Base(f)))
				}
			}
		}

		// Check status
		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "mariadb")
		if strings.TrimSpace(activeOut) != "active" {
			// Clean stale pid if process is dead
			_ = os.Remove("/var/run/mysqld/mysqld.pid")
			_ = os.Remove("/run/mysqld/mysqld.pid")
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "mariadb")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "mariadb")
			actions = append(actions, "mariadb: repaired & restarted service")
		}
	}

	// 2. Redis Auto-Heal
	if isBinaryInstalled("redis-server") {
		_, _ = runner.Run(ctx, "", "systemctl", "enable", "redis-server")

		// Fix unsafe bind IP that crashes before docker0 network interface is up
		confPath := "/etc/redis/redis.conf"
		if data, err := os.ReadFile(confPath); err == nil {
			content := string(data)
			if strings.Contains(content, "172.17.0.1") {
				fixed := strings.ReplaceAll(content, "bind 127.0.0.1 -::1 172.17.0.1", "bind 0.0.0.0")
				fixed = strings.ReplaceAll(fixed, "172.17.0.1", "")
				if err := os.WriteFile(confPath, []byte(fixed), 0644); err == nil {
					actions = append(actions, "redis: corrected network bind configuration")
				}
			}
		}

		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "redis-server")
		if strings.TrimSpace(activeOut) != "active" {
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "redis-server")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "redis-server")
			actions = append(actions, "redis: restarted service")
		}
	}

	// 3. PostgreSQL Auto-Heal
	if isBinaryInstalled("psql") || isDir("/etc/postgresql") {
		_, _ = runner.Run(ctx, "", "systemctl", "enable", "postgresql")
		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "postgresql")
		if strings.TrimSpace(activeOut) != "active" {
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "postgresql")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "postgresql")
			actions = append(actions, "postgresql: restarted service")
		}
	}

	// 4. Web Servers (Nginx, Caddy, Apache2, OpenLiteSpeed)
	webServices := []string{"nginx", "caddy", "apache2", "lshttpd"}
	for _, unit := range webServices {
		if isServiceInstalled(ctx, runner, unit) {
			_, _ = runner.Run(ctx, "", "systemctl", "enable", unit)
		}
	}

	// 5. MongoDB Container Auto-Heal (if container was provisioned)
	if isBinaryInstalled("docker") {
		inspectOut, err := runner.Run(ctx, "", "docker", "inspect", "-f", "{{.State.Running}}", "barepod-mongo")
		if err == nil && strings.TrimSpace(inspectOut) == "false" {
			_, _ = runner.Run(ctx, "", "docker", "start", "barepod-mongo")
			actions = append(actions, "mongodb: restarted barepod-mongo container")
		}
	}

	return actions
}

// StartAutoHealWatchdog launches a background watchdog goroutine that periodically
// checks and heals crashed database engines and services.
func StartAutoHealWatchdog(ctx context.Context, runner host.Runner, interval time.Duration) {
	go func() {
		// Run initial auto-heal after daemon boot
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
			actions := AutoHeal(ctx, runner)
			for _, act := range actions {
				log.Printf("[auto-heal] %s", act)
			}
		}

		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				actions := AutoHeal(ctx, runner)
				for _, act := range actions {
					log.Printf("[watchdog auto-heal] %s", act)
				}
			}
		}
	}()
}

func isBinaryInstalled(name string) bool {
	paths := []string{"/usr/bin/" + name, "/usr/sbin/" + name, "/usr/local/bin/" + name}
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			return true
		}
	}
	return false
}

func isDir(path string) bool {
	fi, err := os.Stat(path)
	return err == nil && fi.IsDir()
}

func isServiceInstalled(ctx context.Context, runner host.Runner, unit string) bool {
	out, err := runner.Run(ctx, "", "systemctl", "status", unit)
	if err == nil {
		return true
	}
	return !strings.Contains(out, "could not be found") && !strings.Contains(out, "not found")
}
