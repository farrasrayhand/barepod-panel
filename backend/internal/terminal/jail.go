package terminal

import (
	"os"
	"path/filepath"
	"sort"
	"sync"
)

// JailSpec describes the confinement applied to one site's shell: the shell may
// see the site directory and the rest of the machine's tooling, but not the
// tenant's other sites or the rest of its home.
type JailSpec struct {
	SitesRoot string // e.g. /home
	Tenant    string // e.g. bptest
	Slug      string // e.g. web-flask2
}

// Home is the tenant's home directory.
func (s JailSpec) Home() string { return filepath.Join(s.SitesRoot, s.Tenant) }

// AppsDir holds every site of the tenant.
func (s JailSpec) AppsDir() string { return filepath.Join(s.Home(), "apps") }

// SiteDir is the one directory the shell is meant to work in.
func (s JailSpec) SiteDir() string { return filepath.Join(s.AppsDir(), s.Slug) }

// Siblings lists what a shell opened for one site must not see: the entries of
// the tenant's home other than apps/, and every other site under apps/. This is
// plain filesystem logic, so it is testable on any platform.
func (s JailSpec) Siblings() ([]string, error) {
	out := []string{}

	homeEntries, err := os.ReadDir(s.Home())
	if err != nil {
		return nil, err
	}
	for _, entry := range homeEntries {
		if entry.Name() == "apps" {
			continue
		}
		out = append(out, filepath.Join(s.Home(), entry.Name()))
	}

	appEntries, err := os.ReadDir(s.AppsDir())
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, entry := range appEntries {
		if entry.Name() == s.Slug {
			continue
		}
		out = append(out, filepath.Join(s.AppsDir(), entry.Name()))
	}

	sort.Strings(out)
	return out, nil
}

var (
	jailOnce        sync.Once
	jailAvailable   bool
	jailUnavailable string
)

// JailSupported reports whether a site shell can be confined on this host, and
// why not when it cannot. The probe runs the helper in a throwaway mount
// namespace, so an unprivileged container answers "no" instead of failing at the
// first mount mid-session.
func JailSupported() (bool, string) {
	jailOnce.Do(func() {
		jailAvailable, jailUnavailable = probeJail()
	})
	return jailAvailable, jailUnavailable
}

// MountNamespace names this process's mount namespace, e.g. "mnt:[4026531840]".
// It is empty where /proc/ns is not readable.
func MountNamespace() string {
	inode, err := os.Readlink("/proc/self/ns/mnt")
	if err != nil {
		return ""
	}
	return inode
}

// SharesMountNamespace reports whether this process is in the mount namespace
// named by inode. The daemon passes its own: if a helper ever finds itself in the
// daemon's namespace, the namespace was not private and masking would hide the
// real directories for everyone.
func SharesMountNamespace(inode string) bool {
	if inode == "" {
		return false
	}
	return MountNamespace() == inode
}

// InPrivateNamespace reports whether this process has a mount namespace of its
// own. Masking anywhere else would hide the real directories for the whole
// machine, so Mask refuses to run without it.
func InPrivateNamespace() bool {
	self, err := os.Readlink("/proc/self/ns/mnt")
	if err != nil {
		return false
	}
	init, err := os.Readlink("/proc/1/ns/mnt")
	if err != nil {
		return false
	}
	return self != init
}
