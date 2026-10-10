//go:build darwin

package metrics

import (
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// darwinCollector lets the daemon run on a development Mac and still show real
// numbers, instead of an empty dashboard. Disk I/O rates are not available from
// a simple cumulative counter on macOS, and are reported as such (0).
type darwinCollector struct {
	sitesRoot string

	primed       bool
	netRx, netTx uint64
}

func newCollector(sitesRoot string) Collector { return &darwinCollector{sitesRoot: sitesRoot} }

// Mode implements Collector.
func (c *darwinCollector) Mode() string { return "darwin" }

// Snapshot implements Collector.
func (c *darwinCollector) Snapshot(_ Snapshot, elapsed time.Duration) (Snapshot, error) {
	snapshot := Snapshot{
		TS:        time.Now().UTC().Format(time.RFC3339),
		Available: true,
	}

	// iostat already returns a percentage for its own sampling interval, so it is
	// used directly instead of being turned into a delta (the synthesised
	// counters would never change and the delta would always be zero).
	cores, cpuPercent := cpuUsage()
	snapshot.CPUCores = cores
	snapshot.CPUPercent = cpuPercent

	snapshot.MemoryTotal = sysctlUint("hw.memsize")
	snapshot.MemoryUsedBytes = memoryUsed(snapshot.MemoryTotal)
	snapshot.SwapTotalBytes, snapshot.SwapUsedBytes = swapUsage()

	snapshot.Load1, snapshot.Load5, snapshot.Load15 = loadAvg()
	snapshot.UptimeSeconds = uptime()

	rx, tx := netBytes()
	if c.primed {
		snapshot.NetRxBps = Rate(Delta(rx, c.netRx), elapsed)
		snapshot.NetTxBps = Rate(Delta(tx, c.netTx), elapsed)
	}
	c.netRx, c.netTx = rx, tx

	if used, total, err := diskUsage(c.sitesRoot); err == nil {
		snapshot.DiskUsedBytes = used
		snapshot.DiskTotalBytes = total
	}

	c.primed = true
	return snapshot, nil
}

func sysctl(args ...string) string {
	out, err := exec.Command("sysctl", append([]string{"-n"}, args...)...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func sysctlUint(key string) uint64 {
	value, err := strconv.ParseUint(sysctl(key), 10, 64)
	if err != nil {
		return 0
	}
	return value
}

// cpuUsage reports (cores, busy percent) from iostat.
//
// macOS no longer exposes kern.cp_time, so `iostat -c 2` is used: its last line
// is a real sample over the previous second.
func cpuUsage() (int, float64) {
	cores := int(sysctlUint("hw.ncpu"))
	if cores == 0 {
		cores = runtime.NumCPU()
	}
	busy, ok := iostatCPU()
	if !ok {
		return cores, 0
	}
	if busy < 0 {
		busy = 0
	}
	if busy > 100 {
		busy = 100
	}
	return cores, busy
}

// iostatCPU runs `iostat -c 2 -n 2` and returns us+sy of the last sample.
func iostatCPU() (float64, bool) {
	out, err := exec.Command("iostat", "-c", "2", "-n", "2").Output()
	if err != nil {
		return 0, false
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	// The number of leading disk columns varies (one per disk), so read the
	// interesting columns from the right: us sy id 1m 5m 15m.
	for i := len(lines) - 1; i >= 0; i-- {
		fields := strings.Fields(lines[i])
		if len(fields) < 6 {
			continue
		}
		user, err1 := strconv.ParseFloat(fields[len(fields)-6], 64)
		system, err2 := strconv.ParseFloat(fields[len(fields)-5], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		return user + system, true
	}
	return 0, false
}

// memoryUsed approximates "available" from vm_stat like MemAvailable on Linux.
func memoryUsed(total uint64) uint64 {
	if total == 0 {
		return 0
	}
	out, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0
	}
	pageSize := uint64(4096)
	var free, inactive, speculative uint64
	for _, line := range strings.Split(string(out), "\n") {
		if strings.Contains(line, "page size of") {
			fields := strings.Fields(line)
			for i, field := range fields {
				if field == "of" && i+1 < len(fields) {
					if size, err := strconv.ParseUint(fields[i+1], 10, 64); err == nil {
						pageSize = size
					}
				}
			}
			continue
		}
		key, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		pages, err := strconv.ParseUint(strings.TrimSuffix(strings.TrimSpace(value), "."), 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Pages free":
			free = pages
		case "Pages inactive":
			inactive = pages
		case "Pages speculative":
			speculative = pages
		}
	}
	available := (free + inactive + speculative) * pageSize
	if available >= total {
		return 0
	}
	return total - available
}

// swapUsage parses `sysctl vm.swapusage` -> "total = 2048.00M used = 0.00M free = 2048.00M".
func swapUsage() (uint64, uint64) {
	fields := strings.Fields(sysctl("vm.swapusage"))
	var total, used uint64
	for i, field := range fields {
		if i+2 >= len(fields) || field != "=" {
			continue
		}
		value := parseMegabytes(fields[i+1])
		switch fields[i-1] {
		case "total":
			total = value
		case "used":
			used = value
		}
	}
	return total, used
}

func parseMegabytes(raw string) uint64 {
	value := strings.TrimSuffix(strings.TrimSuffix(raw, "M"), "G")
	number, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	if strings.HasSuffix(raw, "G") {
		number *= 1024
	}
	return uint64(number * 1024 * 1024)
}

func loadAvg() (float64, float64, float64) {
	raw := strings.Trim(sysctl("vm.loadavg"), "{ }")
	fields := strings.Fields(raw)
	if len(fields) < 3 {
		return 0, 0, 0
	}
	parse := func(s string) float64 {
		value, _ := strconv.ParseFloat(s, 64)
		return value
	}
	return parse(fields[0]), parse(fields[1]), parse(fields[2])
}

// uptime derives from kern.boottime: "{ sec = 1699999999, usec = 0 } ...".
func uptime() uint64 {
	raw := sysctl("kern.boottime")
	fields := strings.Fields(strings.NewReplacer("{", " ", "}", " ", ",", " ", "=", " ").Replace(raw))
	for i, field := range fields {
		if field == "sec" && i+1 < len(fields) {
			boot, err := strconv.ParseInt(fields[i+1], 10, 64)
			if err != nil {
				return 0
			}
			now := time.Now().Unix()
			if now > boot {
				return uint64(now - boot)
			}
		}
	}
	return 0
}

// netBytes sums received/transmitted bytes over physical interfaces.
func netBytes() (uint64, uint64) {
	out, err := exec.Command("netstat", "-ib").Output()
	if err != nil {
		return 0, 0
	}
	lines := strings.Split(string(out), "\n")
	if len(lines) < 2 {
		return 0, 0
	}

	rxColumn, txColumn := -1, -1
	var rx, tx uint64
	seen := map[string]bool{}
	for index, line := range lines {
		fields := strings.Fields(line)
		if index == 0 {
			for i, field := range fields {
				switch field {
				case "Ibytes":
					rxColumn = i
				case "Obytes":
					txColumn = i
				}
			}
			continue
		}
		if rxColumn < 0 || txColumn < 0 || len(fields) <= txColumn {
			continue
		}
		name := fields[0]
		// Count each interface once (netstat prints one line per address).
		if name == "lo0" || seen[name] {
			continue
		}
		seen[name] = true
		received, err1 := strconv.ParseUint(fields[rxColumn], 10, 64)
		transmitted, err2 := strconv.ParseUint(fields[txColumn], 10, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		rx += received
		tx += transmitted
	}
	return rx, tx
}

// diskUsage reports used and total bytes of the filesystem holding path.
func diskUsage(path string) (uint64, uint64, error) {
	probe := path
	if probe == "" {
		probe = "/"
	}
	for {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(probe, &stat); err == nil {
			blockSize := uint64(stat.Bsize)
			total := stat.Blocks * blockSize
			free := stat.Bavail * blockSize
			return total - free, total, nil
		}
		parent := filepath.Dir(probe)
		if parent == probe || parent == "" {
			return 0, 0, syscall.ENOENT
		}
		probe = parent
	}
}
