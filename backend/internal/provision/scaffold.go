// Package provision maps a runtime/framework to the commands that download,
// build and start it. The values are intentionally conservative: they are the
// documented upstream commands, not panel-specific magic.
package provision

import (
	"fmt"
	"strconv"
	"strings"
)

// Scaffold returns the command that downloads/scaffolds a framework into the
// current directory. It returns nil for "bring your own code".
func Scaffold(framework, version string) []string {
	switch strings.ToLower(framework) {
	case "laravel":
		if version == "" {
			version = "12"
		}
		// The version belongs to the framework, not to the PHP runtime.
		return []string{"composer", "create-project", "laravel/laravel:" + version, "."}
	case "symfony":
		return []string{"composer", "create-project", "symfony/skeleton", "."}
	case "wordpress":
		return []string{"wp", "core", "download", "--locale=en_US"}
	case "codeigniter":
		return []string{"composer", "create-project", "codeigniter4/appstarter", "."}
	case "cakephp":
		return []string{"composer", "create-project", "cakephp/app", "."}
	case "nextjs":
		return []string{"npx", "create-next-app@latest", ".", "--ts", "--eslint", "--app", "--yes"}
	case "nuxt":
		return []string{"npx", "nuxi@latest", "init", ".", "--packageManager", "npm", "--no-install"}
	case "astro":
		return []string{"npx", "create-astro@latest", ".", "--no-install", "--no-git", "--yes"}
	case "nestjs":
		return []string{"npx", "@nestjs/cli@latest", "new", ".", "--package-manager", "npm", "--skip-git"}
	case "express":
		return []string{"npm", "init", "-y"}
	case "django":
		return []string{"python3", "-m", "venv", ".venv"}
	case "flask", "fastapi":
		return []string{"python3", "-m", "venv", ".venv"}
	case "rails":
		return []string{"rails", "new", ".", "--skip-bundle"}
	case "go", "gin", "fiber":
		return []string{"go", "mod", "init", "app"}
	case "rust", "actix", "axum":
		return []string{"cargo", "init", "--name", "app"}
	default:
		return nil
	}
}

// PostScaffold returns the follow-up commands a scaffold needs.
func PostScaffold(framework string) [][]string {
	switch strings.ToLower(framework) {
	case "django":
		return [][]string{{"./.venv/bin/pip", "install", "django", "gunicorn"}}
	case "flask":
		return [][]string{{"./.venv/bin/pip", "install", "flask", "gunicorn"}}
	case "fastapi":
		return [][]string{{"./.venv/bin/pip", "install", "fastapi", "uvicorn"}}
	case "wordpress":
		return [][]string{{"wp", "config", "create", "--dbname=wordpress", "--skip-check"}, {"wp", "core", "install", "--skip-email"}}
	case "laravel", "symfony", "codeigniter", "cakephp":
		return [][]string{{"composer", "install", "--no-interaction"}}
	default:
		return nil
	}
}

// DefaultPort is the conventional listen port of a runtime.
func DefaultPort(runtime string) int {
	switch strings.ToLower(runtime) {
	case "php":
		return 8001
	case "nodejs":
		return 3000
	case "python":
		return 8000
	case "go":
		return 8080
	case "ruby":
		return 9292
	case "rust":
		return 8000
	case "static":
		return 80
	default:
		return 8080
	}
}

// ExecStart returns the command a systemd unit runs for this website.
// PHP uses a per-site FPM master, everything else runs the app server directly.
func ExecStart(runtime, version, framework, workDir string, port int) []string {
	p := strconv.Itoa(port)
	switch strings.ToLower(runtime) {
	case "php":
		// One FPM master per website keeps pools isolated per tenant.
		return []string{"/usr/sbin/php-fpm" + fpmSuffix(version), "--nodaemonize", "--fpm-config", workDir + "/php-fpm.conf"}
	case "nodejs":
		return []string{"npm", "start", "--", "--port", p}
	case "python":
		return []string{workDir + "/.venv/bin/gunicorn", "-b", "127.0.0.1:" + p, "--workers", "2", "app:app"}
	case "go":
		return []string{workDir + "/bin/app"}
	case "ruby":
		return []string{"bundle", "exec", "puma", "-p", p}
	case "rust":
		return []string{workDir + "/target/release/app"}
	case "static":
		// Static sites are served by the web server; the unit only owns the docroot.
		return []string{"/bin/true"}
	default:
		return []string{"/bin/true"}
	}
}

func fpmSuffix(version string) string {
	v := strings.ReplaceAll(version, ".", "")
	if v == "" {
		return ""
	}
	return v
}

// EnvFileLines renders the .env body for a website.
func EnvFileLines(slug, domain string, port int, extra map[string]string) map[string]string {
	env := map[string]string{
		"APP_NAME":   slug,
		"APP_ENV":    "production",
		"APP_DOMAIN": domain,
		"APP_URL":    "https://" + domain,
		"APP_DEBUG":  "false",
		"PORT":       strconv.Itoa(port),
	}
	for k, v := range extra {
		env[k] = v
	}
	return env
}

// DatabaseURL renders a connection string for the supported engines.
func DatabaseURL(engine, user, password, name, host string, port int, sqlitePath string) string {
	switch strings.ToLower(engine) {
	case "sqlite":
		return "sqlite:///" + sqlitePath
	case "postgres", "postgresql":
		return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=prefer", user, password, host, port, name)
	case "mysql", "mariadb":
		return fmt.Sprintf("mysql://%s:%s@%s:%d/%s", user, password, host, port, name)
	case "mongodb":
		return fmt.Sprintf("mongodb://%s:%s@%s:%d/%s?authSource=admin", user, password, host, port, name)
	case "redis":
		return fmt.Sprintf("redis://%s:%s@%s:%d/0", user, password, host, port)
	default:
		return ""
	}
}

// DefaultDBPort is the conventional port of an engine.
func DefaultDBPort(engine string) int {
	switch strings.ToLower(engine) {
	case "postgres", "postgresql":
		return 5432
	case "mysql", "mariadb":
		return 3306
	case "mongodb":
		return 27017
	case "redis":
		return 6379
	default:
		return 0
	}
}
