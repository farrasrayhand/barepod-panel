package webserver

import (
	"html"
)

// Default404HTML returns a branded 404 page for domains pointing to the server
// that have not been registered to any website, matching the exact theme of the default page.
func Default404HTML(host string) string {
	escapedHost := html.EscapeString(host)
	if escapedHost == "" {
		escapedHost = "This domain"
	}

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 Not Found — BarePod Panel</title>
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
        <span class="badge">
          <span class="dot"></span>
          404 Not Found
        </span>
      </div>

      <h1 id="site-name">` + escapedHost + `</h1>
      <p class="subtitle">This domain points to this server, but has not been assigned to any website.</p>

      <div class="guidance">
        <strong>Server Administrator?</strong> Log in to your BarePod Panel dashboard, navigate to <strong>Websites</strong>, and add this domain or create a website to begin serving traffic.
      </div>
    </div>

    <div class="footer">
      Powered by <a href="https://github.com/farrasrayhand/barepod-panel" target="_blank" rel="noopener">BarePod Panel</a>
    </div>
  </div>
</body>
</html>`
}
