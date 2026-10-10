// Package sysinfo reports host capabilities so the UI can degrade gracefully
// (for example: no S.M.A.R.T. or fstrim inside an unprivileged LXC container).
package sysinfo

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// Capabilities describes what the daemon can actually do on this host.
type Capabilities struct {
	OS           string `json:"os"`
	Arch         string `json:"arch"`
	Kernel       string `json:"kernel"`
	Distro       string `json:"distro"`
	Systemd      bool   `json:"systemd"`
	LXC          bool   `json:"lxc"`
	Docker       bool   `json:"docker"`
	Smart        bool   `json:"smart"`
	Fstrim       bool   `json:"fstrim"`
	SystemdState string `json:"systemdState"`
}

func has(bin string) bool {
	_, err := exec.LookPath(bin)
	return err == nil
}

func readTrim(path string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func detectDistro() string {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "PRETTY_NAME=") {
			return strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
		}
	}
	return ""
}

// Detect inspects the host and returns its capabilities.
func Detect() Capabilities {
	systemd := has("systemctl")
	// systemd-detect-virt is the authoritative source when available.
	virt := ""
	if has("systemd-detect-virt") {
		if out, err := exec.Command("systemd-detect-virt").Output(); err == nil {
			virt = strings.TrimSpace(string(out))
		}
	}
	lxc := virt == "lxc" || virt == "lxc-libvirt"
	if !lxc {
		if env, err := os.ReadFile("/proc/1/environ"); err == nil {
			lxc = strings.Contains(string(env), "container=lxc")
		}
	}
	state := "absent"
	if systemd {
		state = "available"
	}

	return Capabilities{
		OS:           runtime.GOOS,
		Arch:         runtime.GOARCH,
		Kernel:       readTrim("/proc/sys/kernel/osrelease"),
		Distro:       detectDistro(),
		Systemd:      systemd,
		LXC:          lxc,
		Docker:       has("docker"),
		Smart:        has("smartctl"),
		Fstrim:       has("fstrim") && !lxc,
		SystemdState: state,
	}
}
