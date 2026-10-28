package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"html"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/api"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbengine"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/scheduler"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tlscert"
	"github.com/farrasrayhand/barepod-panel/backend/internal/webserver"
)

// dbtoolsSweepInterval is how often idle database managers are checked. The idle
// window itself is exact (the supervisor slides it on every request); this is only
// how often the daemon looks.
const dbtoolsSweepInterval = time.Minute

// guardInterval is how often the brute-force lockout looks at the engines' logs. Often
// enough that an attacker cannot get far between two looks, rare enough that the read is
// invisible — and because each pass reads only what was appended since the last one, the
// cost does not grow with how long the log is.
const guardInterval = 15 * time.Second

// httpsPort is the port the panel serves HTTPS on, which the plain-HTTP redirect
// points at. An address with no port yields nothing, so the default is used.
func httpsPort(listen string) string {
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		return ""
	}
	return port
}

// defaultPage is what a web port answers with while nothing is hosted there: a bare
// visit gets a real page ("nothing here yet, the panel is on …") instead of the
// browser's "This site can't be reached". The web-server module replaces it with a
// default vhost of its own once a site owns the port.
const statusPageTemplate = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{code}} · BarePod Panel</title>
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
    .guidance-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 28px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.6;
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
      {{badge}}
    </div>
    <h1>{{title}}</h1>
    <p class="subtitle">{{message}}</p>

    <div class="pipeline">
      <div class="pipe-step">
        <div class="pipe-label"><span>🌐</span> Requested Host</div>
        <div class="pipe-val"><span class="host-highlight">{{host}}</span></div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>⚡</span> Web Server</div>
        <div class="pipe-val status-ok">✓ Online &amp; Responding</div>
      </div>
      <div class="pipe-step">
        <div class="pipe-label"><span>📊</span> Response Status</div>
        <div class="pipe-val status-warn">{{reason}}</div>
      </div>
    </div>

    <div class="guidance-card">
      <h2>ℹ️ Information</h2>
      <p>{{footer}}</p>
    </div>

    <div class="footer">
      <span class="footer-brand">BarePod Web Engine</span>
      <span>HTTP {{code}}</span>
    </div>
  </div>
</body>
</html>`

// statusPage is one branded page the server answers with when a website cannot
// serve the request: no site for this host (404), maintenance (503), and so on.
type statusPage struct {
	Code    int
	Badge   string
	Title   string
	Message string // may contain {{host}}
	Reason  string
	Footer  string
}

var (
	// noSitePage is what a web port serves while no website owns it.
	noSitePage = statusPage{
		Code:    404,
		Badge:   "No site",
		Title:   "Domain Not Connected to a Website",
		Message: "The domain <b>{{host}}</b> resolves to this server's IP address, but has not been configured for any active website.",
		Reason:  "404 — unregistered domain",
		Footer:  "Configure and add this domain in the BarePod panel to begin serving your website.",
	}
	// maintenancePage is the same page for a site under maintenance; the web-server
	// module serves it (HTTP 503) once it owns the port.
	maintenancePage = statusPage{
		Code:    503,
		Badge:   "HTTP 503",
		Title:   "Under Scheduled Maintenance",
		Message: "We are performing scheduled infrastructure maintenance and system updates. Service will be back online shortly.",
		Reason:  "503 — service unavailable",
		Footer:  "This page is served by the web server; the application is not running while it is maintained.",
	}
)

// statusPageHandler renders a status page for every request on a web port.
func statusPageHandler(page statusPage) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		if page.Code == 404 {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(webserver.Default404HTML(host)))
			return
		}
		escaped := html.EscapeString(host)
		body := strings.NewReplacer(
			"{{code}}", strconv.Itoa(page.Code),
			"{{badge}}", html.EscapeString(page.Badge),
			"{{title}}", html.EscapeString(page.Title),
			"{{message}}", strings.ReplaceAll(page.Message, "{{host}}", escaped),
			"{{reason}}", html.EscapeString(page.Reason),
			"{{footer}}", html.EscapeString(page.Footer),
			"{{host}}", escaped,
		).Replace(statusPageTemplate)
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(page.Code)
		_, _ = w.Write([]byte(body))
	})
}

// redirectingListener serves the panel's HTTPS port and turns a plain-HTTP request
// on that same port into a redirect: a browser that typed http://host:8443 is sent
// to https://host:8443 instead of Go's "Client sent an HTTP request to an HTTPS
// server". A real TLS handshake is passed through untouched.
type redirectingListener struct {
	net.Listener
	tlsConfig *tls.Config
	httpsPort string
}

func (l *redirectingListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		wrapped := &peekedConn{Conn: conn, reader: bufio.NewReader(conn)}
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		first, err := wrapped.reader.Peek(1)
		_ = conn.SetReadDeadline(time.Time{})
		if err != nil {
			_ = conn.Close()
			continue
		}
		if first[0] == 0x16 { // a TLS ClientHello: let the TLS server take it
			return tls.Server(wrapped, l.tlsConfig), nil
		}
		go l.answerRedirect(wrapped)
	}
}

// answerRedirect reads just enough of the plain request to name the host and path,
// then answers 308 to the matching https URL and closes.
func (l *redirectingListener) answerRedirect(conn *peekedConn) {
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	req, err := http.ReadRequest(conn.reader)
	if err != nil {
		return
	}
	host := req.Host
	if h, _, err := net.SplitHostPort(req.Host); err == nil {
		host = h
	}
	target := "https://" + host
	if l.httpsPort != "" && l.httpsPort != "443" {
		target += ":" + l.httpsPort
	}
	target += req.URL.RequestURI()
	_, _ = fmt.Fprintf(conn, "HTTP/1.1 308 Permanent Redirect\r\nLocation: %s\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", target)
}

// peekedConn keeps the bytes the first-byte probe buffered, so whatever reads the
// connection next (the TLS server) sees the whole stream from the start.
type peekedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *peekedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

// runServe starts the daemon.
func runServe(args []string) error {
	cfg, err := config.Load(args)
	if err != nil {
		return err
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	defer func() { _ = st.Close() }()

	// Ensure interactive terminal MOTD banner exists
	ensureProfileMOTD()

	// Synchronize any existing stopped/maintenance pages to the latest design
	if n := webserver.SyncAllMaintenancePages(); n > 0 {
		log.Printf("refreshed %d maintenance/stopped website page(s) to unified card design", n)
	}

	// An install job cannot survive its own daemon: the goroutine that would write the final
	// status dies with the process, while the steps themselves (run under systemd) carry on
	// and usually finish. So a job left unfinished is marked as such rather than reading
	// "running" forever.
	if n, err := st.InterruptRunningStackJobs(stack.JobSlug,
		"the daemon restarted while this ran — its steps were run by systemd and may have finished; check the host"); err == nil && n > 0 {
		log.Printf("marked %d interrupted install job(s)", n)
	}

	key, err := secrets.LoadOrCreateKey(cfg.KeyPath)
	if err != nil {
		return fmt.Errorf("load secrets key: %w", err)
	}

	// Installation flow: the panel refuses to start without an account, so a
	// fresh install always goes through `barepod admin create` (which prints
	// the generated password once).
	users, err := st.CountUsers()
	if err != nil {
		return err
	}
	if users == 0 {
		return fmt.Errorf("no panel accounts exist yet\n\n" +
			"Create the root admin first:\n" +
			"  barepod admin create\n\n" +
			"then start the daemon again with the same -db value")
	}

	// The built-in permission groups are the only data the panel creates itself.
	if n, err := st.EnsureDefaultGroups(); err != nil {
		return fmt.Errorf("seed default groups: %w", err)
	} else if n > 0 {
		log.Printf("created %d built-in permission groups", n)
	}

	caps := sysinfo.Detect()
	dryRun := cfg.DryRun || runtime.GOOS != "linux" || !caps.Systemd
	runner := host.Runner(host.RealRunner{})
	if dryRun {
		runner = &host.DryRunner{}
	}
	h := &host.Host{Runner: runner, SitesRoot: cfg.SitesRoot, UnitsDir: cfg.UnitsDir, VHostsDir: cfg.VHostsDir, WebUser: cfg.WebUser}
	_ = h.MigrateLegacyTenants(context.Background())
	deploys := deploy.NewManager(st, h, key)
	deploys.SetRedisURL(cfg.RedisURL)
	tenants := tenant.New(runner, cfg.SitesRoot, caps)

	// On-demand database managers (pgweb). A previous daemon may have left one
	// running and nothing knows how long it has been idle, so leftovers are
	// cleared at start; a sweeper then stops the ones that go idle.
	tools := dbtools.New(runner, cfg.DbtoolsIdle)
	// A manager's output is kept beside the panel database (a root-only directory),
	// so a start that fails reports the tool's own reason instead of a bare timeout.
	tools.LogDir = filepath.Dir(cfg.DBPath)
	// Reconcile, guard adoption, exposure reconciliation and engine auto-tune all run after the
	// panel is listening — see the startup-reconciliation block below. They are host work that can
	// take a few seconds, and doing them first left the port unbound for that whole time.

	// Metrics run in the background so history exists even while nobody is
	// looking at the UI.
	metricsCtx, stopMetrics := context.WithCancel(context.Background())
	defer stopMetrics()
	sampler := metrics.NewSampler(metrics.NewCollector(cfg.SitesRoot), cfg.MetricsInterval, cfg.MetricsHistory)
	siteSampler := metrics.NewSiteSampler(cfg.MetricsHistory)
	listSlugs := func() []string {
		sites, err := st.ListWebsites()
		if err != nil {
			return nil
		}
		slugs := make([]string, 0, len(sites))
		for _, site := range sites {
			slugs = append(slugs, site.Slug)
		}
		return slugs
	}
	go sampler.Start(metricsCtx)
	go siteSampler.Run(metricsCtx, listSlugs, cfg.MetricsInterval)

	// Aggregated history lives in its own SQLite file, so a busy writer never
	// contends with the panel tables and the file can be pruned or removed alone.
	var metricsDB *metrics.Persistence
	if cfg.MetricsDBPath != "" {
		opened, err := metrics.OpenPersistence(cfg.MetricsDBPath)
		if err != nil {
			log.Printf("metrics: persistence disabled: %v", err)
		} else {
			metricsDB = opened
			defer metricsDB.Close()
			go metrics.NewPersister(metricsDB, st, sampler, siteSampler, listSlugs).Run(metricsCtx)
			log.Printf("metrics: aggregated history in %s", cfg.MetricsDBPath)
		}
	}
	log.Printf("metrics: sampling every %s (history %d samples, source %s)",
		cfg.MetricsInterval, cfg.MetricsHistory, sampler.Collector().Mode())

	// Sweeper: an on-demand manager idle past the window is stopped, and the
	// reason is audited so the panel can say why it went away.
	toolsCtx, stopTools := context.WithCancel(context.Background())
	defer stopTools()
	go func() {
		ticker := time.NewTicker(dbtoolsSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-toolsCtx.Done():
				return
			case <-ticker.C:
				stopped, failed := tools.Sweep(toolsCtx)
				for _, why := range failed {
					log.Printf("dbtools: idle manager could not be stopped — %s", why)
				}
				for _, name := range stopped {
					log.Printf("dbtools: stopped %s after %s idle", name, tools.IdleTimeout())
					_ = st.Audit("", "database.gui_idle", name, "", "manager stopped after being idle")
				}
			}
		}
	}()

	// Brute-force lockout: the watchdog reads the engines' own logs (a host engine's file,
	// a container's `docker logs`) and keeps the addresses that keep failing out of them, in
	// the kernel's own nft set as well as in the panel — so a restart re-applies every ban
	// instead of forgetting it. It must run before any database port is opened to the world.
	guardCtx, stopGuard := context.WithCancel(context.Background())
	defer stopGuard()
	watchdog := api.NewGuard(api.GuardExecutor(h.Runner.Run), st, guardInterval, cfg.RedisURL, log.Printf)
	// Which door a ban closes. The panel's own port comes from how the daemon was started and SSH's is
	// the standard one: tripping either lockout must not take away the way back in, which is what
	// happened while every ban was host-wide.
	panelPort := 0
	if _, port, err := net.SplitHostPort(cfg.Listen); err == nil {
		if parsed, err := strconv.Atoi(port); err == nil {
			panelPort = parsed
		}
	}
	// Both doors read from the host: the panel's from how the daemon was started, SSH's from sshd's own
	// configuration, so neither is a number written into the code.
	watchdog.SetScopes(map[string][]int{"panel": {panelPort}})
	go watchdog.Run(guardCtx)
	log.Printf("guard: watching %d log source(s) every %s; table inet %s",
		len(guard.Sources()), guardInterval, guard.Table)

	// A record that says "private" has to be private in the kernel too, not only in the
	// database: without this the port of a containerised engine stayed reachable from the LAN
	// until somebody happened to move the switch. It runs after the panel is listening — see the
	// startup-reconciliation block below.

	// The built-in maintenance scheduler. Its jobs are the ones the panel lists under Cron; each is
	// seeded once — never overwriting an operator's choice — and then run by the daemon on its own
	// schedule. Seeding is idempotent and a failure here only logs: a job list that could not be
	// written must not stop the panel from starting.
	if err := st.EnsureSystemCronJobs(scheduler.Defaults()); err != nil {
		log.Printf("scheduler: could not seed the built-in jobs: %v", err)
	}
	schedulerCtx, stopScheduler := context.WithCancel(context.Background())
	defer stopScheduler()
	go (&scheduler.Scheduler{Store: st, Host: h, Deploy: deploys, Key: key, Caps: caps, Logf: log.Printf}).Run(schedulerCtx)
	log.Printf("scheduler: %d built-in maintenance job(s) available", len(scheduler.Registry()))

	log.Printf("host: %s/%s %q systemd=%v lxc=%v docker=%v smart=%v fstrim=%v",
		caps.OS, caps.Arch, caps.Distro, caps.Systemd, caps.LXC, caps.Docker, caps.Smart, caps.Fstrim)
	log.Printf("execution mode: %s (sites root %s, units dir %s)", h.Mode(), cfg.SitesRoot, cfg.UnitsDir)
	if dryRun {
		log.Print("dry-run: privileged commands are recorded, not executed — websites stay stopped")
	}

	srv := &http.Server{
		Addr: cfg.Listen,
		Handler: api.New(api.Deps{
			Config:         cfg,
			Store:          st,
			Key:            key,
			Host:           h,
			Deploy:         deploys,
			Tenants:        tenants,
			Metrics:        sampler,
			SiteMetrics:    siteSampler,
			MetricsDB:      metricsDB,
			MaxUploadBytes: int64(cfg.MaxUploadMB) << 20,
			Tools:          tools,
			Guard:          watchdog,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE streams must not be cut off
		IdleTimeout:       120 * time.Second,
	}

	certPath, keyPath := cfg.TLSCert, cfg.TLSKey
	if cfg.TLS && (certPath == "" || keyPath == "") {
		generatedCert, generatedKey, err := tlscert.Ensure(filepath.Dir(cfg.DBPath))
		if err != nil {
			return tlscert.ErrorHint(err)
		}
		certPath, keyPath = generatedCert, generatedKey
	}

	var certificate tls.Certificate
	if cfg.TLS {
		loaded, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			return fmt.Errorf("load the panel certificate: %w", err)
		}
		certificate = loaded
	}

	errCh := make(chan error, 1)
	go func() {
		if !cfg.TLS {
			log.Printf("listening on http://%s (version %s)", cfg.Listen, version)
			if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- err
			}
			return
		}
		listener, err := net.Listen("tcp", cfg.Listen)
		if err != nil {
			errCh <- fmt.Errorf("listen on %s: %w", cfg.Listen, err)
			return
		}
		log.Printf("listening on https://%s (certificate %s) (version %s)", cfg.Listen, certPath, version)
		// A plain-HTTP request on this same port is answered with a redirect to
		// HTTPS, instead of Go's bare "Client sent an HTTP request to an HTTPS
		// server" — typing http://host:8443 lands you on https://host:8443.
		redirector := &redirectingListener{
			Listener:  listener,
			httpsPort: httpsPort(cfg.Listen),
			tlsConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12},
		}
		if err := srv.Serve(redirector); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	// Startup reconciliation. Everything below is host work, and it now runs AFTER the panel is
	// listening. It used to run before the listener existed, and repairing a service (AutoHeal), the
	// dbtools and firewall reconciliations and the engine auto-tune could hold the port unbound for
	// several seconds — which is exactly what an in-panel update's refresh landed on, because there
	// was nothing to connect to yet. Binding the port first turns that gap into a blink.
	//
	// The order is preserved from before: the guard's firewall table is adopted before the exposure
	// reconciliation, which needs it to exist.
	if !dryRun {
		// The active ingress comes from the panel's setting, so auto-heal never demotes the
		// engine that is actually serving :80.
		activeWebServer := func() string {
			if v, err := st.PanelSetting("active_web_server"); err == nil {
				return v
			}
			return ""
		}
		for _, act := range stack.AutoHeal(context.Background(), runner, activeWebServer()) {
			log.Printf("[auto-repair] %s", act)
		}
		stack.StartAutoHealWatchdog(context.Background(), runner, 60*time.Second, activeWebServer)
		if _, err := os.Stat("/var/spool/postfix/maildrop"); err == nil {
			_ = os.Chmod("/var/spool/postfix/maildrop", 0o1777)
		}
	}

	reconcileCtx, cancelReconcile := context.WithTimeout(context.Background(), 15*time.Second)
	if adopted := tools.Reconcile(reconcileCtx); len(adopted) > 0 {
		log.Printf("dbtools: adopted %d running manager(s) from a previous daemon: %s (stopped after %s idle)",
			len(adopted), strings.Join(adopted, ", "), tools.IdleTimeout())
	} else {
		log.Printf("dbtools: no managers running from a previous daemon (idle window %s)", tools.IdleTimeout())
	}
	cancelReconcile()

	if err := watchdog.Adopt(context.Background()); err != nil {
		log.Printf("guard: the panel's firewall table could not be prepared: %v", err)
	}
	if applied, err := api.ReconcileExposure(context.Background(), st, h.Runner.Run); err != nil {
		log.Printf("guard: could only reconcile %d port(s) against the firewall set: %v", applied, err)
	} else {
		log.Printf("guard: %d record port(s) reconciled against the firewall set", applied)
	}

	// Hardware-adaptive auto-tuning for engines (MariaDB, PostgreSQL, Redis)
	dbengine.AutoTune(context.Background(), h.Runner, cfg.RedisURL, log.Printf)

	// The server's default page: a bare visit to its address answers — "nothing is
	// hosted on this port yet, the panel is here" — instead of a browser's "This
	// site can't be reached". The web-server module takes this port over later and
	// serves a default vhost of its own.
	// Once a web server is the panel's ingress it owns :80 and serves the same page from its own
	// catch-all vhost. The daemon holding the port as well meant every site on it was answered with
	// "not assigned to any website" while nginx, with a correct vhost, never saw a request.
	// The engine is the saved choice, or nginx when none was saved — the same fallback deploys use
	// to write vhosts — and it counts once its binary is installed.
	ingressEngine := webserver.DefaultEngine
	if v, err := st.PanelSetting("active_web_server"); err == nil && webserver.Supported(strings.TrimSpace(v)) {
		ingressEngine = strings.ToLower(strings.TrimSpace(v))
	}
	ingressActive := webserver.Available(ingressEngine, exec.LookPath)
	if ingressActive {
		log.Printf("the %s ingress serves :80, so the daemon's own default-page listener is off", ingressEngine)
	}
	if cfg.HTTPListen != "" && !ingressActive {
		go func() {
			log.Printf("serving the default page on http://%s (no website is configured there yet)", cfg.HTTPListen)
			if err := http.ListenAndServe(cfg.HTTPListen, statusPageHandler(noSitePage)); err != nil {
				log.Printf("the default-page listener on %s stopped: %v", cfg.HTTPListen, err)
			}
		}()
	}

	// The same default page over TLS, so https://<server>/ answers too.
	if cfg.TLS && cfg.HTTPSListen != "" {
		go func() {
			log.Printf("serving the default page on https://%s", cfg.HTTPSListen)
			listener, err := net.Listen("tcp", cfg.HTTPSListen)
			if err != nil {
				log.Printf("the default-page listener on %s stopped: %v", cfg.HTTPSListen, err)
				return
			}
			page := &http.Server{Handler: statusPageHandler(noSitePage), ReadHeaderTimeout: 10 * time.Second}
			redirector := &redirectingListener{
				Listener:  listener,
				httpsPort: "443",
				tlsConfig: &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12},
			}
			if err := page.Serve(redirector); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("the default-page listener on %s stopped: %v", cfg.HTTPSListen, err)
			}
		}()
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-errCh:
		return fmt.Errorf("listen: %w", err)
	case <-stop:
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
	}
	log.Print("stopped")
	return nil
}

func ensureProfileMOTD() {
	motdPath := "/etc/profile.d/00_barepod.sh"
	if _, err := os.Stat("/etc/profile.d"); err != nil {
		return
	}
	content := `#!/bin/bash
# BarePod Panel Custom MOTD / Interactive Terminal Banner

# Clear scrollback if supported
[ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] && [ -t 1 ] && printf '\033[3J\033[H\033[2J'

CYAN='\033[1;36m'
BLUE='\033[1;34m'
GREEN='\033[1;32m'
PURPLE='\033[1;35m'
AMBER='\033[1;33m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

IP_ADDR=$(ip -4 route get 1 2>/dev/null | sed -n 's/.* src \([0-9.]\+\).*/\1/p' | head -1)
[ -z "$IP_ADDR" ] && IP_ADDR="127.0.0.1"
KERNEL=$(uname -r)
UPTIME=$(uptime -p 2>/dev/null | sed 's/^up //')
USER_NAME=$(whoami)

echo ""
echo -e "${CYAN}  ____                  ____           _${NC}"
echo -e "${CYAN} | __ )  __ _ _ __ ___ |  _ \ ___   __| |${NC}"
echo -e "${CYAN} |  _ \ / _\x60 | '__/ _ \| |_) / _ \ / _\x60 |${NC}"
echo -e "${CYAN} | |_) | (_| | | |  __/|  __/ (_) | (_| |${NC}"
echo -e "${CYAN} |____/ \__,_|_|  \___||_|   \___/ \__,_|${NC}"
echo ""
echo -e "  ${BOLD}BarePod Cloud Platform${NC} ${DIM}• High-Performance Node${NC}"
echo -e "  ${DIM}─────────────────────────────────────────────────────────────${NC}"
echo -e "  💻  OS & Kernel    : Ubuntu $(lsb_release -rs 2>/dev/null || echo '24.04') LTS • ${KERNEL}"
echo -e "  🏠  Hostname       : $(hostname)$([ -f /run/systemd/container ] && echo ' (LXC Node)')"
echo -e "  💡  IP Address     : ${GREEN}${IP_ADDR}${NC}"
echo -e "  🌐  Panel UI       : ${CYAN}https://${IP_ADDR}:8443/${NC}"
echo -e "  👤  Shell User     : ${PURPLE}${USER_NAME}${NC} (interactive PTY)"
echo -e "  ⏰  Host Uptime    : ${UPTIME}"
echo -e "  ${DIM}─────────────────────────────────────────────────────────────${NC}"
echo ""
`
	if current, err := os.ReadFile(motdPath); err != nil || string(current) != content {
		_ = os.WriteFile(motdPath, []byte(content), 0o755)
	}
}
