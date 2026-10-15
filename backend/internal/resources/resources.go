// Package resources models the resource a group ("package") grants to each of
// its members, the capacity of the host, and the guard that stops an operator
// from allocating more than the machine actually has.
//
// The same Limits struct is the input for a website's systemd unit (cgroup v2:
// MemoryMax / CPUQuota / TasksMax), for a tenant's disk quota, and for a pod's
// Docker resource spec — one model, three consumers.
package resources

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// Limits are per-member allowances. Zero means "unlimited" for every field, so a
// fresh install (built-in groups with no limits) can never fail the guard.
type Limits struct {
	CPUQuotaPercent int `json:"cpuQuotaPercent"` // 100 = one core
	MemoryMB        int `json:"memoryMb"`
	TasksMax        int `json:"tasksMax"` // processes/threads
	DiskQuotaGB     int `json:"diskQuotaGb"`
	InodeQuota      int `json:"inodeQuota"`
	MaxSites        int `json:"maxSites"`
	MaxDatabases    int `json:"maxDatabases"`
}

// IsZero reports whether no limit is set.
func (l Limits) IsZero() bool { return l == Limits{} }

// DiskQuotaBytes converts the disk limit to bytes (0 = unlimited).
func (l Limits) DiskQuotaBytes() int64 { return int64(l.DiskQuotaGB) * 1024 * 1024 * 1024 }

// Multiply scales every limit by n (used to size a group's allocation).
func (l Limits) Multiply(n int) Limits {
	if n <= 0 {
		return Limits{}
	}
	return Limits{
		CPUQuotaPercent: l.CPUQuotaPercent * n,
		MemoryMB:        l.MemoryMB * n,
		TasksMax:        l.TasksMax * n,
		DiskQuotaGB:     l.DiskQuotaGB * n,
		InodeQuota:      l.InodeQuota * n,
		MaxSites:        l.MaxSites * n,
		MaxDatabases:    l.MaxDatabases * n,
	}
}

// Add sums two limit sets.
func (l Limits) Add(o Limits) Limits {
	return Limits{
		CPUQuotaPercent: l.CPUQuotaPercent + o.CPUQuotaPercent,
		MemoryMB:        l.MemoryMB + o.MemoryMB,
		TasksMax:        l.TasksMax + o.TasksMax,
		DiskQuotaGB:     l.DiskQuotaGB + o.DiskQuotaGB,
		InodeQuota:      l.InodeQuota + o.InodeQuota,
		MaxSites:        l.MaxSites + o.MaxSites,
		MaxDatabases:    l.MaxDatabases + o.MaxDatabases,
	}
}

// Capacity is what the host actually has.
type Capacity struct {
	CPUCores   int `json:"cpuCores"` // 100% of CPUQuota per core
	MemoryMB   int `json:"memoryMb"`
	DiskGB     int `json:"diskGb"` // total size of the sites filesystem
	DiskFreeGB int `json:"diskFreeGb"`
}

// DefaultLimits is what a single member gets when the operator picks "use the
// suggested package": one core, 1 GiB, 10 GiB disk.
func DefaultLimits() Limits {
	return Limits{
		CPUQuotaPercent: 100,
		MemoryMB:        1024,
		TasksMax:        256,
		DiskQuotaGB:     10,
		MaxSites:        5,
		MaxDatabases:    2,
	}
}

// Suggest scales the defaults down on a very small machine so the suggestion
// itself never exceeds the host.
func (c Capacity) Suggest() Limits {
	l := DefaultLimits()
	if c.MemoryMB > 0 && c.MemoryMB < 2048 {
		l.MemoryMB = 512
	}
	if c.DiskGB > 0 {
		if l.DiskQuotaGB > c.DiskGB/4 {
			l.DiskQuotaGB = int(math.Max(1, float64(c.DiskGB)/4))
		}
	}
	if c.CPUCores == 1 {
		l.CPUQuotaPercent = 100
	}
	return l
}

// Usage is one group's claim on the host.
type Usage struct {
	Name    string `json:"name"`
	Members int    `json:"members"`
	Limits  Limits `json:"limits"`
}

// Allocation is the sum of every group's claim, per resource.
func Allocation(usages []Usage) Limits {
	total := Limits{}
	for _, u := range usages {
		total = total.Add(u.Limits.Multiply(u.Members))
	}
	return total
}

// Overcommit reports how much of the host the allocation uses, per resource.
// A ratio above 1 means the plan does not fit.
type Overcommit struct {
	CPU  float64 `json:"cpu"`
	RAM  float64 `json:"ram"`
	Disk float64 `json:"disk"`
}

// Fits reports whether every ratio is within the host.
func (o Overcommit) Fits() bool { return o.CPU <= 1 && o.RAM <= 1 && o.Disk <= 1 }

// Ratios measures the allocation against the capacity.
func Ratios(allocation Limits, c Capacity) Overcommit {
	ratio := func(used, total int) float64 {
		if used == 0 {
			return 0
		}
		if total <= 0 {
			// Nothing to compare against: treat as fitting (unlimited host info).
			return 0
		}
		return float64(used) / float64(total)
	}
	return Overcommit{
		CPU:  ratio(allocation.CPUQuotaPercent, c.CPUCores*100),
		RAM:  ratio(allocation.MemoryMB, c.MemoryMB),
		Disk: ratio(allocation.DiskQuotaGB, c.DiskGB),
	}
}

// Exceeds lists every resource whose allocation no longer fits the host.
//
// Capacity is re-read on every call, so a resized (or scaled-down) server is
// reported immediately instead of waiting for a daemon restart.
func Exceeds(usages []Usage, c Capacity) []string {
	alloc := Allocation(usages)
	ratios := Ratios(alloc, c)

	var problems []string
	check := func(label string, used, total int, ratio float64) {
		if used > 0 && total > 0 && ratio > 1 {
			problems = append(problems, fmt.Sprintf(
				"%s: allocated %d of %d available (%.0f%%)", label, used, total, ratio*100))
		}
	}
	check("CPU", alloc.CPUQuotaPercent, c.CPUCores*100, ratios.CPU)
	check("memory", alloc.MemoryMB, c.MemoryMB, ratios.RAM)
	check("disk", alloc.DiskQuotaGB, c.DiskGB, ratios.Disk)
	sort.Strings(problems)
	return problems
}

// Validate refuses an allocation that exceeds the host. It lists every resource
// that does not fit, with the numbers, so the operator can fix the package.
func Validate(usages []Usage, c Capacity) error {
	problems := Exceeds(usages, c)
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("the packages exceed this server: %s", strings.Join(problems, "; "))
}

// Describe renders the limits for logs and CLI output.
func (l Limits) Describe() string {
	if l.IsZero() {
		return "unlimited"
	}
	var parts []string
	add := func(format string, v int) {
		if v > 0 {
			parts = append(parts, fmt.Sprintf(format, v))
		}
	}
	add("%d%% CPU", l.CPUQuotaPercent)
	add("%d MiB RAM", l.MemoryMB)
	add("%d tasks", l.TasksMax)
	add("%d GiB disk", l.DiskQuotaGB)
	add("%d inodes", l.InodeQuota)
	add("%d sites", l.MaxSites)
	add("%d databases", l.MaxDatabases)
	if len(parts) == 0 {
		return "unlimited"
	}
	return strings.Join(parts, ", ")
}

// DetectCapacity reads the host capacity. diskPath is the filesystem that holds
// tenant homes (e.g. /home); an empty path skips the disk figures.
//
// Every figure is read live (cgroup-aware CPU, /proc memory, statfs disk), so a
// scale up/down — a VPS resize, a cgroup change on a running container, a new
// disk — shows up on the next call without restarting the daemon.
func DetectCapacity(diskPath string) Capacity {
	c := Capacity{CPUCores: DetectCPUCores(), MemoryMB: detectMemoryMB()}
	if diskPath != "" {
		if total, free, err := diskUsage(diskPath); err == nil {
			c.DiskGB = int(total / (1024 * 1024 * 1024))
			c.DiskFreeGB = int(free / (1024 * 1024 * 1024))
		}
	}
	return c
}
