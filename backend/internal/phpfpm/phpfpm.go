// Package phpfpm renders the per-site PHP-FPM pool the panel runs as the tenant's
// own master (one master per PHP site, started by the site's systemd unit). The
// config lives inside the site directory, so it is removed with the site and the
// package's cgroup limits (applied to the unit) still bound the process.
package phpfpm

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
)

// Directives holds per-site php_admin_value and process manager customizations.
type Directives struct {
	MemoryLimit        string `json:"memoryLimit,omitempty"`
	UploadMaxSize      string `json:"uploadMaxSize,omitempty"`
	PostMaxSize        string `json:"postMaxSize,omitempty"`
	MaxExecutionTime   int    `json:"maxExecutionTime,omitempty"`
	MaxInputVars       int    `json:"maxInputVars,omitempty"`
	MaxInputTime       int    `json:"maxInputTime,omitempty"`
	ProcessIdleTimeout string `json:"processIdleTimeout,omitempty"`
	DisableFunctions   string `json:"disableFunctions,omitempty"`
}

// Spec describes one site's pool.
type Spec struct {
	Tenant      string
	SiteDir     string
	Socket      string // unix socket path; nginx connects to it
	MaxChildren int    // pm.max_children, from the package's memory allowance
	MemoryMB    int    // PHP's own memory_limit, from the package
	Directives  Directives
}

// SocketIn is where a site's pool socket lives: inside the site directory, so it is
// removed with the site and inherits the directory's web-readable group.
func SocketIn(siteDir string) string { return filepath.Join(siteDir, "fpm.sock") }

// TuneProfile holds auto-tuned PHP-FPM pool settings derived from package or host specs.
type TuneProfile struct {
	MaxChildren        int
	MemoryLimitMB      int
	ProcessIdleTimeout string
	MaxRequests        int
}

// MaxChildren derives a pool size from the package's memory allowance, or
// automatically from the host's RAM and CPU cores when no package limit is set.
func MaxChildren(memoryMB int) int {
	return AutoMaxChildren(memoryMB, resources.DetectMemoryMB(), resources.DetectCPUCores())
}

// AutoMaxChildren computes pm.max_children from a package memory limit (if set)
// or from the host's hardware specs (RAM in MiB and CPU core count) in shared/unlimited mode.
func AutoMaxChildren(packageMemoryMB, hostMemoryMB, hostCPUCores int) int {
	return AutoTune(packageMemoryMB, hostMemoryMB, hostCPUCores).MaxChildren
}

// AutoTune computes PHP-FPM pool parameters from the package memory allowance
// (when capped) or from the host's RAM and CPU cores (when unlimited/shared).
func AutoTune(packageMemoryMB, hostMemoryMB, hostCPUCores int) TuneProfile {
	t := resources.TuneRuntime(packageMemoryMB, hostMemoryMB, hostCPUCores)
	return TuneProfile{
		MaxChildren:        t.PHPMaxChildren,
		MemoryLimitMB:      t.PHPMemoryMB,
		ProcessIdleTimeout: t.PHPIdleTimeout,
		MaxRequests:        t.PHPMaxRequests,
	}
}

// Config renders the pool file. user/group are deliberately absent: the systemd unit
// already runs the master as the tenant, and FPM cannot setuid below that.
func Config(s Spec) string {
	tune := AutoTune(s.MemoryMB, resources.DetectMemoryMB(), resources.DetectCPUCores())
	children := s.MaxChildren
	if children <= 0 {
		children = tune.MaxChildren
	}
	idleTimeout := strings.TrimSpace(s.Directives.ProcessIdleTimeout)
	if idleTimeout == "" {
		idleTimeout = tune.ProcessIdleTimeout
	}
	memLimit := strings.TrimSpace(s.Directives.MemoryLimit)
	if memLimit == "" {
		memLimit = fmt.Sprintf("%dM", tune.MemoryLimitMB)
	}
	uploadMax := strings.TrimSpace(s.Directives.UploadMaxSize)
	if uploadMax == "" {
		uploadMax = "64M"
	}
	postMax := strings.TrimSpace(s.Directives.PostMaxSize)
	if postMax == "" {
		postMax = "64M"
	}

	var b strings.Builder
	b.WriteString("; Managed by BarePod Panel — do not edit by hand.\n")
	b.WriteString("[global]\n")
	fmt.Fprintf(&b, "pid = %s\n", filepath.Join(s.SiteDir, "php-fpm.pid"))
	fmt.Fprintf(&b, "error_log = %s\n", filepath.Join(s.SiteDir, "php-fpm.log"))
	b.WriteString("daemonize = no\n\n")

	b.WriteString("[www]\n")
	fmt.Fprintf(&b, "user = %s\n", s.Tenant)
	fmt.Fprintf(&b, "group = %s\n", s.Tenant)
	fmt.Fprintf(&b, "listen = %s\n", s.Socket)
	b.WriteString("listen.mode = 0666\n")
	b.WriteString("pm = ondemand\n")
	fmt.Fprintf(&b, "pm.max_children = %d\n", children)
	fmt.Fprintf(&b, "pm.process_idle_timeout = %s\n", idleTimeout)
	fmt.Fprintf(&b, "pm.max_requests = %d\n", tune.MaxRequests)
	b.WriteString("catch_workers_output = yes\n")
	fmt.Fprintf(&b, "chdir = %s\n", s.SiteDir)
	// A pool may only reach its own site (plus /tmp): another tenant's files are not
	// a name to it, which is the same boundary the shell jail draws.
	fmt.Fprintf(&b, "php_admin_value[open_basedir] = %s:/tmp\n", s.SiteDir)
	// Harden against web shells by disabling OS shell execution functions while keeping curl_exec and proc_open safe for CMS & frameworks.
	disableFuncs := strings.TrimSpace(s.Directives.DisableFunctions)
	if disableFuncs == "" {
		disableFuncs = "exec,passthru,shell_exec,system,popen,show_source"
	}
	fmt.Fprintf(&b, "php_admin_value[disable_functions] = %s\n", disableFuncs)
	b.WriteString("php_admin_flag[log_errors] = on\n")
	fmt.Fprintf(&b, "php_admin_value[error_log] = %s\n", filepath.Join(s.SiteDir, "php-error.log"))
	fmt.Fprintf(&b, "php_admin_value[memory_limit] = %s\n", memLimit)
	fmt.Fprintf(&b, "php_admin_value[upload_max_filesize] = %s\n", uploadMax)
	fmt.Fprintf(&b, "php_admin_value[post_max_size] = %s\n", postMax)
	if s.Directives.MaxExecutionTime > 0 {
		fmt.Fprintf(&b, "php_admin_value[max_execution_time] = %d\n", s.Directives.MaxExecutionTime)
	}
	if s.Directives.MaxInputVars > 0 {
		fmt.Fprintf(&b, "php_admin_value[max_input_vars] = %d\n", s.Directives.MaxInputVars)
	}
	if s.Directives.MaxInputTime > 0 {
		fmt.Fprintf(&b, "php_admin_value[max_input_time] = %d\n", s.Directives.MaxInputTime)
	}
	return b.String()
}

// Write writes <siteDir>/php-fpm.conf atomically and hands it to the tenant, which
// is what the unit runs the master as.
func Write(ctx context.Context, h *host.Host, s Spec) (string, error) {
	if strings.TrimSpace(s.Tenant) == "" || strings.TrimSpace(s.SiteDir) == "" {
		return "", fmt.Errorf("phpfpm: a tenant and a site directory are required")
	}
	path := filepath.Join(s.SiteDir, "php-fpm.conf")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(Config(s)), 0o600); err != nil {
		return "", fmt.Errorf("phpfpm: write %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return "", fmt.Errorf("phpfpm: %w", err)
	}
	if h.Materialises() {
		if out, err := h.Runner.Run(ctx, "", "chown", s.Tenant+":"+s.Tenant, path); err != nil {
			return "", fmt.Errorf("phpfpm: chown the pool config: %w (%s)", err, strings.TrimSpace(out))
		}
	}
	return path, nil
}
