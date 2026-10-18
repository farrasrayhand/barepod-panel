package scheduler

import (
	"context"
	"sync"
	"time"

	"github.com/farrasrayhand/barepod-panel/backend/internal/host"
	"github.com/farrasrayhand/barepod-panel/backend/internal/store"
	"github.com/farrasrayhand/barepod-panel/backend/internal/sysinfo"
)

// tickInterval is how often the scheduler looks at the clock. It must be shorter than a minute so
// every minute-granular slot is seen, and the per-minute claim stops a slot running twice.
const tickInterval = 30 * time.Second

// jobTimeout bounds a single job so a wedged command cannot hold a goroutine for ever.
const jobTimeout = 15 * time.Minute

// maxOutputBytes caps what is stored per run: a job that floods stdout must not fill the database.
const maxOutputBytes = 8 << 10

// Scheduler runs the built-in maintenance jobs recorded in system_cron_jobs.
type Scheduler struct {
	Store *store.Store
	Host  *host.Host
	Key   []byte
	Caps  sysinfo.Capabilities
	Logf  func(string, ...any)

	mu       sync.Mutex
	lastSlot map[string]string // job id -> the minute it last ran, so one slot runs once
}

// Run ticks until the context is cancelled.
func (s *Scheduler) Run(ctx context.Context) {
	s.Tick(ctx, time.Now())
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.Tick(ctx, time.Now())
		}
	}
}

// Tick runs every enabled job whose schedule matches now and has not already run this minute.
func (s *Scheduler) Tick(ctx context.Context, now time.Time) {
	if s.Store == nil || s.Host == nil {
		return
	}
	jobs, err := s.Store.ListSystemCronJobs()
	if err != nil {
		s.logf("scheduler: could not read the job list: %v", err)
		return
	}
	slot := now.Format("2006-01-02T15:04")
	for _, job := range jobs {
		if !job.Enabled {
			continue
		}
		meta, ok := Lookup(job.ID)
		if !ok || !meta.Implemented {
			continue
		}
		schedule, err := Parse(job.Schedule)
		if err != nil {
			s.logf("scheduler: job %s has an invalid schedule %q: %v", job.ID, job.Schedule, err)
			continue
		}
		if !schedule.Matches(now) {
			continue
		}
		if !s.claim(job.ID, slot) {
			continue
		}
		go s.runOne(ctx, job.ID)
	}
}

// claim records that a job has run in this minute, returning false if it already had. It is what
// keeps a 30-second tick from running a "every minute" job twice.
func (s *Scheduler) claim(id, slot string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lastSlot == nil {
		s.lastSlot = map[string]string{}
	}
	if s.lastSlot[id] == slot {
		return false
	}
	s.lastSlot[id] = slot
	return true
}

func (s *Scheduler) runOne(ctx context.Context, id string) {
	meta, _ := Lookup(id)
	runCtx, cancel := context.WithTimeout(ctx, TimeoutFor(meta))
	defer cancel()

	start := time.Now()
	out, err := RunJob(runCtx, s.env(), id)
	status := "success"
	if err != nil {
		status = "failed"
		if out == "" {
			out = err.Error()
		} else {
			out = out + "\n" + err.Error()
		}
	}

	if recErr := s.Store.RecordSystemCronRun(id, status, trimOutput(out)); recErr != nil {
		s.logf("scheduler: could not record the run of %s: %v", id, recErr)
	}
	_ = s.Store.Audit("", "system.cron_run", id, "127.0.0.1",
		status+" ("+time.Since(start).Round(time.Millisecond).String()+")")

	if err != nil {
		s.logf("scheduler: %s failed: %v", id, err)
		return
	}
	s.logf("scheduler: %s ran (%s)", id, time.Since(start).Round(time.Millisecond))
}

// NewEnv builds the environment a job runs in, for the scheduler and for a manual "run now".
func NewEnv(st *store.Store, h *host.Host, key []byte, caps sysinfo.Capabilities, logf func(string, ...any)) *Env {
	return &Env{Store: st, Host: h, Key: key, Caps: caps, Logf: logf}
}

func (s *Scheduler) env() *Env { return NewEnv(s.Store, s.Host, s.Key, s.Caps, s.Logf) }

func (s *Scheduler) logf(format string, args ...any) {
	if s.Logf != nil {
		s.Logf(format, args...)
	}
}

func trimOutput(out string) string {
	out = trimSpace(out)
	if len(out) > maxOutputBytes {
		return out[:maxOutputBytes] + "\n… (truncated)"
	}
	return out
}

func trimSpace(s string) string {
	start := 0
	for start < len(s) && (s[start] == ' ' || s[start] == '\n' || s[start] == '\t' || s[start] == '\r') {
		start++
	}
	end := len(s)
	for end > start && (s[end-1] == ' ' || s[end-1] == '\n' || s[end-1] == '\t' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}
