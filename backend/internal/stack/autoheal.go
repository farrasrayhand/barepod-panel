package stack

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
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
	nginxInstalled := isBinaryInstalled("nginx") || isServiceInstalled(ctx, runner, "nginx")
	caddyInstalled := isBinaryInstalled("caddy") || isServiceInstalled(ctx, runner, "caddy")

	// Detect configured ingress. In BarePod, Nginx is default.
	// If Nginx sites use 8082, Caddy is the intended edge ingress.
	nginxIsBackend := false
	if nginxInstalled {
		grep8082, _ := runner.Run(ctx, "", "grep", "-rn", "8082", "/etc/nginx/sites-enabled/")
		if strings.TrimSpace(grep8082) != "" {
			nginxIsBackend = true
		}
	}
	caddyIsBackend := !nginxIsBackend && nginxInstalled

	if caddyInstalled {
		_, _ = runner.Run(ctx, "", "bash", "-c", "mkdir -p /var/log/caddy && chown -R caddy:caddy /var/log/caddy 2>/dev/null && chmod 755 /var/log/caddy && chmod 664 /var/log/caddy/*.log 2>/dev/null || true")
		_ = os.MkdirAll("/etc/caddy/sites", 0755)

		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "caddy")
		testOut, testErr := runner.Run(ctx, "", "caddy", "validate", "--config", "/etc/caddy/Caddyfile")
		caddyRunning := strings.TrimSpace(activeOut) == "active"

		if testErr != nil || strings.Contains(testOut, "error") || !caddyRunning {
			_ = webserver.WriteCaddyConfig("/etc/caddy/Caddyfile", "/etc/caddy/sites", caddyIsBackend)
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "caddy")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "caddy")
			actions = append(actions, "caddy: regenerated clean Caddyfile & restarted service")
		}
	}
	if nginxInstalled {
		_, _ = runner.Run(ctx, "", "bash", "-c", "mkdir -p /var/log/nginx && chown -R www-data:adm /var/log/nginx 2>/dev/null && chmod 755 /var/log/nginx && chmod 664 /var/log/nginx/*.log 2>/dev/null || true")

		// If Nginx is Edge Ingress, ensure all sites listen on 80/443 (not leftover 8082)
		if !nginxIsBackend {
			grepLeftover, _ := runner.Run(ctx, "", "grep", "-rn", "8082", "/etc/nginx/sites-enabled/")
			if strings.TrimSpace(grepLeftover) != "" {
				_, _ = runner.Run(ctx, "", "bash", "-c", "sed -i 's/8082/80/g' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* 2>/dev/null || true")
				_, _ = runner.Run(ctx, "", "systemctl", "reload", "nginx")
				actions = append(actions, "nginx: restored public ingress port 80/443")
			}
		}

		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "nginx")
		if strings.TrimSpace(activeOut) != "active" {
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "nginx")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "nginx")
			actions = append(actions, "nginx: repaired log permissions & restarted service")
		}
	}
	if isBinaryInstalled("apache2") || isServiceInstalled(ctx, runner, "apache2") {
		_, _ = runner.Run(ctx, "", "bash", "-c", "mkdir -p /var/log/apache2 && chown -R www-data:adm /var/log/apache2 2>/dev/null && chmod 755 /var/log/apache2 && chmod 664 /var/log/apache2/*.log 2>/dev/null || true")
		if _, err := os.Stat("/etc/apache2/ports.conf"); err == nil {
			_, _ = runner.Run(ctx, "", "bash", "-c", "sed -i 's/Listen 80$/Listen 127.0.0.1:8080/' /etc/apache2/ports.conf 2>/dev/null || true; sed -i 's/Listen 443$/Listen 127.0.0.1:8443/' /etc/apache2/ports.conf 2>/dev/null || true")
		}
		activeOut, _ := runner.Run(ctx, "", "systemctl", "is-active", "apache2")
		if strings.TrimSpace(activeOut) != "active" {
			_, _ = runner.Run(ctx, "", "systemctl", "reset-failed", "apache2")
			_, _ = runner.Run(ctx, "", "systemctl", "restart", "apache2")
			actions = append(actions, "apache2: ensured internal port 8080 & restarted service")
		}
	}
	if isBinaryInstalled("openlitespeed") || isServiceInstalled(ctx, runner, "lshttpd") {
		_, _ = runner.Run(ctx, "", "bash", "-c", "mkdir -p /usr/local/lsws/logs && chown -R nobody:nogroup /usr/local/lsws/logs 2>/dev/null && chmod 755 /usr/local/lsws/logs && chmod 664 /usr/local/lsws/logs/*.log 2>/dev/null || true")
	}

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

	// 6. Maintenance & Stopped Pages Auto-Refresh
	if n := webserver.SyncAllMaintenancePages(); n > 0 {
		actions = append(actions, fmt.Sprintf("maintenance: refreshed %d site pages to unified card theme", n))
	}

	// 7. DB Tools (phpMyAdmin, pgweb) Auto-Heal
	dbtoolsDir := "/var/lib/barepod/dbtools"
	if isBinaryInstalled("mariadb") || isBinaryInstalled("mysqld") || isBinaryInstalled("mysql") || isDir("/etc/mysql") {
		if err := dbtools.EnsurePhpMyAdmin(dbtoolsDir); err == nil {
			actions = append(actions, "dbtools: verified phpMyAdmin & php extensions")
		}
	}
	if isBinaryInstalled("psql") || isDir("/etc/postgresql") {
		if _, err := os.Stat("/usr/local/bin/pgweb"); err != nil {
			if err := dbtools.EnsurePgweb(); err == nil {
				actions = append(actions, "dbtools: auto-installed pgweb")
			}
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
