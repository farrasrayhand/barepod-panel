package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/api"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/dbtools"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/metrics"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tlscert"
)

// dbtoolsSweepInterval is how often idle database managers are checked. The idle
// window itself is exact (the supervisor slides it on every request); this is only
// how often the daemon looks.
const dbtoolsSweepInterval = time.Minute

// httpsPort is the port the panel serves HTTPS on, which the plain-HTTP redirect
// points at. An address with no port yields nothing, so the default is used.
func httpsPort(listen string) string {
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		return ""
	}
	return port
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
	h := &host.Host{Runner: runner, SitesRoot: cfg.SitesRoot, UnitsDir: cfg.UnitsDir}
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
	tools.Reconcile(reconcileCtx)
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
				for _, name := range tools.Sweep(toolsCtx) {
					log.Printf("dbtools: stopped %s after %s idle", name, tools.IdleTimeout())
					_ = st.Audit("", "database.gui_idle", name, "", "manager stopped after being idle")
				}
			}
		}
	}()

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

	errCh := make(chan error, 1)
	go func() {
		if !cfg.TLS {
			log.Printf("listening on http://%s (version %s)", cfg.Listen, version)
			if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				errCh <- err
			}
			return
		}
		certificate, err := tls.LoadX509KeyPair(certPath, keyPath)
		if err != nil {
			errCh <- fmt.Errorf("load the panel certificate: %w", err)
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

	// A plain-HTTP request is not answered but sent to HTTPS: the session cookie is
	// Secure, so serving the panel in the clear would be a lie.
	if cfg.TLS && cfg.HTTPListen != "" {
		port := httpsPort(cfg.Listen)
		go func() {
			log.Printf("redirecting http://%s to https://%s", cfg.HTTPListen, cfg.Listen)
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				host := r.Host
				if h, _, err := net.SplitHostPort(r.Host); err == nil {
					host = h
				}
				target := "https://" + host
				if port != "" && port != "443" {
					target += ":" + port
				}
				http.Redirect(w, r, target+r.URL.RequestURI(), http.StatusPermanentRedirect)
			})
			if err := http.ListenAndServe(cfg.HTTPListen, handler); err != nil {
				log.Printf("the HTTP redirect listener on %s stopped: %v", cfg.HTTPListen, err)
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
