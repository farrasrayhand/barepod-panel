// Package provision maps a runtime/framework to the commands that download,
// build and start it. The values are intentionally conservative: they are the
// documented upstream commands, not panel-specific magic.
package provision

import (
	"fmt"
	"html"
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

// DefaultPage is the placeholder a website starts with when its source is "default":
// a website can then exist and answer on its address before an application does. It is
// deliberately one self-contained file — the site type that serves a directory serves
// it as-is, with no runtime, no dependency and nothing to build.
func DefaultPage(slug, domain string) string {
	title := html.EscapeString(domain)
	if domain == "" {
		title = html.EscapeString(slug)
	}
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>` + title + `</title>
<style>
 :root{color-scheme:light}
 body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      background:#f8fafc;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center}
 .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:2rem 2.25rem;max-width:34rem;
       box-shadow:0 1px 3px rgba(15,23,42,.08)}
 h1{margin:0 0 .5rem;font-size:1.35rem}
 p{margin:.5rem 0;color:#475569}
 code{background:#f1f5f9;border-radius:6px;padding:.1rem .35rem;font-size:.9em}
 .dot{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;background:#22c55e;margin-right:.5rem}
</style></head><body>
 <main class="card">
  <h1><span class="dot"></span>` + title + `</h1>
  <p>This website is published. Its application has not been deployed yet — the panel wrote this page so the address answers something useful in the meantime.</p>
  <p>Deploy your code from the panel (Scaffold, GitHub, Upload or Existing files), or keep this site as a plain static page under <code>` + html.EscapeString(slug) + `</code>.</p>
 </main>
</body></html>
`
}

// StarterFiles returns the entrypoint a framework needs to actually run.
//
// Downloading a framework is not enough: `gunicorn app:app` fails if nothing
// defines `app`, so a preset that only installs packages would deploy a broken
// site. These files are only written when the target does not exist, so uploaded
// or cloned code is never clobbered.
func StarterFiles(framework string, port int) map[string]string {
	switch strings.ToLower(framework) {
	case "flask":
		return map[string]string{
			"app.py": `from flask import Flask

app = Flask(__name__)


@app.get("/")
def index():
    return {"app": "barepod", "status": "ok"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=` + strconv.Itoa(port) + `)
`,
		}
	case "fastapi":
		return map[string]string{
			"app.py": `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def index():
    return {"app": "barepod", "status": "ok"}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
`,
		}
	default:
		return nil
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
		// FastAPI/Starlette need an ASGI worker; Flask runs on the default one.
		workers := []string{"--workers", "2"}
		if strings.EqualFold(framework, "fastapi") {
			workers = []string{"--workers", "2", "-k", "uvicorn.workers.UvicornWorker"}
		}
		start := []string{workDir + "/.venv/bin/gunicorn", "-b", "127.0.0.1:" + p}
		return append(start, append(workers, "app:app")...)
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
