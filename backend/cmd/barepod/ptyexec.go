package main

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/farrasrayhand/barepod-panel/backend/internal/config"
	"github.com/farrasrayhand/barepod-panel/backend/internal/terminal"
)

// runPTYExec is the hidden helper behind a confined site shell. The daemon
// starts it inside a fresh mount namespace; the helper hides the tenant's other
// directories (its other sites and the rest of its home), gives up root and
// becomes the shell. Everything it needs is passed in, so it never has to
// re-derive who it is.
func runPTYExec(args []string) error {
	fs := flag.NewFlagSet("barepod pty-exec", flag.ContinueOnError)
	tenant := fs.String("tenant", "", "tenant account name")
	site := fs.String("site", "", "website slug")
	shell := fs.String("shell", "", "shell to run (absolute path)")
	uid := fs.Int("uid", 0, "uid to drop to")
	gid := fs.Int("gid", 0, "gid to drop to")
	sitesRoot := fs.String("sites-root", "", "sites root")
	statusFD := fs.Int("status-fd", 0, "fd that receives one status line for the daemon")
	command := fs.String("command", "", "run one command instead of an interactive shell (diagnostics)")
	probe := fs.Bool("probe", false, "only check whether a jail can be built here, then exit")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if *probe {
		if err := terminal.MountProbe(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return err
		}
		fmt.Println("jail ok")
		return nil
	}

	if *tenant == "" || *site == "" {
		return errors.New("pty-exec: --tenant and --site are required")
	}
	root := *sitesRoot
	if root == "" {
		root = config.DefaultSitesRoot()
	}
	spec := terminal.JailSpec{SitesRoot: terminal.Abs(root), Tenant: *tenant, Slug: *site}

	siblings, err := spec.Siblings()
	if err != nil {
		return fmt.Errorf("pty-exec: %w", err)
	}

	masked, maskErr := terminal.Mask(siblings)
	if maskErr != nil {
		// The shell still opens, but it is not confined and the daemon is told so.
		reportJailStatus(*statusFD, "jailed=0 masked=%d reason=%q", len(masked), maskErr.Error())
		fmt.Fprintf(os.Stderr, "barepod: this shell could not be confined: %v\r\n", maskErr)
	} else {
		reportJailStatus(*statusFD, "jailed=1 masked=%d", len(masked))
		if len(masked) > 0 {
			fmt.Fprintf(os.Stderr, "barepod: confined to %s — %d other path(s) hidden\r\n", spec.SiteDir(), len(masked))
		}
	}

	if err := terminal.DropPrivileges(*uid, *gid); err != nil {
		return err
	}

	sh := *shell
	if sh == "" {
		sh = terminal.DefaultShell()
	}
	argv := []string{sh, "--login"}
	if *command != "" {
		argv = []string{sh, "-c", *command}
	}
	return terminal.Exec(sh, argv, terminal.ShellEnv(spec.SiteDir(), *tenant), spec.SiteDir())
}

// reportJailStatus writes the one line the daemon reads, then closes the pipe so
// it does not have to wait for a timeout.
func reportJailStatus(fd int, format string, args ...any) {
	if fd <= 0 {
		return
	}
	status := os.NewFile(uintptr(fd), "status")
	if status == nil {
		return
	}
	fmt.Fprintf(status, format+"\n", args...)
	_ = status.Close()
}
