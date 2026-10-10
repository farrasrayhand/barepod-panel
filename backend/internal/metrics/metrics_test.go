package metrics

import (
	"testing"
	"time"
)

func TestPercentAndRate(t *testing.T) {
	if got := Percent(50, 100); got != 50 {
		t.Errorf("Percent(50,100) = %v, want 50", got)
	}
	// A counter that jumped beyond the total must not report more than 100%.
	if got := Percent(200, 100); got != 100 {
		t.Errorf("Percent(200,100) = %v, want 100", got)
	}
	if got := Percent(0, 0); got != 0 {
		t.Errorf("Percent(0,0) = %v, want 0", got)
	}
	if got := Rate(2048, 2*time.Second); got != 1024 {
		t.Errorf("Rate(2048,2s) = %v, want 1024", got)
	}
	if got := Rate(2048, 0); got != 0 {
		t.Errorf("Rate with no elapsed time = %v, want 0", got)
	}
}

func TestDeltaGuardsCounterReset(t *testing.T) {
	if got := Delta(100, 40); got != 60 {
		t.Errorf("Delta(100,40) = %d, want 60", got)
	}
	// A reboot or a counter reset must not produce a huge negative rate.
	if got := Delta(10, 100); got != 0 {
		t.Errorf("Delta(10,100) = %d, want 0", got)
	}
}

func TestParseRange(t *testing.T) {
	if got := ParseRange("1h", time.Minute); got != time.Hour {
		t.Errorf("ParseRange(1h) = %v", got)
	}
	if got := ParseRange("45m", time.Minute); got != 45*time.Minute {
		t.Errorf("ParseRange(45m) = %v", got)
	}
	if got := ParseRange("nonsense", 5*time.Minute); got != 5*time.Minute {
		t.Errorf("ParseRange should fall back to the default, got %v", got)
	}
	if got := ParseRange("", 5*time.Minute); got != 5*time.Minute {
		t.Errorf("ParseRange(\"\") = %v", got)
	}
}

func TestRangeKeysAreSortedLongestFirst(t *testing.T) {
	keys := RangeKeys()
	if len(keys) < 3 {
		t.Fatalf("RangeKeys = %v", keys)
	}
	for i := 1; i < len(keys); i++ {
		if ranges[keys[i-1]] < ranges[keys[i]] {
			t.Fatalf("RangeKeys is not sorted longest first: %v", keys)
		}
	}
}

// fakeCollector produces increasing CPU samples.
type fakeCollector struct{ n int }

func (f *fakeCollector) Mode() string { return "fake" }
func (f *fakeCollector) Snapshot(Snapshot, time.Duration) (Snapshot, error) {
	f.n++
	return Snapshot{
		TS:              time.Now().UTC().Format(time.RFC3339),
		CPUPercent:      float64(f.n),
		MemoryUsedBytes: uint64(f.n) * 1024,
		Available:       true,
	}, nil
}

func TestSamplerKeepsABoundedHistory(t *testing.T) {
	sampler := NewSampler(&fakeCollector{}, time.Millisecond, 3)
	for i := 0; i < 5; i++ {
		sampler.tick()
	}

	if got := sampler.Count(); got != 3 {
		t.Fatalf("buffered %d samples, want 3", got)
	}
	latest := sampler.Latest()
	if latest.CPUPercent != 5 {
		t.Errorf("Latest().CPUPercent = %v, want 5", latest.CPUPercent)
	}

	all := sampler.Range(time.Time{})
	if len(all) != 3 {
		t.Fatalf("Range returned %d samples, want 3", len(all))
	}
	if all[0].CPUPercent != 3 || all[2].CPUPercent != 5 {
		t.Errorf("Range kept the wrong window: %v", []float64{all[0].CPUPercent, all[2].CPUPercent})
	}

	// A window in the future returns nothing instead of everything.
	if got := sampler.Range(time.Now().Add(time.Hour)); len(got) != 0 {
		t.Errorf("Range with a future cutoff = %d samples, want 0", len(got))
	}
}

func TestSamplerSurvivesCollectorErrors(t *testing.T) {
	sampler := NewSampler(&fakeCollector{}, time.Millisecond, 10)
	sampler.tick()
	before := sampler.Count()

	// A failing collector must keep the last good sample.
	sampler.collector = &errorCollector{}
	sampler.tick()
	if sampler.Count() != before {
		t.Errorf("history changed after a collector error: %d -> %d", before, sampler.Count())
	}
	if sampler.Latest().CPUPercent == 0 {
		t.Error("the last good sample was lost")
	}
}

type errorCollector struct{}

func (errorCollector) Mode() string { return "error" }
func (errorCollector) Snapshot(Snapshot, time.Duration) (Snapshot, error) {
	return Snapshot{}, errFake
}

var errFake = &fakeError{}

type fakeError struct{}

func (*fakeError) Error() string { return "collector failed" }

func TestSiteMetricsReportWhyTheyAreUnavailable(t *testing.T) {
	// No such unit exists in the test environment, so this must explain itself
	// instead of returning a misleading zero.
	snapshot, _ := ReadSite("does-not-exist", 0, false, time.Second)
	if snapshot.Available {
		t.Skip("cgroup v2 with a barepod unit is present on this machine")
	}
	if snapshot.Reason == "" {
		t.Error("an unavailable sample must carry a reason")
	}
	if snapshot.Slug != "does-not-exist" {
		t.Errorf("slug = %q", snapshot.Slug)
	}
}

func TestSiteSamplerHistoryAndReset(t *testing.T) {
	sampler := NewSiteSampler(5)
	// Unavailable samples are not stored, so nothing accumulates for a stopped site.
	_ = sampler.Collect("demo", time.Second)
	if got := len(sampler.Range("demo", time.Time{})); got != 0 {
		t.Fatalf("stored %d samples for a stopped website, want 0", got)
	}
	if sampler.Latest("demo").Reason == "" {
		t.Error("Latest must explain why there is no data")
	}
	if sampler.Latest("unknown").Available {
		t.Error("an unseen website must not report available metrics")
	}

	sampler.ResetSite("demo")
	if got := sampler.Latest("demo").Reason; got != "no sample yet" {
		t.Errorf("after ResetSite the reason = %q", got)
	}
}

func TestUnitName(t *testing.T) {
	if got := UnitName("my-shop"); got != "barepod-app@my-shop.service" {
		t.Errorf("UnitName = %q", got)
	}
}
