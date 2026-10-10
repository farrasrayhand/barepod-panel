package metrics

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// UnitName is the systemd instance that runs a website.
func UnitName(slug string) string { return "barepod-app@" + slug + ".service" }

// SiteSampler reads per-website usage from cgroup v2 and keeps a short history.
//
// A website only has cgroup numbers while its unit actually runs; in dry-run or
// when the service is stopped the sample is marked unavailable with the reason,
// so the UI can say so instead of drawing a flat zero line.
type SiteSampler struct {
	mu       sync.RWMutex
	history  map[string][]SiteSnapshot
	latest   map[string]SiteSnapshot
	usage    map[string]uint64 // previous cpu usage_usec, for the delta
	capacity int
}

// NewSiteSampler builds a per-website sampler holding `capacity` samples each.
func NewSiteSampler(capacity int) *SiteSampler {
	if capacity <= 0 {
		capacity = 2880
	}
	return &SiteSampler{
		history:  map[string][]SiteSnapshot{},
		latest:   map[string]SiteSnapshot{},
		usage:    map[string]uint64{},
		capacity: capacity,
	}
}

// Collect reads the current usage of a website and stores it.
func (s *SiteSampler) Collect(slug string, elapsed time.Duration) SiteSnapshot {
	s.mu.RLock()
	previousUsage, hasPrevious := s.usage[slug]
	s.mu.RUnlock()

	snapshot, usage := ReadSite(slug, previousUsage, hasPrevious, elapsed)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.latest[slug] = snapshot
	s.usage[slug] = usage
	if snapshot.Available {
		s.history[slug] = append(s.history[slug], snapshot)
		if len(s.history[slug]) > s.capacity {
			s.history[slug] = s.history[slug][len(s.history[slug])-s.capacity:]
		}
	}
	return snapshot
}

// Latest returns the last sample for a website.
func (s *SiteSampler) Latest(slug string) SiteSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if snapshot, ok := s.latest[slug]; ok {
		return snapshot
	}
	return SiteSnapshot{
		TS:        time.Now().UTC().Format(time.RFC3339),
		Slug:      slug,
		Available: false,
		Reason:    "no sample yet",
	}
}

// Range returns the buffered samples of a website since the given time.
func (s *SiteSampler) Range(slug string, since time.Time) []SiteSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := []SiteSnapshot{}
	for _, sample := range s.history[slug] {
		at, err := time.Parse(time.RFC3339, sample.TS)
		if err != nil || at.Before(since) {
			continue
		}
		out = append(out, sample)
	}
	return out
}

// Run collects per-website samples on a schedule, so history exists even while
// nobody is looking at the UI. listSlugs returns the websites worth sampling.
func (s *SiteSampler) Run(ctx context.Context, listSlugs func() []string, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, slug := range listSlugs() {
				s.Collect(slug, interval)
			}
		}
	}
}

// ResetSite drops a website's history (used when it is deleted).
func (s *SiteSampler) ResetSite(slug string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.history, slug)
	delete(s.latest, slug)
	delete(s.usage, slug)
}

// ReadSite reads one website's cgroup v2 counters. It returns the sample and the
// raw cpu usage_usec, which the caller keeps for the next delta.
func ReadSite(slug string, previousUsageUsec uint64, hasPrevious bool, elapsed time.Duration) (SiteSnapshot, uint64) {
	snapshot := SiteSnapshot{TS: time.Now().UTC().Format(time.RFC3339), Slug: slug}

	dir := cgroupPath(slug)
	if dir == "" {
		snapshot.Reason = "the service is not running (dry-run, stopped, or it never started)"
		return snapshot, 0
	}

	memoryCurrent := readUint(filepath.Join(dir, "memory.current"))
	memoryMax := readUint(filepath.Join(dir, "memory.max")) // 0 means "max"
	tasks := readUint(filepath.Join(dir, "pids.current"))
	usageUsec := readCPUUsage(filepath.Join(dir, "cpu.stat"))

	if memoryCurrent == 0 && usageUsec == 0 && tasks == 0 {
		snapshot.Reason = "the cgroup exists but has reported no activity yet"
		return snapshot, usageUsec
	}

	snapshot.MemoryBytes = memoryCurrent
	snapshot.MemoryLimitBytes = memoryMax
	snapshot.Tasks = tasks
	snapshot.Available = true

	// usage_usec is CPU microseconds; against wall time that is a percentage of
	// one core (200% = two cores).
	if hasPrevious && elapsed > 0 {
		delta := float64(0)
		if usageUsec > previousUsageUsec {
			delta = float64(usageUsec - previousUsageUsec)
		}
		snapshot.CPUPercent = delta / 1e6 / elapsed.Seconds() * 100
	}
	return snapshot, usageUsec
}

// cgroupPath probes the usual systemd layouts, then walks the hierarchy (bounded).
func cgroupPath(slug string) string {
	unit := UnitName(slug)
	for _, candidate := range []string{
		filepath.Join("/sys/fs/cgroup/system.slice", unit),
		filepath.Join("/sys/fs/cgroup", unit),
		filepath.Join("/sys/fs/cgroup/init.scope", unit),
	} {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
	}
	return findUnitDir("/sys/fs/cgroup", unit, 0)
}

func findUnitDir(root, unit string, depth int) string {
	if depth > 3 {
		return ""
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if entry.Name() == unit {
			return filepath.Join(root, entry.Name())
		}
		if found := findUnitDir(filepath.Join(root, entry.Name()), unit, depth+1); found != "" {
			return found
		}
	}
	return ""
}

func readUint(path string) uint64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	raw := strings.TrimSpace(string(data))
	if raw == "max" {
		return 0
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return 0
	}
	return value
}

// readCPUUsage reads usage_usec from cpu.stat.
func readCPUUsage(path string) uint64 {
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, found := strings.Cut(strings.TrimSpace(line), " ")
		if !found || key != "usage_usec" {
			continue
		}
		parsed, err := strconv.ParseUint(value, 10, 64)
		if err != nil {
			return 0
		}
		return parsed
	}
	return 0
}
