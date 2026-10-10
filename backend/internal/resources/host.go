package resources

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// detectCPUCores reports the CPU capacity that is actually usable right now.
//
// runtime.NumCPU() is captured when the process starts, so it does NOT follow a
// cgroup change (a VPS resize, or `lxc-cgroup … cpu.max` on a running container).
// We therefore prefer the live cgroup v2 limit, then the kernel's online CPU
// list, and only then fall back to NumCPU.
func detectCPUCores() int {
	if cores := cgroupCPUCores(); cores > 0 {
		return cores
	}
	if cores := onlineCPUCores(); cores > 0 {
		return cores
	}
	return runtime.NumCPU()
}

// cgroupCPUCores parses the live cgroup v2 CPU limit (cpu.max).
func cgroupCPUCores() int {
	data, err := os.ReadFile("/sys/fs/cgroup/cpu.max")
	if err != nil {
		return 0
	}
	return ParseCPUMax(string(data))
}

// ParseCPUMax turns a "cpu.max" body into a core count.
// "200000 100000" -> 2 cores; "max 100000" -> 0 (no limit).
func ParseCPUMax(content string) int {
	fields := strings.Fields(content)
	if len(fields) < 2 || fields[0] == "max" {
		return 0
	}
	quota, qErr := strconv.ParseInt(fields[0], 10, 64)
	period, pErr := strconv.ParseInt(fields[1], 10, 64)
	if qErr != nil || pErr != nil || quota <= 0 || period <= 0 {
		return 0
	}
	cores := int((quota + period - 1) / period) // round up
	return cores
}

// onlineCPUCores counts the CPUs the kernel reports as online.
func onlineCPUCores() int {
	data, err := os.ReadFile("/sys/devices/system/cpu/online")
	if err != nil {
		return 0
	}
	return ParseCPUList(string(data))
}

// ParseCPUList counts CPUs in a kernel list such as "0-3,8,10-11" (6 CPUs).
func ParseCPUList(content string) int {
	count := 0
	for _, part := range strings.Split(strings.TrimSpace(content), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if lo, hi, found := strings.Cut(part, "-"); found {
			start, err1 := strconv.Atoi(strings.TrimSpace(lo))
			end, err2 := strconv.Atoi(strings.TrimSpace(hi))
			if err1 == nil && err2 == nil && end >= start {
				count += end - start + 1
				continue
			}
		}
		if _, err := strconv.Atoi(part); err == nil {
			count++
		}
	}
	return count
}

// detectMemoryMB reads total RAM. Linux is read from /proc/meminfo; on other
// platforms (a development machine) we fall back to sysctl hw.memsize so the
// capacity guard still shows real numbers.
func detectMemoryMB() int {
	if mb := memoryFromProc(); mb > 0 {
		return mb
	}
	out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	bytes, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil || bytes <= 0 {
		return 0
	}
	return int(bytes / (1024 * 1024))
}

func memoryFromProc() int {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kb, err := strconv.Atoi(fields[1])
		if err != nil {
			return 0
		}
		return kb / 1024
	}
	return 0
}

// diskUsage reports the total and free bytes of the filesystem at path.
// If the path does not exist yet (e.g. /home on a fresh container), the nearest
// existing parent is measured so the disk guard is not silently disabled.
func diskUsage(path string) (total, free uint64, err error) {
	probe := path
	for {
		var stat syscall.Statfs_t
		if err := syscall.Statfs(probe, &stat); err == nil {
			blockSize := uint64(stat.Bsize)
			return stat.Blocks * blockSize, stat.Bavail * blockSize, nil
		}
		parent := filepath.Dir(probe)
		if parent == probe || parent == "" {
			return 0, 0, err
		}
		probe = parent
	}
}
