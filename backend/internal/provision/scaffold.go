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
  <title>` + title + ` — Online</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(15, 18, 28, 0.7);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-border-hover: rgba(99, 102, 241, 0.3);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --emerald: #10b981;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      min-height: 100vh;
      background-color: var(--bg);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }

    /* Subtle Ambient Aurora Background */
    .ambient-glow {
      position: fixed;
      top: -20%;
      left: 50%;
      transform: translateX(-50%);
      width: 1000px;
      height: 600px;
      background: radial-gradient(circle, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.1) 40%, transparent 70%);
      filter: blur(80px);
      pointer-events: none;
      z-index: 0;
    }

    .grid-pattern {
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 40px 40px;
      mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, #000 70%, transparent 100%);
      -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, #000 70%, transparent 100%);
      pointer-events: none;
      z-index: 0;
    }

    /* Layout Container */
    .wrapper {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 24px 64px;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* Top Navigation Bar */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0 48px;
    }

    .brand-mark {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: -0.02em;
    }

    .brand-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
    }

    .brand-icon svg {
      width: 16px;
      height: 16px;
      color: white;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      border-radius: 9999px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      color: #34d399;
      font-family: 'JetBrains Mono', monospace;
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: var(--emerald);
      box-shadow: 0 0 10px var(--emerald);
      animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.6; }
    }

    /* Hero Section */
    .hero {
      margin-bottom: 44px;
    }

    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 600;
      color: #818cf8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 16px;
    }

    h1.hero-title {
      font-size: clamp(32px, 5vw, 48px);
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -0.03em;
      margin-bottom: 16px;
      color: #ffffff;
    }

    .hero-title .host-pill {
      background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      word-break: break-all;
    }

    .hero-title .gradient-text {
      display: block;
      background: linear-gradient(135deg, #818cf8 0%, #c084fc 50%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .hero-desc {
      font-size: 16px;
      color: var(--text-muted);
      max-width: 620px;
      line-height: 1.7;
    }

    /* Main Bento Deck */
    .bento-grid {
      display: grid;
      grid-template-columns: 1.6fr 1fr;
      gap: 20px;
      margin-bottom: 24px;
    }

    @media (max-width: 768px) {
      .bento-grid {
        grid-template-columns: 1fr;
      }
    }

    .glass-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
    }

    .glass-card:hover {
      border-color: var(--card-border-hover);
      box-shadow: 0 16px 40px -10px rgba(99, 102, 241, 0.12);
    }

    /* Card 1: Interactive Workspace Guide */
    .guide-card {
      padding: 32px;
      display: flex;
      flex-direction: column;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .tab-pills {
      display: flex;
      background: rgba(255, 255, 255, 0.05);
      padding: 3px;
      border-radius: 8px;
      gap: 4px;
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-dim);
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tab-btn.active {
      background: rgba(255, 255, 255, 0.12);
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    .tab-btn:hover:not(.active) {
      color: var(--text-muted);
    }

    .tab-content {
      display: none;
      flex-direction: column;
      gap: 16px;
      animation: fadeIn 0.2s ease;
    }

    .tab-content.active {
      display: flex;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .tab-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.6;
    }

    /* Terminal Code Block */
    .terminal-window {
      background: #05070a;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      overflow: hidden;
      font-family: 'JetBrains Mono', monospace;
    }

    .terminal-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 14px;
      background: rgba(255, 255, 255, 0.03);
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 11px;
      color: var(--text-dim);
    }

    .window-dots {
      display: flex;
      gap: 6px;
    }

    .window-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
    }

    .terminal-body {
      padding: 14px 16px;
      font-size: 12px;
      line-height: 1.7;
      color: #e2e8f0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      overflow-x: auto;
    }

    .terminal-code {
      white-space: nowrap;
    }

    .cmd-prompt {
      color: #38bdf8;
      user-select: none;
      margin-right: 8px;
    }

    .cmd-arg {
      color: #f472b6;
    }

    .copy-chip {
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: var(--text-muted);
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .copy-chip:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.25);
    }

    /* Card 2: Technical Specifications & Status */
    .specs-card {
      padding: 32px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .specs-header {
      font-size: 15px;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .spec-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .spec-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      font-size: 13px;
    }

    .spec-item:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .spec-label {
      color: var(--text-dim);
    }

    .spec-value {
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-main);
      font-weight: 500;
      font-size: 12px;
    }

    .spec-value.highlight {
      color: #38bdf8;
    }

    .spec-badge {
      background: rgba(56, 189, 248, 0.1);
      border: 1px solid rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
    }

    /* Bottom Feature Highlights */
    .features-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 48px;
    }

    @media (max-width: 768px) {
      .features-strip {
        grid-template-columns: 1fr;
      }
    }

    .feature-tile {
      padding: 20px 24px;
      background: rgba(15, 18, 28, 0.4);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: border-color 0.2s ease;
    }

    .feature-tile:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }

    .tile-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #818cf8;
      margin-bottom: 4px;
    }

    .tile-title {
      font-size: 14px;
      font-weight: 600;
      color: #ffffff;
    }

    .tile-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Footer Colophon */
    footer {
      margin-top: auto;
      padding-top: 32px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: var(--text-dim);
      flex-wrap: wrap;
      gap: 16px;
    }

    .footer-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .footer-left strong {
      color: var(--text-muted);
      font-weight: 600;
    }

    .live-clock {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: var(--text-dim);
    }
  </style>
</head>
<body>
  <div class="ambient-glow"></div>
  <div class="grid-pattern"></div>

  <div class="wrapper">
    <header>
      <a href="#" class="brand-mark">
        <div class="brand-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span>BarePod</span>
      </a>

      <div class="status-badge">
        <span class="pulse-dot"></span>
        <span id="runtime-status">Node Online</span>
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="eyebrow">
          <span>Deployment Initialized</span>
        </div>
        <h1 class="hero-title">
          <span class="host-pill" id="site-host">` + title + `</span>
          <span class="gradient-text">is ready for launch.</span>
        </h1>
        <p class="hero-desc">
          Your web environment has been provisioned and hooked to the edge ingress. Replace this starter page with your application or connect your git repository to get started.
        </p>
      </section>

      <section class="bento-grid">
        <!-- Interactive Deployment Guide -->
        <div class="glass-card guide-card">
          <div class="card-header">
            <div class="card-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 17 10 11 4 5"></polyline>
                <line x1="12" y1="19" x2="20" y2="19"></line>
              </svg>
              <span>Quick Start</span>
            </div>

            <div class="tab-pills">
              <button class="tab-btn active" onclick="switchTab('html')">Static / HTML</button>
              <button class="tab-btn" onclick="switchTab('git')">Git Deploy</button>
              <button class="tab-btn" onclick="switchTab('apps')">App Stacks</button>
            </div>
          </div>

          <!-- Tab 1: Static -->
          <div id="tab-html" class="tab-content active">
            <p class="tab-desc">
              Your web root directory is ready on the server. Simply place your <code style="color: #38bdf8;">index.html</code>, stylesheets, or built assets inside this folder:
            </p>
            <div class="terminal-window">
              <div class="terminal-top">
                <div class="window-dots">
                  <div class="window-dot"></div>
                  <div class="window-dot"></div>
                  <div class="window-dot"></div>
                </div>
                <span>Server Document Root</span>
              </div>
              <div class="terminal-body">
                <div class="terminal-code">
                  <span class="cmd-prompt">root:</span><span id="code-root">/web/` + escapedSlug + `</span>
                </div>
                <button class="copy-chip" onclick="copySnippet('code-root', this)">Copy Path</button>
              </div>
            </div>
            <p class="tab-desc" style="font-size: 13px; color: var(--text-dim);">
              Tip: You can upload files directly using the File Manager inside BarePod Panel, or push via SFTP.
            </p>
          </div>

          <!-- Tab 2: Git -->
          <div id="tab-git" class="tab-content">
            <p class="tab-desc">
              Connect your GitHub or GitLab repository in the panel to enable automated zero-downtime deployments on git push:
            </p>
            <div class="terminal-window">
              <div class="terminal-top">
                <div class="window-dots">
                  <div class="window-dot"></div>
                  <div class="window-dot"></div>
                  <div class="window-dot"></div>
                </div>
                <span>Terminal Probe</span>
              </div>
              <div class="terminal-body">
                <div class="terminal-code">
                  <span class="cmd-prompt">$</span>curl -Iv <span class="cmd-arg" id="probe-url">https://` + title + `/</span>
                </div>
                <button class="copy-chip" onclick="copySnippet('probe-url', this)">Copy</button>
              </div>
            </div>
            <p class="tab-desc" style="font-size: 13px; color: var(--text-dim);">
              Configure build triggers and branch tracking under the <strong>Git Deployment</strong> tab in your site dashboard.
            </p>
          </div>

          <!-- Tab 3: Apps -->
          <div id="tab-apps" class="tab-content">
            <p class="tab-desc">
              Looking to run a full-stack framework? BarePod provides native runtime engines and automated supervisors for:
            </p>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
              <span class="spec-badge">Laravel 12</span>
              <span class="spec-badge">Node.js / Next.js</span>
              <span class="spec-badge">WordPress</span>
              <span class="spec-badge">Python / FastAPI</span>
              <span class="spec-badge">Go / Fiber</span>
            </div>
            <p class="tab-desc" style="font-size: 13px; color: var(--text-dim); margin-top: 8px;">
              Head over to <strong>BarePod Panel &rarr; Applications</strong> to scaffold or link containerized pods with one click.
            </p>
          </div>
        </div>

        <!-- Specifications & Telemetry Card -->
        <div class="glass-card specs-card">
          <div>
            <div class="specs-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
              </svg>
              <span>Environment</span>
            </div>

            <div class="spec-list">
              <div class="spec-item">
                <span class="spec-label">Domain</span>
                <span class="spec-value highlight" id="spec-domain">` + title + `</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">SSL Encryption</span>
                <span class="spec-badge">Auto TLS Active</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">Web Ingress</span>
                <span class="spec-value">High-Performance Edge</span>
              </div>
              <div class="spec-item">
                <span class="spec-label">HTTP Protocol</span>
                <span class="spec-value">HTTP/2 • HTTP/3 (QUIC)</span>
              </div>
            </div>
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 12px; color: var(--text-dim);">Latency Probe</span>
              <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #34d399;" id="latency-val">&lt; 1ms local</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Three Pillars -->
      <section class="features-strip">
        <div class="feature-tile">
          <div class="tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
            </svg>
          </div>
          <div class="tile-title">High Speed Edge</div>
          <div class="tile-desc">Served with automated Brotli &amp; Zstandard compression right from NVMe storage.</div>
        </div>

        <div class="feature-tile">
          <div class="tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <div class="tile-title">Hardened Isolation</div>
          <div class="tile-desc">Dedicated Linux user permissions and strict dotfile blocking for enterprise safety.</div>
        </div>

        <div class="feature-tile">
          <div class="tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <div class="tile-title">Multi-Tenant Engine</div>
          <div class="tile-desc">Seamlessly scaled across isolated application pods and managed relational databases.</div>
        </div>
      </section>
    </main>

    <footer>
      <div class="footer-left">
        <strong>BarePod</strong>
        <span>Cloud Hosting &amp; Container Infrastructure</span>
      </div>
      <div class="live-clock" id="clock">UTC</div>
    </footer>
  </div>

  <script>
    // Hostname dynamic adaptation
    try {
      if (window.location && window.location.hostname) {
        var host = window.location.hostname;
        var hostEl = document.getElementById('site-host');
        var specEl = document.getElementById('spec-domain');
        var probeEl = document.getElementById('probe-url');
        if (hostEl && host) hostEl.textContent = host;
        if (specEl && host) specEl.textContent = host;
        if (probeEl && host) probeEl.textContent = 'curl -Iv ' + window.location.origin + '/';
      }
    } catch (e) {}

    // Tab switching
    function switchTab(type) {
      var btns = document.querySelectorAll('.tab-btn');
      var contents = document.querySelectorAll('.tab-content');
      btns.forEach(function(btn) { btn.classList.remove('active'); });
      contents.forEach(function(c) { c.classList.remove('active'); });

      if (type === 'html') {
        btns[0].classList.add('active');
        document.getElementById('tab-html').classList.add('active');
      } else if (type === 'git') {
        btns[1].classList.add('active');
        document.getElementById('tab-git').classList.add('active');
      } else if (type === 'apps') {
        btns[2].classList.add('active');
        document.getElementById('tab-apps').classList.add('active');
      }
    }

    // Copy helper
    function copySnippet(elementId, btn) {
      var el = document.getElementById(elementId);
      if (!el) return;
      var text = el.textContent;
      navigator.clipboard.writeText(text).then(function() {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#34d399';
        setTimeout(function() {
          btn.textContent = orig;
          btn.style.borderColor = '';
          btn.style.color = '';
        }}, 2000);
      }).catch(function() {});
    }

    // Real-time clock
    function updateClock() {
      var d = new Date();
      var el = document.getElementById('clock');
      if (el) {
        el.textContent = d.toUTCString().replace('GMT', 'UTC');
      }
    }
    setInterval(updateClock, 1000);
    updateClock();
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
