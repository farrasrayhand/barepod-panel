package resources

import (
	"strings"
	"testing"
)

func TestParseCPUMax(t *testing.T) {
	cases := map[string]int{
		"200000 100000": 2,
		"100000 100000": 1,
		"50000 100000":  1, // half a core still needs one core's worth of quota
		"max 100000":    0, // no limit -> caller falls back
		"":              0,
		"garbage":       0,
	}
	for input, want := range cases {
		if got := ParseCPUMax(input); got != want {
			t.Errorf("ParseCPUMax(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestParseCPUList(t *testing.T) {
	cases := map[string]int{
		"0":           1,
		"0-3":         4,
		"0-3,8,10-11": 7, // 4 + 1 + 2
		"0-1\n":       2,
		"":            0,
	}
	for input, want := range cases {
		if got := ParseCPUList(input); got != want {
			t.Errorf("ParseCPUList(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestExceedsListsLiveOvercommit(t *testing.T) {
	// A scale-down: the packages were sized for 8 GB and the box is now 4 GB.
	usages := []Usage{{Name: "Developer", Members: 2, Limits: Limits{MemoryMB: 4096}}}
	small := Capacity{CPUCores: 2, MemoryMB: 4096, DiskGB: 80}

	problems := Exceeds(usages, small)
	if len(problems) != 1 {
		t.Fatalf("Exceeds = %v, want exactly one problem", problems)
	}
	if !strings.Contains(problems[0], "memory") || !strings.Contains(problems[0], "200%") {
		t.Errorf("problem = %q, want the memory overcommit with its percentage", problems[0])
	}

	// After a scale-up the same plan fits again.
	big := Capacity{CPUCores: 8, MemoryMB: 32768, DiskGB: 400}
	if got := Exceeds(usages, big); len(got) != 0 {
		t.Fatalf("Exceeds after scale-up = %v, want none", got)
	}
}

func TestExceedsIsSortedForStableOutput(t *testing.T) {
	usages := []Usage{{Name: "Developer", Members: 4, Limits: Limits{CPUQuotaPercent: 400, MemoryMB: 8192, DiskQuotaGB: 200}}}
	problems := Exceeds(usages, Capacity{CPUCores: 1, MemoryMB: 1024, DiskGB: 10})
	if len(problems) != 3 {
		t.Fatalf("Exceeds = %v, want 3 problems", problems)
	}
	if !strings.HasPrefix(problems[0], "CPU") {
		t.Errorf("problems are not sorted: %v", problems)
	}
}
