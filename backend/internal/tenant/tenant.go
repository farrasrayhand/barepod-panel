// Package tenant manages the Linux accounts that isolate one panel account from
// another (one OS user per tenant, home at <homeBase>/<tenant>).
//
// Every privileged command goes through host.Runner, so the module can be
// exercised end-to-end in dry-run mode — on macOS, or in an unprivileged LXC
// container — without touching real accounts. Directory layout is created for
// real (it is not privileged); ownership and accounts are not.
package tenant

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
	"github.com/farrasrayhand/barepod-panel/backend/internal/validate"
)

// Options configures a tenant account.
type Options struct {
	Shell       string // defaults to /usr/sbin/nologin
	QuotaBytes  int64  // soft+hard disk quota; 0 = unlimited
	QuotaInodes int64  // optional inode quota
	Filesystem  string // filesystem for setquota, e.g. "/"
}

// Result reports what was actually done.
type Result struct {
	User     string   `json:"user"`
	Home     string   `json:"home"`
	Created  bool     `json:"created"`
	Commands []string `json:"commands"`
	QuotaSet bool     `json:"quotaSet"`
	Notes    []string `json:"notes,omitempty"`
}

// Apps is the directory holding the tenant's websites.
func (r *Result) Apps() string { return filepath.Join(r.Home, "apps") }

// Manager provisions and locks tenant accounts.
type Manager struct {
	runner   host.Runner
	homeBase string
	caps     sysinfo.Capabilities
}

// New builds a tenant manager. caps decides which steps are possible here.
func New(runner host.Runner, homeBase string, caps sysinfo.Capabilities) *Manager {
	if runner == nil {
		runner = &host.DryRunner{}
	}
	return &Manager{runner: runner, homeBase: homeBase, caps: caps}
}

// Mode reports "real" or "dry-run".
func (m *Manager) Mode() string { return m.runner.Mode() }

func (m *Manager) real() bool { return m.runner.Mode() == "real" }

// Home is the tenant home directory.
func (m *Manager) Home(user string) string { return filepath.Join(m.homeBase, user) }

// Apps is the directory holding the tenant's websites.
func (m *Manager) Apps(user string) string { return filepath.Join(m.Home(user), "apps") }

// accountExists asks the OS whether the account is already there.
// In dry-run nothing is ever created, so it reports false.
func (m *Manager) accountExists(ctx context.Context, user string) bool {
	if !m.real() {
		return false
	}
	out, err := m.runner.Run(ctx, "", "id", "-u", user)
	if err != nil {
		return false
	}
	_, convErr := strconv.Atoi(strings.TrimSpace(out))
	return convErr == nil
}

// Provision makes sure the tenant account and its layout exist.
// log receives human-readable progress lines (it may be nil).
func (m *Manager) Provision(ctx context.Context, user string, opts Options, log func(string)) (*Result, error) {
	if !validate.TenantUser(user) {
		return nil, fmt.Errorf("tenant: %q is not a valid Linux account name", user)
	}
	if log == nil {
		log = func(string) {}
	}

	res := &Result{User: user, Home: m.Home(user)}
	shell := opts.Shell
	if shell == "" {
		shell = "/usr/sbin/nologin"
	}
	useraddArgv := []string{"useradd", "--create-home", "--shell", shell, "--comment", "BarePod tenant", user}

	switch {
	case !m.caps.Useradd && m.real():
		res.Notes = append(res.Notes, "useradd is not available on this host — the account was not created")
	case m.real() && m.accountExists(ctx, user):
		res.Notes = append(res.Notes, "the Linux account already exists")
		log("Linux account " + user + " already exists")
	default:
		if err := m.run(ctx, res, useraddArgv); err != nil {
			return res, fmt.Errorf("tenant: create account: %w", err)
		}
		if m.real() {
			res.Created = true
			log("created Linux account " + user)
		} else {
			res.Notes = append(res.Notes, "dry-run: the Linux account was not created")
			log("dry-run: would create the Linux account " + user)
		}
	}

	// The directory layout is created for real (it needs no privilege); the
	// runner decides whether the chmod/chown it records are actually executed.
	apps := m.Apps(user)
	if err := os.MkdirAll(apps, 0o750); err != nil {
		return res, fmt.Errorf("tenant: create %s: %w", apps, err)
	}

	if err := m.run(ctx, res, []string{"chmod", "0750", m.Home(user)}); err != nil {
		return res, fmt.Errorf("tenant: lock down home: %w", err)
	}
	if err := m.run(ctx, res, []string{"chown", "-R", user + ":" + user, m.Home(user)}); err != nil {
		return res, fmt.Errorf("tenant: chown home: %w", err)
	}
	if !m.real() {
		res.Notes = append(res.Notes, "dry-run: home ownership and permissions were not applied")
	}

	if opts.QuotaBytes > 0 {
		if err := m.setQuota(ctx, res, opts, log); err != nil {
			return res, err
		}
	}
	return res, nil
}

// setQuota applies a disk quota, or explains why it could not.
func (m *Manager) setQuota(ctx context.Context, res *Result, opts Options, log func(string)) error {
	if !m.caps.Quota {
		res.Notes = append(res.Notes, "disk quota tools (setquota) are not available on this host — quota skipped")
		log("disk quota skipped: setquota is not available")
		return nil
	}
	fs := opts.Filesystem
	if fs == "" {
		fs = "/"
	}
	blocks := opts.QuotaBytes / 1024
	inodes := opts.QuotaInodes
	argv := []string{
		"setquota", "-u", res.User,
		strconv.FormatInt(blocks, 10), strconv.FormatInt(blocks, 10),
		strconv.FormatInt(inodes, 10), strconv.FormatInt(inodes, 10),
		fs,
	}
	if err := m.run(ctx, res, argv); err != nil {
		return fmt.Errorf("tenant: setquota: %w", err)
	}
	// The command is recorded either way, but only a real run applied it.
	res.QuotaSet = m.real()
	if m.real() {
		log(fmt.Sprintf("disk quota applied: %d MiB on %s", opts.QuotaBytes/(1024*1024), fs))
	} else {
		res.Notes = append(res.Notes, "dry-run: the disk quota was not applied")
		log(fmt.Sprintf("dry-run: would apply a %d MiB disk quota on %s", opts.QuotaBytes/(1024*1024), fs))
	}
	return nil
}

// Account is the resolved OS identity of a tenant.
type Account struct {
	Name string `json:"name"`
	UID  int    `json:"uid"`
	GID  int    `json:"gid"`
	Home string `json:"home"`
}

// Lookup resolves the OS identity of a tenant account. It reports ok=false in
// dry-run (nothing was created) or when the account does not exist, so callers
// can fall back to running as the daemon's own user.
func (m *Manager) Lookup(ctx context.Context, user string) (Account, bool) {
	if !m.real() || !validate.TenantUser(user) {
		return Account{}, false
	}
	uid, err := m.lookupID(ctx, "-u", user)
	if err != nil {
		return Account{}, false
	}
	gid, err := m.lookupID(ctx, "-g", user)
	if err != nil {
		return Account{}, false
	}
	return Account{Name: user, UID: uid, GID: gid, Home: m.Home(user)}, true
}

func (m *Manager) lookupID(ctx context.Context, flag, user string) (int, error) {
	out, err := m.runner.Run(ctx, "", "id", flag, user)
	if err != nil {
		return 0, err
	}
	value, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, err
	}
	return value, nil
}

// Lock disables the account (used when a panel user is suspended).
func (m *Manager) Lock(ctx context.Context, user string) error {
	if !validate.TenantUser(user) {
		return fmt.Errorf("tenant: %q is not a valid Linux account name", user)
	}
	res := &Result{User: user}
	return m.run(ctx, res, []string{"usermod", "--lock", user})
}

// Unlock re-enables the account.
func (m *Manager) Unlock(ctx context.Context, user string) error {
	if !validate.TenantUser(user) {
		return fmt.Errorf("tenant: %q is not a valid Linux account name", user)
	}
	res := &Result{User: user}
	return m.run(ctx, res, []string{"usermod", "--unlock", user})
}

// run executes one command, recording it in the result.
func (m *Manager) run(ctx context.Context, res *Result, argv []string) error {
	res.Commands = append(res.Commands, strings.Join(argv, " "))
	out, err := m.runner.Run(ctx, "", argv[0], argv[1:]...)
	if err != nil {
		if msg := strings.TrimSpace(out); msg != "" {
			return fmt.Errorf("%w: %s", err, msg)
		}
		return err
	}
	return nil
}
