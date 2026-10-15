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
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #080c14;
      background-image:
        radial-gradient(at 0% 0%, rgba(30, 58, 138, 0.25) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(15, 23, 42, 0.4) 0px, transparent 50%);
      color: #f1f5f9;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      padding: 24px;
      line-height: 1.6;
    }
    .container {
      width: 100%;
      max-width: 680px;
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 20px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      padding: 40px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #34d399;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
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
      box-shadow: 0 0 10px #10b981;
      animation: pulse 1.8s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .host-highlight {
      display: inline-block;
      background: rgba(59, 130, 246, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
      padding: 2px 8px;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 600;
      word-break: break-all;
    }
    .pipeline {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .pipe-step {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .pipe-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .pipe-val {
      font-size: 13px;
      font-weight: 700;
    }
    .status-ok { color: #34d399; }
    .status-info { color: #60a5fa; }
    .guidance-grid {
      display: grid;
      gap: 16px;
      margin-bottom: 28px;
    }
    .guidance-card {
      background: rgba(30, 41, 59, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 18px 20px;
    }
    .guidance-card h2 {
      font-size: 14px;
      font-weight: 700;
      color: #e2e8f0;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .guidance-card ol, .guidance-card ul {
      padding-left: 20px;
      font-size: 13px;
      color: #94a3b8;
    }
    .guidance-card li {
      margin-bottom: 6px;
    }
    .guidance-card li:last-child {
      margin-bottom: 0;
    }
    code {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 2px 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: #93c5fd;
    }
    .footer {
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #64748b;
      flex-wrap: wrap;
      gap: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="pulse-dot"></span>
      WEBSITE READY • BAREPOD ENGINE
    </div>
    <h1>Website Successfully Created &amp; Ready</h1>
    <p class="subtitle">The website for <span id="host-placeholder" class="host-highlight">` + title + `</span> is active on this server and ready for deployment.</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>🌐</span> Domain &amp; DNS</div>
        <div class="pipe-val status-ok">✓ Connected to Server</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Online &amp; Active</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>📦</span> Deployment</div>
        <div class="pipe-val status-info">ℹ Awaiting Application Code</div>
      </div>
    </div>

    <div class="guidance-grid">
      <div class="guidance-card">
        <h2>🚀 Getting Started &amp; Deploying Your Code</h2>
        <ol>
          <li><b>Git Deployment:</b> Connect your GitHub or Git repository in the panel to enable automated builds and deployment on every push commit.</li>
          <li><b>File Manager:</b> Open the File Manager in the panel to upload files or extract <code>.zip</code> / <code>.tar.gz</code> archives directly.</li>
          <li><b>Framework Presets:</b> Scaffold popular stacks (Laravel, Node.js, Next.js, Python Flask/FastAPI, etc.) directly from the Presets tab.</li>
        </ol>
      </div>

      <div class="guidance-card">
        <h2>📁 Document Root Location</h2>
        <ul>
          <li>Your website files are located on the host under: <code>` + escapedSlug + `</code></li>
          <li>You can replace or edit this <code>index.html</code> file with your custom application at any time.</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <span>BarePod Web Engine</span>
      <span>Status: 200 OK · Website Provisioned</span>
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
