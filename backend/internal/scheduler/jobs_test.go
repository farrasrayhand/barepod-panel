package scheduler

import "testing"

func TestPackageUpdatesJobIsOptIn(t *testing.T) {
	job, ok := Lookup("package_updates")
	if !ok {
		t.Fatal("package_updates is not registered")
	}
	if !job.Implemented {
		t.Fatal("package_updates is registered but marked unimplemented")
	}
	if job.DefaultEnabled {
		t.Fatal("package_updates must start disabled: an upgrade changes host packages")
	}
	if job.DefaultSchedule == "" {
		t.Fatal("package_updates needs a default schedule")
	}
}
