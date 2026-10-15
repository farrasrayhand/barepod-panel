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

// RenderMaintenanceHTML creates a responsive, clean, dark-mode 503 status page.
func RenderMaintenanceHTML(title, message string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		t = "System Maintenance in Progress"
	}
	m := strings.TrimSpace(message)
	if m == "" {
		m = "We are currently performing scheduled maintenance and updates to improve your experience. We will be back online shortly."
	}

	escapedTitle := html.EscapeString(t)
	escapedMessage := html.EscapeString(m)

	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>503 Service Unavailable &mdash; %s</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.85);
      --border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --amber: #f59e0b;
      --amber-bg: rgba(245, 158, 11, 0.12);
      --blue: #3b82f6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50%% 0%%, #172554 0%%, var(--bg) 60%%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      border-radius: 1.5rem;
      max-width: 32rem;
      width: 100%%;
      padding: 2.5rem;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--amber-bg);
      border: 1px solid rgba(245, 158, 11, 0.25);
      color: var(--amber);
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      margin-bottom: 1.5rem;
    }
    .badge-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      background: var(--amber);
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse {
      0%%, 100%% { opacity: 1; transform: scale(1); }
      50%% { opacity: 0.4; transform: scale(0.85); }
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 0.75rem;
      line-height: 1.25;
    }
    p {
      color: var(--text-muted);
      font-size: 0.925rem;
      line-height: 1.6;
      margin-bottom: 2rem;
    }
    .countdown {
      background: rgba(255, 255, 255, 0.03);
      border: 1px dashed var(--border);
      border-radius: 1rem;
      padding: 1rem;
      margin-bottom: 1.75rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .countdown strong {
      color: #60a5fa;
      font-family: monospace;
      font-size: 1rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: #1e293b;
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.12);
      padding: 0.7rem 1.5rem;
      border-radius: 0.75rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
      width: 100%%;
    }
    .btn:hover {
      background: #334155;
      border-color: rgba(255, 255, 255, 0.2);
    }
    .footer {
      margin-top: 2rem;
      font-size: 0.75rem;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">
      <span class="badge-dot"></span>
      Maintenance Mode (HTTP 503)
    </div>
    <h1>%s</h1>
    <p>%s</p>
    <div class="countdown">
      Auto-refreshing in <strong id="timer">30</strong> seconds...
    </div>
    <button class="btn" onclick="window.location.reload()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
      Check Again Now
    </button>
    <div class="footer">
      Powered by BarePod Panel &bull; Edge Gateway
    </div>
  </div>
  <script>
    let timeLeft = 30;
    const timerElem = document.getElementById('timer');
    setInterval(() => {
      timeLeft--;
      if (timerElem) timerElem.textContent = timeLeft;
      if (timeLeft <= 0) {
        window.location.reload();
      }
    }, 1000);
  </script>
</body>
</html>
`, escapedTitle, escapedTitle, escapedMessage)
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
