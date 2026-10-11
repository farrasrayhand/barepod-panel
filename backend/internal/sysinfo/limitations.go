package sysinfo

import "runtime"

// Limitation explains one thing this host cannot do, and what to use instead.
// The UI must show these as guidance, never as an error: a container is a
// supported target, it simply owns fewer things than the host.
type Limitation struct {
	Feature string `json:"feature"` // smart | fstrim | quota | useradd | runAsUser
	Reason  string `json:"reason"`
	Advice  string `json:"advice"`
}

// Limitations lists the unavailable features with actionable advice.
func (c Capabilities) Limitations() []Limitation {
	var out []Limitation
	add := func(feature, reason, advice string) {
		out = append(out, Limitation{Feature: feature, Reason: reason, Advice: advice})
	}

	if !c.Smart {
		add("smart",
			"S.M.A.R.T. needs direct access to the host's block device, which an unprivileged container does not have.",
			"Physical disk health belongs to the container host: run smartctl there, or pass the device through (not recommended). This panel still monitors filesystem and inode usage and disk I/O latency.")
	}
	if !c.Fstrim {
		add("fstrim",
			"An unprivileged container cannot issue a discard to the block device, and /dev/net is usually masked.",
			"Run fstrim on the host (most distributions ship fstrim.timer), or better, enable continuous trim on the storage pool: discard=on for LVM-thin, autotrim=on for ZFS.")
	}
	if !c.Quota {
		add("quota",
			"setquota needs quota support on the host filesystem plus access to the quotactl interface.",
			"Per-tenant disk limits are enforced with host-side quotas instead: XFS project quotas, a ZFS dataset per tenant, or an LVM volume. The package's cgroup v2 limits (memory, CPU, tasks) still apply inside the container.")
	}
	if !c.Useradd {
		add("useradd",
			"The account utilities (useradd/usermod) are not available in this environment.",
			"Install the shadow/passwd utilities in the container, or create the tenant accounts on the host and let the panel attach to them.")
	}
	if !c.RunAsUser {
		add("runAsUser",
			"Running a process as another user needs setuid/setgid, which only exists on Linux.",
			"Run the daemon on Linux: tenant isolation (files owned by the tenant, terminals dropped to the tenant UID) depends on it. On this host everything runs in dry-run mode.")
	}
	if !c.PTYJail {
		add("ptyJail",
			"Confining a tenant shell to its own site needs a private mount namespace, and this host does not allow mounting one (unprivileged container, or not Linux).",
			"Run the daemon in a privileged container or on a plain VPS: the terminal then hides the account's other sites and folders. Without it a website's shell runs as the tenant but can still reach that account's other files.")
	}
	return out
}

// DetectDiskStats reports whether /proc/diskstats can be read, which is what the
// monitoring module uses for I/O latency inside a container.
func DetectDiskStats() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	_, err := readFile("/proc/diskstats")
	return err == nil
}
