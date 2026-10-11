//go:build linux

package terminal

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// probeJail re-executes this binary in a fresh mount namespace and asks it to
// mount something harmless. If that works, a site shell can be jailed here.
func probeJail() (bool, string) {
	executable, err := os.Executable()
	if err != nil {
		return false, "the daemon cannot find its own executable: " + err.Error()
	}
	cmd := exec.Command(executable, "pty-exec", "--probe")
	cmd.SysProcAttr = &syscall.SysProcAttr{Cloneflags: syscall.CLONE_NEWNS}
	out, err := cmd.CombinedOutput()
	if err != nil {
		reason := strings.TrimSpace(string(out))
		if reason == "" {
			reason = err.Error()
		}
		return false, reason
	}
	return true, ""
}

// makePrivate stops this namespace's mounts from propagating outwards.
//
// A CLONE_NEWNS child inherits the parent's *shared* propagation, so mounting a
// mask without this would publish it to the container (and, with a shared root,
// even to the host): that is exactly how one run left 12 298 masks behind and
// hid a tenant's real directories. Making the tree private first keeps every mask
// inside this shell's namespace.
func makePrivate() error {
	if err := syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, ""); err != nil {
		return fmt.Errorf("terminal: cannot make this mount namespace private (%v)", err)
	}
	return nil
}

// ConfineApps hides the account's other websites: inside this mount namespace the
// `apps` directory becomes a private one that contains only this site, bind-mounted
// at its usual path.
//
// The result keeps the project path (`/home/<tenant>/apps/<site>`), so the prompt
// says which website the shell belongs to, while a sibling is not even a name in a
// listing — unlike masking each neighbour, which hides only its contents.
func ConfineApps(home, siteDir, slug string, uid, gid int) error {
	if err := makePrivate(); err != nil {
		return err
	}
	appsDir := filepath.Join(home, "apps")

	// A scratch tmpfs to build the replacement in. /mnt is the conventional place
	// and, because the whole thing lives in this namespace, nothing is left on the
	// host when the shell exits.
	staging := "/mnt"
	if info, err := os.Stat(staging); err != nil || !info.IsDir() {
		staging = os.TempDir()
	}
	if err := syscall.Mount("tmpfs", staging, "tmpfs", 0, "size=1M"); err != nil {
		return fmt.Errorf("terminal: cannot prepare a private directory (%v)", err)
	}
	// The shell runs as the tenant: everything on the way to the site has to be
	// theirs, or the chdir after dropping privileges fails with permission denied.
	if err := os.Chmod(staging, 0o755); err != nil {
		return err
	}
	replacement := filepath.Join(staging, "apps")
	if err := os.MkdirAll(filepath.Join(replacement, slug), 0o750); err != nil {
		return err
	}
	for _, dir := range []string{replacement, filepath.Join(replacement, slug)} {
		if err := os.Chown(dir, uid, gid); err != nil {
			return fmt.Errorf("terminal: cannot hand %s to the tenant (%v)", dir, err)
		}
	}
	if err := syscall.Mount(siteDir, filepath.Join(replacement, slug), "", syscall.MS_BIND|syscall.MS_REC, ""); err != nil {
		return fmt.Errorf("terminal: cannot bind %s (%v)", siteDir, err)
	}
	if err := syscall.Mount(replacement, appsDir, "", syscall.MS_BIND|syscall.MS_REC, ""); err != nil {
		return fmt.Errorf("terminal: cannot put the private apps directory over %s (%v)", appsDir, err)
	}
	// Cover the scratch area again: the bind above keeps its own reference, so the
	// replacement stays reachable at the project path while the scratch itself is
	// out of sight.
	_ = syscall.Mount("tmpfs", staging, "tmpfs", 0, "size=1M,mode=0000")
	return nil
}

// Mask hides each path inside the current mount namespace: a tmpfs over a
// directory (mode 0000, so the tenant cannot even enter it) and /dev/null over a
// file. Because the mounts belong to this namespace only, the host is untouched
// and they disappear when the shell exits.
func Mask(paths []string) ([]string, error) {
	if !InPrivateNamespace() {
		return nil, errors.New("terminal: refusing to mask outside a private mount namespace")
	}
	if err := makePrivate(); err != nil {
		return nil, err
	}

	masked := make([]string, 0, len(paths))
	for _, target := range paths {
		info, err := os.Lstat(target)
		if err != nil {
			continue // disappeared since the list was built
		}
		if info.IsDir() {
			if err := syscall.Mount("tmpfs", target, "tmpfs", 0, "size=1M,mode=0000"); err != nil {
				return masked, fmt.Errorf("terminal: mask %s: %w", target, err)
			}
		} else if err := syscall.Mount("/dev/null", target, "", syscall.MS_BIND, ""); err != nil {
			return masked, fmt.Errorf("terminal: mask %s: %w", target, err)
		}
		masked = append(masked, target)
	}
	return masked, nil
}

// DropPrivileges gives up root for the tenant's identity. It runs after the
// mounts, because mounting needs privileges the tenant must not have.
func DropPrivileges(uid, gid int) error {
	if uid <= 0 {
		return errors.New("terminal: refusing to start a site shell as root")
	}
	if err := syscall.Setgroups([]int{gid}); err != nil {
		return fmt.Errorf("terminal: setgroups: %w", err)
	}
	if err := syscall.Setgid(gid); err != nil {
		return fmt.Errorf("terminal: setgid: %w", err)
	}
	if err := syscall.Setuid(uid); err != nil {
		return fmt.Errorf("terminal: setuid: %w", err)
	}
	return nil
}

// newJailedCommand builds the helper that runs the shell confined: the child
// starts in its own mount namespace (CLONE_NEWNS, so the mounts cannot leak to
// the host), stays root long enough to mask the tenant's other paths, and then
// drops to the tenant. The status pipe reports what actually happened; the
// returned function must be called once the child is running, so the parent
// stops holding the write end open.
func newJailedCommand(opts Options, shell, dir string, env []string) (*exec.Cmd, *os.File, func(), error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, nil, nil, err
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		return nil, nil, nil, err
	}

	cmd := exec.Command(executable,
		"pty-exec",
		"--tenant", opts.Tenant,
		"--site", opts.Site,
		"--sites-root", opts.SitesRoot,
		"--uid", strconv.Itoa(opts.UID),
		"--gid", strconv.Itoa(opts.GID),
		"--shell", shell,
		"--status-fd", "3",
		"--parent-mnt-ns", MountNamespace(),
	)
	cmd.Dir = dir
	cmd.Env = env
	// fd 3 is the write end of the pipe, so the helper can say "jailed=1 masked=4".
	cmd.ExtraFiles = []*os.File{writer}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Cloneflags: syscall.CLONE_NEWNS,
		Setsid:     true,
	}
	// The child inherits the descriptor when it starts; until then the parent
	// must keep its copy open or the child would write to a closed pipe.
	closeWriter := func() { _ = writer.Close() }
	return cmd, reader, closeWriter, nil
}

// MountProbe is what the helper runs for --probe: a real mount in the current
// namespace, undone right away.
func MountProbe() error {
	if err := makePrivate(); err != nil {
		return err
	}
	dir, err := os.MkdirTemp("", "barepod-jail-")
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(dir) }()

	if err := syscall.Mount("tmpfs", dir, "tmpfs", 0, "size=1M"); err != nil {
		return fmt.Errorf("cannot mount a private tmpfs (%v) — a jail needs CAP_SYS_ADMIN and an unprivileged container often lacks it", err)
	}
	if err := syscall.Unmount(dir, 0); err != nil {
		return fmt.Errorf("cannot unmount the probe: %w", err)
	}
	return nil
}

// SiteDirFor returns the directory a jailed shell starts in, so the helper does
// not have to rebuild the layout.
func SiteDirFor(sitesRoot, tenant, slug string) string {
	return JailSpec{SitesRoot: sitesRoot, Tenant: tenant, Slug: slug}.SiteDir()
}

// Exec replaces the current process with the shell, keeping the namespace.
func Exec(shell string, argv, env []string, dir string) error {
	if err := os.Chdir(dir); err != nil {
		return fmt.Errorf("terminal: chdir %s: %w", dir, err)
	}
	return syscall.Exec(shell, argv, env)
}

// Abs is a small helper used by the CLI so the same file compiles everywhere.
func Abs(path string) string {
	if path == "" {
		return path
	}
	if filepath.IsAbs(path) {
		return path
	}
	out, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return out
}
