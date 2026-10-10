package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/api"
	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/deploy"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/secrets"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/tenant"
)

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
			MaxUploadBytes: int64(cfg.MaxUploadMB) << 20,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      0, // SSE streams must not be cut off
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("listening on http://%s (version %s)", cfg.Listen, version)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

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
