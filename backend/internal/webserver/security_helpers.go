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
		// Fallback to temp dir if /etc is unwritable (e.g. non-root user or unit test)
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
		// Fallback to temp dir if /var/lib is unwritable (e.g. non-root user or unit test)
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

	// Also write barepod_503.html so Nginx error_page 503 /barepod_503.html finds it immediately
	dest503 := filepath.Join(dir, "barepod_503.html")
	if err := os.WriteFile(dest503, []byte(rendered), 0o644); err == nil {
		_ = os.Chmod(dest503, 0o644)
	}
	return dest, nil
}

// RenderMaintenanceHTML creates a responsive, clean, modern light-theme 503 status page
// that is 100% consistent with BarePod's default landing page design system.
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

	return fmt.Sprintf(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>503 Service Unavailable — %%s</title>
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
        radial-gradient(at 10%% 10%%, rgba(255, 237, 213, 0.6) 0px, transparent 50%%),
        radial-gradient(at 90%% 90%%, rgba(224, 231, 255, 0.5) 0px, transparent 50%%),
        radial-gradient(at 50%% 50%%, rgba(241, 245, 249, 0.4) 0px, transparent 50%%);
      color: #1e293b;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      padding: 32px 20px;
      line-height: 1.6;
    }
    .container {
      width: 100%%;
      max-width: 680px;
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
      background: linear-gradient(90deg, #f97316, #fb923c, #3b82f6);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #c2410c;
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
      background: #f97316;
      box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7);
      animation: pulse-orange 2s infinite;
    }
    @keyframes pulse-orange {
      0%% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.7); }
      70%% { transform: scale(1); box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
      100%% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0); }
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
    .pipeline {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
      margin-bottom: 4px;
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
    .status-warn { color: #d97706; }
    .status-orange { color: #ea580c; }
    .guidance-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 28px;
    }
    .guidance-card h2 {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .guidance-card p {
      font-size: 13px;
      color: #64748b;
      line-height: 1.6;
    }
    .action-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      flex-wrap: wrap;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #0f172a;
      color: #ffffff;
      border: 1px solid #0f172a;
      padding: 8px 16px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      font-family: inherit;
    }
    .btn:hover {
      background: #1e293b;
      border-color: #1e293b;
    }
    .footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #94a3b8;
      flex-wrap: wrap;
      gap: 8px;
    }
    .footer-brand {
      font-weight: 600;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="badge">
      <span class="pulse-dot"></span>
      HTTP 503 • SCHEDULED MAINTENANCE
    </div>
    <h1>%%s</h1>
    <p class="subtitle">%%s</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Online &amp; Responding</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>🛡️</span> Maintenance Mode</div>
        <div class="pipe-val status-orange">⚠ Active (HTTP 503)</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚙️</span> Service Status</div>
        <div class="pipe-val status-warn">⏳ Maintenance In Progress</div>
      </div>
    </div>

    <div class="guidance-card">
      <h2>🛠️ System Maintenance Information</h2>
      <p>Access is temporarily restricted to ensure data consistency and integrity during scheduled updates. As soon as maintenance is complete, this site will resume normal operation.</p>
      
      <div class="action-row">
        <span style="font-size: 12px; color: #64748b;">
          Automatic check in <strong id="timer" style="color: #2563eb; font-family: 'JetBrains Mono', monospace; font-size: 14px;">30</strong> seconds…
        </span>
        <button class="btn" onclick="window.location.reload()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
          Check Again Now
        </button>
      </div>
    </div>

    <div class="footer">
      <span class="footer-brand">BarePod Web Engine</span>
      <span>Status: 503 Service Unavailable</span>
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
</html>`, escapedTitle, escapedTitle, escapedMessage)
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
		// Validate if IP or CIDR
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
