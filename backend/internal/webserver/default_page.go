package webserver

import (
	"html"
)

// Default404HTML returns an authentic, Modern Swiss editorial styled 404 page for domains
// pointing to the server that have not been registered to any website.
// Zero generic AI tropes: no rainbow gradient bars, no pulsing blobs, no emoji badges.
// Clean neo-grotesque typography, hair-thin architectural lines, and clear diagnostic telemetry.
func Default404HTML(host string) string {
	escapedHost := html.EscapeString(host)
	if escapedHost == "" {
		escapedHost = "this domain"
	}

	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — Host Unassigned</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #fafafa;
      --card-bg: #ffffff;
      --border: #e5e7eb;
      --border-dark: #111827;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --text-dim: #94a3b8;
      --accent: #2563eb;
      --warn: #b45309;
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
      border-left: 3px solid #10b981;
    }
    .node.unlinked {
      border-left: 3px solid var(--warn);
      background: #fffbeb;
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
    .data-val.warn {
      color: var(--warn);
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
      <span><strong>BarePod</strong> Edge Router</span>
      <span>Layer 7 Ingress • TCP:80/443</span>
      <span>HTTP 404</span>
    </div>

    <div class="hero-section">
      <div class="status-tag">Unrouted Ingress Target</div>
      <div class="title-row">
        <div class="status-code">404</div>
        <h1>Host Unassigned</h1>
      </div>
      <p class="lead">The hostname <span id="host-target" class="host-target">` + escapedHost + `</span> has successfully resolved to this server, but no virtual host has been bound to it yet.</p>
    </div>

    <!-- Technical Flow Schematic -->
    <div class="schematic">
      <div class="schematic-label">Routing Topology</div>
      <div class="diagram-row">
        <div class="node ok">
          <div class="node-title">Client Request</div>
          <div class="node-sub">DNS A/CNAME OK</div>
        </div>
        <div class="diagram-arrow">──▶</div>
        <div class="node ok">
          <div class="node-title">BarePod Gateway</div>
          <div class="node-sub">Ingress Active</div>
        </div>
        <div class="diagram-arrow">──╳──</div>
        <div class="node unlinked">
          <div class="node-title">Virtual Host</div>
          <div class="node-sub">Null / Unassigned</div>
        </div>
      </div>
    </div>

    <!-- Diagnostic Data Grid -->
    <div class="data-grid">
      <div class="data-cell">
        <div class="data-key">01 / Host Header</div>
        <div class="data-val" id="host-metric">` + escapedHost + `</div>
      </div>
      <div class="data-cell">
        <div class="data-key">02 / Edge Gateway</div>
        <div class="data-val">Online (Port 80/443)</div>
      </div>
      <div class="data-cell">
        <div class="data-key">03 / DNS Propagation</div>
        <div class="data-val">Pointed to Server IP</div>
      </div>
      <div class="data-cell">
        <div class="data-key">04 / VHost Association</div>
        <div class="data-val warn">Missing Attachment</div>
      </div>
    </div>

    <!-- Operator Protocol & Probe -->
    <div class="protocol-section">
      <div class="protocol-col">
        <h2>§ 01 / Operator Protocol</h2>
        <ol>
          <li>Open your BarePod control panel dashboard.</li>
          <li>Navigate to <b>Websites</b> and select the designated website.</li>
          <li>Add this domain under <b>Domains &amp; SSL</b> as primary or alias.</li>
          <li>The edge server compiles the vhost and immediately serves traffic.</li>
        </ol>
      </div>

      <div class="protocol-col">
        <h2>§ 02 / Diagnostic Probe</h2>
        <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px;">Test edge connection and response headers via terminal:</p>
        <div class="cli-box">
          <span class="cli-code" id="cli-cmd">curl -Iv http://` + escapedHost + `/</span>
          <button class="copy-btn" id="copy-btn" onclick="copyProbe()">Copy</button>
        </div>
      </div>
    </div>

    <div class="colophon">
      <span class="brand">BarePod Cloud Infrastructure</span>
      <span>RFC 9110 §15.5.5</span>
    </div>
  </div>

  <script>
    try {
      if (window.location && window.location.hostname) {
        var h = window.location.hostname;
        var el1 = document.getElementById('host-target');
        var el2 = document.getElementById('host-metric');
        var el3 = document.getElementById('cli-cmd');
        if (el1) el1.textContent = h;
        if (el2) el2.textContent = h;
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
