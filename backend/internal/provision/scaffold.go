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
// a website can then exist and answer on its address before an application does. It is
// deliberately one self-contained file — the site type that serves a directory serves
// it as-is, with no runtime, no dependency and nothing to build.
func DefaultPage(slug, domain string) string {
	title := html.EscapeString(domain)
	if domain == "" {
		title = html.EscapeString(slug)
	}
	escapedSlug := html.EscapeString(slug)

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>` + title + ` — Website Ready</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f8fafc;
      background-image: 
        radial-gradient(at 10% 10%, rgba(224, 231, 255, 0.6) 0px, transparent 50%),
        radial-gradient(at 90% 90%, rgba(207, 250, 254, 0.5) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(241, 245, 249, 0.4) 0px, transparent 50%);
      color: #1e293b;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      padding: 32px 20px;
      line-height: 1.6;
    }
    .container {
      width: 100%;
      max-width: 660px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 24px;
      box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.08), 0 0 1px rgba(0,0,0,0.05);
      padding: 44px 40px;
      position: relative;
      overflow: hidden;
    }
    .container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #3b82f6, #06b6d4, #10b981);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      color: #047857;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 6px 14px;
      border-radius: 9999px;
      margin-bottom: 20px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 9999px;
      background: #10b981;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
      animation: pulse-green 2s infinite;
    }
    @keyframes pulse-green {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.03em;
      margin-bottom: 8px;
    }
    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin-bottom: 28px;
    }
    .host-highlight {
      display: inline-block;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      padding: 2px 8px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      word-break: break-all;
    }
    .pipeline {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .pipe-step {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 14px 16px;
      transition: all 0.2s ease;
    }
    .pipe-step:hover {
      border-color: #cbd5e1;
      background: #f1f5f9;
    }
    .pipe-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .pipe-val {
      font-size: 13px;
      font-weight: 700;
    }
    .status-ok { color: #059669; }
    .status-info { color: #2563eb; }
    .guidance-grid {
      display: grid;
      gap: 16px;
      margin-bottom: 28px;
    }
    .guidance-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px;
    }
    .guidance-card h2 {
      font-size: 14px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .guidance-card ol, .guidance-card ul {
      padding-left: 20px;
      font-size: 13px;
      color: #475569;
    }
    .guidance-card li {
      margin-bottom: 8px;
    }
    .guidance-card li:last-child {
      margin-bottom: 0;
    }
    code {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 2px 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #0369a1;
      font-weight: 500;
    }
    .footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #94a3b8;
      flex-wrap: wrap;
      gap: 8px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="pulse-dot"></span>
      Website Active • BarePod Web Engine
    </div>
    <h1>Website Ready for Deployment</h1>
    <p class="subtitle">The website for <span id="host-placeholder" class="host-highlight">` + title + `</span> has been provisioned and is online.</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>🌐</span> Domain &amp; DNS</div>
        <div class="pipe-val status-ok">✓ Connected</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Active &amp; Ready</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>📦</span> Application</div>
        <div class="pipe-val status-info">ℹ Awaiting Code</div>
      </div>
    </div>

    <div class="guidance-grid">
      <div class="guidance-card">
        <h2>🚀 Next Steps: Deploy Your Code</h2>
        <ol>
          <li><b>Git Deployment:</b> Connect your GitHub or Git repository in the panel for automated zero-downtime builds on push.</li>
          <li><b>File Manager:</b> Upload files or extract archives directly via the panel File Manager.</li>
          <li><b>Framework Presets:</b> Scaffold popular stacks (Laravel, WordPress, Node.js, Next.js, Python) from the Presets tab.</li>
        </ol>
      </div>

      <div class="guidance-card">
        <h2>📁 Document Root Location</h2>
        <ul>
          <li>Files on server: <code>` + escapedSlug + `</code></li>
          <li>You can replace or edit this <code>index.html</code> file with your custom application at any time.</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <span>BarePod Panel Web Engine</span>
      <span>Status: 200 OK • Online</span>
    </div>
  </div>

  <script>
    try {
      if (window.location && window.location.hostname) {
        var el = document.getElementById('host-placeholder');
        if (el) el.textContent = window.location.hostname;
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
