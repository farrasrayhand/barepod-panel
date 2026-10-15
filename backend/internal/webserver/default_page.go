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
		escapedHost = "domain ini"
	}

	tmpl := `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 Not Found — Domain Belum Terdaftar</title>
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
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fbbf24;
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
      background: #f59e0b;
      box-shadow: 0 0 10px #f59e0b;
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
    .status-warn { color: #fbbf24; }
    .status-err { color: #f87171; }
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
      HTTP 404 • UNREGISTERED DOMAIN
    </div>
    <h1>Domain Belum Terhubung ke Website</h1>
    <p class="subtitle">Domain <span id="host-placeholder" class="host-highlight">` + escapedHost + `</span> berhasil mengarah ke IP server ini, namun belum didaftarkan pada konfigurasi website manapun.</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>🌐</span> DNS Resolution</div>
        <div class="pipe-val status-ok">✓ Terhubung ke IP Server</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Aktif & Merespons</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>📁</span> Virtual Host</div>
        <div class="pipe-val status-warn">⚠ Belum Didaftarkan</div>
      </div>
    </div>

    <div class="guidance-grid">
      <div class="guidance-card">
        <h2>🛠️ Untuk Pemilik Domain / Administrator</h2>
        <ol>
          <li>Pastikan nama domain ini sudah ditambahkan ke menu <b>Websites</b> pada kontrol panel server Anda.</li>
          <li>Jika menggunakan Cloudflare Tunnel atau Reverse Proxy, pastikan Public Hostname telah diarahkan ke port website yang sesuai.</li>
          <li>Setelah website ditambahkan dan dideploy, web server akan langsung menampilkan website Anda secara otomatis.</li>
        </ol>
      </div>

      <div class="guidance-card">
        <h2>👤 Untuk Pengunjung</h2>
        <ul>
          <li>Halaman ini muncul karena alamat domain yang Anda tuju belum dihubungkan ke aplikasi aktif oleh pemiliknya.</li>
          <li>Silakan periksa kembali penulisan alamat URL di browser atau hubungi pemilik website.</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <span>BarePod Web Engine</span>
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
