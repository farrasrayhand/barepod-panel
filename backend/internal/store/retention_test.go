package store

import (
	"testing"
	"time"
)

func newDeployJob(t *testing.T, st *Store, slug, id string) {
	t.Helper()
	job := &DeployJob{
		ID: id, Slug: slug, Mode: "dry-run", Status: "success",
		Step: 8, TotalSteps: 8, CurrentStep: "Health check",
		CreatedAt: time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := st.CreateDeployJob(job); err != nil {
		t.Fatalf("create job %s: %v", id, err)
	}
	if _, err := st.AppendDeployLog(id, "stdout", "line from "+id); err != nil {
		t.Fatalf("append log: %v", err)
	}
}

func TestPruneDeployJobsKeepsNewest(t *testing.T) {
	st := newTestStore(t)

	for i := 0; i < 12; i++ {
		newDeployJob(t, st, "demo", "job-"+string(rune('a'+i)))
	}
	// A different website must not be touched.
	newDeployJob(t, st, "other", "other-job")

	removed, err := st.PruneDeployJobs("demo", 10)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if removed != 2 {
		t.Fatalf("removed %d jobs, want 2", removed)
	}

	remaining, err := st.CountDeployJobs("demo")
	if err != nil {
		t.Fatal(err)
	}
	if remaining != 10 {
		t.Fatalf("demo has %d jobs, want 10", remaining)
	}

	other, err := st.CountDeployJobs("other")
	if err != nil {
		t.Fatal(err)
	}
	if other != 1 {
		t.Fatalf("other has %d jobs, want 1 (pruning must be per website)", other)
	}

	// The two oldest jobs are gone with their logs, the newest are intact.
	if logs, err := st.DeployLogs("job-a", 0); err != nil || len(logs) != 0 {
		t.Fatalf("old job logs = %d, err = %v (want 0, nil)", len(logs), err)
	}
	if logs, err := st.DeployLogs("job-l", 0); err != nil || len(logs) != 1 {
		t.Fatalf("newest job logs = %d, err = %v (want 1, nil)", len(logs), err)
	}
}

func TestPruneDeployJobsNoopWhenUnderLimit(t *testing.T) {
	st := newTestStore(t)
	newDeployJob(t, st, "demo", "job-1")

	removed, err := st.PruneDeployJobs("demo", 10)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 0 {
		t.Fatalf("removed %d jobs, want 0", removed)
	}
}
