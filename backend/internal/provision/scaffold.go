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
	escapedSlug := html.EscapeString(slug)

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>200 — ` + title + `</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #fafafa;
      --card-bg: #ffffff;
      --border: #e5e7eb;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-dim: #94a3b8;
      --accent: #2563eb;
      --ok: #059669;
      --ok-bg: #ecfdf5;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--bg);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 40px 20px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .sheet {
      width: 100%;
      max-width: 720px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04), 0 20px 40px -15px rgba(0, 0, 0, 0.05);
      border-radius: 4px;
      overflow: hidden;
    }
    .meta-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 28px;
      background: #f8fafc;
      border-bottom: 1px solid var(--border);
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      text-transform: uppercase;
      flex-wrap: wrap;
      gap: 8px;
    }
    .meta-bar strong {
      color: var(--text-main);
      font-weight: 600;
    }
    .hero-section {
      padding: 36px 32px 28px;
      border-bottom: 1px solid var(--border);
    }
    .status-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ok);
      background: var(--ok-bg);
      display: inline-block;
      padding: 3px 8px;
      margin-bottom: 14px;
    }
    .title-row {
      display: flex;
      align-items: baseline;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .status-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 48px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.05em;
      color: var(--text-main);
    }
    h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: var(--text-main);
      line-height: 1.2;
    }
    .lead {
      font-size: 14px;
      color: var(--text-muted);
      max-width: 600px;
    }
    .host-target {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
      color: var(--accent);
      background: #eff6ff;
      padding: 1px 6px;
      border: 1px solid #dbeafe;
    }
    /* Technical Flow Diagram */
    .schematic {
      padding: 24px 32px;
      background: #fcfcfd;
      border-bottom: 1px solid var(--border);
    }
    .schematic-label {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 14px;
    }
    .diagram-row {
      display: grid;
      grid-template-columns: 1fr auto 1fr auto 1fr;
      align-items: center;
      gap: 8px;
    }
    @media (max-width: 600px) {
      .diagram-row {
        grid-template-columns: 1fr;
        gap: 12px;
      }
      .diagram-arrow {
        transform: rotate(90deg);
        margin: 4px auto;
      }
    }
    .node {
      border: 1px solid var(--border);
      background: #ffffff;
      padding: 10px 14px;
      border-radius: 2px;
    }
    .node-title {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-main);
      margin-bottom: 2px;
    }
    .node-sub {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--text-muted);
    }
    .node.ok {
      border-left: 3px solid var(--ok);
    }
    .diagram-arrow {
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    /* Diagnostic Data Grid */
    .data-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      border-bottom: 1px solid var(--border);
    }
    @media (max-width: 540px) {
      .data-grid { grid-template-columns: 1fr; }
    }
    .data-cell {
      padding: 16px 32px;
      border-right: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .data-cell:nth-child(2n) {
      border-right: none;
    }
    .data-cell:nth-last-child(-n+2) {
      border-bottom: none;
    }
    .data-key {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-dim);
      margin-bottom: 4px;
    }
    .data-val {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-main);
    }
    /* Action & Protocol Manual */
    .protocol-section {
      padding: 28px 32px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
    }
    @media (max-width: 620px) {
      .protocol-section { grid-template-columns: 1fr; }
    }
    .protocol-col h2 {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-main);
      margin-bottom: 10px;
    }
    .protocol-col ol {
      padding-left: 18px;
      font-size: 12px;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .protocol-col ol li {
      margin-bottom: 6px;
    }
    .protocol-col ol li:last-child {
      margin-bottom: 0;
    }
    .cli-box {
      background: #0f172a;
      border-radius: 2px;
      padding: 10px 12px;
      margin-top: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .cli-code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #e2e8f0;
      overflow-x: auto;
      white-space: nowrap;
    }
    .copy-btn {
      background: #1e293b;
      border: 1px solid #334155;
      color: #cbd5e1;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 2px;
      cursor: pointer;
      transition: all 0.15s ease;
      shrink-0: 0;
    }
    .copy-btn:hover {
      background: #334155;
      color: #ffffff;
    }
    .copy-btn:active {
      transform: scale(0.96);
    }
    /* Colophon / Footer */
    .colophon {
      padding: 14px 32px;
      background: #f8fafc;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--text-dim);
      flex-wrap: wrap;
      gap: 8px;
    }
    .brand {
      font-weight: 600;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="meta-bar">
      <span><strong>BarePod</strong> Hosting Platform</span>
      <span>Runtime Edge Active</span>
      <span>HTTP 200 OK</span>
    </div>

    <div class="hero-section">
      <div class="status-tag">System Initialized &amp; Online</div>
      <div class="title-row">
        <div class="status-code">200</div>
        <h1>Ready for Deployment</h1>
      </div>
      <p class="lead">The website environment for <span id="host-target" class="host-target">` + title + `</span> has been provisioned and is ready for your application code.</p>
    </div>

    <!-- Technical Flow Schematic -->
    <div class="schematic">
      <div class="schematic-label">Routing &amp; Storage Topology</div>
      <div class="diagram-row">
        <div class="node ok">
          <div class="node-title">Public Ingress</div>
          <div class="node-sub">Port 80/443 Ready</div>
        </div>
        <div class="diagram-arrow">──▶</div>
        <div class="node ok">
          <div class="node-title">VHost Route</div>
          <div class="node-sub">` + title + `</div>
        </div>
        <div class="diagram-arrow">──▶</div>
        <div class="node ok">
          <div class="node-title">DocRoot Storage</div>
          <div class="node-sub">/web/` + escapedSlug + `</div>
        </div>
      </div>
    </div>

    <!-- Diagnostic Data Grid -->
    <div class="data-grid">
      <div class="data-cell">
        <div class="data-key">01 / Website Slug</div>
        <div class="data-val">` + escapedSlug + `</div>
      </div>
      <div class="data-cell">
        <div class="data-key">02 / Edge Gateway</div>
        <div class="data-val">HTTP 200 (Online)</div>
      </div>
      <div class="data-cell">
        <div class="data-key">03 / Target Domain</div>
        <div class="data-val">` + title + `</div>
      </div>
      <div class="data-cell">
        <div class="data-key">04 / Deployment State</div>
        <div class="data-val">Awaiting Project Code</div>
      </div>
    </div>

    <!-- Deployment Protocols & CLI Probe -->
    <div class="protocol-section">
      <div class="protocol-col">
        <h2>§ 01 / Deployment Protocols</h2>
        <ol>
          <li><b>Git Push:</b> Connect your repository in BarePod for automated CI/CD deployments.</li>
          <li><b>File Manager:</b> Upload your web files or extract archives directly into this site.</li>
          <li><b>Framework Presets:</b> Scaffold Laravel, WordPress, Node.js, Python or Go stacks.</li>
        </ol>
      </div>

      <div class="protocol-col">
        <h2>§ 02 / Diagnostic Probe</h2>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">Verify HTTP ingress response headers via terminal:</p>
        <div class="cli-box">
          <span class="cli-code" id="cli-cmd">curl -Iv http://` + title + `/</span>
          <button class="copy-btn" id="copy-btn" onclick="copyProbe()">Copy</button>
        </div>
      </div>
    </div>

    <div class="colophon">
      <span class="brand">BarePod Cloud Infrastructure</span>
      <span>RFC 9110 §15.3.1</span>
    </div>
  </div>

  <script>
    try {
      if (window.location && window.location.hostname) {
        var h = window.location.hostname;
        var el1 = document.getElementById('host-target');
        var el3 = document.getElementById('cli-cmd');
        if (el1 && h) el1.textContent = h;
        if (el3) el3.textContent = 'curl -Iv ' + window.location.origin + '/';
      }
    } catch (e) {}

    function copyProbe() {
      var cmd = document.getElementById('cli-cmd');
      var btn = document.getElementById('copy-btn');
      if (!cmd || !btn) return;
      navigator.clipboard.writeText(cmd.textContent).then(function() {
        btn.textContent = 'Copied';
        setTimeout(function() { btn.textContent = 'Copy'; }, 1800);
      }).catch(function() {});
    }
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
