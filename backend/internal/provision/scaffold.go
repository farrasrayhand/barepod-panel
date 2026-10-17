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
		verConstraint := version
		if !strings.HasPrefix(verConstraint, "^") && !strings.Contains(verConstraint, "*") {
			verConstraint = "^" + verConstraint
		}
		return []string{"composer", "create-project", "laravel/laravel:" + verConstraint, "."}
	case "symfony":
		if version != "" {
			return []string{"composer", "create-project", "symfony/skeleton:" + version + ".*", "."}
		}
		return []string{"composer", "create-project", "symfony/skeleton", "."}
	case "drupal":
		if version == "" {
			version = "11"
		}
		return []string{"composer", "create-project", "drupal/recommended-project:^" + version, "."}
	case "wordpress":
		return []string{"wp", "core", "download", "--locale=en_US"}
	case "codeigniter":
		return []string{"composer", "create-project", "codeigniter4/appstarter", "."}
	case "cakephp":
		return []string{"composer", "create-project", "cakephp/app", "."}
	case "nextjs":
		tag := "latest"
		if version != "" {
			tag = version
		}
		return []string{"npx", "create-next-app@" + tag, ".", "--ts", "--eslint", "--app", "--yes"}
	case "nuxt":
		return []string{"npx", "nuxi@latest", "init", ".", "--packageManager", "npm", "--no-install"}
	case "astro":
		return []string{"npx", "create-astro@latest", ".", "--no-install", "--no-git", "--yes"}
	case "nestjs":
		return []string{"npx", "@nestjs/cli@latest", "new", ".", "--package-manager", "npm", "--skip-git"}
	case "express":
		if version == "5" {
			return []string{"npx", "express-generator@next", "."}
		}
		return []string{"npx", "express-generator@latest", "."}
	case "django", "flask", "fastapi":
		bin := "python3"
		if version != "" {
			bin = "python" + strings.TrimSpace(version)
		}
		return []string{bin, "-m", "venv", ".venv"}
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
// a website can then exist and answer on its address before an application does.
// Crafted with a Modern Swiss / Minimalist Editorial aesthetic: zero generic AI slop,
// hair-thin architectural lines, crisp typography, and real technical utility.
func DefaultPage(slug, domain string) string {
	title := html.EscapeString(domain)
	if domain == "" {
		title = html.EscapeString(slug)
	}

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>` + title + ` — BarePod Panel</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      width: 100%;
      max-width: 520px;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.05);
      padding: 44px 36px 36px;
      text-align: center;
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
    }
    .logo-box {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background-color: #2563eb;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
    }
    .logo-box svg {
      width: 22px;
      height: 22px;
    }
    .brand-name {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.02em;
      margin-bottom: 12px;
      word-break: break-all;
    }
    .subtitle {
      font-size: 14px;
      color: #64748b;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .guidance {
      background-color: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 20px;
      font-size: 13px;
      color: #475569;
      line-height: 1.6;
      text-align: left;
    }
    .guidance strong {
      color: #0f172a;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
    .footer a {
      color: #64748b;
      text-decoration: none;
    }
    .footer a:hover {
      color: #2563eb;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="brand-mark">
        <div class="logo-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
            <line x1="6" y1="6" x2="6.01" y2="6"></line>
            <line x1="6" y1="18" x2="6.01" y2="18"></line>
          </svg>
        </div>
        <span class="brand-name">BarePod Panel</span>
      </div>

      <h1 id="site-name">` + title + `</h1>
      <p class="subtitle">This domain is successfully pointed to this server.</p>

      <div class="guidance">
        <strong>Site Owner?</strong> Log in to your BarePod Panel dashboard to upload your website files, manage databases, or deploy application code.
      </div>
    </div>

    <div class="footer">
      Powered by <a href="https://github.com/farrasrayhand/barepod-panel" target="_blank" rel="noopener">BarePod Panel</a>
    </div>
  </div>

  <script>
    try {
      if (window.location && window.location.hostname) {
        var host = window.location.hostname;
        var el = document.getElementById('site-name');
        if (el && host) el.textContent = host;
      }
    } catch (e) {}
  </script>
</body>
</html>`
}

// StarterFiles returns the entrypoint a framework needs to actually run.
//
// Downloading a framework is not enough: `gunicorn app:app` fails if nothing
// defines `app`, so a preset that only installs packages would deploy a broken
// site. These files are only written when the target does not exist, so uploaded
// or cloned code is never clobbered.
func StarterFiles(runtime, framework string, port int) map[string]string {
	// A PHP site with no framework of its own still needs something to answer with;
	// framework presets (Laravel, WordPress, …) bring their own entrypoint.
	if runtime == "php" && (strings.TrimSpace(framework) == "" || strings.EqualFold(framework, "generic php")) {
		return map[string]string{
			"index.php": `<?php
// Written by BarePod Panel so a new PHP site answers before you add your own code.
echo "BarePod: PHP " . PHP_VERSION . "\n";
`,
		}
	}
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

// fpmSuffix is the version as the distribution names its php-fpm binary: Debian and Ubuntu ship
// `/usr/sbin/php-fpm8.3`, keeping the dot. Stripping it produced `php-fpm83`, a path that does not
// exist on either, so a PHP website's unit could never have started — measured on the test host.
func fpmSuffix(version string) string {
	return strings.TrimSpace(version)
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
