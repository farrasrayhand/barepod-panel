package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"runtime"
	"strconv"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/service"
)

// runService implements `barepod service install|status|uninstall`.
func runService(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: barepod service <install|status|uninstall> [serve flags]")
	}
	switch args[0] {
	case "install":
		return serviceInstall(args[1:])
	case "status":
		return serviceStatus(args[1:])
	case "uninstall":
		return serviceUninstall(args[1:])
	default:
		return fmt.Errorf("unknown service command %q", args[0])
	}
}

// hostRunner picks real work on Linux (the daemon runs as root there) and the
// dry-run recorder anywhere else, matching the rest of the CLI.
func hostRunner(dryRun bool) host.Runner {
	if dryRun || runtime.GOOS != "linux" {
		return &host.DryRunner{}
	}
	return host.RealRunner{}
}

func serviceInstall(args []string) error {
	// The same flags as `serve`, so the unit is written from the real config.
	cfg, err := config.Load(args)
	if err != nil {
		return err
	}

	args2 := []string{
		"serve",
		"-listen", cfg.Listen,
		"-db", cfg.DBPath,
		"-key", cfg.KeyPath,
		"-static", cfg.StaticDir,
		"-sites-root", cfg.SitesRoot,
		"-units-dir", cfg.UnitsDir,
		"-metrics-interval", cfg.MetricsInterval.String(),
		"-metrics-history", strconv.Itoa(cfg.MetricsHistory),
		"-metrics-db", cfg.MetricsDBPath,
		"-log-level", cfg.LogLevel,
	}
	if cfg.DryRun {
		args2 = append(args2, "-dry-run")
	}

	spec := service.Spec{Args: args2, UnitsDir: cfg.UnitsDir}
	runner := hostRunner(cfg.DryRun)
	result, err := service.Install(context.Background(), runner, spec)
	if err != nil {
		return err
	}

	fmt.Printf("Unit written: %s\n", result.UnitPath)
	for _, command := range result.Commands {
		fmt.Printf("  ran: %s\n", command)
	}
	if result.Mode == "dry-run" {
		fmt.Println("\nDry-run: nothing was executed on this host (not Linux, or -dry-run was given).")
		return nil
	}
	status := service.Query(context.Background(), runner, cfg.UnitsDir, spec.Name)
	fmt.Printf("\nbarepod.service: active=%s enabled=%s\n", status.Active, status.Enabled)
	fmt.Println("Logs: journalctl -u barepod -f")
	return nil
}

func serviceStatus(args []string) error {
	fs := flag.NewFlagSet("barepod service status", flag.ContinueOnError)
	unitsDir := fs.String("units-dir", "", "systemd units directory (default /etc/systemd/system)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	runner := host.RealRunner{}
	status := service.Query(context.Background(), runner, *unitsDir, service.DefaultName)
	fmt.Printf("barepod.service: installed=%t active=%s enabled=%s\n",
		status.Installed, status.Active, status.Enabled)
	return nil
}

func serviceUninstall(args []string) error {
	fs := flag.NewFlagSet("barepod service uninstall", flag.ContinueOnError)
	unitsDir := fs.String("units-dir", "", "systemd units directory (default /etc/systemd/system)")
	dryRun := fs.Bool("dry-run", false, "record the commands instead of running them")
	if err := fs.Parse(args); err != nil {
		return err
	}

	result, err := service.Uninstall(context.Background(), hostRunner(*dryRun), *unitsDir, service.DefaultName)
	if err != nil {
		return err
	}
	for _, command := range result.Commands {
		fmt.Printf("ran: %s\n", command)
	}
	fmt.Printf("Removed %s\n", result.UnitPath)
	return nil
}
