package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"

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
	parentNS := fs.String("parent-mnt-ns", "", "the daemon's mount namespace; masking is refused if this process shares it")
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

	// Where the shell starts: with the home overlay it is the home path (which now
	// *is* the site), otherwise the site's own directory.
	shellDir := spec.SiteDir()
	rooted := false

	// Masking, or overlaying, in the daemon's own namespace would change the real
	// directories for every process on the machine, so refuse that outright.
	var jailErr error
	masked := []string{}
	if *parentNS != "" && terminal.SharesMountNamespace(*parentNS) {
		jailErr = errors.New("this shell shares the daemon's mount namespace, so confining it is unsafe")
	} else if spec.SiteInsideHome() {
		// A jail: the shell is rooted at a minimal tree whose only writable place is
		// this website, so `cd` has nowhere else to go.
		workdir, err := terminal.JailRoot(spec.Home(), spec.SiteDir(), spec.Slug, *uid, *gid)
		jailErr = err
		if err == nil {
			rooted = true
			shellDir = workdir
		}
	} else {
		siblings, err := spec.Siblings()
		if err != nil {
			return fmt.Errorf("pty-exec: %w", err)
		}
		masked, jailErr = terminal.Mask(siblings)
	}

	if jailErr != nil {
		// The shell still opens, but it is not confined and the daemon is told so.
		reportJailStatus(*statusFD, "jailed=0 masked=%d reason=%q", len(masked), jailErr.Error())
		fmt.Fprintf(os.Stderr, "barepod: this shell could not be confined: %v\r\n", jailErr)
	} else if rooted {
		reportJailStatus(*statusFD, "jailed=1 root=%s", spec.SiteDir())
		fmt.Fprintf(os.Stderr, "barepod: this shell is rooted at %s — the rest of the machine is not part of its world\r\n", spec.SiteDir())
	} else {
		reportJailStatus(*statusFD, "jailed=1 masked=%d", len(masked))
		if len(masked) > 0 {
			fmt.Fprintf(os.Stderr, "barepod: confined to %s — %d other path(s) hidden\r\n", spec.SiteDir(), len(masked))
		}
	}

	// Inside the jail, bash gets a small rc file that bounces the prompt back to the
	// website whenever it leaves it. The kernel already makes everything outside
	// read-only and the other sites do not exist; this only stops the *shell* from
	// wandering into the read-only system skeleton.
	if rooted {
		if err := writeProjectGuard(shellDir); err != nil {
			fmt.Fprintf(os.Stderr, "barepod: could not install the directory guard: %v\r\n", err)
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
	if rooted && *command == "" && filepath.Base(sh) == "bash" {
		argv = []string{sh, "--rcfile", projectGuardPath, "-i"}
	}
	if *command != "" {
		argv = []string{sh, "-c", *command}
	}
	return terminal.Exec(sh, argv, terminal.ShellEnv(shellDir, *tenant), shellDir)
}

// projectGuardPath is the rc file installed inside the jail.
const projectGuardPath = "/tmp/.barepod-shell"

// writeProjectGuard drops a tiny rc file into the jail (its /tmp is private, so
// nothing of the project is touched) which wraps cd and checks the prompt.
func writeProjectGuard(project string) error {
	script := `# BarePod: this shell belongs to one website.
[ -r /etc/profile ] && . /etc/profile
[ -r /etc/bash.bashrc ] && . /etc/bash.bashrc
BAREPOD_PROJECT="` + project + `"
cd() {
  builtin cd "$@" 2>/dev/null || return 1
  case "$PWD" in
    "$BAREPOD_PROJECT"|"$BAREPOD_PROJECT"/*) ;;
    *) echo "barepod: this shell lives in $BAREPOD_PROJECT — everything else is read-only" >&2
       builtin cd "$BAREPOD_PROJECT" ;;
  esac
}
barepod_keep_inside() {
  case "$PWD" in
    "$BAREPOD_PROJECT"|"$BAREPOD_PROJECT"/*) ;;
    *) echo "barepod: this shell lives in $BAREPOD_PROJECT" >&2
       builtin cd "$BAREPOD_PROJECT" ;;
  esac
}
PROMPT_COMMAND="barepod_keep_inside${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
`
	return os.WriteFile(projectGuardPath, []byte(script), 0o644)
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
