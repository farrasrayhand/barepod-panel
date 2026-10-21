package metrics

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
)

const (
	// PersistenceSettingKey is the panel-wide on/off switch.
	PersistenceSettingKey = "metrics_persistence"
	// RetentionSettingKey is how many days the hourly tier is kept.
	RetentionSettingKey = "metrics_retention_days"
	// DefaultRetentionDays is deliberately conservative: hourly rows are tiny.
	DefaultRetentionDays = 365
)

// Persister periodically averages the in-memory samples into the separate
// metrics database. Keeping this out of the sampler means the hot path stays a
// single append, while disk writes happen once a minute in one transaction.
type Persister struct {
	db        *Persistence
	store     *store.Store
	sampler   *Sampler
	sites     *SiteSampler
	listSlugs func() []string

	lastFlush  time.Time
	lastRollup time.Time
	lastPrune  time.Time
}

// NewPersister builds the writer. A nil database disables it.
func NewPersister(db *Persistence, st *store.Store, sampler *Sampler, sites *SiteSampler, listSlugs func() []string) *Persister {
	return &Persister{db: db, store: st, sampler: sampler, sites: sites, listSlugs: listSlugs}
}

// Run writes one bucket per minute until the context is cancelled.
func (p *Persister) Run(ctx context.Context) {
	if p == nil || p.db == nil {
		return
	}
	now := time.Now().UTC()
	p.lastFlush, p.lastRollup, p.lastPrune = now, now, now
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case at := <-ticker.C:
			p.flush(at.UTC())
		}
	}
}

func (p *Persister) enabled() bool {
	value, err := p.store.PanelSetting(PersistenceSettingKey)
	if err != nil {
		return true
	}
	// Empty means a fresh install, and the agreed default is ON.
	return value != "false"
}

func (p *Persister) retentionDays() int {
	value, err := p.store.PanelSetting(RetentionSettingKey)
	if err != nil {
		return DefaultRetentionDays
	}
	days, err := strconv.Atoi(value)
	if err != nil || days < 30 || days > 3650 {
		return DefaultRetentionDays
	}
	return days
}

func (p *Persister) flush(now time.Time) {
	since := p.lastFlush
	p.lastFlush = now
	if !p.enabled() || !now.After(since) {
		return
	}

	bucket := now.Truncate(time.Minute)
	if samples := p.sampler.Range(since); len(samples) > 0 {
		if err := p.db.WriteHost("1m", bucket, averageHost(samples)); err != nil {
			log.Printf("metrics: write host rollup: %v", err)
		}
	}
	for _, slug := range p.listSlugs() {
		if samples := p.sites.Range(slug, since); len(samples) > 0 {
			if err := p.db.WriteSite("1m", bucket, averageSite(slug, samples)); err != nil {
				log.Printf("metrics: write site rollup %s: %v", slug, err)
			}
		}
	}
	if err := p.db.WriteDaemon("1m", bucket, SampleDaemon()); err != nil {
		log.Printf("metrics: write daemon rollup: %v", err)
	}

	// Coarse tiers are derived from the minute rows. Re-running is safe because
	// the write is INSERT OR REPLACE and the newest bucket is still open.
	if now.Sub(p.lastRollup) >= 5*time.Minute {
		p.lastRollup = now
		if err := p.db.RollupHost("1m", "5m", 300, now.Add(-48*time.Hour)); err != nil {
			log.Printf("metrics: roll up host 5m: %v", err)
		}
		if err := p.db.RollupSite("1m", "5m", 300, now.Add(-48*time.Hour)); err != nil {
			log.Printf("metrics: roll up site 5m: %v", err)
		}
		if err := p.db.RollupDaemon("1m", "5m", 300, now.Add(-48*time.Hour)); err != nil {
			log.Printf("metrics: roll up daemon 5m: %v", err)
		}
		// The hourly tier is built from the freshly written 5m rows above.
		if err := p.db.RollupHost("5m", "1h", 3600, now.Add(-40*24*time.Hour)); err != nil {
			log.Printf("metrics: roll up host 1h: %v", err)
		}
		if err := p.db.RollupSite("5m", "1h", 3600, now.Add(-40*24*time.Hour)); err != nil {
			log.Printf("metrics: roll up site 1h: %v", err)
		}
		if err := p.db.RollupDaemon("5m", "1h", 3600, now.Add(-40*24*time.Hour)); err != nil {
			log.Printf("metrics: roll up daemon 1h: %v", err)
		}
	}
	if now.Sub(p.lastPrune) >= time.Hour {
		p.lastPrune = now
		hourly := time.Duration(p.retentionDays()) * 24 * time.Hour
		if err := p.db.Prune(now, 48*time.Hour, 30*24*time.Hour, hourly); err != nil {
			log.Printf("metrics: prune: %v", err)
		}
	}
}

func averageHost(samples []Snapshot) Snapshot {
	var out Snapshot
	n := float64(len(samples))
	for _, s := range samples {
		out.CPUPercent += s.CPUPercent
		out.MemoryUsedBytes += s.MemoryUsedBytes
		out.SwapUsedBytes += s.SwapUsedBytes
		out.Load1 += s.Load1
		out.Load5 += s.Load5
		out.Load15 += s.Load15
		out.DiskUsedBytes += s.DiskUsedBytes
		out.DiskReadBps += s.DiskReadBps
		out.DiskWriteBps += s.DiskWriteBps
		out.NetRxBps += s.NetRxBps
		out.NetTxBps += s.NetTxBps
		out.UptimeSeconds += s.UptimeSeconds
		if s.CPUCores > out.CPUCores {
			out.CPUCores = s.CPUCores
		}
		if s.MemoryTotal > out.MemoryTotal {
			out.MemoryTotal = s.MemoryTotal
		}
		if s.SwapTotalBytes > out.SwapTotalBytes {
			out.SwapTotalBytes = s.SwapTotalBytes
		}
		if s.DiskTotalBytes > out.DiskTotalBytes {
			out.DiskTotalBytes = s.DiskTotalBytes
		}
		out.Available = out.Available || s.Available
	}
	out.CPUPercent /= n
	out.MemoryUsedBytes /= uint64(n)
	out.SwapUsedBytes /= uint64(n)
	out.Load1 /= n
	out.Load5 /= n
	out.Load15 /= n
	out.DiskUsedBytes /= uint64(n)
	out.DiskReadBps /= n
	out.DiskWriteBps /= n
	out.NetRxBps /= n
	out.NetTxBps /= n
	out.UptimeSeconds /= uint64(n)
	return out
}

func averageSite(slug string, samples []SiteSnapshot) SiteSnapshot {
	out := SiteSnapshot{Slug: slug}
	n := float64(len(samples))
	for _, s := range samples {
		out.CPUPercent += s.CPUPercent
		out.MemoryBytes += s.MemoryBytes
		out.Tasks += s.Tasks
		if s.MemoryLimitBytes > out.MemoryLimitBytes {
			out.MemoryLimitBytes = s.MemoryLimitBytes
		}
		out.Available = out.Available || s.Available
	}
	out.CPUPercent /= n
	out.MemoryBytes /= uint64(n)
	out.Tasks /= uint64(n)
	return out
}
