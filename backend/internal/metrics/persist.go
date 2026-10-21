package metrics

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// Persistence is the separate SQLite file that keeps aggregated metric history.
// It is deliberately independent from the panel database: a busy time-series
// writer must never lock the tables behind the UI, and its size can be pruned
// or removed without touching panel data.
type Persistence struct {
	db   *sql.DB
	path string
}

const metricsSchema = `
CREATE TABLE IF NOT EXISTS host_rollups (
  resolution       TEXT NOT NULL,
  ts               INTEGER NOT NULL,
  cpu_percent      REAL NOT NULL,
  cpu_cores        INTEGER NOT NULL,
  memory_used      INTEGER NOT NULL,
  memory_total     INTEGER NOT NULL,
  swap_used        INTEGER NOT NULL,
  swap_total       INTEGER NOT NULL,
  load1            REAL NOT NULL,
  load5            REAL NOT NULL,
  load15           REAL NOT NULL,
  disk_used        INTEGER NOT NULL,
  disk_total       INTEGER NOT NULL,
  disk_read_bps    REAL NOT NULL,
  disk_write_bps   REAL NOT NULL,
  net_rx_bps       REAL NOT NULL,
  net_tx_bps       REAL NOT NULL,
  uptime_seconds   INTEGER NOT NULL,
  available        INTEGER NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (resolution, ts)
);
CREATE INDEX IF NOT EXISTS idx_host_rollups_res_ts ON host_rollups(resolution, ts);

CREATE TABLE IF NOT EXISTS site_rollups (
  resolution           TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  ts                   INTEGER NOT NULL,
  cpu_percent          REAL NOT NULL,
  memory_bytes         INTEGER NOT NULL,
  memory_limit_bytes   INTEGER NOT NULL,
  tasks                INTEGER NOT NULL,
  available            INTEGER NOT NULL,
  reason               TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (resolution, slug, ts)
);
CREATE INDEX IF NOT EXISTS idx_site_rollups_res_slug_ts ON site_rollups(resolution, slug, ts);

CREATE TABLE IF NOT EXISTS daemon_rollups (
  resolution        TEXT NOT NULL,
  ts                INTEGER NOT NULL,
  rss_bytes         INTEGER NOT NULL,
  heap_alloc_bytes  INTEGER NOT NULL,
  heap_inuse_bytes  INTEGER NOT NULL,
  heap_sys_bytes    INTEGER NOT NULL,
  goroutines        INTEGER NOT NULL,
  fds               INTEGER NOT NULL,
  PRIMARY KEY (resolution, ts)
);
CREATE INDEX IF NOT EXISTS idx_daemon_rollups_res_ts ON daemon_rollups(resolution, ts);
`

// OpenPersistence opens (creating if needed) the metrics database.
func OpenPersistence(path string) (*Persistence, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return nil, fmt.Errorf("metrics: create data dir: %w", err)
		}
	}
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("metrics: open: %w", err)
	}
	// A single writer keeps SQLite from serialising two write transactions against
	// each other; the persister already batches once per minute.
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("metrics: ping: %w", err)
	}
	if _, err := db.Exec(metricsSchema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("metrics: schema: %w", err)
	}
	for _, f := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(f); err == nil {
			_ = os.Chmod(f, 0o600)
		}
	}
	return &Persistence{db: db, path: path}, nil
}

func (p *Persistence) Close() error { return p.db.Close() }

// Path is the file the operator sees in the settings screen.
func (p *Persistence) Path() string { return p.path }

// SizeBytes reports the database plus its WAL, which is what actually occupies disk.
func (p *Persistence) SizeBytes() int64 {
	var total int64
	for _, f := range []string{p.path, p.path + "-wal", p.path + "-shm"} {
		if fi, err := os.Stat(f); err == nil {
			total += fi.Size()
		}
	}
	return total
}

// WriteHost stores one aggregated host bucket.
func (p *Persistence) WriteHost(resolution string, at time.Time, s Snapshot) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO host_rollups
 (resolution, ts, cpu_percent, cpu_cores, memory_used, memory_total, swap_used, swap_total,
  load1, load5, load15, disk_used, disk_total, disk_read_bps, disk_write_bps,
  net_rx_bps, net_tx_bps, uptime_seconds, available, reason)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		resolution, at.UTC().Unix(), s.CPUPercent, s.CPUCores, s.MemoryUsedBytes, s.MemoryTotal,
		s.SwapUsedBytes, s.SwapTotalBytes, s.Load1, s.Load5, s.Load15, s.DiskUsedBytes, s.DiskTotalBytes,
		s.DiskReadBps, s.DiskWriteBps, s.NetRxBps, s.NetTxBps, s.UptimeSeconds, boolInt(s.Available), s.Reason)
	return err
}

// WriteSite stores one aggregated website bucket.
func (p *Persistence) WriteSite(resolution string, at time.Time, s SiteSnapshot) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO site_rollups
 (resolution, slug, ts, cpu_percent, memory_bytes, memory_limit_bytes, tasks, available, reason)
 VALUES (?,?,?,?,?,?,?,?,?)`,
		resolution, s.Slug, at.UTC().Unix(), s.CPUPercent, s.MemoryBytes, s.MemoryLimitBytes,
		s.Tasks, boolInt(s.Available), s.Reason)
	return err
}

// QueryHost returns host buckets at the given resolution since a point in time.
func (p *Persistence) QueryHost(resolution string, since time.Time) ([]Snapshot, error) {
	rows, err := p.db.Query(`
SELECT ts, cpu_percent, cpu_cores, memory_used, memory_total, swap_used, swap_total,
       load1, load5, load15, disk_used, disk_total, disk_read_bps, disk_write_bps,
       net_rx_bps, net_tx_bps, uptime_seconds, available, reason
FROM host_rollups WHERE resolution = ? AND ts >= ? ORDER BY ts`,
		resolution, since.UTC().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Snapshot{}
	for rows.Next() {
		var (
			ts        int64
			s         Snapshot
			available int
			reason    string
		)
		if err := rows.Scan(&ts, &s.CPUPercent, &s.CPUCores, &s.MemoryUsedBytes, &s.MemoryTotal,
			&s.SwapUsedBytes, &s.SwapTotalBytes, &s.Load1, &s.Load5, &s.Load15,
			&s.DiskUsedBytes, &s.DiskTotalBytes, &s.DiskReadBps, &s.DiskWriteBps,
			&s.NetRxBps, &s.NetTxBps, &s.UptimeSeconds, &available, &reason); err != nil {
			return nil, err
		}
		s.TS = time.Unix(ts, 0).UTC().Format(time.RFC3339)
		s.Available = available != 0
		s.Reason = reason
		out = append(out, s)
	}
	return out, rows.Err()
}

// QuerySite returns one website's buckets at the given resolution.
func (p *Persistence) QuerySite(slug, resolution string, since time.Time) ([]SiteSnapshot, error) {
	rows, err := p.db.Query(`
SELECT ts, cpu_percent, memory_bytes, memory_limit_bytes, tasks, available, reason
FROM site_rollups WHERE slug = ? AND resolution = ? AND ts >= ? ORDER BY ts`,
		slug, resolution, since.UTC().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SiteSnapshot{}
	for rows.Next() {
		var (
			ts        int64
			s         SiteSnapshot
			available int
			reason    string
		)
		if err := rows.Scan(&ts, &s.CPUPercent, &s.MemoryBytes, &s.MemoryLimitBytes, &s.Tasks, &available, &reason); err != nil {
			return nil, err
		}
		s.TS = time.Unix(ts, 0).UTC().Format(time.RFC3339)
		s.Slug = slug
		s.Available = available != 0
		s.Reason = reason
		out = append(out, s)
	}
	return out, rows.Err()
}

// WriteDaemon stores one aggregated panel-process bucket.
func (p *Persistence) WriteDaemon(resolution string, at time.Time, s DaemonSnapshot) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO daemon_rollups
 (resolution, ts, rss_bytes, heap_alloc_bytes, heap_inuse_bytes, heap_sys_bytes, goroutines, fds)
 VALUES (?,?,?,?,?,?,?,?)`,
		resolution, at.UTC().Unix(), s.RSSBytes, s.HeapAllocBytes, s.HeapInuseBytes,
		s.HeapSysBytes, s.Goroutines, s.FDs)
	return err
}

// QueryDaemon returns panel-process buckets at the given resolution.
func (p *Persistence) QueryDaemon(resolution string, since time.Time) ([]DaemonSnapshot, error) {
	rows, err := p.db.Query(`
SELECT ts, rss_bytes, heap_alloc_bytes, heap_inuse_bytes, heap_sys_bytes, goroutines, fds
FROM daemon_rollups WHERE resolution = ? AND ts >= ? ORDER BY ts`,
		resolution, since.UTC().Unix())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []DaemonSnapshot{}
	for rows.Next() {
		var (
			ts int64
			s  DaemonSnapshot
		)
		if err := rows.Scan(&ts, &s.RSSBytes, &s.HeapAllocBytes, &s.HeapInuseBytes,
			&s.HeapSysBytes, &s.Goroutines, &s.FDs); err != nil {
			return nil, err
		}
		s.TS = time.Unix(ts, 0).UTC().Format(time.RFC3339)
		out = append(out, s)
	}
	return out, rows.Err()
}

// RollupDaemon averages panel-process buckets into a coarser tier.
func (p *Persistence) RollupDaemon(from, to string, bucketSeconds int64, since time.Time) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO daemon_rollups
 (resolution, ts, rss_bytes, heap_alloc_bytes, heap_inuse_bytes, heap_sys_bytes, goroutines, fds)
SELECT ?, (ts / ?) * ?, CAST(AVG(rss_bytes) AS INTEGER), CAST(AVG(heap_alloc_bytes) AS INTEGER),
       CAST(AVG(heap_inuse_bytes) AS INTEGER), CAST(AVG(heap_sys_bytes) AS INTEGER),
       CAST(AVG(goroutines) AS INTEGER), MAX(fds)
FROM daemon_rollups WHERE resolution = ? AND ts >= ?
GROUP BY ts / ?`,
		to, bucketSeconds, bucketSeconds, from, since.UTC().Unix(), bucketSeconds)
	return err
}

// RollupHost averages one resolution into a coarser one. INSERT OR REPLACE makes a
// repeated pass idempotent, which matters because the newest bucket is still open.
func (p *Persistence) RollupHost(from, to string, bucketSeconds int64, since time.Time) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO host_rollups
 (resolution, ts, cpu_percent, cpu_cores, memory_used, memory_total, swap_used, swap_total,
  load1, load5, load15, disk_used, disk_total, disk_read_bps, disk_write_bps,
  net_rx_bps, net_tx_bps, uptime_seconds, available, reason)
SELECT ?, (ts / ?) * ?, AVG(cpu_percent), MAX(cpu_cores),
       CAST(AVG(memory_used) AS INTEGER), MAX(memory_total),
       CAST(AVG(swap_used) AS INTEGER), MAX(swap_total), AVG(load1), AVG(load5), AVG(load15),
       CAST(AVG(disk_used) AS INTEGER), MAX(disk_total),
       AVG(disk_read_bps), AVG(disk_write_bps),
       AVG(net_rx_bps), AVG(net_tx_bps), CAST(AVG(uptime_seconds) AS INTEGER),
       MAX(available), MAX(reason)
FROM host_rollups WHERE resolution = ? AND ts >= ?
GROUP BY ts / ?`,
		to, bucketSeconds, bucketSeconds, from, since.UTC().Unix(), bucketSeconds)
	return err
}

// RollupSite is the website counterpart of RollupHost.
func (p *Persistence) RollupSite(from, to string, bucketSeconds int64, since time.Time) error {
	_, err := p.db.Exec(`
INSERT OR REPLACE INTO site_rollups
 (resolution, slug, ts, cpu_percent, memory_bytes, memory_limit_bytes, tasks, available, reason)
SELECT ?, slug, (ts / ?) * ?, AVG(cpu_percent),
       CAST(AVG(memory_bytes) AS INTEGER), MAX(memory_limit_bytes),
       CAST(AVG(tasks) AS INTEGER), MAX(available), MAX(reason)
FROM site_rollups WHERE resolution = ? AND ts >= ?
GROUP BY slug, ts / ?`,
		to, bucketSeconds, bucketSeconds, from, since.UTC().Unix(), bucketSeconds)
	return err
}

// Prune drops buckets older than each tier's retention.
func (p *Persistence) Prune(now time.Time, oneMinute, fiveMinute, hourly time.Duration) error {
	cut := func(d time.Duration) int64 { return now.Add(-d).UTC().Unix() }
	for _, spec := range []struct {
		resolution string
		cutoff     int64
	}{
		{"1m", cut(oneMinute)},
		{"5m", cut(fiveMinute)},
		{"1h", cut(hourly)},
	} {
		if _, err := p.db.Exec(`DELETE FROM host_rollups WHERE resolution = ? AND ts < ?`, spec.resolution, spec.cutoff); err != nil {
			return err
		}
		if _, err := p.db.Exec(`DELETE FROM site_rollups WHERE resolution = ? AND ts < ?`, spec.resolution, spec.cutoff); err != nil {
			return err
		}
		if _, err := p.db.Exec(`DELETE FROM daemon_rollups WHERE resolution = ? AND ts < ?`, spec.resolution, spec.cutoff); err != nil {
			return err
		}
	}
	return nil
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
