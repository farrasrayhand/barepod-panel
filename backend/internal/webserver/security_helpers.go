package webserver

import (
	"fmt"
	"html"
	"net"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

var (
	AuthDir        = "/etc/barepod/auth"
	MaintenanceDir = "/var/lib/barepod/maintenance"
)

// HashPassword hashes a raw password using bcrypt for .htpasswd and Caddy basicauth.
func HashPassword(plain string) (string, error) {
	if plain == "" {
		return "", fmt.Errorf("password cannot be empty")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plain), 12)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

// EnsureAuthDir ensures the auth directory exists with world-readable traversal permissions.
func EnsureAuthDir() error {
	dir := AuthDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fallback := filepath.Join(os.TempDir(), "barepod", "auth")
		if err2 := os.MkdirAll(fallback, 0o755); err2 == nil {
			AuthDir = fallback
			return nil
		}
		return err
	}
	if parent := filepath.Dir(dir); parent != "" && parent != "/" {
		_ = os.Chmod(parent, 0o755)
	}
	_ = os.Chmod(dir, 0o755)
	return nil
}

// WriteHtpasswd writes a standard .htpasswd file for the given website slug.
func WriteHtpasswd(slug, user, hash string) (string, error) {
	if err := EnsureAuthDir(); err != nil {
		return "", fmt.Errorf("ensure auth dir: %w", err)
	}
	slug = sanitizeSlug(slug)
	dest := filepath.Join(AuthDir, slug+".htpasswd")
	content := fmt.Sprintf("%s:%s\n", strings.TrimSpace(user), strings.TrimSpace(hash))
	if err := os.WriteFile(dest, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("write htpasswd: %w", err)
	}
	_ = os.Chmod(dest, 0o644)
	return dest, nil
}

// RemoveHtpasswd deletes the .htpasswd file for a website slug.
func RemoveHtpasswd(slug string) error {
	slug = sanitizeSlug(slug)
	dest := filepath.Join(AuthDir, slug+".htpasswd")
	if err := os.Remove(dest); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// EnsureMaintenanceDir ensures the maintenance directory exists with world-readable permissions.
func EnsureMaintenanceDir(slug string) (string, error) {
	slug = sanitizeSlug(slug)
	if parent := filepath.Dir(MaintenanceDir); parent != "" && parent != "/" {
		_ = os.Chmod(parent, 0o755)
	}
	_ = os.Chmod(MaintenanceDir, 0o755)
	dir := filepath.Join(MaintenanceDir, slug)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fallback := filepath.Join(os.TempDir(), "barepod", "maintenance", slug)
		if err2 := os.MkdirAll(fallback, 0o755); err2 == nil {
			MaintenanceDir = filepath.Join(os.TempDir(), "barepod", "maintenance")
			return fallback, nil
		}
		return "", err
	}
	_ = os.Chmod(dir, 0o755)
	return dir, nil
}

// WriteMaintenancePage writes the custom 503 HTML file for the given website.
func WriteMaintenancePage(slug, title, message string) (string, error) {
	dir, err := EnsureMaintenanceDir(slug)
	if err != nil {
		return "", err
	}
	dest := filepath.Join(dir, "index.html")
	rendered := RenderMaintenanceHTML(title, message)
	if err := os.WriteFile(dest, []byte(rendered), 0o644); err != nil {
		return "", fmt.Errorf("write maintenance page: %w", err)
	}
	_ = os.Chmod(dest, 0o644)

	dest503 := filepath.Join(dir, "barepod_503.html")
	if err := os.WriteFile(dest503, []byte(rendered), 0o644); err == nil {
		_ = os.Chmod(dest503, 0o644)
	}
	return dest, nil
}

// RenderMaintenanceHTML creates an authentic, Modern Swiss editorial styled 503 status page.
func RenderMaintenanceHTML(title, message string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		t = "Scheduled Maintenance"
	}
	m := strings.TrimSpace(message)
	if m == "" {
		m = "We are currently performing scheduled maintenance and system upgrades. Service will be back online shortly."
	}

	escapedTitle := html.EscapeString(t)
	escapedMessage := html.EscapeString(m)

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>503 — ` + escapedTitle + `</title>
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
      --warn: #d97706;
      --warn-bg: #fef3c7;
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
      color: var(--warn);
      background: var(--warn-bg);
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
      border-left: 3px solid #10b981;
    }
    .node.hold {
      border-left: 3px solid var(--warn);
      background: #fffbeb;
    }
    .diagram-arrow {
      color: var(--text-dim);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
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
    .data-val.warn {
      color: var(--warn);
    }
    .protocol-section {
      padding: 28px 32px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 28px;
      align-items: center;
    }
    @media (max-width: 620px) {
      .protocol-section {
        grid-template-columns: 1fr;
      }
    }
    .protocol-info h2 {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--text-main);
      margin-bottom: 8px;
    }
    .protocol-info p {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .action-group {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      min-width: 170px;
    }
    .countdown-text {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--text-muted);
    }
    .countdown-num {
      color: var(--accent);
      font-weight: 700;
    }
    .reload-btn {
      background: #0f172a;
      border: 1px solid #0f172a;
      color: #ffffff;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      font-weight: 600;
      padding: 8px 16px;
      border-radius: 2px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
    }
    .reload-btn:hover {
      background: #1e293b;
      border-color: #1e293b;
    }
    .reload-btn:active {
      transform: scale(0.97);
    }
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
      <span><strong>BarePod</strong> Edge Gateway</span>
      <span>Traffic Paused</span>
      <span>HTTP 503</span>
    </div>

    <div class="hero-section">
      <div class="status-tag">Maintenance Protocol Active</div>
      <div class="title-row">
        <div class="status-code">503</div>
        <h1>` + escapedTitle + `</h1>
      </div>
      <p class="lead">` + escapedMessage + `</p>
    </div>

    <div class="schematic">
      <div class="schematic-label">Routing Topology</div>
      <div class="diagram-row">
        <div class="node ok">
          <div class="node-title">Client Request</div>
          <div class="node-sub">Inbound OK</div>
        </div>
        <div class="diagram-arrow">──▶</div>
        <div class="node ok">
          <div class="node-title">Web Server Ingress</div>
          <div class="node-sub">Gateway Online</div>
        </div>
        <div class="diagram-arrow">──⏸──</div>
        <div class="node hold">
          <div class="node-title">Application Upstream</div>
          <div class="node-sub">Maintenance Guard</div>
        </div>
      </div>
    </div>

    <div class="data-grid">
      <div class="data-cell">
        <div class="data-key">01 / Scope</div>
        <div class="data-val">` + escapedTitle + `</div>
      </div>
      <div class="data-cell">
        <div class="data-key">02 / Gateway Status</div>
        <div class="data-val">503 Service Unavailable</div>
      </div>
      <div class="data-cell">
        <div class="data-key">03 / Upstream Ingress</div>
        <div class="data-val warn">Traffic Paused</div>
      </div>
      <div class="data-cell">
        <div class="data-key">04 / Retry Header</div>
        <div class="data-val">Auto-Refresh Active</div>
      </div>
    </div>

    <div class="protocol-section">
      <div class="protocol-info">
        <h2>§ 01 / Maintenance Directive</h2>
        <p>Public traffic is temporarily held at the edge ingress while database migrations, application updates, or maintenance tasks complete. Normal service will resume immediately upon completion.</p>
      </div>

      <div class="action-group">
        <span class="countdown-text">Auto-refresh in <span class="countdown-num" id="timer">30</span>s</span>
        <button class="reload-btn" onclick="window.location.reload()">
          <span>Check Again Now</span>
        </button>
      </div>
    </div>

    <div class="colophon">
      <span class="brand">BarePod Cloud Infrastructure</span>
      <span>RFC 9110 §15.6.4</span>
    </div>
  </div>

  <script>
    var timeLeft = 30;
    var timerElem = document.getElementById('timer');
    setInterval(function() {
      timeLeft--;
      if (timerElem) timerElem.textContent = timeLeft;
      if (timeLeft <= 0) {
        window.location.reload();
      }
    }, 1000);
  </script>
</body>
</html>`
}

// ParseIPList splits a comma- or newline-separated string of IP/CIDR entries and cleans them.
func ParseIPList(raw string) []string {
	var clean []string
	raw = strings.ReplaceAll(raw, "\n", ",")
	raw = strings.ReplaceAll(raw, "\r", ",")
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if strings.Contains(part, "/") {
			if _, _, err := net.ParseCIDR(part); err == nil {
				clean = append(clean, part)
			}
		} else {
			if ip := net.ParseIP(part); ip != nil {
				clean = append(clean, part)
			}
		}
	}
	return clean
}

func sanitizeSlug(slug string) string {
	slug = strings.TrimSpace(strings.ToLower(slug))
	var out []rune
	for _, r := range slug {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return "site"
	}
	return string(out)
}
