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
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/api"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/guard"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/stack"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tlscert"
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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{code}} · BarePod Panel</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#0f172a;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{width:100%;max-width:34rem;background:#fff;border:1px solid #e2e8f0;border-radius:20px;box-shadow:0 10px 30px rgba(15,23,42,.06);padding:40px 36px;text-align:center}
@keyframes bounce{0%,100%{transform:translateY(-18%);animation-timing-function:cubic-bezier(.8,0,1,1)}50%{transform:none;animation-timing-function:cubic-bezier(0,0,.2,1)}}
@keyframes ping{75%,100%{transform:scale(2.4);opacity:0}}
.icon{position:relative;width:80px;height:80px;border-radius:24px;background:#eef2ff;border:1px solid #c7d2fe;color:#4f46e5;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;animation:bounce 1.6s infinite}
.icon svg{width:40px;height:40px}
.pill{position:absolute;top:-8px;right:-10px;background:#6366f1;color:#fff;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
h1{margin:0 0 8px;font-size:24px;font-weight:900;letter-spacing:-.02em}
p{margin:0;color:#475569}
.box{margin-top:24px;text-align:left;background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 16px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0}
.row:last-child{border-bottom:0}
.row b,.row code{color:#0f172a;font-weight:700}
.row code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:500}
.dot{position:relative;display:inline-block;width:8px;height:8px;border-radius:999px;background:#f59e0b;margin-right:6px}
.dot::after{content:"";position:absolute;inset:0;border-radius:999px;background:#f59e0b;animation:ping 1.4s cubic-bezier(0,0,.2,1) infinite}
.amber{color:#b45309;font-weight:700}
a{color:#2563eb;font-weight:600;text-decoration:none}
a:hover{text-decoration:underline}
.footer{margin-top:20px;font-size:11px;color:#94a3b8}
@media (prefers-reduced-motion: reduce){.icon,.dot::after{animation:none}}
</style></head>
<body><main class="card">
<div class="icon">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>
<span class="pill">{{badge}}</span>
</div>
<h1>{{title}}</h1>
<p>{{message}}</p>
<div class="box">
<div class="row"><span>Server</span><b>BarePod Web Engine</b></div>
<div class="row"><span>Requested host</span><code>{{host}}</code></div>
<div class="row"><span>Status</span><span class="amber"><span class="dot"></span>{{reason}}</span></div>
<div class="row"><span>Panel</span>{{panel}}</div>
</div>
<p class="footer">{{footer}}</p>
</main></body></html>`

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
		Title:   "Nothing is hosted here yet",
		Message: "This server is running <b>BarePod Panel</b>, but no website is configured for <b>{{host}}</b>.",
		Reason:  "404 — no website configured",
		Footer:  "Add a website from the panel and it will answer on this address.",
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

// statusPageHandler renders a status page for every request on a web port, with the
// request's host and the panel's address filled in.
func statusPageHandler(page statusPage, panelPort string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		escaped := html.EscapeString(host)
		panel := "its own port"
		if panelPort != "" && panelPort != "443" {
			url := "https://" + escaped + ":" + panelPort
			panel = `<a href="` + url + `">` + url + `</a>`
		}
		body := strings.NewReplacer(
			"{{code}}", strconv.Itoa(page.Code),
			"{{badge}}", html.EscapeString(page.Badge),
			"{{title}}", html.EscapeString(page.Title),
			"{{message}}", strings.ReplaceAll(page.Message, "{{host}}", escaped),
			"{{reason}}", html.EscapeString(page.Reason),
			"{{footer}}", html.EscapeString(page.Footer),
			"{{host}}", escaped,
			"{{panel}}", panel,
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
	deploys := deploy.NewManager(st, h, key)
	tenants := tenant.New(runner, cfg.SitesRoot, caps)

	// On-demand database managers (pgweb). A previous daemon may have left one
	// running and nothing knows how long it has been idle, so leftovers are
	// cleared at start; a sweeper then stops the ones that go idle.
	tools := dbtools.New(runner, cfg.DbtoolsIdle)
	// A manager's output is kept beside the panel database (a root-only directory),
	// so a start that fails reports the tool's own reason instead of a bare timeout.
	tools.LogDir = filepath.Dir(cfg.DBPath)
	reconcileCtx, cancelReconcile := context.WithTimeout(context.Background(), 15*time.Second)
	if adopted := tools.Reconcile(reconcileCtx); len(adopted) > 0 {
		log.Printf("dbtools: adopted %d running manager(s) from a previous daemon: %s (stopped after %s idle)",
			len(adopted), strings.Join(adopted, ", "), tools.IdleTimeout())
	} else {
		log.Printf("dbtools: no managers running from a previous daemon (idle window %s)", tools.IdleTimeout())
	}
	cancelReconcile()

	// Metrics run in the background so history exists even while nobody is
	// looking at the UI.
	metricsCtx, stopMetrics := context.WithCancel(context.Background())
	defer stopMetrics()
	sampler := metrics.NewSampler(metrics.NewCollector(cfg.SitesRoot), cfg.MetricsInterval, cfg.MetricsHistory)
	siteSampler := metrics.NewSiteSampler(cfg.MetricsHistory)
	go sampler.Start(metricsCtx)
	go siteSampler.Run(metricsCtx, func() []string {
		sites, err := st.ListWebsites()
		if err != nil {
			return nil
		}
		slugs := make([]string, 0, len(sites))
		for _, site := range sites {
			slugs = append(slugs, site.Slug)
		}
		return slugs
	}, cfg.MetricsInterval)
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
	// Adopt first and wait for it: the reconciliation below needs the table and its sets to
	// exist, and racing the goroutine left ports out of the set while reporting success —
	// measured, a containerised MongoDB stayed reachable from the LAN that way.
	if err := watchdog.Adopt(context.Background()); err != nil {
		log.Printf("guard: the panel's firewall table could not be prepared: %v", err)
	}
	go watchdog.Run(guardCtx)
	log.Printf("guard: watching %d log source(s) every %s; table inet %s",
		len(guard.Sources()), guardInterval, guard.Table)

	// A record that says "private" has to be private in the kernel too, not only in the
	// database: without this the port of a containerised engine stayed reachable from the LAN
	// until somebody happened to move the switch.
	if applied, err := api.ReconcileExposure(context.Background(), st, h.Runner.Run); err != nil {
		log.Printf("guard: could only reconcile %d port(s) against the firewall set: %v", applied, err)
	} else {
		log.Printf("guard: %d record port(s) reconciled against the firewall set", applied)
	}

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

	// The server's default page: a bare visit to its address answers — "nothing is
	// hosted on this port yet, the panel is here" — instead of a browser's "This
	// site can't be reached". The web-server module takes this port over later and
	// serves a default vhost of its own.
	if cfg.HTTPListen != "" {
		go func() {
			log.Printf("serving the default page on http://%s (no website is configured there yet)", cfg.HTTPListen)
			if err := http.ListenAndServe(cfg.HTTPListen, statusPageHandler(noSitePage, httpsPort(cfg.Listen))); err != nil {
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
			page := &http.Server{Handler: statusPageHandler(noSitePage, httpsPort(cfg.Listen)), ReadHeaderTimeout: 10 * time.Second}
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
