package resources

import (
	"strings"
	"testing"
)

func TestZeroLimitsMeanUnlimited(t *testing.T) {
	if !(Limits{}).IsZero() {
		t.Error("the zero value must mean unlimited")
	}
	if got := (Limits{}).Describe(); got != "unlimited" {
		t.Errorf("Describe() = %q, want unlimited", got)
	}
	if (Limits{}).Multiply(10).CPUQuotaPercent != 0 {
		t.Error("scaling an unlimited package must stay unlimited")
	}
}

func TestAllocationSumsMembers(t *testing.T) {
	usages := []Usage{
		{Name: "Developer", Members: 3, Limits: Limits{CPUQuotaPercent: 100, MemoryMB: 1024, DiskQuotaGB: 10}},
		{Name: "Read Only", Members: 1, Limits: Limits{CPUQuotaPercent: 50, MemoryMB: 512, DiskQuotaGB: 5}},
	}
	got := Allocation(usages)
	want := Limits{CPUQuotaPercent: 350, MemoryMB: 3584, DiskQuotaGB: 35}
	if got != want {
		t.Fatalf("Allocation = %+v, want %+v", got, want)
	}
}

func TestValidateRejectsOvercommit(t *testing.T) {
	capacity := Capacity{CPUCores: 4, MemoryMB: 4096, DiskGB: 80}
	usages := []Usage{
		// 5 members × 1 GiB = 5 GiB on a 4 GiB box.
		{Name: "Developer", Members: 5, Limits: DefaultLimits()},
	}

	err := Validate(usages, capacity, Sharing{})
	if err == nil {
		t.Fatal("Validate accepted a package set larger than the server")
	}
	if !strings.Contains(err.Error(), "memory") {
		t.Errorf("error = %q, want it to name the memory overcommit", err)
	}
	if !strings.Contains(err.Error(), "server") {
		t.Errorf("error = %q, want it to mention the server", err)
	}
}

func TestValidateAcceptsFittingPlan(t *testing.T) {
	capacity := Capacity{CPUCores: 8, MemoryMB: 16384, DiskGB: 200}
	usages := []Usage{
		{Name: "Developer", Members: 3, Limits: Limits{CPUQuotaPercent: 100, MemoryMB: 1024, DiskQuotaGB: 10}},
	}
	if err := Validate(usages, capacity, Sharing{}); err != nil {
		t.Fatalf("Validate rejected a plan that fits: %v", err)
	}
}

func TestValidateIgnoresUnknownCapacity(t *testing.T) {
	// A host where the figures could not be read must not block the operator.
	usages := []Usage{{Name: "Developer", Members: 10, Limits: DefaultLimits()}}
	if err := Validate(usages, Capacity{}, Sharing{}); err != nil {
		t.Fatalf("Validate failed on unknown capacity: %v", err)
	}
}

func TestValidateTreatsUnlimitedPackagesAsFree(t *testing.T) {
	capacity := Capacity{CPUCores: 2, MemoryMB: 2048, DiskGB: 20}
	usages := []Usage{{Name: "Superadmin (Root)", Members: 4, Limits: Limits{}}}
	if err := Validate(usages, capacity, Sharing{}); err != nil {
		t.Fatalf("an unlimited package must not count against the host: %v", err)
	}
}

func TestRatios(t *testing.T) {
	capacity := Capacity{CPUCores: 4, MemoryMB: 8192, DiskGB: 100}
	ratios := Ratios(Limits{CPUQuotaPercent: 200, MemoryMB: 4096, DiskQuotaGB: 25}, capacity)
	if ratios.CPU != 0.5 {
		t.Errorf("CPU ratio = %v, want 0.5", ratios.CPU)
	}
	if ratios.RAM != 0.5 {
		t.Errorf("RAM ratio = %v, want 0.5", ratios.RAM)
	}
	if ratios.Disk != 0.25 {
		t.Errorf("disk ratio = %v, want 0.25", ratios.Disk)
	}
	if !ratios.Fits(Sharing{}) {
		t.Error("a half-used host must fit")
	}
}

func TestSuggestNeverExceedsHost(t *testing.T) {
	small := Capacity{CPUCores: 1, MemoryMB: 1024, DiskGB: 20}
	suggestion := small.Suggest()
	if suggestion.MemoryMB > small.MemoryMB {
		t.Errorf("suggested %d MiB RAM on a %d MiB host", suggestion.MemoryMB, small.MemoryMB)
	}
	if suggestion.DiskQuotaGB > small.DiskGB {
		t.Errorf("suggested %d GiB disk on a %d GiB host", suggestion.DiskQuotaGB, small.DiskGB)
	}
	if err := Validate([]Usage{{Name: "Developer", Members: 1, Limits: suggestion}}, small, Sharing{}); err != nil {
		t.Errorf("the suggestion does not fit its own host: %v", err)
	}
}

func TestDiskQuotaBytes(t *testing.T) {
	if got := (Limits{DiskQuotaGB: 2}).DiskQuotaBytes(); got != 2*1024*1024*1024 {
		t.Fatalf("DiskQuotaBytes = %d, want %d", got, 2*1024*1024*1024)
	}
	if got := (Limits{}).DiskQuotaBytes(); got != 0 {
		t.Fatalf("unlimited DiskQuotaBytes = %d, want 0", got)
	}
}

func TestSharingSkipsOnlyTheTickedResource(t *testing.T) {
	capacity := Capacity{CPUCores: 1, MemoryMB: 1024, DiskGB: 10}
	// 4 members at one core / 1 GiB / 10 GiB each: every resource overcommits a 1-core,
	// 1 GiB, 10 GiB host.
	usages := []Usage{{Name: "Basic", Members: 4, Limits: Limits{CPUQuotaPercent: 100, MemoryMB: 1024, DiskQuotaGB: 10}}}

	if got := Exceeds(usages, capacity, Sharing{}); len(got) != 3 {
		t.Fatalf("hardcap Exceeds = %v, want all three resources named", got)
	}

	got := Exceeds(usages, capacity, Sharing{CPU: true})
	if len(got) != 2 {
		t.Fatalf("Exceeds with CPU shared = %v, want memory and disk only", got)
	}
	for _, problem := range got {
		if strings.HasPrefix(problem, "CPU") {
			t.Errorf("a shared CPU must not be reported: %v", got)
		}
	}

	everything := Sharing{CPU: true, RAM: true, Disk: true}
	if got := Exceeds(usages, capacity, everything); len(got) != 0 {
		t.Fatalf("Exceeds with everything shared = %v, want none", got)
	}
	if err := Validate(usages, capacity, everything); err != nil {
		t.Fatalf("a fully shared plan must be accepted: %v", err)
	}
}

func TestCPUPlanPicksQuotaOrWeight(t *testing.T) {
	l := Limits{CPUQuotaPercent: 100, CPUWeight: 250}
	if quota, weight := CPUPlan(l, Sharing{}); quota != 100 || weight != 0 {
		t.Errorf("hardcap plan = (%d,%d), want (100,0)", quota, weight)
	}
	if quota, weight := CPUPlan(l, Sharing{CPU: true}); quota != 0 || weight != 250 {
		t.Errorf("sharing plan = (%d,%d), want (0,250)", quota, weight)
	}
}

func TestSharingRoundTripsThroughCSV(t *testing.T) {
	in := Sharing{CPU: true, Disk: true}
	if got := ParseSharing(in.List()); got != in {
		t.Errorf("ParseSharing(List()) = %+v, want %+v", got, in)
	}
	if got := ParseSharing(""); got != (Sharing{}) {
		t.Errorf("empty CSV = %+v, want the zero value", got)
	}
	if got := ParseSharing(" RAM , bogus "); !got.RAM || got.CPU || got.Disk {
		t.Errorf("ParseSharing ignored case/whitespace/unknown keys: %+v", got)
	}
}
