// Package metrics samples host and per-website resource usage.
//
// Everything is reported as **raw numbers with RFC3339 timestamps** — bytes,
// percentages, per-second rates — and the frontend does the formatting. A metric
// that this host cannot provide is marked unavailable with a reason instead of
// being reported as zero, so the UI can say "not available here" honestly
// (a container simply owns fewer things than the host).
package metrics

import (
	"context"
	"sort"
	"sync"
	"time"
)

// Snapshot is one measurement of the host.
type Snapshot struct {
	TS string `json:"ts"`

	CPUPercent      float64 `json:"cpuPercent"`
	CPUCores        int     `json:"cpuCores"`
	MemoryUsedBytes uint64  `json:"memoryUsedBytes"`
	MemoryTotal     uint64  `json:"memoryTotalBytes"`
	SwapUsedBytes   uint64  `json:"swapUsedBytes"`
	SwapTotalBytes  uint64  `json:"swapTotalBytes"`

	Load1  float64 `json:"load1"`
	Load5  float64 `json:"load5"`
	Load15 float64 `json:"load15"`

	UptimeSeconds uint64 `json:"uptimeSeconds"`

	DiskUsedBytes  uint64  `json:"diskUsedBytes"`
	DiskTotalBytes uint64  `json:"diskTotalBytes"`
	DiskReadBps    float64 `json:"diskReadBps"`
	DiskWriteBps   float64 `json:"diskWriteBps"`

	NetRxBps float64 `json:"netRxBps"`
	NetTxBps float64 `json:"netTxBps"`

	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// SiteSnapshot is one measurement of a website's service.
type SiteSnapshot struct {
	TS   string `json:"ts"`
	Slug string `json:"slug"`

	CPUPercent       float64 `json:"cpuPercent"`
	MemoryBytes      uint64  `json:"memoryBytes"`
	MemoryLimitBytes uint64  `json:"memoryLimitBytes"`
	Tasks            uint64  `json:"tasks"`

	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// Collector reads the current host state and derives rates from the previous one.
type Collector interface {
	// Mode is "linux", "darwin" or "unsupported".
	Mode() string
	// Snapshot reads the host now. previous is the last snapshot (may be zero).
	Snapshot(previous Snapshot, elapsed time.Duration) (Snapshot, error)
}

// NewCollector returns the collector for this platform.
func NewCollector(sitesRoot string) Collector { return newCollector(sitesRoot) }

// Sampler keeps a bounded history of snapshots in memory and answers range queries.
type Sampler struct {
	collector Collector
	interval  time.Duration
	capacity  int

	mu      sync.RWMutex
	samples []Snapshot
	latest  Snapshot
}

// NewSampler builds a sampler. interval <= 0 falls back to 15s, capacity <= 0 to 2880
// (12 hours at the default interval).
func NewSampler(collector Collector, interval time.Duration, capacity int) *Sampler {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	if capacity <= 0 {
		capacity = 2880
	}
	return &Sampler{collector: collector, interval: interval, capacity: capacity}
}

// Collector exposes the underlying collector (used for the interval in responses).
func (s *Sampler) Collector() Collector { return s.collector }

// Interval is the sampling period.
func (s *Sampler) Interval() time.Duration { return s.interval }

// Start samples until the context is cancelled. The first sample is taken
// immediately so the UI has something to show.
func (s *Sampler) Start(ctx context.Context) {
	s.tick()
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

func (s *Sampler) tick() {
	s.mu.Lock()
	previous := s.latest
	s.mu.Unlock()

	snapshot, err := s.collector.Snapshot(previous, s.interval)
	if err != nil {
		// Keep the last good sample; a read failure must not empty the charts.
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.latest = snapshot
	s.samples = append(s.samples, snapshot)
	if len(s.samples) > s.capacity {
		s.samples = s.samples[len(s.samples)-s.capacity:]
	}
}

// Latest returns the most recent snapshot (zero value before the first tick).
func (s *Sampler) Latest() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.latest
}

// Range returns the samples at or after since, oldest first.
func (s *Sampler) Range(since time.Time) []Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Snapshot, 0, len(s.samples))
	for _, sample := range s.samples {
		at, err := time.Parse(time.RFC3339, sample.TS)
		if err != nil || at.Before(since) {
			continue
		}
		out = append(out, sample)
	}
	return out
}

// Count returns how many samples are buffered.
func (s *Sampler) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.samples)
}

// MaxRange is the longest window the in-memory history can answer.
func (s *Sampler) MaxRange() time.Duration {
	return time.Duration(s.capacity) * s.interval
}

// ranges maps the UI's time-range keys to durations.
var ranges = map[string]time.Duration{
	"5m":  5 * time.Minute,
	"1h":  time.Hour,
	"6h":  6 * time.Hour,
	"12h": 12 * time.Hour,
	"24h": 24 * time.Hour,
}

// RangeKeys lists the supported range keys, longest first.
func RangeKeys() []string {
	keys := make([]string, 0, len(ranges))
	for key := range ranges {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return ranges[keys[i]] > ranges[keys[j]] })
	return keys
}

// ParseRange turns a range key into a duration, defaulting to def.
func ParseRange(key string, def time.Duration) time.Duration {
	if key == "" {
		return def
	}
	if duration, ok := ranges[key]; ok {
		return duration
	}
	if duration, err := time.ParseDuration(key); err == nil && duration > 0 {
		return duration
	}
	return def
}

// Percent computes a delta-based CPU percentage from two cumulative totals.
func Percent(busyDelta, totalDelta uint64) float64 {
	if totalDelta == 0 || busyDelta == 0 {
		return 0
	}
	if busyDelta > totalDelta {
		busyDelta = totalDelta
	}
	return float64(busyDelta) / float64(totalDelta) * 100
}

// Rate converts a byte delta into bytes per second.
func Rate(deltaBytes uint64, elapsed time.Duration) float64 {
	seconds := elapsed.Seconds()
	if seconds <= 0 {
		return 0
	}
	return float64(deltaBytes) / seconds
}

// Delta returns current - previous, guarding against a counter reset.
func Delta(current, previous uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
}
