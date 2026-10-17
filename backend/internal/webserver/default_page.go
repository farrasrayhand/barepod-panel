package webserver

import (
	"html"
)

// Default404HTML returns an informative, beautifully styled 404 page for domains
// pointing to the server that have not been registered to any website.
// Zero sensitive data, panel URLs, or admin ports are leaked.
func Default404HTML(host string) string {
	escapedHost := html.EscapeString(host)
	if escapedHost == "" {
		escapedHost = "this domain"
	}

	tmpl := `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 Not Found — Domain Not Configured</title>
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
        radial-gradient(at 10% 10%, rgba(254, 243, 199, 0.5) 0px, transparent 50%),
        radial-gradient(at 90% 90%, rgba(224, 231, 255, 0.5) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(241, 245, 249, 0.4) 0px, transparent 50%);
      color: #1e293b;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      padding: 32px 20px;
      line-height: 1.6;
    }
    .container {
      width: 100%;
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
      background: linear-gradient(90deg, #f59e0b, #fbbf24, #3b82f6);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #b45309;
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
      background: #f59e0b;
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
      animation: pulse-amber 2s infinite;
    }
    @keyframes pulse-amber {
      0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); }
      70% { transform: scale(1); box-shadow: 0 0 0 8px rgba(245, 158, 11, 0); }
      100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); }
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
    .guidance-grid {
      display: grid;
      gap: 14px;
      margin-bottom: 28px;
    }
    .guidance-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 18px 20px;
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
    .guidance-card ol, .guidance-card ul {
      padding-left: 20px;
      font-size: 13px;
      color: #64748b;
    }
    .guidance-card li {
      margin-bottom: 6px;
    }
    .guidance-card li:last-child {
      margin-bottom: 0;
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
      HTTP 404 • UNREGISTERED DOMAIN
    </div>
    <h1>Domain Not Connected to a Website</h1>
    <p class="subtitle">The domain <span id="host-placeholder" class="host-highlight">` + escapedHost + `</span> resolves to this server's IP address, but has not been configured for any active website.</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>🌐</span> DNS Resolution</div>
        <div class="pipe-val status-ok">✓ Resolves to Server IP</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Online &amp; Responding</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>📁</span> Virtual Host</div>
        <div class="pipe-val status-warn">⚠ Not Configured</div>
      </div>
    </div>

    <div class="guidance-grid">
      <div class="guidance-card">
        <h2>🛠️ For Domain Owners &amp; Administrators</h2>
        <ol>
          <li>Ensure this domain name is added under the <b>Websites</b> section in your BarePod control panel.</li>
          <li>If using Cloudflare Tunnel or an external reverse proxy, ensure the public hostname is routed to the designated web port.</li>
          <li>Once the website is added and deployed, the web server will automatically begin serving your application.</li>
        </ol>
      </div>

      <div class="guidance-card">
        <h2>👤 For Visitors</h2>
        <ul>
          <li>This page is displayed because the domain address you visited has not yet been linked to an active website or service.</li>
          <li>Please verify the URL in your browser address bar or contact the website administrator.</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <span class="footer-brand">BarePod Web Engine</span>
      <span>Status: 404 Not Found</span>
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
	return tmpl
}
