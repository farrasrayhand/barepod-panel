package metrics

import (
	"path/filepath"
	"testing"
	"time"
)

func TestPersistenceRollupsQueriesAndPrune(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metrics.db")
	db, err := OpenPersistence(path)
	if err != nil {
		t.Fatalf("open persistence: %v", err)
	}
	defer db.Close()

	base := time.Date(2026, 10, 21, 10, 0, 0, 0, time.UTC)
	for i, cpu := range []float64{10, 20} {
		at := base.Add(time.Duration(i) * time.Minute)
		if err := db.WriteHost("1m", at, Snapshot{
			CPUPercent:      cpu,
			CPUCores:        4,
			MemoryUsedBytes: 100,
			MemoryTotal:     1000,
			Available:       true,
		}); err != nil {
			t.Fatalf("write host: %v", err)
		}
		if err := db.WriteSite("1m", at, SiteSnapshot{
			Slug:        "site-a",
			CPUPercent:  cpu,
			MemoryBytes: 50,
			Tasks:       2,
			Available:   true,
		}); err != nil {
			t.Fatalf("write site: %v", err)
		}
	}

	host, err := db.QueryHost("1m", base.Add(-time.Minute))
	if err != nil || len(host) != 2 {
		t.Fatalf("host 1m query = %d rows, err %v", len(host), err)
	}
	site, err := db.QuerySite("site-a", "1m", base.Add(-time.Minute))
	if err != nil || len(site) != 2 {
		t.Fatalf("site 1m query = %d rows, err %v", len(site), err)
	}

	if err := db.RollupHost("1m", "5m", 300, base.Add(-time.Hour)); err != nil {
		t.Fatalf("roll up host: %v", err)
	}
	if err := db.RollupSite("1m", "5m", 300, base.Add(-time.Hour)); err != nil {
		t.Fatalf("roll up site: %v", err)
	}
	host5, err := db.QueryHost("5m", base.Add(-time.Hour))
	if err != nil || len(host5) != 1 {
		t.Fatalf("host 5m query = %d rows, err %v", len(host5), err)
	}
	if host5[0].CPUPercent != 15 {
		t.Fatalf("host 5m CPU = %v, want 15", host5[0].CPUPercent)
	}
	site5, err := db.QuerySite("site-a", "5m", base.Add(-time.Hour))
	if err != nil || len(site5) != 1 || site5[0].CPUPercent != 15 {
		t.Fatalf("site 5m query = %+v, err %v", site5, err)
	}

	// The minute tier is pruned independently; the coarse tier stays.
	if err := db.Prune(base.Add(2*time.Hour), time.Hour, 30*24*time.Hour, 365*24*time.Hour); err != nil {
		t.Fatalf("prune: %v", err)
	}
	host1, _ := db.QueryHost("1m", base.Add(-24*time.Hour))
	if len(host1) != 0 {
		t.Fatalf("pruned 1m rows still present: %d", len(host1))
	}
	host5, _ = db.QueryHost("5m", base.Add(-24*time.Hour))
	if len(host5) != 1 {
		t.Fatalf("5m row should survive a 1m prune, got %d", len(host5))
	}
	if db.SizeBytes() == 0 {
		t.Fatal("SizeBytes should report the database file")
	}
}
