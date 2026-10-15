//go:build linux

package metrics

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/resources"
)

// linuxCollector reads /proc and statfs. Rates are deltas between two samples,
// so the very first snapshot reports 0 for them instead of a number averaged
// over the machine's uptime.
type linuxCollector struct {
	sitesRoot string

	primed              bool
	cpuBusy, cpuTotal   uint64
	diskRead, diskWrite uint64
	netRx, netTx        uint64
}

func newCollector(sitesRoot string) Collector { return &linuxCollector{sitesRoot: sitesRoot} }

// Mode implements Collector.
func (c *linuxCollector) Mode() string { return "linux" }

// Snapshot implements Collector.
func (c *linuxCollector) Snapshot(_ Snapshot, elapsed time.Duration) (Snapshot, error) {
	snapshot := Snapshot{
		TS:        time.Now().UTC().Format(time.RFC3339),
		Available: true,
	}

	snapshot.CPUCores = resources.DetectCPUCores()
	busy, total := readProcStat()
	if c.primed {
		snapshot.CPUPercent = Percent(Delta(busy, c.cpuBusy), Delta(total, c.cpuTotal))
	}
	c.cpuBusy, c.cpuTotal = busy, total

	snapshot.MemoryUsedBytes, snapshot.MemoryTotal, snapshot.SwapUsedBytes, snapshot.SwapTotalBytes = readMemInfo()
	snapshot.Load1, snapshot.Load5, snapshot.Load15 = readLoadAvg()
	snapshot.UptimeSeconds = readUptime()

	read, write := readDiskStats()
	if c.primed {
		snapshot.DiskReadBps = Rate(Delta(read, c.diskRead), elapsed)
		snapshot.DiskWriteBps = Rate(Delta(write, c.diskWrite), elapsed)
	}
	c.diskRead, c.diskWrite = read, write

	rx, tx := readNetDev()
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

// readProcStat returns the cumulative busy and total CPU ticks from /proc/stat.
//
// Only the aggregate "cpu" line is summed. The core count is deliberately not
// derived from the cpuN lines here: inside a container that list can vary from
// one read to the next, so the count comes from resources.DetectCPUCores.
func readProcStat() (uint64, uint64) {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer func() { _ = file.Close() }()

	var busy, total uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		// Aggregate line: user nice system idle iowait irq softirq steal
		values := make([]uint64, 0, len(fields)-1)
		for _, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				value = 0
			}
			values = append(values, value)
		}
		for i, value := range values {
			total += value
			if i == 3 || i == 4 { // idle, iowait
				continue
			}
			busy += value
		}
	}
	return busy, total
}

// readMemInfo returns used/total memory and swap, in bytes.
func readMemInfo() (uint64, uint64, uint64, uint64) {
	values := map[string]uint64{}
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0, 0, 0
	}
	defer func() { _ = file.Close() }()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		values[strings.TrimSuffix(fields[0], ":")] = value * 1024 // kB -> bytes
	}

	total := values["MemTotal"]
	available := values["MemAvailable"]
	if available == 0 {
		available = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	used := uint64(0)
	if total > available {
		used = total - available
	}

	swapTotal := values["SwapTotal"]
	swapFree := values["SwapFree"]
	swapUsed := uint64(0)
	if swapTotal > swapFree {
		swapUsed = swapTotal - swapFree
	}
	return used, total, swapUsed, swapTotal
}

func readLoadAvg() (float64, float64, float64) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0
	}
	parse := func(s string) float64 {
		value, _ := strconv.ParseFloat(s, 64)
		return value
	}
	return parse(fields[0]), parse(fields[1]), parse(fields[2])
}

func readUptime() uint64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) == 0 {
		return 0
	}
	seconds, _ := strconv.ParseFloat(fields[0], 64)
	return uint64(seconds)
}

// readDiskStats sums sector counters across whole block devices, in bytes.
func readDiskStats() (uint64, uint64) {
	names := blockDeviceNames()
	if len(names) == 0 {
		return 0, 0
	}

	file, err := os.Open("/proc/diskstats")
	if err != nil {
		return 0, 0
	}
	defer func() { _ = file.Close() }()

	var read, write uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 10 || !names[fields[2]] {
			continue
		}
		sectorsRead, err1 := strconv.ParseUint(fields[5], 10, 64)
		sectorsWritten, err2 := strconv.ParseUint(fields[9], 10, 64)
		if err1 != nil || err2 != nil {
			continue
		}
		read += sectorsRead * 512
		write += sectorsWritten * 512
	}
	return read, write
}

// blockDeviceNames lists whole devices from /sys/block: partitions are excluded,
// so a partitioned disk is never counted twice.
func blockDeviceNames() map[string]bool {
	entries, err := os.ReadDir("/sys/block")
	if err != nil {
		return nil
	}
	names := make(map[string]bool, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "zram") {
			continue
		}
		names[name] = true
	}
	return names
}

// readNetDev sums received/transmitted bytes, ignoring the loopback device.
func readNetDev() (uint64, uint64) {
	file, err := os.Open("/proc/net/dev")
	if err != nil {
		return 0, 0
	}
	defer func() { _ = file.Close() }()

	var rx, tx uint64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		name, rest, found := strings.Cut(scanner.Text(), ":")
		if !found || strings.TrimSpace(name) == "lo" {
			continue
		}
		fields := strings.Fields(rest)
		if len(fields) < 9 {
			continue
		}
		received, err1 := strconv.ParseUint(fields[0], 10, 64)
		transmitted, err2 := strconv.ParseUint(fields[8], 10, 64)
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
			return 0, 0, fmt.Errorf("metrics: cannot stat %s", path)
		}
		probe = parent
	}
}
