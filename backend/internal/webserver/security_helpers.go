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
	if strings.TrimSpace(title) == StoppedTitle {
		rendered = RenderStoppedHTML(title, message)
	}
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

// SyncAllMaintenancePages scans MaintenanceDir and rewrites every index.html and barepod_503.html
// so that all existing stopped websites and maintenance sites inherit the unified card design.
func SyncAllMaintenancePages() int {
	entries, err := os.ReadDir(MaintenanceDir)
	if err != nil {
		return 0
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		slug := entry.Name()
		indexPath := filepath.Join(MaintenanceDir, slug, "index.html")
		content, _ := os.ReadFile(indexPath)
		isStopped := strings.Contains(string(content), "Stopped") || strings.Contains(string(content), "stopped")
		title, message := "Maintenance Mode", "We are currently performing scheduled maintenance. Please check back shortly."
		expected := RenderMaintenanceHTML(title, message)
		if isStopped {
			title = StoppedTitle
			message = "This website has been stopped by the site owner in the control panel."
			expected = RenderStoppedHTML(title, message)
		}
		if string(content) == expected {
			continue
		}
		if _, err := WriteMaintenancePage(slug, title, message); err == nil {
			count++
		}
	}
	return count
}

// StoppedTitle marks the page served for a website the operator has stopped.
const StoppedTitle = "Website Stopped"

// RenderStoppedHTML is the page for a stopped website. It shares the default page's sheet,
// typography and diagnostic layout, with the wording of a stopped site rather than maintenance.
func RenderStoppedHTML(title, message string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		t = "Website Stopped"
	}
	m := strings.TrimSpace(message)
	if m == "" {
		m = "This website has been stopped by the site owner in the control panel."
	}
	escapedTitle := html.EscapeString(t)
	escapedMessage := html.EscapeString(m)

	return renderCardTemplate("Website Stopped", "badge-gray", escapedTitle, escapedMessage,
		"<strong>Site Owner?</strong> Log in to your BarePod Panel dashboard and click <strong>Start</strong> to put this website back online.",
		true)
}

// RenderMaintenanceHTML creates an authentic 503 status page matching the BarePod default page theme.
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

	return renderCardTemplate("Maintenance Mode", "badge-amber", escapedTitle, escapedMessage,
		"<strong>Site Owner?</strong> Maintenance mode is currently active. Disable maintenance in the BarePod Panel dashboard to restore public access.",
		true)
}

func renderCardTemplate(badgeText, badgeClass, title, subtitle, guidanceHTML string, showTimer bool) string {
	timerHTML := ""
	if showTimer {
		timerHTML = `<div class="timer-note">Auto-checking status in <span id="timer">30</span>s</div>
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
  </script>`
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
      margin-bottom: 20px;
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
    .badge-container {
      margin-bottom: 14px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-amber {
      background: #fef3c7;
      color: #92400e;
    }
    .badge-gray {
      background: #f1f5f9;
      color: #475569;
    }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
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
    .timer-note {
      margin-top: 18px;
      font-size: 12px;
      color: #94a3b8;
    }
    .timer-note span {
      font-weight: 600;
      color: #64748b;
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

      <div class="badge-container">
        <span class="badge ` + badgeClass + `">
          <span class="dot"></span>
          ` + badgeText + `
        </span>
      </div>

      <h1 id="site-name">` + title + `</h1>
      <p class="subtitle">` + subtitle + `</p>

      <div class="guidance">
        ` + guidanceHTML + `
      </div>

      ` + timerHTML + `
    </div>

    <div class="footer">
      Powered by <a href="https://github.com/farrasrayhand/barepod-panel" target="_blank" rel="noopener">BarePod Panel</a>
    </div>
  </div>
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
